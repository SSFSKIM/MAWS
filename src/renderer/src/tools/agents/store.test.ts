import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AgentId, AppSessionId, TaskId } from '@shared/graph/ids';
import type { SubagentEntry } from '@shared/ipc/schema/fs';
import type { SessionRecord } from '@shared/graph/session';
import type { LaneAAgent } from '@shared/lane-a/agents';
import { addressOf, bareOf } from '@shared/machine/address';
import { record, status } from '../../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { laneAState } from '../../lane-a/test-support/lane-a-state';
import { resetLaneAWatches } from '../../lane-a/watches';
import { applyLaneAState, noteLaneAAgents, resetLaneAStore, useLaneA } from '../../stores/lane-a';
import { createSessionsStore, useSessions } from '../../stores/sessions';
import { preloadOf } from '../../test-support/preload-of';
import { setAgentWorkClient } from './client';
import { applyTaskEvents, emptyGraph } from './model/task-graph';
import { createTaskGraphStore, registerRemoteTaskFeed, STOP_SETTLE_MS } from './store';
import { event, replayed, sidecarsOf, upTo } from '../../../../../test/support/agents-events';
import { fakeAgentWorkClient, flush, type FakeAgentWorkClient } from './fake-work-client';
import { at as address, OTHER_MACHINE, TEST_MACHINE } from '../../../../../test/support/machine';

const A = 'A' as AppSessionId;
const pass1 = replayed('pass1', 'subagent');
const ONE = 'ad286defbc77bc090' as TaskId;
const TWO = 'ae75ba6ce5d866acc' as TaskId;
const bgTask = (taskId: string) => ({ taskId: taskId as TaskId, taskType: 'local_bash', description: taskId, ambient: false });

let fake: FakeAgentWorkClient;
let sessions: ReturnType<typeof createSessionsStore>;
let store: ReturnType<typeof createTaskGraphStore>;

const live = (over: Partial<EngineSessionStatus> = {}): EngineSessionStatus => ({ ...status('A'), launchId: 'journal', ...over });
const setStatus = (s: EngineSessionStatus) => sessions.getState().applyStatus({ appSessionId: A, status: s }, TEST_MACHINE);
const entry = () => {
  const found = store.getState().entries.get(A);
  if (!found) throw new Error('no entry for A');
  return found;
};
const graph = () => entry().graph;
const nodeOf = (taskId: string) => graph().tasks.get(taskId as TaskId);
const snapshot = (events: ReturnType<typeof upTo>, lastSeq = Math.max(0, ...events.map((e) => e.seq ?? 0))) => fake.answer('events', { events, lastSeq, complete: true });

beforeEach(() => {
  fake = fakeAgentWorkClient();
  setAgentWorkClient(fake.client);
  sessions = createSessionsStore();
  store = createTaskGraphStore({ sessions });
});

afterEach(() => {
  setAgentWorkClient(null);
  vi.useRealTimers();
});

