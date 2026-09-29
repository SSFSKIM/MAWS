// The task-graph store (C8b execution document, Interfaces *The task-graph store*): one task graph per session, fed
// through the agent-work client alone. A session with a status (C5's `useSessions().engine`, the one place the renderer
// applies `session.status`) is live: its graph takes the live form only, the batches subscribed before one
// `session.events` snapshot, each event filtered by its own `seq` against a cursor kept per launch. A session without
// one is disk-only and never calls `session.events`. Both read the engine store's sidecars and workflow runs, merged
// after the wire. Stop marks the node, calls `session.stopTask` and removes a node only under the resolution rule: the
// call resolved, the id absent from the status's list, no terminal frame within STOP_SETTLE_MS. The store never reads
// C6's transcript store: the two reducers see the same events and agree by construction.
import { create } from 'zustand';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, TaskId } from '@shared/graph/ids';
import type { SubagentEntry, WorkflowRun } from '@shared/ipc/schema/fs';
import { useSessions } from '../../stores/sessions';
import { agentWorkClient } from './client';
import { applySnapshot, applyTaskEvents, emptyGraph, markExited, mergeRuns, mergeSidecars, removeTask, setStopping, TASK_EVENT_KINDS, type TaskGraph } from './model/task-graph';

export interface PendingStop {
  requestedAt: string;
  resolvedAt: string | null;
  absentAtResolution: boolean;
}

export interface TaskGraphEntry {
  graph: TaskGraph;
  phase: 'idle' | 'loading' | 'live' | 'disk' | 'failed';
  launchId: string | null;
  lastSeq: number | null;
  error: string | null;
  disk: { agents: SubagentEntry[] | null; runs: WorkflowRun[] | null; error: string | null; runsError: string | null }; // error: fs.subagents'; runsError: fs.workflows'
  pendingStops: Map<TaskId, PendingStop>;
}

export interface TaskGraphStore {
  entries: Map<AppSessionId, TaskGraphEntry>;
  watch(appSessionId: AppSessionId): () => void; // ref-counted; the last release stops the subscriptions and keeps the entry
  applyStatus(appSessionId: AppSessionId, status: EngineSessionStatus | null): void; // from the useSessions subscription
  applyDisk(appSessionId: AppSessionId, patch: Partial<TaskGraphEntry['disk']>): void; // fs.subagentsChanged, and re-reads after fs.workflowChanged
  stop(appSessionId: AppSessionId, taskId: TaskId): Promise<{ ok: true } | { ok: false; message: string }>;
}

// After a resolved stop whose id the status no longer lists, how long the store waits for a terminal frame before
// removing the node (R6: the frames came 3-9 ms after the request, before the answer, for all three kinds).
export const STOP_SETTLE_MS = 2000;
const WORKFLOW_REREAD_MS = 250; // fs.workflowChanged fires per write of a run's snapshot; one trailing re-read

