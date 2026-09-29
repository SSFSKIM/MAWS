// `window.__maws_harness.agents` (C8b execution document, Interfaces *Harness API*): the agent tools read as the panel
// renders them (the selected tab's DOM, so a case asserts what the owner sees) and driven through the controls a click
// reaches; the fake client's disk half and recorded calls; and the column's transcript hand-offs.
import type { AgentId, AppSessionId, TaskId } from '@shared/graph/ids';
import type { SubagentEntry } from '@shared/ipc/schema/fs';
import { SubagentMetaSchema, WorkflowSnapshotSchema } from '@shared/wire/store';
import { instanceIds, instanceOf, usePanelHost } from '../../panel/host';
import { useLayout } from '../../stores/layout';
import { activeTab, sessionOfTab } from '../../stores/layout-model';
import { BACKGROUND_COPY, LOG_COPY, RELAY_COPY, SUBAGENTS_COPY } from '../../tools/agents/copy';
import { relayKey, useRelays } from '../../tools/agents/relay-store';
import { useTaskGraph } from '../../tools/agents/store';
import { useTranscriptStore } from '../../transcript';
import { fakeId } from '../panel/fakeSessions';
import { attachesOf, childSourceFor, columnHandle, columnView, fake, feed, patchStatus, releaseThrough, reset, setAgentTab } from './AgentsHarnessBlock';
import type { AgentRowView, AgentsHarnessApi, BackgroundView, LogView, SubagentsView } from './api';

// The fixture directories, raw, as C4's `fs.subagents` and `fs.workflows` would answer them (sizes and times are nominal;
// the lists read neither).
const SIDECARS = {
  'subagent-sidecars': import.meta.glob<string>('../../../../../spikes/protocol-probe/fixtures/subagent-sidecars/agent-*.meta.json', { query: '?raw', import: 'default' }),
  'workflow-disk': import.meta.glob<string>('../../../../../spikes/protocol-probe/fixtures/pass2/workflow-disk/agent-*.meta.json', { query: '?raw', import: 'default' }),
  'nested-agents-sidecars': import.meta.glob<string>('../../../../../spikes/protocol-probe/fixtures/pass3/nested-agents-sidecars/agent-*.meta.json', { query: '?raw', import: 'default' }),
};
const RUNS = import.meta.glob<string>('../../../../../spikes/protocol-probe/fixtures/pass2/workflow-disk/wf_*.json', { query: '?raw', import: 'default' });

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const frames = async (n = 2) => {
  for (let i = 0; i < n; i += 1) await frame();
};
const text = (el: Element | null | undefined) => el?.textContent?.trim() ?? '';

// ---- where things are ------------------------------------------------------------------------------------------------------

const region = () => document.querySelector<HTMLElement>('[data-region="panel"]');
const shownSession = (): AppSessionId | null => sessionOfTab(activeTab(useLayout.getState().main));

// The selected panel tab of the shown session (or the no-session selection), with its tool.
function selectedTab(): { id: string; toolId: string } | null {
  const layout = useLayout.getState();
  const shown = shownSession();
  const active = shown ? (layout.panelBySession.get(shown)?.activeTabId ?? null) : layout.panelActiveNoSession;
  const tab = layout.effectivePanelTabs(shown).find((t) => t.id === active);
  return tab ? { id: tab.id, toolId: tab.toolId } : null;
}
const bodyOf = (toolId: string) => (selectedTab()?.toolId === toolId ? region()?.querySelector<HTMLElement>('[role="tabpanel"]') : null) ?? null;

function click(el: Element | null | undefined, what: string): void {
  if (!(el instanceof HTMLElement)) throw new Error(`agents: no ${what}`);
  if (el instanceof HTMLButtonElement && el.disabled) throw new Error(`agents: ${what} is disabled`);
  el.click();
}
const buttonNamed = (root: ParentNode | null | undefined, name: string) => [...(root?.querySelectorAll('button') ?? [])].find((b) => text(b) === name) ?? null;

// ---- Subagents -------------------------------------------------------------------------------------------------------------

