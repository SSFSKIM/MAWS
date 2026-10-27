// `layout.captureChords` (C11 execution document, M5 fix wave item 1): on macOS the application menu takes its key
// equivalents (⌘W, ⌘K, ⌘1–9 …) before the page sees them, so while the Settings tab records a chord it asks main to
// set the window's menu shortcuts aside, and to restore them when the recording ends. A page that ends mid-recording
// (it reloads, navigates away or crashes) cannot say so, so the end of its client restores them too.
import type { ClientId, HandlerContext } from '@shared/ipc/client';
import { pageOf } from '../ipc/clients';

const watching = new Set<ClientId>();

export function captureChords({ active }: { active: boolean }, { client }: HandlerContext): void {
  const page = pageOf(client);
  if (!page) return;
  page.setIgnoreMenuShortcuts(active);
  if (!active || watching.has(client.id)) return;
  watching.add(client.id);
  client.onGone(() => {
    watching.delete(client.id);
    if (!page.isDestroyed()) page.setIgnoreMenuShortcuts(false);
  });
}
