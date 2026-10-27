// What the connectors' window veto reads of a client (P3-H H4; P5 O1 M3), over the Electron window that shows its page:
// whether it shows the page now, whether it has closed, and each show, hide, minimize and restore. On macOS those events
// follow the window's occlusion, not the calls, so the veto also re-reads a hidden window (src/main/connectors/index.ts).
import type { BrowserWindow } from 'electron';
import type { ClientWindowShown } from '../connectors';

const EVENTS = ['show', 'hide', 'minimize', 'restore'] as const;

export function electronWindowShown(win: Pick<BrowserWindow, 'isDestroyed' | 'isVisible' | 'isMinimized' | 'on' | 'removeListener'>): ClientWindowShown {
  return {
    shown: () => !win.isDestroyed() && win.isVisible() && !win.isMinimized(),
    closed: () => win.isDestroyed(),
    onChange(listener) {
      for (const name of EVENTS) win.on(name as 'show', listener);
      return () => {
        for (const name of EVENTS) win.removeListener(name as 'show', listener);
      };
    },
  };
}
