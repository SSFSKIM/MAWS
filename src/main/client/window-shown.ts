// What the connectors' window veto reads of a client (P3-H H4; P5 O1 M3), over the Electron window that shows its page:
// whether it shows the page now, whether it has closed, and each show, hide, minimize and restore. On macOS those events
// follow the window's occlusion, not the calls, so the veto also re-reads a hidden window. P5 O4 M2
// (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, D8): the app reads it and reports it to the connectors, which
// run with the spine, as `connectors.windowShown`.
import type { BrowserWindow } from 'electron';

// The window that shows a client's page, as the veto reads it: shown now (visible and not minimized), closed, and each
// change the OS announces.
export interface ClientWindowShown {
  shown(): boolean;
  closed(): boolean;
  onChange(listener: () => void): () => void; // returns the unsubscribe
}

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
