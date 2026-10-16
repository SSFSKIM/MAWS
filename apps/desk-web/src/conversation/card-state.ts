// What a request card draws (§4, §5, DX4, DX6, and DC2's M3 as relayed): open — answerable, with a background
// subagent's short window marked while it lasts; in flight while its RPC is sent or forwarded; `uncertain` with a Retry
// of the same nonce; failed with its reason (another decision may follow); sent and waiting for the settlement;
// settled by its winner — and a late decision the bridge refused naming the winner is that settlement, not an error;
// waiting in the terminal when the hub marks it `terminal_only` or the session has no bridge; shown but not answerable
// while the machine is offline, or while the project socket is down; closed when it left the pending set with no settlement this tab saw (unless a
// decision on it is `uncertain`: that keeps its Retry).
import type { Raised, Settled } from 'desk-hub/protocol';
import { failureOf } from './outcome';
import type { RequestRecord, RpcEntry } from '../project/conversation';
import type { Capability } from './capabilities';

export type CardState =
  | { kind: 'open'; window: boolean }
  | { kind: 'sending' }
  /** `offline`: the machine is unavailable too; the retry still resends the original sealed RPC. */
  | { kind: 'uncertain'; offline: boolean }
  | { kind: 'failed'; code: string; message: string }
  | { kind: 'sent' }
  /** `winner` null: a late decision's refusal named only who decided (`by`). */
  | { kind: 'settled'; winner: Settled['winner'] | null; outcome: Settled['outcome'] | null; by: string }
  | { kind: 'terminal'; why: 'window' | string }
  | { kind: 'offline' }
  /** The project socket is down: shown, not answerable until it is back. */
  | { kind: 'disconnected' }
  | { kind: 'closed' };

export const isQuestion = (tool: string) => tool === 'AskUserQuestion' || tool.endsWith('__AskUserQuestion');

/** An async question (the ask mod's, raised with `async`) is answer-only: no Deny is drawn, and the bridge refuses one. */
export const isAsyncQuestion = (raised: Raised) => isQuestion(raised.tool) && (raised as { async?: unknown }).async === true;

/**
 * `capability` is the session's for this request's verb (`answer` or `decide`); `machineOnline` the machine's lease;
 * `connected` whether the project socket is welcomed.
 */
export function cardState(record: RequestRecord, rpc: RpcEntry | null, capability: Capability, machineOnline: boolean | null = true, connected = true): CardState {
  if (record.settled) return { kind: 'settled', winner: record.settled.winner, outcome: record.settled.outcome, by: record.settled.by };
  const failure = failureOf(rpc?.outcome);
  if (failure?.terminalOnly) return { kind: 'terminal', why: 'window' };
  // A late decision, refused naming who decided: `by` says who, and may come without `winner`.
  if (failure && (failure.winner || failure.by)) return { kind: 'settled', winner: failure.winner ?? null, outcome: null, by: failure.by ?? '' };
  // A decision whose result is unknown stays so whatever the machine does, and whether or not the request is still in
  // the pending set (a daemon's republished set drops one without saying how): its retry is the only way to learn it.
  if (rpc?.state === 'uncertain') return { kind: 'uncertain', offline: machineOnline === false };
  if (!record.pending) {
    // No new decision on a request no longer waiting; one already made is followed to its result (a Retry in flight).
    if (rpc?.state === 'sending' || rpc?.state === 'forwarded') return { kind: 'sending' };
    if (rpc?.state === 'done') return { kind: 'sent' };
    return { kind: 'closed' };
  }
  if (!connected) return { kind: 'disconnected' };
  if (machineOnline === false) return { kind: 'offline' };
  if (record.terminalOnly) return { kind: 'terminal', why: 'window' };
  if (!capability.can) return { kind: 'terminal', why: capability.reason ?? 'terminal only' };
  switch (rpc?.state) {
    case 'sending':
    case 'forwarded':
      return { kind: 'sending' };
    case 'failed':
      return { kind: 'failed', code: failure?.code ?? 'failed', message: failure?.message ?? '' };
    case 'not-connected':
      return { kind: 'failed', code: 'not-connected', message: 'not connected to the hub: nothing was sent' };
    case 'done':
      return { kind: 'sent' };
    default:
      return { kind: 'open', window: record.raised.deadline !== undefined };
  }
}
