// What this tab did about each channel card (P5 O13 M5): the answer it gave, the operation it retained (M4: what the
// ledgers' fingerprint binds, which a Retry reseals unchanged), and how it came out, kept by `<machine ref>/<session>/
// <card>` for the tab's life, across the card view closing and the channel reconnecting. A reload loses them (M4: a
// card still pending is then answered anew, and an answer the first copy delivered is refused, never applied twice).
//
// An answer asks for the gesture (the card says what it approves meanwhile), then sends; a gesture refused or an answer
// the card does not take sends nothing and leaves the card as it was, with a note saying why.
import { create } from 'zustand';
import { answer, retry, type Answer } from '../../cards/answers';
import type { Attempt } from '../../cards/card-state';
import type { Card } from '../../cards/cards';
import { CardsPasskeyError, type Assert } from '../../cards/cards-passkey';
import type { MachineChannel } from '../../cards/client';
import type { DeviceIdentity } from 'org-protocol';

type Attempts = { attempts: Record<string, Attempt>; notes: Record<string, string> };

export const useAttempts = create<Attempts>()(() => ({ attempts: {}, notes: {} }));

export const attemptKey = (machine: string, session: string, card: string) => `${machine}/${session}/${card}`;

function put(key: string, attempt: Attempt | null, note: string | null = null): void {
  useAttempts.setState((s) => {
    const attempts = { ...s.attempts };
    const notes = { ...s.notes };
    if (attempt === null) delete attempts[key];
    else attempts[key] = attempt;
    if (note === null) delete notes[key];
    else notes[key] = note;
    return { attempts, notes };
  });
}

/** Why nothing was sent, in the card's words. */
function unsent(error: unknown): string {
  if (error instanceof CardsPasskeyError) return error.reason === 'cancelled' ? 'Face ID was cancelled: nothing was sent.' : `Nothing was sent: ${error.message}`;
  return `Nothing was sent: ${error instanceof Error ? error.message : String(error)}`;
}

/** `assert`, telling the card once the gesture was made (the act is then on its way). */
const telling = (assert: Assert, made: () => void): Assert => async (challenge) => {
  const assertion = await assert(challenge);
  made();
  return assertion;
};

/** Answers `card` on `channel` as `identity` with `given`; the attempt under `key` follows it. */
export async function answerCard(key: string, channel: MachineChannel, identity: DeviceIdentity, card: Card, given: Answer, assert: Assert): Promise<void> {
  const before = useAttempts.getState().attempts[key] ?? null;
  put(key, { phase: 'asking', answer: given, card, operation: null });
  try {
    const sent = await answer(channel, identity, card, given, telling(assert, () => put(key, { phase: 'sending', answer: given, card, operation: null })));
    put(key, { phase: 'outcome', answer: given, card, operation: sent.operation, outcome: sent.outcome });
  } catch (error) {
    put(key, before, unsent(error));
  }
}

/** Reseals the operation an uncertain attempt under `key` retained, on `channel`; nothing else changes. */
export async function retryCard(key: string, channel: MachineChannel, assert: Assert): Promise<void> {
  const before = useAttempts.getState().attempts[key];
  if (before?.phase !== 'outcome') return;
  // The card the operation was built from, kept with it: what the Retry's gesture approves.
  const { answer: given, card, operation } = before;
  put(key, { phase: 'asking', answer: given, card, operation });
  try {
    const outcome = await retry(channel, operation, telling(assert, () => put(key, { phase: 'sending', answer: given, card, operation })));
    put(key, { phase: 'outcome', answer: given, card, operation, outcome });
  } catch (error) {
    put(key, before, unsent(error));
  }
}

/** A note on the card under `key` (an answer nothing was sent for); null clears it. */
export function noteCard(key: string, note: string | null): void {
  const attempt = useAttempts.getState().attempts[key] ?? null;
  put(key, attempt, note);
}

/**
 * A new set of the session's cards came: a refusal that said the request changed (`digest-mismatch`, `context`) holds
 * only until then, and the card is answerable anew if the set still carries it.
 */
export function newSet(machine: string, session: string): void {
  const prefix = `${machine}/${session}/`;
  const { attempts } = useAttempts.getState();
  for (const [key, attempt] of Object.entries(attempts)) {
    if (!key.startsWith(prefix) || attempt.phase !== 'outcome' || attempt.outcome.state !== 'refused') continue;
    if (attempt.outcome.reason === 'digest-mismatch' || attempt.outcome.reason === 'context') put(key, null);
  }
}
