import { EventEmitter } from 'node:events';
import type { WebContentsView } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { DEFAULT_PARTITION } from '@shared/browser/tab';
import { BROWSER_TOOL_ERRORS, type BrowserToolName } from '@shared/maws/browser';
import { TOOL_ERRORS } from '@shared/maws/tools';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { Navigator } from '../navigation';
import { TabStore, type TabEntry } from '../tabs';
import { BrowserHandlers, type AgentControl, type BrowserCall, type DownloadRefusal } from './handlers';

// browser_tabs and browser_navigate (E4c Design §6, §11; Decision Log 5, 6, 15, 22, 29) over E4a's real TabStore and
// Navigator, the Navigator wired to each view as `startBrowser` wires it, so a fake webContents' Electron events become
// the tab's state exactly as in the app. Control is a recording fake (Task 2.4's state machine is not under test here).

const A = 'App-A' as AppSessionId;
const B = 'App-B' as AppSessionId;
const THREAD = 'App-Thread' as AppSessionId;

class FakeWebContents extends EventEmitter {
  url = '';
  back = false;
  forward = false;
  loading = false;
  readonly navigationHistory = {
    canGoBack: () => this.back,
    canGoForward: () => this.forward,
    goBack: vi.fn(),
    goForward: vi.fn(),
    getActiveIndex: () => 0,
    getEntryAtIndex: () => ({ url: this.url, title: '' }),
  };
  readonly loadURL = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve());
  readonly reload = vi.fn();
  readonly close = vi.fn();
  readonly isDestroyed = () => false;
  readonly isLoading = () => this.loading;
  readonly getZoomFactor = () => 1;
}

function harness() {
  const emitted: { name: EventName; payload: unknown }[] = [];
  const emit = <N extends EventName>(name: N, payload: EventPayload<N>) => void emitted.push({ name, payload });
  let ids = 0;
  let clock = 1_000_000;
  const store = new TabStore({
    emit,
    createView: () => ({ webContents: new FakeWebContents() }) as unknown as WebContentsView,
    resolvePartition: () => DEFAULT_PARTITION,
    newTabId: () => `b_${(++ids).toString().padStart(12, '0')}`,
    schedule: () => {},
    now: () => clock,
  });
  const navigator = new Navigator({
    store,
    history: { visit: () => {}, setTitle: () => {} },
    favicons: { resolve: () => Promise.resolve(null) },
    emit,
    seam: { line: () => {}, openExternal: () => {} },
    now: () => clock,
  });
  store.onViewCreated((entry) => navigator.attach(entry));
  // what control saw, with the tab's control at each call: markActing must come before any network event
  const calls: string[] = [];
  const control: AgentControl & { pauseResult: { waitedFor: 'human' | null; waitedMs: number | null } } = {
    pauseResult: { waitedFor: null, waitedMs: null },
    pause: vi.fn(async (entry: TabEntry) => {
      calls.push(`pause ${entry.tab.tabId}`);
      return control.pauseResult;
    }),
    markActing: vi.fn((entry: TabEntry) => {
      calls.push(`acting ${entry.tab.tabId}`);
      store.setControl(entry.tab.tabId, 'agent');
    }),
    actionEnded: vi.fn((entry: TabEntry) => void calls.push(`ended ${entry.tab.tabId}`)),
    requestPending: vi.fn(),
  };
  const refusals = new Set<(refusal: DownloadRefusal) => void>();
  const handlers = new BrowserHandlers({
    store,
    navigator,
    control,
    reachable: (appSessionId) => (appSessionId === THREAD ? [THREAD, A] : [appSessionId]),
    onDownloadRefused: (listener) => {
      refusals.add(listener);
      return () => void refusals.delete(listener);
    },
    emit,
    now: () => clock,
  });
  const controller = new AbortController();
  let requests = 0;
  const run = (appSessionId: AppSessionId, tool: BrowserToolName, args: Record<string, unknown>, signal = controller.signal, startedAt = clock) =>
    handlers.run({ appSessionId, requestId: `r${++requests}`, toolUseId: null, tool, args } as BrowserCall, { signal, startedAt, waiting: vi.fn() });
  const open = (appSessionId: AppSessionId, url: string | null = 'https://a.test/') => store.open({ appSessionId, url, select: true }).tab.tabId;
  const entry = (tabId: string) => store.entry(tabId)!;
  const wc = (tabId: string) => entry(tabId).view!.webContents as unknown as FakeWebContents;
  // Chromium committing a main-frame document, then (unless told otherwise) finishing the load
  const commit = (tabId: string, url: string, { stop = true, title = '' } = {}) => {
    const contents = wc(tabId);
    contents.url = url;
    contents.loading = true;
    contents.emit('did-start-loading');
    contents.emit('did-navigate', {}, url, 200, 'OK');
    if (title) contents.emit('page-title-updated', {}, title, true);
    if (stop) {
      contents.loading = false;
      contents.emit('did-stop-loading');
    }
  };
  const refuseDownload = (refusal: DownloadRefusal) => {
    for (const listener of [...refusals]) listener(refusal);
  };
  const acting = () => emitted.filter((e) => e.name === 'browser.agent.acting').map((e) => e.payload);
  return { store, navigator, control, calls, handlers, controller, run, open, entry, wc, commit, refuseDownload, refusals, acting, tick: (ms: number) => void (clock += ms) };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  vi.useRealTimers();
});

