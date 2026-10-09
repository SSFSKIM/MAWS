import { EventEmitter } from 'node:events';
import type { WebContentsView } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { DEFAULT_PARTITION } from '@shared/browser/tab';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { Navigator, ZOOM_PRESETS, stepZoom } from './navigation';
import { TabStore, type TabEntry } from './tabs';
import { WINDOW_OPEN_BURST, WINDOW_OPEN_INPUT_MS } from './window-open';

const A = 'App-A' as AppSessionId;

// A webContents as the navigation wiring uses it: Electron's events on an emitter, its commands recorded.
class FakeWebContents extends EventEmitter {
  url = '';
  zoom = 1;
  back = false;
  forward = false;
  entryTitle = '';
  readonly navigationHistory = {
    canGoBack: () => this.back,
    canGoForward: () => this.forward,
    goBack: vi.fn(),
    goForward: vi.fn(),
    getActiveIndex: () => 0,
    getEntryAtIndex: () => ({ url: this.url, title: this.entryTitle }),
  };
  readonly loadURL = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve());
  readonly reload = vi.fn();
  readonly stop = vi.fn();
  readonly close = vi.fn();
  destroyed = false;
  readonly isDestroyed = () => this.destroyed;
  loading = false;
  readonly isLoading = () => this.loading;
  readonly getZoomFactor = () => this.zoom;
  readonly setZoomFactor = vi.fn((factor: number) => void (this.zoom = factor));
  readonly findInPage = vi.fn(() => 1);
  readonly stopFindInPage = vi.fn();
  readonly openDevTools = vi.fn();
  readonly forcefullyCrashRenderer = vi.fn();
}

// A cancellable Electron event.
const cancellable = <T extends object>(fields: T) => ({ ...fields, preventDefault: vi.fn() });

function harness(options: { historyThrows?: boolean } = {}) {
  const emitted: { name: EventName; payload: unknown }[] = [];
  const emit = <N extends EventName>(name: N, payload: EventPayload<N>) => void emitted.push({ name, payload });
  const contents: FakeWebContents[] = [];
  let ids = 0;
  let clock = 1_000_000;
  const store = new TabStore({
    emit,
    createView: () => {
      const webContents = new FakeWebContents();
      contents.push(webContents);
      return { webContents } as unknown as WebContentsView;
    },
    resolvePartition: () => DEFAULT_PARTITION,
    newTabId: () => `b_${(++ids).toString(16).padStart(12, '0')}`,
    schedule: () => {},
  });
  const fail = () => {
    throw new Error('index unavailable: busy');
  };
  const write = options.historyThrows ? fail : () => {};
  const history = {
    visit: vi.fn<(partition: string, url: string, visit: { typed: boolean; at: number }) => void>(write),
    setTitle: vi.fn<(partition: string, url: string, title: string) => void>(write),
  };
  const icons: ((icon: string | null) => void)[] = []; // each favicon lookup's resolver, in call order
  const favicons = { resolve: vi.fn(() => new Promise<string | null>((resolve) => void icons.push(resolve))) };
  const seam = { line: vi.fn(), openExternal: vi.fn() };
  const navigator = new Navigator({ store, history, favicons, emit, seam, now: () => clock });
  store.onViewCreated((entry) => navigator.attach(entry));
  const open = (url: string | null = 'https://a.test/') => store.open({ appSessionId: A, url, select: true }).tab.tabId;
  const wc = (tabId: string) => store.entry(tabId)!.view!.webContents as unknown as FakeWebContents;
  const tab = (tabId: string) => store.entry(tabId)!.tab;
  const entry = (tabId: string) => store.entry(tabId) as TabEntry;
  const notices = () => emitted.filter((e) => e.name === 'browser.notice').map((e) => e.payload);
  return { store, navigator, history, favicons, seam, emitted, notices, open, wc, tab, entry, contents, icons, tick: (ms: number) => void (clock += ms) };
}

// Chromium's main-frame commit of `url`.
const commit = (wc: FakeWebContents, url: string, { back = false, forward = false } = {}) => {
  wc.url = url;
  wc.back = back;
  wc.forward = forward;
  wc.emit('did-navigate', {}, url, 200, 'OK');
};
const fail = (wc: FakeWebContents, url: string, code: number, description: string, isMainFrame = true) => wc.emit('did-fail-load', {}, code, description, url, isMainFrame, 1, 1);

