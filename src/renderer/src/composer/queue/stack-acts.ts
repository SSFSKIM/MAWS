// The stack's acts (UX wave U4a, docs/doperpowers/plans/2026-11-12-ux-wave-U4a-composer.md, M3 "The acts"): one function
// each, used by a row's control and by the key (Esc for Send now). Each goes through the session's controls port; a
// failure keeps the row and shows the host's words, as before; `nothing_waiting` and `already_started` show the notice
// line. What may not act here (a session on another machine, an engine host of another build, a draft store of an
// earlier build) is read by `refusals`, which the row draws and the keys say.
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import { useMemo } from 'react';
import { hostHasThisWire } from '@shared/sessions/host-wire';
import { remoteUnavailableOf, useRemoteUnavailable } from '../../lane-b/remote-unavailable';
import { isRemoteLaneB, useIsRemoteLaneB } from '../../lane-b/remote-session';
import type { SessionControls } from '../../session/controls/types';
import { setSendingNow, showStackNotice } from '../../stores/composer';
import { useHosts } from '../../stores/hosts';
import { toast } from '../../stores/notices';
import { useTranscriptStore, type TranscriptEntry } from '../../stores/transcript';
import { HOST_UPDATING, useHostHasThisWire } from './host-wire';
import { STACK_WORDS, type Read, type StackRow, type TakenRow, type Unread, type WaitingRow } from './stack';
import { storeRefusesStage, useStoreRefusesStage } from './take-back';

// ---- what the transcript says (Interfaces G: the store the editor's recall reads) -----------------------------------

const NOTHING_READ: Read = { unread: [], started: () => false };

function readOfEntry(entry: TranscriptEntry | undefined): Read {
  if (entry === undefined) return NOTHING_READ;
  const unread: Unread[] = [];
  for (const row of entry.rows) if (row.kind === 'user' && row.unread === true && row.messageUuid !== null) unread.push({ messageUuid: row.messageUuid, text: row.text, at: row.at });
  const { state } = entry;
  return {
    unread,
    // the store holds the message's turn accepted (a steer folds into the running turn) or closed
    started: (messageUuid: MessageUuid) => {
      const turnId = state.index.messages.get(messageUuid);
      const turn = turnId === undefined ? undefined : state.turns.get(turnId);
      return turn !== undefined && (turn.accepted || turn.state === 'closed');
    },
  };
}

/** What the session's transcript holds unread and started, read now. */
export const readOf = (appSessionId: AppSessionId): Read => readOfEntry(useTranscriptStore.getState().entries[appSessionId]);
/** The same, followed in a render. */
export function useRead(appSessionId: AppSessionId): Read {
  const entry = useTranscriptStore((s) => s.entries[appSessionId]);
  return useMemo(() => readOfEntry(entry), [entry]);
}

// ---- what may not act here ------------------------------------------------------------------------------------------

export interface Refusals {
  sendNowNext: string | null; // Send now on a next-step row, whether or not a turn runs (it goes by `session.steer.sendNow`)
  cancelNext: string | null; // Edit and Delete on a next-step row
  takeBack: string | null; // Edit and ↑ on any row: the machine's draft store is of an earlier build
}

function refusalsOf(remote: boolean, sendNowElsewhere: string | null, cancelElsewhere: string | null, hostHasWire: boolean, takeBack: string | null): Refusals {
  return { sendNowNext: remote ? sendNowElsewhere : hostHasWire ? null : HOST_UPDATING, cancelNext: remote ? cancelElsewhere : null, takeBack };
}

export function refusalsNow(appSessionId: AppSessionId): Refusals {
  return refusalsOf(
    isRemoteLaneB(appSessionId),
    remoteUnavailableOf(appSessionId, 'session.steer.sendNow'),
    remoteUnavailableOf(appSessionId, 'session.steer.cancel'),
    hostHasThisWire(useHosts.getState().supervisor),
    storeRefusesStage(appSessionId),
  );
}

export function useRefusals(appSessionId: AppSessionId): Refusals {
  const remote = useIsRemoteLaneB(appSessionId);
  const sendNow = useRemoteUnavailable(appSessionId, 'session.steer.sendNow');
  const cancel = useRemoteUnavailable(appSessionId, 'session.steer.cancel');
  const hostHasWire = useHostHasThisWire();
  const takeBack = useStoreRefusesStage(appSessionId);
  return useMemo(() => refusalsOf(remote, sendNow, cancel, hostHasWire, takeBack), [remote, sendNow, cancel, hostHasWire, takeBack]);
}

/** Why Send now cannot act on the row now, or null. A next-step row that outlives its turn (the queue, the status and the
 *  lifecycles arrive apart) still goes by `session.steer.sendNow`, so its refusal does not wait for a turn. */
export const sendNowRefusal = (refusals: Refusals, row: WaitingRow): string | null => (row.kind === 'next' ? refusals.sendNowNext : null);
/** Why Edit (and ↑) cannot take the row back, or null. */
export const takeBackRefusal = (refusals: Refusals, row: TakenRow): string | null => (row.kind === 'next' ? (refusals.cancelNext ?? refusals.takeBack) : refusals.takeBack);
/** Why Delete cannot act on the row, or null: never the draft store's. */
export const deleteRefusal = (refusals: Refusals, row: TakenRow): string | null => (row.kind === 'next' ? refusals.cancelNext : null);

// ---- the acts ---------------------------------------------------------------------------------------------------------

type Result = { ok: true; value?: unknown } | { ok: false; error: { message: string } };
const said = (result: Result | undefined): boolean => {
  if (result === undefined) return false; // no queue behind this session's port: nothing to act on
  if (!result.ok) toast({ level: 'warning', text: result.error.message, actions: [], dismissible: true });
  return result.ok;
};

export interface Acts {
  sendNow(row: WaitingRow, nextKeys: readonly string[]): Promise<boolean>;
  remove(row: TakenRow): Promise<boolean>;
  move(row: WaitingRow): Promise<boolean>;
  resume(): Promise<boolean>;
}

export function stackActs(appSessionId: AppSessionId, controls: SessionControls | null): Acts {
  const queue = () => controls?.queue() ?? null;
  return {
    // a next-step row: the engine's send-now, which delivers every message waiting at the next step (decision 32), so each
    // reads "Sending…" until its own `started`; any other: today's promote at `now`
    async sendNow(row, nextKeys) {
      if (row.kind !== 'next') return said(await queue()?.promote({ queueId: row.queueId, priority: 'now' }));
      const result = await queue()?.sendNow({ messageUuid: row.messageUuid });
      if (!said(result) || !result?.ok) return false;
      if (result.value.outcome === 'nothing_waiting') showStackNotice(appSessionId, STACK_WORDS.readAlready, row.key);
      else setSendingNow(appSessionId, new Set(nextKeys));
      return true;
    },
    async remove(row) {
      if (row.kind !== 'next') return said(await queue()?.remove({ queueId: row.queueId }));
      const result = await queue()?.cancelSteer({ messageUuid: row.messageUuid });
      if (!said(result) || !result?.ok) return false;
      if (result.value.outcome === 'already_started') showStackNotice(appSessionId, STACK_WORDS.readAlready, row.key);
      return true;
    },
    // the move to the other kind of wait: a next-step row is held for after the turn, an after-the-turn row goes at the next step
    move: async (row) => said(row.kind === 'next' ? await queue()?.hold({ messageUuid: row.messageUuid }) : await queue()?.promote({ queueId: row.queueId, priority: 'next' })),
    resume: async () => said(await queue()?.setPaused({ paused: false })),
  };
}

export type { StackRow };
