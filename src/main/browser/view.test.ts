import { EventEmitter } from 'node:events';
import type { BrowserWindow, WebContents, WebContentsView } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { BROWSER_LOADED_TABS_MAX, BROWSER_PLACEHOLDER_MAX_BYTES, DEFAULT_PARTITION } from '@shared/browser/tab';
import type { EventName, EventPayload } from '@shared/ipc/schema';

vi.mock('electron', () => ({
  WebContentsView: class {
    constructor(readonly options?: unknown) {}
  },
}));

const { TabStore } = await import('./tabs');
const { ViewManager, createTabView, shown, tabWebPreferences } = await import('./view');
const { focusEmulationMode } = await import('./visibility');

const A = 'App-A' as AppSessionId;

type Rect = { x: number; y: number; width: number; height: number };

function fakeImage(jpegBytes: number, empty = false) {
  const image = {
    isEmpty: () => empty,
    resize: vi.fn(() => image),
    toJPEG: vi.fn(() => Buffer.alloc(jpegBytes, 7)),
  };
  return image;
}

class FakeView {
  bounds: Rect = { x: 0, y: 0, width: 0, height: 0 };
  visible = true; // a new WebContentsView is visible until told otherwise
  readonly calls: string[] = [];
  focused = false;
  capture: () => Promise<unknown> = async () => fakeImage(1000);
  readonly webContents = {
    loadURL: vi.fn(() => Promise.resolve()),
    close: vi.fn(),
    isDestroyed: () => false,
    isFocused: () => this.focused,
    capturePage: () => {
      this.calls.push('capture');
      return this.capture();
    },
  };
  setBounds(rect: Rect) {
    this.bounds = rect;
    this.calls.push(`bounds ${rect.x},${rect.y},${rect.width},${rect.height}`);
  }
  setVisible(visible: boolean) {
    this.visible = visible;
    this.calls.push(`visible ${visible}`);
  }
  getBounds() {
    return this.bounds;
  }
}

let windowIds = 0;
class FakeWindow extends EventEmitter {
  readonly id = ++windowIds;
  readonly children = new Set<FakeView>();
  readonly contentView = {
    addChildView: (view: FakeView) => void this.children.add(view),
    removeChildView: (view: FakeView) => void this.children.delete(view),
  };
  readonly webContents = Object.assign(new EventEmitter(), { focus: vi.fn(), isDestroyed: () => false, getURL: () => 'file:///app/out/renderer/index.html#/s' });
  minimized = false;
  shownOnScreen = true;
  isDestroyed = () => false;
  isMinimized = () => this.minimized;
  isVisible = () => this.shownOnScreen;
}

function harness(options: { focus?: 'on' | 'off' } = {}) {
  const emitted: { name: EventName; payload: unknown }[] = [];
  const views: FakeView[] = [];
  const emit = <N extends EventName>(name: N, payload: EventPayload<N>) => void emitted.push({ name, payload });
  const store = new TabStore({
    emit,
    createView: () => {
      const view = new FakeView();
      views.push(view);
      return view as unknown as WebContentsView;
    },
    resolvePartition: () => DEFAULT_PARTITION,
    schedule: () => {},
    now: () => Date.parse('2026-10-06T12:00:00.000Z'),
  });
  const senders = new Map<object, FakeWindow>();
  const win = () => {
    const w = new FakeWindow();
    const sender = {};
    senders.set(sender, w);
    return { w, sender: sender as WebContents };
  };
  const focusCalls: [string, boolean][] = [];
  let clock = Date.parse('2026-10-06T12:00:00.000Z');
  const manager = new ViewManager({
    store,
    emit,
    windowOf: (sender) => (senders.get(sender) as unknown as BrowserWindow) ?? null,
    focusEmulation: options.focus ?? 'off',
    setFocusEmulation: (entry, enabled) => void focusCalls.push([entry.tab.tabId, enabled]),
    now: () => clock,
  });
  // a loaded tab whose page has committed (shown unless something hides it)
  const loaded = (url = 'https://a.test/') => {
    const { tabId } = store.open({ appSessionId: A, url, select: true }).tab;
    store.navigationCommitted(tabId, { url, canGoBack: false, canGoForward: false });
    return { tabId, view: views.at(-1)! };
  };
  const place = (sender: WebContents, tabId: string, paneId: string, rect: Rect | null, claim = false, surface: 'panel' | 'main' = 'panel') =>
    manager.place({ tabId, paneId, surface, rect, claim }, sender);
  const covered = () => emitted.filter((e) => e.name === 'browser.view.covered').map((e) => e.payload as EventPayload<'browser.view.covered'>);
  const tick = (ms: number) => void (clock += ms);
  return { store, manager, views, win, loaded, place, covered, focusCalls, tick };
}

