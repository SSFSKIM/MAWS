// The Subagents tool (C8b execution document, M2): the three lists over a seeded task-graph store, the drill-in over
// C6's child source with C7's inline card, the relay composer's regime and its pending line, the tool's X5 pins, the
// summary section and the `openSubagent` adapter. The stores are the product singletons over the fake agent-work
// client (`setAgentWorkClient`); C5's sessions and attention stores are seeded directly.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, AppSessionId, RequestId, TaskId, ToolUseId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { SubagentEntry, WorkflowRun } from '@shared/ipc/schema/fs';
import { digest, item, record, status } from '../../../../../../test/support/builders';
import { event, replayed, sidecarsOf, workflowRunsOf } from '../../../../../../test/support/agents-events';
import { connectKeys } from '../../../keymap/dispatcher';
import { instanceOf, panelHost } from '../../../panel/host';
import type { PanelToolContext } from '../../../panel/tool';
import { itemFor, permission } from '../../../request-card/test-requests';
import { useAttention } from '../../../stores/attention';
import { useSessions } from '../../../stores/sessions';
import { A as HOST_A, panelOf, resetPanelStores } from '../../../test-support/panel';
import { ipcSource, registerTranscriptActions, useTranscriptStore, type SubagentRef } from '../../../transcript';
import { builder, request, tool } from '../../../transcript/model/test-events';
import { setAgentWorkClient } from '../client';
import { fakeAgentWorkClient, type FakeAgentWorkClient } from '../fake-work-client';
import { agentTranscriptActions, registerAgentTools } from '../index';
import { RELAY_LONG_WAIT_MS, relayText } from '../model/relay';
import { useRelays } from '../relay-store';
import { useTaskGraph } from '../store';
import { SubagentsSummary } from './SubagentsSummary';
import type { BackgroundHandle } from '../background/BackgroundTool';
import { subagentsTool, type SubagentsHandle, type SubagentsParams } from './SubagentsTool';

// K2's test: the drill-in reaches the child through C6's `ipcSource` and builds nothing of its own.
vi.mock('../../../transcript', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../transcript')>();
  return { ...actual, ipcSource: vi.fn(actual.ipcSource) };
});

const A = 'A' as AppSessionId;
const B = 'B' as AppSessionId;
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

const live = (over: Partial<EngineSessionStatus> = {}): EngineSessionStatus => ({ ...status('A'), launchId: 'journal', ...over });
const openTurn = { id: 'app:journal:1:0', origin: 'human', startedAt: T, acceptedAt: T, userMessageUuids: [] } as unknown as EngineSessionStatus['turn'];

