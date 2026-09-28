// The transcript's X2 adapters (C6 execution document, Public surface and "X2 surface C6 consumes"), one call each:
// `ipcSource` follows a session (or one child agent) under the store's hydration protocol, the default `loadSpill`
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
// `agentId` set). A child transcript takes its agent's events; the parent takes its own and the child traffic it
// indexes under the parent tool use (`parentToolUseId` set), never a child's slice, which would render as top-level.
const belongsTo = (agentId: AgentId | undefined) =>
  agentId === undefined ? (event: SessionEvent) => event.agentId === null || event.parentToolUseId !== null : (event: SessionEvent) => event.agentId === agentId;

export function ipcSourceOver(client: MawsBridge, appSessionId: AppSessionId, agentId?: AgentId): TranscriptSource {
  const belongs = belongsTo(agentId);
  return {
    key: agentId === undefined ? appSessionId : `${appSessionId}:${agentId}`,
    agentId,
    subscribe(listener) {
      return client.on('session.eventBatch', (batch) => {
        if (batch.appSessionId !== appSessionId) return;
        const events = batch.events.filter(belongs);
        if (events.length > 0) listener(events);
      });
    },
    // The store orders and deduplicates by event id (ruling 5 of the wave-2 ledger); `lastSeq` is C3's own cursor.
    async snapshot() {
      if (agentId === undefined) return valueOf(await client.invoke('session.events', { appSessionId, afterSeq: null, limit: null })).events;
      return valueOf(await client.invoke('fs.agentEvents', { appSessionId, agentId })).events;
    },
  };
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
