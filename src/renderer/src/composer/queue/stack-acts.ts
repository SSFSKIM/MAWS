// The stack's acts (UX wave U4a, docs/doperpowers/plans/2026-11-12-ux-wave-U4a-composer.md, M3 "The acts"): one function
// each, used by a row's control and by the key (Esc for Send now). Each goes through the session's controls port; a
// failure keeps the row and shows the host's words, as before. What may not act here (a session on another machine, an
// engine host of another build, a draft store of an earlier build) is read by `refusals`, which the row draws and the
// keys say, each control with its own label.
//
// The UX wave, U4b (docs/doperpowers/plans/2026-11-15-ux-wave-U4b-composer-integrations.md, decisions 13 and 15;
// Interfaces E): "The agent has already read this message" is said only where the session's record says so: a Send now
// answered `nothing_waiting` shows nothing, and a Delete answered `already_started`, or refused because the session is
// not running on its machine, reads the record once. While a turn runs, Send now on an after-the-turn row is a promote
// at `next` and then, with the uuid the promote answered, the engine's send-now, which moves the running call and
// delivers it with every message already waiting at the next step (spikes/protocol-probe/findings-uxwave-u4b-send-now-
// early.txt): the send-now is never invoked before the promote answered, since one written before the frame finds
// nothing waiting and moves nothing.
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { useMemo } from 'react';
import { hostHasThisWire } from '@shared/sessions/host-wire';
import { ipc } from '../../ipc/client';
import { remoteUnavailableAsOf, useRemoteUnavailableAs } from '../../lane-b/remote-unavailable';
import { isRemoteLaneB, useIsRemoteLaneB } from '../../lane-b/remote-session';
import type { SessionControls } from '../../session/controls/types';
import { setSendingNow, showStackNotice } from '../../stores/composer';
import { useHosts } from '../../stores/hosts';
import { toast } from '../../stores/notices';
import { useQueueStore } from '../../stores/queue';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore, type TranscriptEntry } from '../../stores/transcript';
import { isBusy } from '../submit/submit-state';
import { HOST_UPDATING, useHostHasThisWire } from './host-wire';
import { STACK_WORDS, type Read, type StackRow, type TakenRow, type Unread, type WaitingRow } from './stack';
import { recordSaysRead, storeRefusesStage, useStoreRefusesStage } from './take-back';

// ---- what the transcript says (Interfaces G: the store the editor's recall reads) -----------------------------------

const NOTHING_READ: Read = { unread: [], started: () => false, questions: () => null };

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
    // the ask's capsule stays in view when its turn folds, so its row is among the entry's rows (UX wave U4b, decision 2)
    questions: (call: string) => {
      for (const row of entry.rows) if (row.kind === 'ask' && row.askId === call) return row.questions;
      return null;
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
  sendNowNext: string | null; // Send now on a next-step row: the helper's (label 'send now') on another machine; HOST_UPDATING under another build's engine host here
  editNext: string | null; // Edit and ↑ on a next-step row: the helper's for `session.steer.cancel`, label 'edit'
  deleteNext: string | null; // Delete on a next-step row: the same, label 'delete'
  takeBack: string | null; // Edit and ↑ on any row: the machine's draft store keeps no stage
}

type Elsewhere = { sendNow: string | null; edit: string | null; delete: string | null };

function refusalsOf(remote: boolean, elsewhere: Elsewhere, hostHasWire: boolean, takeBack: string | null): Refusals {
  return { sendNowNext: remote ? elsewhere.sendNow : hostHasWire ? null : HOST_UPDATING, editNext: remote ? elsewhere.edit : null, deleteNext: remote ? elsewhere.delete : null, takeBack };
}

export function refusalsNow(appSessionId: AppSessionId): Refusals {
  const elsewhere = {
    sendNow: remoteUnavailableAsOf('send now', appSessionId, 'session.steer.sendNow'),
    edit: remoteUnavailableAsOf('edit', appSessionId, 'session.steer.cancel'),
    delete: remoteUnavailableAsOf('delete', appSessionId, 'session.steer.cancel'),
  };
  return refusalsOf(isRemoteLaneB(appSessionId), elsewhere, hostHasThisWire(useHosts.getState().supervisor), storeRefusesStage(appSessionId));
}

export function useRefusals(appSessionId: AppSessionId): Refusals {
  const remote = useIsRemoteLaneB(appSessionId);
  const sendNow = useRemoteUnavailableAs('send now', appSessionId, 'session.steer.sendNow');
  const edit = useRemoteUnavailableAs('edit', appSessionId, 'session.steer.cancel');
  const del = useRemoteUnavailableAs('delete', appSessionId, 'session.steer.cancel');
  const hostHasWire = useHostHasThisWire();
  const takeBack = useStoreRefusesStage(appSessionId);
  return useMemo(() => refusalsOf(remote, { sendNow, edit, delete: del }, hostHasWire, takeBack), [remote, sendNow, edit, del, hostHasWire, takeBack]);
}

