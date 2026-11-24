// The calls of a host this window has made for the sheet's Sends, each by its attempt (the C3 plan's §G, "Shared
// memory"). The memory is the consumer's and may be shown by two mounts at once, so a call is not a mount's: its answer
// waits here until a mount showing a memory that still holds that attempt settles it against that memory as it is then.
// A mount that is gone settles nothing. An attempt this window never made, or forgot (a reload), is a Send whose answer
// will not come, and is offered again; one still in the air is a sibling's, and is left to it.
import type { SheetPutResult } from '@shared/sheet/model';

type Attempt = { state: 'flying' } | { state: 'answered'; result: SheetPutResult };
const attempts = new Map<string, Attempt>();
const listeners = new Set<() => void>();
let version = 0;
let made = 0;
const WINDOW = Math.random().toString(36).slice(2, 10); // attempts of another window, or of this one before a reload, are not these

/** A new attempt's name, to hold in the memory before its call is made. */
export const newAttempt = (): string => `${WINDOW}-${(made += 1)}`;

/** Makes the call for an attempt; its answer, or its failure as `failed`, is kept for whichever mount settles it. */
export function launch(attempt: string, call: () => Promise<SheetPutResult>): void {
  attempts.set(attempt, { state: 'flying' });
  call()
    .catch((error: unknown): SheetPutResult => ({ ok: false, why: 'failed', message: error instanceof Error ? error.message : String(error) }))
    .then((result) => {
      attempts.set(attempt, { state: 'answered', result });
      version += 1;
      for (const listener of listeners) listener();
    });
}

/** What this window knows of an attempt: in the air, answered, or nothing (never made here, or forgotten). */
export const attemptOf = (attempt: string): Attempt | undefined => attempts.get(attempt);

export function subscribeAttempts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const attemptsVersion = (): number => version;

/** Tests: the window that made every call so far is gone. */
export function forgetAttempts(): void {
  attempts.clear();
  version += 1;
  for (const listener of listeners) listener();
}