describe('navigation: the view\'s own events into the tab (E4a Design §5, §7)', () => {
  it('loading follows did-start-loading and did-stop-loading; a commit sets the URL, history flags, zoom and the entry\'s title', () => {
    const h = harness();
    const id = h.open();
    const wc = h.wc(id);
    wc.emit('did-start-loading');
    expect(h.tab(id).loading).toBe(true);
    wc.entryTitle = 'Back here';
    wc.zoom = 1.2499999;
    commit(wc, 'https://a.test/x', { back: true });
    expect(h.tab(id)).toMatchObject({ url: 'https://a.test/x', canGoBack: true, canGoForward: false, title: 'Back here', zoom: 1.25 });
    expect(h.entry(id).committed).toBe(true);
    wc.back = false;
    wc.emit('did-stop-loading');
    expect(h.tab(id)).toMatchObject({ loading: false, canGoBack: false });
  });

  it('a new document starts untitled until its title arrives; an entry titled with its own URL reads as untitled', () => {
    const h = harness();
    const id = h.open();
    const wc = h.wc(id);
    wc.emit('page-title-updated', {}, 'Old', true);
    wc.entryTitle = 'https://a.test/';
    commit(wc, 'https://a.test/');
    expect(h.tab(id).title).toBe('');
    wc.emit('page-title-updated', {}, 'Page A', true);
    expect(h.tab(id).title).toBe('Page A');
    expect(h.history.setTitle).toHaveBeenLastCalledWith(DEFAULT_PARTITION, 'https://a.test/', 'Page A');
  });

  // Electron 44.4.5 titles an untitled entry with its URL as Chromium's url_formatter shows it, not the URL itself (the
  // e2e's untitled page read "127.0.0.1:<port>/plain.html"): no "http://", no trailing slash on a bare host, unescaped.
  it('an entry titled with its URL as Chromium formats it reads as untitled; a real title that merely looks like a host stays', () => {
    const h = harness();
    const id = h.open();
    const wc = h.wc(id);
    for (const [url, formatted] of [
      ['http://127.0.0.1:62317/plain.html', '127.0.0.1:62317/plain.html'],
      ['http://a.test/', 'a.test'],
      ['https://a.test/', 'https://a.test'],
      ['https://a.test/caf%C3%A9?q=1#x', 'https://a.test/café?q=1#x'],
    ] as const) {
      wc.emit('page-title-updated', {}, 'Old', true);
      wc.entryTitle = formatted;
      commit(wc, url);
      expect(h.tab(id).title, url).toBe('');
    }
    wc.entryTitle = 'b.test';
    commit(wc, 'http://a.test/');
    expect(h.tab(id).title).toBe('b.test');
  });

  it('in-page navigations of the main frame move the URL and count as visits; a subframe\'s do nothing', () => {
    const h = harness();
    const id = h.open();
    const wc = h.wc(id);
    commit(wc, 'https://a.test/');
    wc.back = true;
    wc.emit('did-navigate-in-page', {}, 'https://a.test/#two', true, 1, 1);
    expect(h.tab(id)).toMatchObject({ url: 'https://a.test/#two', canGoBack: true });
    wc.emit('did-navigate-in-page', {}, 'https://frame.test/#x', false, 1, 2);
    expect(h.tab(id).url).toBe('https://a.test/#two');
    expect(h.history.visit.mock.calls.map(([, url]) => url)).toEqual(['https://a.test/', 'https://a.test/#two']);
  });

  it('a commit clears the denied permissions and the blocked pop-ups of the previous document', () => {
    const h = harness();
    const id = h.open();
    h.store.update(id, { denied: [{ host: 'a.test', permission: 'notifications' }], blockedPopups: 3 });
    commit(h.wc(id), 'https://a.test/b');
    expect(h.tab(id)).toMatchObject({ denied: [], blockedPopups: 0 });
  });

  it('render-process-gone sets the crash, unresponsive and responsive the flag, zoom-changed steps the zoom', () => {
    const h = harness();
    const id = h.open();
    const wc = h.wc(id);
    commit(wc, 'https://a.test/');
    wc.emit('unresponsive');
    expect(h.tab(id).unresponsive).toBe(true);
    wc.emit('responsive');
    expect(h.tab(id).unresponsive).toBe(false);
    wc.emit('zoom-changed', {}, 'in');
    expect(wc.setZoomFactor).toHaveBeenLastCalledWith(1.1);
    expect(h.tab(id).zoom).toBe(1.1);
    wc.emit('render-process-gone', {}, { reason: 'oom', exitCode: 1 });
    expect(h.tab(id)).toMatchObject({ crashed: { reason: 'oom' }, loading: false });
    expect(h.entry(id).committed).toBe(false);
  });

  it('found-in-page records the result, keeping a field Chromium reports as unchanged (-1)', () => {
    const h = harness();
    const id = h.open();
    const wc = h.wc(id);
    wc.emit('found-in-page', {}, { requestId: 1, activeMatchOrdinal: 1, matches: 3, finalUpdate: true });
    expect(h.tab(id).find).toEqual({ active: 1, matches: 3 });
    wc.emit('found-in-page', {}, { requestId: 2, activeMatchOrdinal: 2, matches: -1, finalUpdate: false });
    expect(h.tab(id).find).toEqual({ active: 2, matches: 3 });
  });

  it('events from a view the tab no longer has change nothing (a suspended or closed tab\'s late events)', () => {
    const h = harness();
    const id = h.open();
    const wc = h.wc(id);
    h.store.suspend(id);
    wc.emit('did-start-loading');
    wc.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 });
    expect(h.tab(id)).toMatchObject({ loading: false, crashed: null });
    h.store.close(id);
    expect(() => commit(wc, 'https://a.test/late')).not.toThrow();
  });

  it('a favicon is resolved on the tab\'s partition and applied unless a newer list superseded it', async () => {
    const h = harness();
    const id = h.open();
    const wc = h.wc(id);
    wc.emit('page-favicon-updated', {}, ['https://a.test/old.ico']);
    wc.emit('page-favicon-updated', {}, ['https://a.test/new.ico']);
    expect(h.favicons.resolve).toHaveBeenLastCalledWith(DEFAULT_PARTITION, ['https://a.test/new.ico']);
    h.icons[1]!('data:image/png;base64,TkVX');
    await Promise.resolve();
    expect(h.tab(id).favicon).toBe('data:image/png;base64,TkVX');
    h.icons[0]!('data:image/png;base64,T0xE'); // the superseded lookup answers late: nothing applied
    await Promise.resolve();
    expect(h.tab(id).favicon).toBe('data:image/png;base64,TkVX');
    wc.emit('page-favicon-updated', {}, ['https://a.test/none.ico']);
    h.icons[2]!(null); // no candidate was an image
    await Promise.resolve();
    expect(h.tab(id).favicon).toBeNull();
  });

  it('history: http(s) commits only; a typed navigation counts as typed once; a failing index drops the visit', () => {
    const h = harness();
    const id = h.open();
    const wc = h.wc(id);
    expect(h.navigator.navigate(id, { url: 'https://typed.test/', typed: true })).toBe(true);
    commit(wc, 'https://www.typed.test/'); // after a redirect: still the typed navigation
    commit(wc, 'https://www.typed.test/next');
    wc.emit('did-navigate', {}, 'about:blank', 200, 'OK');
    expect(h.history.visit.mock.calls).toEqual([
      [DEFAULT_PARTITION, 'https://www.typed.test/', { typed: true, at: 1_000_000 }],
      [DEFAULT_PARTITION, 'https://www.typed.test/next', { typed: false, at: 1_000_000 }],
    ]);
    expect(h.tab(id).url).toBe(''); // about:blank is the empty document, never a URL to offer back

    const broken = harness({ historyThrows: true });
    const other = broken.open();
    vi.spyOn(console, 'warn').mockImplementationOnce(() => {});
    expect(() => commit(broken.wc(other), 'https://a.test/')).not.toThrow();
    expect(broken.tab(other).url).toBe('https://a.test/');
  });

  it('a typed navigation that fails is not counted as typed by the next commit', () => {
    const h = harness();
    const id = h.open();
    const wc = h.wc(id);
    h.navigator.navigate(id, { url: 'http://127.0.0.1:1/', typed: true });
    fail(wc, 'http://127.0.0.1:1/', -102, 'ERR_CONNECTION_REFUSED');
    commit(wc, 'https://a.test/');
    expect(h.history.visit).toHaveBeenLastCalledWith(DEFAULT_PARTITION, 'https://a.test/', { typed: false, at: 1_000_000 });
  });
});

