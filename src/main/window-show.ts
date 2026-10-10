import type { BrowserWindow } from 'electron';

type ShownWindow = Pick<BrowserWindow, 'show' | 'showInactive' | 'setOpacity' | 'setIgnoreMouseEvents'>;

// How an app window first appears. Debt wave 5: an end-to-end launch shows its window without making it key. A run
// opens one window per test, and a window that activated took the keystrokes and clicks of whoever was using the
// desktop meanwhile, which landed in the c7 group's editors as characters no test typed. Playwright drives the page over
// CDP with its focus emulated, so no test needs the window key; one that needs native focus asks for it (`win.focus()`).
export function showAppWindow(win: ShownWindow, env: NodeJS.ProcessEnv): void {
  if (env.MAWS_E2E !== '1') return win.show();
  // Quiet e2e (owner's ruling 2026-10-06): the window must exist for Chromium to paint, but it need not be seen. It is
  // shown fully transparent and lets clicks pass through, so a run of many launches no longer covers the desktop;
  // Playwright's input and screenshots go over CDP and never touch the window's alpha. Quiet is the default (owner's
  // ruling 2026-10-10, after e2e windows appeared on their display from a run started outside the slot wrapper, the one
  // place that exported the old opt-in); MAWS_E2E_QUIET=0 shows the windows, for watching a run.
  if (env.MAWS_E2E_QUIET !== '0') {
    win.setOpacity(0);
    win.setIgnoreMouseEvents(true);
  }
  win.showInactive();
}
