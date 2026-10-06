// The `#panel` harness's agent-work client (C8b execution document, Interfaces *Harness API*; M4): the whole
// `AgentWorkClient` over fixture data, installed with `setAgentWorkClient` so the task-graph store, the relay store, the
// checklist and the Log reach nothing real. Its disk half serves the fake session's sidecars, workflow runs, task lists
// and spills (`fakeFs`), announcing each change as C4's `fs.*Changed` events would, since main refuses `fs.*` for the
// fake ids; its wire half is bound by `feed` to the loaded fixture's player, so the task graph and the relay see the
// stream the transcript sees (until then `session.events` answers nothing, as a session whose stream is not connected
// yet); its command half records the relay's steers and Stop's calls, a stop answered as `answerStop` set it. E7: its
// files half serves the fake session's project files (the durable cron file) to `files.read` with their hash and
// `utf8` as main answers `hash: true` (E5's rule), finds every directory a watch names, and announces each file
// `fakeFs` sets as `files.changed`; a refusal staged for a path is answered with its message (M7), the session's roots
// (`roots`, its record's directory) still resolving, as main's are when it refuses a path for its own reason.
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, EventId, MessageUuid } from '@shared/graph/ids';
import type { EventPayload } from '@shared/ipc/schema';
import type { FsReadSpillInput, FsReadSpillOutput, SubagentEntry, WorkflowRun } from '@shared/ipc/schema/fs';
import type { EventsSnapshot } from '@shared/ipc/schema/session';
import type { FilesChanged } from '@shared/ipc/schema/files'; // E7
import type { PersistedTask } from '@shared/wire/store';
import type { AgentWorkClient } from '../../tools/agents/client';
import { FAKE_STOP_REFUSAL, type AgentsHarnessCalls } from './api';

export { FAKE_STOP_REFUSAL } from './api';

export interface FakeDisk {
  sidecars: SubagentEntry[];
  runs: WorkflowRun[];
  tasks: Record<string, PersistedTask[]>; // by list id
  spills: Record<string, string>; // by path
  files: Record<string, string>; // E7: the session's project files by path (the durable cron file)
  refusals: Record<string, string>; // E7 (M7): a `files.read` refusal's message by path, ahead of any file there
}

// A session's wire: the snapshot `session.events` answers and the batches `session.eventBatch` carries.
export interface FakeWire {
  snapshot(afterSeq: number | null): EventsSnapshot;
  subscribe(listener: (events: SessionEvent[]) => void): () => void;
}

export interface FakeAgentWorkClient {
  client: AgentWorkClient;
  fakeFs(data: Partial<FakeDisk>): void; // merged into the disk half (by agent id, run id, list id, path) and announced
  announceDisk(): void; // the disk half's change events again (a store entry started over re-merges them)
  bindWire(appSessionId: AppSessionId, wire: FakeWire | null): void;
  answerStop(taskId: string, outcome: 'ok' | 'error'): void;
  calls(): AgentsHarnessCalls;
  idle(): Promise<void>; // resolves once no spill read or stop is in flight
}

const SPILL_NOT_FOUND = 'spill not found';

// E7: a stand-in for main's SHA-256 (64 lowercase hex), a function of the text alone.
function fakeFileHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0').repeat(8);
}

// `session.events { afterSeq, limit: null }` over a replayed fixture: the fixture's own events the transcript has applied
// (`released` holds their ids), in fixture order, above `afterSeq`; `lastSeq` the highest kept (whole rows: the player
// releases a load's history below a seq, and a later release is a batch the store filters by its own cursor).
export function snapshotOf(events: SessionEvent[], released: ReadonlySet<EventId>, afterSeq: number | null): EventsSnapshot {
  const kept = events.filter((event) => event.seq !== null && released.has(event.id) && (afterSeq === null || event.seq > afterSeq));
  const lastSeq = Math.max(afterSeq ?? 0, ...kept.map((event) => event.seq!));
  return { events: kept, lastSeq, complete: true };
}

