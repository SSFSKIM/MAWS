// `layout.captureChords` (C11 execution document, M5 fix wave item 1): on macOS the application menu takes its key
// equivalents (⌘W, ⌘K, ⌘1–9 …) before the page sees them, so while the Settings tab records a chord it asks main to
// set the window's menu shortcuts aside, and to restore them when the recording ends. A page that reloads or navigates
// away mid-recording cannot say so, so a main-frame document navigation restores them too.
import type { WebContents } from 'electron';

const watching = new WeakSet<WebContents>();

export function captureChords({ active }: { active: boolean }, { sender }: { sender: WebContents }): void {
  sender.setIgnoreMenuShortcuts(active);
  if (!active || watching.has(sender)) return;
  watching.add(sender);
  const restore = (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
    if (!details.isMainFrame || details.isSameDocument) return;
    sender.off('did-start-navigation', restore);
    watching.delete(sender);
    sender.setIgnoreMenuShortcuts(false);
  };
  sender.on('did-start-navigation', restore);
}
