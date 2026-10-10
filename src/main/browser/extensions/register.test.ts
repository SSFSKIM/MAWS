import type { WebContentsView } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandName, EventName } from '@shared/ipc/schema';

vi.mock('electron', () => ({ ipcMain: { handle: () => {} }, WebContentsView: class {}, Menu: {} }));

const { CommandFailure } = await import('../../ipc/router');
const { TabStore } = await import('../tabs');
const { NativeMenus } = await import('../bookmarks/menu');
const { registerExtensionHandlers } = await import('./register');
const { UnknownExtensionError } = await import('./pages');

const A = 'App-A' as AppSessionId;
const PART = 'persist:maws-chrome-Default';
const PROBE = 'nenbjdahllkkbfanbpfmmdacjencdfpg';
const INERT = 'ofmpefonpiifpjlopbcacdiahhnegimn';
const RECT = { x: 600, y: 40, width: 24, height: 24 };

function setup() {
  const emitted: { name: EventName; payload: unknown }[] = [];
  const store = new TabStore({
    emit: () => {},
    createView: () => ({ webContents: { loadURL: () => Promise.resolve(), close: () => {}, isDestroyed: () => false } }) as unknown as WebContentsView,
    resolvePartition: () => PART,
    schedule: () => {},
  });
  const probe = { extensionId: PROBE, name: 'MAWS probe extension', title: 'MAWS probe', hasPopup: true, hasOptions: true, popupUrl: 'x', optionsUrl: 'y', iconPath: null, path: '/e' };
  const inert = { ...probe, extensionId: INERT, name: 'Inert', title: 'Inert', hasPopup: false, hasOptions: false, popupUrl: null, optionsUrl: null };
  const actions = {
    list: vi.fn(async () => [{ extensionId: PROBE, name: 'MAWS probe extension', title: 'MAWS probe', icon: null, hasPopup: true, hasOptions: true }]),
    find: vi.fn((partition: string, id: string) => (partition === PART ? ([probe, inert].find((a) => a.extensionId === id) ?? null) : null)),
    entries: vi.fn(() => [probe, inert]),
  };
  const popups = { open: vi.fn() };
  const optionsTab = { tabId: 'b_00000000000f' };
  const pages = {
    openOptions: vi.fn((tabId: string, id: string) => {
      store.require(tabId);
      if (id !== PROBE) throw new UnknownExtensionError(id);
      return optionsTab as never;
    }),
  };
  const menus = new NativeMenus({ e2e: true });
  const window = { id: 3 };
  const handlers = new Map<CommandName, (input: unknown, context?: unknown) => unknown>();
  registerExtensionHandlers({
    store, actions, popups, pages, menus,
    windowOf: () => window as never,
    emit: (name, payload) => void emitted.push({ name, payload }),
    register: (name, handler) => void handlers.set(name, handler as (input: unknown) => unknown),
  });
  const call = (name: CommandName, input: unknown) => handlers.get(name)!(input, { sender: {} });
  const tabId = store.open({ appSessionId: A, url: 'https://a.test/', select: true }).tab.tabId;
  const reveals = () => emitted.filter((e) => e.name === 'browser.extensions.reveal').map((e) => e.payload);
  return { store, actions, popups, pages, menus, call, tabId, reveals, optionsTab };
}

const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof CommandFailure ? error.error : error;
  }
  return null;
};