function subagents(): SubagentsView | null {
  const body = bodyOf('subagents');
  if (!body) return null;
  const appSessionId = shownSession();
  const graph = appSessionId ? useTaskGraph.getState().entries.get(appSessionId)?.graph : undefined;
  const rows = (section: string): AgentRowView[] =>
    [...body.querySelectorAll<HTMLElement>(`section[data-section="${section}"] [data-agent-row]`)].map((row) => ({
      agentId: row.dataset.agentRow!,
      title: text(row.querySelector('[data-part="title"]')),
      depth: Number(row.dataset.depth),
      orphan: row.querySelector('[data-part="nested"]') !== null,
      status: graph?.tasks.get(row.dataset.agentRow as TaskId)?.status ?? 'unknown',
      elapsed: text(row.querySelector('[data-part="elapsed"]')),
      waiting: row.querySelector('[data-part="waiting"]') !== null,
      line: text(row.querySelector('[data-part="line"]')),
    }));
  const lists = body.querySelector('[data-view="lists"]');
  const agent = body.querySelector<HTMLElement>('[data-view="agent"]');
  let drillIn: SubagentsView['drillIn'] = null;
  if (agent) {
    const view = (instanceOf(selectedTab()!.id)?.state as { snapshot(): { view: { kind: string; agentId?: string } } } | undefined)?.snapshot().view;
    const agentId = view?.kind === 'agent' ? view.agentId! : '';
    const box = agent.querySelector('textarea');
    const key = appSessionId ? childSourceFor(appSessionId, agentId as AgentId).key : undefined;
    drillIn = {
      agentId,
      header: text(agent.querySelector('h2')),
      meta: text(agent.querySelector('[data-part="agent-meta"]')),
      dispatchedBy: text(agent.querySelector('[data-part="dispatched-by"]')),
      rows: key ? useTranscriptStore.getState().rows(key).length : 0,
      requestCards: agent.querySelectorAll('[data-request-card]').length,
      relay: {
        label: text(agent.querySelector('[data-key-sink="composer"] label')),
        disabled: box?.disabled ? box.placeholder : null,
        tooltip: box?.title || null,
        pending: agent.querySelector('[data-part="relay-line"]') ? text(agent.querySelector('[data-part="relay-line"]')) : null,
      },
    };
  }
  return {
    active: rows('active'),
    done: rows('done'),
    disk: rows('disk'),
    headings: [...(lists?.querySelectorAll('section[data-section] > h3') ?? [])].map(text),
    notes: [...(lists?.querySelectorAll(':scope > p') ?? [])].map(text),
    drillIn,
  };
}

// ---- Background work -------------------------------------------------------------------------------------------------------

function phaseOf(label: string): { title: string; count: string; state: string } {
  const queued = label.endsWith(' · Queued');
  if (queued) return { title: label.slice(0, -' · Queued'.length), count: '', state: 'queued' };
  const match = /^(.*) (\d+)\/(\d+)$/.exec(label);
  if (!match) return { title: label, count: '', state: '' };
  return { title: match[1], count: `${match[2]}/${match[3]}`, state: match[2] === match[3] ? 'done' : 'running' };
}
const errorOf = (root: Element) => [...root.querySelectorAll('p')].map(text).find((line) => line.startsWith("Couldn't stop it:")) ?? null;
const stoppingIn = (root: Element) => buttonNamed(root, BACKGROUND_COPY.stopping) !== null;

function background(): BackgroundView | null {
  const body = bodyOf('background');
  if (!body) return null;
  const tasks = body.querySelector('section[data-section="tasks"]');
  const earlier = [...(tasks?.querySelectorAll('button') ?? [])].map(text).find((t) => / earlier tasks? completed$/.test(t));
  const notes = [...(tasks?.querySelectorAll(':scope > p') ?? [])].map(text);
  return {
    workflows: [...body.querySelectorAll<HTMLElement>('[data-workflow]')].map((card) => ({
      taskId: card.dataset.workflow!,
      title: text(card.querySelector('h4')),
      line: text(card.querySelector('[data-part="line"]')),
      status: text(card.querySelector('[data-part="status"]')),
      phases: [...card.querySelectorAll('[data-phase]')].map((p) => phaseOf(text(p))),
      table: [...card.querySelectorAll('tbody tr')].map((tr) => {
        const [label, model, tokens, time] = [...tr.querySelectorAll('td')].map(text);
        return { label, model, tokens, time };
      }),
      stopping: stoppingIn(card),
      error: errorOf(card),
    })),
    shells: [...body.querySelectorAll<HTMLElement>('[data-shell]')].map((row) => ({
      taskId: row.dataset.shell!,
      line: text(row.querySelector('[data-part="line"]')),
      output: buttonNamed(row, BACKGROUND_COPY.output)?.disabled === false ? 'enabled' : 'disabled',
      stopping: stoppingIn(row),
      error: errorOf(row),
    })),
    monitors: [...body.querySelectorAll<HTMLElement>('[data-monitor]')].map((row) => ({ taskId: row.dataset.monitor!, line: text(row.querySelector('[data-part="line"]')) })),
    tasks: {
      heading: text(tasks?.querySelector('h3 button')),
      label: tasks?.querySelector('[data-part="label"]') ? text(tasks.querySelector('[data-part="label"]')) : null,
      rows: [...(tasks?.querySelectorAll('[data-task]') ?? [])].map(text),
      earlier: earlier ? Number(earlier.split(' ')[0]) : 0,
      unavailable: notes.find((note) => note.startsWith('Tasks unavailable')) ?? null,
    },
    notes: [...body.querySelectorAll('p')].filter((p) => !body.contains(p.parentElement?.closest('section, article, [data-shell], [data-monitor]') ?? null)).map(text),
    headings: [...body.querySelectorAll('section[data-section] > h3 > button')].map(text),
  };
}

