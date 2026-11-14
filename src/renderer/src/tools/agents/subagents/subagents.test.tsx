// The Subagents tool (C8b execution document, M2): the three lists over a seeded task-graph store, the drill-in over
// C6's child source with C7's inline card, the relay composer's regime and its pending line, the tool's X5 pins, the
// summary section and the `openSubagent` adapter. The stores are the product singletons over the fake agent-work
// client (`setAgentWorkClient`); C5's sessions and attention stores are seeded directly.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, AppSessionId, RequestId, TaskId, ToolUseId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { at as address, TEST_MACHINE } from '../../../../../../test/support/machine';
import type { SubagentEntry, WorkflowRun } from '@shared/ipc/schema/fs';
import { digest, item, record, status } from '../../../../../../test/support/builders';
import { event, recordedTeamListing, replayed, sidecarsOf, workflowRunsOf } from '../../../../../../test/support/agents-events';
import { connectKeys } from '../../../keymap/dispatcher';
import { instanceOf, panelHost } from '../../../panel/host';
import type { PanelToolContext } from '../../../panel/tool';
import { RELAY_LONG_WAIT_MS } from '../../../relay-wait';
import { itemFor, permission } from '../../../request-card/test-requests';
import { useAttention } from '../../../stores/attention';
import { useSessions } from '../../../stores/sessions';
import { A as HOST_A, panelOf, resetPanelStores } from '../../../test-support/panel';
import { ipcSource, registerTranscriptActions, useTranscriptStore, type SubagentRef } from '../../../transcript';
import { builder, request, tool } from '../../../transcript/model/test-events';
import { setAgentWorkClient } from '../client';
import { fakeAgentWorkClient, type FakeAgentWorkClient } from '../fake-work-client';
import { agentTranscriptActions, registerAgentTools } from '../index';
import { relayText } from '../model/relay';
import { useRelays } from '../relay-store';
import { useTaskGraph } from '../store';
import { useOpenAgents } from '../open-agents';
import { SubagentsSummary } from './SubagentsSummary';
import type { BackgroundHandle } from '../background/BackgroundTool';
import { subagentsTool, type SubagentsHandle, type SubagentsParams } from './SubagentsTool';
import { REL } from '../../../test-support/relative-time';
import { laneAState } from '../../../lane-a/test-support/lane-a-state'; // P5 O9
import { applyLaneAState, resetLaneAStore } from '../../../stores/lane-a'; // P5 O9
import { STOP_DOUBT_MS } from './shared'; // P5 O9
import { addressOf } from '@shared/machine/address'; // P5 O9 M9
import type { LaneAState } from '@shared/ipc/schema/lane-a'; // P5 O9 M9
import { remoteRow } from '../../../../../../test/support/builders'; // P5 O9 M9
import { OTHER_MACHINE } from '../../../../../../test/support/machine'; // P5 O9 M9
import { LANE_A_WORDS } from '../../../session/controls/lane-a'; // P5 O9 M9
import { useMachines } from '../../../stores/machines'; // 2026-11-06

const M3 = REL.agoNarrow(3, 'minute'); // 3m ago, 3분 전

// K2's test: the drill-in reaches the child through C6's `ipcSource` and builds nothing of its own.
// The spy is made once, outside the async factory (P2-F S): vitest runs an async factory again for an importer that
// arrives before it resolves, and a spy made inside it would leave the code and this file holding different ones.
const ipcSourceSpy = vi.hoisted(() => vi.fn<typeof ipcSource>());
vi.mock('../../../transcript', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../transcript')>();
  return { ...actual, ipcSource: ipcSourceSpy.mockImplementation(actual.ipcSource) };
});

const A = address('A' as AppSessionId);
const B = address('B' as AppSessionId);
const TITLE = 'Fix drag';
const T = '2026-09-29T10:00:00.000Z';
const at = (seconds: number) => new Date(Date.parse(T) + seconds * 1000).toISOString();

let fake: FakeAgentWorkClient;
// Every tab state a test creates, disposed after it: the task-graph store is the product singleton, and a watch left
// behind would make the next test's watch a second watcher that reads nothing.
const handles: SubagentsHandle[] = [];
const create = (params: SubagentsParams | undefined, appSessionId: AppSessionId = A) => {
  const handle = subagentsTool.createState({ appSessionId, session: useSessions.getState().records.get(appSessionId) ?? null, instanceId: 'subagents:test', params: params as SubagentsParams });
  handles.push(handle);
  return handle;
};

const live = (over: Partial<EngineSessionStatus> = {}): EngineSessionStatus => ({ ...status(A), launchId: 'journal', ...over });
const openTurn = { id: 'app:journal:1:0', origin: 'human', startedAt: T, acceptedAt: T, userMessageUuids: [] } as unknown as EngineSessionStatus['turn'];

function seedSessions(statusOfA: EngineSessionStatus | null): void {
  useSessions.setState((s) => ({
    records: new Map([
      [A, record(A, { title: { text: TITLE, source: 'user' } })],
      [B, record(B, { title: { text: 'Other session', source: 'user' } })],
    ]),
    engine: statusOfA ? new Map([[A, statusOfA]]) : new Map(),
    digests: new Map(),
    recordsVersion: s.recordsVersion + 1,
    digestsVersion: s.digestsVersion + 1,
  }));
}

function setStatus(next: EngineSessionStatus | null, id: AppSessionId = A): void {
  act(() =>
    useSessions.setState((s) => {
      const engine = new Map(s.engine);
      if (next) engine.set(id, next);
      else engine.delete(id);
      return { engine };
    }),
  );
}

// Builders for the X1 frames the lists read. Every started agent is a background one unless told otherwise.
const started = (taskId: string, seq: number, over: Record<string, unknown> = {}, when = at(0)) =>
  event('subagent.started', { taskId, toolUseId: `tu-${taskId}`, description: `Agent ${taskId}`, isBackground: true, ...over }, { seq, at: when });
const finished = (taskId: string, seq: number, over: Record<string, unknown> = {}, when = at(10)) => event('subagent.finished', { taskId, ...over }, { seq, at: when });
const dispatch = (issuer: string, toolUseId: string, seq: number) => event('tool.use', { toolUseId, toolName: 'Agent', input: {}, agentId: issuer }, { seq });
const lastSeqOf = (events: SessionEvent[]) => Math.max(0, ...events.map((e) => e.seq ?? 0));

function Mounted({ state, appSessionId = A, visible = true }: { state: SubagentsHandle; appSessionId?: AppSessionId | null; visible?: boolean }) {
  const session = useSessions((s) => (appSessionId ? (s.records.get(appSessionId) ?? null) : null));
  const engine = useSessions((s) => (appSessionId ? (s.engine.get(appSessionId) ?? null) : null));
  const ctx: PanelToolContext = {
    appSessionId, session, status: engine, pinned: false, visible, focusRequest: 0, setTitle: () => {}, close: () => {}, openTool: panelHost.addTool,
    editorHost: { surface: 'panel', tabId: 'subagents:test' },
  };
  const Body = subagentsTool.render;
  return <Body state={state} ctx={ctx} />;
}

interface MountOptions {
  status?: EngineSessionStatus | null;
  events?: SessionEvent[];
  sidecars?: SubagentEntry[];
  runs?: WorkflowRun[];
  params?: SubagentsParams;
  visible?: boolean;
}

// The tool as the host creates it for session A, its store watch answered with the given wire and disk halves.
async function mount(opts: MountOptions = {}) {
  const engine = opts.status === undefined ? live() : opts.status;
  seedSessions(engine);
  const handle = create(opts.params);
  const view = render(<Mounted state={handle} visible={opts.visible ?? true} />);
  await act(async () => {
    if (engine) await fake.answer('events', { events: opts.events ?? [], lastSeq: lastSeqOf(opts.events ?? []), complete: true });
    await fake.answer('subagents', opts.sidecars ?? []);
    await fake.answer('workflows', opts.runs ?? []);
  });
  return { handle, ...view };
}

// A second mount in one test: the first tab's watch released and the store emptied, as a fresh session would find it.
function unmountAll(): void {
  cleanup();
  handles.splice(0).forEach((handle) => subagentsTool.dispose(handle));
  useTaskGraph.setState({ entries: new Map() });
}

const push = (events: SessionEvent[]) => act(() => fake.batch(A, events));
type Section = 'running' | 'done' | 'disk'; // the UX wave's U8b (M7): Running, Done and On disk
const section = (name: Section) => document.querySelector<HTMLElement>(`[data-section="${name}"]`);
const rowsOf = (name: Section) =>
  Array.from(section(name)?.querySelectorAll<HTMLElement>('[data-agent-row]') ?? []).map((row) => ({
    id: row.dataset.agentRow,
    depth: Number(row.dataset.depth),
    title: row.querySelector('[data-part="title"]')?.textContent,
    line: row.querySelector('[data-part="line"]')?.textContent,
    elapsed: row.querySelector('[data-part="elapsed"]')?.textContent,
    nested: row.querySelector<HTMLElement>('[data-part="nested"]')?.title ?? null,
    waiting: row.dataset.waiting !== undefined,
    under: underOf(row.dataset.agentRow!),
  }));
