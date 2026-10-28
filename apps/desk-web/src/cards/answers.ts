// An answer from the phone (P5 O13 M4, §D; RL4, RL §5.10): the one kind of action a `web-cards` device sends. Exactly
// five forms, nothing else built (the endpoint refuses the rest `class`, O10 §G):
//   lane A question     sminos.answer   args { session, answers, digest }
//   lane A permission   sminos.decide   args { session, decision: 'allow' | 'deny', digest }        no scope, no message
//   lane B              session.answer  args { appSessionId, requestId, answer }, the answer one of
//                         { kind: 'permission', decision: 'allow', scope: 'once' }   Allow
//                         { kind: 'permission', decision: 'deny' }                    Deny: no scope (the schema forbids it)
//                         { kind: 'question', answers }                               keyed by question text
// each with its session's context (lane A `{lane, session, launch}`, lane B `{lane, launchId, engineSessionId}`) and
// the request digest the card drew. An answer seals its operation with a fresh nonce and time and a WebAuthn assertion
// whose challenge is the action's digest (one gesture each), sends `act`, and reads `ack` then `done`.
//
// A `done` is an envelope: its outcome is normalized here before any view sees it (`outcomeOf`). No `ack` within 10 s,
// no `done` within 60 s, or the channel ending first leaves the answer uncertain, and the phone never queries (its class
// is refused, P5 Decision Log 64): Retry reseals the operation the answer retained (`retry`) with a fresh nonce, time
// and gesture and nothing else changed, so its fingerprint is the first copy's and the executing side's ledger answers
// the first copy's result if it ran. An action rebuilt from the card would be another operation, refused `op-conflict`.
import { actionDigest, base64urlEncode, NONCE_BYTES, type Action, type DeviceIdentity } from 'org-protocol';
import type { RequestAnswer } from '@shared/engine/answers';
import type { Assert } from './cards-passkey';
import { cardKind, unanswerable, type Card } from './cards';
import type { MachineChannel } from './client';

export type { Assert } from './cards-passkey';

export type Answer = { kind: 'question'; answers: Record<string, string> } | { kind: 'decision'; decision: 'allow' | 'deny' };

/** What the ledgers' fingerprint binds: the action less what each sealing changes. Retained per card for the tab's life. */
export type Operation = Omit<Action, 'nonce' | 'created' | 'stepUp' | 'webauthn'>;

/** A `done` envelope's inner outcome, or an `ack`'s refusal, normalized. */
export type Outcome =
  | { state: 'done'; result: unknown }
  | { state: 'failed'; error: unknown }
  | { state: 'refused'; reason: string }
  | { state: 'uncertain'; why: 'no-ack' | 'no-done' | 'in-progress' | 'unknown' };

/** How long an answer waits for its `ack`, and for its `done` (RL4's freshness), from when it is sent. */
export const ACK_MS = 10_000;
export const DONE_MS = 60_000;

export type AnswerOptions = { now?: () => number; ackMs?: number; doneMs?: number };

/** A card this client cannot answer, or an answer the card does not take: nothing was built or sent. */
export class AnswerError extends Error {}

const random = (bytes: number) => base64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));

/** The operation answering `card` with `given`, first sealed at `now`, on `machine` (its ref). */
export function operationFor(identity: DeviceIdentity, machine: string, card: Card, given: Answer, now: number): Operation {
  const blocked = unanswerable(card);
  if (blocked !== null) throw new AnswerError(blocked.text);
  const kind = cardKind(card);
  if ((kind === 'question') !== (given.kind === 'question')) throw new AnswerError(`a ${kind} card takes no ${given.kind === 'question' ? 'answers' : 'decision'}`);
  const head = { v: 1 as const, org: identity.org, machine, device: identity.device, opId: random(16), opCreated: new Date(now).toISOString() };
  if (card.lane === 'A') {
    const session = card.raised.session;
    const digest = card.digest;
    const common = { ...head, session, context: { lane: 'A' as const, session, launch: card.launch! }, requestDigest: digest };
    return given.kind === 'question'
      ? { ...common, action: 'sminos.answer', args: { session, answers: given.answers, digest } }
      : { ...common, action: 'sminos.decide', args: { session, decision: given.decision, digest } };
  }
  const appSessionId = card.item.appSessionId;
  const answer: RequestAnswer =
    given.kind === 'question'
      ? { kind: 'question', answers: given.answers }
      : given.decision === 'allow'
        ? { kind: 'permission', decision: 'allow', scope: 'once' }
        : { kind: 'permission', decision: 'deny' };
  return {
    ...head,
    action: 'session.answer',
    session: appSessionId,
    context: { lane: 'B', launchId: card.context.launchId, engineSessionId: card.context.engineSessionId! },
    args: { appSessionId, requestId: card.item.request.requestId!, answer },
    requestDigest: card.digest!,
  };
}