const R = { x: 10, y: 20, width: 300, height: 200 };

describe('the view manager: placement (E4a Design §3, Decision Log 22)', () => {
  it('a new view starts hidden and unattached; a claim attaches it, sets the bounds and shows it', () => {
    const h = harness();
    const { w, sender } = h.win();
    const { tabId, view } = h.loaded();
    expect(view.visible).toBe(false);
    expect(w.children.size).toBe(0);
    h.tick(5000);
    h.place(sender, tabId, 'p1', R, true);
    expect(w.children.has(view)).toBe(true);
    expect(view.bounds).toEqual(R);
    expect(view.visible).toBe(true);
    expect(h.store.entry(tabId)!.tab).toMatchObject({ placedIn: { paneId: 'p1', surface: 'panel' }, covered: false, lastShownAt: '2026-10-06T12:00:05.000Z' });
  });

  it('rounds the rect to integers', () => {
    const h = harness();
    const { sender } = h.win();
    const { tabId, view } = h.loaded();
    h.place(sender, tabId, 'p1', { x: 10.4, y: 20.6, width: 300.5, height: 199.49 }, true);
    expect(view.bounds).toEqual({ x: 10, y: 21, width: 301, height: 199 });
  });

  it('a report from a pane that is not the owner is ignored, null included; the owner\'s null hides and releases', () => {
    const h = harness();
    const { sender } = h.win();
    const { tabId, view } = h.loaded();
    h.place(sender, tabId, 'p1', R, true);
    h.place(sender, tabId, 'p2', { ...R, x: 99 });
    expect(view.bounds).toEqual(R);
    h.place(sender, tabId, 'p2', null);
    expect(view.visible).toBe(true);
    h.place(sender, tabId, 'p2', null, true); // a collapsed pane's claim never steals the view
    expect(view.visible).toBe(true);
    expect(h.store.entry(tabId)!.tab.placedIn).toEqual({ paneId: 'p1', surface: 'panel' });
    h.place(sender, tabId, 'p1', null);
    expect(view.visible).toBe(false);
    expect(h.store.entry(tabId)!.tab.placedIn).toBeNull();
  });

  it('a claim takes the view from another pane; the last claim wins', () => {
    const h = harness();
    const { sender } = h.win();
    const { tabId, view } = h.loaded();
    h.place(sender, tabId, 'p1', R, true);
    h.place(sender, tabId, 'p2', { x: 0, y: 0, width: 800, height: 600 }, true, 'main');
    expect(view.bounds).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    expect(h.store.entry(tabId)!.tab.placedIn).toEqual({ paneId: 'p2', surface: 'main' });
    h.place(sender, tabId, 'p1', R); // the former owner's resize no longer moves it
    expect(view.bounds).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it('a claim from another window moves the view there: removed from the first contentView, added to the second', () => {
    const h = harness();
    const one = h.win();
    const two = h.win();
    const { tabId, view } = h.loaded();
    h.place(one.sender, tabId, 'p1', R, true);
    h.place(two.sender, tabId, 'p2', R, true);
    expect(one.w.children.has(view)).toBe(false);
    expect(two.w.children.has(view)).toBe(true);
    expect(view.visible).toBe(true);
  });

  it('a placement from a window main does not know is ignored', () => {
    const h = harness();
    const { tabId, view } = h.loaded();
    h.place({} as WebContents, tabId, 'p1', R, true);
    expect(view.visible).toBe(false);
    expect(h.store.entry(tabId)!.tab.placedIn).toBeNull();
  });

  it('a tab placed before its view exists is attached where its pane is when the view is created', () => {
    const h = harness();
    const { w, sender } = h.win();
    const { tabId } = h.store.open({ appSessionId: A, url: null, select: true }).tab;
    h.place(sender, tabId, 'p1', R, true);
    expect(h.views).toHaveLength(0); // an empty tab has no view
    h.store.load(tabId, 'https://a.test/');
    const view = h.views[0]!;
    expect(w.children.has(view)).toBe(true);
    expect(view.bounds).toEqual(R);
    expect(view.visible).toBe(false); // nothing committed yet
    h.store.navigationCommitted(tabId, { url: 'https://a.test/', canGoBack: false, canGoForward: false });
    expect(view.visible).toBe(true);
  });
});

describe('the view manager: lastShownAt and the cap (Design §2)', () => {
  it('a showing stamps lastShownAt when it starts and when it ends, so the cap evicts the tab released first', () => {
    const h = harness();
    const { sender } = h.win();
    const x = h.loaded('https://x.test/');
    const y = h.loaded('https://y.test/');
    for (let i = 2; i < BROWSER_LOADED_TABS_MAX; i++) h.store.update(h.loaded(`https://${i}.test/`).tabId, { control: 'agent' }); // ineligible
    for (const { tab } of h.store.all()) h.store.update(tab.tabId, { loading: false });
    h.tick(1000);
    h.place(sender, x.tabId, 'px', R, true); // x claimed first
    h.tick(1000);
    h.place(sender, y.tabId, 'py', R, true);
    h.tick(1000);
    h.place(sender, y.tabId, 'py', null); // y released first
    h.tick(1000);
    h.place(sender, x.tabId, 'px', null); // x was on screen until now
    expect(h.store.entry(x.tabId)!.tab.lastShownAt).toBe('2026-10-06T12:00:04.000Z');
    expect(h.store.entry(y.tabId)!.tab.lastShownAt).toBe('2026-10-06T12:00:03.000Z');
    h.store.open({ appSessionId: A, url: 'https://new.test/', select: true });
    expect(h.store.entry(y.tabId)!.tab.suspended).toBe(true);
    expect(h.store.entry(x.tabId)!.tab.suspended).toBe(false);
  });

  it('a window\'s reload and its closing end the showings in it, stamped', () => {
    const h = harness();
    const one = h.win();
    const two = h.win();
    const a = h.loaded('https://a.test/');
    const b = h.loaded('https://b.test/');
    h.place(one.sender, a.tabId, 'pa', R, true);
    h.place(two.sender, b.tabId, 'pb', R, true);
    h.tick(7000);
    one.w.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    expect(h.store.entry(a.tabId)!.tab.lastShownAt).toBe('2026-10-06T12:00:07.000Z');
    h.tick(1000);
    two.w.emit('close');
    expect(h.store.entry(b.tabId)!.tab.lastShownAt).toBe('2026-10-06T12:00:08.000Z');
  });
});

describe('the view manager: shown (Design §3, §5)', () => {
  it('a load error or a crash hides the view until the next commit; a suspended tab has no view', () => {
    const h = harness();
    const { sender } = h.win();
    const { tabId, view } = h.loaded();
    h.place(sender, tabId, 'p1', R, true);
    h.store.loadFailed(tabId, { url: 'http://127.0.0.1:1/', code: -102, description: 'ERR_CONNECTION_REFUSED', canGoBack: true, canGoForward: false });
    expect(view.visible).toBe(false);
    h.store.beginNavigation(tabId);
    expect(view.visible).toBe(false); // Chromium's error document is still there until the commit
    h.store.navigationCommitted(tabId, { url: 'https://a.test/', canGoBack: false, canGoForward: false });
    expect(view.visible).toBe(true);
    h.store.rendererGone(tabId, 'crashed');
    expect(view.visible).toBe(false);
    expect(shown(h.store.entry(tabId)!)).toBe(false);
  });

  it('suspending a placed tab removes its view from the window and keeps the placement', () => {
    const h = harness();
    const { w, sender } = h.win();
    const { tabId, view } = h.loaded();
    h.place(sender, tabId, 'p1', R, true);
    h.store.suspend(tabId);
    expect(w.children.has(view)).toBe(false);
    expect(view.webContents.close).toHaveBeenCalled();
    expect(h.store.entry(tabId)!.tab.placedIn).toEqual({ paneId: 'p1', surface: 'panel' });
  });
});

describe('the view manager: cover (Design §3, Decision Log 4, 20)', () => {
  it('hides every placed view of the sender\'s window and no other, then sends each a placeholder taken after hiding', async () => {
    const h = harness();
    const one = h.win();
    const two = h.win();
    const a = h.loaded('https://a.test/');
    const b = h.loaded('https://b.test/');
    const c = h.loaded('https://c.test/');
    h.place(one.sender, a.tabId, 'pa', R, true);
    h.place(one.sender, b.tabId, 'pb', { x: 400, y: 0, width: 100, height: 100 }, true);
    h.place(two.sender, c.tabId, 'pc', R, true);
    a.view.calls.length = 0;
    await h.manager.cover(true, one.sender);
    expect(a.view.visible).toBe(false);
    expect(b.view.visible).toBe(false);
    expect(c.view.visible).toBe(true);
    expect(a.view.calls).toEqual(['visible false', 'capture']); // hidden first, then captured
    expect(h.covered().map((p) => p.tabId).sort()).toEqual([a.tabId, b.tabId].sort());
    expect(h.covered()[0]!.placeholder).toMatch(/^data:image\/jpeg;base64,/);
    expect(h.store.entry(a.tabId)!.tab.covered).toBe(true);
    expect(h.store.entry(c.tabId)!.tab.covered).toBe(false);
    await h.manager.cover(false, one.sender);
    expect(a.view.visible).toBe(true);
    expect(b.view.visible).toBe(true);
    expect(h.store.entry(a.tabId)!.tab.covered).toBe(false);
  });

  it('resizes the capture to the view\'s CSS size and encodes JPEG at quality 80', async () => {
    const h = harness();
    const { sender } = h.win();
    const { tabId, view } = h.loaded();
    const image = fakeImage(10);
    view.capture = async () => image;
    h.place(sender, tabId, 'p1', R, true);
    await h.manager.cover(true, sender);
    expect(image.resize).toHaveBeenCalledWith({ width: 300, height: 200 });
    expect(image.toJPEG).toHaveBeenCalledWith(80);
  });

  it('a capture that throws, comes out empty, or exceeds 400 KiB yields a null placeholder', async () => {
    for (const capture of [
      async () => {
        throw new Error('Current display surface not available');
      },
      async () => fakeImage(10, true),
      async () => fakeImage(BROWSER_PLACEHOLDER_MAX_BYTES + 1),
    ]) {
      const h = harness();
      const { sender } = h.win();
      const { tabId, view } = h.loaded();
      view.capture = capture;
      h.place(sender, tabId, 'p1', R, true);
      await h.manager.cover(true, sender);
      expect(h.covered()).toEqual([{ tabId, placeholder: null }]);
    }
  });

  it('moves focus to the window\'s own page first when a covered view had it', async () => {
    const h = harness();
    const { w, sender } = h.win();
    const { tabId, view } = h.loaded();
    h.place(sender, tabId, 'p1', R, true);
    view.focused = true;
    const order: string[] = [];
    w.webContents.focus.mockImplementation(() => void order.push('focus window'));
    const setVisible = view.setVisible.bind(view);
    view.setVisible = (visible: boolean) => {
      order.push(`visible ${visible}`);
      setVisible(visible);
    };
    await h.manager.cover(true, sender);
    expect(order).toEqual(['focus window', 'visible false']);
  });

  it('moves focus to the window when a placed view that is not showing (its error page drawn) held it; never otherwise', async () => {
    const quiet = harness();
    const q = quiet.win();
    const shown = quiet.loaded();
    quiet.place(q.sender, shown.tabId, 'p1', R, true);
    await quiet.manager.cover(true, q.sender);
    expect(q.w.webContents.focus).not.toHaveBeenCalled(); // no placed page had the focus

    const h = harness();
    const { w, sender } = h.win();
    const { tabId, view } = h.loaded();
    h.place(sender, tabId, 'p1', R, true);
    h.store.loadFailed(tabId, { url: 'http://127.0.0.1:1/', code: -102, description: 'ERR_CONNECTION_REFUSED', canGoBack: false, canGoForward: false });
    view.focused = true;
    await h.manager.cover(true, sender);
    expect(w.webContents.focus).toHaveBeenCalledTimes(1);
    expect(h.covered()).toEqual([]); // nothing was showing, so nothing is captured
  });

  it('a placeholder whose tab moved to another window during the capture is not sent', async () => {
    const h = harness();
    const one = h.win();
    const two = h.win();
    const { tabId, view } = h.loaded();
    h.place(one.sender, tabId, 'p1', R, true);
    let answer!: (image: unknown) => void;
    view.capture = () => new Promise((resolve) => (answer = resolve));
    const pending = h.manager.cover(true, one.sender);
    h.place(two.sender, tabId, 'p2', R, true);
    answer(fakeImage(10));
    await pending;
    expect(h.covered()).toEqual([]);
    expect(view.visible).toBe(true);
  });

  it('a pane claiming while its window is covered stays hidden; a cover that lifts before the capture answers sends nothing', async () => {
    const h = harness();
    const { sender } = h.win();
    const { tabId, view } = h.loaded();
    await h.manager.cover(true, sender);
    h.place(sender, tabId, 'p1', R, true);
    expect(view.visible).toBe(false);
    expect(h.store.entry(tabId)!.tab.covered).toBe(true);
    await h.manager.cover(false, sender);
    expect(view.visible).toBe(true);
    let answer!: (image: unknown) => void;
    view.capture = () => new Promise((resolve) => (answer = resolve));
    const pending = h.manager.cover(true, sender);
    await h.manager.cover(false, sender);
    answer(fakeImage(10));
    await pending;
    expect(h.covered()).toEqual([]);
    expect(view.visible).toBe(true);
  });

  it('a second cover while covered changes nothing and keeps the first cover\'s placeholder', async () => {
    const h = harness();
    const { sender } = h.win();
    const { tabId, view } = h.loaded();
    h.place(sender, tabId, 'p1', R, true);
    let answer!: (image: unknown) => void;
    view.capture = () => new Promise((resolve) => (answer = resolve));
    const first = h.manager.cover(true, sender);
    await h.manager.cover(true, sender);
    answer(fakeImage(10));
    await first;
    expect(h.covered()).toEqual([{ tabId, placeholder: expect.stringMatching(/^data:image\/jpeg;base64,/) }]);
    expect(view.calls.filter((c) => c === 'capture')).toHaveLength(1);
  });
});

describe('the view manager: windows (Design §3 "reloading or crashing", §15)', () => {
  it('the app renderer\'s reload clears that window\'s cover and owners and hides its views, and no other window\'s', async () => {
    const h = harness();
    const one = h.win();
    const two = h.win();
    const a = h.loaded('https://a.test/');
    const c = h.loaded('https://c.test/');
    h.place(one.sender, a.tabId, 'pa', R, true);
    h.place(two.sender, c.tabId, 'pc', R, true);
    await h.manager.cover(true, one.sender);
    await h.manager.cover(true, two.sender);
    const page = 'file:///app/out/renderer/index.html';
    one.w.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true, url: page });
    expect(h.store.entry(a.tabId)!.tab.placedIn).not.toBeNull(); // a same-document navigation is not a reload
    one.w.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'file:///Users/me/dropped.png' });
    expect(h.store.entry(a.tabId)!.tab).toMatchObject({ placedIn: { paneId: 'pa' }, covered: true }); // one will-navigate refuses
    one.w.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: page });
    expect(h.store.entry(a.tabId)!.tab).toMatchObject({ placedIn: null, covered: false });
    expect(a.view.visible).toBe(false);
    expect(one.w.children.has(a.view)).toBe(true); // still attached, hidden
    expect(h.store.entry(c.tabId)!.tab).toMatchObject({ placedIn: { paneId: 'pc' }, covered: true });
    // the fresh renderer's pane claims again, uncovered
    h.place(one.sender, a.tabId, 'pa2', R, true);
    expect(a.view.visible).toBe(true);
    two.w.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    expect(h.store.entry(c.tabId)!.tab).toMatchObject({ placedIn: null, covered: false });
  });

  it('a closing window detaches its views; the tabs live on unplaced', () => {
    const h = harness();
    const { w, sender } = h.win();
    const { tabId, view } = h.loaded();
    h.place(sender, tabId, 'p1', R, true);
    w.emit('close');
    expect(w.children.has(view)).toBe(false);
    expect(view.webContents.close).not.toHaveBeenCalled();
    expect(h.store.entry(tabId)!.tab.placedIn).toBeNull();
    const other = h.win();
    h.place(other.sender, tabId, 'p2', R, true);
    expect(other.w.children.has(view)).toBe(true);
    expect(view.visible).toBe(true);
  });
});

