import type { WebContentsView } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { DEFAULT_PARTITION } from '@shared/browser/tab';
import type { CommandName } from '@shared/ipc/schema';

vi.mock('electron', () => ({ ipcMain: { handle: () => {} }, BrowserWindow: { fromWebContents: () => null } }));

const { CommandFailure } = await import('../ipc/router');
const { TabStore } = await import('./tabs');
const { registerBrowserHandlers } = await import('./register');

const A = 'App-A' as AppSessionId;

function setup() {
  const store = new TabStore({
    emit: () => {},
    createView: () => ({ webContents: { loadURL: () => Promise.resolve(), close: () => {}, isDestroyed: () => false } }) as unknown as WebContentsView,
    resolvePartition: () => DEFAULT_PARTITION,
    schedule: () => {},
  });
  const handlers = new Map<CommandName, (input: unknown, context?: unknown) => unknown>();
  registerBrowserHandlers({
    store,
    profiles: () => [{ profileDir: 'Profile 1', name: 'Work', partition: 'persist:maws-chrome-Profile 1', importedAt: 't' }],
    register: (name, handler) => void handlers.set(name, handler as (input: unknown) => unknown),
  });
  const call = (name: CommandName, input: unknown) => handlers.get(name)!(input, { sender: {} });
  return { store, handlers, call };
}

describe('browser.* handlers in main (E4a Interfaces "IPC")', () => {
  it('registers the tab store\'s commands and the profile list', () => {
    expect([...setup().handlers.keys()]).toEqual(['browser.tabs.list', 'browser.tabs.open', 'browser.tabs.close', 'browser.tabs.select', 'browser.profiles.list']);
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