// The launch segment and the place in its journal row of a live event id, `<app>:<launch>:<seq>:<n>` (read from the
// right: the app id is opaque).
export function launchOf(eventId: string): string | null {
  const parts = eventId.split(':');
  return parts.length >= 4 ? parts[parts.length - 3] : null;
}
export function placeInRow(eventId: string): number {
  const n = Number(eventId.slice(eventId.lastIndexOf(':') + 1));
  return Number.isInteger(n) ? n : 0;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const nowIso = () => new Date().toISOString();

// What the store keeps per session outside its state: the subscriptions and timers a watch owns.
interface Watch {
  watchers: number;
  offs: (() => void)[];
  wire: boolean; // the wire half runs: a status is applied and a watcher holds the session
  held: SessionEvent[][] | null; // batches that arrived while the snapshot was being read
  generation: number; // bumped per snapshot read, at the last release and when the status goes, so a stale answer is dropped
  cursorN: number; // the cursor's place within row `lastSeq`: +Infinity after a snapshot (whole rows), else the last event's n
  frozen: { lastSeq: number | null; cursorN: number } | null; // after a failed snapshot: the cursor stays here, so the next watch re-reads the launch
  status: EngineSessionStatus | null; // the latest applied: the stop's absence check reads it alone
  settle: Map<TaskId, ReturnType<typeof setTimeout>>;
  workflowTimer: ReturnType<typeof setTimeout> | null;
  initializing: boolean;
}

export function createTaskGraphStore({ sessions = useSessions }: { sessions?: typeof useSessions } = {}) {
  const watches = new Map<AppSessionId, Watch>();
  const watchOf = (id: AppSessionId): Watch => {
    let w = watches.get(id);
    if (!w) watches.set(id, (w = { watchers: 0, offs: [], wire: false, held: null, generation: 0, cursorN: Infinity, frozen: null, status: null, settle: new Map(), workflowTimer: null, initializing: false }));
    return w;
  };

  return create<TaskGraphStore>()((set, get) => {
    const blank = (): TaskGraphEntry => ({
      graph: emptyGraph(), phase: 'idle', launchId: null, lastSeq: null, error: null, disk: { agents: null, runs: null, error: null, runsError: null }, pendingStops: new Map(),
    });
    const read = (id: AppSessionId) => get().entries.get(id) ?? blank();
    // Writes only what changed, so an event that changes nothing leaves the entry (and its graph) the same object.
    const write = (id: AppSessionId, patch: Partial<TaskGraphEntry>) => {
      const held = get().entries.get(id);
      const current = held ?? blank();
      if (held && (Object.keys(patch) as (keyof TaskGraphEntry)[]).every((key) => current[key] === patch[key])) return;
      set({ entries: new Map(get().entries).set(id, { ...current, ...patch }) });
    };

    // A pending stop ends with its task: the terminal frame (or the exit) arrived, or the node is gone.
    const settleEnded = (id: AppSessionId) => {
      const e = read(id);
      const ended = [...e.pendingStops.keys()].filter((taskId) => e.graph.tasks.get(taskId)?.status !== 'running');
      if (ended.length === 0) return;
      const pendingStops = new Map(e.pendingStops);
      const w = watchOf(id);
      for (const taskId of ended) {
        pendingStops.delete(taskId);
        clearTimeout(w.settle.get(taskId));
        w.settle.delete(taskId);
      }
      write(id, { pendingStops });
    };

    const scheduleRemoval = (id: AppSessionId, taskId: TaskId) => {
      const w = watchOf(id);
      if (w.settle.has(taskId)) return;
      w.settle.set(
        taskId,
        setTimeout(() => {
          w.settle.delete(taskId);
          const e = read(id);
          if (!e.pendingStops.has(taskId)) return;
          const pendingStops = new Map(e.pendingStops);
          pendingStops.delete(taskId);
          write(id, { graph: removeTask(e.graph, taskId), pendingStops }); // the engine answered success for an id it no longer knows
        }, STOP_SETTLE_MS),
      );
    };

    // The absence check reads the status alone (never a tasks.snapshot event), for every stop resolved and pending.
    const checkAbsence = (id: AppSessionId) => {
      const w = watchOf(id);
      const e = read(id);
      for (const [taskId, pending] of e.pendingStops) {
        if (pending.resolvedAt === null) continue;
        const listed = w.status?.backgroundTasks.some((t) => t.taskId === taskId) ?? false;
        if (!listed) scheduleRemoval(id, taskId);
        else if (w.settle.has(taskId)) {
          clearTimeout(w.settle.get(taskId));
          w.settle.delete(taskId);
        }
      }
    };

    // Live-form events of this launch above the cursor, dropping the kinds the reducer does not read before they reach
    // the graph, whatever their agentId. The cursor is (seq, place in the row): one journal row yields several events
    // with one seq, and C3's batcher can split a row across two batches, while a snapshot answers whole rows.
    const applyWire = (id: AppSessionId, events: SessionEvent[], snapshotLastSeq: number | null = null) => {
      const w = watchOf(id);
      const e = read(id);
      let lastSeq = e.lastSeq;
      let cursorN = w.cursorN;
      const accepted: SessionEvent[] = [];
      for (const ev of events) {
        if (ev.seq === null || launchOf(ev.id) !== e.launchId) continue;
        const n = placeInRow(ev.id);
        if (lastSeq !== null && (ev.seq < lastSeq || (ev.seq === lastSeq && n <= cursorN))) continue;
        if (lastSeq === null || ev.seq > lastSeq) cursorN = n;
        else cursorN = Math.max(cursorN, n);
        lastSeq = ev.seq;
        if (TASK_EVENT_KINDS.has(ev.kind)) accepted.push(ev);
      }
      if (snapshotLastSeq !== null && (lastSeq === null || snapshotLastSeq >= lastSeq)) {
        lastSeq = snapshotLastSeq;
        cursorN = Infinity;
      }
      if (w.frozen) ({ lastSeq, cursorN } = w.frozen); // the events apply; the cursor does not pass what no snapshot covered
      w.cursorN = cursorN;
      write(id, { graph: applyTaskEvents(e.graph, accepted), lastSeq });
      settleEnded(id);
    };

    const onBatch = (id: AppSessionId, events: SessionEvent[]) => {
      const w = watchOf(id);
      if (!w.wire) return; // a disk-only session reads no wire
      if (w.held) w.held.push(events);
      else applyWire(id, events);
    };

    const remergeDisk = (id: AppSessionId) => {
      const e = read(id);
      write(id, { graph: mergeRuns(mergeSidecars(e.graph, e.disk.agents ?? []), e.disk.runs ?? []) });
    };

    // One snapshot of this launch from the cursor, then the held batches and every later one.
    const startWire = (id: AppSessionId) => {
      const w = watchOf(id);
      w.wire = true;
      w.held = [];
      const generation = ++w.generation;
      w.frozen = null;
      write(id, { phase: 'loading' });
      const replayHeld = () => {
        const held = w.held ?? [];
        w.held = null;
        for (const batch of held) applyWire(id, batch);
      };
      const lastSeq = read(id).lastSeq;
      agentWorkClient()
        .events(id, lastSeq !== null && w.cursorN !== Infinity ? lastSeq - 1 : lastSeq) // a cursor left mid-row reads that row again
        .then(
          (snapshot) => {
            if (w.generation !== generation) return;
            applyWire(id, snapshot.events, snapshot.lastSeq);
            replayHeld();
            write(id, { phase: 'live', error: null });
            remergeDisk(id);
          },
          (error: unknown) => {
            if (w.generation !== generation) return;
            write(id, { phase: 'failed', error: messageOf(error) });
            // Later facts are still facts, but the launch's earlier events are missing: the cursor stays where the
            // snapshot would have started, so the next watch re-reads the whole launch and the reducer converges on it.
            w.frozen = { lastSeq: read(id).lastSeq, cursorN: w.cursorN };
            replayHeld();
          },
        );
    };

    const applyDisk = (id: AppSessionId, patch: Partial<TaskGraphEntry['disk']>) => {
      const e = read(id);
      let graph = e.graph;
      if (patch.agents) graph = mergeSidecars(graph, patch.agents);
      if (patch.runs) graph = mergeRuns(graph, patch.runs);
      write(id, { disk: { ...e.disk, ...patch }, graph });
    };

    const readRuns = (id: AppSessionId) => {
      agentWorkClient()
        .workflows(id)
        .then(
          (runs) => applyDisk(id, { runs, runsError: null }),
          (error: unknown) => applyDisk(id, { runsError: messageOf(error) }),
        );
    };

    const readDisk = (id: AppSessionId) => {
      agentWorkClient()
        .subagents(id)
        .then(
          (agents) => applyDisk(id, { agents, error: null }),
          (error: unknown) => applyDisk(id, { error: messageOf(error) }),
        );
      readRuns(id);
    };

    const applyStatus = (id: AppSessionId, status: EngineSessionStatus | null) => {
      const w = watchOf(id);
      w.status = status;
      const e = read(id);
      if (status === null) {
        w.wire = false;
        w.held = null;
        w.generation += 1; // a snapshot still in flight is stale now
        write(id, { phase: 'disk' });
        return;
      }
      let graph = e.graph;
      const patch: Partial<TaskGraphEntry> = {};
      let relaunched = false;
      if (e.launchId !== status.launchId) {
        if (e.launchId !== null) {
          // A relaunch of the same app session: the old launch's running nodes were the old process's, and its cursor means
          // nothing to the new journal.
          graph = markExited(graph, status.launchedAt);
          patch.lastSeq = null;
          relaunched = true;
        }
        patch.launchId = status.launchId;
      }
      graph = applySnapshot(graph, status.backgroundTasks); // after the relaunch's exit mark, so the new launch's tasks stay running
      if (status.process === 'exited') graph = markExited(graph, status.exit?.at ?? nowIso());
      write(id, { ...patch, graph });
      settleEnded(id);
      checkAbsence(id);
      if (w.watchers > 0 && !w.initializing && (relaunched || !w.wire)) startWire(id);
    };

    const release = (id: AppSessionId) => {
      const w = watchOf(id);
      w.watchers -= 1;
      if (w.watchers > 0) return;
      w.offs.forEach((off) => off());
      w.offs = [];
      if (w.workflowTimer) clearTimeout(w.workflowTimer);
      w.workflowTimer = null;
      w.wire = false;
      w.held = null;
      w.generation += 1; // nobody holds the session: a snapshot still in flight is dropped, and the next watch reads again
    };

    return {
      entries: new Map(),

      watch(id) {
        const w = watchOf(id);
        w.watchers += 1;
        let released = false;
        const handle = () => {
          if (released) return;
          released = true;
          release(id);
        };
        if (w.watchers > 1) return handle;
        write(id, {});
        const client = agentWorkClient();
        w.offs.push(client.onEventBatch(({ appSessionId, events }) => appSessionId === id && onBatch(id, events)));
        // The current status first, the launch check among it, so a relaunch while nobody watched resets the cursor
        // before any snapshot is read.
        w.initializing = true;
        applyStatus(id, sessions.getState().engine.get(id) ?? null);
        w.initializing = false;
        w.offs.push(
          sessions.subscribe((state, previous) => {
            const next = state.engine.get(id);
            if (next !== previous.engine.get(id)) applyStatus(id, next ?? null);
          }),
        );
        w.offs.push(client.onSubagentsChanged(({ appSessionId, agents }) => appSessionId === id && applyDisk(id, { agents, error: null })));
        w.offs.push(
          client.onWorkflowChanged(({ appSessionId }) => {
            if (appSessionId !== id) return;
            if (w.workflowTimer) clearTimeout(w.workflowTimer);
            w.workflowTimer = setTimeout(() => {
              w.workflowTimer = null;
              readRuns(id);
            }, WORKFLOW_REREAD_MS);
          }),
        );
        if (w.status) startWire(id);
        readDisk(id);
        return handle;
      },

      applyStatus,
      applyDisk,

      async stop(id, taskId) {
        const e = read(id);
        if (e.graph.tasks.get(taskId)?.stopping) return { ok: true };
        write(id, { graph: setStopping(e.graph, taskId, true), pendingStops: new Map(e.pendingStops).set(taskId, { requestedAt: nowIso(), resolvedAt: null, absentAtResolution: false }) });
        try {
          await agentWorkClient().stopTask(id, taskId);
        } catch (error) {
          const current = read(id);
          if (!current.pendingStops.has(taskId)) return { ok: true }; // the terminal frames came first: the task stopped
          const pendingStops = new Map(current.pendingStops);
          pendingStops.delete(taskId);
          write(id, { graph: setStopping(current.graph, taskId, false), pendingStops });
          return { ok: false, message: messageOf(error) };
        }
        const current = read(id);
        const pending = current.pendingStops.get(taskId);
        if (!pending) return { ok: true };
        const absent = !(watchOf(id).status?.backgroundTasks.some((t) => t.taskId === taskId) ?? false);
        write(id, { pendingStops: new Map(current.pendingStops).set(taskId, { ...pending, resolvedAt: nowIso(), absentAtResolution: absent }) });
        if (absent) scheduleRemoval(id, taskId);
        return { ok: true };
      },
    };
  });
}

export const useTaskGraph = createTaskGraphStore();
