import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId, TaskId } from '@shared/graph/ids';
import { status } from '../../../../../test/support/builders';
import { createSessionsStore } from '../../stores/sessions';
import { setAgentWorkClient } from './client';
import { createTaskGraphStore, STOP_SETTLE_MS } from './store';
import { event, replayed, sidecarsOf, upTo } from '../../../../../test/support/agents-events';
import { fakeAgentWorkClient, flush, type FakeAgentWorkClient } from './fake-work-client';

const A = 'A' as AppSessionId;
const pass1 = replayed('pass1', 'subagent');
const ONE = 'ad286defbc77bc090' as TaskId;
const TWO = 'ae75ba6ce5d866acc' as TaskId;
const bgTask = (taskId: string) => ({ taskId: taskId as TaskId, taskType: 'local_bash', description: taskId, ambient: false });

let fake: FakeAgentWorkClient;
let sessions: ReturnType<typeof createSessionsStore>;
let store: ReturnType<typeof createTaskGraphStore>;

const live = (over: Partial<EngineSessionStatus> = {}): EngineSessionStatus => ({ ...status('A'), launchId: 'journal', ...over });
const setStatus = (s: EngineSessionStatus) => sessions.getState().applyStatus({ appSessionId: A, status: s });
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
      setStatus(live({ process: 'exited', exit: { code: 0, signal: null, reason: 'quit', at: '2026-09-29T12:00:00.000Z' } }));
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