function seedSessions(statusOfA: EngineSessionStatus | null): void {
  useSessions.setState((s) => ({
    records: new Map([
      [A, record('A', { title: { text: TITLE, source: 'user' } })],
      [B, record('B', { title: { text: 'Other session', source: 'user' } })],
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

const push = (events: SessionEvent[]) => act(() => fake.batch('A', events));
const section = (name: 'active' | 'done' | 'disk') => document.querySelector<HTMLElement>(`[data-section="${name}"]`);
const rowsOf = (name: 'active' | 'done' | 'disk') =>
  Array.from(section(name)?.querySelectorAll<HTMLElement>('[data-agent-row]') ?? []).map((row) => ({
    id: row.dataset.agentRow,
    depth: Number(row.dataset.depth),
    title: row.querySelector('[data-part="title"]')?.textContent,
    line: row.querySelector('[data-part="line"]')?.textContent,
    elapsed: row.querySelector('[data-part="elapsed"]')?.textContent,
    nested: row.querySelector<HTMLElement>('[data-part="nested"]')?.title ?? null,
    waiting: row.querySelector('[data-part="waiting"]') !== null,
  }));
const heading = (name: 'active' | 'done' | 'disk') => section(name)?.querySelector('h3')?.textContent;
const row = (id: string) => document.querySelector<HTMLElement>(`[data-agent-row="${id}"]`)!;

beforeEach(() => {
  fake = fakeAgentWorkClient();
  setAgentWorkClient(fake.client);
  useTaskGraph.setState({ entries: new Map() });
  useAttention.setState((s) => ({ bySession: new Map(), version: s.version + 1 }));
  installBridge([]); // C6's child source reads main through the validated bridge; a drill-in test installs its own stream
});

afterEach(() => {
  cleanup();
  handles.splice(0).forEach((handle) => subagentsTool.dispose(handle));
  for (const key of [...useRelays.getState().relays.keys()]) useRelays.getState().dismiss(key);
  setAgentWorkClient(null);
  vi.useRealTimers();
});

describe('subagents lists', () => {
  it('splits Active and Done, four and ten shown with Show N more', async () => {
    const running = Array.from({ length: 6 }, (_, i) => started(`r${i}`, i + 1));
    const ended = Array.from({ length: 12 }, (_, i) => [started(`d${i}`, 10 + 2 * i), finished(`d${i}`, 11 + 2 * i, {}, at(100 + i))]).flat();
    await mount({ events: [...running, ...ended] });
    expect(heading('active')).toBe('Active · 6');
    expect(rowsOf('active').map((r) => r.id)).toEqual(['r0', 'r1', 'r2', 'r3']);
    expect(heading('done')).toBe('Done · 12');
    expect(rowsOf('done')).toHaveLength(10);
    expect(rowsOf('done')[0].id).toBe('d11'); // newest end first
    fireEvent.click(within(section('active')!).getByRole('button', { name: 'Show 2 more' }));
    expect(rowsOf('active')).toHaveLength(6);
    fireEvent.click(within(section('done')!).getByRole('button', { name: 'Show 2 more' }));
    expect(rowsOf('done')).toHaveLength(12);
    expect(screen.getByText('Live activity · includes nested agents')).toBeTruthy();
  });

  it('nests a child under its parent at depth 1 in Active and again in Done', async () => {
    await mount({ events: [started('p', 1), dispatch('p', 'tu-c', 2), started('c', 3)] });
    expect(rowsOf('active').map((r) => [r.id, r.depth, r.nested])).toEqual([['p', 0, null], ['c', 1, null]]);
    push([finished('c', 4, {}, at(20)), finished('p', 5, {}, at(30))]);
    expect(section('active')).toBeNull();
    expect(rowsOf('done').map((r) => [r.id, r.depth])).toEqual([['p', 0], ['c', 1]]);
  });

  it('nests On disk over the nested-agents sidecars of a disk-only session, with status unavailable and the header line', async () => {
    await mount({ status: null, sidecars: sidecarsOf('pass3/nested-agents-sidecars') });
    expect(heading('disk')).toBe('On disk · 2');
    expect(rowsOf('disk').map((r) => [r.title, r.depth, r.line])).toEqual([
      ['Outer agent dispatching inner', 0, 'status unavailable'],
      ['Inner reads one.txt', 1, 'status unavailable'],
    ]);
    expect(screen.getByText('Status is known only while the session runs here')).toBeTruthy();
    expect(section('active')).toBeNull();
    expect(screen.queryByText('Live activity · includes nested agents')).toBeNull();
  });

  it('marks a child whose parent sits in the other list as an orphan at depth 0, its tooltip naming the parent', async () => {
    await mount({ events: [started('p', 1, { description: 'Planner' }), dispatch('p', 'tu-c', 2), started('c', 3), finished('c', 4)] });
    expect(rowsOf('done')).toEqual([expect.objectContaining({ id: 'c', depth: 0, nested: 'Child of Planner' })]);
    expect(row('c').querySelector('[data-part="nested"]')?.textContent).toBe('· nested');
    expect(rowsOf('active')).toEqual([expect.objectContaining({ id: 'p', depth: 0, nested: null })]);
  });

  it('marks a child of an agent the session does not list', async () => {
    await mount({ events: [dispatch('ghost', 'tu-c', 1), started('c', 2)] });
    expect(rowsOf('active')).toEqual([expect.objectContaining({ id: 'c', depth: 0, nested: 'Child of an agent this session does not list' })]);
  });

  it('titles a row by the sidecar’s name, else the dispatch description, and the second line by summary, activity, else Working', async () => {
    const [one, two] = sidecarsOf('subagent-sidecars');
    const named = { ...one, meta: { ...one.meta!, name: 'scout' } };
    await mount({
      events: [started(one.agentId, 1, { description: 'Read one' }), started(two.agentId, 2, { description: 'Read two' })],
      sidecars: [named, two],
    });
    expect(rowsOf('active').map((r) => [r.title, r.line])).toEqual([
      ['scout', 'Read one'],
      ['Read two', 'Working'],
    ]);
    push([event('subagent.progress', { taskId: two.agentId, description: 'Reading two.txt', usage: { totalTokens: 10, toolUses: 1, durationMs: 900 } }, { seq: 3 })]);
    expect(rowsOf('active')[1]).toMatchObject({ title: 'Read two', line: 'Reading two.txt' });
  });

  it('lists a workflow’s agents in no section, though the graph holds them from the run’s sidecars', async () => {
    const runs = workflowRunsOf();
    await mount({ status: null, sidecars: sidecarsOf('pass2/workflow-disk', runs[0].runId), runs });
    expect(section('active') ?? section('done') ?? section('disk')).toBeNull();
    expect(screen.getByText('No subagents yet')).toBeTruthy();
    const nodes = [...useTaskGraph.getState().entries.get(A)!.graph.tasks.values()].filter((n) => n.kind === 'agent');
    expect(nodes.map((n) => n.agent?.runId)).toEqual([runs[0].runId, runs[0].runId]);
  });

  it('badges an agent with an open request of its own: waiting and Approval needed', async () => {
    await mount({ events: [started('a1', 1), started('a2', 2)] });
    act(() =>
      useAttention.getState().applySnapshot([item('A', 'permission', T, { request: { requestId: 'r1' as RequestId, toolUseId: null, taskId: null, agentId: 'a1' as AgentId } })]),
    );
    expect(rowsOf('active').map((r) => [r.id, r.waiting])).toEqual([['a1', true], ['a2', false]]);
    expect(row('a1').querySelector('[data-part="waiting"]')?.textContent).toBe('waiting');
    expect(rowsOf('active')[0].line).toContain('Approval needed');
  });

  it('ticks elapsed once a second, and reads elapsed unavailable for an agent known only from the snapshot', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(Date.parse(at(5)));
    const snapshotBorn = { taskId: 'snap' as TaskId, taskType: 'local_agent', description: 'From the snapshot', ambient: false };
    await mount({ status: live({ backgroundTasks: [snapshotBorn] }), events: [started('a1', 1)] });
    expect(rowsOf('active').map((r) => [r.id, r.elapsed])).toEqual([['snap', 'elapsed unavailable'], ['a1', '5s']]);
    act(() => vi.advanceTimersByTime(3000));
    expect(rowsOf('active')[1].elapsed).toBe('8s');
  });

  it('a disk-only session: On disk with status unavailable, a stoppedByUser sidecar under Done as stopped, never Active', async () => {
    const [one, two] = sidecarsOf('subagent-sidecars');
    await mount({ status: null, sidecars: [one, { ...two, meta: { ...two.meta!, stoppedByUser: true } }] });
    expect(section('active')).toBeNull();
    expect(rowsOf('done')).toEqual([expect.objectContaining({ id: two.agentId, line: 'stopped' })]);
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
    const lines = Object.fromEntries(rowsOf('done').map((r) => [r.id, r.line]));
    expect(lines).toEqual({ ok: 'finished · 3m ago · Read both files', bad: 'finished with errors · 3m ago', halt: 'stopped · 3m ago', gone: 'ended with the session' });
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
    const lines = Object.fromEntries(rowsOf('done').map((r) => [r.id, r.line]));
    expect(lines).toEqual({ hb: 'finished · 3m ago · Found 3 files.', wait: 'finished · 3m ago' });
  });

  it('clicking a row opens its drill-in', async () => {
    const { handle } = await mount({ events: [started('a1', 1)] });
    fireEvent.click(row('a1'));
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
    invoke: async (name: string) =>
      name === 'session.events'
        ? { ok: true, value: { events: parent, lastSeq: parent.length, complete: true } }
        : name in answers
          ? { ok: true, value: answers[name] }
          : { ok: false, error: { code: 'internal', message: `unexpected ${name}` } },
    on: () => () => {},
  } as unknown as MawsBridge;
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
    act(() => useAttention.getState().applySnapshot([itemFor(perm, A)]));
    const drill = document.querySelector<HTMLElement>('[data-view="agent"]')!;
    await waitFor(() => expect(within(drill).getByRole('heading', { name: 'Bash' })).toBeTruthy());
    expect(within(drill).getAllByRole('button').some((button) => /Allow/.test(button.textContent ?? ''))).toBe(true);
    // A callback another child registered (C8c's openFile, stubbed here) reaches the child transcript's rows.
    const openFile = vi.fn();
    const off = registerTranscriptActions({ openFile });
    fireEvent.click(await within(drill).findByTitle('src/a.ts'));
    expect(openFile).toHaveBeenCalledWith('src/a.ts', undefined);
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
    act(() => fake.subagentsChanged('A', sidecarsOf('subagent-sidecars')));
    expect(handle.snapshot().view).toEqual({ kind: 'agent', agentId: 'ad286defbc77bc090' });
  });

  it('Back returns to the lists with the scroll kept', async () => {
    installBridge([]);
    const { handle } = await mount({ events: [started('a1', 1), started('a2', 2)] });
    const lists = document.querySelector<HTMLElement>('[data-view="lists"]')!;
    lists.scrollTop = 120;
    fireEvent.scroll(lists);
    fireEvent.click(row('a2'));
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

  it('the one-second ticker runs only while a shown Active agent is live, Active expanded and the tool visible', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(Date.parse(at(1)));
    const { handle, rerender } = await mount({ events: [started('a1', 1)] });
    expect(vi.getTimerCount()).toBe(1);
    rerender(<Mounted state={handle} visible={false} />);
    expect(vi.getTimerCount()).toBe(0);
    rerender(<Mounted state={handle} visible />);
    expect(vi.getTimerCount()).toBe(1);
    fireEvent.click(within(section('active')!).getByRole('button', { name: 'Active · 1' })); // collapsed
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.click(within(section('active')!).getByRole('button', { name: 'Active · 1' }));
    expect(vi.getTimerCount()).toBe(1);
    push([finished('a1', 2, {}, at(2))]);
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
    expect(rowsOf('done')[0].line).toBe('finished · just now');
    act(() => vi.advanceTimersByTime(90_000));
    expect(rowsOf('done')[0].line).toBe('finished · 1m ago');
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

  it('a pinned tool follows the shown session: that session’s lists, its view, scroll and draft reset', async () => {
    const { handle, rerender } = await mount({ events: [started('a1', 1)], params: { agentId: 'a1' as AgentId } });
    act(() => handle.setDraft('for A'));
    rerender(<Mounted state={handle} appSessionId={B} />);
    expect(document.querySelector('[data-view="agent"]')).toBeNull();
    expect(handle.snapshot()).toMatchObject({ appSessionId: B, view: { kind: 'lists' }, scrollTop: 0, draft: '' });
    expect(fake.calls).toContain('subagents B');
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
    act(() => useSessions.setState((s) => ({ digests: new Map([[A, digest('A', { childAgents: { active: 2, done: 1 } })]]), digestsVersion: s.digestsVersion + 1 })));
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
});
