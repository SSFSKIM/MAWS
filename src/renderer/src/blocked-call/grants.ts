// UX wave U1c (l4-approvals-12; the U1c document, Design 4 to 7, Interfaces §F): "Approve and retry" on a call auto mode
// blocked. The press is the session's own send of the engine's grant sentence, nothing else, on every route. Whether the
// button is offered is one function (`gateOf`); the press is one function (`approve`); and between the press and the
// record's answer the window keeps a grant out, a store of its own that only keeps the button closed, never makes a row
// read approved, belongs to no mounted row, and ends on evidence: the transcript's own approval row for the call, or a
// quiet moment of `SETTLE_MS` after the send was acknowledged and the record stopped listing the grant as waiting.
import { create } from 'zustand';
import { consentMessage, personsGrants } from '@shared/engine/arrival';
import { messageText } from '@shared/engine/peer-envelope';
import type { ContentBlock } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { HumanPromptOptions, HumanPromptResult } from '../composer/submit/send-human-prompt';
import { TERMINAL_KEEPS_NO_QUEUE } from '../composer/submit/submit-state';
import { drivenByBridge, heldWords, sendToSession, sessionControls, useSessionControls } from '../session/controls/controls-for';
import { LANE_A_WORDS } from '../session/controls/lane-a';
import { laneAStateOf, useLaneA } from '../stores/lane-a';
import { useQueueStore } from '../stores/queue';
import { useTranscriptStore } from '../stores/transcript';
import { approvalsFor, blockedKey, hiddenTurnsOf, type BlockedCall } from '../transcript/model/blocked';
import type { Row } from '../transcript/model/rows';

export const SETTLE_MS = 5_000;
/** Probe B's one place: how a grant is sent to a session MAWS runs while a turn runs. 'after' until probe B's recordings are named here. */
export const GRANT_DURING_TURN: 'after' | 'next' = 'after';
/** Probe T's one place: the states of a terminal session in which the button is offered. M3 writes all false; M4 turns each true by its recording (u1c-t-*, 3 of 3 each). */
export const TERMINAL_OFFERED: Readonly<Record<TerminalState, boolean>> = { idle: false, running: false, stopped: false };

export type TerminalState = 'idle' | 'running' | 'stopped';
export type Gate = { state: 'open' } | { state: 'closed' } | { state: 'unavailable'; reason: string };

// ---- the record --------------------------------------------------------------------------------------------------------

/** A terminal session's state as the window knows it (Design 7; Decision Log 5): running while its bridge says a turn runs or does not know; else stopped when the transcript's newest turn reads stopped; else idle. */
export function terminalStateOf(appSessionId: AppSessionId): TerminalState {
  const turn = laneAStateOf(appSessionId)?.turn;
  if (turn === undefined || turn.running || turn.unknown) return 'running';
  return newestTurnStopped(appSessionId) ? 'stopped' : 'idle';
}

const newestTurnStopped = (appSessionId: AppSessionId): boolean => newestStoppedIn(useTranscriptStore.getState().entries[appSessionId]?.rows);
function newestStoppedIn(rows: readonly Row[] = []): boolean {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]!;
    if (row.kind === 'divider') return row.state === 'stopped';
  }
  return false;
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

/** The press (Design 4). The only caller of the port's send for a grant; it sends nothing while the gate is not open. */
export async function approve(appSessionId: AppSessionId, call: BlockedCall): Promise<void> {
  if (gateOf(appSessionId, call, 'none').state !== 'open') return;
  const key = blockedKey(call);
  const at = outKey(appSessionId, key);
  begin(at, { appSessionId, key, phase: 'sending', rows: approvalsNow(appSessionId, key), quietSince: null }); // the linearisation point: "sending" is in the store before the send is called
  let result: HumanPromptResult;
  try {
    result = await sendToSession(appSessionId, consentMessage(call.kind, call.subject), grantOptions(appSessionId));
  } catch (error) {
    return fail(at, error instanceof Error ? error.message : String(error));
  }
  if (result.disposition === 'refused' || result.disposition === 'held') return fail(at, result.disposition === 'refused' ? (result.reason ?? null) : null);
  delivered(at);
}

