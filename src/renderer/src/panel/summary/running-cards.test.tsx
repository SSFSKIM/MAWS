// The two cards for running work (UX wave U8b, M8; its execution document, Interfaces §D, §E and §F; A2): the Subagents
// card and the Background tasks card in the card column, on each route's source: a session MAWS runs (the task graph
// over the fake agent-work client), a terminal session this Mac drives (its jobs from its watch), and another machine's
// listed terminal session (its remote feed). The stores are the product singletons; the panel host's `addTool` is spied.
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Job } from 'desk-hub/protocol';
import { dateFormats } from '@shared/app/date-format';
import { LaunchSpecSchema } from '@shared/engine/launch-spec';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, AppSessionId, RequestId, TaskId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { GitStatus } from '@shared/ipc/schema/git';
import { addressOf, bareOf } from '@shared/machine/address';
import { item, record, remoteRow, status, T0 } from '../../../../../test/support/builders';
import { event } from '../../../../../test/support/agents-events';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { loadP5Journal } from '../../../../../test/support/fixtures';
import { OTHER_MACHINE } from '../../../../../test/support/machine';
import { SessionStatusTracker } from '../../../../engine-host/session-status';
import { queryClient } from '../../ipc/query';
import { laneAState } from '../../lane-a/test-support/lane-a-state';
import { resetLaneAWatches } from '../../lane-a/watches';
import { applyLaneAState, noteLaneAJobs, resetLaneAStore } from '../../stores/lane-a';
import { useAttention } from '../../stores/attention';
import { useSessions } from '../../stores/sessions';
import { A, resetPanelStores } from '../../test-support/panel';
import { preloadOf } from '../../test-support/preload-of';
import { setAgentWorkClient } from '../../tools/agents/client';
import { fakeAgentWorkClient, type FakeAgentWorkClient } from '../../tools/agents/fake-work-client';
import { applyTaskEvents, emptyGraph } from '../../tools/agents/model/task-graph';
import { useOpenAgents } from '../../tools/agents/open-agents';
import { registerRemoteTaskFeed, useTaskGraph } from '../../tools/agents/store';
import { subagentsTool, type SubagentsHandle, type SubagentsParams } from '../../tools/agents/subagents/SubagentsTool';
import type { PanelToolContext } from '../tool';
import { panelHost } from '../host';
import { Summary } from './Summary';

const T = '2026-09-29T10:00:00.000Z';
const at = (seconds: number) => new Date(Date.parse(T) + seconds * 1000).toISOString();
const DIR = `/work/${A}`;
const GIT: GitStatus = {
  repoRoot: DIR, gitDir: `${DIR}/.git`, commonDir: `${DIR}/.git`, isWorktree: false, branch: 'main', head: 'abcdef1234567', upstream: 'origin/main',
  remoteUrl: null, ahead: 0, behind: 0, dirty: false, stashCount: 0, checkedAt: T, files: [],
};

let fake: FakeAgentWorkClient;
let bridge: FakeClient;
let addTool: MockInstance<typeof panelHost.addTool>;
const offs: (() => void)[] = [];

const live = (over: Partial<EngineSessionStatus> = {}): EngineSessionStatus => ({ ...status(A), launchId: 'journal', ...over });
function seed(statusOfA: EngineSessionStatus | null, over: Partial<SessionRecord> = {}): void {
  useSessions.setState((s) => ({
    records: new Map([[A, record(A, over)]]),
    engine: statusOfA ? new Map([[A, statusOfA]]) : new Map(),
    digests: new Map(),
    recordsVersion: s.recordsVersion + 1,
    digestsVersion: s.digestsVersion + 1,
  }));
}

