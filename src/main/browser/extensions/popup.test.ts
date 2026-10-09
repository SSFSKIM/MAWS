import { EventEmitter } from 'node:events';
import type { BrowserWindow, WebContentsView } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import type { LinkTarget } from '../window-open';
import type { LoadedAction } from './actions';

vi.mock('electron', () => ({ WebContentsView: class {} }));

const { TabStore } = await import('../tabs');
const { ExtensionPopups, POPUP_REOPEN_GUARD_MS, popupBounds } = await import('./popup');

const A = 'App-A' as AppSessionId;
const PART = 'persist:maws-chrome-Default';
const PROBE = 'nenbjdahllkkbfanbpfmmdacjencdfpg';
const OTHER = 'ofmpefonpiifpjlopbcacdiahhnegimn';
const ANCHOR = { x: 600, y: 40, width: 24, height: 24 };

type Rect = { x: number; y: number; width: number; height: number };

class FakeContents extends EventEmitter {
  destroyed = false;
  readonly loadURL = vi.fn(() => Promise.resolve());
  readonly focus = vi.fn(() => void this.emit('focus'));
  readonly close = vi.fn(() => {
    this.destroyed = true;
  });
  openHandler: ((details: { url: string; disposition: string }) => { action: string }) | null = null;
  isDestroyed = () => this.destroyed;
  setWindowOpenHandler(handler: (details: { url: string; disposition: string }) => { action: string }) {
    this.openHandler = handler;
  }
}

class FakePopupView {
  bounds: Rect = { x: 0, y: 0, width: 0, height: 0 };
  visible = true;
  readonly webContents = new FakeContents();
  setBounds(rect: Rect) {
    this.bounds = rect;
  }
  setVisible(visible: boolean) {
    this.visible = visible;
  }
  getBounds() {
    return this.bounds;
  }
}

let windowIds = 0;
class FakeWindow extends EventEmitter {
  readonly id = ++windowIds;
  readonly children: unknown[] = [];
  destroyed = false;
  readonly contentView = {
    addChildView: (view: unknown) => {
      const at = this.children.indexOf(view);
      if (at >= 0) this.children.splice(at, 1);
      this.children.push(view); // Electron's: a view added again goes on top
    },
    removeChildView: (view: unknown) => {
      const at = this.children.indexOf(view);
      if (at >= 0) this.children.splice(at, 1);
    },
  };
  isDestroyed = () => this.destroyed;
  getContentSize = () => [1000, 700];
}

