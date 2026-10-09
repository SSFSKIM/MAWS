import type { WebContentsView } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { DEFAULT_PARTITION } from '@shared/browser/tab';
import type { CommandName } from '@shared/ipc/schema';

vi.mock('electron', () => ({ ipcMain: { handle: () => {} }, BrowserWindow: { fromWebContents: () => null }, WebContentsView: class {} }));

const { CommandFailure } = await import('../ipc/router');
const { TabStore } = await import('./tabs');
const { mergeSuggestions, registerBrowserHandlers } = await import('./register');
const { ViewManager } = await import('./view');
const { Navigator } = await import('./navigation');

const A = 'App-A' as AppSessionId;

type Views = Parameters<typeof registerBrowserHandlers>[0]['views'];

function setup(makeViews?: (store: InstanceType<typeof TabStore>) => Views) {
  const store = new TabStore({
    emit: () => {},
    createView: () => ({ webContents: { loadURL: () => Promise.resolve(), close: () => {}, isDestroyed: () => false } }) as unknown as WebContentsView,
    resolvePartition: () => DEFAULT_PARTITION,
    schedule: () => {},
  });
  const handlers = new Map<CommandName, (input: unknown, context?: unknown) => unknown>();
  const views = { place: vi.fn(), cover: vi.fn(async () => {}) };
  const navigator = { navigate: vi.fn(() => true), zoom: vi.fn<(tabId: string) => number>(() => 1.1), find: vi.fn(), dismiss: vi.fn(), devtools: vi.fn() };
  const history = { suggest: vi.fn(() => [{ url: 'https://a.test/', title: 'A' }]) };
  const bookmarks = { suggest: vi.fn((): { url: string; title: string | null }[] => []) }; // cua #90
  const downloads = { reveal: vi.fn(() => ({ revealed: true })) };
  registerBrowserHandlers({
    store,
    views: makeViews?.(store) ?? views,
    navigator,
    downloads,
    history,
    bookmarks,
    profiles: () => [{ profileDir: 'Profile 1', name: 'Work', partition: 'persist:maws-chrome-Profile 1', importedAt: 't' }],
    register: (name, handler) => void handlers.set(name, handler as (input: unknown) => unknown),
  });
  const call = (name: CommandName, input: unknown) => handlers.get(name)!(input, { sender: {} });
  return { store, views, navigator, downloads, history, bookmarks, handlers, call };
}

// What a handler threw, as the router's CommandFailure (undefined when it did not throw one).
function failure(fn: () => unknown): InstanceType<typeof CommandFailure> | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof CommandFailure) return error;
    throw error;
  }
  return undefined;
}

