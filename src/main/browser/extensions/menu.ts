// The extensions action bar's native menus (cua board #90's spec, "The bar" of the extensions action bar), built as the
// bookmarks bar's are (bookmarks/menu.ts: one `MenuSpec`, one presenter, the e2e's seam by id path): the puzzle button's
// menu when the icons fold (every action, doing what its button does; Options for each extension that has one;
// Manage extensions…), and an action's context menu (its name, Options, Manage extensions…). Native, so macOS draws them
// above the page and the page stays live. Ids: `action:<extensionId>`, `options` (the submenu), `options:<extensionId>`,
// `name`, `manage`. Extension names are the extension's own strings, shown as labels only.
import type { MenuSpec } from '../bookmarks/menu';
import type { LoadedAction } from './actions';

export const EXTENSION_MENU_COPY = {
  options: 'Options', // Chrome's
  manage: 'Manage extensions…', // Chrome's
};

export interface ExtensionMenuActions {
  open(extensionId: string): void; // the action's popup, under the menu's button
  options(extensionId: string): void;
  manage(): void; // Settings › Browser, where the profile's extensions are turned on and off
}

const SEPARATOR = { separator: true } as const;
const manage = (on: ExtensionMenuActions): MenuSpec => ({ id: 'manage', label: EXTENSION_MENU_COPY.manage, click: () => on.manage() });

export function puzzleMenu(actions: readonly LoadedAction[], on: ExtensionMenuActions): MenuSpec[] {
  const items: MenuSpec[] = actions.map((action) => ({
    id: `action:${action.extensionId}`,
    label: action.title,
    ...(action.hasPopup ? { click: () => on.open(action.extensionId) } : { enabled: false }),
  }));
  const options = actions.filter((action) => action.hasOptions);
  if (options.length > 0) {
    items.push(SEPARATOR, {
      id: 'options',
      label: EXTENSION_MENU_COPY.options,
      submenu: options.map((action) => ({ id: `options:${action.extensionId}`, label: action.name, click: () => on.options(action.extensionId) })),
    });
  }
  return items.length > 0 ? [...items, SEPARATOR, manage(on)] : [manage(on)];
}

export function actionMenu(action: LoadedAction, on: ExtensionMenuActions): MenuSpec[] {
  return [
    { id: 'name', label: action.name, enabled: false },
    SEPARATOR,
    ...(action.hasOptions ? [{ id: `options:${action.extensionId}`, label: EXTENSION_MENU_COPY.options, click: () => on.options(action.extensionId) }] : []),
    manage(on),
  ];
}