describe('task graph store', () => {
  describe('a live session', () => {
    it('subscribes the batches before it reads the snapshot, then the disk half', () => {
      setStatus(live());
      store.getState().watch(A);
      expect(fake.calls).toEqual(['on eventBatch', 'on subagentsChanged', 'on workflowChanged', 'events A null', 'subagents A', 'workflows A']);
      expect(entry()).toMatchObject({ phase: 'loading', launchId: 'journal', lastSeq: null });
    });

    it('holds a batch that arrives before the snapshot and applies only its events above the snapshot’s lastSeq', async () => {
      setStatus(live());
      store.getState().watch(A);
      const held = upTo(pass1, 370).filter((e) => (e.seq ?? 0) >= 172); // ONE's start again, then both endings
      fake.batch('A', held);
      expect(graph().tasks.size).toBe(0);
      await snapshot(upTo(pass1, 340), 340); // ONE completed at 335
      expect(nodeOf(ONE)?.status).toBe('completed'); // its start (172) in the held batch was not applied again
      expect(nodeOf(TWO)?.status).toBe('completed');
      expect(entry()).toMatchObject({ phase: 'live', lastSeq: Math.max(...held.map((e) => e.seq ?? 0)) });
    });

    it('applies the part of a later batch above lastSeq, and drops a batch wholly below it without touching the graph', async () => {
      setStatus(live());
      store.getState().watch(A);
      await snapshot([event('subagent.started', { taskId: 'a' }, { seq: 1 })], 2);
      const before = graph();
      fake.batch('A', [event('subagent.started', { taskId: 'b' }, { seq: 1 })]);
      expect(graph()).toBe(before);
      expect(entry().lastSeq).toBe(2);
      fake.batch('A', [event('subagent.started', { taskId: 'b' }, { seq: 2 }), event('subagent.started', { taskId: 'c' }, { seq: 3 })]);
      expect(nodeOf('b')).toBeUndefined();
      expect(nodeOf('c')?.status).toBe('running');
      expect(entry().lastSeq).toBe(3);
    });

    it('keeps every event of one journal row (they share a seq): the nested dispatch at row 111 is its second event', async () => {
      const nested = replayed('pass3', 'nested-agents');
      setStatus(live());
      store.getState().watch(A);
      await snapshot(upTo(nested, 110), 110);
      const row111 = nested.filter((e) => e.seq === 111);
      expect(row111.map((e) => e.kind)).toContain('tool.use');
      expect(row111.length).toBeGreaterThan(1);
      fake.batch('A', nested.filter((e) => e.seq === 111 || e.seq === 112));
      expect(nodeOf('a425e926e506edeb1')?.agent?.parentAgentId).toBe('a38d4aebfaea9f6b1');
    });

    it('keeps the tail of a row C3’s batcher split across two batches (the cursor is seq and place in the row)', async () => {
      const nested = replayed('pass3', 'nested-agents');
      setStatus(live());
      store.getState().watch(A);
      await snapshot(upTo(nested, 110), 110);
      const row111 = nested.filter((e) => e.seq === 111);
      const issuing = row111.findIndex((e) => e.kind === 'tool.use');
      expect(issuing).toBeGreaterThan(0);
      fake.batch('A', row111.slice(0, issuing)); // the batcher's splice at 500 events ignores row boundaries
      fake.batch('A', [...row111.slice(issuing), ...nested.filter((e) => e.seq === 112)]);
      expect(nodeOf('a425e926e506edeb1')?.agent?.parentAgentId).toBe('a38d4aebfaea9f6b1');
      expect(entry().lastSeq).toBe(112);
    });

    it('drops the tail of a row the snapshot holds whole when a held batch straddles it', async () => {
      setStatus(live());
      store.getState().watch(A);
      fake.batch('A', [event('subagent.started', { taskId: 'a' }, { seq: 5, n: 1 }), event('subagent.started', { taskId: 'c' }, { seq: 6 })]);
      await snapshot([event('subagent.started', { taskId: 'a' }, { seq: 4 }), event('subagent.finished', { taskId: 'a' }, { seq: 5, n: 0 }), event('subagent.progress', { taskId: 'b' }, { seq: 5, n: 1 })], 5);
      expect(nodeOf('a')?.status).toBe('completed'); // (5, 1) of the held batch is the snapshot's already: not applied again
      expect(nodeOf('c')?.status).toBe('running');
      expect(entry().lastSeq).toBe(6);
    });

    it('re-reads from the row before when a release left the cursor mid-row', async () => {
      setStatus(live());
      const release = store.getState().watch(A);
      await snapshot([], 3);
      fake.batch('A', [event('subagent.started', { taskId: 'a' }, { seq: 4, n: 0 })]);
      release();
      store.getState().watch(A);
      expect(fake.calls.filter((c) => c.startsWith('events'))).toEqual(['events A null', 'events A 3']);
    });

    it('drops disk-form events and events of another launch, and discards every kind the reducer does not read', async () => {
      setStatus(live());
      store.getState().watch(A);
      await snapshot([], 0);
      const before = graph();
      fake.batch('A', [event('subagent.started', { taskId: 'disk' }, { seq: null })]);
      fake.batch('A', [event('subagent.started', { taskId: 'old' }, { seq: 5, launch: 'earlier' })]);
      expect(graph()).toBe(before);
      fake.batch('A', [event('session.state', {}, { seq: 6 }), event('turn.started', {}, { seq: 7 }), event('user.message', { agentId: 'a1', content: 'x' }, { seq: 8 })]);
      expect(graph()).toBe(before);
      expect(entry().lastSeq).toBe(8);
      fake.batch('B', [event('subagent.started', { taskId: 'other-session' }, { seq: 9 })]);
      expect(nodeOf('other-session')).toBeUndefined();
      fake.batch('A', [event('subagent.progress', { taskId: 'child', agentId: 'child' }, { seq: 10 })]); // a child's task frame is the parent's fact
      expect(nodeOf('child')?.status).toBe('running');
    });

    it('merges the disk half after the wire: a sidecar never overwrites a wire fact', async () => {
      setStatus(live());
      store.getState().watch(A);
      await fake.answer('subagents', sidecarsOf('subagent-sidecars'));
      expect(nodeOf(ONE)?.status).toBe('unknown');
      await snapshot(upTo(pass1, 296));
      expect(nodeOf(ONE)).toMatchObject({ status: 'running', startedAt: '2026-09-28T09:22:09.332Z' });
      expect(nodeOf(ONE)?.agent).toMatchObject({ model: 'haiku', spawnDepth: 1 });
      expect(nodeOf(ONE)?.provenance).toMatchObject({ wire: true, disk: true });
      await fake.answer('workflows', []);
      expect(entry().disk).toMatchObject({ runs: [], error: null, runsError: null });
      expect(entry().disk.agents).toHaveLength(2);
    });

    it('takes the status from the sessions store: its background tasks, then its exit', async () => {
      setStatus(live());
      store.getState().watch(A);
      await snapshot(upTo(pass1, 296));
      setStatus(live({ backgroundTasks: [bgTask('bgx')] }));
      expect(nodeOf('bgx')).toMatchObject({ status: 'running', startedAt: null });
      setStatus(live({ process: 'exited', exit: { code: 0, signal: null, reason: 'quit', at: '2026-09-29T12:00:00.000Z', release: null /* C12 */ } }));
      expect(nodeOf(ONE)?.status).toBe('exited');
      expect(nodeOf('bgx')).toMatchObject({ status: 'exited', endedAt: '2026-09-29T12:00:00.000Z' });
      expect(fake.listeners()).toBe(1); // the subscriptions stay until the last watcher leaves
    });

    it('a status with a new launchId marks the old launch’s running nodes exited, resets lastSeq and re-snapshots from null', async () => {
      setStatus(live());
      store.getState().watch(A);
      await snapshot(upTo(pass1, 296));
      expect(entry().lastSeq).toBe(296);
      setStatus(live({ engineState: 'running' }));
      expect(fake.pending('events')).toBe(0); // the same launch never resets the cursor
      expect(entry().lastSeq).toBe(296);
      setStatus(live({ launchId: 'second' }));
      expect(nodeOf(ONE)?.status).toBe('exited');
      expect(entry()).toMatchObject({ launchId: 'second', lastSeq: null, phase: 'loading' });
      expect(fake.calls.filter((c) => c.startsWith('events'))).toEqual(['events A null', 'events A null']);
      fake.batch('A', [event('subagent.started', { taskId: 'late-old' }, { seq: 400 })]); // the old launch's late batch
      await snapshot([event('subagent.started', { taskId: 'fresh' }, { seq: 1, launch: 'second' })]);
      expect(nodeOf('late-old')).toBeUndefined();
      expect(nodeOf('fresh')?.status).toBe('running');
      expect(nodeOf(ONE)?.status).toBe('exited'); // kept
      expect(entry().lastSeq).toBe(1);
    });
  });

  describe('the edges of a launch and a watch', () => {
    it('a relaunch marks the old launch’s nodes exited before it applies the new launch’s listed tasks', async () => {
      setStatus(live());
      store.getState().watch(A);
      await snapshot(upTo(pass1, 296));
      setStatus(live({ launchId: 'second', backgroundTasks: [bgTask('fresh-bg')] }));
      expect(nodeOf(ONE)?.status).toBe('exited');
      expect(nodeOf('fresh-bg')?.status).toBe('running');
    });

    it('a snapshot answered after the last release, or after the status went, is dropped', async () => {
      setStatus(live());
      const release = store.getState().watch(A);
      release();
      await snapshot(upTo(pass1, 296));
      expect(entry().phase).not.toBe('live');
      expect(graph().tasks.size).toBe(0);
      store.getState().watch(A);
      sessions.setState({ engine: new Map() }); // the record went, and its status with it
      await snapshot(upTo(pass1, 296));
      expect(entry().phase).toBe('disk');
      expect(graph().tasks.size).toBe(0);
    });

    it('a failed snapshot applies the held and later batches but keeps the cursor, so the next watch re-reads the whole launch', async () => {
      setStatus(live());
      const release = store.getState().watch(A);
      const earlier = event('subagent.started', { taskId: 'early' }, { seq: 1 });
      const held = [event('subagent.started', { taskId: 'a' }, { seq: 5 }), event('subagent.finished', { taskId: 'a' }, { seq: 6 })];
      const later = event('subagent.started', { taskId: 'b' }, { seq: 7 });
      fake.batch('A', held);
      await fake.fail('events', 'journal unreadable');
      expect(entry()).toMatchObject({ phase: 'failed', error: 'journal unreadable', lastSeq: null });
      expect(nodeOf('a')?.status).toBe('completed'); // later facts are still facts
      fake.batch('A', [later]);
      expect(nodeOf('b')?.status).toBe('running');
      expect(entry().lastSeq).toBeNull();
      release();
      store.getState().watch(A);
      expect(fake.calls.filter((c) => c.startsWith('events'))).toEqual(['events A null', 'events A null']);
      const launch = [earlier, ...held, later];
      await snapshot(launch, 7);
      expect(entry()).toMatchObject({ phase: 'live', error: null, lastSeq: 7 });
      expect(graph().tasks).toEqual(applyTaskEvents(emptyGraph(), launch).tasks); // the full replay converges on the same graph
      expect(nodeOf('early')?.status).toBe('running');
      const settled = graph();
      fake.batch('A', launch); // a replay of what the cursor has passed changes nothing
      expect(graph()).toBe(settled);
    });

    it('keeps the sidecars’ error and the runs’ error apart', async () => {
      store.getState().watch(A);
      await fake.fail('workflows', 'workflows unreadable');
      expect(entry().disk).toMatchObject({ error: null, runsError: 'workflows unreadable' });
      await fake.fail('subagents', 'sidecars unreadable');
      expect(entry().disk).toMatchObject({ error: 'sidecars unreadable', runsError: 'workflows unreadable' });
      fake.subagentsChanged('A', []);
      expect(entry().disk).toMatchObject({ error: null, runsError: 'workflows unreadable' });
    });
  });

  describe('a disk-only session', () => {
    it('never calls session.events, reads the sidecars and runs, and follows fs.subagentsChanged', async () => {
      store.getState().watch(A);
      expect(fake.calls).toEqual(['on eventBatch', 'on subagentsChanged', 'on workflowChanged', 'subagents A', 'workflows A']);
      expect(entry().phase).toBe('disk');
      fake.batch('A', [event('subagent.started', { taskId: 'wire' }, { seq: 1 })]);
      expect(nodeOf('wire')).toBeUndefined();
      await fake.answer('subagents', []);
      const agents = sidecarsOf('subagent-sidecars');
      fake.subagentsChanged('A', agents);
      fake.subagentsChanged('B', sidecarsOf('pass3/nested-agents-sidecars'));
      expect(entry().disk.agents).toBe(agents);
      expect([...graph().tasks.keys()]).toEqual([ONE, TWO]);
      expect(nodeOf(ONE)?.status).toBe('unknown');
    });

    it('re-reads the runs once, 250 ms after the last fs.workflowChanged', async () => {
      vi.useFakeTimers();
      store.getState().watch(A);
      await fake.answer('workflows', []);
      fake.workflowChanged('A', 'wf_1');
      await vi.advanceTimersByTimeAsync(100);
      fake.workflowChanged('A', 'wf_1');
      fake.workflowChanged('B', 'wf_2');
      await vi.advanceTimersByTimeAsync(249);
      expect(fake.pending('workflows')).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(fake.pending('workflows')).toBe(1);
      await fake.answer('workflows', [{ runId: 'wf_1', snapshot: null, journal: [] }]);
      expect(nodeOf('wf_1')).toMatchObject({ kind: 'workflow', status: 'unknown' });
    });

    it('starts the wire half when a status first arrives', async () => {
      store.getState().watch(A);
      setStatus(live());
      expect(fake.calls).toContain('events A null');
      await snapshot(upTo(pass1, 172));
      expect(entry()).toMatchObject({ phase: 'live', launchId: 'journal' });
      expect(nodeOf(ONE)?.status).toBe('running');
    });
  });

  describe('watchers', () => {
    it('two watchers share one subscription; the last release stops it and keeps the entry; a re-watch reads the delta', async () => {
      setStatus(live());
      const first = store.getState().watch(A);
      const second = store.getState().watch(A);
      expect(fake.listeners()).toBe(1);
      await snapshot(upTo(pass1, 296));
      first();
      expect(fake.listeners()).toBe(1);
      second();
      expect(fake.listeners()).toBe(0);
      expect(fake.calls).toContain('off eventBatch');
      expect(nodeOf(ONE)?.status).toBe('running');
      setStatus(live({ backgroundTasks: [bgTask('unwatched')] })); // nobody listens now
      expect(nodeOf('unwatched')).toBeUndefined();
      store.getState().watch(A);
      expect(fake.calls.at(-3)).toBe('events A 296');
      expect(nodeOf('unwatched')?.status).toBe('running'); // the re-watch applied the current status first
    });

    it('a re-watch after the launch changed while unwatched applies that status first and snapshots from null', async () => {
      setStatus(live());
      const release = store.getState().watch(A);
      await snapshot(upTo(pass1, 296));
      release();
      setStatus(live({ launchId: 'second' }));
      store.getState().watch(A);
      expect(nodeOf(ONE)?.status).toBe('exited');
      expect(fake.calls.filter((c) => c.startsWith('events'))).toEqual(['events A null', 'events A null']);
      expect(entry()).toMatchObject({ launchId: 'second', lastSeq: null });
    });
  });

  describe('stop and the resolution rule', () => {
    const watchWithShell = async () => {
      setStatus(live({ backgroundTasks: [bgTask('bgx')] }));
      store.getState().watch(A);
      await snapshot([event('task.started', { taskId: 'bgx', taskType: 'local_bash' }, { seq: 1 })]);
    };
    const frames = (seq: number) => [
      event('tasks.snapshot', { tasks: [] }, { seq }),
      event('task.updated', { taskId: 'bgx', patch: { status: 'killed', endTime: 1790700000000 } }, { seq: seq + 1 }),
      event('task.notification', { taskId: 'bgx', status: 'stopped' }, { seq: seq + 2 }),
    ];

    it('marks stopping and calls stopTask; with the id still listed at resolution it stays stopping until the frames set the status', async () => {
      await watchWithShell();
      const result = store.getState().stop(A, 'bgx' as TaskId);
      expect(nodeOf('bgx')?.stopping).toBe(true);
      expect(fake.inputs.stopTask).toEqual([['A', 'bgx']]);
      await fake.answer('stopTask');
      expect(await result).toEqual({ ok: true });
      expect(entry().pendingStops.get('bgx' as TaskId)).toMatchObject({ absentAtResolution: false });
      expect(nodeOf('bgx')).toMatchObject({ status: 'running', stopping: true });
      fake.batch('A', frames(2));
      expect(nodeOf('bgx')).toMatchObject({ status: 'stopped', stopping: false });
      expect(entry().pendingStops.size).toBe(0);
    });

    it('with the id absent at resolution and no frame within STOP_SETTLE_MS, removes the node', async () => {
      vi.useFakeTimers();
      await watchWithShell();
      const result = store.getState().stop(A, 'bgx' as TaskId);
      setStatus(live({ backgroundTasks: [] }));
      await fake.answer('stopTask');
      await result;
      expect(entry().pendingStops.get('bgx' as TaskId)).toMatchObject({ absentAtResolution: true });
      await vi.advanceTimersByTimeAsync(STOP_SETTLE_MS - 1);
      expect(nodeOf('bgx')?.stopping).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(nodeOf('bgx')).toBeUndefined();
      expect(entry().pendingStops.size).toBe(0);
    });

    it('with the id absent and the frames inside the window, reads stopped and removes nothing', async () => {
      vi.useFakeTimers();
      await watchWithShell();
      const result = store.getState().stop(A, 'bgx' as TaskId);
      setStatus(live({ backgroundTasks: [] }));
      await fake.answer('stopTask');
      await result;
      await vi.advanceTimersByTimeAsync(500);
      fake.batch('A', frames(2));
      await vi.advanceTimersByTimeAsync(STOP_SETTLE_MS * 2);
      expect(nodeOf('bgx')).toMatchObject({ status: 'stopped', stopping: false });
    });

    it('the frames can come before the answer (R6: they always did)', async () => {
      await watchWithShell();
      const result = store.getState().stop(A, 'bgx' as TaskId);
      setStatus(live({ backgroundTasks: [] }));
      fake.batch('A', frames(2));
      await fake.answer('stopTask');
      expect(await result).toEqual({ ok: true });
      expect(nodeOf('bgx')).toMatchObject({ status: 'stopped', stopping: false });
      expect(entry().pendingStops.size).toBe(0);
    });

    it('on rejection clears stopping and answers the message', async () => {
      await watchWithShell();
      const result = store.getState().stop(A, 'bgx' as TaskId);
      await fake.fail('stopTask', 'the session is not ready');
      expect(await result).toEqual({ ok: false, message: 'the session is not ready' });
      expect(nodeOf('bgx')).toMatchObject({ status: 'running', stopping: false });
      expect(entry().pendingStops.size).toBe(0);
    });

    it('with the id listed at resolution and a later status dropping it, waits STOP_SETTLE_MS from that status', async () => {
      vi.useFakeTimers();
      await watchWithShell();
      const result = store.getState().stop(A, 'bgx' as TaskId);
      await fake.answer('stopTask');
      await result;
      await vi.advanceTimersByTimeAsync(STOP_SETTLE_MS * 3);
      expect(nodeOf('bgx')?.stopping).toBe(true);
      setStatus(live({ backgroundTasks: [] }));
      await vi.advanceTimersByTimeAsync(STOP_SETTLE_MS - 1);
      expect(nodeOf('bgx')).toBeDefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(nodeOf('bgx')).toBeUndefined();
    });

    it('stop on a stopping node is a no-op, and a snapshot never removes a node on its own', async () => {
      await watchWithShell();
      void store.getState().stop(A, 'bgx' as TaskId);
      expect(await store.getState().stop(A, 'bgx' as TaskId)).toEqual({ ok: true });
      expect(fake.inputs.stopTask).toHaveLength(1);
      fake.batch('A', [event('tasks.snapshot', { tasks: [] }, { seq: 2 })]);
      setStatus(live({ backgroundTasks: [] }));
      await flush();
      expect(nodeOf('bgx')?.stopping).toBe(true);
    });
  });
});