describe('navigation: the load-error lifecycle (E4a Design §5, Decision Log 23)', () => {
  it('start → fail → back → navigate: the error set with the failed URL and the re-read flags, cleared by Back\'s commit', () => {
    const h = harness();
    const id = h.open('https://a.test/');
    const wc = h.wc(id);
    commit(wc, 'https://a.test/');
    h.navigator.navigate(id, { url: 'http://127.0.0.1:1/' });
    wc.back = true;
    fail(wc, 'http://127.0.0.1:1/', -102, 'ERR_CONNECTION_REFUSED');
    expect(h.tab(id)).toMatchObject({
      url: 'http://127.0.0.1:1/',
      loading: false,
      canGoBack: true,
      loadError: { url: 'http://127.0.0.1:1/', host: '127.0.0.1', kind: 'refused', code: -102, description: 'ERR_CONNECTION_REFUSED' },
    });
    expect(h.entry(id).committed).toBe(false);
    expect(h.navigator.navigate(id, 'back')).toBe(true);
    expect(wc.navigationHistory.goBack).toHaveBeenCalled();
    expect(h.tab(id)).toMatchObject({ loadError: null, loading: true });
    expect(h.entry(id).committed).toBe(false); // hidden until Back's page commits
    commit(wc, 'https://a.test/', { forward: true });
    expect(h.entry(id).committed).toBe(true);
    expect(h.tab(id)).toMatchObject({ url: 'https://a.test/', loadError: null, canGoForward: true });
    expect(h.navigator.navigate(id, { url: 'https://b.test/' })).toBe(true);
    commit(wc, 'https://b.test/');
    expect(h.tab(id).url).toBe('https://b.test/');
  });

  it('commit → fail: a late main-frame failure after content is an error like any other', () => {
    const h = harness();
    const id = h.open('https://a.test/');
    const wc = h.wc(id);
    commit(wc, 'https://a.test/');
    fail(wc, 'https://a.test/', -324, 'ERR_EMPTY_RESPONSE');
    expect(h.tab(id).loadError).toMatchObject({ kind: 'generic', code: -324 });
    expect(h.entry(id).committed).toBe(false);
  });

  it('fail → fail: a second refused host replaces the first', () => {
    const h = harness();
    const id = h.open('http://127.0.0.1:1/');
    const wc = h.wc(id);
    fail(wc, 'http://127.0.0.1:1/', -102, 'ERR_CONNECTION_REFUSED');
    h.navigator.navigate(id, { url: 'http://127.0.0.2:1/' });
    fail(wc, 'http://127.0.0.2:1/', -102, 'ERR_CONNECTION_REFUSED');
    expect(h.tab(id).loadError).toMatchObject({ url: 'http://127.0.0.2:1/', host: '127.0.0.2' });
  });

  it('-3 and a subframe\'s failure are never errors', () => {
    const h = harness();
    const id = h.open('https://a.test/');
    const wc = h.wc(id);
    commit(wc, 'https://a.test/');
    fail(wc, 'https://a.test/slow', -3, 'ERR_ABORTED');
    fail(wc, 'https://ads.test/', -105, 'ERR_NAME_NOT_RESOLVED', false);
    expect(h.tab(id).loadError).toBeNull();
    expect(h.entry(id).committed).toBe(true);
  });

  it('Reload after a failure loads the failed URL again (the committed entry is Chromium\'s error page); after a crash, the tab\'s URL', () => {
    const h = harness();
    const id = h.open('http://127.0.0.1:1/');
    const wc = h.wc(id);
    fail(wc, 'http://127.0.0.1:1/', -102, 'ERR_CONNECTION_REFUSED');
    wc.loadURL.mockClear();
    expect(h.navigator.navigate(id, 'reload')).toBe(true);
    expect(wc.loadURL).toHaveBeenCalledWith('http://127.0.0.1:1/');
    expect(wc.reload).not.toHaveBeenCalled();
    expect(h.tab(id).loadError).toBeNull();

    commit(wc, 'https://a.test/');
    wc.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 11 });
    wc.loadURL.mockClear();
    expect(h.navigator.navigate(id, 'reload')).toBe(true);
    expect(wc.loadURL).toHaveBeenCalledWith('https://a.test/');
    expect(h.tab(id).crashed).toBeNull();

    commit(wc, 'https://a.test/');
    expect(h.navigator.navigate(id, 'reload')).toBe(true);
    expect(wc.reload).toHaveBeenCalledTimes(1);
    expect(h.tab(id).loading).toBe(true);
  });
});

