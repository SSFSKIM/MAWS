// cua #90: the extensions action bar (its spec's "The extensions action bar"): the partition's actions right of the
// address field with their icons and titles, a click asking main for the popup under the button, the pressed state
// while main says it is open, an inert action, the action's native menu, the fold into the puzzle button when the
// address field would drop under 160 px, the list read again when main says it changed, and a menu's choice carried on
// by the chrome (the options tab shown in a main tab, Settings › Browser opened); an internal tab's address field.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionAction } from '@shared/browser/extensions';
import { profilePartition, type BrowserTab } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import { browserTab, T1, T2 } from '../../../test-support/browser';
import { RECORD } from '../../../test-support/browser-import';
import { installFakeMain, ok } from '../../../test-support/code';
import { useLayout } from '../../../stores/layout';
import { browserImport, connectBrowserImport, resetBrowserImport } from '../import/store';
import { connectBrowser, resetBrowser } from '../store';
import { Chrome } from './Chrome';

const A = 'app-a' as AppSessionId;
const WORK = profilePartition('Profile 1');
const PROBE = 'nenbjdahllkkbfanbpfmmdacjencdfpg';
const PLAIN = 'ofmpefonpiifpjlopbcacdiahhnegimn';
const ICON = 'data:image/png;base64,iVBORw0KGgo=';

let main: ReturnType<typeof installFakeMain>;
let actions: ExtensionAction[];
let disconnect: () => void;
let addressWidth: number;

beforeEach(() => {
  resetBrowser();
  resetBrowserImport();
  actions = [
    { extensionId: PROBE, name: 'MAWS probe extension', title: 'MAWS probe', icon: null, hasPopup: true, hasOptions: true },
    { extensionId: PLAIN, name: 'Plain', title: 'Plain', icon: ICON, hasPopup: false, hasOptions: false },
  ];
  main = installFakeMain((name) => {
    switch (name) {
      case 'browser.tabs.list':
        return ok({ tabs: [], selected: {} });
      case 'browser.profiles.list':
        return ok({ profiles: [] });
      case 'browser.import.list':
        return ok({ profiles: [{ ...RECORD, profileDir: 'Profile 1', partition: WORK }], fileBroken: false, running: null });
      case 'browser.extensions.actions':
        return ok({ actions });
      default:
        return ok();
    }
  });
  browserImport.setState({ records: [{ ...RECORD, profileDir: 'Profile 1', partition: WORK }], listed: true });
  disconnect = connectBrowser(main.bridge);
  addressWidth = 400;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.matches('[data-address-box]')) return DOMRect.fromRect({ x: 100, y: 30, width: addressWidth, height: 36 });
    return DOMRect.fromRect({ x: 600.4, y: 36.2, width: 24, height: 24 });
  });
});
afterEach(() => {
  disconnect();
  cleanup();
  vi.restoreAllMocks();
});

function show(tab: BrowserTab = browserTab(T1, A, { partition: WORK }), surface: 'panel' | 'main' = 'main') {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queries}>
      <Chrome appSessionId={A} surface={surface} tab={tab} tabs={[tab]} owns />
    </QueryClientProvider>,
  );
  return { ...view, queries };
}
const bar = () => document.querySelector<HTMLElement>('[data-extension-actions]');
const action = (id: string) => document.querySelector<HTMLButtonElement>(`[data-extension-action="${id}"]`)!;
const puzzle = () => document.querySelector<HTMLButtonElement>('[data-extensions-puzzle]');

