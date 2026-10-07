import type { WebContentsView } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { DEFAULT_PARTITION } from '@shared/browser/tab';
import type { CommandName } from '@shared/ipc/schema';

vi.mock('electron', () => ({ ipcMain: { handle: () => {} }, BrowserWindow: { fromWebContents: () => null }, WebContentsView: class {} }));

const { CommandFailure } = await import('../ipc/router');
const { TabStore } = await import('./tabs');
const { registerBrowserHandlers } = await import('./register');
const { ViewManager } = await import('./view');

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
  registerBrowserHandlers({
    store,
    views: makeViews?.(store) ?? views,
    navigator,
    history,
    profiles: () => [{ profileDir: 'Profile 1', name: 'Work', partition: 'persist:maws-chrome-Profile 1', importedAt: 't' }],
    register: (name, handler) => void handlers.set(name, handler as (input: unknown) => unknown),
  });
  const call = (name: CommandName, input: unknown) => handlers.get(name)!(input, { sender: {} });
  return { store, views, navigator, history, handlers, call };
}

describe('browser.* handlers in main (E4a Interfaces "IPC")', () => {
  it('registers the tab store\'s commands and the profile list', () => {
    expect([...setup().handlers.keys()]).toEqual([
      'browser.tabs.list', 'browser.tabs.open', 'browser.tabs.close', 'browser.tabs.select',
      'browser.tabs.navigate', 'browser.tabs.zoom', 'browser.tabs.find', 'browser.tabs.dismiss', 'browser.tabs.devtools', 'browser.history.suggest',
      'browser.profiles.list', 'browser.view.place', 'browser.view.cover',
    ]);
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

  it('a navigator command for an unknown tab answers invalid_input', () => {
    const real = new TabStore({ emit: () => {}, createView: () => ({}) as never, resolvePartition: () => DEFAULT_PARTITION, schedule: () => {} });
    const { call, navigator } = setup();
    navigator.zoom.mockImplementation((tabId: string) => real.require(tabId).tab.zoom);
    let thrown: unknown;
    try {
      call('browser.tabs.zoom', { tabId: 'b_ffffffffffff', action: 'in' });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as InstanceType<typeof CommandFailure>).error).toMatchObject({ code: 'invalid_input', message: 'unknown browser tab' });
  });

  it('suggests from the history, and nothing when the index fails', () => {
    const { call, history } = setup();
    expect(call('browser.history.suggest', { partition: DEFAULT_PARTITION, query: 'a' })).toEqual({ suggestions: [{ url: 'https://a.test/', title: 'A' }] });
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
    let thrown: unknown;
    try {
      call('browser.view.place', { tabId: 'b_ffffffffffff', paneId: 'p', surface: 'panel', rect: null, claim: false });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as InstanceType<typeof CommandFailure>).error).toMatchObject({ code: 'invalid_input', message: 'unknown browser tab' });
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
    let thrown: unknown;
    try {
      call('browser.tabs.close', { tabId: 'b_ffffffffffff' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CommandFailure);
    expect((thrown as InstanceType<typeof CommandFailure>).error).toMatchObject({ code: 'invalid_input', message: 'unknown browser tab' });
  });

  it('lists the imported profiles by directory and name', () => {
    expect(setup().call('browser.profiles.list', undefined)).toEqual({ profiles: [{ profileDir: 'Profile 1', name: 'Work' }] });
  });
});