describe('navigation: a navigation that never lands (Stop, Esc, a download, an abort)', () => {
  it('navigate → stop → did-stop-loading: the address returns to the committed page', () => {
    const h = harness();
    const id = h.open('https://a.test/');
    const wc = h.wc(id);
    commit(wc, 'https://a.test/');
    h.navigator.navigate(id, { url: 'https://slow.test/' });
    expect(h.tab(id).url).toBe('https://slow.test/');
    h.navigator.navigate(id, 'stop');
    fail(wc, 'https://slow.test/', -3, 'ERR_ABORTED');
    wc.emit('did-stop-loading');
    expect(h.tab(id)).toMatchObject({ url: 'https://a.test/', loading: false, loadError: null });
    expect(h.entry(id).committed).toBe(true);
    // Reload now reloads the page shown, and the next commit is not counted as the cancelled typed navigation
    expect(h.navigator.navigate(id, 'reload')).toBe(true);
    expect(wc.reload).toHaveBeenCalled();
  });

  it('a typed URL that became a download (-3 then did-stop-loading) leaves the page and is no typed visit', () => {
    const h = harness();
    const id = h.open('https://a.test/');
    const wc = h.wc(id);
    commit(wc, 'https://a.test/');
    h.navigator.navigate(id, { url: 'https://a.test/file.bin', typed: true });
    fail(wc, 'https://a.test/file.bin', -3, 'ERR_ABORTED');
    wc.emit('did-stop-loading');
    expect(h.tab(id).url).toBe('https://a.test/');
    commit(wc, 'https://a.test/next');
    expect(h.history.visit).toHaveBeenLastCalledWith(DEFAULT_PARTITION, 'https://a.test/next', { typed: false, at: 1_000_000 });
  });

  it('error → navigate → stop: the error page comes back with its URL', () => {
    const h = harness();
    const id = h.open('http://127.0.0.1:1/');
    const wc = h.wc(id);
    fail(wc, 'http://127.0.0.1:1/', -102, 'ERR_CONNECTION_REFUSED');
    const error = h.tab(id).loadError;
    h.navigator.navigate(id, { url: 'https://slow.test/' });
    expect(h.tab(id).loadError).toBeNull();
    h.navigator.navigate(id, 'stop');
    wc.emit('did-stop-loading');
    expect(h.tab(id)).toMatchObject({ url: 'http://127.0.0.1:1/', loadError: error, loading: false });
    expect(h.entry(id).committed).toBe(false);
  });

  it('crash → reload → stop: the crash page comes back; a second command keeps the first\'s stash', () => {
    const h = harness();
    const id = h.open('https://a.test/');
    const wc = h.wc(id);
    commit(wc, 'https://a.test/');
    wc.emit('render-process-gone', {}, { reason: 'oom', exitCode: 1 });
    h.navigator.navigate(id, 'reload');
    h.navigator.navigate(id, { url: 'https://b.test/' });
    wc.emit('did-stop-loading');
    expect(h.tab(id)).toMatchObject({ url: 'https://a.test/', crashed: { reason: 'oom' } });
  });

  it('a stop after a commit or a failure restores nothing; a crash mid-navigation stands', () => {
    const h = harness();
    const id = h.open('https://a.test/');
    const wc = h.wc(id);
    commit(wc, 'https://a.test/');
    h.navigator.navigate(id, { url: 'http://127.0.0.1:1/' });
    fail(wc, 'http://127.0.0.1:1/', -102, 'ERR_CONNECTION_REFUSED');
    wc.emit('did-stop-loading');
    expect(h.tab(id)).toMatchObject({ url: 'http://127.0.0.1:1/', loadError: { kind: 'refused' } });

    h.navigator.navigate(id, { url: 'https://b.test/' });
    wc.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 11 });
    wc.emit('did-stop-loading');
    expect(h.tab(id).crashed).toEqual({ reason: 'crashed' });
    expect(h.tab(id).loadError).toBeNull();
  });

  it('a title that arrives while a navigation is pending names the committed page\'s row, not the target\'s', () => {
    const h = harness();
    const id = h.open('https://a.test/');
    const wc = h.wc(id);
    commit(wc, 'https://a.test/');
    h.navigator.navigate(id, { url: 'https://b.test/' });
    wc.emit('page-title-updated', {}, 'Page A', true);
    expect(h.history.setTitle).toHaveBeenLastCalledWith(DEFAULT_PARTITION, 'https://a.test/', 'Page A');
  });

  it('a title raised for the error page after a failed load relabels no history row', () => {
    const h = harness();
    const id = h.open('https://a.test/');
    const wc = h.wc(id);
    commit(wc, 'https://a.test/');
    wc.emit('page-title-updated', {}, 'Page A', true);
    h.navigator.navigate(id, { url: 'https://b.test/' });
    fail(wc, 'https://b.test/', -105, 'ERR_NAME_NOT_RESOLVED');
    wc.emit('page-title-updated', {}, 'b.test', true); // Chromium's error document titles itself
    expect(h.history.setTitle.mock.calls).toEqual([[DEFAULT_PARTITION, 'https://a.test/', 'Page A']]);
  });

  it('a same-document move reads loading from the view; a typed fragment counts as typed, a page\'s pushState does not', () => {
    const h = harness();
    const id = h.open('https://a.test/');
    const wc = h.wc(id);
    commit(wc, 'https://a.test/');
    wc.emit('did-start-loading');
    wc.loading = false; // Back within the document: no did-stop-loading follows
    wc.emit('did-navigate-in-page', {}, 'https://a.test/#one', true, 1, 1);
    expect(h.tab(id).loading).toBe(false);

    h.navigator.navigate(id, { url: 'https://b.test/', typed: true });
    wc.emit('did-navigate-in-page', {}, 'https://a.test/#pushed', true, 1, 1); // the old page's own pushState
    expect(h.history.visit).toHaveBeenLastCalledWith(DEFAULT_PARTITION, 'https://a.test/#pushed', { typed: false, at: 1_000_000 });
    commit(wc, 'https://b.test/');
    expect(h.history.visit).toHaveBeenLastCalledWith(DEFAULT_PARTITION, 'https://b.test/', { typed: true, at: 1_000_000 });

    h.navigator.navigate(id, { url: 'https://b.test/#two', typed: true });
    wc.emit('did-navigate-in-page', {}, 'https://b.test/#two', true, 1, 1);
    expect(h.history.visit).toHaveBeenLastCalledWith(DEFAULT_PARTITION, 'https://b.test/#two', { typed: true, at: 1_000_000 });
  });
});