// ---- Log -------------------------------------------------------------------------------------------------------------------

function log(): LogView | null {
  const tab = selectedTab();
  const body = bodyOf('log');
  if (!tab || !body) return null;
  const suffix = usePanelHost.getState().titles[tab.id];
  const pages = [...body.querySelectorAll<HTMLElement>('pre[data-log-page]')];
  const shown = body.querySelector('[data-log]');
  const refused = [...body.querySelectorAll('p')].map(text).find((line) => line.startsWith('Refused:')) ?? null;
  return {
    title: suffix ? `${LOG_COPY.title} · ${suffix}` : LOG_COPY.title,
    heading: shown ? text(shown.querySelector('h2')) : null,
    path: shown ? text(shown.querySelector('[data-part="path"]')) : null,
    size: shown?.querySelector('[data-part="size"]') ? text(shown.querySelector('[data-part="size"]')) : null,
    pages: pages.length,
    offsets: pages.map((page) => Number(page.dataset.offset)),
    text: pages.map((page) => page.textContent ?? '').join(''),
    end: [...body.querySelectorAll('span')].some((span) => text(span) === LOG_COPY.endOfFile),
    noFile: shown ? null : text(body.querySelector('p')) || null,
    refused,
  };
}

// ---- actions ---------------------------------------------------------------------------------------------------------------

function agentView(): HTMLElement {
  const agent = bodyOf('subagents')?.querySelector<HTMLElement>('[data-view="agent"]');
  if (!agent) throw new Error('agents: the Subagents drill-in is not shown');
  return agent;
}

// A React-controlled textarea takes a typed value through the native setter and an input event, as a keystroke does.
function type(box: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, value);
  box.dispatchEvent(new Event('input', { bubbles: true }));
}

async function until(done: () => boolean, what: string, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`agents: timed out waiting for ${what}`);
    await frame();
  }
}

async function sendRelay(): Promise<void> {
  const agent = agentView();
  const appSessionId = shownSession()!;
  const view = (instanceOf(selectedTab()!.id)?.state as { snapshot(): { view: { agentId?: string } } }).snapshot().view;
  const key = relayKey(appSessionId, view.agentId as AgentId);
  const before = fake.calls().steer.length;
  const previous = useRelays.getState().relays.get(key);
  click(buttonNamed(agent, RELAY_COPY.send), 'Send');
  // Answered: the relay replaced (asked, or failed when refused before the steer went out).
  await until(() => {
    const relay = useRelays.getState().relays.get(key);
    return relay !== undefined && relay !== previous && (relay.state.kind !== 'asked' || fake.calls().steer.length > before);
  }, 'the relay’s steer to be answered');
  await frames();
}

async function stop(taskId: string): Promise<void> {
  const body = region();
  const row = body?.querySelector(`[data-task-id="${CSS.escape(taskId)}"]`);
  if (row) click(buttonNamed(row, BACKGROUND_COPY.stopWorkflow) ?? buttonNamed(row, BACKGROUND_COPY.stop), `Stop for ${taskId}`);
  else {
    click(buttonNamed(agentView(), SUBAGENTS_COPY.stopAgent), 'Stop agent');
    await frames(1);
    click(buttonNamed(document.querySelector('[data-radix-popper-content-wrapper]'), SUBAGENTS_COPY.stopConfirmYes), 'the Stop confirmation');
  }
  await frames(1);
  await fake.idle();
  await frames();
}

async function logAction(name: string): Promise<void> {
  click(buttonNamed(bodyOf('log'), name), name);
  await frames(1);
  await fake.idle();
  await frames();
}

// ---- the column's transcript -------------------------------------------------------------------------------------------------

const column = () => document.querySelector<HTMLElement>('[data-agents-harness-transcript]');

async function clickTranscriptSubagent(n: number): Promise<void> {
  const session = columnView().session;
  if (!session) throw new Error('agents: nothing fed yet');
  useTranscriptStore.getState().expandAll(session.key); // the subagent rows sit in the turns' work areas
  await frames();
  const controls = [...(column()?.querySelectorAll('button.transcript-subagent-line, button.transcript-glyph') ?? [])];
  click(controls[n - 1], `transcript agent control ${n} of ${controls.length}`);
}