describe('browser_tabs list (P-21, P-24)', () => {
  it("lists the session's tabs, loaded or not, with who controls each, and never another session's", async () => {
    const h = harness();
    const one = h.open(A, 'https://a.test/');
    h.commit(one, 'https://a.test/', { title: 'Page A' });
    const two = h.open(A, null);
    h.open(B, 'https://b.test/');
    const answer = await h.run(A, 'browser_tabs', { action: 'list' }, undefined, 1_000_000 - 12.6); // main's ms, an integer
    expect(answer).toEqual({
      ok: true,
      result: {
        status: 'ok', action: 'list', tabId: null, url: null, title: null, ms: 13,
        tabs: [
          { tabId: one, url: 'https://a.test/', title: 'Page A', selected: false, loaded: true, control: 'idle', owner: 'self' },
          { tabId: two, url: '', title: '', selected: true, loaded: false, control: 'idle', owner: 'self' },
        ],
      },
    });
    expect(h.control.markActing).not.toHaveBeenCalled();
    expect(h.acting()).toEqual([]);
  });

  it("lists a side thread's own tabs and its parent's, marked; the parent never sees the thread's", async () => {
    const h = harness();
    const parent = h.open(A);
    const own = h.open(THREAD);
    const thread = await h.run(THREAD, 'browser_tabs', { action: 'list' });
    expect(thread?.ok && (thread.result.tabs as { tabId: string; owner: string }[]).map(({ tabId, owner }) => [tabId, owner])).toEqual([
      [own, 'self'],
      [parent, 'parent'],
    ]);
    const fromParent = await h.run(A, 'browser_tabs', { action: 'list' });
    expect(fromParent?.ok && (fromParent.result.tabs as { tabId: string }[]).map(({ tabId }) => tabId)).toEqual([parent]);
  });
});

