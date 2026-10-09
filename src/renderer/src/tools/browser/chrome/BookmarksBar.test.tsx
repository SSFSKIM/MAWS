// cua #90: the bookmarks bar (cua board #90's spec, "The bar"): an imported profile's chips under the navigation row in
// Chrome's order, a chip's click in the tab or a new one, a folder's and the »'s native menus asked of main with the
// tab and an anchor, the chips that do not fit hidden and handed to the », the icons the partition already showed, the
// hidden states, ⌘⇧B from the chrome and from the page, and the tree read again when main says it changed.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyBookmarkTree, type BookmarkNode, type BookmarkTree } from '@shared/browser/bookmarks';
import type { ImportedProfile } from '@shared/browser/profiles';
import { profilePartition, type BrowserTab } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import type { Settings } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V12 } from '@shared/settings/defaults';
import { browserTab, T1 } from '../../../test-support/browser';
import { RECORD } from '../../../test-support/browser-import';
import { installFakeMain, ok } from '../../../test-support/code';
import { useSettings } from '../../../stores/settings';
import { browserImport, connectBrowserImport, resetBrowserImport } from '../import/store';
import { connectBrowser, resetBrowser } from '../store';
import { Chrome } from './Chrome';

const A = 'app-a' as AppSessionId;
const WORK = profilePartition('Profile 1');
const ICON = 'data:image/png;base64,iVBORw0KGgo=';

const url = (id: number, name: string, host = 'b.example'): BookmarkNode => ({ kind: 'url', id, name, url: `https://${host}/${name}`, addedAt: null });
function fixtureTree(): BookmarkTree {
  const tree = emptyBookmarkTree();
  tree.bar.id = 1;
  tree.bar.children = [url(2, 'A', 'a.example'), url(3, 'B'), { kind: 'folder', id: 4, name: 'F', children: [url(5, 'F1')] }, url(6, '', 'icon-only.example'), url(7, 'N01'), url(8, 'N02')];
  tree.other = { kind: 'folder', id: 9, name: 'Other bookmarks', children: [url(10, 'O1')] };
  return tree;
}

let main: ReturnType<typeof installFakeMain>;
let tree: BookmarkTree;
let disconnect: () => void;
const record = (over: Partial<ImportedProfile> = {}): ImportedProfile => ({ ...RECORD, profileDir: 'Profile 1', partition: WORK, bookmarks: { consentedAt: RECORD.importedAt, syncedAt: RECORD.importedAt, count: 6, error: null, errorAt: null }, ...over });
const setSettings = (browser: Partial<Settings['browser']> = {}) =>
  useSettings.setState({ state: { settings: { ...SETTINGS_DEFAULTS_V12, browser: { ...SETTINGS_DEFAULTS_V12.browser, ...browser } }, resolvedTheme: 'light' } });

beforeEach(() => {
  resetBrowser();
  resetBrowserImport();
  tree = fixtureTree();
  main = installFakeMain((name) => {
    switch (name) {
      case 'browser.tabs.list':
        return ok({ tabs: [], selected: {} });
      case 'browser.profiles.list':
        return ok({ profiles: [{ profileDir: 'Profile 1', name: 'Work', gaiaName: null, userName: null, avatar: { kind: 'initials', letter: 'W' } }] });
      case 'browser.import.list':
        return ok({ profiles: [record()], fileBroken: false, running: null });
      case 'browser.bookmarks.tree':
        return ok({ tree });
      case 'browser.bookmarks.favicons':
        return ok({ icons: { 'https://a.example': ICON } });
      case 'settings.set':
        return ok({ settings: SETTINGS_DEFAULTS_V12, resolvedTheme: 'light' });
      default:
        return ok();
    }
  });
  browserImport.setState({ records: [record()], listed: true });
  setSettings();
  disconnect = connectBrowser(main.bridge);
});
afterEach(() => {
  disconnect();
  cleanup();
  vi.restoreAllMocks();
});

function show(tab: BrowserTab = browserTab(T1, A, { partition: WORK }), queries = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const view = render(
    <QueryClientProvider client={queries}>
      <Chrome appSessionId={A} surface="main" tab={tab} tabs={[tab]} owns />
    </QueryClientProvider>,
  );
  return { ...view, queries };
}
const bar = () => document.querySelector<HTMLElement>('[data-bookmarks-bar]');
const chip = (id: number) => document.querySelector<HTMLButtonElement>(`[data-bookmark="${id}"], [data-bookmark-folder="${id}"]`)!;
const more = () => document.querySelector<HTMLButtonElement>('[data-bookmarks-more]');