// A page of `text` as C4's `fs.readSpill` answers it, one byte short of the request unless it reaches the end (so the
// e2e sees pages chained by the answered `length`), and never ending inside a UTF-8 character.
function page(text: string, { offset = 0, length = 1024 * 1024 }: FsReadSpillInput): FsReadSpillOutput {
  const bytes = new TextEncoder().encode(text);
  let end = Math.min(bytes.length, offset + length);
  if (end < bytes.length) end -= 1;
  while (end > offset && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return { content: new TextDecoder().decode(bytes.slice(offset, end)), bytes: bytes.length, offset, length: end - offset, truncated: end < bytes.length };
}

const upsert = <T>(list: T[], items: T[] | undefined, key: (item: T) => string): T[] => {
  if (!items) return list;
  const next = new Map(list.map((item) => [key(item), item]));
  for (const item of items) next.set(key(item), item);
  return [...next.values()];
};

export function createFakeAgentWorkClient(init: { session: AppSessionId; roots?: string[] } & Partial<FakeDisk>): FakeAgentWorkClient {
  const disk: FakeDisk = { sidecars: [], runs: [], tasks: {}, spills: {}, files: {}, refusals: {} };
  const recorded: AgentsHarnessCalls = { steer: [], stopTask: [], readSpill: [] };
  const stopAnswers = new Map<string, 'ok' | 'error'>();
  const inFlight = new Set<Promise<unknown>>();
  let steers = 0;

  const batchListeners = new Set<(batch: { appSessionId: AppSessionId; events: SessionEvent[] }) => void>();
  const subagentListeners = new Set<(payload: EventPayload<'fs.subagentsChanged'>) => void>();
  const workflowListeners = new Set<(payload: EventPayload<'fs.workflowChanged'>) => void>();
  const taskListeners = new Set<(payload: EventPayload<'fs.tasksChanged'>) => void>();
  const filesListeners = new Set<(payload: FilesChanged) => void>(); // E7
  const listen = <L>(set: Set<L>, listener: L) => {
    set.add(listener);
    return () => void set.delete(listener);
  };

  const wires = new Map<AppSessionId, { wire: FakeWire; off: () => void }>();
  const waiting = new Map<AppSessionId, ((wire: FakeWire) => void)[]>(); // session.events before the wire was bound

  const track = <T>(promise: Promise<T>): Promise<T> => {
    inFlight.add(promise);
    const done = () => void inFlight.delete(promise);
    promise.then(done, done);
    return promise;
  };
  const ours = (appSessionId: AppSessionId) => appSessionId === init.session;

  const announce = (changed: Partial<FakeDisk>) => {
    if (changed.sidecars) subagentListeners.forEach((l) => l({ appSessionId: init.session, agents: disk.sidecars }));
    for (const run of changed.runs ?? []) workflowListeners.forEach((l) => l({ appSessionId: init.session, runId: run.runId }));
    for (const listId of Object.keys(changed.tasks ?? {})) taskListeners.forEach((l) => l({ listId }));
    for (const path of [...Object.keys(changed.files ?? {}), ...Object.keys(changed.refusals ?? {})]) filesListeners.forEach((l) => l({ appSessionId: init.session, path, kind: 'changed' })); // E7
  };

  const fakeFs = (data: Partial<FakeDisk>) => {
    disk.sidecars = upsert(disk.sidecars, data.sidecars, (entry) => entry.agentId);
    disk.runs = upsert(disk.runs, data.runs, (run) => run.runId);
    disk.tasks = { ...disk.tasks, ...data.tasks };
    disk.spills = { ...disk.spills, ...data.spills };
    disk.files = { ...disk.files, ...data.files }; // E7
    disk.refusals = { ...disk.refusals, ...data.refusals }; // E7 (M7)
    announce(data);
  };
  fakeFs(init);

  const client: AgentWorkClient = {
    subagents: async (appSessionId) => (ours(appSessionId) ? disk.sidecars : []),
    workflows: async (appSessionId) => (ours(appSessionId) ? disk.runs : []),
    tasks: async (listId) => disk.tasks[listId] ?? [],
    readSpill(input) {
      recorded.readSpill.push(input);
      const text = disk.spills[input.path];
      return track(text === undefined ? Promise.reject(new Error(`${SPILL_NOT_FOUND}: ${input.path}`)) : Promise.resolve(page(text, input)));
    },
    events(appSessionId, afterSeq) {
      const bound = wires.get(appSessionId);
      if (bound) return Promise.resolve(bound.wire.snapshot(afterSeq));
      return new Promise((resolve) => waiting.set(appSessionId, [...(waiting.get(appSessionId) ?? []), (wire) => resolve(wire.snapshot(afterSeq))]));
    },
    agentEvents: async () => [], // the harness's children have no disk transcript; a receipt comes on the wire it plays
    unfollowAgent: async () => {},
    async steer(appSessionId, content, priority) {
      recorded.steer.push({ appSessionId, content, priority });
      steers += 1;
      return { messageUuid: `harness-steer-${steers}` as MessageUuid };
    },
    stopTask(appSessionId, taskId) {
      recorded.stopTask.push({ appSessionId, taskId });
      const outcome = stopAnswers.get(taskId) ?? 'ok';
      return track(outcome === 'ok' ? Promise.resolve() : Promise.reject(new Error(FAKE_STOP_REFUSAL)));
    },
    onEventBatch: (listener) => listen(batchListeners, listener),
    onSubagentsChanged: (listener) => listen(subagentListeners, listener),
    onWorkflowChanged: (listener) => listen(workflowListeners, listener),
    onTasksChanged: (listener) => listen(taskListeners, listener),
    // E7 start
    async readFile({ appSessionId, path, hash }) {
      if (ours(appSessionId) && disk.refusals[path] !== undefined) throw new Error(disk.refusals[path]);
      const text = ours(appSessionId) ? disk.files[path] : undefined;
      if (text === undefined) throw new Error(`not found: ${path}`);
      const bytes = new TextEncoder().encode(text).length;
      return { encoding: 'utf8', content: text, bytes, offset: 0, length: bytes, truncated: false, mime: 'application/json', hash: hash ? fakeFileHash(text) : null, utf8: hash ? true : null };
    },
    watchDir: async () => {},
    unwatchDir: async () => {},
    onFilesChanged: (listener) => listen(filesListeners, listener),
    listRoots: async (appSessionId) => (ours(appSessionId) ? [...(init.roots ?? [])] : []), // the roots resolve: a staged refusal reads as one
    // E7 end
  };

  return {
    client,
    fakeFs,
    announceDisk: () => announce(disk),
    bindWire(appSessionId, wire) {
      wires.get(appSessionId)?.off();
      wires.delete(appSessionId);
      if (!wire) return;
      const off = wire.subscribe((events) => batchListeners.forEach((l) => l({ appSessionId, events })));
      wires.set(appSessionId, { wire, off });
      // A snapshot asked for before the bind is answered by the old binding's reader (the store drops a stale answer).
      for (const answer of waiting.get(appSessionId) ?? []) answer(wire);
      waiting.delete(appSessionId);
    },
    answerStop: (taskId, outcome) => void stopAnswers.set(taskId, outcome),
    calls: () => ({ steer: [...recorded.steer], stopTask: [...recorded.stopTask], readSpill: [...recorded.readSpill] }),
    async idle() {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    },
  };
}