const heading = (name: Section) => section(name)?.querySelector('h3')?.textContent;
// E7: every row of a section as shown, by kind: agents by id and depth (the UX wave's U8b: with its disclosure's text,
// `▸` closed and `▾` open), a fold by its count and whether it is open, the team header and a roster teammate by their
// text.
const treeOf = (name: Section) =>
  Array.from(section(name)?.querySelectorAll<HTMLElement>('[data-agent-row], [data-fold], [data-team], [data-roster]') ?? []).map((el) =>
    el.dataset.agentRow !== undefined
      ? `${'  '.repeat(Number(el.dataset.depth))}${el.dataset.agentRow}${underText(el.dataset.agentRow)}`
      : el.dataset.fold !== undefined
        ? `${'  '.repeat(Number(el.dataset.depth))}[${el.textContent}${el.getAttribute('aria-expanded') === 'true' ? ' open' : ''}]`
        : `${'  '.repeat(Number(el.dataset.depth))}${el.textContent}`,
  );
const expandDone = () => fireEvent.click(within(section('done')!).getByRole('button', { name: /^Done \d+/ })); // Done is folded by default
const row = (id: string) => document.querySelector<HTMLElement>(`[data-agent-row="${id}"]`)!;
const openRow = (id: string) => fireEvent.click(row(id).querySelector<HTMLElement>(':scope > [data-part="open"]')!);
// The UX wave's U8b (M7 decision 4): a row's disclosure, `(+N)` and its arrow, a control of its own.
const disclosure = (id: string) => row(id).querySelector<HTMLButtonElement>(':scope > [data-part="under"]');
const underOf = (id: string) => {
  const under = disclosure(id);
  return under === null ? null : { count: under.querySelector('[data-part="under-count"]')?.textContent ?? '', expanded: under.getAttribute('aria-expanded') === 'true' };
};
const underText = (id: string) => {
  const under = underOf(id);
  return under === null ? '' : ` ${under.count}${under.expanded ? '▾' : '▸'}`;
};
const toggleUnder = (id: string) => fireEvent.click(disclosure(id)!);
// a shell an agent started (the engine's `parent_task_id`, M5)
const shellOf = (taskId: string, starter: string | null, seq: number) =>
  event('task.started', { taskId, toolUseId: `toolu_${taskId}`, taskType: 'local_bash', description: `Shell ${taskId}`, isBackground: true, ...(starter === null ? {} : { parentTaskId: starter }) }, { seq, at: at(0) });
const shellEnds = (taskId: string, seq: number) => event('task.notification', { taskId, status: 'completed' }, { seq, at: at(40) });

beforeEach(() => {
  fake = fakeAgentWorkClient();
  setAgentWorkClient(fake.client);
  useTaskGraph.setState({ entries: new Map() });
  useAttention.setState((s) => ({ bySession: new Map(), version: s.version + 1 }));
  useOpenAgents.setState({ open: new Map() });
  installBridge([]); // C6's child source reads main through the validated bridge; a drill-in test installs its own stream
});

afterEach(() => {
  cleanup();
  handles.splice(0).forEach((handle) => subagentsTool.dispose(handle));
  for (const key of [...useRelays.getState().relays.keys()]) useRelays.getState().dismiss(key);
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key); // E7: a teammates case attaches A's transcript
  setAgentWorkClient(null);
  vi.useRealTimers();
});

