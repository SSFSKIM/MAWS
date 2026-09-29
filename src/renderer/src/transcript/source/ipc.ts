// The transcript's X2 adapters (C6 execution document, Public surface and "X2 surface C6 consumes"), one call each:
// `ipcSource` follows a session (or one child agent, choosing its provenance) under the store's hydration protocol, the default `loadSpill`
// reads a spilled result, `ipcRewind` backs the receipt's Undo, `ipcOpenExternal` opens a markdown link. Each has an
// `…Over(client)` form so tests drive it with a fake X2 client; the plain forms use the app's validated client.
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, AppSessionId, MessageUuid } from '@shared/graph/ids';
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
// (`parentToolUseId` set), never a child's slice, which would render as top-level.
const ofParent = (event: SessionEvent) => event.agentId === null || event.parentToolUseId !== null;

function sessionSource(client: MawsBridge, appSessionId: AppSessionId): TranscriptSource {
  return {
    key: appSessionId,
    subscribe(listener) {
      return client.on('session.eventBatch', (batch) => {
        if (batch.appSessionId !== appSessionId) return;
        const events = batch.events.filter(ofParent);
        if (events.length > 0) listener(events);
      });
    },
    // The store orders and deduplicates by event id (ruling 5 of the wave-2 ledger); `lastSeq` is C3's own cursor.
    async snapshot() {
      return valueOf(await client.invoke('session.events', { appSessionId, afterSeq: null, limit: null })).events;
    },
  };
}

// A child agent's source owns its provenance (Child source provenance): live while the child runs in the parent's
// process (the parent's stream and snapshot, filtered by agent; no disk follower), disk otherwise (fs.agentEvents,
// which starts following). The snapshot decides from the parent's lifecycle events for the child: live when the
// parent's snapshot started it (`subagent.started` or `task.started`) with no finish after, so a drill-in opened before
// the child's first event still follows the live stream; disk otherwise (it finished, or the parent is disk-backed).
// In both, the parent's finish event naming the child joins the child's slice, where it closes the child's open turn
// (reduce.ts). A live child that ends (its finish, or the parent's `process.exited`) switches to disk and signals a
// reset, so the store rebuilds the key from the disk transcript and the live and disk id forms of the same events never
// meet. Disk is final.
function childSource(client: MawsBridge, appSessionId: AppSessionId, agentId: AgentId): TranscriptSource {
  let provenance: 'undecided' | 'live' | 'disk' = 'undecided';
  let finished: SessionEvent | null = null; // the parent's report that the child ended, for the disk slice
  const resets = new Set<() => void>();
  const own = (event: SessionEvent) => event.agentId === agentId;
  // For local agents the engine's task id and the sidecar's agent id carry the same string (C1 Interfaces, observed in
  // the fixtures); X1 keeps them as two types, so the comparison is on the strings.
  const names = (taskId: string) => taskId === (agentId as string);
  const starts = (event: SessionEvent) => (event.kind === 'subagent.started' || event.kind === 'task.started') && names(event.taskId);
  const finishes = (event: SessionEvent) => (event.kind === 'subagent.finished' || event.kind === 'task.notification') && names(event.taskId);
  const ends = (event: SessionEvent) => finishes(event) || (event.kind === 'process.exited' && event.agentId === null);
  // The reset is signalled once the batch that carried the end has been delivered, so the store's new subscription can
  // never receive that batch's live-form events a second time.
  const toDisk = () => {
    provenance = 'disk';
    queueMicrotask(() => {
      for (const listener of [...resets]) listener();
    });
  };
  return {
    key: `${appSessionId}:${agentId}`,
    agentId,
    subscribe(listener) {
      return client.on('session.eventBatch', (batch) => {
        if (batch.appSessionId !== appSessionId) return;
        const events = batch.events.filter((event) => own(event) || finishes(event));
        finished = events.findLast(finishes) ?? finished;
        if (events.length > 0) listener(events);
        if (provenance !== 'disk' && batch.events.some(ends)) toDisk();
      });
    },
    async snapshot() {
      const onDisk = () => provenance === 'disk'; // read after the await: the child may have ended meanwhile
      if (!onDisk()) {
        const parent = valueOf(await client.invoke('session.events', { appSessionId, afterSeq: null, limit: null })).events;
        const started = parent.findLastIndex(starts);
        const end = parent.findLastIndex(finishes);
        if (end >= 0) finished = parent[end];
        if (started >= 0 && end < started && !onDisk()) {
          provenance = 'live';
          return parent.filter(own);
        }
      }
      provenance = 'disk';
      const disk = valueOf(await client.invoke('fs.agentEvents', { appSessionId, agentId })).events;
      return finished === null ? disk : [...disk, finished];
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

export const ipcLoadSpillOver =
  (client: MawsBridge) =>
  async (spill: Spill): Promise<string> =>
    valueOf(await client.invoke('fs.readSpill', { path: spill.path, length: SPILL_READ_BYTES })).content;

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