describe('focus emulation (Design §3, Decision Log 1; M0: off)', () => {
  it('the flag defaults to off and MAWS_BROWSER_FOCUS_EMULATION overrides it', () => {
    expect(focusEmulationMode({})).toBe('off');
    expect(focusEmulationMode({ MAWS_BROWSER_FOCUS_EMULATION: '1' })).toBe('on');
    expect(focusEmulationMode({ MAWS_BROWSER_FOCUS_EMULATION: '0' })).toBe('off');
    expect(focusEmulationMode({ MAWS_BROWSER_FOCUS_EMULATION: 'yes' })).toBe('off');
  });

  it('off: never asked', async () => {
    const h = harness({ focus: 'off' });
    const { sender } = h.win();
    const { tabId } = h.loaded();
    h.place(sender, tabId, 'p1', R, true);
    await h.manager.cover(true, sender);
    expect(h.focusCalls).toEqual([]);
  });

  it('on: enabled while the view shows, disabled while covered, unplaced, or its window minimized', async () => {
    const h = harness({ focus: 'on' });
    const { w, sender } = h.win();
    const { tabId } = h.loaded();
    h.place(sender, tabId, 'p1', R, true);
    expect(h.focusCalls).toEqual([[tabId, true]]);
    expect(h.manager.focusEmulationWanted(h.store.entry(tabId)!)).toBe(true); // what a navigation re-sends (visibility.ts)
    await h.manager.cover(true, sender);
    await h.manager.cover(false, sender);
    w.minimized = true;
    w.emit('minimize');
    w.minimized = false;
    w.emit('restore');
    h.place(sender, tabId, 'p1', null);
    expect(h.focusCalls).toEqual([
      [tabId, true],
      [tabId, false],
      [tabId, true],
      [tabId, false],
      [tabId, true],
      [tabId, false],
    ]);
    expect(h.manager.focusEmulationWanted(h.store.entry(tabId)!)).toBe(false);
  });

  it('on: the window\'s hide and show re-evaluate it', () => {
    const h = harness({ focus: 'on' });
    const { w, sender } = h.win();
    const { tabId } = h.loaded();
    h.place(sender, tabId, 'p1', R, true);
    w.shownOnScreen = false;
    w.emit('hide');
    w.shownOnScreen = true;
    w.emit('show');
    expect(h.focusCalls).toEqual([
      [tabId, true],
      [tabId, false],
      [tabId, true],
    ]);
  });
});

describe('createTabView: the page\'s webPreferences (Design §3, §14)', () => {
  it('builds a view in the tab\'s prepared partition with the browser preload, sandboxed, isolated, without Node', () => {
    const session = vi.fn();
    const make = createTabView({ session } as never, '/out/preload/browser.js');
    const view = make({ partition: 'persist:maws-chrome-Profile 1' } as never) as unknown as { options: unknown };
    expect(session).toHaveBeenCalledWith('persist:maws-chrome-Profile 1');
    expect(view.options).toEqual({
      webPreferences: {
        partition: 'persist:maws-chrome-Profile 1',
        preload: '/out/preload/browser.js',
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: true,
      },
    });
    expect(tabWebPreferences('/p.js')).toEqual({ preload: '/p.js', sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: true });
  });

  it('adopts a window.open child\'s own webContents (its preferences came through the open handler\'s override)', () => {
    const child = { id: 7 };
    const view = createTabView({ session: vi.fn() } as never)({ partition: DEFAULT_PARTITION } as never, child as never) as unknown as { options: unknown };
    expect(view.options).toEqual({ webContents: child });
  });
});