describe('subagents lists', () => {
  // The UX wave's U8b (M7; Interfaces §F): Running N, Done N folded, On disk N folded.
  it('heads Running N, eight rows shown; Done folded by default, ten shown once opened; Show N more', async () => {
    const running = Array.from({ length: 10 }, (_, i) => started(`r${i}`, i + 1));
    const ended = Array.from({ length: 12 }, (_, i) => [started(`d${i}`, 20 + 2 * i), finished(`d${i}`, 21 + 2 * i, {}, at(100 + i))]).flat();
    await mount({ events: [...running, ...ended] });
    expect(heading('running')).toBe('Running 10');
    expect(section('running')!.querySelector('h3 [data-part="detail"]')?.className).toContain('text-fg-muted'); // the count muted, the label the heading's weight
    expect(rowsOf('running').map((r) => r.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7']);
    expect(heading('done')).toBe('Done 12');
    expect(within(section('done')!).getByRole('button', { name: 'Done 12' }).getAttribute('aria-expanded')).toBe('false');
    expect(rowsOf('done')).toEqual([]);
    expandDone();
    expect(rowsOf('done')).toHaveLength(10);
    expect(rowsOf('done')[0].id).toBe('d11'); // newest end first
    fireEvent.click(within(section('running')!).getByRole('button', { name: 'Show 2 more' }));
    expect(rowsOf('running')).toHaveLength(10);
    fireEvent.click(within(section('done')!).getByRole('button', { name: 'Show 2 more' }));
    expect(rowsOf('done')).toHaveLength(12);
    expect(screen.getByText('Live activity · includes nested agents')).toBeTruthy();
  });

  it('lists first-level agents only; (+1) opens the child beneath its parent, the arrow turned and the count gone, and a second press hides it', async () => {
    const { handle } = await mount({ events: [started('p', 1), dispatch('p', 'tu-c', 2), started('c', 3)] });
    expect(heading('running')).toBe('Running 2'); // every running agent, the nested one included
    expect(treeOf('running')).toEqual(['p (+1)▸']);
    expect(disclosure('p')!.getAttribute('aria-label')).toBe('1 agent running under Agent p');
    toggleUnder('p');
    expect(treeOf('running')).toEqual(['p ▾', '  c']);
    expect(disclosure('p')!.getAttribute('aria-label')).toBe('Agents under Agent p');
    expect(rowsOf('running')[1]).toMatchObject({ id: 'c', depth: 1, nested: null, line: 'Working', under: null });
    toggleUnder('p');
    expect(treeOf('running')).toEqual(['p (+1)▸']);
    toggleUnder('p');
    // the child finishes: folded under its running parent's Done · 1, as before
    push([finished('c', 4, {}, at(20))]);
    expect(heading('running')).toBe('Running 1');
    expect(treeOf('running')).toEqual(['p ▾', '  [Done · 1]']);
    fireEvent.click(within(section('running')!).getByRole('button', { name: 'Done · 1 under Agent p' }));
    expect(treeOf('running')).toEqual(['p ▾', '  [Done · 1 open]', '  c']);
    expect(rowsOf('running')[1]).toMatchObject({ id: 'c', depth: 1, line: expect.stringMatching(/^finished · /), elapsed: '' });
    expect(handle.snapshot().expandedFolds).toEqual(new Set(['p']));
    // both finished: Done lists the first level, the child reached by opening its parent
    push([finished('p', 5, {}, at(30))]);
    expect(section('running')).toBeNull();
    expect(heading('done')).toBe('Done 1');
    expandDone();
    expect(treeOf('done')).toEqual(['p ▾', '  c']);
    toggleUnder('p');
    expect(treeOf('done')).toEqual(['p ▸']); // all finished: the arrow alone, no count
  });

  it('opens the same rows in a second mounted reader: the open parents are one set per session', async () => {
    await mount({ events: [started('p', 1), dispatch('p', 'tu-c', 2), started('c', 3)] });
    const second = create(undefined);
    const other = render(<Mounted state={second} />);
    const both = () => Array.from(document.querySelectorAll<HTMLElement>('[data-agent-row]')).map((el) => el.dataset.agentRow);
    expect(both()).toEqual(['p', 'p']);
    fireEvent.click(document.querySelector<HTMLElement>('[data-agent-row="p"] > [data-part="under"]')!);
    expect(both()).toEqual(['p', 'c', 'p', 'c']);
    expect(useOpenAgents.getState().open.get(A)).toEqual(new Set(['p']));
    other.unmount();
  });

  it('a press on the row opens its drill-in and nothing beneath it; the row and its disclosure are two tab stops, the row first', async () => {
    const { handle } = await mount({ events: [started('p', 1), dispatch('p', 'tu-c', 2), started('c', 3)] });
    const stops = Array.from(row('p').querySelectorAll('button'));
    expect(stops.map((b) => b.dataset.part)).toEqual(['open', 'under']);
    expect(stops.every((b) => b.getAttribute('tabindex') === null && b.parentElement === row('p'))).toBe(true); // siblings, neither inside the other, both in the tab order
    openRow('p');
    expect(handle.snapshot().view).toEqual({ kind: 'agent', agentId: 'p' });
    expect(useOpenAgents.getState().open.get(A)).toBeUndefined();
  });

  it('keeps an agent whose own run has ended under Running while an agent under it runs, its outcome word without a time beside (+1)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse(at(60)));
    await mount({
      events: [started('p', 1), dispatch('p', 'tu-c', 2), started('c', 3), dispatch('p', 'tu-d', 4), started('d', 5), finished('d', 6, {}, at(20)), finished('p', 7, {}, at(30))],
    });
    expect(heading('running')).toBe('Running 1');
    expect(treeOf('running')).toEqual(['p (+1)▸']);
    expect(rowsOf('running')[0]).toMatchObject({ line: 'finished', elapsed: '' });
    toggleUnder('p');
    expect(treeOf('running')).toEqual(['p ▾', '  c', '  d']); // a parent that does not run lists its finished children
    expect(rowsOf('running').map((r) => [r.id, r.elapsed, r.line])).toEqual([
      ['p', '', 'finished'],
      ['c', '1m 00s', 'Working'],
      ['d', '', `finished · ${REL.now}`],
    ]);
    expect(section('done')).toBeNull();
  });

  // Item 359 (M7 decision 5): a task the agent started keeps it under Running, said in words; the heading counts
  // agents only.
  it('keeps an ended agent under Running by its shell: finished · 1 background task running, the heading with no number, until the shell ends', async () => {
    await mount({ events: [started('p', 1), shellOf('s1', 'p', 2), finished('p', 3, {}, at(30))] });
    expect(heading('running')).toBe('Running'); // no agent runs: no number, never "Running 0"
    expect(rowsOf('running')).toEqual([expect.objectContaining({ id: 'p', line: 'finished · 1 background task running', elapsed: '', under: null })]);
    expect(row('p').querySelector('[data-part="tasks"]')?.className).toContain('shrink-0'); // the words about its tasks are never the part cut
    expect(row('p').querySelector('[data-part="state"]')?.className).not.toContain('truncate');
    push([shellOf('s2', 'p', 4)]);
    expect(rowsOf('running')[0].line).toBe('finished · 2 background tasks running');
    // two agents run beside it: the heading counts them, the card's number
    push([started('x', 5), started('y', 6)]);
    expect(heading('running')).toBe('Running 2');
    expect(rowsOf('running').map((r) => r.id)).toEqual(['p', 'x', 'y']);
    // a nested agent runs under it as well: the same words beside (+1)
    push([dispatch('p', 'tu-n', 7), started('n', 8)]);
    expect(treeOf('running')[0]).toBe('p (+1)▸');
    expect(rowsOf('running')[0].line).toBe('finished · 2 background tasks running');
    push([finished('n', 9, {}, at(35)), shellEnds('s1', 10), shellEnds('s2', 11)]);
    expect(rowsOf('running').map((r) => r.id)).toEqual(['x', 'y']);
    expect(heading('done')).toBe('Done 1');
    expect(document.body.textContent).not.toMatch(/running under it|nested ·|\d+ nested/);
  });

  it('reads a running agent with a shell and a nested agent running as (+1), and no word about the shell', async () => {
    await mount({ events: [started('p', 1), shellOf('s1', 'p', 2), dispatch('p', 'tu-c', 3), started('c', 4)] });
    expect(treeOf('running')).toEqual(['p (+1)▸']);
    expect(rowsOf('running')[0].line).toBe('Working');
  });

  it('an ended agent kept under Running reads finished with errors in the danger colour, or stopped', async () => {
    await mount({ events: [started('bad', 1), shellOf('s1', 'bad', 2), finished('bad', 3, { status: 'failed' }), started('halt', 4), shellOf('s2', 'halt', 5), finished('halt', 6, { status: 'stopped' })] });
    expect(rowsOf('running').map((r) => r.line)).toEqual(['finished with errors · 1 background task running', 'stopped · 1 background task running']);
    expect(row('bad').querySelector('[data-part="state"]')?.className).toContain('text-danger');
    expect(row('bad').querySelector('[data-part="tasks"]')?.className ?? '').not.toContain('text-danger');
    expect(row('halt').querySelector('[data-part="state"]')?.className).toContain('text-fg-muted');
  });

  it('heads Done with what did not complete: Done 3 · 1 failed · 1 stopped; a kind of zero is left out', async () => {
    await mount({ events: [started('ok', 1), finished('ok', 2), started('bad', 3), finished('bad', 4, { status: 'failed' }), started('halt', 5), finished('halt', 6, { status: 'stopped' })] });
    expect(heading('done')).toBe('Done 3 · 1 failed · 1 stopped');
    unmountAll();
    await mount({ events: [started('ok', 1), finished('ok', 2), started('bad', 3), finished('bad', 4, { status: 'failed' })] });
    expect(heading('done')).toBe('Done 2 · 1 failed');
  });

  it('open({ section: "done" }) shows the lists with Done unfolded and changes no other fold', async () => {
    const { handle } = await mount({ events: [started('a1', 1), started('ok', 2), finished('ok', 3)], params: { agentId: 'a1' as AgentId } });
    act(() => handle.toggle('running')); // folded by the person
    act(() => subagentsTool.open!(handle, { section: 'done' }));
    expect(handle.snapshot()).toMatchObject({ view: { kind: 'lists' }, expanded: { running: false, done: true, disk: false } });
    expect(rowsOf('done').map((r) => r.id)).toEqual(['ok']);
  });

  it('folds On disk over the nested-agents sidecars of a disk-only session, with status unavailable and the header line', async () => {
    await mount({ status: null, sidecars: sidecarsOf('pass3/nested-agents-sidecars') });
    expect(heading('disk')).toBe('On disk 2');
    expect(rowsOf('disk')).toEqual([]);
    fireEvent.click(within(section('disk')!).getByRole('button', { name: 'On disk 2' }));
    expect(rowsOf('disk').map((r) => [r.title, r.depth, r.line, r.under])).toEqual([
      ['Outer agent dispatching inner', 0, 'status unavailable', null],
      ['Inner reads one.txt', 1, 'status unavailable', null],
    ]);
    expect(screen.getByText('Status is known only while the session runs here')).toBeTruthy();
    expect(section('running')).toBeNull();
    expect(screen.queryByText('Live activity · includes nested agents')).toBeNull();
  });

  it('marks a child whose parent is known only on disk as an orphan root, its tooltip naming the parent (Decision Log 19)', async () => {
    const [outer] = sidecarsOf('pass3/nested-agents-sidecars');
    await mount({ events: [dispatch(outer.agentId, 'tu-c', 1), started('c', 2)], sidecars: [outer] });
    expect(rowsOf('running')).toEqual([expect.objectContaining({ id: 'c', depth: 0, nested: 'Child of Outer agent dispatching inner' })]);
    expect(row('c').querySelector('[data-part="nested"]')?.textContent).toBe('· nested');
    fireEvent.click(within(section('disk')!).getByRole('button', { name: 'On disk 1' }));
    expect(rowsOf('disk')).toEqual([expect.objectContaining({ id: outer.agentId, depth: 0, nested: null })]);
  });

  it('marks a child of an agent the session does not list', async () => {
    await mount({ events: [dispatch('ghost', 'tu-c', 1), started('c', 2)] });
    expect(rowsOf('running')).toEqual([expect.objectContaining({ id: 'c', depth: 0, nested: 'Child of an agent this session does not list' })]);
  });

  // E7 (Design §5; Decision Log 7, 24): a hand-built roster, for what the one recorded team (below) does not hold: a
  // teammate no agent matches, drawn as a roster row.
  it('groups the running teammates the newest listing names under Team · led by this session, a teammate no agent matches as a roster row, in one labelled group', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const b = builder();
    b.turn('u1');
    b.toolUse('l1', 'ListAgents', {});
    b.result('l1', [
      'This session is lead [aa11bb] — the name other sessions use to message it (it is not listed below; a message to it would be a message to yourself).', '',
      'Teammates (2):', '  researcher [9c1f00]  ·  Explore  ·  in-process  ·  joined 1m ago', '  tester  ·  general-purpose  ·  idle  ·  joined 2m ago',
    ].join('\n'));
    const listedAt = b.events.find((e) => e.kind === 'tool.use')!.at;
    vi.setSystemTime(Date.parse(listedAt) + 120_000);
    await act(() => useTranscriptStore.getState().attach(A, { subscribe: () => () => {}, snapshot: () => Promise.resolve(b.events) }));
    const [one] = sidecarsOf('subagent-sidecars');
    await mount({ events: [started('solo', 1), started(one.agentId, 2)], sidecars: [{ ...one, meta: { ...one.meta!, name: 'researcher' } }] });
    // E11 W-D (tracker row E7 "teammate joined extra frozen"): the listing's joined age, frozen at its time, is dropped
    expect(treeOf('running')).toEqual(['Team · led by this session', `  ${one.agentId}`, `  testergeneral-purpose · idle · listed ${REL.agoNarrow(2, 'minute')}`, 'solo']);
    expect(heading('running')).toBe('Running 2');
    const group = within(section('running')!).getByRole('group', { name: 'Team · led by this session' });
    expect(Array.from(group.querySelectorAll<HTMLElement>('[data-agent-row], [data-roster]')).map((el) => el.dataset.agentRow ?? el.dataset.roster)).toEqual([one.agentId, 'tester']);
    expect(row('solo').closest('[role="group"]')).toBeNull();
    const roster = document.querySelector<HTMLElement>('[data-roster="tester"]')!;
    expect(roster.tagName).not.toBe('BUTTON'); // no transcript to open
    expect(roster.querySelector('[data-part="title"]')?.textContent).toBe('tester');
  });

  // E11 S2(d): the listing of the team an interactive terminal formed under the teams gate on 2.1.293 (pass3/e7-team-terminal),
  // its teammate scout matched by the sidecar's name, as the recording's sidecar meta names it.
  it('groups the recorded team’s running teammate under Team · led by this session', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('l1', 'ListAgents', {});
    b.result('l1', recordedTeamListing());
    await act(() => useTranscriptStore.getState().attach(A, { subscribe: () => () => {}, snapshot: () => Promise.resolve(b.events) }));
    const [one] = sidecarsOf('subagent-sidecars');
    await mount({ events: [started('solo', 1), started(one.agentId, 2)], sidecars: [{ ...one, meta: { ...one.meta!, name: 'scout' } }] });
    expect(treeOf('running')).toEqual(['Team · led by this session', `  ${one.agentId}`, 'solo']);
    expect(heading('running')).toBe('Running 2');
  });

  it('titles a row by the sidecar’s name, else the dispatch description, and the second line by summary, activity, else Working', async () => {
    const [one, two] = sidecarsOf('subagent-sidecars');
    const named = { ...one, meta: { ...one.meta!, name: 'scout' } };
    await mount({
      events: [started(one.agentId, 1, { description: 'Read one' }), started(two.agentId, 2, { description: 'Read two' })],
      sidecars: [named, two],
    });
    expect(rowsOf('running').map((r) => [r.title, r.line])).toEqual([
      ['scout', 'Read one'],
      ['Read two', 'Working'],
    ]);
    push([event('subagent.progress', { taskId: two.agentId, description: 'Reading two.txt', usage: { totalTokens: 10, toolUses: 1, durationMs: 900 } }, { seq: 3 })]);
    expect(rowsOf('running')[1]).toMatchObject({ title: 'Read two', line: 'Reading two.txt' });
  });

  it('lists a workflow’s agents in no section, though the graph holds them from the run’s sidecars', async () => {
    const runs = workflowRunsOf();
    await mount({ status: null, sidecars: sidecarsOf('pass2/workflow-disk', runs[0].runId), runs });
    expect(section('running') ?? section('done') ?? section('disk')).toBeNull();
    expect(screen.getByText('No subagents yet')).toBeTruthy();
    const nodes = [...useTaskGraph.getState().entries.get(A)!.graph.tasks.values()].filter((n) => n.kind === 'agent');
    expect(nodes.map((n) => n.agent?.runId)).toEqual([runs[0].runId, runs[0].runId]);
  });

  it('reads Approval needed in the warning colour for an agent with an open request of its own', async () => {
    await mount({ events: [started('a1', 1), started('a2', 2)] });
    act(() =>
      useAttention.getState().applySnapshot([item(A, 'permission', T, { request: { requestId: 'r1' as RequestId, toolUseId: null, taskId: null, agentId: 'a1' as AgentId } })], TEST_MACHINE),
    );
    expect(rowsOf('running').map((r) => [r.id, r.waiting, r.line])).toEqual([['a1', true, 'Approval needed'], ['a2', false, 'Working']]);
    expect(row('a1').querySelector('[data-part="state"]')?.className).toContain('text-warning');
  });

  it('ticks elapsed once a second, and reads elapsed unavailable for an agent known only from the snapshot', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(Date.parse(at(5)));
    const snapshotBorn = { taskId: 'snap' as TaskId, taskType: 'local_agent', description: 'From the snapshot', ambient: false };
    await mount({ status: live({ backgroundTasks: [snapshotBorn] }), events: [started('a1', 1)] });
    expect(rowsOf('running').map((r) => [r.id, r.elapsed])).toEqual([['snap', 'elapsed unavailable'], ['a1', '5s']]);
    act(() => vi.advanceTimersByTime(3000));
    expect(rowsOf('running')[1].elapsed).toBe('8s');
  });

  it('a disk-only session: On disk with status unavailable, a stoppedByUser sidecar under Done as stopped, never Running', async () => {
    const [one, two] = sidecarsOf('subagent-sidecars');
    await mount({ status: null, sidecars: [one, { ...two, meta: { ...two.meta!, stoppedByUser: true } }] });
    expect(section('running')).toBeNull();
    expandDone();
    expect(rowsOf('done')).toEqual([expect.objectContaining({ id: two.agentId, line: 'stopped' })]);
    fireEvent.click(within(section('disk')!).getByRole('button', { name: 'On disk 1' }));
    expect(rowsOf('disk')).toEqual([expect.objectContaining({ id: one.agentId, line: 'status unavailable' })]);
  });

  it('says why the sidecars are missing', async () => {
    seedSessions(null);
    const handle = create(undefined);
    render(<Mounted state={handle} />);
    await act(async () => {
      await fake.fail('subagents', 'fs refused');
      await fake.answer('workflows', []);
    });
    expect(screen.getByText('Sidecars unavailable: fs refused')).toBeTruthy();
  });

  it('shows the Done rows’ outcome: finished, with errors, stopped and ended with the session', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse(at(10 + 180)));
    await mount({
      events: [
        started('ok', 1), finished('ok', 2, { summary: 'Read both files' }),
        started('bad', 3), finished('bad', 4, { status: 'failed' }),
        started('halt', 5), finished('halt', 6, { status: 'stopped' }),
        started('gone', 7), event('process.exited', {}, { seq: 8, at: at(10) }),
      ],
    });
    expandDone();
    const lines = Object.fromEntries(rowsOf('done').map((r) => [r.id, r.line]));
    expect(lines).toEqual({ ok: `finished · ${M3} · Read both files`, bad: `finished with errors · ${M3}`, halt: `stopped · ${M3}`, gone: 'ended with the session' });
    expect(row('bad').querySelector('[data-part="state"]')?.className).toContain('text-danger');
  });

  it('a handed-back agent’s Done row shows its report’s first line, never the engine’s pointer (2.1.283 wording)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse(at(10 + 180)));
    const pointer = 'This agent\'s report was delivered to you as a message from "hb" (its SubagentHandback call). Read it there; it is not repeated here.\n';
    const report = 'Another Claude session sent a message:\n<agent-message from="hb">\n[Subagent hand-back] The text below is the final report. The report follows:\n  Found 3 files.\n  - a.ts\n</agent-message>\n\nTrailer.';
    await mount({
      events: [
        started('hb', 1), event('user.message', { content: report, origin: 'peer', isReplay: true, isSynthetic: true }, { seq: 2, at: at(9) }), finished('hb', 3, { summary: pointer }),
        started('wait', 4), finished('wait', 5, { summary: pointer.replace('"hb"', '"wait"') }),
      ],
    });
    expandDone();
    const lines = Object.fromEntries(rowsOf('done').map((r) => [r.id, r.line]));
    expect(lines).toEqual({ hb: `finished · ${M3} · Found 3 files.`, wait: `finished · ${M3}` });
  });

  it('clicking a row opens its drill-in', async () => {
    const { handle } = await mount({ events: [started('a1', 1)] });
    openRow('a1');
    expect(handle.snapshot().view).toEqual({ kind: 'agent', agentId: 'a1' });
  });
});

