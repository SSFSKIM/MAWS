// The Sends of this window still in the air, each by its attempt (the C3 plan's §G, "Shared memory"). A memory may be
// shown by two mounts, or by none, while its Send is in the air, so the call is not a mount's: its answer lands through
// the update the Send was made with, in that session's memory as it is then, and the attempt is forgotten. A held Send
// whose attempt this window does not have in the air (it never made it, or a reload forgot it) is one whose answer will
// not come, and is offered again; one in the air is waited for, whichever mount made it.
import type { SheetPutResult } from '@shared/sheet/model';

const flying = new Set<string>();
let made = 0;
const WINDOW = Math.random().toString(36).slice(2, 10); // attempts of another window, or of this one before a reload, are not these

/** A new attempt's name, to hold in the memory before its call is made. */
export const newAttempt = (): string => `${WINDOW}-${(made += 1)}`;

/**
 * Makes the call for an attempt and lands its answer once: a call that throws, before returning or after, is a failed
 * Send, to be offered again.
 */
export function launch(attempt: string, call: () => Promise<SheetPutResult>, land: (result: SheetPutResult) => void): void {
  flying.add(attempt);
  let answer: Promise<SheetPutResult>;
  try {
    answer = call();
  } catch (error) {
    answer = Promise.reject(error);
  }
  void answer
    .catch((error: unknown): SheetPutResult => ({ ok: false, why: 'failed', message: error instanceof Error ? error.message : String(error) }))
    .then((result) => {
      flying.delete(attempt);
      land(result);
    });
}

/** Whether this window's call for an attempt is still in the air. */
export const isFlying = (attempt: string): boolean => flying.has(attempt);

/** Tests: the window that made every call so far is gone (a reload). */
export function forgetAttempts(): void {
  flying.clear();
}
