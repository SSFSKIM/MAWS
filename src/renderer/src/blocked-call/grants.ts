// UX wave U1c (l4-approvals-12; the U1c document, Design 4 to 7, Interfaces §F): "Approve and retry" on a call auto mode
// blocked. The press is the session's own send of the engine's grant sentence, nothing else, on every route. Whether the
// button is offered is one function (`gateOf`); the press is one function (`approve`); and between the press and the
// record's answer the window keeps a grant out, a store of its own that only keeps the button closed, never makes a row
// read approved, belongs to no mounted row, and ends on evidence: the transcript's own approval row for the call, or a
// quiet moment of `SETTLE_MS` after the send was acknowledged and the record stopped listing the grant as waiting.
import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { consentMessage, personsGrants } from '@shared/engine/arrival';
import { messageText } from '@shared/engine/peer-envelope';
import type { ContentBlock } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { isAddress, machineOf } from '@shared/machine/address';
import type { HumanPromptOptions, HumanPromptResult } from '../composer/submit/send-human-prompt';
import { TERMINAL_KEEPS_NO_QUEUE } from '../composer/submit/submit-state';
import { ipc } from '../ipc/client';
import { drivenByBridge, heldWords, sendToSession, sessionControls, useSessionControls } from '../session/controls/controls-for';
import { LANE_A_WORDS } from '../session/controls/lane-a';
import { laneAStateOf, useLaneA } from '../stores/lane-a';
import { useMachines } from '../stores/machines';
import { useQueueStore } from '../stores/queue';
import { useSessions } from '../stores/sessions';
import { useTranscriptStore, type TranscriptEntry } from '../stores/transcript';
import { approvalsFor, blockedKey, drawsCell, hiddenTurnsOf, type BlockedCall } from '../transcript/model/blocked';
import { expandedTurnRows } from '../transcript/model/derive';
import { cellId } from '../transcript/model/keys';
import type { CellId, Row } from '../transcript/model/rows';
import { isAbortedReason } from '../transcript/model/classify';
import { holdSession } from './hold';

export const SETTLE_MS = 5_000;
/** Probe B's one place: how a grant is sent to a session MAWS runs while a turn runs. 'next' by probe B's recordings (u1c-b-*, 27 of 27; spikes/protocol-probe/findings-uxwave-u1c-during-turn.txt). */
export const GRANT_DURING_TURN: 'after' | 'next' = 'next';
/** Probe T's one place: the states of a terminal session in which the button is offered. M3 writes all false; M4 turns each true by its recording (u1c-t-*, 3 of 3 each). */
export const TERMINAL_OFFERED: Readonly<Record<TerminalState, boolean>> = {
  idle: true, // probe T: u1c-t-idle-1..3, honoured 3 of 3 (spikes/protocol-probe/findings-uxwave-u1c-terminal-grant.txt)
  running: true, // probe T: u1c-t-busy-1, -2, -4, honoured 3 of 3, five seconds into a 30 s call of the turn (the same findings)
  stopped: false,
};

export type TerminalState = 'idle' | 'running' | 'stopped';
export type Gate = { state: 'open' } | { state: 'closed' } | { state: 'unavailable'; reason: string };

// ---- the record --------------------------------------------------------------------------------------------------------

/** A terminal session's state as the window knows it (Design 7; Decision Log 5): running while its bridge says a turn runs or does not know; else stopped when the transcript's newest turn reads stopped; else idle. */
export function terminalStateOf(appSessionId: AppSessionId): TerminalState {
  const turn = laneAStateOf(appSessionId)?.turn;
  if (turn === undefined || turn.running || turn.unknown) return 'running';
  return newestTurnStopped(appSessionId) ? 'stopped' : 'idle';
}

// The newest turn the engine accepted reads stopped as its divider reads it (derive.ts): closed by a stop, or ended aborted,
// or closed with no end of its own. A prompt still waiting, or one the engine dropped, is no turn here.
function newestTurnStopped(appSessionId: AppSessionId): boolean {
  const state = useTranscriptStore.getState().entries[appSessionId]?.state;
  const turn = state?.order.map((id) => state.turns.get(id)).findLast((candidate) => candidate?.accepted === true);
  if (turn === undefined || turn.state === 'open') return false;
  return turn.closedBy !== null ? turn.closedBy === 'stopped' : turn.ended === null || isAbortedReason(turn.ended.terminalReason);
}

const keysIn = (content: string | readonly ContentBlock[]): string[] => personsGrants(messageText(content as string | ContentBlock[])).map(blockedKey);