// UX wave U8d (M3; Interfaces §C): a terminal session this Mac drives. The store holds its lane A watch while its graph is
// watched, and publishes the graph its own reads built (the sidecars from disk; the wire of a launch by this app, when a
// status is held) with the statuses the watch carried laid over it. They stand while the terminal they came from holds
// the session and after it let go of it; this app, another terminal or another machine taking it discards them.
describe('a terminal session this Mac drives', () => {
  const D = address('drv' as AppSessionId);
  const E = address('drv-2' as AppSessionId);
  const EARLIER = '2026-11-14T09:00:00.000Z'; // an earlier run of the session by this app
  const T1 = '2026-11-15T10:00:00.000Z';
  const T2 = '2026-11-15T10:05:00.000Z';
  const LATER = '2026-11-15T11:00:00.000Z'; // a launch by this app after the terminal's run
  let bridge: FakeClient;
  const releases: (() => void)[] = [];

  const sidecar = (agentId: string, over: Record<string, unknown> = {}): SubagentEntry => ({
    agentId: agentId as AgentId,
    meta: { agentType: 'general-purpose', description: `Agent ${agentId}`, toolUseId: `toolu_${agentId}`, spawnDepth: 1, requestShape: 'background', ...over },
    transcriptPath: `/work/agents/agent-${agentId}.jsonl`, size: 10, mtimeMs: 1_790_000_000_000, runId: null,
  });
  const meta = (agentId: string) => ({ agentType: 'general-purpose', description: `Agent ${agentId}`, toolUseId: `toolu_${agentId}` });
  const running = (agentId: string, over: Partial<LaneAAgent> = {}): LaneAAgent => ({ agentId, meta: meta(agentId), status: 'running', evidence: 'rows', outcome: { status: 'running', raw: 'async_launched', at: T1 }, startedAt: T1, ...over });
  const completed = (agentId: string): LaneAAgent => ({ agentId, meta: meta(agentId), status: 'completed', evidence: 'rows', outcome: { status: 'completed', raw: 'completed', at: T2, summary: 'all green' }, startedAt: T1 });
  const gone = (agentId: string): LaneAAgent => ({ agentId, meta: meta(agentId), status: 'exited', evidence: 'session', startedAt: T1 });
  // the driver's body, naming the terminal its facts came from (the session's holder in these cases, pid 4242)
  const plane = (id: AppSessionId, kind: 'snapshot' | 'subagents', subagents: LaneAAgent[], origin = 'terminal:4242') =>
    bridge.event('laneA.plane', { appSessionId: bareOf(id), watch: 'w1', messages: [{ project: '', machine: 'm', session: 'eng-1', kind, sub: 'w1', n: kind === 'snapshot' ? 0 : 1, body: kind === 'snapshot' ? { streaming: [], usage: null, jobs: [], subagents, origin } : { subagents, jobs: [], mcp: [], origin } }] });
  const watchEnded = (id: AppSessionId) => bridge.event('laneA.plane', { appSessionId: bareOf(id), watch: 'w1', ended: 'the session’s bridge went away' });
  const entryOf = (id: AppSessionId) => store.getState().entries.get(id)!;
  const statusesOf = (id: AppSessionId) => Object.fromEntries([...entryOf(id).graph.tasks.values()].map((n) => [n.taskId, n.status]));
  const setStatusOf = (id: AppSessionId, s: EngineSessionStatus) => sessions.getState().applyStatus({ appSessionId: id, status: s }, TEST_MACHINE);
  // the session's holder as the page's records say it (the terminal that drives it is pid 4242)
  const TERMINAL = { kind: 'terminal', pid: 4242 } as const;
  const holderOf = (id: AppSessionId, holder: SessionRecord['holder']) => useSessions.setState((s) => ({ records: new Map(s.records).set(id, record(id, { holder })) }));
  const earlierRun = (id: AppSessionId) => ({ ...status(id), launchId: 'earlier', launchedAt: EARLIER, process: 'exited' as const });
  // the store's watch of a session with no engine status here, its disk answered with these sidecars
  const watchDisk = async (id: AppSessionId, sidecars: SubagentEntry[]) => {
    const release = store.getState().watch(id);
    await fake.answer('subagents', sidecars);
    await fake.answer('workflows', []);
    await flush();
    return release;
  };

  beforeEach(() => {
    bridge = fakeClient({ 'laneA.watch': { watch: 'w1' }, 'laneA.unwatch': null });
    window.maws = preloadOf(bridge);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse(T1));
    // the page's sessions store, which the watch reads the holder from
    sessions = useSessions;
    store = createTaskGraphStore({ sessions });
    // every watch a case takes is let go after it: the sessions store is the page's, and a store left bound to it would
    // answer the next case's statuses and lane A changes
    const watch = store.getState().watch;
    store.setState({ watch: (id) => (releases.push(watch(id)), releases.at(-1)!) });
    holderOf(D, TERMINAL);
    holderOf(E, TERMINAL);
    applyLaneAState(D, laneAState(D));
    applyLaneAState(E, laneAState(E));
  });
  afterEach(() => {
    releases.splice(0).forEach((release) => release());
    resetLaneAWatches();
    resetLaneAStore();
    useSessions.setState({ records: new Map(), engine: new Map(), listed: new Map() });
  });

  // The panel's finding (fix-wave-panel.md): the statuses are fenced by where they came from, not by time. When this
  // app launches a replacement, the terminal's driver is dropped and its final body goes out; the page can hear it before
  // or after the replacement's first status, and its receipt is later than the replacement's launch either way.
  const replacement = (id: AppSessionId) => ({ ...status(id), launchId: 'second', launchedAt: T1 });
  const replacementFrames = [event('subagent.started', { taskId: 'a1' }, { seq: 1, launch: 'second' }), event('subagent.finished', { taskId: 'a1', status: 'stopped' }, { seq: 2, launch: 'second' })];

  it('does not lay the driver’s final body, heard before the replacement’s first status, once this app holds the session', async () => {
    await watchDisk(D, [sidecar('a1')]);
    plane(D, 'snapshot', [running('a1')]);
    vi.setSystemTime(Date.parse(T2)); // received after the replacement's launch
    plane(D, 'subagents', [gone('a1')]); // the dropped driver's final body
    watchEnded(D);
    holderOf(D, { kind: 'self' });
    setStatusOf(D, replacement(D));
    applyLaneAState(D, null);
    await fake.answer('events', { events: replacementFrames, lastSeq: 2, complete: true });
    expect(statusesOf(D)).toEqual({ a1: 'stopped' }); // the replacement's own reading
    expect(useLaneA.getState().agents.get(D)).toBeUndefined();
  });

  it('does not lay the driver’s final body heard after the replacement’s first status', async () => {
    await watchDisk(D, [sidecar('a1')]);
    plane(D, 'snapshot', [running('a1')]);
    holderOf(D, { kind: 'self' });
    setStatusOf(D, replacement(D));
    vi.setSystemTime(Date.parse(T2));
    plane(D, 'subagents', [gone('a1')]); // a driver that no longer holds the session
    watchEnded(D);
    applyLaneAState(D, null);
    await fake.answer('events', { events: replacementFrames, lastSeq: 2, complete: true });
    expect(statusesOf(D)).toEqual({ a1: 'stopped' });
    expect(useLaneA.getState().agents.get(D)).toBeUndefined();
  });

  it('discards the statuses when the session is handed to another machine, and does not lay them again when it comes back', async () => {
    let remote = false;
    const fed = applyTaskEvents(emptyGraph(), [event('subagent.started', { taskId: 'a1' }, { seq: 1 })]);
    const off = registerRemoteTaskFeed((id) => (id === D && remote ? (onGraph) => (onGraph(fed), () => {}) : null));
    await watchDisk(D, [sidecar('a1')]);
    plane(D, 'snapshot', [gone('a1')]);
    watchEnded(D);
    applyLaneAState(D, null);
    expect(statusesOf(D)).toEqual({ a1: 'exited' });
    remote = true;
    useSessions.setState({ listed: new Map() }); // the listing moved: the store binds the session to that machine's feed
    expect(entryOf(D).graph).toBe(fed);
    remote = false;
    useSessions.setState({ listed: new Map() }); // and back to this machine's reads
    await fake.answer('subagents', [sidecar('a1')]);
    await fake.answer('workflows', []);
    expect(statusesOf(D)).toEqual({ a1: 'unknown' });
    expect(useLaneA.getState().agents.get(D)).toBeUndefined();
    off();
  });

  // The fence review's third finding: a first bind to another machine's feed, with no binding to this machine's reads
  // before it on this watch, discards this Mac's statuses all the same (ruling point 5).
  it('discards this Mac’s kept statuses at a first bind to another machine’s feed, so that coming back to this machine’s reads lays none', async () => {
    let remote = false;
    const fed = applyTaskEvents(emptyGraph(), [event('subagent.started', { taskId: 'a1' }, { seq: 1 })]);
    const off = registerRemoteTaskFeed((id) => (id === D && remote ? (onGraph) => (onGraph(fed), () => {}) : null));
    const release = await watchDisk(D, [sidecar('a1')]);
    plane(D, 'snapshot', [gone('a1')]);
    watchEnded(D);
    holderOf(D, { kind: 'none' });
    applyLaneAState(D, null);
    expect(statusesOf(D)).toEqual({ a1: 'exited' });
    release(); // nothing watches the graph: no binding follows the listing
    remote = true;
    store.getState().watch(D); // bound to that machine's feed from the start
    expect(entryOf(D).graph).toBe(fed);
    expect(useLaneA.getState().agents.get(D)).toBeUndefined();
    remote = false;
    useSessions.setState({ listed: new Map() }); // back to this machine's reads, with no new body
    await fake.answer('subagents', [sidecar('a1')]);
    await fake.answer('workflows', []);
    expect(statusesOf(D)).toEqual({ a1: 'unknown' });
    off();
  });

  it('holds the session’s lane A watch while its graph is watched and its bridge is live, and lets it go with the last watcher and when the state goes', async () => {
    const release = store.getState().watch(D);
    await flush();
    expect(bridge.invoked('laneA.watch')).toEqual([{ appSessionId: bareOf(D) }]);
    release();
    expect(bridge.invoked('laneA.unwatch')).toEqual([{ appSessionId: bareOf(D), watch: 'w1' }]);
    store.getState().watch(D);
    await flush();
    expect(bridge.invoked('laneA.watch')).toHaveLength(2);
    applyLaneAState(D, null);
    expect(bridge.invoked('laneA.unwatch')).toHaveLength(2);
    applyLaneAState(D, laneAState(D, { bridge: 'starting', reason: 'starting' }));
    await flush();
    expect(bridge.invoked('laneA.watch')).toHaveLength(3);
  });

  it('lays the body’s statuses over the sidecars it read: sidecars then a body, and a body then sidecars, publish the same graph', async () => {
    const body = [completed('a1'), running('a2')];
    await watchDisk(D, [sidecar('a1'), sidecar('a2')]);
    expect(statusesOf(D)).toEqual({ a1: 'unknown', a2: 'unknown' });
    plane(D, 'snapshot', body);
    expect(statusesOf(D)).toEqual({ a1: 'completed', a2: 'running' });
    expect(entryOf(D).graph.tasks.get('a2' as TaskId)).toMatchObject({ startedAt: T1, endedAt: null });
    expect(entryOf(D).graph.tasks.get('a1' as TaskId)).toMatchObject({ startedAt: T1, endedAt: T2, summary: 'all green' });
    store.getState().watch(E);
    await flush();
    plane(E, 'snapshot', body);
    await fake.answer('subagents', [sidecar('a1'), sidecar('a2')]);
    await fake.answer('workflows', []);
    expect(entryOf(E).graph.tasks).toEqual(entryOf(D).graph.tasks);
  });

  it('publishes the same object after a body that says the same again, and lays a later body over its reads’ graph, never over the earlier overlay', async () => {
    await watchDisk(D, [sidecar('a1')]);
    plane(D, 'snapshot', [running('a1', { spawn: { parentAgentId: 'p0', subagentType: 'general-purpose', description: 'Agent a1' } })]);
    expect(entryOf(D).graph.tasks.get('a1' as TaskId)?.agent?.parentAgentId).toBe('p0');
    const laid = entryOf(D);
    plane(D, 'subagents', [running('a1', { spawn: { parentAgentId: 'p0', subagentType: 'general-purpose', description: 'Agent a1' } })]);
    expect(entryOf(D)).toBe(laid);
    plane(D, 'subagents', [running('a1', { startedAt: undefined })]);
    expect(entryOf(D).graph.tasks.get('a1' as TaskId)).toMatchObject({ status: 'running', startedAt: null, agent: expect.objectContaining({ parentAgentId: null }) });
    fake.subagentsChanged(D, [sidecar('a1'), sidecar('a3')]); // a reduction of its own, from the reads' graph, laid over again
    expect(statusesOf(D)).toEqual({ a1: 'running', a3: 'unknown' });
  });

  // §C: the same object after a change that alters no node. What a status rests on is in the body but on no node.
  it('publishes the same object after a body whose change alters no node: a running agent’s evidence moving from the rows to the bridge', async () => {
    await watchDisk(D, [sidecar('a1'), sidecar('a2')]);
    plane(D, 'snapshot', [running('a1'), completed('a2')]);
    const laid = entryOf(D);
    plane(D, 'subagents', [running('a1', { evidence: 'bridge', running: true, outcome: undefined }), completed('a2')]);
    expect(useLaneA.getState().agents.get(D)?.agents[0]).toMatchObject({ evidence: 'bridge' }); // a new list was noted
    expect(entryOf(D)).toBe(laid);
    plane(D, 'subagents', [running('a1', { evidence: 'bridge', running: true, outcome: undefined }), gone('a2')]);
    expect(statusesOf(D)).toEqual({ a1: 'running', a2: 'exited' }); // a change that alters a node is published
  });

  it('keeps the statuses when the watch ends after a body with none running, and reads from disk again when it ends with one running', async () => {
    await watchDisk(D, [sidecar('a1'), sidecar('a2')]);
    plane(D, 'snapshot', [completed('a1'), gone('a2')]);
    watchEnded(D);
    expect(statusesOf(D)).toEqual({ a1: 'completed', a2: 'exited' });
    await flush(); // the bridge is live: the watch opens again
    plane(D, 'snapshot', [completed('a1'), running('a2')]);
    expect(statusesOf(D)).toEqual({ a1: 'completed', a2: 'running' });
    watchEnded(D);
    expect(statusesOf(D)).toEqual({ a1: 'unknown', a2: 'unknown' });
  });

  it('keeps the outcomes after the terminal goes, its lane A state removed last, over an exited engine status kept from an earlier run by this app', async () => {
    setStatusOf(D, earlierRun(D));
    store.getState().watch(D);
    await fake.answer('events', { events: [], lastSeq: 0, complete: true });
    await fake.answer('subagents', [sidecar('a1'), sidecar('a2')]);
    await fake.answer('workflows', []);
    await flush();
    plane(D, 'snapshot', [completed('a1'), running('a2')]);
    plane(D, 'subagents', [completed('a1'), gone('a2')]); // the body of a gone process, then the watch's end, then the state
    watchEnded(D);
    holderOf(D, { kind: 'none' });
    applyLaneAState(D, null);
    expect(statusesOf(D)).toEqual({ a1: 'completed', a2: 'exited' });
    setStatusOf(D, earlierRun(D)); // the earlier run's exited status, reaching the page after the noting
    expect(statusesOf(D)).toEqual({ a1: 'completed', a2: 'exited' });
    expect(useLaneA.getState().agents.get(D)?.agents).toHaveLength(2);
  });

  it('a launch by this app after the terminal’s run discards the noted statuses for good: its frames are read, and they do not return when that process exits', async () => {
    setStatusOf(D, earlierRun(D));
    store.getState().watch(D);
    await fake.answer('events', { events: [], lastSeq: 0, complete: true });
    await fake.answer('subagents', [sidecar('a1')]);
    await fake.answer('workflows', []);
    await flush();
    plane(D, 'snapshot', [gone('a1')]);
    watchEnded(D);
    holderOf(D, { kind: 'none' });
    applyLaneAState(D, null);
    expect(statusesOf(D)).toEqual({ a1: 'exited' });
    holderOf(D, { kind: 'self' });
    setStatusOf(D, { ...status(D), launchId: 'second', launchedAt: LATER });
    expect(useLaneA.getState().agents.get(D)).toBeUndefined();
    await fake.answer('events', { events: [event('subagent.started', { taskId: 'fresh' }, { seq: 1, launch: 'second' })], lastSeq: 1, complete: true });
    expect(statusesOf(D)).toEqual({ a1: 'unknown', fresh: 'running' });
    holderOf(D, { kind: 'none' });
    setStatusOf(D, { ...status(D), launchId: 'second', launchedAt: LATER, process: 'exited' });
    expect(statusesOf(D)).toEqual({ a1: 'unknown', fresh: 'exited' });
    expect(useLaneA.getState().agents.get(D)).toBeUndefined();
  });

  it('a launch by this app that came and went while nobody watched the graph discards them all the same', async () => {
    const release = await watchDisk(D, [sidecar('a1')]);
    plane(D, 'snapshot', [completed('a1')]);
    watchEnded(D);
    holderOf(D, { kind: 'none' });
    applyLaneAState(D, null);
    release();
    holderOf(D, { kind: 'self' });
    expect(useLaneA.getState().agents.get(D)).toBeUndefined(); // the holder's change, watched or not
    holderOf(D, { kind: 'none' });
    setStatusOf(D, { ...status(D), launchId: 'second', launchedAt: LATER, process: 'exited' });
    store.getState().watch(D);
    expect(useLaneA.getState().agents.get(D)).toBeUndefined();
    expect(statusesOf(D)).toEqual({ a1: 'unknown' });
  });

  it('leaves a session bound to another machine’s feed as its feed draws it, whatever this page noted for it', async () => {
    const R = addressOf(OTHER_MACHINE, 'eng-r' as AppSessionId);
    const fed = applyTaskEvents(emptyGraph(), [event('subagent.started', { taskId: 'r1' }, { seq: 1 })]);
    const off = registerRemoteTaskFeed((id) => (id === R ? (onGraph) => (onGraph(fed), () => {}) : null));
    noteLaneAAgents(R, [completed('r1')], null);
    store.getState().watch(R);
    expect(entryOf(R).graph).toBe(fed);
    noteLaneAAgents(R, [gone('r1')], null);
    expect(entryOf(R).graph).toBe(fed);
    off();
  });
});
