// Wires main's notifier to the app's windows (C5): focus is read from the windows themselves when an item arrives (no
// window, or none focused, is unfocused), and a click brings the window forward, re-creating it through the same path
// the dock's `activate` uses when none is open. The navigation goes through the relay (`navigation.ts`), which emits it
// to a page that is listening or keeps it for `attention.pendingNavigate`; any page load or window close makes the page
// un-announced again.
import { app, type App, type BrowserWindow } from 'electron';
import type { AttentionId } from '@shared/graph/ids';
import type { Settings } from '@shared/ipc/schema';
import { emit } from '../ipc/events';
import { registerMainHandler } from '../ipc/router';
import type { SessionReadModel } from '../sessions/read-model';
import { appWindows, isAppWindow } from '../windows'; // E2
import { createNavigationRelay } from './navigation';
import { startNotifier } from './notifier';

export function startAttention(model: SessionReadModel, deps: { restoredIds: ReadonlySet<AttentionId>; settings(): Settings; openWindow(): BrowserWindow }): () => void {
  const relay = createNavigationRelay(emit);
  registerMainHandler('attention.pendingNavigate', () => ({ navigate: relay.take() }));
  followAppPages(app, relay.pageGone);

  const isFocused = () => appWindows().some((win) => win.isFocused()); // E2: app windows only
  const focusWindow = () => {
    const win = appWindows()[0] ?? deps.openWindow(); // E2
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };
  // Listen immediately, including during store retries; only restored arrivals are silent.
  return startNotifier(model, { restoredIds: deps.restoredIds, isFocused, focusWindow, navigate: relay.deliver, settings: deps.settings, emit });
}

// E2 start (E2 execution document, Design §7, Decision Log 21): only an app window's page load or close makes the page
// un-announced. Every window is hooked as it is created, before `createWindow` can register it, so the check is made
// when the event fires: a capture window's load (`deliverables/capture.ts`) leaves a pending navigation deliverable.
export function followAppPages(source: Pick<App, 'on'>, pageGone: () => void): void {
  const watch = (win: BrowserWindow) => {
    win.webContents.on('did-start-loading', () => {
      if (isAppWindow(win)) pageGone();
    });
    win.on('closed', () => {
      if (isAppWindow(win)) pageGone();
    });
  };
  appWindows().forEach(watch);
  source.on('browser-window-created', (_event, win) => watch(win));
}
// E2 end
