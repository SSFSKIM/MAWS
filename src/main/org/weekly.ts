// The weekly successor's asking (P5 O8 M3, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M3's "The weekly
// successor"; Interfaces §K; the owner's Q6). Every endpoint stops remote actions on a head issued more than 30 days
// ago (RL §5.2's backstop), so a root re-signs the org state, unchanged, every week; once the app is a root, it does
// so here and the deployment admin's `refresh` can stop.
//
// - Due: this device may sign (a root, its keys marked, signing.json readable: the signer's `maySign`), no state is
//   pending, and the held head was issued at least WEEKLY_DUE_DAYS ago.
// - Asking: at a window's focus while due, if `lastAsked` is not within ASK_GAP_MS, the signer signs the no-change
//   successor. Its settle, the hub's chain and the checks come first, so the moment Touch ID would ask can be well after
//   the focus: the signer calls a gate right before it (`beforePrompt`), which asks only while a window is still in
//   front. The gate checks focus, writes `lastAsked` (before any prompt, so a crash never asks twice a day), and checks
//   focus again once the write lands, Touch ID following synchronously; focus lost during the write takes the date back.
//   An ask that never reached Touch ID (no window in front, or the signer ending before it) spends no day: the next
//   focus asks. A cancel at Touch ID ends it for the day; the Org section's quiet line (`due`, `ageDays`) stays, with
//   "Re-sign now" (`resign`), which signs at once.
// - Notifying: every WEEKLY_CHECK_MS, while due and no window is focused, if `lastNotified` is not within ASK_GAP_MS,
//   `lastNotified` is written first, then one notification. Touch ID is never asked from the timer: a fingerprint is
//   asked for only with a window in front.
//
// Both dates live in signing.json, written through the one signing store, so neither replaces the pending slot or a
// delivery's acknowledgement with an older snapshot. Electron-free: focus, the focused window and `notify` are injected.
import type { SignedOrgState } from '../../../apps/org-protocol/src/index.ts';
import { noChangeEdit, type OrgSigner, type SignOutcome } from './signer';
import type { SigningFile, SigningStore } from './signing-store';
import { orgTiming, type OrgTiming } from './timing';

const DAY_MS = 86_400_000;

export interface Weekly {
  /** The weekly successor is due: the Org section's quiet line shows. */
  due(): boolean;
  /** The held head's age in whole days, or null with no head. */
  ageDays(): number | null;
  /** "Re-sign now": the no-change successor signed at once (Touch ID asks). */
  resign(): Promise<SignOutcome>;
  /** `due()` or `ageDays()` changed (read at each focus, each check and each change of the signer). */
  onChanged(listener: () => void): () => void;
  close(): void;
}

export type WeeklyDeps = {
  signer: Pick<OrgSigner, 'maySign' | 'pending' | 'sign' | 'onChanged'>;
  /** The held head, or null while none is held. */
  head: () => SignedOrgState | null;
  store: SigningStore;
  /** An app window has focus. */
  focused(): boolean;
  /** An app window gained focus (main's `browser-window-focus`). */
  onFocus(listener: () => void): () => void;
  /** One system notification; a click brings the app to the front, whose focus may then ask. */
  notify(text: string): void;
  timing?: Partial<OrgTiming>;
  now?(): number;
  log(line: string): void;
};

export function startWeekly(deps: WeeklyDeps): Weekly {
  const timing = orgTiming(deps.timing);
  const now = deps.now ?? Date.now;
  const log = (line: string) => deps.log(`weekly: ${line}`);
  const listeners = new Set<() => void>();
  let closed = false;
  let asking = false;

  function ageMs(): number | null {
    const head = deps.head();
    return head === null ? null : now() - Date.parse(head.state.issued);
  }

  function due(): boolean {
    const age = ageMs();
    return age !== null && age >= timing.WEEKLY_DUE_DAYS * DAY_MS && deps.signer.maySign() && deps.signer.pending() === null;
  }

  function ageDays(): number | null {
    const age = ageMs();
    return age === null ? null : Math.floor(age / DAY_MS);
  }

  let shown = '';
  function changed(): void {
    const next = JSON.stringify([due(), ageDays()]);
    if (next === shown) return;
    const first = shown === '';
    shown = next;
    if (first) return;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        log(`a listener failed: ${(error as Error).message}`);
      }
    }
  }

  const within = (last: string | null, at: number): boolean => last !== null && Math.abs(at - Date.parse(last)) < timing.ASK_GAP_MS;

  /** Writes `field` = now unless it is within ASK_GAP_MS, in one store update: what it wrote and what it replaced, or null. */
  function claim(field: 'lastAsked' | 'lastNotified'): Promise<{ at: string; was: string | null } | null> {
    const at = now();
    return deps.store.update((file: SigningFile) => {
      const was = file[field];
      if (within(was, at)) return { next: file, value: null };
      file[field] = new Date(at).toISOString();
      return { next: file, value: { at: file[field]!, was } };
    });
  }

  /** The day given back: `lastAsked` as it was, unless something wrote it since. */
  function unclaim(claimed: { at: string; was: string | null }): Promise<void> {
    return deps.store.update((file: SigningFile) => {
      if (file.lastAsked === claimed.at) file.lastAsked = claimed.was;
      return { next: file, value: undefined };
    });
  }

  /** The signer's gate, right before Touch ID: a window still in front, and `lastAsked` written while it is. */
  async function gate(): Promise<boolean> {
    if (closed || !deps.focused() || !deps.signer.maySign()) return false;
    const claimed = await claim('lastAsked');
    if (claimed === null) return false;
    // Touch ID follows synchronously, so nothing can take the focus between this check and the prompt.
    if (!closed && deps.focused() && deps.signer.maySign()) return true;
    await unclaim(claimed);
    return false;
  }

  async function ask(): Promise<void> {
    changed();
    if (closed || asking || !due()) return;
    const file = deps.store.get();
    if (file === 'damaged' || within(file.lastAsked, now())) return;
    asking = true;
    try {
      let prompted = false;
      const outcome = await deps.signer.sign(noChangeEdit(), { beforePrompt: async () => (prompted = await gate()) });
      if (outcome.ok) log(`the weekly successor signed: version ${outcome.version}`);
      else log(prompted ? `the weekly successor was not signed (${outcome.reason}); asked again tomorrow` : `the weekly successor was not asked (${('detail' in outcome ? outcome.detail : undefined) ?? outcome.reason}); asked at the next focus`);
    } catch (error) {
      log(`asking failed: ${(error as Error).message}`);
    } finally {
      asking = false;
      changed();
    }
  }

  async function check(): Promise<void> {
    changed();
    if (closed || !due() || deps.focused()) return;
    try {
      if ((await claim('lastNotified')) === null) return;
      deps.notify(`The org state is ${ageDays()} days old. MAWS will ask for Touch ID when you next open it.`);
    } catch (error) {
      log(`the notification failed: ${(error as Error).message}`);
    }
  }

  changed();
  const offFocus = deps.onFocus(() => void ask());
  const offSigner = deps.signer.onChanged(changed);
  const timer = setInterval(() => void check(), timing.WEEKLY_CHECK_MS);
  timer.unref?.();

  return {
    due,
    ageDays,
    resign: () => deps.signer.sign(noChangeEdit()),
    onChanged(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    close() {
      closed = true;
      clearInterval(timer);
      offFocus();
      offSigner();
      listeners.clear();
    },
  };
}
