// The bookmarks bar's commands in main (cua board #90's spec, "The bar"): a chip's click in the originating tab or a new
// unselected one of its session and partition, a folder's or the » menu popped on the sender's window with the chosen
// item acting on that tab, "Open all" asking first above 20, and every node looked up in the tab's own partition.
import { describe, expect, it, vi } from 'vitest';
import { emptyBookmarkTree, type BookmarkNode, type BookmarkTree } from '@shared/browser/bookmarks';
import { profilePartition } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import { BookmarkBar, UnknownBookmarkError, openAllConfirmation } from './bar';
import { NativeMenus } from './menu';
import { UnknownTabError } from '../tabs';

const A = 'App-A' as AppSessionId;
const WORK = profilePartition('Profile 1');
const HOME = profilePartition('Default');

const url = (id: number, name: string): BookmarkNode => ({ kind: 'url', id, name, url: `https://b.example/${name}`, addedAt: null });
// Work: A (2), B (3), F (4: F1 5, F2 6), Many (7: 25 URLs from 100); Other: O1 (9). Default: H (20).
function trees(): Record<string, BookmarkTree> {
  const work = emptyBookmarkTree();
  work.bar = { kind: 'folder', id: 1, name: 'Bookmarks bar', children: [url(2, 'A'), url(3, 'B'), { kind: 'folder', id: 4, name: 'F', children: [url(5, 'F1'), url(6, 'F2')] }, { kind: 'folder', id: 7, name: 'Many', children: Array.from({ length: 25 }, (_, k) => url(100 + k, `M${k}`)) }] };
  work.other = { kind: 'folder', id: 8, name: 'Other bookmarks', children: [url(9, 'O1')] };
  const home = emptyBookmarkTree();
  home.bar = { kind: 'folder', id: 19, name: 'Bookmarks bar', children: [url(20, 'H')] };
  return { [WORK]: work, [HOME]: home };
}

function harness(answer = true) {
  const tabs = new Map([['b_000000000001', { tab: { tabId: 'b_000000000001', appSessionId: A, partition: WORK } }]]);
  const store = {
    entry: (tabId: string) => tabs.get(tabId),
    require: (tabId: string) => {
      const entry = tabs.get(tabId);
      if (!entry) throw new UnknownTabError(tabId);
      return entry;
    },
    open: vi.fn<(request: unknown) => unknown>(() => ({ tab: {}, reused: false })),
  };
  const navigator = { navigate: vi.fn(() => true) };
  const menus = new NativeMenus({ e2e: true });
  const confirmOpenAll = vi.fn(async () => answer);
  const all = trees();
  const bar = new BookmarkBar({ tabs: store as never, navigator, bookmarks: { tree: (partition) => all[partition] ?? emptyBookmarkTree() }, menus, confirmOpenAll });
  const window = { id: 7 } as never;
  const opened = () => store.open.mock.calls.map(([request]) => request);
  return { tabs, store, navigator, menus, confirmOpenAll, bar, window, opened, tabId: 'b_000000000001' };
}

describe('BookmarkBar.open: a chip', () => {
  it('loads the bookmark in the originating tab as the person\'s link, not a typed address', () => {
    const h = harness();
    h.bar.open(h.tabId, 2, 'current');
    expect(h.navigator.navigate).toHaveBeenCalledExactlyOnceWith(h.tabId, { url: 'https://b.example/A', typed: false });
    expect(h.store.open).not.toHaveBeenCalled();
  });

  it('⌘-click or middle-click: a new unselected tab of the tab\'s session and partition', () => {
    const h = harness();
    h.bar.open(h.tabId, 3, 'newTab');
    expect(h.opened()).toEqual([{ appSessionId: A, url: 'https://b.example/B', select: false, partition: WORK }]);
    expect(h.navigator.navigate).not.toHaveBeenCalled();
  });

  it('refuses a folder, a node of another partition, an unknown node and an unknown tab', () => {
    const h = harness();
    expect(() => h.bar.open(h.tabId, 4, 'current')).toThrow(UnknownBookmarkError);
    expect(() => h.bar.open(h.tabId, 20, 'current')).toThrow(UnknownBookmarkError); // Default's H, from a Work tab
    expect(() => h.bar.open(h.tabId, 999, 'newTab')).toThrow(UnknownBookmarkError);
    expect(() => h.bar.open('b_00000000dead', 2, 'current')).toThrow(UnknownTabError);
    expect(h.navigator.navigate).not.toHaveBeenCalled();
    expect(h.store.open).not.toHaveBeenCalled();
  });
});

