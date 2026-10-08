import type { WebContentsView } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { BROWSER_LOADED_TABS_MAX, BrowserTabSchema, DEFAULT_PARTITION, type BrowserTab } from '@shared/browser/tab';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { TabDebugger } from './debugger';
import { TabStore, UnknownTabError, type TabEntry } from './tabs';

const A = 'App-A' as AppSessionId;
const B = 'App-B' as AppSessionId;

// A WebContentsView as the store uses it: a webContents that loads and closes.
function fakeView() {
  const webContents = {
    loadURL: vi.fn((url: string) => {
      if (url.includes('throw')) throw new Error('refused synchronously');
      return url.includes('reject') ? Promise.reject(new Error('ERR_ABORTED (-3)')) : Promise.resolve();
    }),
    close: vi.fn(),
    destroyed: false,
    isDestroyed: () => webContents.destroyed,
  };
  return { webContents } as unknown as WebContentsView & { webContents: typeof webContents };
}

function harness(options: { restored?: ConstructorParameters<typeof TabStore>[0]['restored']; fileBroken?: boolean; createView?: (tab: BrowserTab) => WebContentsView; driven?: (tabId: string) => boolean } = {}) {
  const emitted: { name: EventName; payload: unknown }[] = [];
  const queue: (() => void)[] = [];
  const views: ReturnType<typeof fakeView>[] = [];
  let clock = Date.parse('2026-10-06T12:00:00.000Z');
  let ids = 0;
  const dirty = vi.fn();
  const store = new TabStore({
    emit: <N extends EventName>(name: N, payload: EventPayload<N>) => void emitted.push({ name, payload }),
    createView:
      options.createView ??
      (() => {
        const view = fakeView();
        views.push(view);
        return view;
      }),
    resolvePartition: () => DEFAULT_PARTITION,
    restored: options.restored,
    fileBroken: options.fileBroken,
    onDirty: dirty,
    now: () => clock,
    newTabId: () => `b_${(++ids).toString(16).padStart(12, '0')}`,
    schedule: (fn) => void queue.push(fn),
    driven: options.driven,
  });
  const flush = () => {
    while (queue.length > 0) queue.shift()!();
  };
  const changed = () => emitted.filter((e) => e.name === 'browser.tabs.changed').map((e) => e.payload as EventPayload<'browser.tabs.changed'>);
  const notices = () => emitted.filter((e) => e.name === 'browser.notice').map((e) => e.payload as EventPayload<'browser.notice'>);
  const tick = (ms: number) => void (clock += ms);
  const entry = (tabId: string) => store.entry(tabId) as TabEntry;
  return { store, emitted, views, flush, changed, notices, tick, dirty, entry };
}

const open = (h: ReturnType<typeof harness>, url: string | null, more: { appSessionId?: AppSessionId; select?: boolean; reuse?: 'url'; requestId?: string } = {}) =>
  h.store.open({ appSessionId: more.appSessionId ?? A, url, select: more.select ?? true, reuse: more.reuse, requestId: more.requestId });

