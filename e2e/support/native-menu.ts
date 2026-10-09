// cua board #90's native-menu seam, the e2e's side (the spec's Interfaces "Native-menu e2e seam"): a native menu cannot be
// driven through CDP, so under MAWS_E2E=1 main records the last menu it built instead of popping it
// (src/main/browser/bookmarks/menu.ts), as a tree of stable ids (`bookmark:<nodeId>`, `folder:<nodeId>`, `open-all`,
// `root:other`, `root:mobile`, `empty`; M3 adds its own), and `pick(path)` runs the item an id path names, as a click.
// "Open all"'s question above 20 tabs is answered by MAWS_E2E_OPEN_ALL_ANSWER at launch and each n asked is kept.
import { expect, type ElectronApplication } from '@playwright/test';

export type MenuNode = { id: string; label: string; enabled?: false; children?: MenuNode[] } | { separator: true };

interface MenuSeam {
  __maws_browser: { menu: { last(): MenuNode[] | null; pick(path: string[]): boolean; openAllAsked(): number[] } };
}

export const lastMenu = (app: ElectronApplication): Promise<MenuNode[] | null> =>
  app.evaluate(() => (globalThis as unknown as MenuSeam).__maws_browser.menu.last());

// The menu main built after `open` ran (a click that asks for one), polled until it differs from the one before.
export async function menuAfter(app: ElectronApplication, open: () => Promise<void>): Promise<MenuNode[]> {
  const before = JSON.stringify(await lastMenu(app));
  await open();
  let menu: MenuNode[] | null = null;
  await expect.poll(async () => JSON.stringify((menu = await lastMenu(app))), { message: 'main built a native menu' }).not.toBe(before);
  expect(menu).not.toBeNull();
  return menu!;
}

export async function pickMenu(app: ElectronApplication, path: string[]): Promise<void> {
  const picked = await app.evaluate((_electron, p) => (globalThis as unknown as MenuSeam).__maws_browser.menu.pick(p), path);
  expect(picked, `the menu item ${path.join(' › ')} exists, is enabled and acts`).toBe(true);
}

export const openAllAsked = (app: ElectronApplication): Promise<number[]> =>
  app.evaluate(() => (globalThis as unknown as MenuSeam).__maws_browser.menu.openAllAsked());

// A menu as labels: an item its label, a submenu `[label, items]`, a separator '—'.
export type MenuShape = string | [string, MenuShape[]];
export const menuShape = (nodes: readonly MenuNode[]): MenuShape[] =>
  nodes.map((node) => ('separator' in node ? '—' : node.children ? [node.label, menuShape(node.children)] : node.label));
export const menuIds = (nodes: readonly MenuNode[]): string[] => nodes.map((node) => ('separator' in node ? '—' : node.id));
