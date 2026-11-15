// The page's lane A watches (P5 O9 M5): one `laneA.watch` per session per page, shared by its consumers, opened while a
// consumer holds it and the session's bridge is live or starting, a late consumer replayed the snapshot and what
// followed, and its `op` and `compact` messages kept by id for a caller that learns an op's id after it ended.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { addressOf } from '@shared/machine/address';
import { record } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { at, OTHER_MACHINE } from '../../../../test/support/machine';
import { applyLaneAState, resetLaneAStore, useLaneA } from '../stores/lane-a';
import { useSessions } from '../stores/sessions';
import { laneAState } from './test-support/lane-a-state';
import { opMessagesOf, readLaneA, resetLaneAWatches, watchLaneA, type PlaneEvent } from './watches';

const A = at('app-a') as AppSessionId;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const msg = (kind: string, body: unknown, n: number | null = 1) => ({ project: '', machine: 'm', session: 'eng-1', kind, sub: 'w-1', n, body });
const snapshot = msg('snapshot', { streaming: [], usage: null }, 0);

beforeEach(() => {
  resetLaneAStore();
  resetLaneAWatches();
});
afterEach(() => vi.useRealTimers());

describe('watchLaneA', () => {
  it('opens one watch for the session once its bridge is live, shares it, and lets it go with the last consumer', async () => {
    const fake = fakeClient({ 'laneA.watch': { watch: 'w-1' }, 'laneA.unwatch': undefined });
    const heard: PlaneEvent[] = [];
    const off = watchLaneA(A, (e) => heard.push(e), { client: fake.client });
    await settle();
    expect(fake.invoked('laneA.watch')).toEqual([]); // no bridge yet
    applyLaneAState(A, laneAState(A, { bridge: 'starting', reason: 'starting' }));
    await settle();
    expect(fake.invoked('laneA.watch')).toEqual([{ appSessionId: A }]);
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', messages: [snapshot] });
    fake.event('laneA.plane', { appSessionId: A, watch: 'other', messages: [msg('chunk', {})] }); // another page's
    const second: PlaneEvent[] = [];
    const offSecond = watchLaneA(A, (e) => second.push(e), { client: fake.client, replay: true });
    expect(second).toEqual([{ kind: 'messages', messages: [snapshot] }]); // replayed from the snapshot on
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', messages: [msg('chunk', { x: 1 })] });
    expect(heard).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(fake.invoked('laneA.watch')).toHaveLength(1);
    off();
    offSecond();
    expect(fake.invoked('laneA.unwatch')).toEqual([{ appSessionId: A, watch: 'w-1' }]);
  });

  it('gives a consumer that comes after the replay bound a fresh snapshot: the watch opens again', async () => {
    let n = 0;
    const fake = fakeClient({ 'laneA.watch': () => ({ watch: `w-${++n}` }), 'laneA.unwatch': undefined });
    applyLaneAState(A, laneAState(A));
    const first: PlaneEvent[] = [];
    watchLaneA(A, (e) => first.push(e), { client: fake.client });
    await settle();
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', messages: [snapshot] });
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', messages: Array.from({ length: 20_001 }, (_, i) => msg('chunk', { i }, i + 1)) });
    const late: PlaneEvent[] = [];
    watchLaneA(A, (e) => late.push(e), { client: fake.client, replay: true });
    await settle();
    expect(fake.invoked('laneA.unwatch')).toEqual([{ appSessionId: A, watch: 'w-1' }]);
    expect(fake.invoked('laneA.watch')).toHaveLength(2);
    expect(first.at(-1)).toEqual({ kind: 'reset' }); // what the first drew no longer follows
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', messages: [msg('chunk', { stale: true })] }); // the old watch's, ignored
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-2', messages: [snapshot] });
    expect(late).toEqual([{ kind: 'messages', messages: [snapshot] }]);
    expect(first.at(-1)).toEqual({ kind: 'messages', messages: [snapshot] });
  });

  it('holds what arrived for its watch before the watch’s id came back', async () => {
    const fake = fakeClient({ 'laneA.unwatch': undefined });
    applyLaneAState(A, laneAState(A));
    const heard: PlaneEvent[] = [];
    watchLaneA(A, (e) => heard.push(e), { client: fake.client });
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', messages: [snapshot] });
    expect(heard).toEqual([]);
    await fake.reply('laneA.watch', { watch: 'w-1' });
    expect(heard).toEqual([{ kind: 'messages', messages: [snapshot] }]);
  });

  it('passes a reset and an end on, and watches again once the bridge is live again', async () => {
    const fake = fakeClient({ 'laneA.watch': { watch: 'w-1' }, 'laneA.unwatch': undefined });
    applyLaneAState(A, laneAState(A));
    const heard: PlaneEvent[] = [];
    watchLaneA(A, (e) => heard.push(e), { client: fake.client });
    await settle();
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', reset: true });
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', ended: 'the session’s bridge went away' });
    expect(heard).toEqual([{ kind: 'reset' }, { kind: 'ended', reason: 'the session’s bridge went away' }]);
    applyLaneAState(A, null);
    applyLaneAState(A, laneAState(A));
    await settle();
    expect(fake.invoked('laneA.watch')).toHaveLength(2);
  });

  // P5 O9 M9 (fix wave 2): a remote link's transport resume passes on as itself, never a reset: nothing was lost and no
  // snapshot follows. Its pause stays the link's own (the controls read its reason from the state).
  it('passes a resume on as a resume, keeps the replay log through it, and drops the pause', async () => {
    const fake = fakeClient({ 'laneA.watch': { watch: 'w-1' } });
    applyLaneAState(A, laneAState(A));
    const heard: PlaneEvent[] = [];
    watchLaneA(A, (e) => heard.push(e), { client: fake.client });
    await settle();
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', messages: [snapshot] });
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', paused: 'offline' });
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', resumed: true });
    expect(heard).toEqual([{ kind: 'messages', messages: [snapshot] }, { kind: 'resumed' }]);
    const late: PlaneEvent[] = [];
    watchLaneA(A, (e) => late.push(e), { replay: true, client: fake.client });
    expect(late).toEqual([{ kind: 'messages', messages: [snapshot] }]);
  });

  it('keeps each op’s messages by id', async () => {
    const fake = fakeClient({ 'laneA.watch': { watch: 'w-1' } });
    applyLaneAState(A, laneAState(A));
    watchLaneA(A, () => {}, { client: fake.client });
    await settle();
    const end = msg('op', { rpc: 'cmd-2', op: 'btw', phase: 'end', id: 'cmd-2', text: 'because' }, null);
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', messages: [snapshot, msg('op', { rpc: 'cmd-2', op: 'btw', phase: 'start', id: 'cmd-2' }, null), end] });
    expect(opMessagesOf(A, 'cmd-2').map((m) => m.body)).toEqual([{ rpc: 'cmd-2', op: 'btw', phase: 'start', id: 'cmd-2' }, end.body]);
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', messages: [msg('compact', { rpc: 'cmd-3', phase: 'end', tokensBefore: 9, tokensAfter: 2 }, null)] });
    expect(opMessagesOf(A, 'cmd-3')).toHaveLength(1);
  });
});