describe('the bookmarks bar', () => {
  it('shows the profile\'s bar under the navigation row in Chrome\'s order: icons the partition showed, else a page glyph; an unnamed bookmark as its icon', async () => {
    show();
    await vi.waitFor(() => expect(bar()).not.toBeNull());
    const chips = [...bar()!.querySelectorAll('button[data-bookmark], button[data-bookmark-folder]')];
    expect(chips.map((button) => button.textContent)).toEqual(['A', 'B', 'F', '', 'N01', 'N02']);
    expect(screen.getByRole('toolbar', { name: 'Bookmarks bar' })).toBe(bar());
    await vi.waitFor(() => expect(chip(2).querySelector('img')?.getAttribute('src')).toBe(ICON));
    expect(chip(3).querySelector('img')).toBeNull(); // never shown in this partition: the glyph, no fetch
    expect(chip(6).getAttribute('aria-label')).toBe('https://icon-only.example/');
    expect(chip(3).title).toBe('B\nhttps://b.example/B');
    expect(main.callsOf('browser.bookmarks.favicons')).toContainEqual({ partition: WORK, origins: ['https://a.example', 'https://b.example', 'https://icon-only.example'] });
    // the bar sits between the navigation row and anything below it
    const chrome = document.querySelector('[data-browser-chrome]')!;
    expect([...chrome.children].indexOf(bar()!)).toBe(2);
  });

  it('a click loads in the tab; ⌘-click and the middle button open a new tab', async () => {
    show();
    await vi.waitFor(() => expect(bar()).not.toBeNull());
    fireEvent.click(chip(2));
    fireEvent.click(chip(3), { metaKey: true });
    fireEvent(chip(7), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    await vi.waitFor(() =>
      expect(main.callsOf('browser.bookmarks.open')).toEqual([
        { tabId: T1, nodeId: 2, how: 'current' },
        { tabId: T1, nodeId: 3, how: 'newTab' },
        { tabId: T1, nodeId: 7, how: 'newTab' },
      ]),
    );
  });

  it('a folder asks main for its native menu under the chip; » for the overflow from the first chip that does not fit', async () => {
    show();
    await vi.waitFor(() => expect(bar()).not.toBeNull());
    vi.spyOn(chip(4), 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 80.4, y: 66, width: 40, height: 24 }));
    fireEvent.click(chip(4));
    fireEvent.click(more()!);
    await vi.waitFor(() =>
      expect(main.callsOf('browser.bookmarks.menu')).toEqual([
        { tabId: T1, request: { kind: 'folder', nodeId: 4 }, anchor: { x: 80, y: 90 } },
        { tabId: T1, request: { kind: 'overflow', hiddenFrom: 6 }, anchor: { x: 0, y: 0 } }, // everything fits: Other bookmarks alone
      ]),
    );
  });

  it('hides the chips past the room and hands them to the »', async () => {
    // each chip 50 px wide from the list's left edge, the list 160 px: three fit
    const rects = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const siblings = this.parentElement ? [...this.parentElement.children] : [];
      const at = this.matches('[data-bookmark], [data-bookmark-folder]') ? siblings.indexOf(this) : -1;
      return DOMRect.fromRect({ x: at === -1 ? 0 : at * 50, y: 0, width: at === -1 ? 160 : 48, height: 24 });
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(160);
    show();
    await vi.waitFor(() => expect(bar()).not.toBeNull());
    await vi.waitFor(() => expect(chip(6).inert).toBe(true));
    expect([2, 3, 4].map((id) => chip(id).inert)).toEqual([false, false, false]);
    expect([6, 7, 8].map((id) => chip(id).className.includes('invisible'))).toEqual([true, true, true]);
    fireEvent.click(more()!);
    await vi.waitFor(() => expect(main.callsOf('browser.bookmarks.menu').at(-1)).toMatchObject({ request: { kind: 'overflow', hiddenFrom: 3 } }));
    rects.mockRestore();
  });

  it('shows no » when every chip fits and Other and Mobile bookmarks are empty', async () => {
    tree.other.children = [];
    show();
    await vi.waitFor(() => expect(bar()).not.toBeNull());
    expect(more()).toBeNull();
  });

  it('is absent for the Default partition, a profile imported without bookmarks, an empty bar, and while the setting hides it', async () => {
    const { unmount } = show(browserTab(T1, A)); // the Default partition renders no bar (and asks nothing)
    expect(bar()).toBeNull();
    unmount();
    expect(main.callsOf('browser.bookmarks.tree')).toEqual([]);

    browserImport.setState({ records: [record({ bookmarks: null })] });
    const without = show();
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(bar()).toBeNull();
    expect(main.callsOf('browser.bookmarks.tree')).toEqual([]); // nothing to read without consent
    without.unmount();

    browserImport.setState({ records: [record()] });
    tree.bar.children = [];
    const empty = show();
    await vi.waitFor(() => expect(main.callsOf('browser.bookmarks.tree')).toHaveLength(1));
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(bar()).toBeNull();
    empty.unmount();

    tree = fixtureTree();
    setSettings({ bookmarksBar: 'hidden' });
    show();
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(bar()).toBeNull();
    act(() => setSettings({ bookmarksBar: 'shown' }));
    await vi.waitFor(() => expect(bar()).not.toBeNull());
  });

  it('reads the tree again when main says the partition\'s bookmarks changed', async () => {
    const { queries } = show();
    const off = connectBrowserImport(main.bridge, queries);
    await vi.waitFor(() => expect(chip(2)?.textContent).toBe('A'));
    tree = fixtureTree();
    tree.bar.children[0] = url(2, 'A2', 'a.example');
    act(() => main.emit('browser.bookmarks.changed', { partition: profilePartition('Default') })); // another partition's
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(chip(2).textContent).toBe('A');
    act(() => main.emit('browser.bookmarks.changed', { partition: WORK }));
    await vi.waitFor(() => expect(chip(2).textContent).toBe('A2'));
    off();
  });
});

