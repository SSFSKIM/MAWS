// `window.__maws_harness.agents` (C8b execution document, Interfaces *Harness API*): the agent tools read as the panel
// renders them (the selected tab's DOM, so a case asserts what the owner sees) and driven through the controls a click
// reaches; the fake client's disk half and recorded calls; and the column's transcript hand-offs.
import type { AgentId, AppSessionId, TaskId } from '@shared/graph/ids';
import type { SubagentEntry } from '@shared/ipc/schema/fs';
import type { PersistedTask } from '@shared/wire/store';
import { SubagentMetaSchema, WorkflowSnapshotSchema } from '@shared/wire/store';
import { instanceIds, instanceOf, usePanelHost } from '../../panel/host';
import { useLayout } from '../../stores/layout';
import { activeTab, sessionOfTab } from '../../stores/layout-model';
import { BACKGROUND_COPY, LOG_COPY, RELAY_COPY, SCHEDULED_COPY, SUBAGENTS_COPY } from '../../tools/agents/copy';
import { relayKey, useRelays } from '../../tools/agents/relay-store';
import { STOP_SETTLE_MS, useTaskGraph } from '../../tools/agents/store';
import { setAgentsClock } from '../../tools/agents/subagents/shared'; // E7
import { useTranscriptStore } from '../../transcript';
import { peerMessageCopy } from '../../transcript/model/copy'; // E7
import { fakeId } from '../panel/fakeSessions';
import { summaryProbes } from '../panel/summaryProbes'; // E7
import { attachesOf, childSourceFor, columnHandle, columnSource, columnView, fake, feed, patchStatus, releaseThrough, reset, setAgentTab } from './AgentsHarnessBlock';
import type { AgentRowView, AgentsFakeId, AgentsHarnessApi, BackgroundView, LogView, PeerRowView, RunWidgetView, ScheduledView, SubagentsView, TasksView, TreeRowView } from './api';

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
    agents: rows('agents'),
    done: rows('done'),
    disk: rows('disk'),
    headings: [...(lists?.querySelectorAll('section[data-section] > h3') ?? [])].map(text),
    notes: [...(lists?.querySelectorAll(':scope > p') ?? [])].map(text),
    drillIn,
  };
}

// E7: the tree's rows as shown, in order (the lists view only).
function tree(): TreeRowView[] | null {
  const lists = bodyOf('subagents')?.querySelector('[data-view="lists"]');
  if (!lists) return null;
  return [...lists.querySelectorAll<HTMLElement>('section[data-section="agents"], section[data-section="done"]')].flatMap((section) =>
    [...section.querySelectorAll<HTMLElement>('[data-agent-row], [data-fold], [data-team], [data-roster]')].map((row): TreeRowView => {
      const base = { section: section.dataset.section as TreeRowView['section'], depth: Number(row.dataset.depth), count: null, expanded: null, orphan: false };
      if (row.dataset.agentRow !== undefined) {
        return { ...base, kind: 'agent', agentId: row.dataset.agentRow, title: text(row.querySelector('[data-part="title"]')), orphan: row.querySelector('[data-part="nested"]') !== null };
      }
      if (row.dataset.fold !== undefined) {
        return { ...base, kind: 'done-fold', agentId: row.dataset.fold, title: text(row), count: Number(/\d+$/.exec(text(row))?.[0]), expanded: row.getAttribute('aria-expanded') === 'true' };
      }
      if (row.dataset.roster !== undefined) return { ...base, kind: 'roster', agentId: null, title: row.dataset.roster };
      return { ...base, kind: 'team', agentId: null, title: text(row) };
    }),
  );
}

// ---- Background work -------------------------------------------------------------------------------------------------------

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
      summary: text(card.querySelector('[data-part="summary"]')),
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
    notes: [...body.querySelectorAll('p')].filter((p) => !body.contains(p.parentElement?.closest('section, article, [data-shell], [data-monitor], [data-view="run"]') ?? null)).map(text),
    headings: [...body.querySelectorAll('section[data-section] h3 > button')].map(text),
  };
}

// E7: the run's widget, when the selected Background work tab shows one.
function widget(): RunWidgetView | null {
  const root = bodyOf('background')?.querySelector<HTMLElement>('[data-view="run"]');
  if (!root) return null;
  const header = root.querySelector('header');
  const cell = (tr: Element, part: string) => text(tr.querySelector(`[data-part="${part}"]`));
  return {
    taskId: root.dataset.run ?? '',
    header: text(root.querySelector('h2')),
    line: text(root.querySelector('[data-part="line"]')),
    status: text(root.querySelector('[data-part="status"]')),
    phases: [...root.querySelectorAll<HTMLElement>('[role="option"]')].map((option) => ({
      title: text(option.querySelector('[data-part="title"]')),
      count: text(option.querySelector('[data-part="count"]')),
      state: option.dataset.state ?? '',
      selected: option.getAttribute('aria-selected') === 'true',
    })),
    agents: [...root.querySelectorAll('tbody tr')].map((tr) => ({
      label: cell(tr, 'agent-label'),
      model: cell(tr, 'model'),
      state: cell(tr, 'state'),
      time: cell(tr, 'time'),
      tokens: cell(tr, 'tokens'),
      openable: tr.querySelector('[data-part="label"] button') !== null,
    })),
    note: [...root.querySelectorAll('p')].filter((p) => !header?.contains(p)).map(text)[0] ?? null,
    stopping: header ? stoppingIn(header) : false,
    error: header ? errorOf(header) : null,
  };
}