const probeAction: LoadedAction = {
  extensionId: PROBE,
  name: 'MAWS probe extension',
  title: 'MAWS probe',
  hasPopup: true,
  hasOptions: true,
  popupUrl: `chrome-extension://${PROBE}/popup.html`,
  optionsUrl: `chrome-extension://${PROBE}/options.html`,
  iconPath: null,
  path: '/ext',
};
const otherAction: LoadedAction = { ...probeAction, extensionId: OTHER, name: 'Other', popupUrl: `chrome-extension://${OTHER}/p.html` };
const inert: LoadedAction = { ...probeAction, extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', hasPopup: false, popupUrl: null };

function harness({ linkTarget = 'in-app' as LinkTarget } = {}) {
  const emitted: { name: EventName; payload: unknown }[] = [];
  const emit = <N extends EventName>(name: N, payload: EventPayload<N>) => void emitted.push({ name, payload });
  let tabViews = 0;
  const store = new TabStore({
    emit,
    createView: () => {
      tabViews++;
      return new FakePopupView() as unknown as WebContentsView;
    },
    resolvePartition: () => PART,
    schedule: () => {},
  });
  const views: FakePopupView[] = [];
  const created: string[] = [];
  const unloads = new Set<(partition: string, id: string) => void>();
  const covered = new Set<number>();
  const external: string[] = [];
  const logged: unknown[] = [];
  let clock = 1_000_000;
  const popups = new ExtensionPopups({
    store,
    actions: {
      find: (partition, id) => (partition !== PART ? null : ([probeAction, otherAction, inert].find((action) => action.extensionId === id) ?? null)),
      onUnloaded: (listener) => {
        unloads.add(listener);
        return () => void unloads.delete(listener);
      },
    },
    createView: (partition) => {
      created.push(partition);
      const view = new FakePopupView();
      views.push(view);
      return view as unknown as WebContentsView;
    },
    emit,
    covered: (windowId) => covered.has(windowId),
    linkTarget: () => linkTarget,
    seam: { openExternal: (url) => void external.push(url) },
    log: (event) => void logged.push(event),
    now: () => clock,
  });
  const states: unknown[] = [];
  popups.state$((windowId, state) => states.push([windowId, state]));
  const w = new FakeWindow();
  // a tab of the session in the profile's partition, placed by pane p1 in `w`
  const placedTab = (win: FakeWindow = w, paneId = 'p1') => {
    const { tabId } = store.open({ appSessionId: A, url: 'https://page.test/', select: true }).tab;
    const entry = store.require(tabId);
    entry.placement = { paneId, surface: 'panel', window: win as unknown as BrowserWindow, rect: { x: 0, y: 80, width: 1000, height: 620 } };
    entry.host = win as unknown as BrowserWindow;
    win.contentView.addChildView(entry.view);
    store.update(tabId, { placedIn: { paneId, surface: 'panel' } });
    return entry;
  };
  const notices = () => emitted.filter((e) => e.name === 'browser.notice').map((e) => e.payload);
  return {
    store, popups, views, created, unloads, covered, external, logged, states, w, placedTab, notices, emitted,
    tick: (ms: number) => void (clock += ms),
    tabViews: () => tabViews,
  };
}

// The popup's page laid out at a size; and its load finished (which focuses it).
const sized = (view: FakePopupView, width = 344, height = 179) => view.webContents.emit('preferred-size-changed', {}, { width, height });
const loaded = (view: FakePopupView) => view.webContents.emit('did-finish-load');

describe('popupBounds', () => {
  const content = { width: 1000, height: 700 };

  it('puts the popup under the anchor, its right edge on the anchor\'s', () => {
    expect(popupBounds(ANCHOR, { width: 344, height: 179 }, content)).toEqual({ x: 280, y: 64, width: 344, height: 179 });
  });

  it('clamps the size to Chrome\'s bounds and the position into the window', () => {
    expect(popupBounds(ANCHOR, { width: 5, height: 2000 }, content)).toMatchObject({ width: 25, height: 600 });
    expect(popupBounds({ x: 10, y: 40, width: 24, height: 24 }, { width: 344, height: 100 }, content)).toMatchObject({ x: 0 });
    expect(popupBounds({ x: 10, y: 40, width: 24, height: 24 }, { width: 344, height: 100 }, { width: 200, height: 700 })).toMatchObject({ x: 0, width: 200 });
  });

  it('flips above the anchor when it would not fit below, and stays in the window when neither fits', () => {
    expect(popupBounds({ x: 600, y: 600, width: 24, height: 24 }, { width: 300, height: 200 }, content)).toEqual({ x: 324, y: 400, width: 300, height: 200 });
    expect(popupBounds({ x: 600, y: 300, width: 24, height: 24 }, { width: 300, height: 500 }, content)).toEqual({ x: 324, y: 200, width: 300, height: 500 });
  });
});

describe('ExtensionPopups: opening (the spec\'s "The popup view")', () => {
  it('opens a view in the tab\'s partition, over the window\'s views, at Chrome\'s minimum under the button until its first layout sizes it', () => {
    const h = harness();
    const entry = h.placedTab();
    h.popups.open(entry, PROBE, ANCHOR);
    const [view] = h.views;
    expect(h.created).toEqual([PART]);
    expect(h.w.children.at(-1)).toBe(view);
    expect(view!.visible).toBe(true); // a hidden view would never lay its page out, and never report its size
    expect(view!.bounds).toEqual({ x: 599, y: 64, width: 25, height: 25 });
    expect(view!.webContents.focus).not.toHaveBeenCalled();
    expect(view!.webContents.loadURL).toHaveBeenCalledWith(`chrome-extension://${PROBE}/popup.html`);
    expect(h.states).toEqual([[h.w.id, { tabId: entry.tab.tabId, extensionId: PROBE }]]);
    sized(view!, 344, 104);
    expect(view!.bounds).toEqual({ x: 280, y: 64, width: 344, height: 104 });
    loaded(view!);
    loaded(view!);
    expect(view!.webContents.focus).toHaveBeenCalledTimes(1);
    sized(view!, 344, 179); // every later layout resizes it (S1: the first event is the page's first layout only)
    expect(view!.bounds).toEqual({ x: 280, y: 64, width: 344, height: 179 });
    expect(h.popups.current(h.w.id)).toMatchObject({ tabId: entry.tab.tabId, extensionId: PROBE });
  });

  it('opens nothing for an unplaced tab, a covered window, an extension of no popup or not loaded', () => {
    const h = harness();
    const entry = h.placedTab();
    h.covered.add(h.w.id);
    h.popups.open(entry, PROBE, ANCHOR);
    h.covered.clear();
    h.popups.open(entry, inert.extensionId, ANCHOR);
    h.popups.open(entry, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', ANCHOR);
    entry.placement = null;
    h.popups.open(entry, PROBE, ANCHOR);
    expect(h.views).toHaveLength(0);
  });

  it('keeps one popup per window: another action\'s click closes the first and opens its own', () => {
    const h = harness();
    const entry = h.placedTab();
    h.popups.open(entry, PROBE, ANCHOR);
    h.popups.open(entry, OTHER, ANCHOR);
    expect(h.views[0]!.webContents.close).toHaveBeenCalled();
    expect(h.w.children).not.toContain(h.views[0]);
    expect(h.popups.current(h.w.id)?.extensionId).toBe(OTHER);
  });

  it('raises the popup above a page view a place added after it', () => {
    const h = harness();
    const entry = h.placedTab();
    h.popups.open(entry, PROBE, ANCHOR);
    const page = {};
    h.w.contentView.addChildView(page);
    expect(h.w.children.at(-1)).toBe(page);
    h.popups.raise(h.w.id);
    expect(h.w.children.at(-1)).toBe(h.views[0]);
    h.popups.raise(999); // no popup there: nothing
  });
});

// The close reasons, each from an open popup: the view leaves the window, its page is closed, the state says none.
describe('ExtensionPopups: closing (a state table over a fake view)', () => {
  const cases: [string, (h: ReturnType<typeof harness>, entry: ReturnType<ReturnType<typeof harness>['placedTab']>, view: FakePopupView) => void][] = [
    ['blur, once it had the focus', (_h, _entry, view) => view.webContents.emit('blur')],
    ['Esc from its own page', (_h, _entry, view) => view.webContents.emit('before-input-event', { preventDefault: vi.fn() }, { type: 'keyDown', key: 'Escape' })],
    ['a second click on the same action', (h, entry) => h.popups.open(entry, PROBE, ANCHOR)],
    ['the tab let go by its pane (another tab selected)', (h, entry) => {
      entry.placement = null;
      h.store.update(entry.tab.tabId, { placedIn: null });
    }],
    ['the tab moved to another pane (its surface changed)', (h, entry) => {
      entry.placement = { ...entry.placement!, paneId: 'p2', surface: 'main' };
      h.store.update(entry.tab.tabId, { placedIn: { paneId: 'p2', surface: 'main' } });
    }],
    ['the tab closed', (h, entry) => h.store.close(entry.tab.tabId)],
    ['the window\'s cover', (h) => h.popups.close(h.w.id, 'cover')],
    ['its extension unloaded', (h) => h.unloads.forEach((listener) => listener(PART, PROBE))],
    ['its page failing to load', (_h, _entry, view) => view.webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'x', true)],
    ['its page crashing', (_h, _entry, view) => view.webContents.emit('render-process-gone', {}, { reason: 'crashed' })],
    ['the window closing', (h) => h.w.emit('closed')],
    ['the window losing the focus', (h) => h.w.emit('blur')],
    ['the profile\'s removal', (h) => h.popups.closeAll(PART)],
  ];

  for (const [reason, act] of cases) {
    it(`closes on ${reason}`, () => {
      const h = harness();
      const entry = h.placedTab();
      h.popups.open(entry, PROBE, ANCHOR);
      const view = h.views[0]!;
      loaded(view);
      act(h, entry, view);
      expect(h.w.children).not.toContain(view);
      expect(view.webContents.close).toHaveBeenCalledTimes(1);
      expect(h.popups.current(h.w.id)).toBeNull();
      expect(h.states.at(-1)).toEqual([h.w.id, null]);
    });
  }

  it('closes when its page closes itself (window.close()), never touching the destroyed contents', () => {
    const h = harness();
    const entry = h.placedTab();
    h.popups.open(entry, PROBE, ANCHOR);
    const view = h.views[0]!;
    view.webContents.destroyed = true; // Electron destroys the view's contents and drops `view.webContents`
    view.webContents.emit('destroyed');
    expect(h.w.children).not.toContain(view);
    expect(view.webContents.close).not.toHaveBeenCalled();
    expect(h.popups.current(h.w.id)).toBeNull();
    expect(h.states.at(-1)).toEqual([h.w.id, null]);
    expect(h.notices()).toEqual([]);
  });

  it('stays open through what is no reason: a subframe failing, -3, another extension unloading, another partition\'s removal, a tab update', () => {
    const h = harness();
    const entry = h.placedTab();
    h.popups.open(entry, PROBE, ANCHOR);
    const view = h.views[0]!;
    view.webContents.emit('did-fail-load', {}, -6, 'x', 'x', false);
    view.webContents.emit('did-fail-load', {}, -3, 'x', 'x', true);
    view.webContents.emit('before-input-event', { preventDefault: vi.fn() }, { type: 'keyUp', key: 'Escape' });
    h.unloads.forEach((listener) => listener(PART, OTHER));
    h.popups.closeAll('persist:maws-chrome-Work');
    h.store.update(entry.tab.tabId, { title: 'Moved on' });
    view.webContents.emit('blur'); // before it ever had the focus (its load focuses it)
    expect(h.popups.current(h.w.id)?.extensionId).toBe(PROBE);
    expect(view.webContents.close).not.toHaveBeenCalled();
  });

  it('names the extension in the chrome\'s notice when its page failed or crashed, and only then', () => {
    const h = harness();
    const entry = h.placedTab();
    h.popups.open(entry, PROBE, ANCHOR);
    h.views[0]!.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    h.popups.open(entry, PROBE, ANCHOR);
    loaded(h.views[1]!);
    h.views[1]!.webContents.emit('blur');
    expect(h.notices()).toEqual([{ appSessionId: A, tabId: entry.tab.tabId, kind: 'extensionPopupFailed', name: 'MAWS probe extension' }]);
  });

  it('a click on the same action right after its blur closed it is the second click: it stays closed', () => {
    const h = harness();
    const entry = h.placedTab();
    h.popups.open(entry, PROBE, ANCHOR);
    loaded(h.views[0]!);
    h.views[0]!.webContents.emit('blur'); // the mouse down on the action button took the focus first
    h.tick(POPUP_REOPEN_GUARD_MS - 1);
    h.popups.open(entry, PROBE, ANCHOR);
    expect(h.views).toHaveLength(1);
    h.popups.open(entry, PROBE, ANCHOR); // the next click opens it again
    expect(h.views).toHaveLength(2);
  });

  it('a click after the guard, or on another action, opens', () => {
    const h = harness();
    const entry = h.placedTab();
    h.popups.open(entry, PROBE, ANCHOR);
    loaded(h.views[0]!);
    h.views[0]!.webContents.emit('blur');
    h.popups.open(entry, OTHER, ANCHOR);
    expect(h.popups.current(h.w.id)?.extensionId).toBe(OTHER);
    loaded(h.views[1]!);
    h.views[1]!.webContents.emit('blur');
    h.tick(POPUP_REOPEN_GUARD_MS + 1);
    h.popups.open(entry, OTHER, ANCHOR);
    expect(h.popups.current(h.w.id)?.extensionId).toBe(OTHER);
  });

  it('ignores a closed popup\'s late events', () => {
    const h = harness();
    const entry = h.placedTab();
    h.popups.open(entry, PROBE, ANCHOR);
    const first = h.views[0]!;
    h.popups.close(h.w.id, 'toggle');
    h.popups.open(entry, OTHER, ANCHOR);
    first.webContents.emit('blur');
    first.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    sized(first, 50, 50);
    expect(h.popups.current(h.w.id)?.extensionId).toBe(OTHER);
    expect(h.notices()).toEqual([]);
  });
});

describe('ExtensionPopups: the popup\'s own links (window.open and its navigations)', () => {
  const press = (view: FakePopupView) => view.webContents.emit('before-mouse-event', {}, { type: 'mouseDown' });

  it('opens an http(s) page after an activation as a new unselected tab of the tab\'s session and partition', () => {
    const h = harness();
    const entry = h.placedTab();
    h.popups.open(entry, PROBE, ANCHOR);
    const view = h.views[0]!;
    press(view);
    expect(view.webContents.openHandler!({ url: 'https://docs.test/a', disposition: 'foreground-tab' })).toEqual({ action: 'deny' });
    const opened = h.store.all().find((candidate) => candidate.tab.url === 'https://docs.test/a')!;
    expect(opened.tab).toMatchObject({ appSessionId: A, partition: PART });
    expect(h.store.list(A).selected[A]).toBe(entry.tab.tabId);
    // a same-frame link to the web: the popup stays on its page, the link opens as a tab
    view.webContents.emit('before-input-event', { preventDefault: vi.fn() }, { type: 'keyDown', key: 'Enter' });
    const event = { url: 'https://docs.test/b', preventDefault: vi.fn() };
    view.webContents.emit('will-navigate', event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(h.store.all().some((candidate) => candidate.tab.url === 'https://docs.test/b')).toBe(true);
  });

  it('honours linkTarget external', () => {
    const h = harness({ linkTarget: 'external' });
    const entry = h.placedTab();
    h.popups.open(entry, PROBE, ANCHOR);
    press(h.views[0]!);
    h.views[0]!.webContents.openHandler!({ url: 'https://docs.test/a', disposition: 'foreground-tab' });
    expect(h.external).toEqual(['https://docs.test/a']);
  });

  it('refuses an open without a recent activation, and any other scheme, logging the scheme only', () => {
    const h = harness();
    const entry = h.placedTab();
    h.popups.open(entry, PROBE, ANCHOR);
    const view = h.views[0]!;
    const tabs = h.store.all().length;
    view.webContents.openHandler!({ url: 'https://docs.test/a', disposition: 'foreground-tab' });
    press(view);
    h.tick(5001);
    view.webContents.openHandler!({ url: 'https://docs.test/a', disposition: 'foreground-tab' });
    press(view);
    view.webContents.openHandler!({ url: `chrome-extension://${PROBE}/options.html`, disposition: 'foreground-tab' });
    const event = { url: 'file:///etc/passwd', preventDefault: vi.fn() };
    view.webContents.emit('will-navigate', event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(h.store.all()).toHaveLength(tabs);
    expect(h.logged).toEqual([
      { kind: 'popupRefused', id: PROBE, reason: 'activation', scheme: 'https:' },
      { kind: 'popupRefused', id: PROBE, reason: 'activation', scheme: 'https:' },
      { kind: 'popupRefused', id: PROBE, reason: 'scheme', scheme: 'chrome-extension:' },
      { kind: 'popupRefused', id: PROBE, reason: 'scheme', scheme: 'file:' },
    ]);
  });

  it('lets the popup move between its own pages', () => {
    const h = harness();
    const entry = h.placedTab();
    h.popups.open(entry, PROBE, ANCHOR);
    const event = { url: `chrome-extension://${PROBE}/page2.html`, preventDefault: vi.fn() };
    h.views[0]!.webContents.emit('will-navigate', event);
    const elsewhere = { url: `chrome-extension://${OTHER}/page.html`, preventDefault: vi.fn() };
    h.views[0]!.webContents.emit('will-navigate', elsewhere);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(elsewhere.preventDefault).toHaveBeenCalled();
  });
});