describe('TabStore: opening (E4a Design §2)', () => {
  it('opens an empty tab with no view, selected, and a schema-valid record', () => {
    const h = harness();
    const { tab, reused } = open(h, null);
    expect(reused).toBe(false);
    expect(BrowserTabSchema.safeParse(tab).success).toBe(true);
    expect(tab).toMatchObject({ tabId: 'b_000000000001', appSessionId: A, partition: DEFAULT_PARTITION, url: '', suspended: false, loading: false, control: 'idle' });
    expect(tab.createdAt).toBe('2026-10-06T12:00:00.000Z');
    expect(h.entry(tab.tabId).view).toBeNull();
    expect(h.store.list(A)).toEqual({ tabs: [tab], selected: { [A]: tab.tabId } });
  });

  it('opens a tab with a URL loaded: a view is created and loadURL is voided (a rejection is swallowed)', async () => {
    const h = harness();
    const { tab } = open(h, 'http://127.0.0.1:1/reject');
    expect(h.views).toHaveLength(1);
    expect(h.views[0]!.webContents.loadURL).toHaveBeenCalledWith('http://127.0.0.1:1/reject');
    expect(tab).toMatchObject({ url: 'http://127.0.0.1:1/reject', loading: true, suspended: false });
    await Promise.resolve(); // the rejected promise has been handled: no unhandled rejection fails the run
  });

  it('a loadURL that throws synchronously marks the tab failed and closes the view it made', () => {
    const h = harness();
    const { tab } = open(h, 'https://a.test/throw');
    expect(tab).toMatchObject({ failed: { message: 'refused synchronously' }, loading: false });
    expect(h.entry(tab.tabId).view).toBeNull();
    expect(h.views[0]!.webContents.close).toHaveBeenCalled();
    expect(h.store.loadedCount()).toBe(0);
  });

  it('keeps the selection when select is false', () => {
    const h = harness();
    const first = open(h, null).tab;
    open(h, null, { select: false });
    expect(h.store.list(A).selected).toEqual({ [A]: first.tabId });
  });

  it('reuse "url" selects the session\'s tab at the same normalised URL and loads it when it is suspended', () => {
    const h = harness({
      restored: {
        tabs: [{ tabId: 'b_aaaaaaaaaaaa', appSessionId: A, partition: DEFAULT_PARTITION, url: 'https://wikipedia.org/', title: 'W', favicon: null, zoom: 1, createdAt: 't', lastShownAt: 't' }],
        selected: {},
      },
    });
    const other = open(h, 'https://example.com/', { select: true }).tab;
    const { tab, reused } = open(h, 'https://WIKIPEDIA.org', { reuse: 'url' });
    expect(reused).toBe(true);
    expect(tab.tabId).toBe('b_aaaaaaaaaaaa');
    expect(tab).toMatchObject({ suspended: false, loading: true });
    expect(h.store.list(A).selected[A]).toBe('b_aaaaaaaaaaaa');
    expect(other.tabId).not.toBe(tab.tabId);
    // another session's tab at that URL is never reused (P-21)
    expect(open(h, 'https://wikipedia.org/', { appSessionId: B, reuse: 'url' }).reused).toBe(false);
  });

  it('a repeated requestId within 10 s answers the first call\'s tab; after 10 s it opens anew', () => {
    const h = harness();
    const first = open(h, 'https://a.test/', { requestId: 'r1' });
    const again = open(h, 'https://a.test/', { requestId: 'r1' });
    expect(again).toEqual({ tab: expect.objectContaining({ tabId: first.tab.tabId }), reused: true });
    expect(h.store.list(A).tabs).toHaveLength(1);
    h.tick(10_001);
    expect(open(h, 'https://a.test/', { requestId: 'r1' }).tab.tabId).not.toBe(first.tab.tabId);
  });

  it('a requestId whose tab was closed meanwhile opens a new tab', () => {
    const h = harness();
    const first = open(h, null, { requestId: 'r2' });
    h.store.close(first.tab.tabId);
    expect(open(h, null, { requestId: 'r2' }).reused).toBe(false);
  });

  it('a view that cannot be created marks the tab failed and nothing else', () => {
    const h = harness({
      createView: () => {
        throw new Error('no renderer');
      },
    });
    const { tab } = open(h, 'https://a.test/');
    expect(tab).toMatchObject({ failed: { message: 'no renderer' }, loading: false, suspended: false });
    expect(h.entry(tab.tabId).view).toBeNull();
  });
});

describe('TabStore: closing and selecting', () => {
  it('close destroys the view, drops the entry and selects the next tab, else the previous', () => {
    const h = harness();
    const t1 = open(h, 'https://1.test/').tab;
    const t2 = open(h, 'https://2.test/').tab;
    const t3 = open(h, 'https://3.test/').tab;
    const destroying = vi.fn();
    h.store.onViewDestroying(destroying);
    h.store.select(A, t2.tabId);
    h.store.close(t2.tabId);
    expect(h.views[1]!.webContents.close).toHaveBeenCalled();
    expect(destroying).toHaveBeenCalledWith(expect.objectContaining({ tab: expect.objectContaining({ tabId: t2.tabId }) }));
    expect(h.store.entry(t2.tabId)).toBeUndefined();
    expect(h.store.list(A).selected[A]).toBe(t3.tabId); // the next
    h.store.close(t3.tabId);
    expect(h.store.list(A).selected[A]).toBe(t1.tabId); // the previous
    h.store.close(t1.tabId);
    expect(h.store.list(A)).toEqual({ tabs: [], selected: { [A]: null } });
  });

  it('a page that closed itself drops its tab as a close does, never touching its destroyed contents', () => {
    const h = harness();
    const t1 = open(h, 'https://1.test/').tab;
    const t2 = open(h, 'https://2.test/').tab;
    const t3 = open(h, 'https://3.test/').tab;
    h.store.select(A, t2.tabId);
    const destroying = vi.fn();
    h.store.onViewDestroying(destroying);
    h.views[1]!.webContents.destroyed = true;
    h.store.pageClosed(t2.tabId);
    expect(h.store.entry(t2.tabId)).toBeUndefined();
    expect(h.views[1]!.webContents.close).not.toHaveBeenCalled();
    expect(destroying).toHaveBeenCalledTimes(1);
    expect(h.store.list(A).selected[A]).toBe(t3.tabId);
    expect(h.store.loadedCount()).toBe(2);
    expect(h.store.list(A).tabs.map((t) => t.tabId)).toEqual([t1.tabId, t3.tabId]);
    expect(() => h.store.pageClosed(t2.tabId)).toThrow(UnknownTabError);
  });

  it('closing a tab that is not selected keeps the selection', () => {
    const h = harness();
    const t1 = open(h, null).tab;
    const t2 = open(h, null).tab;
    h.store.close(t1.tabId);
    expect(h.store.list(A).selected[A]).toBe(t2.tabId);
  });

  it('refuses an unknown tab, and a tab of another session for select', () => {
    const h = harness();
    const t1 = open(h, null).tab;
    expect(() => h.store.close('b_ffffffffffff')).toThrow(UnknownTabError);
    expect(() => h.store.select(B, t1.tabId)).toThrow(UnknownTabError);
  });

  it('removeSession closes the session\'s tabs and leaves the others', () => {
    const h = harness();
    open(h, 'https://1.test/');
    const other = open(h, 'https://2.test/', { appSessionId: B }).tab;
    h.store.removeSession(A);
    expect(h.views[0]!.webContents.close).toHaveBeenCalled();
    expect(h.store.list().tabs.map((t) => t.tabId)).toEqual([other.tabId]);
    expect(h.store.list().selected).toEqual({ [B]: other.tabId });
  });
});

