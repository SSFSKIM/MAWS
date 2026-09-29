// The transcript's X2 adapters (C6 execution document, Public surface and "X2 surface C6 consumes"), one call each:
// `ipcSource` follows a session (or one child agent, choosing its provenance) under the store's hydration protocol, the default `loadSpill`
// reads a spilled result, `ipcRewind` backs the receipt's Undo, `ipcOpenExternal` opens a markdown link. Each has an
// `…Over(client)` form so tests drive it with a fake X2 client; the plain forms use the app's validated client.
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, AppSessionId, EventId, MessageUuid } from '@shared/graph/ids';
import type { CommandName, CommandOutput, CommandResult, MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../ipc/client';
import { useTranscriptStore } from '../../stores/transcript';
import { turnId as turnIdOf } from '../model/keys';
import type { TranscriptState } from '../model/reduce';
import type { Spill, TurnId } from '../model/rows';
import type { RewindInterface } from '../view/context';
import type { TranscriptSource } from './types';

// How much of a spilled result is read into the detail (residue *Spilled results*): past it, the head and Open full log.
export const SPILL_READ_BYTES = 2 * 1024 * 1024;

const valueOf = <N extends CommandName>(result: CommandResult<N>): CommandOutput<N> => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

// `session.eventBatch` carries every event of an app session, a followed child's own slice included (C4 emits it with
// `agentId` set). The parent takes its own events and the child traffic it indexes under the parent tool use
// (`parentToolUseId` set), never a child's slice, which would render as top-level. C3 tags the parent's lifecycle reports
// on a local agent (`subagent.*`, `task.updated`) with the agent they concern, so a top-level event whose task id is its
// own agent id is such a report: the parent's, never part of the child's slice (for local agents the two ids carry the
// same string, C1 Interfaces).
const reportsOnOwnAgent = (event: SessionEvent) => event.agentId !== null && 'taskId' in event && (event.taskId as string | null) === (event.agentId as string);
const ofParent = (event: SessionEvent) => event.agentId === null || event.parentToolUseId !== null || reportsOnOwnAgent(event);
const ownOf = (agentId: AgentId) => (event: SessionEvent) => event.agentId === agentId && !reportsOnOwnAgent(event);

// A session's events can reach `session.eventBatch` in both forms at once: a disk follower started by an earlier read
// (C4's backfill: `seq: null`, ids from the transcript's uuids) keeps delivering what a resumed launch's live journal
// also delivers (its row's `seq`, ids under the app session id), under different ids, so id deduplication cannot merge
// them. Live wins: once the attachment has seen a live-form event (the snapshot's or a batch's), disk-form events are
// dropped; the disk history before the launch has already arrived by then. Batches that arrive before the snapshot
// answers are held and passed through that filter once it has, so a follower's copy delivered during the round trip
// drops too. An event the app synthesises (`seq: null`, its id also under the app session id, as C10's route notice)
// is neither form's copy of the other and always passes.
function sessionSource(client: MawsBridge, appSessionId: AppSessionId): TranscriptSource {
  const liveForm = (event: SessionEvent) => event.seq !== null;
  const diskForm = (event: SessionEvent) => event.seq === null && !event.id.startsWith(`${appSessionId}:`);
  // Per attachment: the store subscribes once per attachment, then snapshots.
  let live = false;
  let held: SessionEvent[][] | null = null; // batches before the snapshot answered
  let pass: (events: SessionEvent[]) => void = () => {};
  return {
    key: appSessionId,
    subscribe(listener) {
      live = false;
      held = [];
      pass = (batch) => {
        const events = batch.filter((event) => {
          if (liveForm(event)) live = true;
          return ofParent(event) && !(live && diskForm(event));
        });
        if (events.length > 0) listener(events);
      };
      return client.on('session.eventBatch', (batch) => {
        if (batch.appSessionId !== appSessionId) return;
        if (held) held.push(batch.events);
        else pass(batch.events);
      });
    },
    // The store orders and deduplicates by event id (ruling 5 of the wave-2 ledger); `lastSeq` is C3's own cursor. The
    // held batches are passed before the snapshot returns, while the store still buffers.
    async snapshot() {
      const { events } = valueOf(await client.invoke('session.events', { appSessionId, afterSeq: null, limit: null }));
      if (events.some(liveForm)) live = true;
      const waiting = held ?? [];
      held = null;
      for (const batch of waiting) pass(batch);
      return events;
    },
  };
}

// A child agent's source owns its provenance (Child source provenance): live while the child runs in the parent's
// process (the parent's stream and snapshot, filtered by agent; no disk follower), disk otherwise (fs.agentEvents,
// which starts following). The snapshot decides from the parent's lifecycle events for the child: live when the
// parent's live journal started it (`subagent.started` or `task.started`) and nothing ended it since (its finish, or
// the parent's `process.exited`), so a drill-in opened before the child's first event still follows the live stream;
// disk otherwise (it ended, or the parent is disk-backed). The parent's report that the child ended joins the child's
// slice, where it closes the child's open turn (reduce.ts). A live child that ends switches to disk and signals a
// reset, so the store rebuilds the key from the disk transcript. Disk is final.
//
// The same events reach `session.eventBatch` in two forms, the live journal's (with their row's `seq`) and the disk
// transcript's (`seq: null`, ruling 5 of the wave-2 ledger), under different ids, so id deduplication cannot merge
// them: the source passes only the form of its provenance. Batches that arrive before the provenance is known are held
// and passed through that filter once it is.
interface Subscriber {
  listener: (events: SessionEvent[]) => void;
  held: SessionEvent[][]; // batches that arrived before the provenance was decided
}

function childSource(client: MawsBridge, appSessionId: AppSessionId, agentId: AgentId): TranscriptSource {
  let provenance: 'undecided' | 'live' | 'disk' = 'undecided';
  let ended: SessionEvent | null = null; // the parent's report that the child ended, for the disk slice
  const resets = new Set<() => void>();
  const subscribers = new Set<Subscriber>();
  // For local agents the engine's task id and the sidecar's agent id carry the same string (C1 Interfaces, observed in
  // the fixtures); X1 keeps them as two types, so the comparison is on the strings.
  const names = (taskId: string) => taskId === (agentId as string);
  const own = ownOf(agentId);
  const starts = (event: SessionEvent) => (event.kind === 'subagent.started' || event.kind === 'task.started') && names(event.taskId);
  const finishes = (event: SessionEvent) => (event.kind === 'subagent.finished' || event.kind === 'task.notification') && names(event.taskId);
  const exits = (event: SessionEvent) => event.kind === 'process.exited' && event.agentId === null;
  const liveForm = (event: SessionEvent) => event.seq !== null;
  // An exit ends the child only if it follows the child's start in the stream that carried it: an exit the parent's
  // snapshot holds, by its position there; any other exit, once a start has been seen (the snapshot's or a batch's).
  // A replay or backfill batch can carry an exit of an earlier run, which says nothing about a child started since.
  let startAt = -1; // the child's start in the parent's snapshot
  let startedInStream = false;
  const exitsAt = new Map<EventId, number>(); // the parent's snapshot's exits, by position
  const endsChild = (event: SessionEvent) => {
    if (finishes(event)) return true;
    if (!exits(event)) return false;
    const at = exitsAt.get(event.id);
    return at === undefined ? startAt >= 0 || startedInStream : startAt >= 0 && at > startAt;
  };
  // One batch under the current provenance: its own events in that form, the parent's finish for the child, and while
  // live an exit that ends it, pass into the child's state; an end seen while live switches to disk.
  const receive = (subscriber: Subscriber, events: SessionEvent[]) => {
    if (provenance === 'undecided') {
      subscriber.held.push(events);
      return;
    }
    const passed: SessionEvent[] = [];
    let end: SessionEvent | null = null;
    for (const event of events) {
      if (starts(event)) startedInStream = true;
      const ends = endsChild(event);
      if ((own(event) && liveForm(event) === (provenance === 'live')) || finishes(event) || (provenance === 'live' && ends)) passed.push(event);
      if (ends && provenance === 'live') end ??= event;
    }
    if (passed.length > 0) subscriber.listener(passed);
    if (end && provenance === 'live') {
      ended ??= end;
      toDisk();
    }
  };
  const decide = (chosen: 'live' | 'disk') => {
    provenance = chosen;
    for (const subscriber of subscribers) for (const events of subscriber.held.splice(0)) receive(subscriber, events);
  };
  // The reset is signalled once the batch that carried the end has been delivered, so the store's new subscription can
  // never receive that batch a second time.
  const toDisk = () => {
    decide('disk');
    queueMicrotask(() => {
      for (const listener of [...resets]) listener();
    });
  };
  return {
    key: `${appSessionId}:${agentId}`,
    agentId,
    subscribe(listener) {
      const subscriber: Subscriber = { listener, held: [] };
      subscribers.add(subscriber);
      const off = client.on('session.eventBatch', (batch) => {
        if (batch.appSessionId === appSessionId) receive(subscriber, batch.events);
      });
      return () => {
        subscribers.delete(subscriber);
        off();
      };
    },
    async snapshot() {
      const onDisk = () => provenance === 'disk'; // read after the await: the child may have ended meanwhile
      if (!onDisk()) {
        const parent = valueOf(await client.invoke('session.events', { appSessionId, afterSeq: null, limit: null })).events;
        const started = parent.findLastIndex(starts);
        startAt = started;
        parent.forEach((event, i) => {
          if (exits(event)) exitsAt.set(event.id, i);
        });
        // What ended the child: a finish after its start (or anywhere, when the snapshot never started it), or the
        // parent's exit after its start (mounted after a crash).
        const end = parent.findLastIndex((event, i) => finishes(event) || (started >= 0 && i > started && exits(event)));
        if (end > started || (started < 0 && end >= 0)) ended ??= parent[end];
        if (started >= 0 && end < started && liveForm(parent[started]) && !onDisk()) {
          decide('live');
          return parent.filter((event) => own(event) && liveForm(event));
        }
      }
      if (!onDisk()) decide('disk');
      const disk = valueOf(await client.invoke('fs.agentEvents', { appSessionId, agentId })).events;
      return ended === null ? disk : [...disk, ended];
    },
    onReset(listener) {
      resets.add(listener);
      return () => resets.delete(listener);
    },
  };
}

// One source per key and client: C5's agent tab and C8's drill-in mount the same source, hence one attachment and one
// state in the store.
const sources = new WeakMap<MawsBridge, Map<string, TranscriptSource>>();

export function ipcSourceOver(client: MawsBridge, appSessionId: AppSessionId, agentId?: AgentId): TranscriptSource {
  const key = agentId === undefined ? appSessionId : `${appSessionId}:${agentId}`;
  let known = sources.get(client);
  if (!known) sources.set(client, (known = new Map()));
  let source = known.get(key);
  if (!source) known.set(key, (source = agentId === undefined ? sessionSource(client, appSessionId) : childSource(client, appSessionId, agentId)));
  return source;
}

export const ipcSource = (appSessionId: AppSessionId, agentId?: AgentId): TranscriptSource => ipcSourceOver(ipc, appSessionId, agentId);

// Spills whose last read came back truncated (`fs.readSpill`'s flag). `loadSpill` answers only the content (its
// callback shape is frozen), so the loader asks here whether what it got was the whole result.
const truncatedSpills = new Set<string>();
export const spillWasTruncated = (path: string) => truncatedSpills.has(path);

export const ipcLoadSpillOver = (client: MawsBridge) => async (spill: Spill): Promise<string> => {
  const read = valueOf(await client.invoke('fs.readSpill', { path: spill.path, length: SPILL_READ_BYTES }));
  if (read.truncated) truncatedSpills.add(spill.path);
  else truncatedSpills.delete(spill.path);
  return read.content;
};

export const ipcLoadSpill = ipcLoadSpillOver(ipc);

export const ipcOpenExternalOver = (client: MawsBridge) => (url: string) => {
  void client.invoke('layout.openExternal', { url }).then((result) => {
    if (!result.ok) console.warn(`[transcript] could not open ${url}: ${result.error.message}`);
  });
};

export const ipcOpenExternal = ipcOpenExternalOver(ipc);

// The prompt a turn's files rewind to: the user message that opened it (a turn is keyed `turn:<its uuid>`). An
// engine-initiated turn has none.
function promptOf(state: TranscriptState | undefined, turnId: TurnId): MessageUuid | null {
  for (const event of state?.turns.get(turnId)?.events ?? []) {
    if (event.kind === 'user.message' && event.messageUuid !== null && turnIdOf.ofMessage(event.messageUuid) === turnId) return event.messageUuid;
  }
  return null;
}

export const REWIND_REFUSAL = { noPrompt: 'This turn has no prompt to rewind to', disabled: 'File checkpoints are off for this session', failed: 'Rewind failed' } as const;

// `session.rewindFiles` behind the receipt (C3): the dry run answers `canUndo`, with `enabled: false` (checkpointing
// off) as a refusal; the engine has no forward rewind, so Reapply is not offered.
export function ipcRewindOver(client: MawsBridge, appSessionId: AppSessionId, stateOf: () => TranscriptState | undefined): RewindInterface {
  const rewind = async (turnId: TurnId, dryRun: boolean) => {
    const userMessageUuid = promptOf(stateOf(), turnId);
    if (userMessageUuid === null) return { ok: false, reason: REWIND_REFUSAL.noPrompt };
    const result = await client.invoke('session.rewindFiles', { appSessionId, userMessageUuid, dryRun });
    if (!result.ok) return { ok: false, reason: result.error.message };
    if (!result.value.enabled) return { ok: false, reason: result.value.message ?? REWIND_REFUSAL.disabled };
    return { ok: result.value.ok, reason: result.value.ok ? null : (result.value.message ?? REWIND_REFUSAL.failed) };
  };
  return {
    canUndo: (turnId) => rewind(turnId, true),
    async undo(turnId) {
      const outcome = await rewind(turnId, false);
      if (!outcome.ok) throw new Error(outcome.reason ?? REWIND_REFUSAL.failed);
    },
    reapply: null,
  };
}

// The rewind interface of a session followed through `ipcSource` (its store key is the app session id).
export const ipcRewind = (appSessionId: AppSessionId): RewindInterface =>
  ipcRewindOver(ipc, appSessionId, () => useTranscriptStore.getState().entries[appSessionId]?.state);
