// The bookmarks bar's commands in main (cua board #90's spec, "The bar"): `browser.bookmarks.open` for a chip's click and
// `browser.bookmarks.menu` for a folder's or the » menu. Every command names the tab it came from: the node is looked up
// in that tab's partition's tree only (a node of another partition is unknown), and every page opens in that tab's
// session and partition, so two surfaces sharing a partition never act on each other's tabs.
//
// A chip's click loads in the tab through `Navigator.navigate` with `typed: false`: the address field shows the URL as
// after a link click, and the navigator stamps the command as the person's input on the tab's seam (cua board #98), so
// on a tab under a cua lease the load is the person's, never an agent row, and the takeover gate holds the hand-back
// window. ⌘-click and middle-click open a new unselected tab instead. "Open all (n)" opens a folder's own URLs as new
// unselected tabs, in order, asking first through a native message box when n is above 20 (Chrome's habit), so a stray
// click on a large folder cannot open a hundred tabs; under the e2e MAWS_E2E_OPEN_ALL_ANSWER answers it.
import { dialog, type BrowserWindow, type MessageBoxOptions, type MessageBoxReturnValue } from 'electron';
import { BOOKMARKS_OPEN_ALL_ASK_ABOVE, type BookmarkFolder, type BookmarkTree, type BookmarkUrl } from '@shared/browser/bookmarks';
import type { BrowserBookmarksStore } from '../../index/browser-bookmarks';
import type { Navigator } from '../navigation';
import type { TabEntry, TabStore } from '../tabs';
import { bookmarkMenu, findBookmark, type BookmarkMenuRequest, type MenuPresenter } from './menu';

export class UnknownBookmarkError extends Error {
  constructor(readonly nodeId: number) {
    super(`unknown bookmark ${nodeId}`);
  }
}

export type ConfirmOpenAll = (window: BrowserWindow | null, n: number) => Promise<boolean>;

export interface BookmarkBarDeps {
  tabs: Pick<TabStore, 'entry' | 'require' | 'open'>;
  navigator: Pick<Navigator, 'navigate'>;
  bookmarks: Pick<BrowserBookmarksStore, 'tree'>;
  menus: MenuPresenter;
  confirmOpenAll: ConfirmOpenAll;
}

export class BookmarkBar {
  constructor(private readonly deps: BookmarkBarDeps) {}

  // A chip's click: the bookmark in the tab (`current`) or in a new unselected tab beside it (`newTab`).
  open(tabId: string, nodeId: number, how: 'current' | 'newTab'): void {
    const entry = this.deps.tabs.require(tabId);
    const node = findBookmark(this.treeOf(entry), nodeId);
    if (node?.kind !== 'url') throw new UnknownBookmarkError(nodeId);
    if (how === 'current') this.load(tabId, node);
    else this.openTab(entry, node.url);
  }

  // A folder's menu or the » menu, popped on the sender's window at the anchor; the chosen item acts on the tab.
  menu(tabId: string, request: BookmarkMenuRequest, anchor: { x: number; y: number }, window: BrowserWindow): void {
    const entry = this.deps.tabs.require(tabId);
    const items = bookmarkMenu(this.treeOf(entry), request, {
      open: (bookmark) => {
        if (this.live(tabId, entry)) this.load(tabId, bookmark);
      },
      openAll: (folder) => void this.openAll(tabId, entry, folder, window),
    });
    if (items === null) throw new UnknownBookmarkError(request.kind === 'folder' ? request.nodeId : -1);
    if (items.length > 0) this.deps.menus.present(items, { window, x: anchor.x, y: anchor.y });
  }

  private async openAll(tabId: string, entry: TabEntry, folder: BookmarkFolder, window: BrowserWindow): Promise<void> {
    const urls = folder.children.flatMap((node) => (node.kind === 'url' ? [node.url] : []));
    if (urls.length > BOOKMARKS_OPEN_ALL_ASK_ABOVE && !(await this.deps.confirmOpenAll(window, urls.length))) return;
    if (!this.live(tabId, entry)) return; // the tab closed while the question was open
    for (const url of urls) this.openTab(entry, url);
  }

  private treeOf(entry: TabEntry): BookmarkTree {
    return this.deps.bookmarks.tree(entry.tab.partition);
  }

  private load(tabId: string, bookmark: BookmarkUrl): void {
    this.deps.navigator.navigate(tabId, { url: bookmark.url, typed: false });
  }

  private openTab(entry: TabEntry, url: string): void {
    const { appSessionId, partition } = entry.tab;
    this.deps.tabs.open({ appSessionId, url, select: false, partition });
  }

  private live(tabId: string, entry: TabEntry): boolean {
    return this.deps.tabs.entry(tabId) === entry;
  }
}

export const OPEN_ALL_COPY = {
  // Chrome's question, in the owner's words (the spec's "The bar")
  message: (n: number) => `${n}개의 탭을 열까요?`,
  open: '열기',
  cancel: '취소',
};

type ShowMessageBox = (window: BrowserWindow, options: MessageBoxOptions) => Promise<MessageBoxReturnValue>;

// The question "Open all" asks above 20 tabs: a native message box on the window (macOS draws it above the page, as the
// menus), or under the e2e the answer MAWS_E2E_OPEN_ALL_ANSWER gives (`open` or `cancel`), each n asked kept for it.
export function openAllConfirmation(env: NodeJS.ProcessEnv, showMessageBox: ShowMessageBox = (window, options) => dialog.showMessageBox(window, options)): ConfirmOpenAll & { asked(): number[] } {
  const asked: number[] = [];
  const answer = env.MAWS_E2E === '1' ? env.MAWS_E2E_OPEN_ALL_ANSWER : undefined;
  const confirm = async (window: BrowserWindow | null, n: number): Promise<boolean> => {
    if (answer !== undefined) {
      asked.push(n);
      return answer === 'open';
    }
    if (window === null || window.isDestroyed()) return false;
    const { response } = await showMessageBox(window, { type: 'question', message: OPEN_ALL_COPY.message(n), buttons: [OPEN_ALL_COPY.open, OPEN_ALL_COPY.cancel], defaultId: 0, cancelId: 1 });
    return response === 0;
  };
  return Object.assign(confirm, { asked: () => [...asked] });
}