// ---- E7 (M7): the Tasks panel, the Scheduled rows, the column's peer rows ---------------------------------------------------

function tasks(): TasksView | null {
  const body = bodyOf('tasks')?.querySelector<HTMLElement>('[data-tool="tasks"]');
  if (!body) return null;
  const part = (name: string) => (body.querySelector(`[data-part="${name}"]`) ? text(body.querySelector(`[data-part="${name}"]`)) : null);
  const items = [...body.querySelectorAll<HTMLElement>('li')].filter((li) => li.querySelector('[data-task]') !== null);
  const notes = body.tagName === 'P' ? [text(body)] : [...body.querySelectorAll(':scope > p')].filter((p) => p.querySelector('[data-part]') === null).map(text);
  const toggle = body.querySelector(':scope > button[aria-expanded]');
  return {
    progress: part('progress'),
    label: part('label'),
    rows: items.map((li) => ({
      id: li.querySelector<HTMLElement>('[data-task]')!.dataset.task!,
      subject: text(li.querySelector('[data-task]')),
      status: li.querySelector('[role="img"]')?.getAttribute('aria-label') ?? '',
      selected: li.getAttribute('aria-current') === 'true',
    })),
    completedToggle: toggle ? text(toggle) : null,
    note: notes[0] ?? null,
  };
}

function scheduled(): ScheduledView | null {
  const body = bodyOf('background');
  if (!body || body.querySelector('[data-view="run"]')) return null;
  const section = body.querySelector<HTMLElement>('section[data-section="scheduled"]');
  if (!section) return { heading: null, rows: [], error: null };
  const part = (row: Element, name: string) => text(row.querySelector(`[data-part="${name}"]`));
  return {
    heading: text(section.querySelector('h3 button')),
    rows: [...section.querySelectorAll<HTMLElement>('[data-scheduled]')].map((row) => ({
      id: row.dataset.scheduled!,
      store: row.dataset.store!,
      schedule: part(row, 'schedule'),
      kind: part(row, 'kind'),
      prompt: part(row, 'prompt'),
      when: part(row, 'when'),
      dormant: part(row, 'when').startsWith(SCHEDULED_COPY.dormant),
      link: buttonNamed(row, SCHEDULED_COPY.openTurn) !== null,
    })),
    error: [...section.querySelectorAll('p')].map(text).find((line) => line.startsWith(SCHEDULED_COPY.unavailable(''))) ?? null,
  };
}

function peerRowOf(el: HTMLElement): PeerRowView | null {
  const message = el.querySelector<HTMLElement>('.transcript-peer[data-peer]');
  if (message) {
    const who = message.querySelector('.transcript-peer-who');
    const state = message.querySelector<HTMLElement>('.transcript-peer-state');
    const error = message.querySelector('.transcript-peer-error');
    const line = message.querySelector('[data-part="peer-line"]');
    return {
      kind: 'message',
      direction: message.dataset.peer as 'inbound' | 'outbound',
      who: text(who),
      address: who?.getAttribute('title') ?? null,
      preview: text(message.querySelector('.transcript-peer-text > span:last-child')),
      result: state?.dataset.result ?? null,
      resultText: error ? text(error) : (state?.getAttribute('title') ?? null),
      reply: buttonNamed(message, peerMessageCopy.reply) !== null,
      line: line ? text(line) : null,
    };
  }
  const listing = el.querySelector<HTMLElement>('.transcript-listing');
  if (!listing) return null;
  return {
    kind: 'listing',
    self: text(listing.querySelector(':scope > .transcript-lifecycle span')),
    sections: [...listing.querySelectorAll<HTMLElement>('.transcript-listing-section')].map((section) => ({
      heading: text(section.querySelector('.transcript-listing-heading')),
      rows: [...section.querySelectorAll('li.transcript-listing-entry')].map((li) => {
        const ref = li.querySelector('.transcript-listing-ref');
        return { name: text(li.querySelector('.transcript-listing-name')), ref: ref ? text(ref) : null, extras: text(li.querySelector('.transcript-listing-extras')) };
      }),
    })),
    notes: [...listing.querySelectorAll('.transcript-listing-note')].map(text),
  };
}

