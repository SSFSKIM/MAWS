// The task-graph store (C8b execution document, Interfaces *The task-graph store*): one task graph per session, fed
// through the agent-work client alone. A session with a status (C5's `useSessions().engine`, the one place the renderer
// applies `session.status`) is live: its graph takes the live form only, the batches subscribed before one
// `session.events` snapshot, each event filtered by its own `seq` against a cursor kept per launch. A session without
// one is disk-only and never calls `session.events`. Both read the engine store's sidecars and workflow runs, merged
// after the wire. Stop marks the node, calls `session.stopTask` and removes a node only under the resolution rule: the
// call resolved, the id absent from the status's list, no terminal frame within STOP_SETTLE_MS. The store never reads
// C6's transcript store: the two reducers see the same events and agree by construction.
//
// UX wave U8d (docs/doperpowers/plans/2026-11-15-ux-wave-U8d-terminal-subagents.md, M3 and Interfaces §C): a terminal
// session this Mac drives has its subagents' statuses derived in main and carried by its lane A watch (the lane A store
// keeps them, `noteLaneAAgents`). For a session bound to this machine's reads the store publishes the graph those reads
// built with them laid over it (`withStatuses`), and keeps the reads' graph apart: every reduction of its own starts from
// it, so a later body is never laid over an earlier one. They stand only while the holder their body names holds the
// session, or nothing does, or no record says yet (`heldByOrigin`; the lane A store discards them at any other holder);
// any binding of a session of this Mac to another machine's feed, the first one included, discards them too. While the
// graph is watched and the session's bridge is live or starting, the store holds the session's lane A watch, so the
// panel alone keeps the body coming.
import { create } from 'zustand';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, TaskId } from '@shared/graph/ids';
import type { SubagentEntry, WorkflowRun } from '@shared/ipc/schema/fs';
import type { LaneAAgent } from '@shared/lane-a/agents';
import { isAddress, machineOf } from '@shared/machine/address';
import { ipc } from '../../ipc/client';
import { sameTasks, withStatuses, type StatusedMeta } from '../../lane-a/agents/task-feed';
import { watchLaneA } from '../../lane-a/watches';
import { forgetLaneAAgents, heldByOrigin, useLaneA } from '../../stores/lane-a';
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

// P5 O9 M9: another machine's terminal session has no engine status, journal or disk here; its tree and statuses come
// from its plane transcript (the DX4 metas and statuses over the held rows), fed by whoever registers the feed
// (`lane-a/remote-agents.ts`). A feed answers null for a session it does not serve, which the store reads as before.
export type RemoteTaskFeed = (appSessionId: AppSessionId) => ((onGraph: (graph: TaskGraph) => void) => () => void) | null;
let remoteFeed: RemoteTaskFeed | null = null;
export function registerRemoteTaskFeed(feed: RemoteTaskFeed): () => void {
  remoteFeed = feed;
  return () => {
    if (remoteFeed === feed) remoteFeed = null;
  };
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

const thisMac = (id: AppSessionId): boolean => isAddress(id) && machineOf(id) === ipc.localMachine;
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
  remote: boolean; // P5 O9 M9: bound to another machine's plane (the remote feed), not this machine's reads
  laid: { reads: TaskGraph; agents: readonly LaneAAgent[]; published: TaskGraph } | null; // U8d: the last overlay published
  binding: number; // bumped at each rebind, so a disk read the old binding started is dropped
}