/** Why Send now cannot act on the row now, or null. A next-step row that outlives its turn (the queue, the status and the
 *  lifecycles arrive apart) still goes by `session.steer.sendNow`, so its refusal does not wait for a turn. */
export const sendNowRefusal = (refusals: Refusals, row: WaitingRow): string | null => (row.kind === 'next' ? refusals.sendNowNext : null);
/** Why Edit (and ↑) cannot take the row back, or null. */
export const takeBackRefusal = (refusals: Refusals, row: TakenRow): string | null => (row.kind === 'next' ? (refusals.editNext ?? refusals.takeBack) : refusals.takeBack);
/** Why Delete cannot act on the row, or null: never the draft store's. */
export const deleteRefusal = (refusals: Refusals, row: TakenRow): string | null => (row.kind === 'next' ? refusals.deleteNext : null);
/**
 * Whether Send now on the row goes as the engine's send-now behind a promote at `next` (U4b, decision 15): an
 * after-the-turn row while a turn runs, where a next-step row's Send now would not be refused (this Mac's host takes the
 * command, or the machine lists `rl2.send-now`). It then goes with every message already waiting at the next step.
 */
export const sendsWithNextStep = (refusals: Refusals, row: WaitingRow, turnRuns: boolean): boolean => row.kind === 'after' && turnRuns && refusals.sendNowNext === null;

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

/** Whether the session's turn runs, read now: its status as the composer reads it, and the queue's own entries. */
const turnRunsNow = (appSessionId: AppSessionId): boolean => isBusy(useSessions.getState().engine.get(appSessionId) ?? null, useQueueStore.getState().bySession.get(appSessionId)?.entries ?? []);

export function stackActs(appSessionId: AppSessionId, controls: SessionControls | null, client: MawsBridge = ipc): Acts {
  const queue = () => controls?.queue() ?? null;
  // the engine's send-now for `messageUuid`: every next-step row it goes with reads "Sending…" until its own `started`;
  // `nothing_waiting` says nothing (decision 13): the row's own state says what became of the message
  async function sendNowOf(messageUuid: MessageUuid, sending: readonly string[]): Promise<boolean> {
    const result = await queue()?.sendNow({ messageUuid });
    if (!said(result) || !result?.ok) return false;
    if (result.value.outcome !== 'nothing_waiting') setSendingNow(appSessionId, new Set(sending));
    return true;
  }
  return {
    // a next-step row: the engine's send-now, which delivers every message waiting at the next step (decision 32); an
    // after-the-turn row while a turn runs: a promote at `next`, and only once it answered, the send-now for its uuid
    // (U4b, decision 15); any other: today's promote at `now`
    async sendNow(row, nextKeys) {
      if (row.kind === 'next') return sendNowOf(row.messageUuid, nextKeys);
      if (!sendsWithNextStep(refusalsNow(appSessionId), row, turnRunsNow(appSessionId))) return said(await queue()?.promote({ queueId: row.queueId, priority: 'now' }));
      const promoted = await queue()?.promote({ queueId: row.queueId, priority: 'next' });
      if (!said(promoted) || !promoted?.ok) return false;
      const { messageUuid } = promoted.value;
      if (typeof messageUuid !== 'string') return true; // no uuid answered: nothing to send now
      return sendNowOf(messageUuid, [...nextKeys, messageUuid]); // the message's row is a next-step row now, keyed by its uuid
    },
    async remove(row) {
      if (row.kind !== 'next') return said(await queue()?.remove({ queueId: row.queueId }));
      const result = await queue()?.cancelSteer({ messageUuid: row.messageUuid });
      if (result === undefined) return false;
      // U4b (decisions 8 and 13): neither answer says the agent read it; the record does, or nothing is said
      const notLive = !result.ok && (result.error.issues as { refusal?: unknown } | undefined)?.refusal === 'not-live';
      if (!notLive && !(result.ok && result.value.outcome === 'already_started')) return said(result);
      if (await recordSaysRead(client, appSessionId, row.createdAt, row.messageUuid)) showStackNotice(appSessionId, STACK_WORDS.readAlready, row.key);
      return result.ok;
    },
    // the move to the other kind of wait: a next-step row is held for after the turn, an after-the-turn row goes at the next step
    move: async (row) => said(row.kind === 'next' ? await queue()?.hold({ messageUuid: row.messageUuid }) : await queue()?.promote({ queueId: row.queueId, priority: 'next' })),
    resume: async () => said(await queue()?.setPaused({ paused: false })),
  };
}

export type { StackRow };