// happy-dom has no layout: a viewport for the transcript's scroller and a height per row, so the virtualiser mounts rows.
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-transcript-scroller') ? 2000 : this.hasAttribute('data-index') ? 40 : 0;
    },
  });
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));

// The parent's stream as `session.events` answers it for C6's child source: the child started live, then its own slice.
function parentStream(child: AgentId, childEvents: SessionEvent[]): SessionEvent[] {
  return [started(child, 0), ...childEvents.map((e, i) => ({ ...e, id: `${child}-${i}`, agentId: child, seq: i + 1 }) as SessionEvent)];
}
function installBridge(parent: SessionEvent[], answers: Record<string, unknown> = {}): void {
  window.maws = {
    localMachine: TEST_MACHINE,
    invoke: async (name: string) =>
      name === 'session.events'
        ? { ok: true, value: { events: parent, lastSeq: parent.length, complete: true } }
        : name in answers
          ? { ok: true, value: answers[name] }
          : { ok: false, error: { code: 'internal', message: `unexpected ${name}` } },
    on: () => () => {},
  } as unknown as PreloadBridge;
}

describe('drill-in', () => {
  afterEach(() => {
    for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
  });

  it('mounts C6’s child Transcript over ipcSource(app, agent), constructing no source: one attachment under <app>:<agent>', async () => {
    const child = 'k2child' as AgentId;
    const b = builder();
    b.turn('u1', 'Survey the repo');
    b.text('m1', 0, 'Surveying now.');
    installBridge(parentStream(child, b.events));
    vi.mocked(ipcSource).mockClear();
    const attach = vi.spyOn(useTranscriptStore.getState(), 'attach');
    await mount({ events: [started(child, 1)], params: { agentId: child } });
    await waitFor(() => expect(screen.getByText('Surveying now.')).toBeTruthy());
    expect(vi.mocked(ipcSource)).toHaveBeenCalled();
    expect(vi.mocked(ipcSource).mock.calls.every(([app, agent]) => app === A && agent === child)).toBe(true);
    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls[0][0]).toBe(`${A}:${child}`);
    expect(attach.mock.calls[0][1]).toBe(ipcSource(A, child));
    expect(document.querySelector('[data-view="agent"] .transcript')).not.toBeNull();
    attach.mockRestore();
  });

  it('renders C7’s inline card for a permission the child asks for, with the registered actions', async () => {
    const child = 'permchild' as AgentId;
    const perm = permission({ requestId: request('r-child'), toolUseId: tool('b1'), toolName: 'Bash', displayName: 'Bash', input: { command: 'git status' }, agentId: child });
    const b = builder();
    b.turn('u1', 'Run git status');
    b.text('m0', 0, 'Reading [a.ts](src/a.ts) first.'); // a path chip, which calls the registered openFile
    b.toolUse('b1', 'Bash', { command: 'git status' }, 'm1', 0);
    const { requestId, toolUseId, toolName, displayName, input, description, decisionReasonType, suggestions, blockedPath } = perm;
    b.emit('permission.requested', { requestId, toolUseId, toolName, displayName, input, description, decisionReasonType, suggestions, blockedPath });
    installBridge(parentStream(child, b.events), { 'attention.request': { event: { ...perm, sessionId: b.events[0].sessionId } } });
    await mount({ events: [started(child, 1)], params: { agentId: child } });
    act(() => useAttention.getState().applySnapshot([itemFor(perm, A)], TEST_MACHINE));
    const drill = document.querySelector<HTMLElement>('[data-view="agent"]')!;
    await waitFor(() => expect(within(drill).getByRole('heading', { name: /^Run a command · from / })).toBeTruthy()); // UX wave U1a §D: the card's first line
    expect(within(drill).getAllByRole('button').some((button) => /Allow/.test(button.textContent ?? ''))).toBe(true);
    // A callback another child registered (C8c's openFile, stubbed here) reaches the child transcript's rows.
    const openFile = vi.fn();
    const off = registerTranscriptActions({ openFile });
    fireEvent.click(await within(drill).findByTitle('src/a.ts'));
    expect(openFile).toHaveBeenCalledWith('src/a.ts', undefined, A);
    off();
  });

  it('open({ agentId }) switches the view; a pending selection by tool-use id resolves on subagent.started', async () => {
    installBridge([]);
    const { handle } = await mount({ events: [started('a1', 1)] });
    act(() => subagentsTool.open!(handle, { agentId: 'a1' as AgentId }));
    expect(handle.snapshot().view).toEqual({ kind: 'agent', agentId: 'a1' });
    act(() => subagentsTool.open!(handle, { toolUseId: 'tu-late' as ToolUseId }));
    expect(handle.snapshot().view).toEqual({ kind: 'pending', toolUseId: 'tu-late' });
    expect(screen.getByText('Waiting for the agent to start')).toBeTruthy();
    push([started('late', 2, { toolUseId: 'tu-late' })]);
    expect(handle.snapshot().view).toEqual({ kind: 'agent', agentId: 'late' });
  });

  it('a pending selection also resolves from a sidecar naming the tool use', async () => {
    installBridge([]);
    const { handle } = await mount({ params: { toolUseId: 'toolu_01CYiK6ncgQLFUQ2iqC1b4oB' as ToolUseId } });
    expect(handle.snapshot().view.kind).toBe('pending');
    act(() => fake.subagentsChanged(A, sidecarsOf('subagent-sidecars')));
    expect(handle.snapshot().view).toEqual({ kind: 'agent', agentId: 'ad286defbc77bc090' });
  });

  it('Back returns to the lists with the scroll kept', async () => {
    installBridge([]);
    const { handle } = await mount({ events: [started('a1', 1), started('a2', 2)] });
    const lists = document.querySelector<HTMLElement>('[data-view="lists"]')!;
    lists.scrollTop = 120;
    fireEvent.scroll(lists);
    openRow('a2');
    expect(document.querySelector('[data-view="lists"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '‹ Subagents' }));
    expect(handle.snapshot().view).toEqual({ kind: 'lists' });
    expect(document.querySelector<HTMLElement>('[data-view="lists"]')!.scrollTop).toBe(120);
  });

  it('uses the recorded subagent completion totals in the completed-agent drill-in', async () => {
    installBridge([]);
    const [one] = sidecarsOf('subagent-sidecars');
    const events = replayed('pass1', 'subagent');
    await mount({ events: events.filter((e) => e.seq !== null && e.seq < 335), sidecars: [one], params: { agentId: one.agentId } });
    push(events.filter((e) => e.seq !== null && e.seq >= 335));
    expect(document.querySelector('[data-part="agent-meta"]')?.textContent).toBe('haiku · 2s · 11.5k tokens');
  });

  it('heads the agent with model · elapsed · tokens, the unavailable words, no effort cell, and Dispatched by', async () => {
    installBridge([]);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(Date.parse(at(12)));
    const [one] = sidecarsOf('subagent-sidecars');
    const snapshotBorn = { taskId: 'snap' as TaskId, taskType: 'local_agent', description: 'From the snapshot', ambient: false };
    const { handle } = await mount({
      status: live({ backgroundTasks: [snapshotBorn], effort: 'high' }),
      events: [started(one.agentId, 1, { description: 'Read one' }), event('subagent.progress', { taskId: one.agentId, usage: { totalTokens: 38_100, toolUses: 2, durationMs: 9000 } }, { seq: 2 })],
      sidecars: [one],
      params: { agentId: one.agentId },
    });
    const meta = () => document.querySelector('[data-part="agent-meta"]')?.textContent;
    expect(meta()).toBe('haiku · 12s · 38.1k tokens');
    expect(document.querySelector('[data-part="dispatched-by"]')?.textContent).toBe(`Dispatched by ${TITLE}`);
    expect(meta()).not.toMatch(/high/i);
    act(() => handle.openAgent('snap' as AgentId));
    expect(meta()).toBe('model unknown · elapsed unavailable · tokens unavailable');
    setStatus(live({ backgroundTasks: [snapshotBorn], subagentModel: 'claude-haiku-4-5' }));
    expect(meta()).toBe('claude-haiku-4-5 · elapsed unavailable · tokens unavailable');
  });

  it('Stop agent asks first, then calls stop', async () => {
    installBridge([]);
    await mount({ events: [started('a1', 1, { description: 'Long survey' })], params: { agentId: 'a1' as AgentId } });
    fireEvent.click(screen.getByRole('button', { name: 'Stop agent' }));
    const confirm = await screen.findByRole('dialog');
    expect(confirm.textContent).toContain('Stop Long survey?');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep running' }));
    expect(fake.inputs.stopTask).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Stop agent' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Stop' }));
    expect(fake.inputs.stopTask).toEqual([[A, 'a1']]);
    expect(screen.getByRole('button', { name: 'stopping…' })).toBeTruthy();
  });

  // P5 O9: a terminal session driven through its bridge stops a subagent by its id, whatever engine status MAWS kept
  // from an earlier run of the session; a stop whose outcome is unknown says so and is offered again after a wait.
  describe('of a terminal session driven through its bridge', () => {
    let stopAgent: unknown;
    const invoked: [string, unknown][] = [];
    beforeEach(() => {
      invoked.splice(0);
      stopAgent = { state: 'done', result: null };
      window.maws = {
        localMachine: TEST_MACHINE,
        invoke: async (name: string, input: unknown) => {
          invoked.push([name, input]);
          if (name === 'session.events') return { ok: true, value: { events: [], lastSeq: 0, complete: true } };
          if (name === 'laneA.stopAgent') return { ok: true, value: stopAgent };
          return { ok: false, error: { code: 'internal', message: `unexpected ${name}` } };
        },
        on: () => () => {},
      } as unknown as PreloadBridge;
    });
    afterEach(() => resetLaneAStore());

    async function mountDriven() {
      await mount({ status: live({ process: 'exited' }), events: [started('a1', 1, { description: 'Long survey' })], params: { agentId: 'a1' as AgentId } });
      act(() => {
        useSessions.setState((s) => ({ records: new Map(s.records).set(A, { ...s.records.get(A)!, holder: { kind: 'terminal', pid: 4242 } }) }));
        applyLaneAState(A, laneAState(A));
      });
    }
    const stopThroughBridge = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop agent' }));
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Stop' }));
      await waitFor(() => expect(invoked.filter(([name]) => name === 'laneA.stopAgent')).toHaveLength(1));
    };

    it('reads the lists as not live here once a terminal drives the session, whatever engine status was kept', async () => {
      await mount({ events: [started('a1', 1, { description: 'Long survey' })] });
      expect(screen.getByText('Live activity · includes nested agents')).toBeTruthy();
      expect(screen.queryByText('Status is known only while the session runs here')).toBeNull();
      act(() => {
        useSessions.setState((s) => ({ records: new Map(s.records).set(A, { ...s.records.get(A)!, holder: { kind: 'terminal', pid: 4242 } }) }));
        applyLaneAState(A, laneAState(A));
      });
      expect(screen.queryByText('Live activity · includes nested agents')).toBeNull();
      expect(screen.getByText('Status is known only while the session runs here')).toBeTruthy();
    });

    it('stops the agent through the bridge, though an exited engine status is kept', async () => {
      await mountDriven();
      expect(screen.getAllByRole('button', { name: 'Stop agent' })).toHaveLength(1);
      await stopThroughBridge();
      expect(invoked.find(([name]) => name === 'laneA.stopAgent')?.[1]).toEqual({ appSessionId: 'A', agentId: 'a1' }); // the bare id, as the client sends it
      expect(fake.inputs.stopTask).toEqual([]);
      expect(screen.getByRole('button', { name: 'stopping…' })).toBeTruthy();
    });

    // P5 O9 M9 (landing fix wave): another machine's terminal session withholds a subagent's own rows where its machine's
    // endpoint can't carry them (2026-11-06: one listing no `rl2.agent-scope`, its port's `subagent-rows` gap), so the
    // drill-in reached from its tree says so with the reason in place of the transcript, and asks this machine's
    // `session.events` nothing; Stop and Tell stay, through its port.
    const remote = addressOf(OTHER_MACHINE, 'eng-r' as AppSessionId);
    const remoteSession = (capabilities: string[]) => {
      const link: NonNullable<LaneAState['link']> = { state: 'up', refusal: null, carrier: 'direct', member: 'm', clientClass: 'native-mac', rights: [], reason: null };
      useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: T, generation: 1, carrier: 'direct', capabilities }]);
      useSessions.setState({ listed: new Map([[remote, { ...remoteRow(OTHER_MACHINE, 'eng-r', { lane: 'A', availability: 'foreign_held' }), appId: remote }]]) });
      applyLaneAState(remote, laneAState(remote, { engineSessionId: 'eng-r', link, acts: [], turn: { running: true, unknown: false } }));
      ipcSourceSpy.mockClear();
      onTestFinished(() => {
        useSessions.setState({ listed: new Map() });
        useMachines.getState().applyRoster([]);
      });
    };

    it('shows a remote session’s subagent rows as unavailable with the reason where its endpoint can’t carry them, building no child source, and keeps Stop and Tell', async () => {
      remoteSession(['rl2.feeds']);
      render(<Mounted state={create({ agentId: 'a1' as AgentId }, remote)} appSessionId={remote} />);
      expect(screen.getByTestId('subagent-rows-gap').textContent).toBe(LANE_A_WORDS.remoteSubagentRows('mini'));
      expect(ipcSourceSpy).not.toHaveBeenCalled();
      expect(invoked.filter(([name]) => name === 'session.events')).toEqual([]);
      expect(invoked.filter(([name]) => name === 'laneA.watch')).toEqual([]);
      expect((screen.getByRole('button', { name: 'Stop agent' }) as HTMLButtonElement).disabled).toBe(false);
      expect(screen.getByRole('textbox')).toBeTruthy(); // Tell, the relay composer
    });

    // 2026-11-06 (the remote drill-in): where it can, the drill-in draws the agent's own transcript from that machine's
    // plane, a watch naming the agent, and builds no child source of this machine's
    it('draws a remote session’s subagent from its machine’s plane where its endpoint carries it: a watch naming the agent, no child source', async () => {
      remoteSession(['rl2.feeds', 'rl2.agent-scope']);
      await import('../../../lane-a/view/RemoteAgentTranscript'); // the drill-in's lazy chunk, loaded before the clock below starts
      render(<Mounted state={create({ agentId: 'a1' as AgentId }, remote)} appSessionId={remote} />);
      expect(screen.queryByTestId('subagent-rows-gap')).toBeNull();
      await waitFor(() => expect(invoked.filter(([name]) => name === 'laneA.watch')).toEqual([['laneA.watch', { appSessionId: 'eng-r', agentId: 'a1' }]]), { timeout: 5_000 }); // the bare id, routed to its machine
      await waitFor(() => expect(screen.getByTestId('subagent-rows-status').textContent).toBe('unexpected laneA.watch'), { timeout: 5_000 }); // main's refusal, said in place
      expect(ipcSourceSpy).not.toHaveBeenCalled();
      expect(invoked.filter(([name]) => name === 'session.events')).toEqual([]);
      expect(screen.getByRole('textbox')).toBeTruthy();
    });

    it('says a stop with an unknown outcome may not have stopped, and offers Stop again after the wait', async () => {
      stopAgent = { state: 'unknown', why: 'timeout' };
      await mountDriven();
      vi.useFakeTimers({ shouldAdvanceTime: true });
      await stopThroughBridge();
      await waitFor(() => expect(screen.getByText('May not have stopped')).toBeTruthy());
      expect((screen.getByRole('button', { name: 'stopping…' }) as HTMLButtonElement).disabled).toBe(true);
      await act(async () => vi.advanceTimersByTimeAsync(STOP_DOUBT_MS));
      expect((screen.getByRole('button', { name: 'Stop agent' }) as HTMLButtonElement).disabled).toBe(false);
      expect(screen.getByText('May not have stopped')).toBeTruthy();
    });
  });
});

