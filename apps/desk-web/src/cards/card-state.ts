// What a channel card draws (P5 O13 M5): `card-state.ts`'s vocabulary (src/conversation), reached from what this tab
// did about the card — nothing, a gesture asked for, an act sent, or the client's normalized `Outcome` (M4) — and from
// the card as the latest set carries it. One function, so a `done` envelope carrying a failure is never drawn as sent:
//
//   no attempt                              open
//   the gesture asked for, the act sent     sending
//   done                                    sent, until a set no longer carries the card (closed)
//   failed, refused (but for the two below) failed {code}, answerable anew under a new operation
//   refused digest-mismatch or context      the request changed, while the card is the one the answer was built from
//                                             (its digest and context) and until the next set
//   uncertain (no ack in 10 s, no done in   uncertain: Retry reseals the retained operation, and no new answer is
//     60 s, in-progress, unknown)             offered; `offline` while the channel is down, its Retry waiting for one
//   the channel down                        disconnected
//   a card the client can't answer          not yet actionable, with why (a lane B session not prompted locally, an
//                                             item naming no request, no bridge); the request changed when the
//                                             endpoint's digest differs from the phone's
//   a card no set carries any more          closed
import { canonicalize } from 'org-protocol';
import type { CardState } from '../conversation/card-state';
import type { Answer, Operation, Outcome } from './answers';
import { unanswerable, type Card, type Unanswerable } from './cards';

/**
 * What this tab did about a card, kept for the tab's life (the retained operation's home). `card` is the card the answer
 * was built from, as it was drawn then: what its gesture approves, a Retry's included, though a later set redrew it.
 */
export type Attempt =
  /** The gesture is asked for: a first answer's (no operation yet) or a Retry's (the operation it reseals). */
  | { phase: 'asking'; answer: Answer; card: Card; operation: Operation | null }
  /** The gesture was made and the act is on its way; its `ack` and `done` not read yet. */
  | { phase: 'sending'; answer: Answer; card: Card; operation: Operation | null }
  | { phase: 'outcome'; answer: Answer; card: Card; operation: Operation; outcome: Outcome };

export type ChannelCardState =
  | Extract<CardState, { kind: 'open' | 'sending' | 'sent' | 'failed' | 'uncertain' | 'disconnected' | 'closed' }>
  | { kind: 'changed' }
  | { kind: 'not-actionable'; why: Exclude<Unanswerable['why'], 'request-changed'>; text: string };

/** A refusal's reason in the card's words (O10 §B, §G; the endpoint's and the executor's). */
const REFUSED: Record<string, string> = {
  class: 'this phone may not do that on a moved machine',
  grade: 'this session is not yours to answer',
  stale: 'the answer was too old when it arrived',
  'step-up': 'the machine did not accept the passkey’s approval',
  'read-only': 'the machine is read-only',
  unavailable: 'the session cannot take an answer now',
  'op-conflict': 'the machine holds another answer under this one’s id',
  tombstoned: 'the session ended before the answer ran',
  malformed: 'the machine could not read the answer',
};

export const refusalText = (reason: string): string => REFUSED[reason] ?? `refused (${reason})`;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A failure's code and words: lane B's as the engine host gives them, lane A's by its code alone (O10 M7). */
function failureOf(error: unknown): { code: string; message: string } {
  if (!isObject(error)) return { code: 'failed', message: '' };
  return { code: typeof error.code === 'string' ? error.code : 'failed', message: typeof error.message === 'string' ? error.message : '' };
}

/** Whether `card` is still the one `operation` was built from: the request digest and the session's context it bound. */
function sentFrom(card: Card, operation: Operation): boolean {
  const context = card.lane === 'A' ? { lane: 'A', session: card.raised.session, launch: card.launch } : { lane: 'B', ...card.context };
  return canonicalize(card.digest) === canonicalize(operation.requestDigest ?? null) && canonicalize(context) === canonicalize(operation.context ?? null);
}

/**
 * The state of `card` (null: the latest set no longer carries it) after `attempt` (null: none in this tab), the channel
 * `connected` or not.
 */
export function channelCardState({ card, attempt, connected }: { card: Card | null; attempt: Attempt | null; connected: boolean }): ChannelCardState {
  if (card === null) return { kind: 'closed' };
  const outcome = attempt?.phase === 'outcome' ? attempt.outcome : null;
  // An answer whose result is unknown stays so, whatever the card shows meanwhile: its Retry is how it is learnt.
  if (outcome?.state === 'uncertain') return { kind: 'uncertain', offline: !connected };
  if (attempt !== null && attempt.phase !== 'outcome') return { kind: 'sending' };
  if (outcome?.state === 'done') return { kind: 'sent' };
  if (!connected) return { kind: 'disconnected' };
  const blocked = unanswerable(card);
  if (blocked !== null) return blocked.why === 'request-changed' ? { kind: 'changed' } : { kind: 'not-actionable', why: blocked.why, text: blocked.text };
  if (outcome?.state === 'refused' && (outcome.reason === 'digest-mismatch' || outcome.reason === 'context')) {
    return sentFrom(card, attempt!.operation!) ? { kind: 'changed' } : { kind: 'open', window: false };
  }
  if (outcome?.state === 'refused') return { kind: 'failed', code: outcome.reason, message: refusalText(outcome.reason) };
  if (outcome?.state === 'failed') return { kind: 'failed', ...failureOf(outcome.error) };
  return { kind: 'open', window: false };
}
