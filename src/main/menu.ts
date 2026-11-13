// The macOS application menu, built from the one action table (C5 execution document, Interfaces "Keymap and action
// table" and M2; residue *Keyboard map*, menu half). Exactly the `menu`-sink actions appear, each with its effective
// chord as the accelerator (so the menu, not the page, owns those keys), and a click or accelerator emits
// `layout.action` for the renderer to run. An action is enabled only while the page has a handler registered for it
// (`layout.setEnabledActions`), so an action whose child has not landed shows disabled, as it does everywhere else.
// The menu is rebuilt on every `settings.changed` (overrides, the checked appearance) and every change of that set.
// Items carry `id` (the action id; `tab.select:<n>` for the nine tab items; `edit.selectAll`, `edit.undo` and `edit.redo`
// for the Edit menu's own items) so the smoke can click them by id.
// U6a (the UX wave's UC-6, "How the sheet and the menus are drawn"): each menu lists its placement's `menu`-sink rows in
// the table's order; rows naming one `submenu` fold into that submenu where its first row stands; a separator stands
// between two neighbours whose group of ids differs. A row a later child adds needs no edit here.
import { Menu, webContents, type BaseWindow, type MenuItemConstructorOptions } from 'electron';
import { appWindows } from './windows'; // E2
import type { Settings, ThemeSetting } from '@shared/ipc/schema';
import type { EditOp } from '@shared/ipc/schema/layout'; // P4-B2 K6
import { ACTIONS, effectiveChord, idsOf, tabChords, type ActionId, type ActionSpec, type ActionTable, type KeymapOverrides } from '@shared/keymap/actions';
import { pageOf } from './ipc/clients';
import type { emit as emitEvent } from './ipc/events';
import { emitTo, onEmitted } from './ipc/events';
import { registerMainHandler } from './ipc/router';

type Emit = typeof emitEvent;
type Item = MenuItemConstructorOptions;
type Placement = NonNullable<ActionSpec['menu']>;

const APPEARANCE: Partial<Record<ActionId, { label: string; theme: ThemeSetting }>> = {
  'theme.light': { label: 'Light', theme: 'light' },
  'theme.dark': { label: 'Dark', theme: 'dark' },
  'theme.system': { label: 'System', theme: 'system' },
};
// Consecutive actions of one group sit together; a separator goes between groups. A row's group is its id's prefix,
// except where the View and Go menus' groups (l7-shell-07) join several prefixes; these aliases are for today's rows only,
// and a row a later child adds groups by its own prefix.
const GROUP_OF_PREFIX: Readonly<Record<string, string>> = {
  sidebar: 'regions', panel: 'regions', region: 'regions', // the sidebar, card column and side-surface layout; Go's region steps
  main: 'pane', // Expand pane among the pane items
  attention: 'session', // Next Needs-you among the session steps
  comments: 'looks', theme: 'looks', accounts: 'looks', // Comments ▸, Appearance ▸ and Usage
};
const group = (id: ActionId) => {
  if (id === 'artifacts.open') return 'tab'; // Artifacts beside Overview: a place, as Overview is
  const prefix = id.split('.')[0]!;
  return GROUP_OF_PREFIX[prefix] ?? prefix;
};

// Edit ▸ Select All is the app's own item, not the `selectAll` role (sitting finding, 2026-09-30). On macOS the role sends
// AppKit's `selectAll:` to the focused element, which in a terminal is xterm's empty helper textarea, so the buffer was
// never selected; and a role item ignores `click` (electron.d.ts, `MenuItemConstructorOptions.role`). This item runs the
// same editor command in the focused contents, so inputs, editors and DevTools behave as under the role, and when that
// is the app's page it emits `layout.selectAll`, on which the terminal holding focus selects its buffer. It keeps the
// role's ⌘A, which a page leaves to it when unhandled; xterm selects on that keydown already, so a second select is a no-op.
// With no window key nothing is focused (an end-to-end run shows its window inactive), and the one window's page stands in.
function selectAll(emit: Emit): void {
  const pages = appWindows().map((win) => win.webContents); // E2: the app's pages, never a capture window's
  const target = webContents.getFocusedWebContents() ?? pages[0];
  if (!target) return;
  target.selectAll();
  if (pages.some((page) => page.id === target.id)) void emit('layout.selectAll', {});
}

// P4-B2 K6 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md, D10; finding 1 of spikes/p4-click-model): Edit ▸
// Undo and Redo are the app's own items too, not the roles. A role runs Blink's Undo, which acts only while Blink's own
// undo stack can undo, and then on the element of its newest step, so a deck's or a design's own stack was never reached
// from the menu. In focused contents that are not an app page (DevTools, a webview) the item runs the native command, as
// the role did. In an app page it tells that page alone (`layout.edit`): an editor claiming the focused element answers
// from its own stack, or the page asks for the native command back (`layout.nativeEdit`, below). A page that cancels ⌘Z
// or ⇧⌘Z (the deck's stage, a text box's Mod-z) keeps the key from the menu, so the items serve the mouse and the keys no
// page handled. With no window key the one window's page stands in, as for Select All.
function edit(op: EditOp): void {
  const pages = appWindows().map((win) => win.webContents); // E2
  const target = webContents.getFocusedWebContents() ?? pages[0];
  if (!target) return;
  if (pages.some((page) => page.id === target.id)) emitTo(target, 'layout.edit', { op });
  else target[op]();
}