describe('navigation: commands (browser.tabs.navigate, zoom, find, dismiss, devtools)', () => {
  it('Back and Forward only when the history allows; Stop stops; a suspended tab reloads its URL', () => {
    const h = harness();
    const id = h.open();
    const wc = h.wc(id);
    expect(h.navigator.navigate(id, 'back')).toBe(false);
    expect(h.navigator.navigate(id, 'forward')).toBe(false);
    wc.forward = true;
    expect(h.navigator.navigate(id, 'forward')).toBe(true);
    expect(wc.navigationHistory.goForward).toHaveBeenCalled();
    expect(h.navigator.navigate(id, 'stop')).toBe(true);
    expect(wc.stop).toHaveBeenCalled();

    h.store.suspend(id);
    expect(h.navigator.navigate(id, 'back')).toBe(false);
    expect(h.navigator.navigate(id, 'stop')).toBe(false);
    expect(h.navigator.navigate(id, 'reload')).toBe(true);
    expect(h.wc(id).loadURL).toHaveBeenCalledWith('https://a.test/');
  });

  // cua board #98: the person's Reload from the chrome on a tab an agent leased was told to the transcript as the agent's
  it('every command is the person\'s: it stamps the tab\'s input seam as their input, never as an activation', () => {
    const h = harness();
    const id = h.open();
    const { input } = h.entry(id);
    const heard: unknown[] = [];
    input.on((emission) => heard.push(emission));
    h.tick(5);
    expect(h.navigator.navigate(id, 'reload')).toBe(true);
    expect(heard).toEqual([{ kind: 'chrome', source: 'human', at: 1_000_005, activation: false }]);
    expect(input).toMatchObject({ lastHumanAt: 1_000_005, lastHumanActivationAt: null, lastActivationAt: null });
    h.tick(5);
    h.navigator.navigate(id, { url: 'https://b.test/', typed: true });
    h.navigator.navigate(id, 'back');
    expect(heard).toHaveLength(3);
    expect(input.lastHumanAt).toBe(1_000_010);
  });

  it('an empty tab has nothing to reload; an address loads it', () => {
    const h = harness();
    const id = h.open(null);
    expect(h.navigator.navigate(id, 'reload')).toBe(false);
    expect(h.navigator.navigate(id, { url: 'https://a.test/' })).toBe(true);
    expect(h.wc(id).loadURL).toHaveBeenCalledWith('https://a.test/');
  });

  it('Stop on an unresponsive page kills its renderer and reloads, and the kill is not shown as a crash', () => {
    const h = harness();
    const id = h.open();
    const wc = h.wc(id);
    commit(wc, 'https://a.test/');
    wc.emit('unresponsive');
    expect(h.navigator.navigate(id, 'stop')).toBe(true);
    expect(wc.forcefullyCrashRenderer).toHaveBeenCalled();
    expect(wc.reload).toHaveBeenCalled();
    expect(wc.stop).not.toHaveBeenCalled();
    wc.emit('render-process-gone', {}, { reason: 'killed', exitCode: 9 });
    expect(h.tab(id)).toMatchObject({ crashed: null, unresponsive: false, loading: true });
    wc.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 11 }); // a later crash is one
    expect(h.tab(id).crashed).toEqual({ reason: 'crashed' });
  });

  it('zoom steps through Chrome\'s presets, resets to 1, and re-reads the partition\'s other tabs (one host zoom map)', () => {
    expect(stepZoom(1, 'in')).toBe(1.1);
    expect(stepZoom(1, 'out')).toBe(0.9);
    expect(stepZoom(3, 'in')).toBe(3);
    expect(stepZoom(0.5, 'out')).toBe(0.5);
    expect(stepZoom(1.2, 'in')).toBe(1.25);
    expect(stepZoom(0.666, 'in')).toBe(0.75);
    expect(stepZoom(2.5, 'reset')).toBe(1);
    expect(ZOOM_PRESETS[0]).toBe(0.5);

    const h = harness();
    const id = h.open('https://a.test/');
    const other = h.open('https://a.test/other');
    expect(h.navigator.zoom(id, 'in')).toBe(1.1);
    h.wc(other).zoom = 1.1; // Chromium applied the host's level to the other tab
    expect(h.navigator.zoom(id, 'in')).toBe(1.25);
    expect(h.tab(other).zoom).toBe(1.1);
    expect(h.navigator.zoom(id, 'reset')).toBe(1);
    h.store.suspend(id);
    expect(h.navigator.zoom(id, 'in')).toBe(1); // no page to zoom: the tab's own value
  });

  it('find: a keystroke starts a session, Enter continues it, null stops and clears; the find bar\'s state follows', () => {
    const h = harness();
    const id = h.open();
    const wc = h.wc(id);
    h.navigator.find(id, { text: 'needle', forward: true, findNext: false, matchCase: false });
    expect(wc.findInPage).toHaveBeenLastCalledWith('needle', { forward: true, findNext: true, matchCase: false });
    expect(h.entry(id).findOpen).toBe(true);
    h.navigator.find(id, { text: 'needle', forward: false, findNext: true, matchCase: true });
    expect(wc.findInPage).toHaveBeenLastCalledWith('needle', { forward: false, findNext: false, matchCase: true });
    h.store.update(id, { find: { active: 1, matches: 3 } });
    h.navigator.find(id, { text: '' });
    expect(wc.stopFindInPage).toHaveBeenLastCalledWith('clearSelection');
    expect(h.tab(id).find).toBeNull();
    expect(h.entry(id).findOpen).toBe(true); // the bar is open with nothing typed
    h.navigator.find(id, { text: null });
    expect(h.entry(id).findOpen).toBe(false);
    expect(wc.findInPage).toHaveBeenCalledTimes(2);
  });

  it('dismiss clears each notice\'s state; a download in progress keeps its line', () => {
    const h = harness();
    const id = h.open();
    h.store.update(id, {
      denied: [{ host: 'a.test', permission: 'geolocation' }],
      unresponsive: true,
      blockedPopups: 4,
      failed: { message: 'x' },
      download: { name: 'f.bin', state: 'progressing', received: 1, total: 4, path: null },
    });
    for (const notice of ['denied', 'unresponsive', 'popups', 'failed', 'download'] as const) h.navigator.dismiss(id, notice);
    expect(h.tab(id)).toMatchObject({ denied: [], unresponsive: false, blockedPopups: 0, failed: null, download: { state: 'progressing' } });
    h.store.update(id, { download: { name: 'f.bin', state: 'done', received: 4, total: 4, path: '/tmp/f.bin' } });
    h.navigator.dismiss(id, 'download');
    expect(h.tab(id).download).toBeNull();
  });

  it('devtools opens detached, and only for a loaded tab', () => {
    const h = harness();
    const id = h.open();
    h.navigator.devtools(id);
    expect(h.wc(id).openDevTools).toHaveBeenCalledWith({ mode: 'detach' });
    const empty = h.open(null);
    expect(() => h.navigator.devtools(empty)).not.toThrow();
  });
});