// The n-th "Open full log" of the column's transcript with every cell expanded, scrolling the list from its top to reach
// rows the virtualiser has not mounted.
async function clickTranscriptFullLog(n: number): Promise<void> {
  const session = columnView().session;
  if (!session) throw new Error('agents: nothing fed yet');
  useTranscriptStore.getState().expandAll(session.key, { cells: true });
  await frames();
  const scroller = columnHandle.current?.scrollElement;
  if (!scroller) throw new Error('agents: the column’s transcript is not mounted');
  scroller.scrollTop = 0;
  await frames();
  const seen: HTMLButtonElement[] = [];
  for (;;) {
    for (const button of scroller.querySelectorAll('button')) if (text(button) === 'Open full log' && !seen.includes(button)) seen.push(button);
    if (seen.length >= n || scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight) break;
    scroller.scrollTop += scroller.clientHeight;
    await frames();
  }
  click(seen[n - 1], `"Open full log" ${n} of ${seen.length}`);
  await frames();
}

// ---- disk --------------------------------------------------------------------------------------------------------------------

async function fixtureFs(name: 'subagent-sidecars' | 'workflow-disk' | 'nested-agents-sidecars'): Promise<void> {
  const runs = name === 'workflow-disk' ? await Promise.all(Object.values(RUNS).map(async (load) => WorkflowSnapshotSchema.parse(JSON.parse(await load())))) : [];
  const runId = runs[0]?.runId ?? null; // workflow-disk's agents are that run's (C4 lists them under subagents/workflows/<runId>/)
  const sidecars: SubagentEntry[] = await Promise.all(
    Object.entries(SIDECARS[name]).map(async ([path, load]) => {
      const agentId = path.slice(path.lastIndexOf('/agent-') + '/agent-'.length, -'.meta.json'.length) as AgentId;
      const meta = SubagentMetaSchema.parse(JSON.parse(await load()));
      return { agentId, meta, transcriptPath: path.replace(/\.meta\.json$/, '.jsonl'), size: 100, mtimeMs: 1_790_000_000_000, runId };
    }),
  );
  fake.fakeFs({ sidecars, runs: runs.map((snapshot) => ({ runId: snapshot.runId, snapshot, journal: [] })) });
  await frames();
}

// ---- the surface -------------------------------------------------------------------------------------------------------------

export const agentsProbes: AgentsHarnessApi = {
  feed,
  reset: (id) => reset(id),
  fakeFs: (data) => fake.fakeFs(data),
  fixtureFs,
  patchStatus,
  async releaseThrough(id, seq) {
    const n = releaseThrough(id, seq);
    await frames();
    return n;
  },
  calls: () => fake.calls(),
  answerStop: (taskId, outcome) => fake.answerStop(taskId, outcome),
  subagents,
  background,
  log,
  clickRow: (agentId) => click(bodyOf('subagents')?.querySelector(`[data-agent-row="${CSS.escape(agentId)}"]`), `the row of ${agentId}`),
  back: () => click(buttonNamed(bodyOf('subagents'), SUBAGENTS_COPY.back), 'Back'),
  typeRelay(value) {
    const box = agentView().querySelector('textarea');
    if (!box || box.disabled) throw new Error('agents: the relay box is disabled');
    type(box, value);
  },
  sendRelay,
  stop,
  output: (taskId) => click(buttonNamed(region()?.querySelector(`[data-shell="${CSS.escape(taskId)}"]`), BACKGROUND_COPY.output), `Output of ${taskId}`),
  loadMore: () => logAction(LOG_COPY.loadMore),
  showEarlier: () => logAction(LOG_COPY.showEarlier),
  instances: (toolId) => instanceIds().filter((id) => instanceOf(id)?.tool.id === toolId),
  clickTranscriptSubagent,
  clickTranscriptFullLog,
  agentTab: (agentId) => setAgentTab(agentId as AgentId | null),
  childTranscript(agentId) {
    const source = childSourceFor(fakeId('A'), agentId as AgentId);
    const key = source.key!;
    const logged = attachesOf(key);
    const count = (selector: string) => {
      const scroller = document.querySelector(selector)?.querySelector<HTMLElement>('[data-index]')?.parentElement;
      return scroller ? Math.max(-1, ...[...scroller.querySelectorAll<HTMLElement>('[data-index]')].map((el) => Number(el.dataset.index))) + 1 : null;
    };
    return {
      keys: Object.keys(useTranscriptStore.getState().entries).filter((k) => k.endsWith(`:${agentId}`)),
      sources: logged.sources.size,
      attaches: logged.attaches,
      rows: useTranscriptStore.getState().rows(key).length,
      drillInRows: count('[data-region="panel"] [data-view="agent"]'),
      agentTabRows: count(`[data-agents-harness-agent-tab="${CSS.escape(agentId)}"]`),
    };
  },
};
