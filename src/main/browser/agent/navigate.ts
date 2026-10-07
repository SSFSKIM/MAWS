// When an agent's navigation or load has settled (E4c execution document, Design §6 `browser_navigate` and "Loads";
// A-31): read from the view's own events and E4a's tab state, never from Playwright, so a tool that never connected a
// driver (browser_tabs open, browser_navigate) waits the same way the chrome's address field does.
//
// Resolves at once on a main-frame `did-navigate-in-page` (a fragment or pushState moves no loading state), and after a
// main-frame `did-navigate` as soon as the view stops loading (checked at the commit and on each `did-stop-loading`). A
// load that stops with neither a commit nor a failure (a 204, Stop) settles too, after a short grace in which a download
// refusal for it still wins. Rejects with the refusal the host writes: `navigationFailed` on E4a's `loadError`,
// `tabCrashed` on its `crashed`, `downloadRefused` on the tab's `browser.download.refused` (a download aborts the
// navigation with -3, which E4a ignores), `tabClosed` when the view goes, and main's own timeout just before the host's.
// The signal's abort rejects with its reason (nothing is written).
import { BROWSER_TOOL_ERRORS, type BrowserToolName } from '@shared/maws/browser';
import type { TabEntry, TabStore } from '../tabs';
import { BrowserToolError } from './errors';

export const SETTLE_DEADLINE_MS = 28_000; // main answers before the host's BROWSER_ANSWER_MS
const STOPPED_WITHOUT_COMMIT_GRACE_MS = 250;

export interface DownloadRefusal {
  tabId: string;
  url: string;
  filename: string;
}

export interface SettleDeps {
  store: Pick<TabStore, 'onUpdated' | 'onViewDestroying'>;
  onDownloadRefused(listener: (refusal: DownloadRefusal) => void): () => void;
}

export function waitForSettled(entry: TabEntry, tool: BrowserToolName, signal: AbortSignal, deps: SettleDeps, deadlineMs = SETTLE_DEADLINE_MS): Promise<void> {
  const { tabId } = entry.tab;
  const wc = entry.view?.webContents;
  if (!wc) return Promise.reject(new BrowserToolError(BROWSER_TOOL_ERRORS.tabClosed(tool, tabId)));
  return new Promise<void>((resolve, reject) => {
    let committed = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const cleanups: (() => void)[] = [];
    const finish = (settle: () => void) => {
      for (const cleanup of cleanups.splice(0)) cleanup();
      for (const timer of timers.splice(0)) clearTimeout(timer);
      settle();
    };
    const done = () => finish(resolve);
    const fail = (text: string) => finish(() => reject(new BrowserToolError(text)));
    const emitter = wc as unknown as NodeJS.EventEmitter;
    const listen = <A extends unknown[]>(event: string, listener: (...args: A) => void) => {
      const handler = (...args: unknown[]) => listener(...(args as A));
      emitter.on(event, handler);
      cleanups.push(() => void emitter.removeListener(event, handler));
    };

    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => finish(() => reject(signal.reason));
    signal.addEventListener('abort', onAbort, { once: true });
    cleanups.push(() => signal.removeEventListener('abort', onAbort));

    listen('did-navigate', () => {
      committed = true;
      if (!wc.isLoading()) done();
    });
    listen('did-navigate-in-page', (_event: unknown, _url: unknown, isMainFrame: unknown) => {
      if (isMainFrame) done();
    });
    listen('did-stop-loading', () => {
      if (wc.isLoading()) return;
      if (committed) return done();
      timers.push(setTimeout(done, STOPPED_WITHOUT_COMMIT_GRACE_MS));
    });
    cleanups.push(
      deps.store.onUpdated((updated) => {
        if (updated !== entry) return;
        const { loadError, crashed } = entry.tab;
        if (loadError) fail(BROWSER_TOOL_ERRORS.navigationFailed(tool, loadError.url, loadError.kind, loadError.description || loadError.code));
        else if (crashed) fail(BROWSER_TOOL_ERRORS.tabCrashed(tool, tabId));
      }),
      deps.store.onViewDestroying((destroyed) => {
        if (destroyed === entry) fail(BROWSER_TOOL_ERRORS.tabClosed(tool, tabId));
      }),
      deps.onDownloadRefused((refused) => {
        if (refused.tabId === tabId) fail(BROWSER_TOOL_ERRORS.downloadRefused(tool, refused.url, refused.filename));
      }),
    );
    timers.push(setTimeout(() => fail(BROWSER_TOOL_ERRORS.browserTimeout(tool)), deadlineMs));
  });
}
