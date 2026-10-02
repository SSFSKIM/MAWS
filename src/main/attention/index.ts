// Wires main's notifier to the app's windows (C5): focus is read from the windows themselves when an item arrives (no
// window, or none focused, is unfocused), and a click brings the window forward, re-creating it through the same path
// the dock's `activate` uses when none is open. The navigation goes through the relay (`navigation.ts`), which emits it
// to a page that is listening or keeps it for `attention.pendingNavigate`; any page load or window close makes the page
// un-announced again.
import { app, BrowserWindow } from 'electron';
import type { AttentionId } from '@shared/graph/ids';
import type { Settings } from '@shared/ipc/schema';
import { emit } from '../ipc/events';
import { registerMainHandler } from '../ipc/router';
import type { SessionReadModel } from '../sessions/read-model';
import { createNavigationRelay } from './navigation';
import { startNotifier } from './notifier';

export function startAttention(model: SessionReadModel, deps: { restoredIds: ReadonlySet<AttentionId>; settings(): Settings; openWindow(): BrowserWindow }): () => void {
  const relay = createNavigationRelay(emit);
  registerMainHandler('attention.pendingNavigate', () => ({ navigate: relay.take() }));
  const watch = (win: BrowserWindow) => {
    win.webContents.on('did-start-loading', relay.pageGone);
    win.on('closed', relay.pageGone);
  };
  BrowserWindow.getAllWindows().forEach(watch);
  app.on('browser-window-created', (_event, win) => watch(win));

  const isFocused = () => BrowserWindow.getAllWindows().some((win) => win.isFocused());
  const focusWindow = () => {
    const win = BrowserWindow.getAllWindows()[0] ?? deps.openWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };
  // Listen immediately, including during store retries; only restored arrivals are silent.
  return startNotifier(model, { restoredIds: deps.restoredIds, isFocused, focusWindow, navigate: relay.deliver, settings: deps.settings, emit });
}
