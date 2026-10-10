// The pick's one recipient (E4d execution document, Design §8; Decision Log 14): `browser.comment.picked` goes to the
// window whose pane owns the tab, never to every window, since each window's E3 sheet would otherwise open and one
// comment would become two threads. The payload passes the X2 registry's schema as `emit`'s would.
//
// P2-E2: the pick also hands the window's own page the native focus. The click that picked left it in the tab's page,
// and the comment card opens beside the page with no cover (whose hiding of the view used to move the focus), so the
// card's field would otherwise look focused while the typing went to the page.
import { eventChannel } from '@shared/ipc/schema';
import type { BrowserCommentPicked } from '@shared/ipc/schema/browser';
import { validateEventPayload } from '@shared/ipc/validate';

// The owner's `BrowserWindow` as this reads it (`entry.placement?.window`).
export interface PickOwner {
  isDestroyed(): boolean;
  webContents: { isDestroyed(): boolean; send(channel: string, payload: unknown): void; focus(): void };
}

export function ownerAlive(owner: PickOwner | null): owner is PickOwner {
  return owner !== null && !owner.isDestroyed() && !owner.webContents.isDestroyed();
}

// The payload as the X2 registry admits it, or null (logged without the payload: page strings stay out of the log).
export function pickedPayload(payload: BrowserCommentPicked): BrowserCommentPicked | null {
  const checked = validateEventPayload('browser.comment.picked', payload);
  if (checked.ok) return checked.value;
  console.error('[ipc] refused to send an invalid browser.comment.picked', checked.issues.map(({ path, code }) => ({ path, code })));
  return null;
}

// False, and nothing sent, when there is no owner window alive or the payload is refused; the caller drops the pick.
export function sendPicked(owner: PickOwner | null, payload: BrowserCommentPicked): boolean {
  if (!ownerAlive(owner)) return false;
  const checked = pickedPayload(payload);
  if (checked === null) return false;
  owner.webContents.send(eventChannel('browser.comment.picked'), checked);
  owner.webContents.focus(); // P2-E2
  return true;
}
