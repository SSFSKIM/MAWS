// Wires main's notifier to the app's windows (C5): focus is read from the windows themselves when an item arrives (no
// window, or none focused, is unfocused), and a click brings the window forward, re-creating it through the same path
// the dock's `activate` uses when none is open, then waits for its page before the renderer is told to navigate.
import { BrowserWindow } from 'electron';
import type { Settings } from '@shared/ipc/schema';
import { emit } from '../ipc/events';
import type { SessionReadModel } from '../sessions/read-model';
import { startNotifier } from './notifier';

export function startAttention(model: SessionReadModel, deps: { settings(): Settings; openWindow(): BrowserWindow }): () => void {
  const isFocused = () => BrowserWindow.getAllWindows().some((win) => win.isFocused());
  const focusWindow = async () => {
    const win = BrowserWindow.getAllWindows()[0] ?? deps.openWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    const page = win.webContents;
    if (!page.isLoading()) return;
    await new Promise<void>((resolve) => {
      const done = () => {
        page.off('did-finish-load', done);
        page.off('did-fail-load', done);
        resolve();
      };
      page.on('did-finish-load', done);
      page.on('did-fail-load', done);
    });
  };
  return startNotifier(model, { isFocused, focusWindow, settings: deps.settings, emit });
}