// The column's rows in order, `visit` reading each once until it answers true: each row by its index, the list scrolled
// to it when the virtualiser has not mounted it (a following list may pull itself back to its end between frames, so
// no scroll position is relied on); the list is left where the visit stopped.
async function scanColumn(visit: (row: HTMLElement) => boolean): Promise<void> {
  const session = columnView().session;
  if (!session) throw new Error('agents: nothing fed yet');
  await until(() => (columnHandle.current?.scrollElement ?? null) !== null, 'the column’s transcript to mount');
  const count = useTranscriptStore.getState().rows(columnSource(session).key!).length;
  for (let index = 0; index < count; index += 1) {
    const mounted = () => columnHandle.current?.scrollElement?.querySelector<HTMLElement>(`[data-index="${index}"]`) ?? null;
    if (!mounted()) {
      columnHandle.current!.scrollToIndex(index, 'start');
      await until(() => mounted() !== null, `the column’s row ${index}`);
      await frames(1);
    }
    if (visit(mounted()!)) return;
  }
}

async function peerRows(): Promise<PeerRowView[]> {
  const rows: PeerRowView[] = [];
  await scanColumn((row) => {
    const view = peerRowOf(row);
    if (view) rows.push(view);
    return false;
  });
  return rows;
}

async function columnTexts(): Promise<string[]> {
  const texts: string[] = [];
  await scanColumn((row) => {
    texts.push(text(row));
    return false;
  });
  return texts;
}

// The n-th Reply of the column, opened, typed and sent; resolves once the steer is answered (or the send refused).
async function reply(n: number, value: string): Promise<void> {
  let rowId: string | null = null;
  let count = 0;
  await scanColumn((row) => {
    if (buttonNamed(row.querySelector('.transcript-peer[data-peer="inbound"]'), peerMessageCopy.reply) === null) return false;
    count += 1;
    if (count === n) rowId = row.dataset.rowId!;
    return count === n;
  });
  if (rowId === null) throw new Error(`agents: no Reply ${n} in the column (${count} found)`);
  const id: string = rowId;
  const rowEl = () => document.querySelector<HTMLElement>(`[data-agents-harness-transcript] [data-row-id="${CSS.escape(id)}"]`);
  const toggle = buttonNamed(rowEl()?.querySelector('.transcript-peer'), peerMessageCopy.reply);
  if (toggle?.getAttribute('aria-expanded') !== 'true') click(toggle, `Reply ${n}`);
  await until(() => (rowEl()?.querySelector('textarea') ?? null) !== null, 'the reply composer');
  const box = rowEl()!.querySelector('textarea')!;
  if (box.disabled) throw new Error(`agents: the reply box is disabled (${box.placeholder})`);
  type(box, value);
  await frames(1);
  const before = fake.calls().steer.length;
  click(rowEl()?.querySelector('.transcript-peer-send'), 'Send');
  await until(() => fake.calls().steer.length > before || (rowEl()?.querySelector('[data-part="peer-line"][data-failed]') ?? null) !== null, 'the reply’s steer to be answered');
  await frames();
}

// A disk-only session: the status gone (C3's live status is what makes a session live here), the task graph started over.
function clearStatus(id: AgentsFakeId): void {
  summaryProbes.setStatus(id, null);
  reset(id);
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
  // C6's Transcript loads lazily (its first render is a tick after mount), and the subagent rows sit in the turns' work
  // areas: expanded, then waited for.
  await until(() => columnHandle.current !== null, 'the column’s transcript to mount');
  useTranscriptStore.getState().expandAll(columnSource(session).key!);
  const controls = () => [...(column()?.querySelectorAll('button.transcript-subagent-line, button.transcript-glyph') ?? [])];
  await until(() => controls().length >= n, `transcript agent control ${n}`);
  click(controls()[n - 1], `transcript agent control ${n}`);
}

// The n-th "Open full log" of the column's transcript with every cell expanded, scrolling the list from its top to reach
// rows the virtualiser has not mounted.
async function clickTranscriptFullLog(n: number): Promise<void> {
  const session = columnView().session;
  if (!session) throw new Error('agents: nothing fed yet');
  await until(() => columnHandle.current !== null, 'the column’s transcript to mount'); // C6's Transcript loads lazily
  useTranscriptStore.getState().expandAll(columnSource(session).key!, { cells: true });
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
  tree, // E7
  background,
  widget, // E7
  log,
  // E7 start (M7)
  tasks,
  scheduled,
  peerRows,
  columnTexts,
  pushTasks: (listId: string, list: PersistedTask[]) => fake.fakeFs({ tasks: { [listId]: list } }),
  setClock: (iso) => setAgentsClock(iso === null ? null : Date.parse(iso)),
  clearStatus,
  selectPhase: (n) => click(bodyOf('background')?.querySelectorAll('[data-view="run"] [role="option"]')[n], `phase option ${n}`),
  toggleFold: (parentId) => click(bodyOf('subagents')?.querySelector(`[data-fold="${CSS.escape(parentId)}"]`), `the fold under ${parentId}`),
  reply,
  openCreatingTurn: (id) => click(buttonNamed(bodyOf('background')?.querySelector(`[data-scheduled="${CSS.escape(id)}"]`), SCHEDULED_COPY.openTurn), `Open creating turn of ${id}`),
  // E7 end
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
  graph(id) {
    const entry = useTaskGraph.getState().entries.get(fakeId(id));
    return entry ? { phase: entry.phase, launchId: entry.launchId, lastSeq: entry.lastSeq } : null;
  },
  stopSettleMs: () => STOP_SETTLE_MS,
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