describe('browser_tabs open (a load: Design §6 "Loads", A-31)', () => {
  it('opens and selects a tab in the calling session, marks it the agent\'s before any network event, and answers once it loaded', async () => {
    const h = harness();
    const answer = h.run(A, 'browser_tabs', { action: 'open', url: 'https://example.com/' });
    const tabId = h.store.list(A).tabs[0].tabId;
    expect(h.entry(tabId).tab.control).toBe('agent'); // the same tick as the open: E4a's will-download refuses for the agent
    expect(h.calls).toEqual([`acting ${tabId}`]); // a load's pause point is vacuous
    expect(h.acting()).toEqual([{ appSessionId: A, tabId }]);
    h.commit(tabId, 'https://example.com/', { title: 'Example Domain' });
    expect(await answer).toEqual({
      ok: true,
      result: {
        status: 'ok', action: 'open', tabId, url: 'https://example.com/', title: 'Example Domain', ms: 0,
        tabs: [{ tabId, url: 'https://example.com/', title: 'Example Domain', selected: true, loaded: true, control: 'agent', owner: 'self' }],
      },
    });
    expect(h.calls.at(-1)).toBe(`ended ${tabId}`);
  });

  it('opens a side thread\'s tab in the thread\'s own session', async () => {
    const h = harness();
    const answer = h.run(THREAD, 'browser_tabs', { action: 'open', url: 'https://example.com/' });
    const tabId = h.store.list(THREAD).tabs[0].tabId;
    h.commit(tabId, 'https://example.com/');
    expect((await answer)?.ok).toBe(true);
    expect(h.store.list(A).tabs).toEqual([]);
  });

  it('leaves the selection on a tab the person is using (Decision Log 6)', async () => {
    const h = harness();
    const held = h.open(A);
    h.entry(held).input.lastHumanAt = 1_000_000 - 1_000; // they clicked a second ago
    const answer = h.run(A, 'browser_tabs', { action: 'open', url: 'https://example.com/' });
    const tabId = h.store.list(A).tabs[1].tabId;
    h.commit(tabId, 'https://example.com/');
    const result = (await answer)!;
    expect(result.ok && result.result.tabs).toMatchObject([{ tabId: held, selected: true }, { tabId, selected: false }]);
  });

  it('refuses a URL that is not http(s) in main as well (Design §12)', async () => {
    const h = harness();
    expect(await h.run(A, 'browser_tabs', { action: 'open', url: 'file:///etc/passwd' })).toEqual({ ok: false, error: TOOL_ERRORS.navigationRefused('file:///etc/passwd', 'browser_tabs') });
    expect(h.store.list(A).tabs).toEqual([]);
  });

  it('answers a load that fails with its kind and description', async () => {
    const h = harness();
    const answer = h.run(A, 'browser_tabs', { action: 'open', url: 'https://nowhere.test/' });
    const tabId = h.store.list(A).tabs[0].tabId;
    h.wc(tabId).emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://nowhere.test/', true, 1, 1);
    expect(await answer).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.navigationFailed('browser_tabs', 'https://nowhere.test/', 'dns', 'ERR_NAME_NOT_RESOLVED') });
    expect(h.calls.at(-1)).toBe(`ended ${tabId}`);
  });

  it('turns a refused download into the error (A-31)', async () => {
    const h = harness();
    const answer = h.run(A, 'browser_tabs', { action: 'open', url: 'https://files.test/report.pdf' });
    const tabId = h.store.list(A).tabs[0].tabId;
    h.refuseDownload({ tabId: 'b_999999999999', url: 'https://elsewhere.test/x.zip', filename: 'x.zip' }); // another tab's
    h.refuseDownload({ tabId, url: 'https://files.test/report.pdf', filename: 'report.pdf' });
    expect(await answer).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.downloadRefused('browser_tabs', 'https://files.test/report.pdf', 'report.pdf') });
    expect(h.refusals.size).toBe(0);
  });
});

describe('browser_tabs close and select', () => {
  it("closes the session's tab, and answers tabNotFound for another session's", async () => {
    const h = harness();
    const mine = h.open(A);
    const theirs = h.open(B);
    expect(await h.run(A, 'browser_tabs', { action: 'close', tabId: theirs })).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.tabNotFound('browser_tabs', theirs) });
    expect(h.store.entry(theirs)).toBeDefined();
    const answer = await h.run(A, 'browser_tabs', { action: 'close', tabId: mine });
    expect(answer).toMatchObject({ ok: true, result: { action: 'close', tabId: mine, url: 'https://a.test/', tabs: [] } });
    expect(h.store.entry(mine)).toBeUndefined();
    expect(h.control.pause).not.toHaveBeenCalled();
  });

  it('waits at the pause point before closing a tab the person holds', async () => {
    const h = harness();
    const held = h.open(A);
    h.store.setControl(held, 'human');
    await h.run(A, 'browser_tabs', { action: 'close', tabId: held });
    expect(h.calls).toEqual([`pause ${held}`]);
    expect(h.store.entry(held)).toBeUndefined();
  });

  it("lets a side thread close its parent's tab", async () => {
    const h = harness();
    const parent = h.open(A);
    expect((await h.run(THREAD, 'browser_tabs', { action: 'close', tabId: parent }))?.ok).toBe(true);
  });

  it('selects a loaded tab without loading it', async () => {
    const h = harness();
    const first = h.open(A, 'https://a.test/');
    h.open(A, 'https://b.test/');
    const answer = await h.run(A, 'browser_tabs', { action: 'select', tabId: first });
    expect(answer).toMatchObject({ ok: true, result: { action: 'select', tabId: first } });
    expect(h.store.list(A).selected[A]).toBe(first);
    expect(h.acting()).toEqual([{ appSessionId: A, tabId: first }]);
    expect(h.control.markActing).not.toHaveBeenCalled();
  });

  it('resumes a suspended tab on select, as a load, and answers once it loaded (Decision Log 15)', async () => {
    const h = harness();
    const tabId = h.open(A, 'https://a.test/page');
    h.store.suspend(tabId);
    const answer = h.run(A, 'browser_tabs', { action: 'select', tabId });
    expect(h.entry(tabId).view).not.toBeNull();
    expect(h.wc(tabId).loadURL).toHaveBeenCalledWith('https://a.test/page');
    expect(h.entry(tabId).tab.control).toBe('agent');
    h.commit(tabId, 'https://a.test/page');
    expect(await answer).toMatchObject({ ok: true, result: { action: 'select', tabId, tabs: [{ tabId, loaded: true, selected: true }] } });
  });

  it('does not move the selection off a tab the person is using', async () => {
    const h = harness();
    const other = h.open(A, 'https://a.test/');
    const held = h.open(A, 'https://b.test/');
    h.store.setControl(held, 'human');
    const answer = await h.run(A, 'browser_tabs', { action: 'select', tabId: other });
    expect(answer?.ok && answer.result.tabs).toMatchObject([{ tabId: other, selected: false }, { tabId: held, selected: true }]);
  });
});