// The X1 frames the graph reads (as the panels' suites build them). Every agent and task is a background one.
const started = (taskId: string, seq: number, when = at(0)) => event('subagent.started', { taskId, toolUseId: `tu-${taskId}`, description: `Agent ${taskId}`, isBackground: true }, { seq, at: when });
const finished = (taskId: string, seq: number, over: Record<string, unknown> = {}, when = at(10)) => event('subagent.finished', { taskId, ...over }, { seq, at: when });
const dispatch = (issuer: string, toolUseId: string, seq: number) => event('tool.use', { toolUseId, toolName: 'Agent', input: {}, agentId: issuer }, { seq });
const nested = (parent: string, taskId: string, seq: number) => [dispatch(parent, `tu-${taskId}`, seq), started(taskId, seq + 1)];
const shellOf = (taskId: string, starter: string | null, seq: number) =>
  event('task.started', { taskId, toolUseId: `toolu_${taskId}`, taskType: 'local_bash', description: `Shell ${taskId}`, isBackground: true, ...(starter === null ? {} : { parentTaskId: starter }) }, { seq, at: at(0) });
const workflowOf = (taskId: string, seq: number) => event('task.started', { taskId, toolUseId: `toolu_${taskId}`, taskType: 'local_workflow', description: `Workflow ${taskId}`, isBackground: true, workflowName: 'review' }, { seq, at: at(0) });
const taskEnds = (taskId: string, seq: number, taskStatus = 'completed') => event('task.notification', { taskId, status: taskStatus }, { seq, at: at(40) });
const lastSeqOf = (events: SessionEvent[]) => Math.max(0, ...events.map((e) => e.seq ?? 0));
const push = (events: SessionEvent[]) => act(() => fake.batch(A, events));

const column = (id: AppSessionId = A) => (
  <QueryClientProvider client={queryClient}>
    <Summary appSessionId={id} />
  </QueryClientProvider>
);

// The column of a session MAWS runs, its graph's watch answered with these frames and an empty disk.
async function mount(events: SessionEvent[] = []) {
  seed(live());
  const view = render(column());
  await act(async () => {
    await fake.answer('events', { events, lastSeq: lastSeqOf(events), complete: true });
    await fake.answer('subagents', []);
    await fake.answer('workflows', []);
  });
  return view;
}

const card = (name: 'Subagents' | 'Background tasks') => screen.queryByRole('region', { name });
const cardNames = () => screen.queryAllByRole('region').filter((r) => r.tagName === 'SECTION').map((r) => r.getAttribute('aria-label'));
const headingOf = (name: 'Subagents' | 'Background tasks') => within(card(name)!).getByRole('heading').textContent;
const agentRow = (id: string) => card('Subagents')!.querySelector<HTMLElement>(`[data-agent-row="${id}"]`)!;
const disclosure = (id: string) => agentRow(id).querySelector<HTMLButtonElement>(':scope > [data-part="under"]');
const toggleUnder = (id: string) => fireEvent.click(disclosure(id)!);
const openRow = (id: string) => fireEvent.click(agentRow(id).querySelector<HTMLElement>(':scope > [data-part="open"]')!);
// The card's tree as drawn: each row by id and depth, with its disclosure's text (`▸` closed, `▾` open).
const tree = () =>
  Array.from(card('Subagents')?.querySelectorAll<HTMLElement>('[data-agent-row]') ?? []).map((row) => {
    const under = row.querySelector<HTMLElement>(':scope > [data-part="under"]');
    const mark = under === null ? '' : ` ${under.querySelector('[data-part="under-count"]')?.textContent ?? ''}${under.getAttribute('aria-expanded') === 'true' ? '▾' : '▸'}`;
    return `${'  '.repeat(Number(row.dataset.depth))}${row.dataset.agentRow}${mark}`;
  });
const lineOf = (id: string) => agentRow(id).querySelector<HTMLElement>('[data-part="line"]')!;
const taskRows = () => Array.from(card('Background tasks')?.querySelectorAll<HTMLElement>('[data-task-id]') ?? []).map((row) => row.dataset.taskId);
const button = (name: 'Subagents' | 'Background tasks', text: string) => within(card(name)!).getByRole('button', { name: text });