describe('TabStore: browser.tabs.changed, coalesced per session', () => {
  it('sends the whole list of each changed session once per macrotask', () => {
    const h = harness();
    const t1 = open(h, 'https://1.test/').tab;
    h.store.update(t1.tabId, { title: 'One' });
    h.store.update(t1.tabId, { title: 'One!' });
    open(h, null, { appSessionId: B });
    expect(h.changed()).toEqual([]);
    h.flush();
    const sent = h.changed();
    expect(sent.map((c) => c.appSessionId)).toEqual([A, B]);
    expect(sent[0]).toMatchObject({ selected: t1.tabId, tabs: [expect.objectContaining({ title: 'One!' })] });
    expect(h.dirty).toHaveBeenCalled();
  });
});

describe('TabStore: the loaded-tab cap (Design §2, Decision Log 6)', () => {
  const fill = (h: ReturnType<typeof harness>) => {
    const tabs: BrowserTab[] = [];
    for (let i = 0; i < BROWSER_LOADED_TABS_MAX; i++) {
      tabs.push(open(h, `https://${i}.test/`).tab);
      h.tick(1000);
    }
    return tabs;
  };

  it('opening past the count suspends the least recently shown eligible tab, with one notice', () => {
    const h = harness();
    const tabs = fill(h);
    for (const t of tabs) h.store.update(t.tabId, { loading: false });
    h.store.update(tabs[0]!.tabId, { lastShownAt: '2026-10-06T13:00:00.000Z' }); // shown recently: not the victim
    h.store.update(tabs[2]!.tabId, { placedIn: { paneId: 'p', surface: 'panel' } }); // placed: protected
    h.store.setControl(tabs[3]!.tabId, 'agent'); // the agent's: protected
    h.store.update(tabs[4]!.tabId, { download: { name: 'f', state: 'progressing', received: 1, total: 2, path: null } }); // downloading
    const added = open(h, 'https://new.test/', { appSessionId: B }).tab;
    expect(added.suspended).toBe(false);
    const victim = h.store.entry(tabs[1]!.tabId)!;
    expect(victim.view).toBeNull();
    expect(victim.tab).toMatchObject({ suspended: true, url: 'https://1.test/', loading: false, memoryKiB: null });
    expect(h.views[1]!.webContents.close).toHaveBeenCalled();
    // told to the opener's session, on the tab it opened, not on the other session's tab that was unloaded
    expect(h.notices()).toEqual([{ appSessionId: B, tabId: added.tabId, kind: 'tabsCap', count: BROWSER_LOADED_TABS_MAX }]);
  });

  it('E13: a tab an agent drives through cua (under a lease) is never the victim, idle as its control may read', () => {
    const driven = new Set<string>();
    const h = harness({ driven: (tabId) => driven.has(tabId) });
    const tabs = fill(h);
    for (const t of tabs) h.store.update(t.tabId, { loading: false });
    driven.add(tabs[0]!.tabId); // the least recently shown, idle (the agent-idle timer lapsed), its lease still held
    open(h, 'https://new.test/', { appSessionId: B });
    expect(h.store.entry(tabs[0]!.tabId)!.view).not.toBeNull();
    expect(h.store.entry(tabs[1]!.tabId)!.view).toBeNull();
    expect(h.store.capVictim()?.tab.tabId).toBe(tabs[2]!.tabId);
  });

  it('with no eligible victim a commanded open opens suspended, its URL kept, and nothing is closed', () => {
    const h = harness();
    fill(h); // all twelve still loading
    const added = open(h, 'https://new.test/').tab;
    expect(added).toMatchObject({ suspended: true, url: 'https://new.test/', loading: false });
    expect(h.store.entry(added.tabId)!.view).toBeNull();
    expect(h.views.every((v) => v.webContents.close.mock.calls.length === 0)).toBe(true);
    expect(h.store.loadedCount()).toBe(BROWSER_LOADED_TABS_MAX);
    expect(h.notices()).toEqual([{ appSessionId: A, tabId: added.tabId, kind: 'tabsCap', count: BROWSER_LOADED_TABS_MAX }]);
  });

  it('suspend keeps {url, title, favicon, zoom} and drops the page\'s transient state', () => {
    const h = harness();
    const t = open(h, 'https://a.test/').tab;
    h.store.update(t.tabId, { title: 'A', zoom: 1.25, find: { active: 1, matches: 2 }, denied: [{ host: 'a.test', permission: 'geolocation' }], canGoBack: true, unresponsive: true });
    h.store.suspend(t.tabId);
    expect(h.store.entry(t.tabId)!.tab).toMatchObject({
      suspended: true, url: 'https://a.test/', title: 'A', zoom: 1.25, find: null, denied: [], canGoBack: false, unresponsive: false, loading: false,
    });
  });
});