/** The keys of the grants the record holds unread outside the transcript, read by `personsGrants`: the queue's entries that are not released, its steers, a terminal session's pending sends that are sending or unconfirmed. */
export function waitingGrants(appSessionId: AppSessionId): ReadonlySet<string> {
  const queue = useQueueStore.getState().bySession.get(appSessionId);
  const pending = useLaneA.getState().pendingSends.get(appSessionId) ?? [];
  return new Set([
    ...(queue?.entries ?? []).filter((entry) => entry.state !== 'released').flatMap((entry) => keysIn(entry.content)),
    ...(queue?.steers ?? []).flatMap((steer) => keysIn(steer.content)),
    ...pending.filter((send) => send.state === 'sending' || send.state === 'unconfirmed').flatMap((send) => keysIn(send.text)),
  ]);
}

// ---- the gate ----------------------------------------------------------------------------------------------------------

/** Why a terminal session's state is not offered, by the table it is given, or null when it is (the words of Design 7's table). */
export function terminalRefusal(state: TerminalState, offered: Readonly<Record<TerminalState, boolean>>): string | null {
  if (offered[state]) return null;
  return state === 'running' && offered.idle ? TERMINAL_KEEPS_NO_QUEUE : LANE_A_WORDS.widget;
}

/** The gate, by the precedence of Design 6 (approved is the row's, which then draws no control). The one place a route, a state or a probe's answer closes the button. */
export function gateOf(appSessionId: AppSessionId, call: BlockedCall, grant: 'none' | 'waiting'): Gate {
  const key = blockedKey(call);
  if (useGrantsOut.getState().out.has(outKey(appSessionId, key)) || grant === 'waiting' || waitingGrants(appSessionId).has(key)) return { state: 'closed' };
  const controls = sessionControls(appSessionId);
  if (controls === null) return { state: 'unavailable', reason: heldWords(appSessionId) };
  if (drivenByBridge(appSessionId)) {
    const refusal = terminalRefusal(terminalStateOf(appSessionId), TERMINAL_OFFERED);
    if (refusal !== null) return { state: 'unavailable', reason: refusal };
  }
  const send = controls.capability('send');
  return send.available ? { state: 'open' } : { state: 'unavailable', reason: send.reason };
}

// ---- the press ---------------------------------------------------------------------------------------------------------

/** The send's options (Design 5): the session's own answer to a person's words, kept for after the turn on a session MAWS runs while `during` is 'after'. A terminal session keeps no queue, and takes it at the next step. */
export function grantOptions(appSessionId: AppSessionId, during: 'after' | 'next' = GRANT_DURING_TURN): HumanPromptOptions {
  return { origin: 'answer', ...(during === 'after' && !drivenByBridge(appSessionId) && { when: 'after' as const }) };
}

/** The press (Design 4). The only caller of the port's send for a grant; it sends nothing while the gate is not open. `pressed` is the blocked row's cell. */
export async function approve(appSessionId: AppSessionId, call: BlockedCall, pressed: CellId): Promise<void> {
  if (gateOf(appSessionId, call, 'none').state !== 'open') return;
  const key = blockedKey(call);
  const at = outKey(appSessionId, key);
  attempts += 1;
  const attempt = attempts;
  // the linearisation point: "sending" is in the store before the send is called
  begin(at, { attempt, appSessionId, key, pressed, phase: 'sending', rows: approvalsNow(appSessionId, key, pressed), quietSince: null, stood: sessionStands(appSessionId) });
  let result: HumanPromptResult;
  try {
    result = await sendToSession(appSessionId, consentMessage(call.kind, call.subject), grantOptions(appSessionId));
  } catch (error) {
    return fail(at, attempt, error instanceof Error ? error.message : String(error));
  }
  if (result.disposition === 'refused' || result.disposition === 'held') return fail(at, attempt, result.disposition === 'refused' ? (result.reason ?? null) : null);
  delivered(at, attempt);
}

// ---- the grants out ----------------------------------------------------------------------------------------------------

interface Out {
  attempt: number; // the press's own number: an answer moves only the grant of the press it answers
  appSessionId: AppSessionId;
  key: string;
  pressed: CellId; // the blocked row that was pressed, by its cell: `cell:<tool use id>`, the engine's id on every route
  phase: 'sending' | 'delivered';
  rows: number; // the approval rows the transcript held for the key after the pressed row, at the press
  quietSince: number | null; // delivered: when the record first listed no waiting grant for the key
  stood: boolean; // the window knew the session at the press, so its going is heard
}
interface GrantsOut {
  out: ReadonlyMap<string, Out>;
  notices: ReadonlyMap<string, string>; // the last press's refusal, in the port's words
}

/** The grants out, by session and key, and the last press's notice beside them. The window's memory; never stored. */
export const useGrantsOut = create<GrantsOut>()(() => ({ out: new Map(), notices: new Map() }));

