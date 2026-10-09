// The bookmarks bar's native menus (cua board #90's spec, "The bar"): one builder for a folder's menu and the » menu, and
// the presenter that pops a built menu on a window or, under the e2e, records it as a tree of stable ids that `pick`
// chooses from by id path.
import { describe, expect, it, vi } from 'vitest';
import type { BookmarkFolder, BookmarkNode, BookmarkTree } from '@shared/browser/bookmarks';
import { bookmarkMenu, findBookmark, NativeMenus, toNodes, toTemplate, type MenuSpec } from './menu';

let nextId = 1;
const url = (name: string): BookmarkNode => ({ kind: 'url', id: nextId++, name, url: `https://b.example/${name}`, addedAt: null });
const folder = (name: string, children: BookmarkNode[]): BookmarkFolder => ({ kind: 'folder', id: nextId++, name, children });

// The fixture's shape: A, B, F (F1, F2, G (G1)), N01 to N05; Other bookmarks: O1; Mobile bookmarks: empty.
function fixture(): BookmarkTree {
  nextId = 1;
  const bar = folder('Bookmarks bar', [url('A'), url('B'), folder('F', [url('F1'), url('F2'), folder('G', [url('G1')])]), ...['N01', 'N02', 'N03', 'N04', 'N05'].map(url)]);
  return { bar, other: folder('Other bookmarks', [url('O1')]), mobile: folder('Mobile bookmarks', []) };
}
const idOf = (tree: BookmarkTree, name: string): number => {
  const walk = (nodes: BookmarkNode[]): number | null => {
    for (const node of nodes) {
      if (node.name === name) return node.id;
      if (node.kind === 'folder') {
        const found = walk(node.children);
        if (found !== null) return found;
      }
    }
    return null;
  };
  return walk([tree.bar, tree.other, tree.mobile])!;
};
const actions = () => ({ open: vi.fn(), openAll: vi.fn() });
// A built menu as labels: an item its label, a submenu `[label, items]`, a separator '—'.
type Shape = string | [string, Shape[]];
const shape = (items: MenuSpec[]): Shape[] => items.map((item) => ('separator' in item ? '—' : item.submenu ? [item.label, shape(item.submenu)] : item.label));

describe('bookmarkMenu: a folder', () => {
  it('lists the folder in Chrome\'s order, nested folders as submenus, and ends each level holding URLs with a separator and Open all (n)', () => {
    const tree = fixture();
    const menu = bookmarkMenu(tree, { kind: 'folder', nodeId: idOf(tree, 'F') }, actions())!;
    expect(shape(menu)).toEqual(['F1', 'F2', ['G', ['G1', '—', 'Open all (1)']], '—', 'Open all (2)']);
    expect(toNodes(menu)).toEqual([
      { id: `bookmark:${idOf(tree, 'F1')}`, label: 'F1' },
      { id: `bookmark:${idOf(tree, 'F2')}`, label: 'F2' },
      { id: `folder:${idOf(tree, 'G')}`, label: 'G', children: [{ id: `bookmark:${idOf(tree, 'G1')}`, label: 'G1' }, { separator: true }, { id: 'open-all', label: 'Open all (1)' }] },
      { separator: true },
      { id: 'open-all', label: 'Open all (2)' },
    ]);
  });

  it('runs the chosen bookmark, and Open all with the folder it ends', () => {
    const tree = fixture();
    const act = actions();
    const menu = bookmarkMenu(tree, { kind: 'folder', nodeId: idOf(tree, 'F') }, act)!;
    const click = (item: MenuSpec | undefined) => (item && !('separator' in item) ? item.click?.() : undefined);
    click(menu[1]);
    expect(act.open).toHaveBeenCalledWith(expect.objectContaining({ name: 'F2', url: 'https://b.example/F2' }));
    click(menu[4]);
    expect(act.openAll).toHaveBeenCalledWith(expect.objectContaining({ name: 'F' }));
  });

  it('shows an empty folder as one disabled line, a folder of folders without Open all, and an unnamed bookmark by its URL', () => {
    nextId = 100;
    const empty = folder('E', []);
    const ofFolders = folder('H', [empty]);
    const unnamed: BookmarkNode = { kind: 'url', id: nextId++, name: '', url: 'https://nameless.example/', addedAt: null };
    const tree: BookmarkTree = { bar: folder('Bookmarks bar', [ofFolders, folder('U', [unnamed])]), other: folder('Other bookmarks', []), mobile: folder('Mobile bookmarks', []) };
    expect(toNodes(bookmarkMenu(tree, { kind: 'folder', nodeId: empty.id }, actions())!)).toEqual([{ id: 'empty', label: '(empty)', enabled: false }]);
    expect(shape(bookmarkMenu(tree, { kind: 'folder', nodeId: ofFolders.id }, actions())!)).toEqual([['E', ['(empty)']]]);
    expect(shape(bookmarkMenu(tree, { kind: 'folder', nodeId: idOf(tree, 'U') }, actions())!)).toEqual(['https://nameless.example/', '—', 'Open all (1)']);
  });

  it('answers null for a node that is not a folder of this tree', () => {
    const tree = fixture();
    expect(bookmarkMenu(tree, { kind: 'folder', nodeId: idOf(tree, 'A') }, actions())).toBeNull();
    expect(bookmarkMenu(tree, { kind: 'folder', nodeId: 9999 }, actions())).toBeNull();
  });
});