beforeEach(() => {
  resetPanelStores();
  fake = fakeAgentWorkClient();
  setAgentWorkClient(fake.client);
  useTaskGraph.setState({ entries: new Map() });
  useOpenAgents.setState({ open: new Map() });
  useAttention.setState((s) => ({ bySession: new Map(), version: s.version + 1 }));
  bridge = fakeClient({
    'git.watch': GIT, 'git.unwatch': undefined, 'layout.get': { value: null }, 'layout.set': undefined, 'laneA.watch': { watch: 'w1' }, 'laneA.unwatch': null,
    'session.observedFacts': { version: 1, appSessionId: bareOf(A), engineSessionId: null, writtenAt: T, source: 'journal', launches: [], engineVersion: null, model: null, effort: null, mode: null, outputStyle: null, plugins: null, contextUsage: null, complete: true },
  });
  window.maws = preloadOf(bridge);
  addTool = vi.spyOn(panelHost, 'addTool').mockReturnValue('running-cards-test');
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
  resetLaneAWatches();
  resetLaneAStore();
  useSessions.setState({ listed: new Map() });
  queryClient.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the Subagents card', () => {
  it('lists the running first-level agents, (+1) and its arrow on the one with an agent under it, and the child beneath it once that control is pressed', async () => {
    await mount([started('p', 1), started('q', 2), ...nested('p', 'c', 3)]);
    expect(cardNames()).toEqual(['Environment', 'Context', 'Connectors', 'Subagents']);
    expect(headingOf('Subagents')).toBe('Subagents 3 running');
    expect(tree()).toEqual(['p (+1)▸', 'q']);
    expect(disclosure('p')!.getAttribute('aria-label')).toBe('1 agent running under Agent p');
    toggleUnder('p');
    expect(tree()).toEqual(['p ▾', '  c', 'q']); // the arrow turned, the count gone
    expect(disclosure('p')!.getAttribute('aria-label')).toBe('Agents under Agent p');
    expect(agentRow('c').style.marginInlineStart).toBe('16px');
    expect(agentRow('c').className).toContain('border-l');
    expect(useOpenAgents.getState().open.get(A)).toEqual(new Set(['p'])); // the set the panel reads
    toggleUnder('p');
    expect(tree()).toEqual(['p (+1)▸', 'q']);
    expect(addTool).not.toHaveBeenCalled(); // no card opens a panel by itself, nor through its disclosure
  });

  it('a press on a row opens that agent in the Subagents panel and nothing beneath it; the row and its disclosure are two tab stops, the row first, and no other arrow', async () => {
    await mount([started('p', 1), started('q', 2), ...nested('p', 'c', 3)]);
    const stops = Array.from(agentRow('p').querySelectorAll('button'));
    expect(stops.map((b) => b.dataset.part)).toEqual(['open', 'under']);
    expect(stops.every((b) => b.getAttribute('tabindex') === null && b.parentElement === agentRow('p'))).toBe(true); // siblings, neither inside the other
    expect(agentRow('q').querySelectorAll('button')).toHaveLength(1); // nothing running under it: no count and no arrow
    expect(agentRow('q').querySelector('svg')).toBeNull();
    openRow('p');
    expect(addTool).toHaveBeenLastCalledWith('subagents', { appSessionId: A, params: { agentId: 'p', appSessionId: A } });
    expect(tree()).toEqual(['p (+1)▸', 'q']);
    openRow('q');
    expect(addTool).toHaveBeenLastCalledWith('subagents', { appSessionId: A, params: { agentId: 'q', appSessionId: A } });
    fireEvent.click(within(card('Subagents')!).getByRole('heading').querySelector('button')!);
    expect(addTool).toHaveBeenLastCalledWith('subagents', { appSessionId: A, params: { appSessionId: A } });
  });

  it('a nested agent with a running agent under it carries its own (+1); one with only a running shell under it carries none', async () => {
    await mount([started('p', 1), ...nested('p', 'c', 2), ...nested('c', 'g', 4), ...nested('p', 'd', 6), shellOf('sd', 'd', 8)]);
    expect(tree()).toEqual(['p (+3)▸']);
    toggleUnder('p');
    expect(tree()).toEqual(['p ▾', '  c (+1)▸', '  d']);
    toggleUnder('c');
    expect(tree()).toEqual(['p ▾', '  c ▾', '    g', '  d']);
    expect(agentRow('g').style.marginInlineStart).toBe('32px');
  });

  it('leaves an agent whose own run has ended with only a shell running, lists it again when woken, and keeps one with an agent running under it with its outcome word and (+1)', async () => {
    await mount([started('p', 1), shellOf('s1', 'p', 2), finished('p', 3, {}, at(30)), started('x', 4)]);
    expect(tree()).toEqual(['x']);
    expect(taskRows()).toEqual(['s1']); // its shell is a row of the Background tasks card
    push([started('p', 5, at(35))]); // the shell's notification wakes it: the same task id starts again
    expect(tree()).toEqual(['p', 'x']);
    push([...nested('p', 'c', 6), finished('p', 8, { status: 'failed' }, at(50))]);
    expect(tree()).toEqual(['p (+1)▸', 'x']);
    expect(lineOf('p').textContent).toBe('finished with errors');
    expect(lineOf('p').className).toContain('text-danger');
    expect(agentRow('p').querySelector('[data-part="elapsed"]')!.textContent).toBe('');
  });

  it('leaves the column when the last running agent ends, and the three cards above stay the same nodes', async () => {
    await mount([started('p', 1), started('q', 2), ...nested('p', 'c', 3)]);
    const above = ['Environment', 'Context', 'Connectors'].map((name) => screen.getByRole('region', { name }));
    push([finished('c', 5), finished('q', 6)]);
    expect(tree()).toEqual(['p']);
    push([finished('p', 7)]);
    expect(card('Subagents')).toBeNull();
    expect(cardNames()).toEqual(['Environment', 'Context', 'Connectors']);
    expect(['Environment', 'Context', 'Connectors'].map((name) => screen.getByRole('region', { name }))).toEqual(above);
    above.forEach((node, i) => expect(screen.getByRole('region', { name: ['Environment', 'Context', 'Connectors'][i] })).toBe(node));
  });

  it('draws four rows at most, then N more, which opens the panel', async () => {
    await mount(['a', 'b', 'c', 'd', 'e'].map((id, i) => started(id, i + 1)));
    expect(tree()).toEqual(['a', 'b', 'c', 'd']);
    fireEvent.click(button('Subagents', '1 more'));
    expect(addTool).toHaveBeenLastCalledWith('subagents', { appSessionId: A, params: { appSessionId: A } });
  });

  it('reads Approval needed in the warning colour on the row of an agent with a waiting request, and nothing else of it', async () => {
    await mount([started('p', 1), started('q', 2)]);
    act(() =>
      useAttention.setState((s) => ({
        bySession: new Map([[A, [item(A, 'permission', T0, { request: { requestId: 'req-q' as RequestId, toolUseId: null, taskId: null, agentId: 'q' as AgentId } })]]]),
        version: s.version + 1,
      })),
    );
    expect(lineOf('q').textContent).toBe('Approval needed');
    expect(lineOf('q').className).toContain('text-warning');
    expect(agentRow('q').textContent).not.toMatch(/waiting/);
    expect(lineOf('p').textContent).toBe('Working');
  });

  it('says nothing on a row of what runs under its agent, and cuts a long state line at its end', async () => {
    await mount([started('p', 1), shellOf('s1', 'p', 2), ...nested('p', 'c', 3), event('subagent.progress', { taskId: 'p', description: 'Reading a very long path name that cannot fit in a card of this width.ts' }, { seq: 5 })]);
    expect(lineOf('p').textContent).toBe('Reading a very long path name that cannot fit in a card of this width.ts');
    expect(lineOf('p').className).toContain('truncate');
    expect(card('Subagents')!.textContent).not.toMatch(/running under it|background task|nested ·|\d+ nested/);
  });

  it('N finished is the panel’s Done count and opens it with Done unfolded; an ended agent its shell keeps is in neither until the shell ends', async () => {
    await mount([started('r', 1), started('f1', 2), finished('f1', 3), started('f2', 4), finished('f2', 5), started('f3', 6), finished('f3', 7), started('k', 8), shellOf('sk', 'k', 9), finished('k', 10)]);
    expect(headingOf('Subagents')).toBe('Subagents 1 running');
    expect(button('Subagents', '3 finished')).toBeTruthy();
    const handle: SubagentsHandle = subagentsTool.createState({ appSessionId: A, session: useSessions.getState().records.get(A) ?? null, instanceId: 'subagents:test', params: undefined as unknown as SubagentsParams });
    offs.push(() => subagentsTool.dispose(handle));
    const ctx: PanelToolContext = { appSessionId: A, session: useSessions.getState().records.get(A) ?? null, status: useSessions.getState().engine.get(A) ?? null, pinned: false, visible: true, focusRequest: 0, setTitle: () => {}, close: () => {}, openTool: () => 'x', editorHost: { surface: 'panel', tabId: 'subagents:test' } };
    const Body = subagentsTool.render;
    const panel = render(<Body state={handle} ctx={ctx} />);
    const panelHeading = (name: string) => panel.container.querySelector(`[data-section="${name}"] h3`)?.textContent;
    expect([panelHeading('running'), panelHeading('done')]).toEqual(['Running 1', 'Done 3']);
    push([taskEnds('sk', 11)]);
    expect(button('Subagents', '4 finished')).toBeTruthy();
    expect(panelHeading('done')).toBe('Done 4');
    fireEvent.click(button('Subagents', '4 finished'));
    expect(addTool).toHaveBeenLastCalledWith('subagents', { appSessionId: A, params: { appSessionId: A, section: 'done' } });
  });

  it('repaints its coarse elapsed time on the slow tick, not within 29 seconds, and arms no interval of one second', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(at(110)));
    const intervals = vi.spyOn(globalThis, 'setInterval');
    await mount([started('p', 1)]);
    const elapsed = () => agentRow('p').querySelector('[data-part="elapsed"]')!.textContent;
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(elapsed()).toBe(dateFormats().age(110_000));
    await act(async () => vi.advanceTimersByTimeAsync(29_000));
    expect(elapsed()).toBe(dateFormats().age(110_000));
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(elapsed()).toBe(dateFormats().age(140_000));
    expect(intervals.mock.calls.filter(([, ms]) => ms === 1000)).toEqual([]);
  });
});