describe('navigation: the page\'s own navigations and handlers (E4a Design §8, §14; Decision Log 26, 27)', () => {
  it('will-navigate admits http(s), and refuses any other scheme with the seam line and one chrome notice per burst', () => {
    const h = harness();
    const id = h.open();
    const wc = h.wc(id);
    const ok = cancellable({ url: 'https://b.test/' });
    wc.emit('will-navigate', ok);
    expect(ok.preventDefault).not.toHaveBeenCalled();

    for (const url of ['zoommtg://x', 'file:///etc/hosts', 'about:blank']) {
      const refused = cancellable({ url });
      wc.emit('will-navigate', refused);
      expect(refused.preventDefault).toHaveBeenCalled();
      h.tick(1000);
    }
    expect(h.seam.line.mock.calls.map(([line]) => line)).toEqual([
      'browser-blocked-navigation zoommtg://x',
      'browser-blocked-navigation file:///etc/hosts',
      'browser-blocked-navigation about:blank',
    ]);
    // a script's loop of refusals is one burst: told once, not once per attempt
    expect(h.notices()).toEqual([{ appSessionId: A, tabId: id, kind: 'refusedScheme', name: 'zoommtg:' }]);
    h.tick(WINDOW_OPEN_INPUT_MS + 1); // the burst over: the next refusal is told again
    wc.emit('will-navigate', cancellable({ url: 'slack://x' }));
    expect(h.notices().at(-1)).toEqual({ appSessionId: A, tabId: id, kind: 'refusedScheme', name: 'slack:' });
    expect(h.notices()).toHaveLength(2);
    expect(h.seam.openExternal).not.toHaveBeenCalled();
  });

  it('will-navigate hands mailto: out only after a recent activation, at most three per 5 s; anything else is refused like a scheme', () => {
    const h = harness();
    const id = h.open();
    const wc = h.wc(id);
    const mail = (n: number) => {
      const event = cancellable({ url: `mailto:e4a+${n}@example.test` });
      wc.emit('will-navigate', event);
      return event;
    };
    // a script's mailto: with no input to the page: refused, launching nothing
    expect(mail(0).preventDefault).toHaveBeenCalled();
    expect(h.seam.openExternal).not.toHaveBeenCalled();
    expect(h.seam.line).toHaveBeenLastCalledWith('browser-blocked-navigation mailto:e4a+0@example.test');
    expect(h.notices()).toEqual([{ appSessionId: A, tabId: id, kind: 'refusedScheme', name: 'mailto:' }]);

    h.tick(WINDOW_OPEN_INPUT_MS + 1);
    h.entry(id).input.emit({ kind: 'mouse', source: 'human', at: 1_000_000 + WINDOW_OPEN_INPUT_MS + 1 }); // a click on the link
    for (let n = 1; n <= WINDOW_OPEN_BURST + 2; n++) expect(mail(n).preventDefault).toHaveBeenCalled();
    expect(h.seam.openExternal.mock.calls.map(([url]) => url)).toEqual(['mailto:e4a+1@example.test', 'mailto:e4a+2@example.test', 'mailto:e4a+3@example.test']);
    expect(h.seam.line.mock.calls.slice(-2).map(([line]) => line)).toEqual(['browser-blocked-navigation mailto:e4a+4@example.test', 'browser-blocked-navigation mailto:e4a+5@example.test']);
    expect(h.notices()).toHaveLength(2); // the over-cap pair is one burst

    // a wheel is no activation; an activation older than 5 s opens nothing
    h.tick(WINDOW_OPEN_INPUT_MS + 1);
    h.entry(id).input.emit({ kind: 'wheel', source: 'human', at: 1_000_000 + 2 * (WINDOW_OPEN_INPUT_MS + 1) });
    mail(6);
    expect(h.seam.openExternal).toHaveBeenCalledTimes(3);
  });

  it('a page that closes itself (window.close()) drops its tab as a close does; a view the store closed or suspended changes nothing', () => {
    const h = harness();
    const first = h.open('https://a.test/');
    const second = h.open('https://b.test/');
    const wc = h.wc(second);
    wc.destroyed = true;
    wc.emit('destroyed');
    expect(h.store.entry(second)).toBeUndefined();
    expect(wc.close).not.toHaveBeenCalled();
    expect(h.store.list(A)).toMatchObject({ selected: { [A]: first }, tabs: [expect.objectContaining({ tabId: first })] });

    const third = h.open('https://c.test/');
    const suspended = h.wc(third);
    h.store.suspend(third);
    suspended.destroyed = true;
    suspended.emit('destroyed');
    expect(h.store.entry(third)).toBeDefined();
    const closing = h.wc(first);
    h.store.close(first);
    closing.emit('destroyed');
    expect(h.store.list(A).tabs.map((tab) => tab.tabId)).toEqual([third]);
  });

  it('will-frame-navigate refuses a subframe\'s file:, app scheme, chrome: and devtools:, and leaves the main frame to will-navigate', () => {
    const h = harness();
    const wc = h.wc(h.open());
    for (const url of ['file:///etc/hosts', 'maws-deliverable://x/y/1', 'chrome://settings', 'devtools://devtools/x']) {
      const event = cancellable({ url, isMainFrame: false });
      wc.emit('will-frame-navigate', event);
      expect(event.preventDefault).toHaveBeenCalled();
    }
    const allowed = [cancellable({ url: 'https://frame.test/', isMainFrame: false }), cancellable({ url: 'file:///x', isMainFrame: true })];
    for (const event of allowed) wc.emit('will-frame-navigate', event);
    expect(allowed.map((event) => event.preventDefault.mock.calls.length)).toEqual([0, 0]);
  });

  it('a certificate error is never overridden, a client certificate is never chosen, and beforeunload never blocks', () => {
    const h = harness();
    const wc = h.wc(h.open());
    const certificate = vi.fn();
    const certEvent = cancellable({});
    wc.emit('certificate-error', certEvent, 'https://bad.test/', 'net::ERR_CERT_DATE_INVALID', {}, certificate, true);
    expect(certificate).toHaveBeenCalledWith(false);

    const client = vi.fn();
    const clientEvent = cancellable({});
    wc.emit('select-client-certificate', clientEvent, 'https://mtls.test/', [{ subjectName: 'owner' }], client);
    expect(clientEvent.preventDefault).toHaveBeenCalled();
    expect(client).toHaveBeenCalledWith();

    const unload = cancellable({});
    wc.emit('will-prevent-unload', unload);
    expect(unload.preventDefault).toHaveBeenCalled();
  });
});