describe('BookmarkBar.menu: native menus', () => {
  it('pops a folder\'s menu on the sender\'s window at the anchor; a choice loads in the originating tab', () => {
    const h = harness();
    const present = vi.spyOn(h.menus, 'present');
    h.bar.menu(h.tabId, { kind: 'folder', nodeId: 4 }, { x: 12, y: 64 }, h.window);
    expect(present.mock.calls[0]![1]).toEqual({ window: h.window, x: 12, y: 64 });
    expect(h.menus.seam.last()?.map((node) => ('id' in node ? node.id : '—'))).toEqual(['bookmark:5', 'bookmark:6', '—', 'open-all']);
    expect(h.menus.seam.pick(['bookmark:6'])).toBe(true);
    expect(h.navigator.navigate).toHaveBeenCalledExactlyOnceWith(h.tabId, { url: 'https://b.example/F2', typed: false });
  });

  it('pops the » menu from the first hidden chip, with Other bookmarks', () => {
    const h = harness();
    h.bar.menu(h.tabId, { kind: 'overflow', hiddenFrom: 3 }, { x: 0, y: 0 }, h.window);
    expect(h.menus.seam.last()?.map((node) => ('id' in node ? node.id : '—'))).toEqual(['folder:7', '—', 'root:other']);
    expect(h.menus.seam.pick(['root:other', 'bookmark:9'])).toBe(true);
    expect(h.navigator.navigate).toHaveBeenCalledWith(h.tabId, { url: 'https://b.example/O1', typed: false });
  });

  it('pops nothing for an empty overflow, and refuses a folder that is not the tab\'s partition\'s', () => {
    const h = harness();
    const present = vi.spyOn(h.menus, 'present');
    const bare = { ...trees()[WORK]!, other: { kind: 'folder' as const, id: 8, name: 'Other bookmarks', children: [] } };
    const bar = new BookmarkBar({ tabs: h.store as never, navigator: h.navigator, bookmarks: { tree: () => bare }, menus: h.menus, confirmOpenAll: h.confirmOpenAll });
    bar.menu(h.tabId, { kind: 'overflow', hiddenFrom: 4 }, { x: 0, y: 0 }, h.window);
    expect(present).not.toHaveBeenCalled();
    expect(() => h.bar.menu(h.tabId, { kind: 'folder', nodeId: 19 }, { x: 0, y: 0 }, h.window)).toThrow(UnknownBookmarkError);
    expect(() => h.bar.menu(h.tabId, { kind: 'folder', nodeId: 2 }, { x: 0, y: 0 }, h.window)).toThrow(UnknownBookmarkError);
  });

  it('a choice made after the originating tab closed does nothing', () => {
    const h = harness();
    h.bar.menu(h.tabId, { kind: 'folder', nodeId: 4 }, { x: 0, y: 0 }, h.window);
    h.tabs.clear();
    expect(h.menus.seam.pick(['bookmark:5'])).toBe(true);
    expect(h.navigator.navigate).not.toHaveBeenCalled();
  });
});

describe('BookmarkBar: Open all', () => {
  it('opens each URL of the folder (its subfolders\' not) as a new unselected tab of the tab\'s session and partition, in order, without asking', async () => {
    const h = harness();
    h.bar.menu(h.tabId, { kind: 'folder', nodeId: 4 }, { x: 0, y: 0 }, h.window);
    h.menus.seam.pick(['open-all']);
    await vi.waitFor(() => expect(h.opened()).toHaveLength(2));
    expect(h.opened()).toEqual(['F1', 'F2'].map((name) => ({ appSessionId: A, url: `https://b.example/${name}`, select: false, partition: WORK })));
    expect(h.confirmOpenAll).not.toHaveBeenCalled();
  });

  it('above 20 asks first on the window: declined opens nothing, accepted opens them all', async () => {
    const declined = harness(false);
    declined.bar.menu(declined.tabId, { kind: 'folder', nodeId: 7 }, { x: 0, y: 0 }, declined.window);
    declined.menus.seam.pick(['open-all']);
    await vi.waitFor(() => expect(declined.confirmOpenAll).toHaveBeenCalledExactlyOnceWith(declined.window, 25));
    await Promise.resolve();
    expect(declined.store.open).not.toHaveBeenCalled();

    const accepted = harness(true);
    accepted.bar.menu(accepted.tabId, { kind: 'folder', nodeId: 7 }, { x: 0, y: 0 }, accepted.window);
    accepted.menus.seam.pick(['open-all']);
    await vi.waitFor(() => expect(accepted.opened()).toHaveLength(25));
    expect(accepted.opened()[24]).toMatchObject({ url: 'https://b.example/M24', select: false });
  });

  it('opens nothing when the originating tab closed while the question was open', async () => {
    const h = harness(true);
    let answer: (yes: boolean) => void = () => {};
    h.confirmOpenAll.mockImplementation(() => new Promise<boolean>((resolve) => (answer = resolve)));
    h.bar.menu(h.tabId, { kind: 'folder', nodeId: 7 }, { x: 0, y: 0 }, h.window);
    h.menus.seam.pick(['open-all']);
    await vi.waitFor(() => expect(h.confirmOpenAll).toHaveBeenCalled());
    h.tabs.clear();
    answer(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.store.open).not.toHaveBeenCalled();
  });
});

describe('openAllConfirmation: the question', () => {
  it('asks a native message box on the window, the open button first', async () => {
    const showMessageBox = vi.fn(async () => ({ response: 0, checkboxChecked: false }));
    const confirm = openAllConfirmation({}, showMessageBox);
    const window = { id: 1, isDestroyed: () => false } as never;
    expect(await confirm(window, 25)).toBe(true);
    expect(showMessageBox).toHaveBeenCalledWith(window, expect.objectContaining({ message: '25개의 탭을 열까요?', defaultId: 0, cancelId: 1 }));
    showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false });
    expect(await confirm(window, 25)).toBe(false);
    expect(await confirm({ isDestroyed: () => true } as never, 25)).toBe(false); // no window to ask on: nothing opens
  });

  it('under the e2e answers MAWS_E2E_OPEN_ALL_ANSWER without a box, and records what was asked', async () => {
    const showMessageBox = vi.fn();
    const confirm = openAllConfirmation({ MAWS_E2E: '1', MAWS_E2E_OPEN_ALL_ANSWER: 'open' }, showMessageBox);
    expect(await confirm(null, 21)).toBe(true);
    expect(await openAllConfirmation({ MAWS_E2E: '1', MAWS_E2E_OPEN_ALL_ANSWER: 'cancel' }, showMessageBox)(null, 30)).toBe(false);
    expect(confirm.asked()).toEqual([21]);
    expect(showMessageBox).not.toHaveBeenCalled();
  });
});