describe('relay composer', () => {
  const box = () => screen.getByLabelText(`Relay via ${TITLE}`) as HTMLTextAreaElement;
  const sendButton = () => screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
  const line = () => document.querySelector('[data-part="relay-line"]')?.textContent ?? null;

  beforeEach(() => installBridge([]));

  type Setup = { status?: EngineSessionStatus | null | 'drop'; events: SessionEvent[] };
  it.each<[string, Setup, string]>([
    ['an agent known only from disk', { status: null, events: [] }, 'Known only from disk'],
    ['a running agent of a session no longer live here', { status: 'drop', events: [started('a1', 1)] }, 'Relay needs the session running here'],
    ['a foreground child', { events: [started('a1', 1, { isBackground: false })] }, `${TITLE} is waiting on this agent and reads messages only after it returns`],
    ['a child whose background flag is unknown', { status: live({ backgroundTasks: [{ taskId: 'a1' as TaskId, taskType: 'local_agent', description: 'x', ambient: false }] }), events: [] }, `Not known whether ${TITLE} is waiting on this agent`],
    ['a finished agent', { events: [started('a1', 1), finished('a1', 2)] }, 'This agent has finished'],
    ['a stopped agent', { events: [started('a1', 1), finished('a1', 2, { status: 'stopped' })] }, 'This agent was stopped'],
    ['an agent that ended with the session', { events: [started('a1', 1), event('process.exited', {}, { seq: 2 })] }, 'This agent ended with the session'],
  ])('is disabled with its reason: %s', async (_, setup, reason) => {
    const sidecars = setup.status === null ? [{ ...sidecarsOf('subagent-sidecars')[0], agentId: 'a1' as AgentId }] : [];
    await mount({ status: setup.status === 'drop' ? live() : setup.status, events: setup.events, sidecars, params: { agentId: 'a1' as AgentId } });
    if (setup.status === 'drop') setStatus(null);
    expect(box().disabled).toBe(true);
    expect(box().placeholder).toBe(reason);
    expect(sendButton().disabled).toBe(true);
  });

  it('shows the disabled reason as a line when a kept draft hides the placeholder', async () => {
    const reason = () => document.querySelector('[data-part="relay-reason"]')?.textContent ?? null;
    const { handle } = await mount({ events: [started('a1', 1)], params: { agentId: 'a1' as AgentId } });
    act(() => handle.setDraft('half a thought'));
    expect(reason()).toBeNull(); // enabled: no reason
    push([finished('a1', 2)]);
    expect(box().disabled).toBe(true);
    expect(box().value).toBe('half a thought');
    expect(reason()).toBe('This agent has finished');
    act(() => handle.setDraft(''));
    expect(reason()).toBeNull(); // the placeholder says it
    expect(box().placeholder).toBe('This agent has finished');
  });

  it('gives a foreground child’s reason its tooltip', async () => {
    await mount({ events: [started('a1', 1, { isBackground: false })], params: { agentId: 'a1' as AgentId } });
    expect(box().title).toBe('A message sent now would resume the finished agent instead of reaching this one');
  });

  it('is enabled for a running background child whether the parent is idle or mid-turn, and for a foreground child once backgrounded', async () => {
    const { handle } = await mount({ events: [started('a1', 1), started('fg', 2, { isBackground: false })], params: { agentId: 'a1' as AgentId } });
    expect(box().disabled).toBe(false);
    expect(box().placeholder).toBe('Message Agent a1…');
    setStatus(live({ turn: openTurn }));
    expect(box().disabled).toBe(false);
    act(() => subagentsTool.open!(handle, { agentId: 'fg' as AgentId }));
    expect(box().disabled).toBe(true);
    push([event('task.updated', { taskId: 'fg', patch: { isBackground: true } }, { seq: 3 })]);
    expect(box().disabled).toBe(false);
  });

  it('sends one next steer, disables the box and walks the line: asked with the turn clause, the long wait, forwarded, resting there, then a receipt clears it', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(Date.parse(at(0)));
    await mount({ status: live({ turn: openTurn }), events: [started('a1', 1)], params: { agentId: 'a1' as AgentId } });
    expect(sendButton().disabled).toBe(true); // a blank draft
    fireEvent.change(box(), { target: { value: 'Also check README' } });
    fireEvent.click(sendButton());
    expect(fake.inputs.steer).toEqual([[A, relayText({ agentId: 'a1' as AgentId, name: null }, 'Also check README'), 'next']]);
    expect(box().disabled).toBe(true);
    await act(() => fake.answer('steer', { messageUuid: 'steer-1' }));
    expect(box().value).toBe('');
    expect(box().placeholder).toBe('Waiting for the last relay');
    expect(line()).toBe(`Asked ${TITLE} to relay · 0s · ${TITLE} forwards at its next tool boundary or when this turn ends`);
    act(() => vi.advanceTimersByTime(5000));
    expect(line()).toBe(`Asked ${TITLE} to relay · 5s · ${TITLE} forwards at its next tool boundary or when this turn ends`);
    act(() => vi.advanceTimersByTime(RELAY_LONG_WAIT_MS));
    expect(line()).toBe(`Asked ${TITLE} to relay · 35s · ${TITLE} is inside a long tool call; it forwards when that call returns or this turn ends`);
    const round = event('assistant.block.complete', { messageUuid: 'm-send', block: { type: 'tool_use', id: 'tu-send', name: 'SendMessage', input: {} } }, { seq: 5 });
    push([round, event('tool.use', { toolUseId: 'tu-send', toolName: 'SendMessage', input: { to: 'a1', message: 'Also check README' } }, { seq: 5, n: 1 })]);
    expect(line()).toBe(`${TITLE} sent it with SendMessage after 1 parent round · Agent a1 gets it at its next tool round`);
    push([event('subagent.progress', { taskId: 'a1', description: 'Reading README.md' }, { seq: 6 })]);
    expect(line()).toBe(`${TITLE} sent it with SendMessage after 1 parent round · Agent a1 gets it at its next tool round`); // no receipt on 2.1.283 (O3)
    push([event('user.message', { content: 'Also check README' }, { seq: 7 })].map((e) => ({ ...e, agentId: 'a1' as AgentId })));
    expect(line()).toBeNull();
    expect(box().disabled).toBe(false);
  });

  it('a forwarded relay leaves the box open and its line up; the next send replaces it, and asked blocks again', async () => {
    await mount({ events: [started('a1', 1)], params: { agentId: 'a1' as AgentId } });
    fireEvent.change(box(), { target: { value: 'first' } });
    fireEvent.click(sendButton());
    await act(() => fake.answer('steer', { messageUuid: 'steer-one' }));
    expect(box().placeholder).toBe('Waiting for the last relay');
    push([event('tool.use', { toolUseId: 'tu-send', toolName: 'SendMessage', input: { to: 'a1', message: 'first' } }, { seq: 5 })]);
    expect(line()).toBe(`${TITLE} sent it with SendMessage after 0 parent rounds · Agent a1 gets it at its next tool round`);
    expect(box().disabled).toBe(false);
    fireEvent.change(box(), { target: { value: 'second' } });
    expect(line()).toMatch(/sent it with SendMessage/); // the forwarded line shows until the next send
    fireEvent.click(sendButton());
    expect(fake.inputs.steer.map(([, content]) => content)).toEqual([relayText({ agentId: 'a1' as AgentId, name: null }, 'first'), relayText({ agentId: 'a1' as AgentId, name: null }, 'second')]);
    await act(() => fake.answer('steer', { messageUuid: 'steer-two' }));
    expect(line()).toMatch(new RegExp(`^Asked ${TITLE} to relay`));
    expect(box().disabled).toBe(true);
  });

  it('an answered steer clears the draft only while the draft is still this agent’s', async () => {
    const { handle } = await mount({ events: [started('a1', 1), started('a2', 2)], params: { agentId: 'a1' as AgentId } });
    fireEvent.change(box(), { target: { value: 'to a1' } });
    fireEvent.click(sendButton());
    act(() => subagentsTool.open!(handle, { agentId: 'a2' as AgentId }));
    fireEvent.change(box(), { target: { value: 'to a2, half typed' } });
    await act(() => fake.answer('steer', { messageUuid: 'steer-a1' }));
    expect(handle.snapshot().draft).toBe('to a2, half typed');
  });

  it('the pending line’s elapsed does not tick while the tool is hidden', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(Date.parse(at(0)));
    const { handle, rerender } = await mount({ events: [started('a1', 1)], params: { agentId: 'a1' as AgentId } });
    fireEvent.change(box(), { target: { value: 'ping' } });
    fireEvent.click(sendButton());
    await act(() => fake.answer('steer', { messageUuid: 'steer-hidden' }));
    expect(vi.getTimerCount()).toBe(2); // the header's elapsed and the line's
    rerender(<Mounted state={handle} visible={false} />);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('asked without the clause when the parent was idle', async () => {
    await mount({ events: [started('a1', 1)], params: { agentId: 'a1' as AgentId } });
    fireEvent.change(box(), { target: { value: 'ping' } });
    fireEvent.click(sendButton());
    await act(() => fake.answer('steer', { messageUuid: 'steer-idle' }));
    expect(line()).toMatch(new RegExp(`^Asked ${TITLE} to relay · \\d+s$`));
  });

  it('⌘↵ sends from the box', async () => {
    const off = connectKeys(window, () => ({}));
    await mount({ events: [started('a1', 1)], params: { agentId: 'a1' as AgentId } });
    fireEvent.change(box(), { target: { value: 'via the keyboard' } });
    box().focus();
    fireEvent.keyDown(box(), { key: 'Enter', code: 'Enter', metaKey: true });
    expect(fake.inputs.steer).toHaveLength(1);
    await act(() => fake.answer('steer', { messageUuid: 'steer-key' }));
    off();
  });

  it('keeps the draft across an unmount', async () => {
    const { handle, unmount } = await mount({ events: [started('a1', 1)], params: { agentId: 'a1' as AgentId } });
    fireEvent.change(box(), { target: { value: 'half a thought' } });
    unmount();
    render(<Mounted state={handle} />);
    expect(box().value).toBe('half a thought');
  });

  it('a refused steer keeps the draft and says why until the next edit', async () => {
    await mount({ events: [started('a1', 1)], params: { agentId: 'a1' as AgentId } });
    fireEvent.change(box(), { target: { value: 'keep me' } });
    fireEvent.click(sendButton());
    await act(() => fake.fail('steer', 'the session is not ready'));
    expect(box().value).toBe('keep me');
    expect(line()).toBe('Relay failed: the session is not ready');
    fireEvent.change(box(), { target: { value: 'keep me!' } });
    expect(line()).toBeNull();
  });

  it('an engine drop puts the text back into an empty box', async () => {
    await mount({ events: [started('a1', 1)], params: { agentId: 'a1' as AgentId } });
    fireEvent.change(box(), { target: { value: 'dropped text' } });
    fireEvent.click(sendButton());
    await act(() => fake.answer('steer', { messageUuid: 'steer-drop' }));
    expect(box().value).toBe('');
    push([event('command.lifecycle', { commandUuid: 'steer-drop', state: 'discarded' }, { seq: 2 })]);
    expect(line()).toBe('Relay failed: the engine discarded it before starting it');
    expect(box().value).toBe('dropped text');
  });

  it('warns that a relay to an agent that ended first would resume it', async () => {
    await mount({ events: [started('a1', 1)], params: { agentId: 'a1' as AgentId } });
    fireEvent.change(box(), { target: { value: 'late words' } });
    fireEvent.click(sendButton());
    await act(() => fake.answer('steer', { messageUuid: 'steer-late' }));
    push([finished('a1', 2)]);
    expect(line()).toBe(`Agent a1 finished before ${TITLE} forwarded it · a SendMessage now would resume it`);
  });
});

