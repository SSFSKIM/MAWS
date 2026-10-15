// Whether a showing of a design system may end (X32's closeGuard; asked by a tab close, the panel's Back and a
// re-target alike, L's registry rule). Every edit writes through to the tab's replica, but the replica is durable only
// once the host acknowledges it: closing the handle drops what the host has not yet acknowledged. So a showing with no
// unacknowledged edits ends at once; one whose replica is live waits briefly for the acknowledgement; otherwise
// (offline, reconnecting, or not acknowledged in time) the owner chooses between keeping the tab open until the edits
// save and discarding them. Never silently dropped. It reads only the tab's handle (X32's lifetime rule).
import type { DocumentHandle, DocumentState } from '@artifacts/host';
import { confirm } from '../../sessions/dialogs';
import { DESIGN_SYSTEM_COPY as C } from './copy';

/** How long a live replica's edits are waited for before the owner is asked. */
export const SAVE_WAIT_MS = 2_000;

/** Resolves true once the replica holds no unacknowledged edit, false if it leaves `live` first or the wait ends. */
function acknowledged(handle: DocumentHandle, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let off: (() => void) | null = null;
    const settle = (saved: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      off?.();
      resolve(saved);
    };
    const timer = setTimeout(() => settle(false), ms);
    const check = (state: DocumentState) => {
      if (state.unsaved === 0) settle(true);
      else if (state.phase !== 'live') settle(false);
    };
    off = handle.subscribe(check);
    if (settled) off();
  });
}

/** The closeGuard of a system's showing: true to let it end. */
export async function allowSystemClose(handle: DocumentHandle, name: string, waitMs = SAVE_WAIT_MS): Promise<boolean> {
  const state = handle.state();
  if (state.unsaved === 0) return true;
  if (state.phase === 'live' && (await acknowledged(handle, waitMs))) return true;
  if (handle.state().unsaved === 0) return true;
  return confirm({ title: C.unsavedTitle(name), body: C.unsavedBody, confirmLabel: C.discardChanges, destructive: true });
}