let attempts = 0;
const outKey = (appSessionId: AppSessionId, key: string): string => `${appSessionId}\u0001${key}`;
const approvalsNow = (appSessionId: AppSessionId, key: string, pressed: CellId): number => {
  const entry = useTranscriptStore.getState().entries[appSessionId];
  return entry === undefined ? 0 : approvalsFor(rowsDrawing(entry, pressed), hiddenTurnsOf(entry.state), key, pressed);
};

/** Instrumentation: how many times a count drew the pressed call's turn expanded (tests pin when it runs). */
export const pressedTurnExpansions = { count: 0 };

// The rows a press's count reads (M3's review, finding 1, as the coordinator ruled). A closed turn folds its work away,
// so the store's rows can lack the pressed cell while the history before it is held; then the turn that holds the cell's
// call (the reducer's index of tool uses) is drawn expanded in place of its folded rows (`expandedTurnRows`), so the
// count still starts at the pressed cell. Only when no held turn holds the call are the store's rows counted as they
// are: they lie wholly after it. The expansion derives that one turn, and runs only while a grant is out (at the press,
// and in `settle`, which the stores call only while one is out).
function rowsDrawing(entry: TranscriptEntry, pressed: CellId): readonly Row[] {
  const { rows, state } = entry;
  if (rows.some((row) => drawsCell(row, pressed))) return rows;
  const turn = [...state.index.toolUses].find(([use]) => cellId.tool(use) === pressed)?.[1];
  if (turn === undefined) return rows;
  pressedTurnExpansions.count += 1;
  const expanded = expandedTurnRows(state, turn);
  const first = rows.findIndex((row) => row.turnId === turn);
  if (first !== -1) return [...rows.slice(0, first), ...expanded, ...rows.slice(rows.findLastIndex((row) => row.turnId === turn) + 1)];
  // the turn draws no row of its own here: its rows go before the first row of a later turn
  const place = state.order.indexOf(turn);
  const next = rows.findIndex((row) => row.turnId !== null && state.order.indexOf(row.turnId) > place);
  return next === -1 ? [...rows, ...expanded] : [...rows.slice(0, next), ...expanded, ...rows.slice(next)];
}

// The session stands while the window knows it, on a machine the roster lists: a record not archived (closed), or a row
// the org's listing gives. A session that stood at the press and no longer does has gone (closed, removed, its machine
// gone), and its grants end with it.
function sessionStands(appSessionId: AppSessionId): boolean {
  const { records, listed } = useSessions.getState();
  const record = records.get(appSessionId);
  if (!listed.has(appSessionId) && (record === undefined || record.archived)) return false;
  const machine = isAddress(appSessionId) ? machineOf(appSessionId) : ipc.localMachine;
  return machine === ipc.localMachine || useMachines.getState().machines.has(machine);
}

// Every change of the grants out goes through here: the store follows the record while any grant is out, and stops; and
// it holds what feeds that record for each session with a grant out, whatever is mounted (ruling F3).
function put(out: ReadonlyMap<string, Out>, notices: ReadonlyMap<string, string> = useGrantsOut.getState().notices): void {
  useGrantsOut.setState({ out, notices });
  keep(new Set([...out.values()].map((grant) => grant.appSessionId)));
  if (out.size === 0) unfollow();
  else follow();
}
const without = <V>(map: ReadonlyMap<string, V>, at: string): Map<string, V> => {
  const next = new Map(map);
  next.delete(at);
  return next;
};

function begin(at: string, grant: Out): void {
  const { out, notices } = useGrantsOut.getState();
  put(new Map(out).set(at, grant), without(notices, at));
}

// An answer to a press whose grant is no longer the one out (the record ended it, and another press followed) moves nothing.
function fail(at: string, attempt: number, notice: string | null): void {
  const { out, notices } = useGrantsOut.getState();
  if (out.get(at)?.attempt !== attempt) return;
  put(without(out, at), notice === null || notice === '' ? notices : new Map(notices).set(at, notice));
}

function delivered(at: string, attempt: number): void {
  const { out } = useGrantsOut.getState();
  const grant = out.get(at);
  if (grant === undefined || grant.attempt !== attempt || grant.phase !== 'sending') return;
  put(new Map(out).set(at, { ...grant, phase: 'delivered' }));
  settle();
}