describe('subagents tool', () => {
  it('createState with params { agentId } opens the drill-in at once; params undefined opens the lists', async () => {
    const { handle } = await mount({ events: [started('a1', 1)], params: { agentId: 'a1' as AgentId } });
    expect(handle.snapshot().view).toEqual({ kind: 'agent', agentId: 'a1' });
    expect(document.querySelector('[data-view="agent"]')).not.toBeNull();
    cleanup();
    const restored = create(undefined);
    expect(restored.snapshot().view).toEqual({ kind: 'lists' });
  });

  it('open on the lists switches to the agent; on another agent it switches agents and clears the draft', async () => {
    const { handle } = await mount({ events: [started('a1', 1), started('a2', 2)] });
    act(() => subagentsTool.open!(handle, { agentId: 'a1' as AgentId }));
    act(() => handle.setDraft('for a1'));
    act(() => subagentsTool.open!(handle, { agentId: 'a1' as AgentId }));
    expect(handle.snapshot().draft).toBe('for a1'); // the same agent keeps it
    act(() => subagentsTool.open!(handle, { agentId: 'a2' as AgentId }));
    expect(handle.snapshot()).toMatchObject({ view: { kind: 'agent', agentId: 'a2' }, draft: '' });
    act(() => subagentsTool.open!(handle, undefined as unknown as SubagentsParams));
    expect(handle.snapshot().view).toEqual({ kind: 'lists' });
  });

  it('beforeClose resolves true: a pending relay lives in the store, not the tab', async () => {
    const { handle } = await mount({ events: [started('a1', 1)] });
    await expect(subagentsTool.beforeClose(handle)).resolves.toBe(true);
  });

  it('dispose releases the store’s watch', async () => {
    const { handle, unmount } = await mount({ events: [started('a1', 1)] });
    unmount();
    expect(fake.listeners()).toBe(1);
    subagentsTool.dispose(handle);
    expect(fake.listeners()).toBe(0);
  });

  it('the one-second ticker runs only while a shown agent is live, its section expanded and the tool visible', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(Date.parse(at(1)));
    const { handle, rerender } = await mount({ events: [started('a1', 1)] });
    expect(vi.getTimerCount()).toBe(1);
    rerender(<Mounted state={handle} visible={false} />);
    expect(vi.getTimerCount()).toBe(0);
    rerender(<Mounted state={handle} visible />);
    expect(vi.getTimerCount()).toBe(1);
    fireEvent.click(within(section('running')!).getByRole('button', { name: 'Running 1' })); // folded
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.click(within(section('running')!).getByRole('button', { name: 'Running 1' }));
    expect(vi.getTimerCount()).toBe(1);
    push([finished('a1', 2, {}, at(2))]);
    expect(vi.getTimerCount()).toBe(0); // E7: the finished agent sits in the collapsed Done section: nothing shown ticks
    expandDone();
    expect(vi.getTimerCount()).toBe(1); // only Done's slow tick now
    act(() => vi.advanceTimersByTime(1000));
    expect(vi.getTimerCount()).toBe(1);
    rerender(<Mounted state={handle} visible={false} />);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a Done row’s ago keeps advancing on the slow tick after the last live agent ends', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(Date.parse(at(0)));
    await mount({ events: [started('a1', 1)] });
    push([finished('a1', 2, {}, at(1))]);
    expandDone();
    expect(rowsOf('done')[0].line).toBe(`finished · ${REL.now}`);
    act(() => vi.advanceTimersByTime(90_000));
    expect(rowsOf('done')[0].line).toBe(`finished · ${REL.agoNarrow(1, 'minute')}`);
  });

  it('a pinned tab passing through the Overview keeps its view and draft', async () => {
    const { handle, rerender } = await mount({ events: [started('a1', 1)], params: { agentId: 'a1' as AgentId } });
    act(() => handle.setDraft('for A'));
    rerender(<Mounted state={handle} appSessionId={null} />);
    expect(screen.getByText('Open a session to see its subagents')).toBeTruthy();
    rerender(<Mounted state={handle} appSessionId={A} />);
    expect(handle.snapshot()).toMatchObject({ appSessionId: A, view: { kind: 'agent', agentId: 'a1' }, draft: 'for A' });
    expect(document.querySelector('[data-view="agent"]')).not.toBeNull();
  });

  it('a pinned tool follows the shown session: that session’s lists, its view, scroll, draft and open folds reset', async () => {
    const { handle, rerender } = await mount({ events: [started('a1', 1)], params: { agentId: 'a1' as AgentId } });
    act(() => handle.setDraft('for A'));
    act(() => handle.toggleFold('a1' as TaskId));
    expect(handle.snapshot().expandedFolds).toEqual(new Set(['a1']));
    rerender(<Mounted state={handle} appSessionId={B} />);
    expect(document.querySelector('[data-view="agent"]')).toBeNull();
    expect(handle.snapshot()).toMatchObject({ appSessionId: B, view: { kind: 'lists' }, scrollTop: 0, draft: '', expandedFolds: new Set() });
    expect(fake.calls).toContain(`subagents ${B}`);
    expect(fake.calls.filter((c) => c === 'off eventBatch')).toHaveLength(1); // A's watch released
  });
  it('a selection for another session makes a tab still on the old one follow it first, keeping the selection', async () => {
    const { handle, unmount } = await mount({ events: [started('a1', 1)] });
    unmount(); // a pinned tab not shown while another session was
    act(() => subagentsTool.open!(handle, { agentId: 'b1' as AgentId, appSessionId: B }));
    expect(handle.snapshot()).toMatchObject({ appSessionId: B, view: { kind: 'agent', agentId: 'b1' } });
    render(<Mounted state={handle} appSessionId={B} />);
    expect(handle.snapshot().view).toEqual({ kind: 'agent', agentId: 'b1' });
    expect(document.querySelector('[data-view="agent"]')).not.toBeNull();
  });
});