describe('⌘⇧B: the bookmarks bar\'s chord', () => {
  it('flips the setting when pressed with the chrome focused, and when main tells the chrome it was pressed in the page', async () => {
    show();
    await vi.waitFor(() => expect(bar()).not.toBeNull());
    const address = screen.getByRole('combobox', { name: 'Address' });
    expect(fireEvent.keyDown(address, { key: 'B', metaKey: true, shiftKey: true })).toBe(false); // taken from the menu's Toggle right panel
    await vi.waitFor(() => expect(main.callsOf('settings.set')).toEqual([{ browser: { bookmarksBar: 'hidden' } }]));
    fireEvent.keyDown(address, { key: 'b', metaKey: true }); // ⌘B is the sidebar's
    fireEvent.keyDown(address, { key: 'b', metaKey: true, shiftKey: true, altKey: true });
    setSettings({ bookmarksBar: 'hidden' });
    act(() => main.emit('browser.chrome.command', { tabId: T1, command: 'toggleBookmarksBar' }));
    await vi.waitFor(() => expect(main.callsOf('settings.set')).toEqual([{ browser: { bookmarksBar: 'hidden' } }, { browser: { bookmarksBar: 'shown' } }]));
  });

  // the spec's Decision Log, 2026-10-09: the chord narrowed to tabs that can show a bar, and Toggle right panel's elsewhere
  it('passes ⌘⇧B on, unprevented and unwritten, in a Default tab and in a profile imported without bookmarks', async () => {
    const def = show(browserTab(T1, A));
    const field = () => screen.getByRole('combobox', { name: 'Address' });
    expect(fireEvent.keyDown(field(), { key: 'B', metaKey: true, shiftKey: true })).toBe(true); // not prevented: the menu's
    act(() => main.emit('browser.chrome.command', { tabId: T1, command: 'toggleBookmarksBar' }));
    def.unmount();
    browserImport.setState({ records: [record({ bookmarks: null })] });
    show();
    expect(fireEvent.keyDown(field(), { key: 'B', metaKey: true, shiftKey: true })).toBe(true);
    act(() => main.emit('browser.chrome.command', { tabId: T1, command: 'toggleBookmarksBar' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(main.callsOf('settings.set')).toEqual([]);
  });

  it('takes ⌘⇧B in a consented profile\'s tab while its bar is hidden, so the chord brings it back', async () => {
    setSettings({ bookmarksBar: 'hidden' });
    show();
    expect(fireEvent.keyDown(screen.getByRole('combobox', { name: 'Address' }), { key: 'B', metaKey: true, shiftKey: true })).toBe(false);
    await vi.waitFor(() => expect(main.callsOf('settings.set')).toEqual([{ browser: { bookmarksBar: 'shown' } }]));
  });
});