/** `operation` sealed for sending at `now`: a fresh nonce and time, and the assertion over the result's digest. */
export async function seal(operation: Operation, assert: Assert, now: number): Promise<Action> {
  const action: Action = { ...operation, nonce: random(NONCE_BYTES), created: new Date(now).toISOString() };
  return { ...action, webauthn: await assert(await actionDigest(action)) };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A `done`'s outcome (O10 §B) as the client's: anything it can't read is uncertain, never a success. */
export function outcomeOf(outcome: unknown): Outcome {
  if (!isObject(outcome)) return { state: 'uncertain', why: 'unknown' };
  switch (outcome.state) {
    case 'done':
      return { state: 'done', result: outcome.result };
    case 'failed':
      return { state: 'failed', error: outcome.error };
    case 'refused':
      return typeof outcome.reason === 'string' ? { state: 'refused', reason: outcome.reason } : { state: 'uncertain', why: 'unknown' };
    case 'in-progress':
      return { state: 'uncertain', why: 'in-progress' };
    default:
      return { state: 'uncertain', why: 'unknown' };
  }
}

/** Sends `action` and reads its `ack` and `done` on `channel`, as an `Outcome`. */
function sent(channel: MachineChannel, action: Action, options: AnswerOptions): Promise<Outcome> {
  return new Promise((resolve) => {
    let acked = false;
    let settled = false;
    const finish = (outcome: Outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(ackTimer);
      clearTimeout(doneTimer);
      offMessage();
      offClose();
      resolve(outcome);
    };
    const uncertain = () => finish({ state: 'uncertain', why: acked ? 'no-done' : 'no-ack' });
    const offMessage = channel.onMessage((message) => {
      if (message.opId !== action.opId) return;
      if (message.t === 'ack') {
        if (message.state === 'refused') return finish({ state: 'refused', reason: typeof message.reason === 'string' ? message.reason : 'unknown' });
        acked = true;
        clearTimeout(ackTimer);
      } else if (message.t === 'done') finish(outcomeOf(message.outcome));
    });
    const offClose = channel.onClose(uncertain);
    const ackTimer = setTimeout(uncertain, options.ackMs ?? ACK_MS);
    const doneTimer = setTimeout(uncertain, options.doneMs ?? DONE_MS);
    if (channel.closed) return uncertain();
    channel.send({ t: 'act', action }).catch(uncertain);
  });
}

/**
 * Answers `card` with `given` on `channel`: the operation it built (to keep for a Retry) and its outcome. Throws
 * `AnswerError` for a card it cannot answer, and the assertion's own error when the gesture fails; nothing is sent then.
 */
export async function answer(channel: MachineChannel, identity: DeviceIdentity, card: Card, given: Answer, assert: Assert, options: AnswerOptions = {}): Promise<{ operation: Operation; outcome: Outcome }> {
  const now = options.now ?? Date.now;
  const operation = operationFor(identity, channel.machine, card, given, now());
  return { operation, outcome: await sent(channel, await seal(operation, assert, now()), options) };
}

/** The same operation again after a lost acknowledgement: a fresh nonce, time and assertion, nothing else changed. */
export async function retry(channel: MachineChannel, operation: Operation, assert: Assert, options: AnswerOptions = {}): Promise<Outcome> {
  const now = options.now ?? Date.now;
  return sent(channel, await seal(operation, assert, now()), options);
}