describe('subagents summary', () => {
  const open = vi.fn();
  const summary = () => document.querySelector<HTMLElement>('[data-summary="subagents"]')!;

  function showSummary(id: AppSessionId = A) {
    return render(<SubagentsSummary appSessionId={id} open={open} />);
  }

  it('reads the graph’s counts for a live session, with the agents’ glyphs, and Open opens the tool', async () => {
    seedSessions(live());
    showSummary();
    await act(async () => {
      await fake.answer('events', { events: [started('a1', 1), started('a2', 2), finished('a2', 3)], lastSeq: 3, complete: true });
      await fake.answer('subagents', []);
      await fake.answer('workflows', []);
    });
    expect(summary().textContent).toContain('1 working · 1 done');
    expect(summary().querySelectorAll('[data-part="glyph"]')).toHaveLength(2);
    fireEvent.click(within(summary()).getByRole('button', { name: 'Open' }));
    expect(open).toHaveBeenCalledWith();
  });

  it('reads the digest’s counts while the graph has not loaded, and the sidecars on disk for a disk-only session', async () => {
    seedSessions(null);
    act(() => useSessions.setState((s) => ({ digests: new Map([[A, digest(A, { childAgents: { active: 2, done: 1 } })]]), digestsVersion: s.digestsVersion + 1 })));
    showSummary();
    expect(summary().textContent).toContain('2 working · 1 done');
    await act(async () => {
      await fake.answer('subagents', sidecarsOf('subagent-sidecars'));
      await fake.answer('workflows', []);
    });
    expect(summary().textContent).toContain('2 working · 1 done');
    expect(summary().textContent).toContain('2 on disk');
  });

  it('reads No subagents yet when nothing is known', async () => {
    seedSessions(null);
    showSummary();
    await act(async () => {
      await fake.answer('subagents', []);
      await fake.answer('workflows', []);
    });
    expect(summary().textContent).toContain('No subagents yet');
  });
});