// Only explicit shell focus/navigation commands transfer native keyboard ownership. A browser WebContentsView is a
// sibling native surface: HTMLElement.focus in the renderer cannot take the keyboard from it. Resolve its actual host
// (the view manager attaches it directly to contentView), focus that page, then send only that page its DOM action.
const SHELL_FOCUS_ACTIONS: ReadonlySet<ActionId> = new Set([
  'region.focusNext', 'region.focusPrevious', 'sidebar.focus', 'tab.stripNext', 'tab.stripPrevious', 'pane.focusOther',
  'shortcuts.open', 'palette.open',
]);

function dispatchAction(id: ActionId, arg: number | null, emit: Emit, menuWindow?: BaseWindow): void {
  const payload = { action: id, arg };
  if (!SHELL_FOCUS_ACTIONS.has(id)) {
    void emit('layout.action', payload);
    return;
  }
  const windows = appWindows();
  const focused = webContents.getFocusedWebContents();
  const host = windows.find((win) => win === menuWindow) ?? (focused ? windows.find((win) => win.webContents === focused
    || win.contentView.children.some((view) => 'webContents' in view && view.webContents === focused)) : windows[0]);
  if (!host) return;
  host.webContents.focus();
  emitTo(host.webContents, 'layout.action', payload);
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
    click: (_item, window) => dispatchAction(id, arg, emit, window),
    ...extra,
  });

  // The effective chord against the table given (the table's rules: `effectiveChord`).
  const chordOf = (id: ActionId) => effectiveChord(id, overrides, actions);

  const itemsFor = (id: ActionId): Item[] => {
    const chord = chordOf(id);
    if (id === 'tab.select') {
      // One action, nine items: a chord whose key is the digit 1 is numbered through 9 (`tabChords`); any other chord
      // selects the first tab only.
      const nine = chord === null ? null : tabChords(chord);
      return Array.from({ length: 9 }, (_, i) => {
        const n = i + 1;
        return item(id, `Select Tab ${n}`, nine ? nine[i]! : n === 1 ? chord : null, n);
      });
    }
    return [item(id, actions[id].title, chord, null)];
  };

  // A row's items; the theme rows are radio items with the short label Appearance ▸ reads.
  const rowItems = (id: ActionId): Item[] => {
    const look = APPEARANCE[id];
    return look ? [item(id, look.label, chordOf(id), null, { type: 'radio', checked: theme === look.theme })] : itemsFor(id);
  };
  // Items, or submenus of items, each with its group; a separator between neighbours whose group differs.
  const separated = (entries: { group: string; items: Item[] }[]): Item[] =>
    entries.flatMap((entry, i) => (i > 0 && entries[i - 1]!.group !== entry.group ? [{ type: 'separator' } as Item, ...entry.items] : entry.items));

  const section = (placement: Placement): Item[] => {
    const ids = idsOf(actions).filter((id) => actions[id].sink === 'menu' && actions[id].menu === placement);
    // the rows in table order, those of one submenu gathered where its first row stands
    const entries: ({ id: ActionId } | { submenu: string; ids: ActionId[] })[] = [];
    for (const id of ids) {
      const name = actions[id].submenu;
      const open = name === undefined ? undefined : entries.find((entry) => 'submenu' in entry && entry.submenu === name);
      if (open && 'ids' in open) open.ids.push(id);
      else entries.push(name === undefined ? { id } : { submenu: name, ids: [id] });
    }
    return separated(entries.map((entry) => 'id' in entry
      ? { group: group(entry.id), items: rowItems(entry.id) }
      : { group: group(entry.ids[0]!), items: [{ label: entry.submenu, submenu: separated(entry.ids.map((id) => ({ group: group(id), items: rowItems(id) }))) }] }));
  };

  // The application menu spelled out (what `role: 'appMenu'` builds), so actions placed in it sit after About.
  const own = section('app');
  const editRows = section('edit');
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
        { id: 'edit.undo', label: 'Undo', accelerator: 'Cmd+Z', click: () => edit('undo') }, // P4-B2 K6
        { id: 'edit.redo', label: 'Redo', accelerator: 'Cmd+Shift+Z', click: () => edit('redo') }, // P4-B2 K6
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'delete' },
        { id: 'edit.selectAll', label: 'Select All', accelerator: 'Cmd+A', click: () => selectAll(emit) },
        ...(editRows.length > 0 ? [{ type: 'separator' } as Item, ...editRows] : []), // U6a: the table's Edit rows
      ],
    },
    {
      label: 'View',
      // No zoom roles: ⌘0 is the Overview. U6a: the developer roles under Developer ▸, the menu's own
      submenu: [
        ...section('view'), { type: 'separator' },
        { label: 'Developer', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }] },
        { type: 'separator' }, { role: 'togglefullscreen' },
      ],
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
  // P4-B2 K6: an Edit ▸ Undo or Redo the asking page's editors did not claim, run natively in that page (its focused frame)
  registerMainHandler('layout.nativeEdit', ({ op }, { client }) => void pageOf(client)?.[op]());
}
