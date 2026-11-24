// The Sends of this window, each by its attempt (the C3 plan's §G, "Shared memory"). A memory may be shown by two
// mounts, or by none, and its updates may be applied after the press that made them, so a press does not call the host:
// it hands the memory an update that holds the slot (`startSend`), and leaves its call here. The call is made once, by
// whichever mount first shows a memory holding that attempt, so two presses before either is applied make one call. Its
// answer lands through the update the Send was made with, in that session's memory as it is then, and the attempt is
// forgotten. A held Send whose attempt this window does not know (it never made it, or a reload forgot it) is one whose
// answer will not come, and is offered again; one waiting or in the air is waited for, whichever mount made it.
import type { SheetPutResult } from '@shared/sheet/model';

interface Waiting {
  session: string;
  call(): Promise<SheetPutResult>;
  land(result: SheetPutResult): void;
}
const waiting = new Map<string, Waiting>();
const flying = new Set<string>();
let made = 0;
const WINDOW = Math.random().toString(36).slice(2, 10); // attempts of another window, or of this one before a reload, are not these

/** A new attempt's name, to hold in the memory before its call is made. */
export const newAttempt = (): string => `${WINDOW}-${(made += 1)}`;

/** The call an attempt makes once a memory holds it, and where its answer lands. */
export function prepare(attempt: string, session: string, call: () => Promise<SheetPutResult>, land: (result: SheetPutResult) => void): void {
  waiting.set(attempt, { session, call, land });
}

/**
 * Makes the call of an attempt a memory now holds, once; the session's other prepared attempts lost the slot to it and
 * are dropped. A call that throws, before returning or after, is a failed Send, to be offered again.
 */
export function launchHeld(attempt: string): void {
  const prepared = waiting.get(attempt);
  if (prepared === undefined) return;
  for (const [other, entry] of waiting) if (entry.session === prepared.session) waiting.delete(other);
  flying.add(attempt);
  let answer: Promise<SheetPutResult>;
  try {
    answer = prepared.call();
  } catch (error) {
    answer = Promise.reject(error);
  }
  void answer
    .catch((error: unknown): SheetPutResult => ({ ok: false, why: 'failed', message: error instanceof Error ? error.message : String(error) }))
    .then((result) => {
      flying.delete(attempt);
      prepared.land(result);
    });
}

/** Whether this window will still answer an attempt: its call waits to be made, or is in the air. */
export const isKnown = (attempt: string): boolean => waiting.has(attempt) || flying.has(attempt);

/** Tests: the window that made every call so far is gone (a reload). */
export function forgetAttempts(): void {
  waiting.clear();
  flying.clear();
}
