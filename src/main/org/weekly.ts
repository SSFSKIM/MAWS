// The weekly successor's asking (P5 O8 M3, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M3's "The weekly
// successor"; Interfaces §K; the owner's Q6). Every endpoint stops remote actions on a head issued more than 30 days
// ago (RL §5.2's backstop), so a root re-signs the org state, unchanged, every week; once the app is a root, it does
// so here and the deployment admin's `refresh` can stop.
//
// - Due: this device may sign (a root, its keys marked, signing.json readable: the signer's `maySign`), no state is
//   pending, and the held head was issued at least WEEKLY_DUE_DAYS ago.
// - Asking: at a window's focus while due, if `lastAsked` is not within ASK_GAP_MS, `lastAsked` is written first and
//   the signer then signs the no-change successor, Touch ID asking. A cancel ends it for the day; the Org section's
//   quiet line (`due`, `ageDays`) stays, with "Re-sign now" (`resign`), which signs at once.
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

  /** Writes `field` = now unless it is within ASK_GAP_MS, in one store update; whether it was written. */
  function claim(field: 'lastAsked' | 'lastNotified'): Promise<boolean> {
    const at = now();
    return deps.store.update((file: SigningFile) => {
      const last = file[field];
      if (last !== null && Math.abs(at - Date.parse(last)) < timing.ASK_GAP_MS) return { next: file, value: false };
      file[field] = new Date(at).toISOString();
      return { next: file, value: true };
    });
  }

  async function ask(): Promise<void> {
    changed();
    if (closed || asking || !due()) return;
    asking = true;
    try {
      if (!(await claim('lastAsked'))) return;
      const outcome = await deps.signer.sign(noChangeEdit());
      log(outcome.ok ? `the weekly successor signed: version ${outcome.version}` : `the weekly successor was not signed (${outcome.reason}); asked again tomorrow`);
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
      if (!(await claim('lastNotified'))) return;
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