describe('TabStore: the load-error lifecycle (Design §5, Decision Log 23)', () => {
  it('start → fail → back → navigate: the error is set, a command clears it, the commit shows the page again', () => {
    const h = harness();
    const { tabId } = open(h, 'http://127.0.0.1:1/').tab;
    expect(h.entry(tabId).committed).toBe(false);
    h.store.loadFailed(tabId, { url: 'http://127.0.0.1:1/', code: -102, description: 'ERR_CONNECTION_REFUSED', canGoBack: true, canGoForward: false });
    expect(h.entry(tabId).tab).toMatchObject({
      url: 'http://127.0.0.1:1/', loading: false, canGoBack: true,
      loadError: { url: 'http://127.0.0.1:1/', host: '127.0.0.1', kind: 'refused', code: -102, description: 'ERR_CONNECTION_REFUSED' },
    });
    expect(h.entry(tabId).committed).toBe(false);
    h.store.beginNavigation(tabId); // Back
    expect(h.entry(tabId).tab).toMatchObject({ loadError: null, loading: true });
    expect(h.entry(tabId).committed).toBe(false); // Chromium's error document is still in the view until the commit
    h.store.navigationCommitted(tabId, { url: 'http://127.0.0.1:2/a.html', canGoBack: false, canGoForward: true });
    expect(h.entry(tabId).tab).toMatchObject({ url: 'http://127.0.0.1:2/a.html', loadError: null, canGoForward: true });
    expect(h.entry(tabId).committed).toBe(true);
    h.store.load(tabId, 'https://b.test/');
    expect(h.entry(tabId).tab).toMatchObject({ url: 'https://b.test/', loading: true, loadError: null });
  });

  it('commit → fail: a late main-frame failure after content hides the page like any other', () => {
    const h = harness();
    const { tabId } = open(h, 'https://a.test/').tab;
    h.store.navigationCommitted(tabId, { url: 'https://a.test/', canGoBack: false, canGoForward: false });
    h.store.loadFailed(tabId, { url: 'https://a.test/', code: -324, description: 'ERR_EMPTY_RESPONSE', canGoBack: false, canGoForward: false });
    expect(h.entry(tabId).tab.loadError).toMatchObject({ kind: 'generic', code: -324 });
    expect(h.entry(tabId).committed).toBe(false);
  });

  // The denial line belongs to the document that asked; a failed load replaces that document as a commit does, so the
  // line must not sit over the next address's error page (the e2e's error shot after a denied notification).
  it('a main-frame failure clears the previous document\'s denied permissions; -3 leaves them', () => {
    const h = harness();
    const { tabId } = open(h, 'https://a.test/').tab;
    h.store.navigationCommitted(tabId, { url: 'https://a.test/', canGoBack: false, canGoForward: false });
    const denied = [{ host: 'a.test', permission: 'notifications' }];
    h.store.update(tabId, { denied });
    h.store.loadFailed(tabId, { url: 'https://a.test/x', code: -3, description: 'ERR_ABORTED', canGoBack: true, canGoForward: false });
    expect(h.entry(tabId).tab.denied).toEqual(denied);
    h.store.loadFailed(tabId, { url: 'http://127.0.0.1:1/', code: -102, description: 'ERR_CONNECTION_REFUSED', canGoBack: true, canGoForward: false });
    expect(h.entry(tabId).tab).toMatchObject({ denied: [], loadError: { kind: 'refused' } });
  });

  it('fail → fail: the second failure replaces the first', () => {
    const h = harness();
    const { tabId } = open(h, 'http://127.0.0.1:1/').tab;
    h.store.loadFailed(tabId, { url: 'http://127.0.0.1:1/', code: -102, description: 'ERR_CONNECTION_REFUSED', canGoBack: false, canGoForward: false });
    h.store.loadFailed(tabId, { url: 'http://e4a.invalid/', code: -105, description: 'ERR_NAME_NOT_RESOLVED', canGoBack: false, canGoForward: false });
    expect(h.entry(tabId).tab).toMatchObject({ url: 'http://e4a.invalid/', loadError: { kind: 'dns', host: 'e4a.invalid', code: -105 } });
  });

  it('-3 (ERR_ABORTED) is never an error', () => {
    const h = harness();
    const { tabId } = open(h, 'https://a.test/').tab;
    h.store.loadFailed(tabId, { url: 'https://a.test/', code: -3, description: 'ERR_ABORTED', canGoBack: false, canGoForward: false });
    expect(h.entry(tabId).tab).toMatchObject({ loadError: null, loading: true });
  });

  it('a renderer that is gone marks the tab crashed until the next commit; a navigation command clears it', () => {
    const h = harness();
    const { tabId } = open(h, 'https://a.test/').tab;
    h.store.navigationCommitted(tabId, { url: 'https://a.test/', canGoBack: false, canGoForward: false });
    h.store.rendererGone(tabId, 'crashed');
    expect(h.entry(tabId).tab).toMatchObject({ crashed: { reason: 'crashed' }, loading: false });
    expect(h.entry(tabId).committed).toBe(false);
    h.store.load(tabId, 'https://a.test/');
    expect(h.entry(tabId).tab.crashed).toBeNull();
  });

  it('a committed navigation clears the document\'s denied requests and blocked pop-ups', () => {
    const h = harness();
    const { tabId } = open(h, 'https://a.test/').tab;
    h.store.update(tabId, { denied: [{ host: 'a.test', permission: 'notifications' }], blockedPopups: 3 });
    h.store.navigationCommitted(tabId, { url: 'https://b.test/', canGoBack: true, canGoForward: false });
    expect(h.entry(tabId).tab).toMatchObject({ denied: [], blockedPopups: 0 });
  });
});