describe('bookmarkMenu: the » overflow', () => {
  it('lists the bar from the first hidden chip, then after a separator the other roots that hold anything', () => {
    const tree = fixture();
    const menu = bookmarkMenu(tree, { kind: 'overflow', hiddenFrom: 5 }, actions())!;
    expect(shape(menu)).toEqual(['N03', 'N04', 'N05', '—', ['Other bookmarks', ['O1', '—', 'Open all (1)']]]);
    expect(toNodes(menu).at(-1)).toMatchObject({ id: 'root:other', label: 'Other bookmarks' });
  });

  it('holds a hidden folder as a submenu, the mobile root when it holds anything, and no separator around an empty part', () => {
    const tree = fixture();
    tree.mobile.children.push(url('M1'));
    expect(shape(bookmarkMenu(tree, { kind: 'overflow', hiddenFrom: 2 }, actions())!).slice(0, 2)).toEqual([['F', ['F1', 'F2', ['G', ['G1', '—', 'Open all (1)']], '—', 'Open all (2)']], 'N01']);
    expect(toNodes(bookmarkMenu(tree, { kind: 'overflow', hiddenFrom: 99 }, actions())!).map((node) => ('id' in node ? node.id : '—'))).toEqual(['root:other', 'root:mobile']);
    const bare: BookmarkTree = { ...fixture(), other: folder('Other bookmarks', []) };
    expect(shape(bookmarkMenu(bare, { kind: 'overflow', hiddenFrom: 6 }, actions())!)).toEqual(['N04', 'N05']);
    expect(bookmarkMenu(bare, { kind: 'overflow', hiddenFrom: 8 }, actions())).toEqual([]);
  });
});

describe('findBookmark', () => {
  it('finds a node anywhere in the three roots, the roots included', () => {
    const tree = fixture();
    expect(findBookmark(tree, idOf(tree, 'G1'))).toMatchObject({ name: 'G1' });
    expect(findBookmark(tree, idOf(tree, 'O1'))).toMatchObject({ name: 'O1' });
    expect(findBookmark(tree, tree.other.id)).toBe(tree.other);
    expect(findBookmark(tree, 9999)).toBeNull();
  });
});

describe('NativeMenus: the presenter and its e2e seam', () => {
  const built = () => {
    const tree = fixture();
    const act = actions();
    return { tree, act, menu: bookmarkMenu(tree, { kind: 'folder', nodeId: idOf(tree, 'F') }, act)! };
  };
  const at = { window: { id: 1 } as never, x: 10, y: 30 };

  it('pops the menu natively at the anchor, an Electron template with the same ids and clicks', () => {
    const { menu, act } = built();
    const popup = vi.fn();
    const menus = new NativeMenus({ e2e: false, popup });
    menus.present(menu, at);
    expect(popup).toHaveBeenCalledTimes(1);
    expect(popup.mock.calls[0]![1]).toBe(at);
    const template = popup.mock.calls[0]![0] as ReturnType<typeof toTemplate>;
    expect(template.map((item) => (item.type === 'separator' ? '—' : item.id))).toEqual(toNodes(menu).map((node) => ('id' in node ? node.id : '—')));
    expect(template[2]!.submenu).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'open-all', label: 'Open all (1)' })]));
    (template[4]!.click as () => void)();
    expect(act.openAll).toHaveBeenCalledTimes(1);
    expect(menus.seam.last()).toBeNull(); // only the e2e records
  });

  it('under the e2e records the last menu instead of popping it, and pick runs the item at an id path, once', () => {
    const { tree, menu, act } = built();
    const popup = vi.fn();
    const menus = new NativeMenus({ e2e: true, popup });
    menus.present(menu, at);
    expect(popup).not.toHaveBeenCalled();
    expect(menus.seam.last()).toEqual(toNodes(menu));
    expect(menus.seam.pick([`folder:${idOf(tree, 'G')}`, `bookmark:${idOf(tree, 'G1')}`])).toBe(true);
    expect(act.open).toHaveBeenCalledWith(expect.objectContaining({ name: 'G1' }));
    expect(menus.seam.last()).toBeNull(); // the menu closed with the choice
    expect(menus.seam.pick(['open-all'])).toBe(false);
  });

  it('pick refuses a path that names no item, a submenu, a separator or a disabled line', () => {
    const { tree, menu } = built();
    const menus = new NativeMenus({ e2e: true });
    menus.present(menu, at);
    expect(menus.seam.pick(['bookmark:9999'])).toBe(false);
    expect(menus.seam.pick([`folder:${idOf(tree, 'G')}`])).toBe(false);
    menus.present([{ id: 'empty', label: '(empty)', enabled: false }], at);
    expect(menus.seam.pick(['empty'])).toBe(false);
  });
});