describe('browser_navigate (Design §6)', () => {
  it('navigates through E4a\'s Navigator after the pause point and answers once the page settled', async () => {
    const h = harness();
    const tabId = h.open(A, 'https://a.test/');
    h.commit(tabId, 'https://a.test/');
    h.control.pauseResult = { waitedFor: 'human', waitedMs: 1500 };
    const answer = h.run(A, 'browser_navigate', { tabId, url: 'https://example.com/' });
    await flush();
    expect(h.calls).toEqual([`pause ${tabId}`, `acting ${tabId}`]);
    expect(h.wc(tabId).loadURL).toHaveBeenLastCalledWith('https://example.com/');
    expect(h.acting()).toEqual([{ appSessionId: A, tabId }]);
    h.commit(tabId, 'https://example.com/', { stop: false, title: 'Example Domain' });
    await flush();
    let settled = false;
    void answer.then(() => (settled = true));
    await flush();
    expect(settled).toBe(false); // committed, still loading
    h.wc(tabId).loading = false;
    h.wc(tabId).emit('did-stop-loading');
    expect(await answer).toEqual({ ok: true, result: { status: 'ok', tabId, url: 'https://example.com/', title: 'Example Domain', ms: 0, waitedFor: 'human', waitedMs: 1500 } });
    expect(h.calls.at(-1)).toBe(`ended ${tabId}`);
  });

  it('settles at once on a same-document navigation', async () => {
    const h = harness();
    const tabId = h.open(A, 'https://a.test/');
    h.commit(tabId, 'https://a.test/');
    const answer = h.run(A, 'browser_navigate', { tabId, url: 'https://a.test/#part' });
    await flush();
    h.wc(tabId).emit('did-navigate-in-page', {}, 'https://a.test/#frame-only', false);
    h.wc(tabId).emit('did-navigate-in-page', {}, 'https://a.test/#part', true);
    expect(await answer).toMatchObject({ ok: true, result: { url: 'https://a.test/#part' } });
  });

  it('answers navigationFailed, tabCrashed, downloadRefused and tabClosed from the wait', async () => {
    const h = harness();
    const [failed, crashed, download, closed] = ['https://a.test/1', 'https://a.test/2', 'https://a.test/3', 'https://a.test/4'].map((url) => {
      const tabId = h.open(A, url);
      h.commit(tabId, url);
      return tabId;
    });
    const answers = [failed, crashed, download, closed].map((tabId) => h.run(A, 'browser_navigate', { tabId, url: 'https://next.test/' }));
    await flush();
    h.wc(failed).emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'https://next.test/', true, 1, 1);
    h.wc(crashed).emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    h.refuseDownload({ tabId: download, url: 'https://next.test/', filename: 'next.bin' });
    h.store.close(closed);
    expect(await Promise.all(answers)).toEqual([
      { ok: false, error: BROWSER_TOOL_ERRORS.navigationFailed('browser_navigate', 'https://next.test/', 'refused', 'ERR_CONNECTION_REFUSED') },
      { ok: false, error: BROWSER_TOOL_ERRORS.tabCrashed('browser_navigate', crashed) },
      { ok: false, error: BROWSER_TOOL_ERRORS.downloadRefused('browser_navigate', 'https://next.test/', 'next.bin') },
      { ok: false, error: BROWSER_TOOL_ERRORS.tabClosed('browser_navigate', closed) },
    ]);
  });

  it('answers nothing when the request is cancelled during the wait', async () => {
    const h = harness();
    const tabId = h.open(A, 'https://a.test/');
    h.commit(tabId, 'https://a.test/');
    const controller = new AbortController();
    const answer = h.run(A, 'browser_navigate', { tabId, url: 'https://next.test/' }, controller.signal);
    await flush();
    controller.abort();
    expect(await answer).toBeNull();
  });

  it('answers nothing when cancelled at the pause point, and navigates nowhere', async () => {
    const h = harness();
    const tabId = h.open(A, 'https://a.test/');
    h.commit(tabId, 'https://a.test/');
    const controller = new AbortController();
    vi.mocked(h.control.pause).mockImplementationOnce(async () => {
      controller.abort();
      throw controller.signal.reason;
    });
    expect(await h.run(A, 'browser_navigate', { tabId, url: 'https://next.test/' }, controller.signal)).toBeNull();
    expect(h.wc(tabId).loadURL).not.toHaveBeenCalledWith('https://next.test/');
    expect(h.control.markActing).not.toHaveBeenCalled();
  });

  it('answers MAWS\'s timeout a little before the host\'s', async () => {
    vi.useFakeTimers();
    const h = harness();
    const tabId = h.open(A, 'https://a.test/');
    h.commit(tabId, 'https://a.test/');
    const answer = h.run(A, 'browser_navigate', { tabId, url: 'https://slow.test/' });
    await vi.advanceTimersByTimeAsync(27_999);
    let settled = false;
    void answer.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await answer).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.browserTimeout('browser_navigate') });
  });

  it('goes back and forward through the history, and says when there is none', async () => {
    const h = harness();
    const tabId = h.open(A, 'https://a.test/');
    h.commit(tabId, 'https://a.test/');
    expect(await h.run(A, 'browser_navigate', { tabId, url: 'back' })).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.actionFailed('browser_navigate', 'back', '', 'no page to go back to') });
    h.wc(tabId).back = true;
    const answer = h.run(A, 'browser_navigate', { tabId, url: 'back' });
    await flush();
    expect(h.wc(tabId).navigationHistory.goBack).toHaveBeenCalled();
    h.commit(tabId, 'https://a.test/before');
    expect(await answer).toMatchObject({ ok: true, result: { url: 'https://a.test/before' } });
  });

  it('reload loads a suspended tab as a load (no pause point); back on it is tabNotLoaded', async () => {
    const h = harness();
    const tabId = h.open(A, 'https://a.test/kept');
    h.store.suspend(tabId);
    expect(await h.run(A, 'browser_navigate', { tabId, url: 'back' })).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.tabNotLoaded('browser_navigate', tabId, 'https://a.test/kept') });
    const answer = h.run(A, 'browser_navigate', { tabId, url: 'reload' });
    expect(h.entry(tabId).tab.control).toBe('agent');
    expect(h.wc(tabId).loadURL).toHaveBeenCalledWith('https://a.test/kept');
    h.commit(tabId, 'https://a.test/kept');
    expect(await answer).toMatchObject({ ok: true, result: { tabId, url: 'https://a.test/kept', waitedFor: null, waitedMs: null } });
    expect(h.control.pause).not.toHaveBeenCalled();
  });

  it("answers tabNotFound for another session's tab and navigationRefused for a URL main refuses", async () => {
    const h = harness();
    const theirs = h.open(B);
    const mine = h.open(A);
    expect(await h.run(A, 'browser_navigate', { tabId: theirs, url: 'https://x.test/' })).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.tabNotFound('browser_navigate', theirs) });
    expect(await h.run(A, 'browser_navigate', { tabId: mine, url: 'javascript:alert(1)' })).toEqual({ ok: false, error: TOOL_ERRORS.navigationRefused('javascript:alert(1)', 'browser_navigate') });
    expect(await h.run(A, 'browser_navigate', { tabId: 'b_00000000dead', url: 'https://x.test/' })).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.tabNotFound('browser_navigate', 'b_00000000dead') });
  });

  it('does not move the selection to the acting tab while the person uses the selected one', async () => {
    const h = harness();
    const acted = h.open(A, 'https://a.test/');
    h.commit(acted, 'https://a.test/');
    const held = h.open(A, 'https://b.test/');
    h.store.setControl(held, 'human');
    const answer = h.run(A, 'browser_navigate', { tabId: acted, url: 'https://c.test/' });
    await flush();
    h.commit(acted, 'https://c.test/');
    await answer;
    expect(h.store.list(A).selected[A]).toBe(held);
    expect(h.acting()).toEqual([{ appSessionId: A, tabId: acted }]);
  });
});

describe('the tools later tasks build', () => {
  it.each([
    ['browser_snapshot', 'snapshot'],
    ['browser_act', 'act'],
    ['browser_eval', 'eval'],
    ['browser_screenshot', 'screenshot'],
  ] as const)('%s answers a plain actionFailed until it is built', async (tool, action) => {
    const h = harness();
    const tabId = h.open(A);
    expect(await h.run(A, tool, { tabId })).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.actionFailed(tool, action, '', 'not available in this build of MAWS') });
  });
});