describe('browser.* handlers in main (E4a Interfaces "IPC")', () => {
  it('registers the tab store\'s commands and the profile list', () => {
    expect([...setup().handlers.keys()]).toEqual([
      'browser.tabs.list', 'browser.tabs.open', 'browser.tabs.close', 'browser.tabs.select',
      'browser.tabs.navigate', 'browser.tabs.zoom', 'browser.tabs.find', 'browser.tabs.dismiss', 'browser.tabs.devtools', 'browser.tabs.revealDownload',
      'browser.history.suggest',
      'browser.profiles.list', 'browser.view.place', 'browser.view.cover',
      'browser.control.handBack',
    ]);
  });

  it('browser.control.handBack returns any tab to idle; an unknown tab answers invalid_input', () => {
    const { call, store } = setup();
    const { tab } = call('browser.tabs.open', { appSessionId: A, url: null, select: true }) as { tab: { tabId: string } };
    store.setControl(tab.tabId, 'human');
    expect(call('browser.control.handBack', { tabId: tab.tabId })).toBeUndefined();
    expect(store.require(tab.tabId).tab.control).toBe('idle');
    const thrown = failure(() => call('browser.control.handBack', { tabId: 'b_ffffffffffff' }));
    expect(thrown?.error).toMatchObject({ code: 'invalid_input', message: 'unknown browser tab' });
  });

  it('hands navigate, zoom, find, dismiss and devtools to the navigator for a known tab', () => {
    const { call, navigator } = setup();
    const { tab } = call('browser.tabs.open', { appSessionId: A, url: null, select: true }) as { tab: { tabId: string } };
    const { tabId } = tab;
    expect(call('browser.tabs.navigate', { tabId, to: 'back' })).toEqual({ accepted: true });
    expect(navigator.navigate).toHaveBeenCalledWith(tabId, 'back');
    expect(call('browser.tabs.zoom', { tabId, action: 'in' })).toEqual({ zoom: 1.1 });
    call('browser.tabs.find', { tabId, text: 'needle', findNext: true });
    expect(navigator.find).toHaveBeenCalledWith(tabId, { text: 'needle', findNext: true });
    call('browser.tabs.dismiss', { tabId, notice: 'popups' });
    expect(navigator.dismiss).toHaveBeenCalledWith(tabId, 'popups');
    call('browser.tabs.devtools', { tabId });
    expect(navigator.devtools).toHaveBeenCalledWith(tabId);
  });

  it('reveals a tab\'s finished download through the downloads', () => {
    const { call, downloads } = setup();
    const { tab } = call('browser.tabs.open', { appSessionId: A, url: null, select: true }) as { tab: { tabId: string } };
    expect(call('browser.tabs.revealDownload', { tabId: tab.tabId })).toEqual({ revealed: true });
    expect(downloads.reveal).toHaveBeenCalledWith(tab.tabId);
  });

  it('each navigator command for an unknown tab answers invalid_input (the real navigator over the store)', () => {
    const store = new TabStore({ emit: () => {}, createView: () => ({}) as never, resolvePartition: () => DEFAULT_PARTITION, schedule: () => {} });
    const navigator = new Navigator({ store, history: { visit: vi.fn(), setTitle: vi.fn() }, favicons: { resolve: vi.fn() }, emit: () => {}, seam: { line: vi.fn(), openExternal: vi.fn() } });
    const handlers = new Map<string, (input: unknown, context: unknown) => unknown>();
    registerBrowserHandlers({
      store,
      views: { place: vi.fn(), cover: vi.fn(async () => {}) },
      navigator,
      downloads: { reveal: vi.fn() },
      history: { suggest: vi.fn(() => []) },
      bookmarks: { suggest: vi.fn(() => []) },
      profiles: () => [],
      register: (name, handler) => void handlers.set(name, handler as (input: unknown, context: unknown) => unknown),
    });
    const tabId = 'b_ffffffffffff';
    const inputs: [string, unknown][] = [
      ['browser.tabs.navigate', { tabId, to: 'reload' }],
      ['browser.tabs.zoom', { tabId, action: 'in' }],
      ['browser.tabs.find', { tabId, text: 'x' }],
      ['browser.tabs.dismiss', { tabId, notice: 'popups' }],
      ['browser.tabs.devtools', { tabId }],
    ];
    for (const [name, input] of inputs) {
      const thrown = failure(() => handlers.get(name)!(input, { sender: {} }));
      expect(thrown, name).toBeInstanceOf(CommandFailure);
      expect(thrown?.error, name).toMatchObject({ code: 'invalid_input', message: 'unknown browser tab' });
    }
  });

  it('suggests from the history, and nothing when the index fails', () => {
    const { call, history } = setup();
    expect(call('browser.history.suggest', { partition: DEFAULT_PARTITION, query: 'a' })).toEqual({ suggestions: [{ url: 'https://a.test/', title: 'A', kind: 'history' }] });
    expect(history.suggest).toHaveBeenCalledWith(DEFAULT_PARTITION, 'a');
    history.suggest.mockImplementation(() => {
      throw new Error('index unavailable: busy');
    });
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(call('browser.history.suggest', { partition: DEFAULT_PARTITION, query: 'a' })).toEqual({ suggestions: [] });
    } finally {
      warned.mockRestore();
    }
  });

  // cua #90 start: bookmarks beside history
  it('suggests the partition’s bookmarks first (at most 3), then its history, and one failing store leaves the other', () => {
    const { call, history, bookmarks } = setup();
    const P = 'persist:maws-chrome-Default';
    bookmarks.suggest.mockReturnValue([{ url: 'https://f1.test/', title: 'F1' }]);
    expect(call('browser.history.suggest', { partition: P, query: 'f1' })).toEqual({
      suggestions: [{ url: 'https://f1.test/', title: 'F1', kind: 'bookmark' }, { url: 'https://a.test/', title: 'A', kind: 'history' }],
    });
    expect(bookmarks.suggest).toHaveBeenCalledWith(P, 'f1', 3);
    expect(history.suggest).toHaveBeenCalledWith(P, 'f1');
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      bookmarks.suggest.mockImplementation(() => {
        throw new Error('index unavailable: busy');
      });
      expect(call('browser.history.suggest', { partition: P, query: 'a' })).toEqual({ suggestions: [{ url: 'https://a.test/', title: 'A', kind: 'history' }] });
      bookmarks.suggest.mockReturnValue([{ url: 'https://f1.test/', title: 'F1' }]);
      history.suggest.mockImplementation(() => {
        throw new Error('index unavailable: busy');
      });
      expect(call('browser.history.suggest', { partition: P, query: 'f' })).toEqual({ suggestions: [{ url: 'https://f1.test/', title: 'F1', kind: 'bookmark' }] });
    } finally {
      warned.mockRestore();
    }
  });

  describe('mergeSuggestions', () => {
    const rows = (prefix: string, n: number) => Array.from({ length: n }, (_, k) => ({ url: `https://${prefix}${k}.test/`, title: `${prefix}${k}` }));

    it('puts at most 3 bookmarks above the history rows, 8 in all', () => {
      const merged = mergeSuggestions(rows('b', 5), rows('h', 10));
      expect(merged.map((row) => [row.kind, row.title])).toEqual([
        ['bookmark', 'b0'], ['bookmark', 'b1'], ['bookmark', 'b2'],
        ['history', 'h0'], ['history', 'h1'], ['history', 'h2'], ['history', 'h3'], ['history', 'h4'],
      ]);
    });

    it('shows a bookmarked URL once, as the bookmark, and lets history fill the rows bookmarks leave', () => {
      const history = [{ url: 'https://same.test/', title: 'Same page (history)' }, ...rows('h', 9)];
      const merged = mergeSuggestions([{ url: 'https://same.test/', title: 'Same' }], history);
      expect(merged).toHaveLength(8);
      expect(merged.filter((row) => row.url === 'https://same.test/')).toEqual([{ url: 'https://same.test/', title: 'Same', kind: 'bookmark' }]);
      expect(merged.slice(1).every((row) => row.kind === 'history')).toBe(true);
    });

    it('answers history alone when there are no bookmarks, unchanged but for its kind', () => {
      expect(mergeSuggestions([], rows('h', 2))).toEqual(rows('h', 2).map((row) => ({ ...row, kind: 'history' })));
    });
  });
  // cua #90 end

  it('hands placement and cover to the view manager with the sender, without waiting on the placeholders', () => {
    const { views, handlers } = setup();
    const sender = {};
    const place = { tabId: 'b_aaaaaaaaaaaa', paneId: 'p', surface: 'panel', rect: null, claim: true };
    handlers.get('browser.view.place')!(place, { sender });
    expect(views.place).toHaveBeenCalledWith(place, sender);
    expect(handlers.get('browser.view.cover')!({ covered: true }, { sender })).toBeUndefined();
    expect(views.cover).toHaveBeenCalledWith(true, sender);
  });

  it('browser.view.place for an unknown tab answers invalid_input', () => {
    const { call } = setup((store) => new ViewManager({ store, emit: () => {}, windowOf: () => ({}) as never, focusEmulation: 'off' }));
    const thrown = failure(() => call('browser.view.place', { tabId: 'b_ffffffffffff', paneId: 'p', surface: 'panel', rect: null, claim: false }));
    expect(thrown?.error).toMatchObject({ code: 'invalid_input', message: 'unknown browser tab' });
  });

  it('a cover that fails is logged, never an unhandled rejection', async () => {
    const failing = new Error('capture service gone');
    const { handlers } = setup(() => ({ place: vi.fn(), cover: vi.fn(async () => Promise.reject(failing)) }));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      handlers.get('browser.view.cover')!({ covered: true }, { sender: {} });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(logged).toHaveBeenCalledWith('[browser] the cover failed:', failing);
    } finally {
      logged.mockRestore();
    }
  });

  it('opens, lists, selects and closes through the store', () => {
    const { call } = setup();
    const { tab } = call('browser.tabs.open', { appSessionId: A, url: null, select: false }) as { tab: { tabId: string } };
    call('browser.tabs.select', { appSessionId: A, tabId: tab.tabId });
    expect(call('browser.tabs.list', { appSessionId: A })).toMatchObject({ tabs: [{ tabId: tab.tabId }], selected: { [A]: tab.tabId } });
    call('browser.tabs.close', { tabId: tab.tabId });
    expect(call('browser.tabs.list', {})).toEqual({ tabs: [], selected: { [A]: null } });
  });

  it('answers an unknown tab as invalid_input ("unknown browser tab")', () => {
    const { call } = setup();
    const thrown = failure(() => call('browser.tabs.close', { tabId: 'b_ffffffffffff' }));
    expect(thrown).toBeInstanceOf(CommandFailure);
    expect(thrown?.error).toMatchObject({ code: 'invalid_input', message: 'unknown browser tab' });
  });

  it('lists the imported profiles by directory and name', () => {
    expect(setup().call('browser.profiles.list', undefined)).toEqual({ profiles: [{ profileDir: 'Profile 1', name: 'Work' }] });
  });
});
