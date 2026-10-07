// A page's `window.open` and new-window links (E4a execution document, Design §14, Interfaces "`window.open`"; Decision
// Log 11 and 24). Electron ships no popup blocker and `HandlerDetails` carries no gesture flag, so an open is honoured
// only when the page saw attributed input (the human's or the agent's) within the last 5 s and fewer than three opens
// were honoured in that window; anything else is denied and counted in the chrome (`blockedPopups`). An honoured open
// with `linkTarget: 'external'` goes to the system browser; with `in-app` it is adopted: Chromium's child webContents
// becomes a new tab of the opener's session (selected unless it is a background tab, ⌘-click), so `window.opener` works
// (OAuth sign-in popups post back to it), with MAWS's own webPreferences on the child rather than any the page asked for.
// `about:blank` is admitted here alone, for the open-then-write pattern; a `mailto:` open goes out like a `mailto:` link
// (Decision Log 27). `linkTarget` is read at the moment of the open.
import type { WebContents, WebPreferences, WindowOpenHandlerResponse } from 'electron';
import { validateBrowserUrl } from '@shared/browser/url';
import type { BrowserSeam } from './seam';
import type { TabEntry, TabStore } from './tabs';

export const WINDOW_OPEN_INPUT_MS = 5000;
export const WINDOW_OPEN_BURST = 3; // honoured opens per WINDOW_OPEN_INPUT_MS

export type LinkTarget = 'in-app' | 'external';

export type WindowOpenDecision = { action: 'adopt'; select: boolean } | { action: 'external' } | { action: 'deny'; blocked: true };

export interface WindowOpenRequest {
  url: string;
  disposition: string; // HandlerDetails' `default`, `foreground-tab`, `background-tab`, `new-window` or `other`
  now: number;
  lastInputAt: number | null; // the page's last attributed input (entry.input)
  recentOpens: readonly number[]; // when the opens honoured so far happened
  linkTarget: LinkTarget;
  hasRoom: boolean; // the loaded-tab cap can take one more (TabStore.hasRoomForView)
}

const BLOCKED: WindowOpenDecision = { action: 'deny', blocked: true };

export function decideWindowOpen({ url, disposition, now, lastInputAt, recentOpens, linkTarget, hasRoom }: WindowOpenRequest): WindowOpenDecision {
  if (lastInputAt === null || now - lastInputAt > WINDOW_OPEN_INPUT_MS) return BLOCKED;
  if (recentOpens.filter((at) => now - at < WINDOW_OPEN_INPUT_MS).length >= WINDOW_OPEN_BURST) return BLOCKED;
  if (/^mailto:/i.test(url)) return { action: 'external' };
  const web = validateBrowserUrl(url).ok;
  if (!web && url !== 'about:blank') return BLOCKED;
  if (disposition === 'other') return BLOCKED;
  if (web && linkTarget === 'external') return { action: 'external' };
  if (!hasRoom) return BLOCKED;
  return { action: 'adopt', select: disposition !== 'background-tab' };
}

export interface WindowOpenDeps {
  store: Pick<TabStore, 'entry' | 'update' | 'adoptChild' | 'hasRoomForView'>;
  linkTarget(): LinkTarget;
  seam: Pick<BrowserSeam, 'line' | 'openExternal'>;
  childPreferences: WebPreferences; // view.ts `tabWebPreferences`, applied to the child over whatever the page asked
  now?(): number;
}

export function attachWindowOpen(entry: TabEntry, { store, linkTarget, seam, childPreferences, now = Date.now }: WindowOpenDeps): void {
  // `createWindow`'s answer must be Chromium's child itself. A child that could not become a tab (its view could not be
  // made or wired) is handed back and closed on the next tick, once Electron has taken it back, so it never lingers as
  // an invisible page. Electron gives no child only where it creates none; then nothing is adopted and the answer is
  // unused.
  const adoptChild = (opener: TabEntry, url: string, select: boolean, child: WebContents | undefined): WebContents => {
    if (!child) {
      console.warn('[browser] window.open gave no child webContents; nothing adopted');
      return child as unknown as WebContents;
    }
    let adopted: WebContents | undefined;
    try {
      adopted = store.adoptChild(opener, { url, select, webContents: child }).view?.webContents;
    } catch (error) {
      console.error('[browser] a window.open child could not be adopted:', error);
    }
    if (adopted !== child) setImmediate(() => !child.isDestroyed() && child.close());
    return child;
  };

  const view = entry.view!;
  const { tabId } = entry.tab;
  let opens: number[] = [];
  view.webContents.setWindowOpenHandler(({ url, disposition }): WindowOpenHandlerResponse => {
    if (store.entry(tabId) !== entry || entry.view !== view) return { action: 'deny' };
    const at = now();
    opens = opens.filter((when) => at - when < WINDOW_OPEN_INPUT_MS);
    const decision = decideWindowOpen({ url, disposition, now: at, lastInputAt: entry.input.lastInputAt, recentOpens: opens, linkTarget: linkTarget(), hasRoom: store.hasRoomForView() });
    switch (decision.action) {
      case 'deny':
        store.update(tabId, { blockedPopups: entry.tab.blockedPopups + 1 });
        seam.line(`browser-blocked-popup ${url}`);
        return { action: 'deny' };
      case 'external':
        opens.push(at);
        seam.openExternal(url);
        return { action: 'deny' };
      case 'adopt':
        opens.push(at);
        return {
          action: 'allow',
          outlivesOpener: true,
          overrideBrowserWindowOptions: { webPreferences: childPreferences },
          // Chromium's child is in the options; the view must adopt that very webContents (Electron checks)
          createWindow: (options) => adoptChild(entry, url, decision.select, (options as { webContents?: WebContents }).webContents),
        };
    }
  });
}