describe('browser.extensions.* (cua #90)', () => {
  it('cua #103: a failed-background action cannot open its declared popup through IPC', () => {
    const s = setup();
    const loaded = s.actions.find(PART, PROBE)!;
    s.actions.find.mockReturnValueOnce({ ...loaded, inert: 'Loaded · background failed' });
    s.call('browser.extensions.action.click', { tabId: s.tabId, extensionId: PROBE, anchor: RECT });
    expect(s.popups.open).not.toHaveBeenCalled();
  });

  it('lists the partition\'s actions', async () => {
    const s = setup();
    expect(await s.call('browser.extensions.actions', { partition: PART })).toEqual({ actions: [expect.objectContaining({ extensionId: PROBE })] });
  });

  it('a click opens the action\'s popup for the tab under its button; an inert action does nothing', () => {
    const s = setup();
    s.call('browser.extensions.action.click', { tabId: s.tabId, extensionId: PROBE, anchor: RECT });
    expect(s.popups.open).toHaveBeenCalledWith(s.store.require(s.tabId), PROBE, RECT);
    s.call('browser.extensions.action.click', { tabId: s.tabId, extensionId: INERT, anchor: RECT });
    expect(s.popups.open).toHaveBeenCalledTimes(1);
  });

  it('Options opens the options tab and tells the chrome to show it', () => {
    const s = setup();
    s.call('browser.extensions.action.options', { tabId: s.tabId, extensionId: PROBE });
    expect(s.pages.openOptions).toHaveBeenCalledWith(s.tabId, PROBE);
    expect(s.reveals()).toEqual([{ tabId: s.tabId, show: { kind: 'tab', tab: s.optionsTab } }]);
  });

  it('tells the chrome nothing when the options tab could not open (the cap had no room; its notice said so)', () => {
    const s = setup();
    s.pages.openOptions.mockImplementationOnce(() => null as never);
    s.call('browser.extensions.action.options', { tabId: s.tabId, extensionId: PROBE });
    expect(s.reveals()).toEqual([]);
  });

  it('answers invalid_input for an unknown tab or an extension the tab\'s partition has not loaded', () => {
    const s = setup();
    expect(refusal(() => s.call('browser.extensions.action.click', { tabId: 'b_ffffffffffff', extensionId: PROBE, anchor: RECT }))).toMatchObject({ code: 'invalid_input' });
    expect(refusal(() => s.call('browser.extensions.action.click', { tabId: s.tabId, extensionId: 'cccccccccccccccccccccccccccccccc', anchor: RECT }))).toMatchObject({ code: 'invalid_input' });
    expect(refusal(() => s.call('browser.extensions.action.options', { tabId: s.tabId, extensionId: INERT }))).toMatchObject({ code: 'invalid_input' });
    expect(refusal(() => s.call('browser.extensions.puzzle', { tabId: 'b_ffffffffffff', anchor: RECT }))).toMatchObject({ code: 'invalid_input' });
  });

  it('the puzzle menu pops on the sender\'s window; its items act for the tab, the popup anchored at the puzzle button', () => {
    const s = setup();
    s.call('browser.extensions.puzzle', { tabId: s.tabId, anchor: RECT });
    expect(s.menus.seam.last()!.map((item) => ('id' in item ? item.id : '-'))).toEqual([`action:${PROBE}`, `action:${INERT}`, '-', 'options', '-', 'manage']);
    expect(s.menus.seam.pick([`action:${PROBE}`])).toBe(true);
    expect(s.popups.open).toHaveBeenCalledWith(s.store.require(s.tabId), PROBE, RECT);
    s.call('browser.extensions.puzzle', { tabId: s.tabId, anchor: RECT });
    s.menus.seam.pick(['options', `options:${PROBE}`]);
    s.call('browser.extensions.puzzle', { tabId: s.tabId, anchor: RECT });
    s.menus.seam.pick(['manage']);
    expect(s.reveals()).toEqual([{ tabId: s.tabId, show: { kind: 'tab', tab: s.optionsTab } }, { tabId: s.tabId, show: { kind: 'settings' } }]);
  });

  it('an action\'s context menu offers Options; a choice after the tab closed does nothing', () => {
    const s = setup();
    s.call('browser.extensions.action.menu', { tabId: s.tabId, extensionId: PROBE, anchor: { x: 10, y: 20 } });
    expect(s.menus.seam.last()!.map((item) => ('id' in item ? item.id : '-'))).toEqual(['name', '-', `options:${PROBE}`, 'manage']);
    s.store.close(s.tabId);
    expect(s.menus.seam.pick([`options:${PROBE}`])).toBe(true);
    expect(s.reveals()).toEqual([]);
  });
});