describe('TabStore: restore (G4) and the view hooks', () => {
  it('restores every tab suspended with its selection, and resumes one on load', () => {
    const h = harness({
      restored: {
        tabs: [
          { tabId: 'b_aaaaaaaaaaaa', appSessionId: A, partition: DEFAULT_PARTITION, url: 'https://a.test/', title: 'A', favicon: null, zoom: 1.5, createdAt: 'c', lastShownAt: 'l' },
          { tabId: 'b_bbbbbbbbbbbb', appSessionId: A, partition: DEFAULT_PARTITION, url: '', title: '', favicon: null, zoom: 1, createdAt: 'c', lastShownAt: 'l' },
        ],
        selected: { [A]: 'b_aaaaaaaaaaaa' },
      },
    });
    const { tabs, selected } = h.store.list(A);
    expect(selected).toEqual({ [A]: 'b_aaaaaaaaaaaa' });
    expect(tabs.map((t) => [t.tabId, t.suspended, t.loading, t.control, t.zoom])).toEqual([
      ['b_aaaaaaaaaaaa', true, false, 'idle', 1.5],
      ['b_bbbbbbbbbbbb', true, false, 'idle', 1],
    ]);
    for (const t of tabs) expect(BrowserTabSchema.safeParse(t).success).toBe(true);
    expect(h.store.loadedCount()).toBe(0);
    const created = vi.fn();
    h.store.onViewCreated(created);
    expect(h.store.load('b_aaaaaaaaaaaa', 'https://a.test/')).toBe(true);
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ tab: expect.objectContaining({ tabId: 'b_aaaaaaaaaaaa', suspended: false }) }));
    expect(h.views[0]!.webContents.loadURL).toHaveBeenCalledWith('https://a.test/');
  });

  it('a restored selection naming another session\'s tab, or no tab at all, restores as null', () => {
    const h = harness({
      restored: {
        tabs: [{ tabId: 'b_aaaaaaaaaaaa', appSessionId: A, partition: DEFAULT_PARTITION, url: '', title: '', favicon: null, zoom: 1, createdAt: 'c', lastShownAt: 'l' }],
        selected: { [A]: 'b_aaaaaaaaaaaa', [B]: 'b_aaaaaaaaaaaa', ['App-C' as AppSessionId]: 'b_cccccccccccc' },
      },
    });
    expect(h.store.list().selected).toEqual({ [A]: 'b_aaaaaaaaaaaa', [B]: null, 'App-C': null });
  });

  it('a broken tabs file is announced once, to the first session that lists or opens', () => {
    const h = harness({ fileBroken: true });
    h.store.list();
    expect(h.notices()).toEqual([]); // no session named yet
    h.store.list(B);
    h.store.list(A);
    open(h, null);
    expect(h.notices()).toEqual([{ appSessionId: B, tabId: null, kind: 'tabsFileBroken' }]);
  });

  it('snapshot is what tabs.json keeps', () => {
    const h = harness();
    const t = open(h, 'https://a.test/').tab;
    h.store.update(t.tabId, { title: 'A', zoom: 2 });
    expect(h.store.snapshot()).toEqual({
      version: 1,
      tabs: [{ tabId: t.tabId, appSessionId: A, partition: DEFAULT_PARTITION, url: 'https://a.test/', title: 'A', favicon: null, zoom: 2, createdAt: t.createdAt, lastShownAt: t.lastShownAt }],
      selected: { [A]: t.tabId },
    });
  });
});

