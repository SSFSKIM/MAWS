// When an agent's navigation or load has settled (E4c execution document, Design §6 `browser_navigate` and "Loads";
// A-31): read from the view's own events and E4a's tab state, never from Playwright, so a tool that never connected a
// driver (browser_tabs open, browser_navigate) waits the same way the chrome's address field does.
//
// Resolves at once on a main-frame `did-navigate-in-page` (a fragment or pushState moves no loading state), and after a
// main-frame `did-navigate` as soon as the view stops loading (checked at the commit and on each `did-stop-loading`). A
// load that stops with neither a commit nor a failure (a 204, Stop) settles too, after a short grace in which a download
// refusal for it still wins; an earlier load error E4a restores then is not reported as this navigation's. Rejects
// with the refusal the host writes: `navigationFailed` on E4a's `loadError`, `tabCrashed` on its `crashed`,
// `downloadRefused` on the tab's `browser.download.refused` (a download aborts the
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

// After an act's dispatch or an eval (Design §6 "Downloads"; A-31): a page call can start a main-frame navigation that
// commits a new document or turns into a download, and either arrives after the call returned (a `location = …` eval
// returns in about 3 ms, its download ~160 ms later). Watched from just before the call: when a cross-document
// navigation started (or starts within `startWindowMs` after the call), `settle` waits for its load to end, or for a
// stop without a commit plus the grace in which a download refusal still wins, or for the refusal itself, all within
// `graceMs`; with none started it resolves at once. It never fails but on an abort: the caller reads the refusal.
export const CALL_NAVIGATION_GRACE_MS = 2_000;
export const EVAL_NAVIGATION_START_MS = 250;

export interface CallNavigation {
  settle(refused: Promise<void>, options?: { startWindowMs?: number; graceMs?: number }): Promise<void>;
  stop(): void;
}

export function watchCallNavigation(entry: TabEntry, signal: AbortSignal): CallNavigation {
  const wc = entry.view?.webContents as (NodeJS.EventEmitter & { isLoading(): boolean }) | undefined;
  let started = false;
  let committed = false;
  let stopped = false;
  let changed = () => {};
  const listeners: [string, (...args: unknown[]) => void][] = [
    ['did-start-navigation', (event) => {
      const details = event as { isMainFrame?: boolean; isSameDocument?: boolean } | undefined;
      if (!details?.isMainFrame || details.isSameDocument) return;
      started = true;
      committed = stopped = false;
      changed();
    }],
    ['did-navigate', () => {
      committed = true;
      changed();
    }],
    ['did-stop-loading', () => {
      if (!started || wc!.isLoading()) return;
      stopped = true;
      changed();
    }],
  ];
  for (const [event, listener] of listeners) wc?.on(event, listener);
  const stop = () => {
    for (const [event, listener] of listeners) wc?.removeListener(event, listener);
  };
  return {
    stop,
    settle: (refused, { startWindowMs = 0, graceMs = CALL_NAVIGATION_GRACE_MS } = {}) =>
      new Promise<void>((resolve, reject) => {
        if (signal.aborted) return reject(signal.reason);
        const timers: ReturnType<typeof setTimeout>[] = [];
        let stopGrace = false;
        const finish = (settle: () => void) => {
          for (const timer of timers.splice(0)) clearTimeout(timer);
          changed = () => {};
          signal.removeEventListener('abort', onAbort);
          settle();
        };
        const done = () => finish(resolve);
        const onAbort = () => finish(() => reject(signal.reason));
        signal.addEventListener('abort', onAbort, { once: true });
        void refused.then(done);
        changed = () => {
          if (!started || !stopped) return;
          if (committed) return done();
          if (!stopGrace) {
            stopGrace = true;
            timers.push(setTimeout(done, STOPPED_WITHOUT_COMMIT_GRACE_MS));
          }
        };
        if (!started && startWindowMs <= 0) return done(); // nothing started during the call
        timers.push(setTimeout(done, graceMs));
        if (!started) timers.push(setTimeout(() => !started && done(), startWindowMs));
        changed();
      }),
  };
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
    // What the navigation command cleared (E4a's `pending`): a load that stops with neither a commit nor a failure gets
    // it back (`loadStopped`), and an earlier failure restored so is not this navigation's (it settles as a stop does).
    const restorable = entry.pending?.loadError ?? null;
    cleanups.push(
      deps.store.onUpdated((updated) => {
        if (updated !== entry) return;
        const { loadError, crashed } = entry.tab;
        if (crashed) fail(BROWSER_TOOL_ERRORS.tabCrashed(tool, tabId));
        else if (loadError && loadError !== restorable) fail(BROWSER_TOOL_ERRORS.navigationFailed(tool, loadError.url, loadError.kind, loadError.description || loadError.code));
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