// UX wave U8d (M3 decision 1; Interfaces §B and §C): a terminal session's subagents, as main derives them, ride the watch
// beside its jobs, noted with the origin their body names: the terminal (or `--bg` job) whose bridge child the facts
// came from (the fence review's ruling, fix-wave-panel.md item 3). They stand while the session's record names that
// holder, or none, or no record has arrived yet; any other holder discards them. A watch's end keeps them only when
// none still runs and their body named an origin; an older driver's message, with no agents key, notes none.
describe('the subagents a watch carries', () => {
  const TERMINAL = { kind: 'terminal', pid: 4242 } as const;
  const ORIGIN = 'terminal:4242';
  const holderIs = (holder: SessionRecord['holder']) => useSessions.setState({ records: new Map([[A, record(A, { holder })]]) });
  beforeEach(() => holderIs(TERMINAL));
  afterEach(() => useSessions.setState({ records: new Map() }));
  const T1 = '2026-11-15T10:00:00.000Z';
  const T2 = '2026-11-15T10:05:00.000Z';
  const ran = { agentId: 'a1', meta: { agentType: 'general-purpose', description: 'survey the tests' }, status: 'running', evidence: 'rows', outcome: { status: 'running', raw: 'async_launched', at: T1 }, startedAt: T1 };
  const finished = { ...ran, status: 'completed', outcome: { status: 'completed', raw: 'completed', at: T2, summary: 'all green' } };
  const gone = { ...ran, status: 'exited', evidence: 'session', outcome: undefined };
  const job = { taskId: 'bsleep01', kind: 'shell', toolUseId: 'toolu_bsleep01', startedAt: T1, description: 'run the suites', outputFile: null, status: 'running' };
  const agentsOf = () => useLaneA.getState().agents?.get(A);
  // this Mac's driver's two bodies, naming the terminal their facts came from (null: a body with no origin key)
  const snapshotOf = (subagents: unknown[], origin: string | null = ORIGIN, jobs: unknown[] = []) => msg('snapshot', { streaming: [], usage: null, jobs, subagents, ...(origin !== null && { origin }) }, 0);
  const subagentsOf = (subagents: unknown[], origin: string | null = ORIGIN, jobs: unknown[] = []) => msg('subagents', { subagents, jobs, mcp: [], ...(origin !== null && { origin }) });
  const opened = async (id: AppSessionId = A) => {
    const fake = fakeClient({ 'laneA.watch': { watch: 'w-1' }, 'laneA.unwatch': undefined });
    applyLaneAState(id, laneAState(id));
    const heard: PlaneEvent[] = [];
    const off = watchLaneA(id, (e) => heard.push(e), { client: fake.client });
    await settle();
    return { fake, off, heard, plane: (...messages: unknown[]) => fake.event('laneA.plane', { appSessionId: id, watch: 'w-1', messages }), ended: () => fake.event('laneA.plane', { appSessionId: id, watch: 'w-1', ended: 'the session’s bridge went away' }) };
  };

  it('keeps a snapshot’s agents, then each subagents message’s, beside the jobs, with the origin their body names', async () => {
    const { plane } = await opened();
    plane(snapshotOf([ran], ORIGIN, [job]));
    expect(agentsOf()).toEqual({ agents: [ran], origin: ORIGIN });
    expect(useLaneA.getState().jobs.get(A)).toEqual([job]);
    plane(subagentsOf([finished], ORIGIN, [job]));
    expect(agentsOf()).toEqual({ agents: [finished], origin: ORIGIN });
  });

  it('keeps the same entry when a body says the same again', async () => {
    const { plane } = await opened();
    plane(snapshotOf([ran]));
    const held = agentsOf();
    plane(subagentsOf([structuredClone(ran)]));
    expect(agentsOf()).toBe(held);
  });

  // The branch panel's fix wave: statuses stand while their terminal holds the session, and after it let go of it; any
  // other holder discards them, and a body of theirs heard after that is not kept.
  it('keeps the statuses once the holder is none, and discards them at any other holder, a later body of that origin with them', async () => {
    const { plane, ended } = await opened();
    plane(snapshotOf([ran]));
    holderIs({ kind: 'none' });
    plane(subagentsOf([gone]));
    expect(agentsOf()).toEqual({ agents: [gone], origin: ORIGIN });
    holderIs({ kind: 'self' });
    expect(agentsOf()).toBeUndefined();
    plane(subagentsOf([gone])); // the dropped driver's, heard late
    expect(agentsOf()).toBeUndefined();
    ended();
    holderIs({ kind: 'terminal', pid: 5151 });
    await settle();
    plane(snapshotOf([ran], 'terminal:5151'));
    expect(agentsOf()).toEqual({ agents: [ran], origin: 'terminal:5151' });
    holderIs({ kind: 'terminal', pid: 6262 });
    expect(agentsOf()).toBeUndefined();
  });

  // The fence review's first finding: the origin is the body's, never the record's holder at the moment it is heard. A
  // driver that reprobes in place keeps the watch, so the next terminal's body can follow the last one's on it.
  it('never takes a terminal’s final body, heard on the same watch after the holder changed, as the next terminal’s', async () => {
    const { plane } = await opened();
    plane(snapshotOf([ran]));
    holderIs({ kind: 'terminal', pid: 5151 });
    expect(agentsOf()).toBeUndefined();
    plane(subagentsOf([gone])); // terminal 4242's final body, on the watch the driver kept
    expect(agentsOf()).toBeUndefined();
    plane(subagentsOf([ran], 'terminal:5151')); // the body of the child that answers for 5151
    expect(agentsOf()).toEqual({ agents: [ran], origin: 'terminal:5151' });
    plane(subagentsOf([gone])); // and 4242's, later still, takes nothing from it
    expect(agentsOf()).toEqual({ agents: [ran], origin: 'terminal:5151' });
  });

  // The fence review's second finding: a restored local terminal tab, or a records reconnect, can bring the body first.
  it('keeps a body heard before the session’s record under its own origin, and keeps it when the record names that holder', async () => {
    useSessions.setState({ records: new Map() });
    const { plane } = await opened();
    plane(snapshotOf([ran]));
    expect(agentsOf()).toEqual({ agents: [ran], origin: ORIGIN });
    holderIs(TERMINAL);
    expect(agentsOf()).toEqual({ agents: [ran], origin: ORIGIN });
    holderIs({ kind: 'background_job', pid: 4242, jobId: 'job-1' }); // another process holds it
    expect(agentsOf()).toBeUndefined();
  });

  it('keeps them past the watch’s end when none runs, and drops them when one still runs', async () => {
    const { plane, ended } = await opened();
    plane(snapshotOf([finished, gone]));
    ended();
    expect(agentsOf()?.agents).toEqual([finished, gone]);
    await settle(); // the watch opens again, the bridge being live
    plane(snapshotOf([finished, ran]));
    ended();
    expect(agentsOf()).toBeUndefined();
  });

  it('drops them when the last consumer lets the watch go while one still runs, and keeps them when none does', async () => {
    const first = await opened();
    first.plane(snapshotOf([ran]));
    first.off();
    expect(agentsOf()).toBeUndefined();
    const second = await opened();
    second.plane(snapshotOf([finished]));
    second.off();
    expect(agentsOf()?.agents).toEqual([finished]);
  });

  it('notes no agents from an older driver’s messages, which carry no agents key, and keeps their jobs as before', async () => {
    const { plane } = await opened();
    plane(msg('snapshot', { streaming: [], usage: null, jobs: [job] }, 0), msg('subagents', { jobs: [job, { ...job, taskId: 'bdone02', status: 'completed' }] }));
    expect(agentsOf()).toBeUndefined();
    expect(useLaneA.getState().jobs.get(A)).toHaveLength(2);
    plane(msg('subagents', { subagents: [], jobs: [job], mcp: [] })); // an older driver's message, its list empty
    expect(agentsOf()?.agents).toEqual([]);
  });

  // Ruling point 4: a body that names no origin (a driver older than the key; another machine's sminos today) is what a
  // person had before: its statuses stand while its watch lives, whatever the holder, and none outlives the watch.
  it('lays an origin-less body’s statuses while its watch lives and keeps none past the watch, even with none running', async () => {
    const { plane, ended, off } = await opened();
    plane(snapshotOf([finished], null));
    expect(agentsOf()).toEqual({ agents: [finished], origin: null });
    holderIs({ kind: 'none' });
    expect(agentsOf()).toEqual({ agents: [finished], origin: null });
    ended();
    expect(agentsOf()).toBeUndefined();
    await settle(); // the watch opens again, the bridge being live
    plane(snapshotOf([gone], null));
    expect(agentsOf()?.agents).toEqual([gone]);
    off();
    expect(agentsOf()).toBeUndefined();
  });

  // Ruling point 7, the window's half: another machine's session (no record here) is read by the same reception, so a
  // body of its that names an origin is noted under it, the message reaching the watch's consumers as it came.
  it('reads another machine’s body by the same rule: an origin it names is kept as named, and the message passes on unchanged', async () => {
    const R = addressOf(OTHER_MACHINE, 'eng-r' as AppSessionId);
    const { plane, heard } = await opened(R);
    const named = msg('subagents', { subagents: [finished], jobs: [], mcp: [], origin: 'terminal:777' });
    plane(named);
    expect(useLaneA.getState().agents.get(R)).toEqual({ agents: [finished], origin: 'terminal:777' });
    expect(heard).toEqual([{ kind: 'messages', messages: [named] }]);
  });
});