describe('TabStore: adopting a page\'s window.open child (Design §14, Decision Log 24)', () => {
  // A createView that adopts the child webContents it is given, as view.ts does.
  function adopting() {
    const made: { tab: BrowserTab; adopted: unknown }[] = [];
    const h = harness({
      createView: (tab, adopted?: unknown) => {
        made.push({ tab, adopted });
        const view = fakeView();
        return (adopted ? { webContents: adopted } : view) as WebContentsView;
      },
    });
    return { h, made };
  }
  const child = () => fakeView().webContents;

  it('adopts Chromium\'s child as a new tab of the opener\'s session and partition, selected, wired before it returns', () => {
    const { h, made } = adopting();
    const opener = h.entry(open(h, 'https://a.test/').tab.tabId);
    h.store.update(opener.tab.tabId, { partition: 'persist:maws-chrome-Profile 1' });
    const created = vi.fn((entry: TabEntry) => entry.view?.webContents);
    h.store.onViewCreated(created);
    const webContents = child();
    const adopted = h.store.adoptChild(opener, { url: 'https://a.test/c.html', select: true, webContents: webContents as never });
    expect(adopted.view!.webContents).toBe(webContents);
    expect(made.at(-1)).toMatchObject({ adopted: webContents, tab: { partition: 'persist:maws-chrome-Profile 1', appSessionId: A } });
    expect(created).toHaveReturnedWith(webContents);
    expect(adopted.tab).toMatchObject({ url: 'https://a.test/c.html', loading: true, suspended: false });
    expect(adopted.committed).toBe(false); // hidden until the child's own page commits
    expect(webContents.loadURL).not.toHaveBeenCalled(); // Chromium navigates the child itself
    expect(h.store.list(A).selected[A]).toBe(adopted.tab.tabId);
  });

  it('a background child keeps the selection; an about:blank child is shown at once (its opener may write into it)', () => {
    const { h } = adopting();
    const opener = h.entry(open(h, 'https://a.test/').tab.tabId);
    const background = h.store.adoptChild(opener, { url: 'https://a.test/b.html', select: false, webContents: child() as never });
    expect(h.store.list(A).selected[A]).toBe(opener.tab.tabId);
    expect(background.tab.tabId).not.toBe(opener.tab.tabId);
    const blank = h.store.adoptChild(opener, { url: 'about:blank', select: true, webContents: child() as never });
    expect(blank.committed).toBe(true);
    expect(blank.tab).toMatchObject({ url: '', loading: false });
  });

  it('a child whose view cannot be made, or whose wiring throws, is a failed tab with no view, and the child is left open', () => {
    let refuse = false;
    const own: ReturnType<typeof fakeView>[] = [];
    const h = harness({
      createView: (_tab, adopted?: unknown) => {
        if (refuse && adopted) throw new Error('no view');
        if (adopted) return { webContents: adopted } as WebContentsView;
        own.push(fakeView());
        return own.at(-1)!;
      },
    });
    const opener = h.entry(open(h, 'https://a.test/').tab.tabId);
    refuse = true;
    const unmade = child();
    const failed = h.store.adoptChild(opener, { url: 'https://a.test/c.html', select: true, webContents: unmade as never });
    expect(failed.view).toBeNull();
    expect(failed.tab.failed).toEqual({ message: 'no view' });
    expect(unmade.close).not.toHaveBeenCalled(); // the caller closes it once Electron has it back

    refuse = false;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unhook = h.store.onViewCreated(() => {
      throw new Error('wiring broke');
    });
    try {
      const unwired = child();
      const broken = h.store.adoptChild(opener, { url: 'https://a.test/d.html', select: true, webContents: unwired as never });
      expect(broken.view).toBeNull();
      expect(broken.tab.failed).toEqual({ message: 'wiring broke' });
      expect(unwired.close).not.toHaveBeenCalled();
      // a tab's own view whose wiring throws is closed at once
      const plain = open(h, 'https://b.test/').tab;
      expect(h.store.entry(plain.tabId)!.view).toBeNull();
      expect(own.at(-1)!.webContents.close).toHaveBeenCalled();
    } finally {
      unhook();
      logged.mockRestore();
    }
  });

  it('adopting at the cap suspends the least recently shown eligible tab; with none, the child is adopted over the cap', () => {
    const { h } = adopting();
    const tabs: BrowserTab[] = [];
    for (let i = 0; i < BROWSER_LOADED_TABS_MAX; i++) {
      tabs.push(open(h, `https://${i}.test/`).tab);
      h.tick(1000);
    }
    expect(h.store.hasRoomForView()).toBe(false); // all twelve loading: nothing eligible
    const opener = h.entry(tabs[0]!.tabId);
    const over = h.store.adoptChild(opener, { url: 'https://a.test/c.html', select: true, webContents: child() as never });
    expect(over.view).not.toBeNull();
    expect(h.store.loadedCount()).toBe(BROWSER_LOADED_TABS_MAX + 1);

    for (const t of tabs) h.store.update(t.tabId, { loading: false });
    h.store.update(over.tab.tabId, { loading: false, lastShownAt: '2026-10-06T13:00:00.000Z' });
    expect(h.store.hasRoomForView()).toBe(true);
    h.store.adoptChild(opener, { url: 'https://a.test/d.html', select: true, webContents: child() as never });
    expect(h.store.entry(tabs[0]!.tabId)!.view).not.toBeNull(); // the opener, though least recently shown, is spared
    expect(h.store.entry(tabs[1]!.tabId)!.view).toBeNull(); // the next least recently shown idle, unplaced tab
    expect(h.notices().at(-1)).toMatchObject({ kind: 'tabsCap', appSessionId: A });
  });

  it('a page never suspends its own opener to make room: the room check spares it too', () => {
    const { h } = adopting();
    const tabs: BrowserTab[] = [];
    for (let i = 0; i < BROWSER_LOADED_TABS_MAX; i++) {
      tabs.push(open(h, `https://${i}.test/`).tab);
      h.tick(1000);
    }
    h.store.update(tabs[0]!.tabId, { loading: false }); // the one idle, unplaced tab: the opener itself
    const opener = h.entry(tabs[0]!.tabId);
    expect(h.store.hasRoomForView()).toBe(true);
    expect(h.store.hasRoomForView(opener)).toBe(false);
    // adopted over the cap all the same (Chromium already made the child), the opener kept
    const over = h.store.adoptChild(opener, { url: 'https://a.test/c.html', select: true, webContents: child() as never });
    expect(over.view).not.toBeNull();
    expect(opener.view).not.toBeNull();
    expect(h.store.loadedCount()).toBe(BROWSER_LOADED_TABS_MAX + 1);
    // a tab the page opens itself (a ⌘-click: no child from Chromium) spares it as well, and opens suspended
    const clicked = h.store.open({ appSessionId: A, url: 'https://a.test/d.html', select: false, opener });
    expect(opener.view).not.toBeNull();
    expect(clicked.tab).toMatchObject({ suspended: true, url: 'https://a.test/d.html' });
  });

  it('a popup that closes itself (an OAuth sign-in posting back) returns the selection to its opener, as Chrome does', () => {
    const { h } = adopting();
    const opener = h.entry(open(h, 'https://a.test/').tab.tabId);
    const between = open(h, 'https://b.test/').tab;
    const popup = h.store.adoptChild(opener, { url: 'https://a.test/c.html', select: true, webContents: child() as never });
    h.store.pageClosed(popup.tab.tabId);
    expect(h.store.list(A).selected[A]).toBe(opener.tab.tabId); // not the neighbour, `between`
    // an opener gone meanwhile: the neighbour, as any close
    const orphan = h.store.adoptChild(opener, { url: 'https://a.test/d.html', select: true, webContents: child() as never });
    h.store.close(opener.tab.tabId);
    h.store.select(A, orphan.tab.tabId);
    h.store.pageClosed(orphan.tab.tabId);
    expect(h.store.list(A).selected[A]).toBe(between.tabId);
    // the person's own close keeps the neighbour rule
    const third = h.entry(open(h, 'https://e.test/').tab.tabId);
    const shut = h.store.adoptChild(third, { url: 'https://e.test/f.html', select: true, webContents: child() as never });
    open(h, 'https://g.test/', { select: false });
    h.store.close(shut.tab.tabId);
    expect(h.store.list(A).selected[A]).not.toBe(third.tab.tabId);
  });

  it('open with an explicit partition (a page\'s context menu) skips the setting\'s partition', () => {
    const { h } = adopting();
    const tab = h.store.open({ appSessionId: A, url: 'https://a.test/', select: false, partition: 'persist:maws-chrome-Profile 1' }).tab;
    expect(tab.partition).toBe('persist:maws-chrome-Profile 1');
    expect(open(h, null).tab.partition).toBe(DEFAULT_PARTITION);
  });

  it('entryOf finds the tab whose view holds a webContents; a new entry has no input yet', () => {
    const { h } = adopting();
    const entry = h.entry(open(h, 'https://a.test/').tab.tabId);
    expect(h.store.entryOf(entry.view!.webContents)).toBe(entry);
    expect(h.store.entryOf(child() as never)).toBeUndefined();
    expect(entry.input).toMatchObject({ lastHumanAt: null, lastHumanActivationAt: null, lastActivationAt: null });
    expect(entry.findOpen).toBe(false);
  });
});