// ---- the grants out ----------------------------------------------------------------------------------------------------

interface Out {
  appSessionId: AppSessionId;
  key: string;
  phase: 'sending' | 'delivered';
  rows: number; // the approval rows the transcript held for the key at the press
  quietSince: number | null; // delivered: when the record first listed no waiting grant for the key
}
interface GrantsOut {
  out: ReadonlyMap<string, Out>;
  notices: ReadonlyMap<string, string>; // the last press's refusal, in the port's words
}

/** The grants out, by session and key, and the last press's notice beside them. The window's memory; never stored. */
export const useGrantsOut = create<GrantsOut>()(() => ({ out: new Map(), notices: new Map() }));

const outKey = (appSessionId: AppSessionId, key: string): string => `${appSessionId}\u0001${key}`;
const approvalsNow = (appSessionId: AppSessionId, key: string): number => {
  const entry = useTranscriptStore.getState().entries[appSessionId];
  return entry === undefined ? 0 : approvalsFor(entry.rows, hiddenTurnsOf(entry.state), key);
};

// Every change of the grants out goes through here: the store follows the record while any grant is out, and stops.
function put(out: ReadonlyMap<string, Out>, notices: ReadonlyMap<string, string> = useGrantsOut.getState().notices): void {
  useGrantsOut.setState({ out, notices });
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

function fail(at: string, notice: string | null): void {
  const { out, notices } = useGrantsOut.getState();
  if (!out.has(at)) return; // the record answered first
  put(without(out, at), notice === null || notice === '' ? notices : new Map(notices).set(at, notice));
}

function delivered(at: string): void {
  const { out } = useGrantsOut.getState();
  const grant = out.get(at);
  if (grant === undefined || grant.phase !== 'sending') return; // the record answered first
  put(new Map(out).set(at, { ...grant, phase: 'delivered' }));
  settle();
}

// The transitions on evidence (Design 4's table): the transcript holds more approval rows for the key than at the press,
// and the grant ends whatever its phase; a delivered grant the record no longer lists as waiting starts its clock, and
// ends when the clock reaches SETTLE_MS; one the record lists again stops it.
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
    if (approvalsNow(grant.appSessionId, grant.key) > grant.rows) {
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

// The store follows the transcript's store, the queue store and the lane A store while any grant is out, and none of them
// while none is: nothing in it depends on a mounted component.
let following: (() => void) | null = null;
function follow(): void {
  if (following !== null) return;
  const offs = [useTranscriptStore.subscribe(settle), useQueueStore.subscribe(settle), useLaneA.subscribe(settle)];
  following = () => offs.forEach((off) => off());
}
function unfollow(): void {
  following?.();
  following = null;
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

/** Tests: the window starts with no grant out and no notice. */
export function resetGrantsOut(): void {
  unfollow();
  useGrantsOut.setState({ out: new Map(), notices: new Map() });
}

// ---- in a render -------------------------------------------------------------------------------------------------------

/** The gate and the last press's notice, followed in a render. */
export function useGrant(appSessionId: AppSessionId, call: BlockedCall, grant: 'none' | 'waiting'): { gate: Gate; notice: string | null } {
  const at = outKey(appSessionId, blockedKey(call));
  // what `gateOf` reads, subscribed so that a change renders again: the port's inputs, the grants out, the queue's
  // snapshot, a terminal session's pending sends and state, and its transcript's newest turn
  useSessionControls(appSessionId);
  useGrantsOut((s) => s.out.has(at));
  const notice = useGrantsOut((s) => s.notices.get(at) ?? null);
  useQueueStore((s) => s.bySession.get(appSessionId));
  useLaneA((s) => s.pendingSends.get(appSessionId));
  useTranscriptStore((s) => newestStoppedIn(s.entries[appSessionId]?.rows));
  return { gate: gateOf(appSessionId, call, grant), notice };
}
