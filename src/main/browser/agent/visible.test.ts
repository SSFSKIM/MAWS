import { EventEmitter } from 'node:events';
import type { BrowserWindow, WebContents, WebContentsView } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { DEFAULT_PARTITION } from '@shared/browser/tab';
import { BROWSER_AGENT_IDLE_MS } from '@shared/maws/browser';
import type { EventName, EventPayload } from '@shared/ipc/schema';

vi.mock('electron', () => ({
  WebContentsView: class {
    constructor(readonly options?: unknown) {}
  },
}));

const { TabStore } = await import('../tabs');
const { ViewManager } = await import('../view');
const { TabControls } = await import('./control');
const { PARKED_BOUNDS, Parking } = await import('./visible');

// Parking (E4c Design §9; Decision Log 7, 36, 43; findings-e4c-released.txt): an unplaced tab the agent holds or has a
// request on is given a working viewport, out of any window, at PARKED_BOUNDS, and only a size: its native visibility
// stays E4a's. Over E4a's real TabStore and ViewManager with fake views and windows (view.test.ts's shapes).

const A = 'App-A' as AppSessionId;
type Rect = { x: number; y: number; width: number; height: number };
const R: Rect = { x: 10, y: 20, width: 300, height: 200 };

class FakeView {
  bounds: Rect = { x: 0, y: 0, width: 0, height: 0 };
  visible = true;
  readonly webContents = { loadURL: () => Promise.resolve(), close: () => {}, isDestroyed: () => false, setBackgroundThrottling: () => {} };
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

class FakeWindow extends EventEmitter {
  static ids = 0;
  readonly id = ++FakeWindow.ids;
  readonly children = new Set<FakeView>();
  readonly contentView = {
    addChildView: (view: FakeView) => void this.children.add(view),
    removeChildView: (view: FakeView) => void this.children.delete(view),
  };
  readonly webContents = Object.assign(new EventEmitter(), { focus: () => {}, isDestroyed: () => false, getURL: () => 'file:///app/index.html' });
  isDestroyed = () => false;
  isMinimized = () => false;
  isVisible = () => true;
}

function harness({ focus = 'off' }: { focus?: 'on' | 'off' } = {}) {
  vi.useFakeTimers({ now: Date.parse('2026-10-07T09:00:00.000Z') });
  const emit = (() => undefined) as <N extends EventName>(name: N, payload: EventPayload<N>) => unknown;
  const views: FakeView[] = [];
  const store = new TabStore({
    emit,
    createView: () => {
      const view = new FakeView();
      views.push(view);
      return view as unknown as WebContentsView;
    },
    resolvePartition: () => DEFAULT_PARTITION,
    schedule: () => {},
    now: Date.now,
  });
  const win = new FakeWindow();
  const sender = {} as WebContents;
  const focusCalls: [string, boolean][] = [];
  const manager = new ViewManager({
    store,
    emit,
    windowOf: (s) => (s === sender ? (win as unknown as BrowserWindow) : null),
    focusEmulation: focus,
    setFocusEmulation: (entry, enabled) => void focusCalls.push([entry.tab.tabId, enabled]),
  });
  const controls = new TabControls({ store });
  const leased = new Set<string>();
  const leaseListeners = new Set<(tabId: string) => void>();
  const leases = {
    holds: (tabId: string) => leased.has(tabId),
    onChange: (listener: (tabId: string) => void) => (leaseListeners.add(listener), () => void leaseListeners.delete(listener)),
  };
  const lease = (tabId: string, held: boolean) => {
    if (held) leased.add(tabId);
    else leased.delete(tabId);
    for (const listener of [...leaseListeners]) listener(tabId);
  };
  const parking = new Parking({ store, views: manager, controls, leases });
  const loaded = () => {
    const { tabId } = store.open({ appSessionId: A, url: 'https://a.test/', select: true }).tab;
    store.navigationCommitted(tabId, { url: 'https://a.test/', canGoBack: false, canGoForward: false });
    return { entry: store.entry(tabId)!, view: views.at(-1)! };
  };
  const place = (tabId: string, rect: Rect | null, claim = true) => manager.place({ tabId, paneId: 'p1', surface: 'panel', rect, claim }, sender);
  return { store, manager, controls, parking, win, loaded, place, focusCalls, lease };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('parking by lease (the in-app browser spec, "Parking and placement")', () => {
  it('an unplaced tab a cua connection holds a lease on is parked, a pane\'s claim supersedes it, and the release unparks it', () => {
    const h = harness();
    const { entry, view } = h.loaded();
    h.lease(entry.tab.tabId, true);
    expect([h.parking.parked(entry), view.bounds]).toEqual([true, PARKED_BOUNDS]);
    h.place(entry.tab.tabId, R);
    expect(h.parking.parked(entry)).toBe(false);
    expect(view.bounds).toEqual(R);
    h.place(entry.tab.tabId, null);
    expect(h.parking.parked(entry)).toBe(true); // released by the pane while still leased: parked again
    h.lease(entry.tab.tabId, false);
    expect(h.parking.parked(entry)).toBe(false);
  });
});

describe('parking an unplaced tab (Design §9; Decision Log 36, 43)', () => {
  it('a never-placed tab with a request pending gets a working size, out of any window, and stays hidden as E4a keeps it', () => {
    const h = harness();
    const { entry, view } = h.loaded();
    expect(view.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 }); // E4a's view as created
    h.controls.requestPending(entry, 1);
    expect(view.bounds).toEqual(PARKED_BOUNDS);
    expect(view.visible).toBe(false);
    expect(entry.visible).toBe(false);
    expect(h.win.children.size).toBe(0);
    expect(h.parking.parked(entry)).toBe(true);
  });

  it('a released tab (its view left hidden in its window) leaves the window when parked, and its bookkeeping follows', () => {
    const h = harness();
    const { entry, view } = h.loaded();
    h.place(entry.tab.tabId, R);
    h.place(entry.tab.tabId, null); // the pane lets go: E4a hides the view where it is
    expect(h.win.children.has(view)).toBe(true);
    h.controls.markActing(entry);
    expect(h.win.children.has(view)).toBe(false);
    expect(entry.host).toBeNull();
    expect(view.bounds).toEqual(PARKED_BOUNDS);
    expect(view.visible).toBe(false);
  });

  it('a placed tab is never parked, whatever the agent does; releasing it while the agent holds it parks it', () => {
    const h = harness();
    const { entry, view } = h.loaded();
    h.place(entry.tab.tabId, R);
    h.controls.requestPending(entry, 1);
    h.controls.markActing(entry);
    expect(view.bounds).toEqual(R);
    expect(view.visible).toBe(true);
    expect(h.parking.parked(entry)).toBe(false);
    h.place(entry.tab.tabId, null);
    expect(h.parking.parked(entry)).toBe(true);
    expect(view.bounds).toEqual(PARKED_BOUNDS);
  });

  it('a pane claiming a parked tab supersedes the parking: the view goes to the pane\'s rect and shows', () => {
    const h = harness();
    const { entry, view } = h.loaded();
    h.controls.markActing(entry);
    expect(h.parking.parked(entry)).toBe(true);
    h.place(entry.tab.tabId, R);
    expect(h.parking.parked(entry)).toBe(false);
    expect(h.win.children.has(view)).toBe(true);
    expect(view.bounds).toEqual(R);
    expect(view.visible).toBe(true);
    expect(entry.tab.placedIn).toEqual({ paneId: 'p1', surface: 'panel' });
  });

  it('unparks when the agent lets go with nothing pending, and parks again for the next request', () => {
    const h = harness();
    const { entry, view } = h.loaded();
    h.controls.requestPending(entry, 1);
    h.controls.markActing(entry);
    h.controls.actionEnded(entry);
    h.controls.requestPending(entry, -1);
    expect(h.parking.parked(entry)).toBe(true); // still the agent's for 10 s
    vi.advanceTimersByTime(BROWSER_AGENT_IDLE_MS);
    expect(entry.tab.control).toBe('idle');
    expect(h.parking.parked(entry)).toBe(false);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 }); // as if elsewhere resized: the next park sizes it again
    h.controls.requestPending(entry, 1);
    expect(view.bounds).toEqual(PARKED_BOUNDS);
  });

  it('a tab without a view is not parked; its new view is, when the agent still holds it', () => {
    const h = harness();
    const { entry } = h.loaded();
    h.controls.requestPending(entry, 1);
    h.store.suspend(entry.tab.tabId);
    expect(h.parking.parked(entry)).toBe(false);
    h.store.load(entry.tab.tabId, 'https://a.test/');
    expect(h.parking.parked(entry)).toBe(true);
    expect(entry.view!.getBounds()).toEqual(PARKED_BOUNDS);
  });

  it('leaves E4a\'s focus emulation alone: a parked view is never shown in E4a\'s sense, so nothing is sent', () => {
    const h = harness({ focus: 'on' });
    const { entry } = h.loaded();
    h.controls.markActing(entry);
    expect(h.parking.parked(entry)).toBe(true);
    expect(h.focusCalls).toEqual([]);
  });
});