describe('TabStore: the control field (Design §11)', () => {
  it('setControl moves control, stamps controlSince, and tells browser.control.changed at once and the tab list after', () => {
    const h = harness();
    const { tab } = open(h, null);
    h.flush();
    h.tick(5000);
    h.store.setControl(tab.tabId, 'human');
    const since = '2026-10-06T12:00:05.000Z';
    expect(h.entry(tab.tabId).tab).toMatchObject({ control: 'human', controlSince: since });
    expect(h.emitted.filter((e) => e.name === 'browser.control.changed').map((e) => e.payload)).toEqual([{ tabId: tab.tabId, control: 'human', controlSince: since }]);
    h.flush();
    expect(h.changed().at(-1)!.tabs[0]).toMatchObject({ control: 'human', controlSince: since });
    h.tick(1000);
    h.store.setControl(tab.tabId, 'idle');
    h.store.setControl(tab.tabId, 'idle'); // from any state, idle included: stamped and told again
    expect(h.emitted.filter((e) => e.name === 'browser.control.changed')).toHaveLength(3);
    expect(() => h.store.setControl('b_ffffffffffff', 'idle')).toThrow(UnknownTabError);
  });
});

describe('TabStore: the TabDebugger (Design §10, §15)', () => {
  it('one per loaded view, made with it, detached when its renderer is gone, and dropped with the view', () => {
    const h = harness();
    const { tab } = open(h, 'https://a.test/');
    const entry = h.entry(tab.tabId);
    const first = entry.debugger!;
    expect(first).toBeInstanceOf(TabDebugger);
    expect(first.attached).toBe(false); // attached only when someone asks
    const detach = vi.spyOn(first, 'end');
    h.store.rendererGone(tab.tabId, 'crashed');
    expect(detach).toHaveBeenCalledTimes(1);
    expect(entry.debugger).toBe(first); // the view lives on, and so does its debugger: the next ask attaches again
    h.store.suspend(tab.tabId);
    expect(detach).toHaveBeenCalledTimes(2);
    expect(entry.debugger).toBeNull();
    h.store.load(tab.tabId, 'https://a.test/');
    expect(entry.debugger).toBeInstanceOf(TabDebugger);
    expect(entry.debugger).not.toBe(first);
    expect(h.entry(open(h, null).tab.tabId).debugger).toBeNull(); // no view, no debugger
  });
});
