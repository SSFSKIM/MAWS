// The bookmarks bar's native menus (cua board #90's spec, "The bar"; Interfaces "Native-menu e2e seam"). Folder menus
// are native (`Menu.popup`), which macOS draws above the page's view, so the page stays live under them (Decision Log:
// native over DOM popovers, which would freeze the page under the cover protocol).
//
// One builder serves both requests: a folder's menu (its children in Chrome's order, nested folders as submenus, and at
// the end of every level that holds URLs a separator and "Open all (n)", as Chrome's own folder menus end), and the »
// menu (the bar's chips from the first one the renderer could not fit, then after a separator Other bookmarks and
// Mobile bookmarks as submenus when they hold anything). Each item carries a stable id (`bookmark:<nodeId>`,
// `folder:<nodeId>`, `open-all`, `root:other`, `root:mobile`, `empty`; M3 adds its own) so the e2e can choose by id path,
// since names repeat across folders.
//
// The presenter pops a built menu on a window at the anchor; under MAWS_E2E it records the menu instead (a native menu
// cannot be driven through CDP, and a real one on screen would take the e2e's mouse), and `pick(path)` runs the item
// the path names, as a click would. Bookmark names and URLs are page strings: they reach the menu as labels only, and
// nothing here logs them.
import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { ROOT_NAMES, type BookmarkFolder, type BookmarkNode, type BookmarkTree, type BookmarkUrl } from '@shared/browser/bookmarks';

// A built menu: what the presenter pops and what the seam records.
export type MenuSpec = { id: string; label: string; enabled?: boolean; click?(): void; submenu?: MenuSpec[] } | { separator: true };
// The seam's serializable record of a built menu.
export type MenuNode = { id: string; label: string; enabled?: false; children?: MenuNode[] } | { separator: true };

export type BookmarkMenuRequest = { kind: 'folder'; nodeId: number } | { kind: 'overflow'; hiddenFrom: number };

export interface BookmarkMenuActions {
  open(bookmark: BookmarkUrl): void;
  openAll(folder: BookmarkFolder): void;
}

export const MENU_COPY = {
  openAll: (n: number) => `Open all (${n})`, // Chrome's
  empty: '(empty)', // Chrome's
};

const SEPARATOR = { separator: true } as const;

// The node of this tree with the id, the roots included; null when the tree has none.
export function findBookmark(tree: BookmarkTree, nodeId: number): BookmarkNode | null {
  const stack: BookmarkNode[] = [tree.bar, tree.other, tree.mobile];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.id === nodeId) return node;
    if (node.kind === 'folder') stack.push(...node.children);
  }
  return null;
}

// The menu a request asks for; null when a folder request names no folder of this tree. An overflow with nothing in it
// answers an empty menu, which the caller does not pop.
export function bookmarkMenu(tree: BookmarkTree, request: BookmarkMenuRequest, actions: BookmarkMenuActions): MenuSpec[] | null {
  if (request.kind === 'folder') {
    const node = findBookmark(tree, request.nodeId);
    return node?.kind === 'folder' ? folderItems(node, actions) : null;
  }
  const hidden = tree.bar.children.slice(request.hiddenFrom).map((node) => nodeItem(node, actions));
  const roots: MenuSpec[] = [];
  if (tree.other.children.length > 0) roots.push({ id: 'root:other', label: ROOT_NAMES.other, submenu: folderItems(tree.other, actions) });
  if (tree.mobile.children.length > 0) roots.push({ id: 'root:mobile', label: ROOT_NAMES.mobile, submenu: folderItems(tree.mobile, actions) });
  return hidden.length > 0 && roots.length > 0 ? [...hidden, SEPARATOR, ...roots] : [...hidden, ...roots];
}

function folderItems(folder: BookmarkFolder, actions: BookmarkMenuActions): MenuSpec[] {
  if (folder.children.length === 0) return [{ id: 'empty', label: MENU_COPY.empty, enabled: false }];
  const items = folder.children.map((node) => nodeItem(node, actions));
  const urls = folder.children.filter((node) => node.kind === 'url').length;
  return urls === 0 ? items : [...items, SEPARATOR, { id: 'open-all', label: MENU_COPY.openAll(urls), click: () => actions.openAll(folder) }];
}

function nodeItem(node: BookmarkNode, actions: BookmarkMenuActions): MenuSpec {
  if (node.kind === 'folder') return { id: `folder:${node.id}`, label: node.name, submenu: folderItems(node, actions) };
  return { id: `bookmark:${node.id}`, label: node.name || node.url, click: () => actions.open(node) };
}

// ---- the presenter ---------------------------------------------------------------------------------------------------

export function toTemplate(items: readonly MenuSpec[]): MenuItemConstructorOptions[] {
  return items.map((item): MenuItemConstructorOptions => {
    if ('separator' in item) return { type: 'separator' };
    const { id, label, enabled, click, submenu } = item;
    return { id, label, ...(enabled === false && { enabled: false }), ...(click && { click: () => click() }), ...(submenu && { submenu: toTemplate(submenu) }) };
  });
}

export function toNodes(items: readonly MenuSpec[]): MenuNode[] {
  return items.map((item): MenuNode => {
    if ('separator' in item) return SEPARATOR;
    const { id, label, enabled, submenu } = item;
    return { id, label, ...(enabled === false && { enabled: false as const }), ...(submenu && { children: toNodes(submenu) }) };
  });
}

export interface MenuAnchor {
  window: BrowserWindow;
  x: number; // CSS px of the window's content area
  y: number;
}

export type PopupMenu = (template: MenuItemConstructorOptions[], at: MenuAnchor) => void;
const nativePopup: PopupMenu = (template, { window, x, y }) => Menu.buildFromTemplate(template).popup({ window, x, y });

// The e2e's handle on the last menu built (globalThis.__maws_browser.menu under MAWS_E2E=1).
export interface NativeMenuSeam {
  last(): MenuNode[] | null; // null once chosen from, or before any
  pick(path: string[]): boolean; // false when the path names no enabled item with an action
}

export interface MenuPresenter {
  present(items: MenuSpec[], at: MenuAnchor): void;
}

export class NativeMenus implements MenuPresenter {
  private recorded: MenuSpec[] | null = null;
  private readonly e2e: boolean;
  private readonly popup: PopupMenu;
  readonly seam: NativeMenuSeam;

  constructor({ e2e, popup = nativePopup }: { e2e: boolean; popup?: PopupMenu }) {
    this.e2e = e2e;
    this.popup = popup;
    this.seam = {
      last: () => (this.recorded === null ? null : toNodes(this.recorded)),
      pick: (path) => {
        let items = this.recorded;
        let item: MenuSpec | undefined;
        for (const id of path) {
          item = items?.find((candidate) => 'id' in candidate && candidate.id === id);
          items = item && 'submenu' in item ? (item.submenu ?? null) : null;
        }
        if (!item || 'separator' in item || item.enabled === false || !item.click) return false;
        this.recorded = null;
        item.click();
        return true;
      },
    };
  }

  present(items: MenuSpec[], at: MenuAnchor): void {
    if (this.e2e) this.recorded = items;
    else this.popup(toTemplate(items), at);
  }
}