describe('the extensions action bar', () => {
  it('shows each action right of the address field, its icon or the puzzle piece, its title as the tooltip', async () => {
    show();
    await vi.waitFor(() => expect(bar()).not.toBeNull());
    const row = bar()!.parentElement!;
    const order = [...row.children].map((child) => (child.matches('[data-address-box]') ? 'address' : child === bar() ? 'actions' : child.matches('[data-browser-partition]') ? 'pill' : null)).filter(Boolean);
    expect(order).toEqual(['address', 'actions', 'pill']);
    expect([...bar()!.querySelectorAll('[data-extension-action]')].map((button) => button.getAttribute('data-extension-action'))).toEqual([PROBE, PLAIN]);
    expect(action(PROBE).title).toBe('MAWS probe');
    expect(action(PROBE).querySelector('img')).toBeNull(); // no icon: the puzzle glyph
    expect(action(PLAIN).querySelector('img')!.getAttribute('src')).toBe(ICON);
    expect(main.callsOf('browser.extensions.actions')).toEqual([{ partition: WORK }]);
  });

  it('a click asks main for the popup under the button, which stays pressed while main says it is open', async () => {
    show();
    await vi.waitFor(() => expect(bar()).not.toBeNull());
    fireEvent.click(action(PROBE));
    expect(main.callsOf('browser.extensions.action.click')).toEqual([{ tabId: T1, extensionId: PROBE, anchor: { x: 600, y: 36, width: 24, height: 24 } }]);
    expect(action(PROBE).getAttribute('aria-pressed')).toBe('false');
    act(() => main.emit('browser.extensions.popup', { tabId: T1, extensionId: PROBE }));
    expect(action(PROBE).getAttribute('aria-pressed')).toBe('true');
    act(() => main.emit('browser.extensions.popup', { tabId: T2, extensionId: null })); // another tab's: not ours
    expect(action(PROBE).getAttribute('aria-pressed')).toBe('true');
    act(() => main.emit('browser.extensions.popup', { tabId: T1, extensionId: null }));
    expect(action(PROBE).getAttribute('aria-pressed')).toBe('false');
  });

  it('an extension with no popup here is dimmed and says so, and its click asks nothing', async () => {
    show();
    await vi.waitFor(() => expect(bar()).not.toBeNull());
    expect(action(PLAIN).title).toBe('Plain\nThis extension has no popup here');
    expect(action(PLAIN).getAttribute('aria-disabled')).toBe('true');
    expect(action(PLAIN).querySelector('.opacity-50')).not.toBeNull();
    fireEvent.click(action(PLAIN));
    expect(main.callsOf('browser.extensions.action.click')).toEqual([]);
  });

  it('right-click asks main for the action\'s native menu at the pointer', async () => {
    show();
    await vi.waitFor(() => expect(bar()).not.toBeNull());
    expect(fireEvent.contextMenu(action(PLAIN), { clientX: 610.6, clientY: 50.2 })).toBe(false); // the page's own menu prevented
    expect(main.callsOf('browser.extensions.action.menu')).toEqual([{ tabId: T1, extensionId: PLAIN, anchor: { x: 611, y: 50 } }]);
  });

  it('folds into the puzzle button when the address field would drop under 160 px, and unfolds when it has the room again', async () => {
    addressWidth = 150;
    show();
    await vi.waitFor(() => expect(puzzle()).not.toBeNull());
    expect(bar()).toBeNull();
    fireEvent.click(puzzle()!);
    expect(main.callsOf('browser.extensions.puzzle')).toEqual([{ tabId: T1, anchor: { x: 600, y: 36, width: 24, height: 24 } }]);
    act(() => main.emit('browser.extensions.popup', { tabId: T1, extensionId: PROBE }));
    expect(puzzle()!.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows nothing for the Default partition or a profile with no extension loaded, and reads the list again when main says it changed', async () => {
    const { unmount } = show(browserTab(T1, A));
    await act(async () => {});
    expect(bar()).toBeNull();
    expect(main.callsOf('browser.extensions.actions')).toEqual([]);
    unmount();
    actions = [];
    const { queries } = show();
    const off = connectBrowserImport(main.bridge, queries);
    await vi.waitFor(() => expect(main.callsOf('browser.extensions.actions')).toHaveLength(1));
    expect(bar()).toBeNull();
    actions = [{ extensionId: PROBE, name: 'MAWS probe extension', title: 'MAWS probe', icon: null, hasPopup: true, hasOptions: true }];
    act(() => main.emit('browser.extensions.actions.changed', { partition: profilePartition('Default') })); // another partition's
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(main.callsOf('browser.extensions.actions')).toHaveLength(1);
    act(() => main.emit('browser.extensions.actions.changed', { partition: WORK }));
    await vi.waitFor(() => expect(main.callsOf('browser.extensions.actions')).toHaveLength(2));
    await vi.waitFor(() => expect(bar()).not.toBeNull());
    off();
  });

  it('carries on a menu\'s choice: the options tab main opened becomes the main tab; Manage extensions… opens Settings › Browser', async () => {
    const openTab = vi.spyOn(useLayout.getState(), 'openTab');
    show();
    await vi.waitFor(() => expect(bar()).not.toBeNull());
    const options = browserTab(T2, A, { partition: WORK, url: `chrome-extension://${PROBE}/options.html`, internal: { kind: 'extension', extensionId: PROBE, title: 'MAWS probe extension · Options' } });
    act(() => main.emit('browser.extensions.reveal', { tabId: T2, show: { kind: 'settings' } })); // not this chrome's tab
    expect(openTab).not.toHaveBeenCalled();
    act(() => main.emit('browser.extensions.reveal', { tabId: T1, show: { kind: 'tab', tab: options } }));
    expect(openTab).toHaveBeenLastCalledWith({ kind: 'browser', appSessionId: A, browserTabId: T2 });
    act(() => main.emit('browser.extensions.reveal', { tabId: T1, show: { kind: 'settings' } }));
    expect(openTab).toHaveBeenLastCalledWith({ kind: 'settings', section: 'browser' });
  });
});

describe('an internal tab\'s address field (cua #90)', () => {
  it('shows "<name> · Options", read-only, never the extension\'s URL, and suggests nothing', async () => {
    show(browserTab(T1, A, { partition: WORK, url: `chrome-extension://${PROBE}/options.html`, title: 'MAWS probe extension · Options', internal: { kind: 'extension', extensionId: PROBE, title: 'MAWS probe extension · Options' } }));
    const field = document.querySelector<HTMLInputElement>('[data-address-internal] input')!;
    expect(field.value).toBe('MAWS probe extension · Options');
    expect(field.readOnly).toBe(true);
    expect(document.body.textContent).not.toContain('chrome-extension');
    field.focus();
    fireEvent.change(field, { target: { value: 'f1' } });
    await act(async () => {});
    expect(main.callsOf('browser.history.suggest')).toEqual([]);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });
});