export function createTaskGraphStore({ sessions = useSessions }: { sessions?: typeof useSessions } = {}) {
  const watches = new Map<AppSessionId, Watch>();
  const watchOf = (id: AppSessionId): Watch => {
    let w = watches.get(id);
    if (!w) watches.set(id, (w = { watchers: 0, offs: [], wire: false, held: null, generation: 0, cursorN: Infinity, frozen: null, status: null, settle: new Map(), workflowTimer: null, initializing: false, remote: false, binding: 0, laid: null }));
    return w;
  };

  return create<TaskGraphStore>()((set, get) => {
    const blank = (): TaskGraphEntry => ({
      graph: emptyGraph(), phase: 'idle', launchId: null, lastSeq: null, error: null, disk: { agents: null, runs: null, error: null, runsError: null }, pendingStops: new Map(),
    });
    const read = (id: AppSessionId) => get().entries.get(id) ?? blank();

    // U8d: the session's noted lane A agents, unless the session is bound to another machine's feed (whose graph carries
    // them already) or its holder is no longer the process their body named.
    const layable = (id: AppSessionId): readonly LaneAAgent[] | null => {
      const noted = watchOf(id).remote ? undefined : useLaneA.getState().agents.get(id);
      if (noted === undefined || noted.agents.length === 0) return null;
      return heldByOrigin(sessions.getState().records.get(id)?.holder, noted.origin) ? noted.agents : null;
    };
    // The graph to publish for the reads' graph: the same object again when neither it nor the agents changed.
    const publish = (id: AppSessionId, reads: TaskGraph): TaskGraph => {
      const w = watchOf(id);
      const agents = layable(id);
      if (agents === null) {
        w.laid = null;
        return reads;
      }
      const last = w.laid;
      if (last !== null && last.reads === reads && last.agents === agents) return last.published;
      // the body crossed IPC as JSON, so each meta is the JSON object DX4's type names
      const laid = withStatuses(reads, agents as readonly StatusedMeta[]);
      // a body whose change alters no node (what a status rests on, say) publishes the same graph again
      const published = last !== null && last.reads === reads && sameTasks(last.published, laid) ? last.published : laid;
      w.laid = { reads, agents, published };
      return published;
    };
    // The graph the store's own reads built: the published one, unless that is the overlay last laid over them.
    const readsOf = (id: AppSessionId): TaskGraph => {
      const published = read(id).graph;
      const laid = watchOf(id).laid;
      return laid !== null && laid.published === published ? laid.reads : published;
    };

    // Writes only what changed, so an event that changes nothing leaves the entry (and its graph) the same object. A
    // graph written is the reads' graph; what is published is `publish`'s.
    const write = (id: AppSessionId, given: Partial<TaskGraphEntry>) => {
      const patch = given.graph === undefined ? given : { ...given, graph: publish(id, given.graph) };
      const held = get().entries.get(id);
      const current = held ?? blank();
      if (held && (Object.keys(patch) as (keyof TaskGraphEntry)[]).every((key) => current[key] === patch[key])) return;
      set({ entries: new Map(get().entries).set(id, { ...current, ...patch }) });
    };

    // A pending stop ends with its task: the terminal frame (or the exit) arrived, or the node is gone.
    const settleEnded = (id: AppSessionId) => {
      const e = read(id);
      const graph = readsOf(id);
      const ended = [...e.pendingStops.keys()].filter((taskId) => graph.tasks.get(taskId)?.status !== 'running');
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
          write(id, { graph: removeTask(readsOf(id), taskId), pendingStops }); // the engine answered success for an id it no longer knows
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
      write(id, { graph: applyTaskEvents(readsOf(id), accepted), lastSeq });
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
      write(id, { graph: mergeRuns(mergeSidecars(readsOf(id), e.disk.agents ?? []), e.disk.runs ?? []) });
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
      let graph = readsOf(id);
      if (patch.agents) graph = mergeSidecars(graph, patch.agents);
      if (patch.runs) graph = mergeRuns(graph, patch.runs);
      write(id, { disk: { ...e.disk, ...patch }, graph });
    };

    // A read's answer is dropped once its watch was rebound (P5 O9 M9: the session found to be another machine's, or no longer).
    const current = (id: AppSessionId) => {
      const binding = watchOf(id).binding;
      return (apply: () => void) => {
        if (watchOf(id).binding === binding) apply();
      };
    };

    const readRuns = (id: AppSessionId) => {
      const still = current(id);
      agentWorkClient()
        .workflows(id)
        .then(
          (runs) => still(() => applyDisk(id, { runs, runsError: null })),
          (error: unknown) => still(() => applyDisk(id, { runsError: messageOf(error) })),
        );
    };

    const readDisk = (id: AppSessionId) => {
      const still = current(id);
      agentWorkClient()
        .subagents(id)
        .then(
          (agents) => still(() => applyDisk(id, { agents, error: null })),
          (error: unknown) => still(() => applyDisk(id, { error: messageOf(error) })),
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
      let graph = readsOf(id);
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

    // The current binding's subscriptions let go: its reads and a snapshot still in flight are dropped.
    const unbind = (id: AppSessionId) => {
      const w = watchOf(id);
      w.offs.forEach((off) => off());
      w.offs = [];
      if (w.workflowTimer) clearTimeout(w.workflowTimer);
      w.workflowTimer = null;
      w.wire = false;
      w.held = null;
      w.generation += 1; // nobody holds the session: a snapshot still in flight is dropped, and the next watch reads again
    };

    const release = (id: AppSessionId) => {
      const w = watchOf(id);
      w.watchers -= 1;
      if (w.watchers > 0) return;
      unbind(id);
    };

    // P5 O9 M9: another machine's terminal session reads its tree from its plane (the remote feed); every other session
    // reads this machine's engine and disk.
    const bindRemote = (id: AppSessionId, remote: (onGraph: (graph: TaskGraph) => void) => () => void) => {
      const w = watchOf(id);
      w.remote = true;
      // U8d: a session of this Mac handed to that machine: what this Mac's driver said of it is that machine's to say
      // now (a session's watch goes to the driver of the machine its address names: what is noted for it is that one's)
      if (thisMac(id)) forgetLaneAAgents(id);
      write(id, { phase: 'loading', disk: { agents: [], runs: [], error: null, runsError: null } }); // no disk here to read
      w.offs.push(remote((graph) => write(id, { graph, phase: 'live', error: null })));
    };

    const bindLocal = (id: AppSessionId) => {
      const w = watchOf(id);
      w.remote = false;
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
          // P4: main refuses the runs read until it has registered the session (a new chat's start registers it a
          // moment after the watch asked); a refused read is asked again once the record arrives
          if (state.records.has(id) && !previous.records.has(id) && read(id).disk.runsError !== null) readRuns(id);
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
      // U8d: the statuses its watch carries, laid again as they change, and the watch held while the bridge of a session
      // this Mac drives is up
      let laneA: (() => void) | null = null;
      const holdLaneA = () => {
        const bridge = useLaneA.getState().states.get(id)?.bridge;
        const up = (bridge === 'live' || bridge === 'starting') && thisMac(id);
        if (up && laneA === null) laneA = watchLaneA(id, () => {});
        else if (!up && laneA !== null) {
          laneA();
          laneA = null;
        }
      };
      w.offs.push(
        useLaneA.subscribe((state, before) => {
          if (state.agents.get(id) !== before.agents.get(id)) write(id, { graph: readsOf(id) });
          if (state.states.get(id) !== before.states.get(id)) holdLaneA();
        }),
        () => {
          laneA?.();
          laneA = null;
        },
      );
      write(id, { graph: readsOf(id) });
      holdLaneA();
      if (w.status) startWire(id);
      readDisk(id);
    };

    const bind = (id: AppSessionId) => {
      const remote = remoteFeed?.(id) ?? null;
      if (remote !== null) bindRemote(id, remote);
      else bindLocal(id);
      // P5 O9 M9: a session restored with the tool open is watched before O8's listing arrives (layout hydration does not
      // wait for it), so the watch follows the session's transport as the listing and the records change.
      watchOf(id).offs.push(
        sessions.subscribe((state, previous) => {
          if (state.listed === previous.listed && state.records === previous.records) return;
          if (((remoteFeed?.(id) ?? null) !== null) === watchOf(id).remote) return;
          unbind(id);
          watchOf(id).binding += 1; // a disk read the old binding started is dropped
          write(id, { graph: emptyGraph(), launchId: null, lastSeq: null, error: null, disk: { agents: null, runs: null, error: null, runsError: null }, pendingStops: new Map() });
          watchOf(id).status = null;
          bind(id);
        }),
      );
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
        bind(id);
        return handle;
      },

      applyStatus,
      applyDisk,

      async stop(id, taskId) {
        const e = read(id);
        const graph = readsOf(id);
        if (graph.tasks.get(taskId)?.stopping) return { ok: true };
        write(id, { graph: setStopping(graph, taskId, true), pendingStops: new Map(e.pendingStops).set(taskId, { requestedAt: nowIso(), resolvedAt: null, absentAtResolution: false }) });
        try {
          await agentWorkClient().stopTask(id, taskId);
        } catch (error) {
          const current = read(id);
          if (!current.pendingStops.has(taskId)) return { ok: true }; // the terminal frames came first: the task stopped
          const pendingStops = new Map(current.pendingStops);
          pendingStops.delete(taskId);
          write(id, { graph: setStopping(readsOf(id), taskId, false), pendingStops });
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