describe('openSubagent', () => {
  beforeEach(() => {
    resetPanelStores();
    registerAgentTools();
  });

  const ref = (over: Partial<SubagentRef>): SubagentRef => ({ taskId: 'a1' as TaskId, agentId: null, toolUseId: 'tu-a1' as ToolUseId, name: 'Survey', glyph: 0, kind: 'agent', subagentType: null, ...over });
  const openedState = () => {
    const tab = panelOf(HOST_A)?.tabs.find((t) => t.toolId === 'subagents');
    return tab ? (instanceOf(tab.id)?.state as SubagentsHandle).snapshot() : null;
  };

  it('registers the Subagents tool', () => {
    expect(panelHost.tools().map((t) => t.id)).toContain('subagents');
  });

  it('opens Subagents on the focused session with the agent selected', () => {
    act(() => agentTranscriptActions.openSubagent(ref({})));
    expect(openedState()).toMatchObject({ appSessionId: HOST_A, view: { kind: 'agent', agentId: 'a1' } });
  });

  it('opens the pending view for the placeholder before subagent.started', () => {
    act(() => agentTranscriptActions.openSubagent(ref({ taskId: 'tu-a1' as TaskId })));
    expect(openedState()?.view).toEqual({ kind: 'pending', toolUseId: 'tu-a1' });
  });

  // C8b M3: Background work registers beside Subagents, so the workflow route is live (it opened nothing before).
  it('routes a workflow to Background work with the run selected', () => {
    act(() => agentTranscriptActions.openSubagent(ref({ kind: 'workflow', taskId: 'wf' as TaskId })));
    const tab = panelOf(HOST_A)?.tabs.find((t) => t.toolId === 'background');
    expect(tab).toBeDefined();
    expect((instanceOf(tab!.id)?.state as BackgroundHandle).snapshot()).toMatchObject({ appSessionId: HOST_A, selected: 'wf' });
  });

  // E7 (Design §2): the ref opens the run's widget, waiting under `Run not found yet` while no read has brought the run
  // under either of its names.
  it('asks Background work for the run’s widget by the ref’s task id and run id', () => {
    act(() => agentTranscriptActions.openSubagent(ref({ kind: 'workflow', taskId: 'wf' as TaskId, runId: 'wf_run' })));
    const tab = panelOf(HOST_A)?.tabs.find((t) => t.toolId === 'background');
    expect((instanceOf(tab!.id)?.state as BackgroundHandle).snapshot()).toMatchObject({ view: { kind: 'list' }, pendingRun: ['wf', 'wf_run'] });
  });
});