// The transitions on evidence (Design 4's table): the transcript holds more approval rows for the key after the pressed
// row than at the press, and the grant ends whatever its phase; a delivered grant the record no longer lists as waiting
// starts its clock, and ends when the clock reaches SETTLE_MS; one the record lists again stops it. A session that has
// gone ends its grants.
function settle(): void {
  const { out } = useGrantsOut.getState();
  if (out.size === 0) return;
  const now = Date.now();
  const listed = new Map<AppSessionId, ReadonlySet<string>>();
  const listedFor = (appSessionId: AppSessionId): ReadonlySet<string> => {
    const known = listed.get(appSessionId);
    if (known !== undefined) return known;
    const keys = waitingGrants(appSessionId);
    listed.set(appSessionId, keys);
    return keys;
  };
  const next = new Map<string, Out>();
  let changed = false;
  for (const [at, grant] of out) {
    if ((grant.stood && !sessionStands(grant.appSessionId)) || approvalsNow(grant.appSessionId, grant.key, grant.pressed) > grant.rows) {
      changed = true;
      continue;
    }
    const quietSince = grant.phase !== 'delivered' || listedFor(grant.appSessionId).has(grant.key) ? null : (grant.quietSince ?? now);
    if (quietSince !== null && now - quietSince >= SETTLE_MS) {
      changed = true;
      continue;
    }
    changed ||= quietSince !== grant.quietSince;
    next.set(at, quietSince === grant.quietSince ? grant : { ...grant, quietSince });
  }
  if (changed) put(next);
  clock();
}

// One timer, for the earliest clock that runs.
let timer: ReturnType<typeof setTimeout> | null = null;
function clock(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  const since = [...useGrantsOut.getState().out.values()].flatMap((grant) => (grant.phase === 'delivered' && grant.quietSince !== null ? [grant.quietSince] : []));
  if (since.length === 0) return;
  timer = setTimeout(() => {
    timer = null;
    settle();
  }, Math.max(0, Math.min(...since) + SETTLE_MS - Date.now()));
}

// The store follows the transcript's store, the queue store, the lane A store, the sessions and the roster while any
// grant is out, and none of them while none is: nothing in it depends on a mounted component.
let following: (() => void) | null = null;
function follow(): void {
  if (following !== null) return;
  const offs = [useTranscriptStore.subscribe(settle), useQueueStore.subscribe(settle), useLaneA.subscribe(settle), useSessions.subscribe(settle), useMachines.subscribe(settle)];
  following = () => offs.forEach((off) => off());
}
function unfollow(): void {
  following?.();
  following = null;
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

// What the store holds for each session with a grant out (`holdSession`: the session's queue and its transcript), so
// that closing the pane does not stop the record the grant ends on. The lane A store lists every session its machine
// serves, whatever is mounted: nothing to hold. Let go when the session's last grant ends, or the session goes.
const holds = new Map<AppSessionId, () => void>();
function keep(sessions: ReadonlySet<AppSessionId>): void {
  for (const [appSessionId, release] of holds) {
    if (sessions.has(appSessionId)) continue;
    holds.delete(appSessionId);
    release();
  }
  for (const appSessionId of sessions) if (!holds.has(appSessionId)) holds.set(appSessionId, holdSession(appSessionId));
}

/** Tests: the window starts with no grant out and no notice. */
export function resetGrantsOut(): void {
  unfollow();
  keep(new Set());
  useGrantsOut.setState({ out: new Map(), notices: new Map() });
}

// ---- in a render -------------------------------------------------------------------------------------------------------

/** The gate and the last press's notice, followed in a render. */
export function useGrant(appSessionId: AppSessionId, call: BlockedCall, grant: 'none' | 'waiting'): { gate: Gate; notice: string | null } {
  // The port's inputs are subscribed through its own hook, so a change renders again; the stores the gate reads besides
  // are followed by one external store whose snapshot is the gate itself, read whenever React asks, so no memo of this
  // component's render can keep an earlier gate.
  useSessionControls(appSessionId);
  const gate = useSyncExternalStore(subscribeGate, () => gateWords(gateOf(appSessionId, call, grant)));
  const notice = useGrantsOut((s) => s.notices.get(outKey(appSessionId, blockedKey(call))) ?? null);
  return { gate: gateOfWords(gate), notice };
}

const subscribeGate = (listener: () => void): (() => void) => {
  const offs = [useGrantsOut.subscribe(listener), useQueueStore.subscribe(listener), useLaneA.subscribe(listener), useTranscriptStore.subscribe(listener)];
  return () => offs.forEach((off) => off());
};
// The gate as one string, so that the snapshot is the same value while the gate is
const gateWords = (gate: Gate): string => (gate.state === 'unavailable' ? `unavailable\u0000${gate.reason}` : gate.state);
const gateOfWords = (words: string): Gate =>
  words.startsWith('unavailable\u0000') ? { state: 'unavailable', reason: words.slice('unavailable\u0000'.length) } : { state: words as 'open' | 'closed' };
