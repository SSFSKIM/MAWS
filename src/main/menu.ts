// The macOS application menu, built from the one action table (C5 execution document, Interfaces "Keymap and action
// table" and M2; residue *Keyboard map*, menu half). Exactly the `menu`-sink actions appear, each with its effective
// chord as the accelerator (so the menu, not the page, owns those keys), and a click or accelerator emits
// `layout.action` for the renderer to run. An action is enabled only while the page has a handler registered for it
// (`layout.setEnabledActions`), so an action whose child has not landed shows disabled, as it does everywhere else.
// The menu is rebuilt on every `settings.changed` (overrides, the checked appearance) and every change of that set.
// Items carry `id` (the action id; `tab.select:<n>` for the nine tab items; `edit.selectAll` for the Edit menu's own
// Select All) so the smoke can click them by id.
import { BrowserWindow, Menu, webContents, type MenuItemConstructorOptions } from 'electron';
import type { Settings, ThemeSetting } from '@shared/ipc/schema';
import { ACTIONS, ACTION_IDS, type ActionId, type ActionSpec, type KeymapOverrides } from '@shared/keymap/actions';
import type { emit as emitEvent } from './ipc/events';
import { onEmitted } from './ipc/events';
import { registerMainHandler } from './ipc/router';

type Emit = typeof emitEvent;
type Item = MenuItemConstructorOptions;
type Placement = NonNullable<ActionSpec['menu']>;
type ActionTable = Readonly<Record<ActionId, ActionSpec>>;

const APPEARANCE: Partial<Record<ActionId, { label: string; theme: ThemeSetting }>> = {
  'theme.light': { label: 'Light', theme: 'light' },
  'theme.dark': { label: 'Dark', theme: 'dark' },
  'theme.system': { label: 'System', theme: 'system' },
};
// Consecutive actions of one group sit together; a separator goes between groups.
const group = (id: ActionId) => (id.startsWith('sidebar.') || id.startsWith('panel.') ? 'regions' : id.split('.')[0]);

// Edit ▸ Select All is the app's own item, not the `selectAll` role (sitting finding, 2026-09-30). On macOS the role sends
// AppKit's `selectAll:` to the focused element, which in a terminal is xterm's empty helper textarea, so the buffer was
// never selected; and a role item ignores `click` (electron.d.ts, `MenuItemConstructorOptions.role`). This item runs the
// same editor command in the focused contents, so inputs, editors and DevTools behave as under the role, and when that
// is the app's page it emits `layout.selectAll`, on which the terminal holding focus selects its buffer. It keeps the
// role's ⌘A, which a page leaves to it when unhandled; xterm selects on that keydown already, so a second select is a no-op.
// With no window key nothing is focused (an end-to-end run shows its window inactive), and the one window's page stands in.
function selectAll(emit: Emit): void {
  const pages = BrowserWindow.getAllWindows().map((win) => win.webContents);
  const target = webContents.getFocusedWebContents() ?? pages[0];
  if (!target) return;
  target.selectAll();
  if (pages.some((page) => page.id === target.id)) void emit('layout.selectAll', {});
}

export function menuTemplate(
  actions: ActionTable,
  overrides: KeymapOverrides,
  enabled: ReadonlySet<ActionId>,
  emit: Emit,
  theme: ThemeSetting | null = null,
): Item[] {
  const item = (id: ActionId, label: string, accelerator: string | null, arg: number | null, extra: Partial<Item> = {}): Item => ({
    id: arg === null ? id : `${id}:${arg}`,
    label,
    ...(accelerator ? { accelerator } : {}),
    enabled: enabled.has(id),
    click: () => void emit('layout.action', { action: id, arg }),
    ...extra,
  });

  // The effective chord against the table given (overrides first; null unbinds).
  const chordOf = (id: ActionId) => (overrides[id] === undefined ? actions[id].chord : overrides[id]);

  const itemsFor = (id: ActionId): Item[] => {
    const chord = chordOf(id);
    if (id === 'tab.select') {
      // One action, nine items: a chord ending in 1 is numbered through 9; any other chord selects the first tab only.
      return Array.from({ length: 9 }, (_, i) => {
        const n = i + 1;
        const accelerator = chord?.endsWith('1') ? `${chord.slice(0, -1)}${n}` : n === 1 ? chord : null;
        return item(id, `Select Tab ${n}`, accelerator, n);
      });
    }
    return [item(id, actions[id].title, chord, null)];
  };

  const section = (placement: Placement): Item[] => {
    const ids = ACTION_IDS.filter((id) => actions[id].sink === 'menu' && actions[id].menu === placement);
    const out: Item[] = [];
    const appearance: Item[] = [];
    let last: string | null = null;
    for (const id of ids) {
      const look = APPEARANCE[id];
      if (look) {
        appearance.push(item(id, look.label, chordOf(id), null, { type: 'radio', checked: theme === look.theme }));
        continue;
      }
      if (last !== null && group(id) !== last) out.push({ type: 'separator' });
      last = group(id);
      out.push(...itemsFor(id));
    }
    if (appearance.length > 0) out.push({ type: 'separator' }, { label: 'Appearance', submenu: appearance });
    return out;
  };

  // The application menu spelled out (what `role: 'appMenu'` builds), so actions placed in it sit after About.
  const own = section('app');
  const appMenu: Item[] = [
    { role: 'about' },
    { type: 'separator' },
    ...(own.length > 0 ? [...own, { type: 'separator' } as Item] : []),
    { role: 'services' },
    { type: 'separator' },
    { role: 'hide' },
    { role: 'hideOthers' },
    { role: 'unhide' },
    { type: 'separator' },
    { role: 'quit' },
  ];

  return [
    { label: 'MAWS', submenu: appMenu },
    { label: 'File', submenu: section('file') },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'delete' },
        { id: 'edit.selectAll', label: 'Select All', accelerator: 'Cmd+A', click: () => selectAll(emit) },
      ],
    },
    {
      label: 'View',
      // No zoom roles: ⌘0 is the Overview.
      submenu: [...section('view'), { type: 'separator' }, { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
    { label: 'Go', submenu: section('go') },
    // Explicit rather than `windowMenu`, so no `close` role can take ⌘W from the tab strip.
    { label: 'Window', role: 'window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] },
    { label: 'Help', role: 'help', submenu: section('help') },
  ];
}

export function buildMenu(actions: ActionTable, overrides: KeymapOverrides, enabled: ReadonlySet<ActionId>, emit: Emit, theme: ThemeSetting | null = null): Menu {
  return Menu.buildFromTemplate(menuTemplate(actions, overrides, enabled, emit, theme));
}

export interface AppMenu {
  setEnabled(actions: ActionId[]): void;
  stop(): void;
}

// Installs the menu now (every action disabled until the page reports its handlers) and keeps it current.
export function startMenu(deps: { settings(): Settings; emit: Emit }): AppMenu {
  let settings = deps.settings();
  let enabled = new Set<ActionId>();
  const install = () => Menu.setApplicationMenu(buildMenu(ACTIONS, settings.keymap, enabled, deps.emit, settings.theme));
  const off = onEmitted('settings.changed', (state) => {
    settings = state.settings;
    install();
  });
  install();
  return {
    setEnabled(actions) {
      const next = new Set(actions);
      if (next.size === enabled.size && [...next].every((id) => enabled.has(id))) return;
      enabled = next;
      install();
    },
    stop: off,
  };
}

export function registerMenuHandlers(menu: AppMenu): void {
  registerMainHandler('layout.setEnabledActions', ({ actions }) => menu.setEnabled(actions));
}