describe('the Background tasks card', () => {
  it('stands last while a shell runs, one row with its mark, description and coarse time; a press opens the panel at it; its end removes the card', async () => {
    await mount([shellOf('s1', null, 1)]);
    expect(cardNames()).toEqual(['Environment', 'Context', 'Connectors', 'Background tasks']);
    expect(headingOf('Background tasks')).toBe('Background tasks 1 running');
    expect(taskRows()).toEqual(['s1']);
    const row = card('Background tasks')!.querySelector<HTMLElement>('[data-task-id="s1"]')!;
    expect(row.querySelector('[data-kind-mark="shell"]')).toBeTruthy();
    expect(row.querySelector('[data-part="description"]')!.textContent).toBe('Shell s1');
    expect(within(card('Background tasks')!).queryByRole('button', { name: /Stop/ })).toBeNull();
    fireEvent.click(row);
    expect(addTool).toHaveBeenLastCalledWith('background', { appSessionId: A, params: { taskId: 's1', appSessionId: A } });
    const above = screen.getByRole('region', { name: 'Connectors' });
    push([taskEnds('s1', 2, 'stopped')]);
    expect(card('Background tasks')).toBeNull();
    expect(screen.getByRole('region', { name: 'Connectors' })).toBe(above);
  });

  it('opens a workflow at its run, lists every kind in start order after Subagents, and its N finished is the panel’s Done count', async () => {
    await mount([started('p', 1), workflowOf('w1', 2), shellOf('s1', null, 3), shellOf('s0', null, 4), taskEnds('s0', 5), event('task.started', { taskId: 'm1', taskType: 'monitor_ws', description: 'Monitor m1', isBackground: true }, { seq: 6, at: at(0) })]);
    expect(cardNames()).toEqual(['Environment', 'Context', 'Connectors', 'Subagents', 'Background tasks']);
    expect(taskRows()).toEqual(['w1', 's1', 'm1']);
    fireEvent.click(card('Background tasks')!.querySelector<HTMLElement>('[data-task-id="w1"]')!);
    expect(addTool).toHaveBeenLastCalledWith('background', { appSessionId: A, params: { taskId: 'w1', view: 'run', appSessionId: A } });
    fireEvent.click(button('Background tasks', '1 finished'));
    expect(addTool).toHaveBeenLastCalledWith('background', { appSessionId: A, params: { appSessionId: A, section: 'done' } });
    fireEvent.click(within(card('Background tasks')!).getByRole('heading').querySelector('button')!);
    expect(addTool).toHaveBeenLastCalledWith('background', { appSessionId: A, params: { appSessionId: A } });
  });

  it('gives no card for a scheduled job alone', async () => {
    seed(live({ work: { crons: [{ id: 'c1', schedule: '*/5 * * * *', recurring: true, prompt: 'check the build' }], unknown: null } }));
    render(column());
    await act(async () => {
      await fake.answer('events', { events: [], lastSeq: 0, complete: true });
      await fake.answer('subagents', []);
      await fake.answer('workflows', []);
    });
    expect(card('Background tasks')).toBeNull();
    expect(cardNames()).toEqual(['Environment', 'Context', 'Connectors']);
  });

  it('a terminal session this Mac drives: its running job gives the card, from its watch, and its end removes it; there is no Subagents card', async () => {
    const job = (taskId: string, over: Partial<Job> = {}): Job => ({ taskId, kind: 'shell', toolUseId: `toolu_${taskId}`, startedAt: T, description: `run ${taskId}`, command: 'sleep 60', outputFile: `/tmp/${taskId}.output`, status: 'running', ...over });
    const plane = (kind: 'snapshot' | 'subagents', jobs: Job[]) =>
      act(() => bridge.event('laneA.plane', { appSessionId: bareOf(A), watch: 'w1', messages: [{ project: '', machine: 'm', session: `eng-${A}`, kind, sub: 'w1', n: kind === 'snapshot' ? 0 : 1, body: kind === 'snapshot' ? { streaming: [], usage: null, jobs } : { subagents: [], jobs, mcp: [] } }] }));
    seed(null, { holder: { kind: 'terminal', pid: 4242 } });
    applyLaneAState(A, laneAState(A));
    render(column());
    await act(async () => {
      await fake.answer('subagents', []);
      await fake.answer('workflows', []);
    });
    await waitFor(() => expect(bridge.invoked('laneA.watch')).toEqual([{ appSessionId: bareOf(A) }]));
    expect(card('Background tasks')).toBeNull();
    plane('snapshot', [job('bsleep01'), job('bdone02', { status: 'completed', endedAt: T })]);
    expect(taskRows()).toEqual(['bsleep01']);
    expect(button('Background tasks', '1 finished')).toBeTruthy();
    expect(card('Subagents')).toBeNull();
    plane('subagents', [job('bsleep01', { status: 'stopped', endedAt: T }), job('bdone02', { status: 'completed', endedAt: T })]);
    expect(card('Background tasks')).toBeNull();
  });

  it('another machine’s listed terminal session gives both cards from its feed', async () => {
    const REMOTE = addressOf(OTHER_MACHINE, 'eng-r' as AppSessionId);
    useSessions.setState({ listed: new Map([[REMOTE, { ...remoteRow(OTHER_MACHINE, 'eng-r', { lane: 'A', availability: 'foreign_held' }), appId: REMOTE }]]) });
    applyLaneAState(REMOTE, laneAState(REMOTE, { engineSessionId: 'eng-r', turn: { running: true, unknown: false } }));
    offs.push(registerRemoteTaskFeed((id) => (id === REMOTE ? (onGraph) => (onGraph(applyTaskEvents(emptyGraph(), [started('r1', 1), ...nested('r1', 'r2', 2)])), () => {}) : null)));
    render(column(REMOTE));
    await act(async () => {});
    expect(cardNames()).toEqual(['Subagents']);
    expect(tree()).toEqual(['r1 (+1)▸']);
    act(() => noteLaneAJobs(REMOTE, [{ taskId: 'bremote1', kind: 'shell', toolUseId: 'toolu_bremote1', startedAt: T, description: 'run the suites', outputFile: null, status: 'running' }]));
    expect(cardNames()).toEqual(['Subagents', 'Background tasks']);
    expect(taskRows()).toEqual(['bremote1']);
  });
});