// 2026-11-06 (the remote lane A drill-in): a subagent's own transcript is a watch of its own (`laneA.watch` naming the
// agent), beside the session's and shared only by that agent's consumers; it carries that transcript alone, so none of
// the session's jobs, usage or ops are taken from it; a read names that watch; the machine's pause before its first
// snapshot, and main's refusal of the watch, reach its consumers (the drill-in says why it shows nothing).
describe('watchLaneA of one subagent', () => {
  it('opens a watch of its own naming the agent, beside the session’s, and takes none of the session’s state from it', async () => {
    const fake = fakeClient({ 'laneA.watch': (input: { agentId?: string }) => ({ watch: input.agentId === undefined ? 'w-1' : `w-${input.agentId}` }), 'laneA.unwatch': undefined, 'laneA.read': { ok: true, result: { requested: true } } });
    applyLaneAState(A, laneAState(A));
    const main: PlaneEvent[] = [];
    const agent: PlaneEvent[] = [];
    const offMain = watchLaneA(A, (e) => main.push(e), { client: fake.client });
    const offAgent = watchLaneA(A, (e) => agent.push(e), { client: fake.client, agentId: 'a1' });
    await settle();
    expect(fake.invoked('laneA.watch')).toEqual([{ appSessionId: A }, { appSessionId: A, agentId: 'a1' }]);
    const agentSnapshot = msg('snapshot', { streaming: [], jobs: [{ taskId: 'bash_9' }], subagents: [{ agentId: 'a2', meta: {}, status: 'running', evidence: 'bridge' }], usage: { context: 1 } }, 0);
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-a1', messages: [agentSnapshot, msg('op', { rpc: 'x', op: 'btw', id: 'op-9' }, null)] });
    expect(agent).toEqual([{ kind: 'messages', messages: [agentSnapshot, msg('op', { rpc: 'x', op: 'btw', id: 'op-9' }, null)] }]);
    expect(main).toEqual([]);
    expect(useLaneA.getState().jobs.get(A)).toBeUndefined();
    expect(useLaneA.getState().agents.get(A)).toBeUndefined();
    expect(useLaneA.getState().usage.get(A)).toBeUndefined();
    expect(opMessagesOf(A, 'op-9')).toEqual([]);
    expect(await readLaneA(A, 'rows', fake.client, { before: 'r1', limit: 100 }, 'a1')).toEqual({ ok: true, result: { requested: true } });
    expect(fake.invoked('laneA.read')).toEqual([{ appSessionId: A, watch: 'w-a1', kind: 'rows', args: { before: 'r1', limit: 100 } }]);
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-a1', paused: 'unavailable' });
    expect(agent.at(-1)).toEqual({ kind: 'paused', reason: 'unavailable' });
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', paused: 'offline' });
    expect(main).toEqual([]); // the session's watch drops its pause, as before
    offAgent();
    expect(fake.invoked('laneA.unwatch')).toEqual([{ appSessionId: A, watch: 'w-a1' }]);
    offMain();
  });

  it('tells its consumers why main refused the watch', async () => {
    const fake = fakeClient();
    applyLaneAState(A, laneAState(A));
    const agent: PlaneEvent[] = [];
    watchLaneA(A, (e) => agent.push(e), { client: fake.client, agentId: 'a1' });
    await fake.fail('laneA.watch', 'mini can’t send it yet; update MAWS on mini');
    expect(agent).toEqual([{ kind: 'refused', reason: 'mini can’t send it yet; update MAWS on mini' }]);
  });
});
