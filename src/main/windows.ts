// The app's windows (E2 execution document, Design §7, Decision Log 21). Main also creates windows that are not the
// app's: an `artifact_screenshot` capture renders in a hidden offscreen `BrowserWindow` (`artifacts/capture.ts`).
// Whatever treats "every window" as the app's page (the event emitter, the menu's Select All, the theme's background,
// the attention relay and focus, the dock's `activate`) reads this registry instead of `BrowserWindow.getAllWindows()`,
// so a capture never receives the app's events, takes focus, keeps `activate` from opening the app, or resets the
// attention relay. `createWindow` registers each app window before it loads anything.
import type { BrowserWindow } from 'electron';

const open = new Set<BrowserWindow>();
const ever = new WeakSet<BrowserWindow>(); // membership outlives `closed`, so a listener that runs after it still knows

export function registerAppWindow(win: BrowserWindow): void {
  open.add(win);
  ever.add(win);
  win.once('closed', () => open.delete(win));
}

// The app windows still open, in the order they were created.
export function appWindows(): BrowserWindow[] {
  return [...open].filter((win) => !win.isDestroyed());
}

export function isAppWindow(win: BrowserWindow): boolean {
  return ever.has(win);
}