// UX wave U8b (M9; Decision Log 10): a task's type in both vocabularies, the listing's task types and the labels the
// engine's Stop callback writes, read through `kindOf` on the path the cards read: the status's list applied to the
// session's graph. Moved here from `panel/summary/derive.test.ts` with `backgroundCounts`, the old card's reader.
describe('a task named by its type or by the Stop’s label', () => {
  const drawn = () => ({ cards: cardNames(), subagents: headingOf('Subagents'), background: headingOf('Background tasks'), agents: tree(), tasks: taskRows(), marks: Array.from(card('Background tasks')!.querySelectorAll<HTMLElement>('[data-kind-mark]')).map((el) => el.dataset.kindMark) });
  async function mountListing(backgroundTasks: EngineSessionStatus['backgroundTasks']) {
    seed(live({ backgroundTasks }));
    render(column());
    await act(async () => {
      await fake.answer('events', { events: [], lastSeq: 0, complete: true });
      await fake.answer('subagents', []);
      await fake.answer('workflows', []);
    });
  }
  const listed = (pairs: [string, string][]): EngineSessionStatus['backgroundTasks'] => pairs.map(([taskId, taskType]) => ({ taskId: taskId as TaskId, taskType, description: `Task ${taskId}`, ambient: false }));
  const ALIKE = { cards: ['Environment', 'Context', 'Connectors', 'Subagents', 'Background tasks'], subagents: 'Subagents 1 running', background: 'Background tasks 4 running', agents: ['a1'], tasks: ['b1', 'w1', 'm1', 'x1'], marks: ['shell', 'workflow', 'monitor', 'other'] };

  it.each([
    ['the task types', [['b1', 'local_bash'], ['w1', 'local_workflow'], ['m1', 'monitor_mcp'], ['x1', 'mcp_task'], ['a1', 'local_agent']]],
    ['the Stop’s labels', [['b1', 'shell'], ['w1', 'workflow'], ['m1', 'monitor'], ['x1', 'MCP task'], ['a1', 'subagent']]],
  ] as [string, [string, string][]][])('a list in %s gives the same two cards: the agent a Subagents row, each task its kind’s row and mark', async (_, pairs) => {
    await mountListing(listed(pairs));
    expect(drawn()).toEqual(ALIKE);
  });

  // The same two tasks, listed at p5/p5-o16-holder-main seq 145 and named by the Stop at seq 162, as the status holds them.
  it.each(['listing', 'stop'] as const)('a status from the recorded %s draws one agent and one shell', async (which) => {
    const rows = loadP5Journal('p5-o16-holder-main');
    const frameAt = (seq: number) => rows.find((row) => row.seq === seq)!.frame as Record<string, unknown>;
    const spec = LaunchSpecSchema.parse({
      appSessionId: 'app-labels', cwd: '/tmp/r', additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
      resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, inheritGrantsFrom: null, replay: null,
    });
    const tracker = which === 'listing' ? new SessionStatusTracker(spec, () => {}) : new SessionStatusTracker(spec, () => {}, { launchKind: 'adopted' });
    if (which === 'listing') tracker.observe(frameAt(145), '2026-10-31T00:00:00.000Z');
    else tracker.stopped((frameAt(162).request as { input: Record<string, unknown> }).input);
    const tasks = tracker.snapshot().backgroundTasks;
    expect(tasks.map((t) => t.taskType)).toEqual(which === 'listing' ? ['local_bash', 'local_agent'] : ['shell', 'subagent']); // the status keeps the engine's words
    await mountListing(tasks);
    expect(drawn()).toMatchObject({ subagents: 'Subagents 1 running', background: 'Background tasks 1 running', agents: ['a75a34c79539c9b3c'], tasks: ['bzgk2epjt'], marks: ['shell'] });
  });
});
