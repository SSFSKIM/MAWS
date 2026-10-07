// The pick's one recipient (E4d execution document, Design §8; Decision Log 14): `browser.comment.picked` goes to the
// window whose pane owns the tab, never to every window, since each window's E3 sheet would otherwise open and one
// comment would become two threads. The payload passes the X2 registry's schema as `emit`'s would.
import { eventChannel } from '@shared/ipc/schema';
import type { BrowserCommentPicked } from '@shared/ipc/schema/browser';
import { validateEventPayload } from '@shared/ipc/validate';

// The owner's `BrowserWindow` as this reads it (`entry.placement?.window`).
export interface PickOwner {
  isDestroyed(): boolean;
  webContents: { isDestroyed(): boolean; send(channel: string, payload: unknown): void };
}

export function ownerAlive(owner: PickOwner | null): owner is PickOwner {
  return owner !== null && !owner.isDestroyed() && !owner.webContents.isDestroyed();
}

// False, and nothing sent, when there is no owner window alive or the payload is refused; the caller drops the pick.
export function sendPicked(owner: PickOwner | null, payload: BrowserCommentPicked): boolean {
  if (!ownerAlive(owner)) return false;
  const checked = validateEventPayload('browser.comment.picked', payload);
  if (!checked.ok) {
    console.error('[ipc] refused to send an invalid browser.comment.picked', checked.issues);
    return false;
  }
  owner.webContents.send(eventChannel('browser.comment.picked'), checked.value);
  return true;
}
