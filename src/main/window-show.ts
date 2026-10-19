import type { BrowserWindow } from 'electron';

type ShownWindow = Pick<BrowserWindow, 'show' | 'showInactive' | 'setOpacity' | 'setIgnoreMouseEvents'>;

// How an app window first appears. Debt wave 5: an end-to-end launch shows its window without making it key. A run
// opens one window per test, and a window that activated took the keystrokes and clicks of whoever was using the
// desktop meanwhile, which landed in the c7 group's editors as characters no test typed. Playwright drives the page over
// CDP with its focus emulated, so no test needs the window key; one that needs native focus asks for it (`win.focus()`).
export function showAppWindow(win: ShownWindow, env: NodeJS.ProcessEnv): void {
  if (env.MAWS_E2E !== '1') return win.show();
  // Foreground e2e (gate-offload §3.6): for a Mac nobody uses, such as the gate's macOS runner, the window is shown as an
  // owner's launch shows it, opaque, the app activated and the window key, so a case meets the OS state a person's MAWS
  // has rather than an app left behind whatever else is frontmost. It overrides quiet (the gate sets MAWS_E2E_QUIET for
  // every e2e job). No gate job sets it: an e2e group opts in through its package script (the bare `e2e` that
  // e2e:default runs, e2e:widgets, e2e:to-human and e2e:document-app), and every other group runs quiet (gate-offload
  // Decision Log 76).
  if (env.MAWS_E2E_FOREGROUND === '1') return win.show();
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
