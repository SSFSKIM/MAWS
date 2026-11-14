import { EventEmitter } from 'node:events';
import type { MenuItemConstructorOptions } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientOf } from './ipc/clients';
import type { Settings } from '@shared/ipc/schema';
import { ACTIONS, ACTION_IDS, idsOf, type ActionId, type ActionTable, type KeymapOverrides } from '@shared/keymap/actions';
import { EXTENDED_TABLE, SAMPLE_ROWS, sample } from '@shared/keymap/sample-rows'; // U6a
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { keyAction, type KeyInput } from './browser/keys'; // U6a: the in-app browser's page keys (A7)

interface Contents {
  id: number;
  selectAll(): void;
  focus(): void;
  // P4-B2 K6: the native commands the Edit menu's Undo and Redo run, and the one page's event they send
  undo(): void;
  redo(): void;
  send(channel: string, payload: unknown): void;
  isDestroyed(): boolean;
}
const electron = vi.hoisted(() => ({
  setApplicationMenu: vi.fn(),
  windows: [] as { webContents: Contents; contentView?: { children: { webContents?: Contents }[] } }[],
  focused: null as Contents | null,
  handlers: new Map<string, (input: unknown, context: { client: unknown }) => unknown>(), // P4-B2 K6: main's handlers
}));
vi.mock('./windows', () => ({ appWindows: () => electron.windows })); // E2: the app-window registry Select All reads
vi.mock('electron', () => ({
  Menu: { buildFromTemplate: (template: unknown) => ({ template }), setApplicationMenu: electron.setApplicationMenu },
  BrowserWindow: { getAllWindows: () => electron.windows },
  webContents: { getFocusedWebContents: () => electron.focused },
}));
vi.mock('./ipc/router', () => ({ registerMainHandler: (name: string, handler: never) => electron.handlers.set(name, handler) })); // P4-B2 K6

const { emit } = await import('./ipc/events');
const { menuTemplate, registerMenuHandlers, startMenu } = await import('./menu');
const { eventChannel } = await import('@shared/ipc/schema'); // P4-B2 K6

type Item = MenuItemConstructorOptions;
const SETTINGS: Settings = SETTINGS_DEFAULTS_V21;
const ALL = new Set<ActionId>(ACTION_IDS);
const TABLES: [string, ActionTable][] = [['the table', ACTIONS], ['the table with the sample rows', EXTENDED_TABLE]]; // U6a (decision 12)

function items(template: Item[]): Item[] {
  return template.flatMap((item) => [item, ...(Array.isArray(item.submenu) ? items(item.submenu) : [])]);
}
const EDIT_ITEMS = new Set(['edit.selectAll', 'edit.undo', 'edit.redo']); // the Edit menu's own items, not actions (P4-B2 K6: Undo, Redo)
const actionItems = (template: Item[]) => items(template).filter((item) => item.id !== undefined && !EDIT_ITEMS.has(item.id));
const actionOf = (item: Item) => item.id!.split(':')[0] as ActionId;
const byId = (template: Item[], id: string) => items(template).find((item) => item.id === id);
const top = (template: Item[], label: string) => template.find((item) => item.label === label);

describe('application menu', () => {
  it.each(TABLES)('contains exactly the menu-sink actions, each with its effective chord (%s)', (_name, table) => {
    const template = menuTemplate(table, {}, new Set(idsOf(table)), vi.fn());
    expect([...new Set(actionItems(template).map(actionOf))].sort()).toEqual(idsOf(table).filter((id) => table[id].sink === 'menu').sort());
    for (const item of actionItems(template)) {
      const id = actionOf(item);
      if (id === 'tab.select') continue; // expanded below
      expect(item.accelerator ?? null, id).toBe(table[id].chord);
    }
  });

  it('expands tab.select to nine items Cmd+1 … Cmd+9 carrying arg 1..9', () => {
    const send = vi.fn();
    const template = menuTemplate(ACTIONS, {}, ALL, send);
    const selects = actionItems(template).filter((item) => actionOf(item) === 'tab.select');
    expect(selects.map((item) => item.accelerator)).toEqual(['Cmd+1', 'Cmd+2', 'Cmd+3', 'Cmd+4', 'Cmd+5', 'Cmd+6', 'Cmd+7', 'Cmd+8', 'Cmd+9']);
    (selects[3].click as () => void)();
    expect(send).toHaveBeenCalledWith('layout.action', { action: 'tab.select', arg: 4 });
  });

  it('a click emits layout.action with the action id and a null arg', () => {
    const send = vi.fn();
    const template = menuTemplate(ACTIONS, {}, ALL, send);
    (byId(template, 'panel.toggle')!.click as () => void)();
    expect(send).toHaveBeenCalledWith('layout.action', { action: 'panel.toggle', arg: null });
  });

  it('honours overrides: a rebound chord, and null unbinds', () => {
    const template = menuTemplate(ACTIONS, { 'attention.next': 'Cmd+Alt+J', 'tab.close': null }, ALL, vi.fn());
    expect(byId(template, 'attention.next')!.accelerator).toBe('Cmd+Alt+J');
    expect(byId(template, 'tab.close')!.accelerator).toBeUndefined();
  });

  it('renders an action without a registered handler disabled', () => {
    const template = menuTemplate(ACTIONS, {}, new Set<ActionId>(['sidebar.toggle']), vi.fn());
    expect(byId(template, 'sidebar.toggle')!.enabled).toBe(true);
    expect(byId(template, 'session.new')!.enabled).toBe(false);
    expect(byId(template, 'tab.select:1')!.enabled).toBe(false);
  });

  it('puts Appearance under View with the current theme checked', () => {
    const template = menuTemplate(ACTIONS, {}, ALL, vi.fn(), 'dark');
    const appearance = (top(template, 'View')!.submenu as Item[]).find((item) => item.label === 'Appearance')!;
    expect((appearance.submenu as Item[]).map((item) => [item.id, item.label, item.checked])).toEqual([
      ['theme.light', 'Light', false],
      ['theme.dark', 'Dark', true],
      ['theme.system', 'System', false],
    ]);
  });

  it('places an action whose menu is app in the application menu, after About (C11’s Settings… ⌘,)', () => {
    // C11: settings.open is the one action placed there (it replaced the stand-in this test used before it landed).
    const template = menuTemplate(ACTIONS, {}, ALL, vi.fn());
    const appMenu = template[0].submenu as Item[];
    expect(appMenu.map((item) => item.role ?? item.id ?? item.type)).toEqual([
      'about', 'separator', 'settings.open', 'separator', 'services', 'separator', 'hide', 'hideOthers', 'unhide', 'separator', 'quit',
    ]);
    expect(byId(template, 'settings.open')).toMatchObject({ label: 'Settings…', accelerator: 'Cmd+,' });
    // With no app-menu action the application menu is the standard one, with no empty group.
    const table = { ...ACTIONS, 'settings.open': { ...ACTIONS['settings.open'], menu: 'help' as const } };
    const standard = menuTemplate(table, {}, ALL, vi.fn())[0].submenu as Item[];
    expect(standard.map((item) => item.role ?? item.type)).toEqual(['about', 'separator', 'services', 'separator', 'hide', 'hideOthers', 'unhide', 'separator', 'quit']);
  });

  it('keeps the standard Edit and Window roles and leaves out close, so ⌘W is the shell’s', () => {
    const template = menuTemplate(ACTIONS, {}, ALL, vi.fn());
    const roles = items(template).map((item) => item.role).filter(Boolean);
    expect(roles).not.toContain('close');
    expect(roles).not.toContain('resetZoom'); // ⌘0 is the Overview
    const edit = (top(template, 'Edit')!.submenu as Item[]).map((item) => item.role);
    expect(edit).toEqual(expect.arrayContaining(['cut', 'copy', 'paste'])); // P4-B2 K6: Undo and Redo are the app's own (below)
    expect((top(template, 'Window')!.submenu as Item[]).map((item) => item.role).filter(Boolean)).toEqual(['minimize', 'zoom', 'front']);
    const accelerators = actionItems(template).map((item) => item.accelerator).filter(Boolean);
    expect(new Set(accelerators).size).toBe(accelerators.length);
  });
});

// Sitting finding (2026-09-30): Edit ▸ Select All left a focused terminal's buffer unselected. The `selectAll` role sends
// AppKit's `selectAll:` to the focused element (a terminal's is xterm's empty helper textarea) and ignores `click`
// (electron.d.ts, MenuItemConstructorOptions.role), so the item is the app's own.
describe('Edit ▸ Select All', () => {
  const selectAll = (send = vi.fn()) => (top(menuTemplate(ACTIONS, {}, ALL, send), 'Edit')!.submenu as Item[]).find((item) => item.label === 'Select All')!;
  const contents = (id: number): Contents => ({ id, selectAll: vi.fn(), focus: vi.fn(), undo: vi.fn(), redo: vi.fn(), send: vi.fn(), isDestroyed: () => false });
  afterEach(() => {
    electron.windows = [];
    electron.focused = null;
  });

  it('is the app’s own item holding ⌘A rather than the selectAll role', () => {
    expect(selectAll()).toMatchObject({ id: 'edit.selectAll', accelerator: 'Cmd+A' });
    expect(selectAll().role).toBeUndefined();
  });

  it('runs the editor command in the focused page, as the role did, and tells the page so a focused terminal selects its buffer', () => {
    const page = contents(1);
    electron.windows = [{ webContents: page }];
    electron.focused = page;
    const send = vi.fn();
    (selectAll(send).click as () => void)();
    expect(page.selectAll).toHaveBeenCalledTimes(1);
    expect(send.mock.calls).toEqual([['layout.selectAll', {}]]);
  });

  it('runs it in the window’s page when no contents hold focus (a window shown without being key)', () => {
    const page = contents(1);
    electron.windows = [{ webContents: page }];
    const send = vi.fn();
    (selectAll(send).click as () => void)();
    expect(page.selectAll).toHaveBeenCalledTimes(1);
    expect(send.mock.calls).toEqual([['layout.selectAll', {}]]);
  });

  it('runs it in other focused contents (DevTools) and leaves the page alone', () => {
    const page = contents(1);
    const devtools = contents(2);
    electron.windows = [{ webContents: page }];
    electron.focused = devtools;
    const send = vi.fn();
    (selectAll(send).click as () => void)();
    expect(devtools.selectAll).toHaveBeenCalledTimes(1);
    expect(page.selectAll).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

// P4-B2 K6 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md, D10; finding 1 of spikes/p4-click-model): the
// Edit menu's Undo and Redo never reached a deck's or a design's own stack. The roles run Blink's Undo, which acts only
// while Blink's own undo stack can undo, and then on the newest undo step's element. The items are the app's own: a page
// is told which op and answers it from its focused editor, or asks for the native command back; any other contents run
// the native command as the roles did.
describe('Edit ▸ Undo and Redo', () => {
  const editItem = (id: string, send = vi.fn()) => items(menuTemplate(ACTIONS, {}, ALL, send)).find((item) => item.id === id)!;
  const click = (id: string, send = vi.fn()) => (editItem(id, send).click as () => void)();
  const contents = (id: number): Contents => ({ id, selectAll: vi.fn(), focus: vi.fn(), undo: vi.fn(), redo: vi.fn(), send: vi.fn(), isDestroyed: () => false });
  const sent = (target: Contents) => vi.mocked(target.send).mock.calls;
  const calls = (...fns: (() => void)[]) => fns.map((fn) => vi.mocked(fn).mock.calls.length);
  afterEach(() => {
    electron.windows = [];
    electron.focused = null;
  });

  it('are the app’s own items holding ⌘Z and ⇧⌘Z, always enabled, ahead of the clipboard’s', () => {
    const edit = top(menuTemplate(ACTIONS, {}, new Set<ActionId>(), vi.fn()), 'Edit')!.submenu as Item[];
    expect(edit.slice(0, 3).map((item) => item.id ?? item.type)).toEqual(['edit.undo', 'edit.redo', 'separator']);
    expect(edit[0]).toMatchObject({ id: 'edit.undo', label: 'Undo', accelerator: 'Cmd+Z' });
    expect(edit[1]).toMatchObject({ id: 'edit.redo', label: 'Redo', accelerator: 'Cmd+Shift+Z' });
    for (const item of edit.slice(0, 2)) {
      expect(item.role).toBeUndefined();
      expect(item.enabled ?? true).toBe(true); // with no action enabled, as Select All is
    }
  });

  it('tell the focused app page alone which op, and run nothing natively', () => {
    const page = contents(1);
    const other = contents(2); // a second window's page: its own focused element is not this one's
    electron.windows = [{ webContents: page }, { webContents: other }];
    electron.focused = page;
    const send = vi.fn();
    click('edit.undo', send);
    click('edit.redo', send);
    expect(sent(page)).toEqual([
      [eventChannel('layout.edit'), { op: 'undo' }],
      [eventChannel('layout.edit'), { op: 'redo' }],
    ]);
    expect(sent(other)).toEqual([]);
    expect(send).not.toHaveBeenCalled(); // not broadcast
    expect(calls(page.undo, page.redo, other.undo, other.redo)).toEqual([0, 0, 0, 0]);
  });

  it('tell the window’s page when no contents hold focus (a window shown without being key)', () => {
    const page = contents(1);
    electron.windows = [{ webContents: page }];
    click('edit.undo');
    expect(sent(page)).toEqual([[eventChannel('layout.edit'), { op: 'undo' }]]);
    expect(page.undo).not.toHaveBeenCalled();
  });

  it('run the native command in other focused contents (DevTools, a webview) and leave the page alone, as the roles did', () => {
    const page = contents(1);
    const devtools = contents(2);
    electron.windows = [{ webContents: page }];
    electron.focused = devtools;
    click('edit.undo');
    click('edit.redo');
    expect(calls(devtools.undo, devtools.redo)).toEqual([1, 1]);
    expect(sent(page)).toEqual([]);
    expect(sent(devtools)).toEqual([]);
  });

  it('do nothing with no window at all', () => {
    expect(() => click('edit.undo')).not.toThrow();
  });

  it('layout.nativeEdit runs the native command in the page that asked (no editor of its own claimed the op)', () => {
    registerMenuHandlers({ setEnabled: vi.fn(), stop: vi.fn() });
    const page = Object.assign(new EventEmitter(), contents(1));
    const nativeEdit = electron.handlers.get('layout.nativeEdit')!;
    nativeEdit({ op: 'undo' }, { client: clientOf(page as never) });
    nativeEdit({ op: 'redo' }, { client: clientOf(page as never) });
    expect(calls(page.undo, page.redo)).toEqual([1, 1]);
    page.isDestroyed = () => true;
    page.emit('destroyed'); // a page gone by the time its op arrives runs nothing
    nativeEdit({ op: 'undo' }, { client: clientOf(page as never) });
    expect(calls(page.undo, page.redo)).toEqual([1, 1]);
  });
});

describe('shell focus actions from native browser views', () => {
  const contents = (id: number): Contents => ({ id, selectAll: vi.fn(), focus: vi.fn(), undo: vi.fn(), redo: vi.fn(), send: vi.fn(), isDestroyed: () => false });
  afterEach(() => {
    electron.windows = [];
    electron.focused = null;
  });

  it.each(['region.focusNext', 'region.focusPrevious', 'sidebar.focus', 'tab.stripNext', 'tab.stripPrevious', 'pane.focusOther', 'shortcuts.open', 'palette.open'])(
    '%s focuses the browser view’s actual shell host before delivering the action to that page alone', (id) => {
      const otherPage = contents(1);
      const hostPage = contents(2);
      const browserPage = contents(3);
      electron.windows = [
        { webContents: otherPage, contentView: { children: [] } },
        { webContents: hostPage, contentView: { children: [{}, { webContents: browserPage }] } },
      ];
      electron.focused = browserPage;
      const send = vi.fn();
      (byId(menuTemplate(ACTIONS, {}, ALL, send), id)!.click as () => void)();
      expect(hostPage.focus).toHaveBeenCalledOnce();
      expect(hostPage.send).toHaveBeenCalledWith(eventChannel('layout.action'), { action: id, arg: null });
      expect(vi.mocked(hostPage.focus).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(hostPage.send).mock.invocationCallOrder[0]!);
      expect(otherPage.focus).not.toHaveBeenCalled();
      expect(otherPage.send).not.toHaveBeenCalled();
      expect(browserPage.focus).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled(); // no broadcast to other windows
    },
  );

  it('uses the menu callback’s actual app window when no contents hold focus', () => {
    const first = { webContents: contents(1), contentView: { children: [] } };
    const second = { webContents: contents(2), contentView: { children: [] } };
    electron.windows = [first, second];
    const send = vi.fn();
    (byId(menuTemplate(ACTIONS, {}, ALL, send), 'region.focusNext')!.click as (item: unknown, window: unknown) => void)({}, second);
    expect(second.webContents.focus).toHaveBeenCalledOnce();
    expect(second.webContents.send).toHaveBeenCalledWith(eventChannel('layout.action'), { action: 'region.focusNext', arg: null });
    expect(first.webContents.focus).not.toHaveBeenCalled();
    expect(first.webContents.send).not.toHaveBeenCalled();
  });

  it('does not pull native focus away for unrelated menu actions', () => {
    const hostPage = contents(1);
    const browserPage = contents(2);
    electron.windows = [{ webContents: hostPage, contentView: { children: [{ webContents: browserPage }] } }];
    electron.focused = browserPage;
    const send = vi.fn();
    (byId(menuTemplate(ACTIONS, {}, ALL, send), 'theme.light')!.click as () => void)();
    expect(hostPage.focus).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('layout.action', { action: 'theme.light', arg: null });
  });

  it('does not send a focus action to an arbitrary app window when other native contents hold focus', () => {
    const page = contents(1);
    electron.windows = [{ webContents: page, contentView: { children: [] } }];
    electron.focused = contents(2); // DevTools or a window outside the app registry
    const send = vi.fn();
    (byId(menuTemplate(ACTIONS, {}, ALL, send), 'region.focusNext')!.click as () => void)();
    expect(page.focus).not.toHaveBeenCalled();
    expect(page.send).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('the installed menu', () => {
  beforeEach(() => electron.setApplicationMenu.mockClear());
  const installed = () => electron.setApplicationMenu.mock.calls.at(-1)![0].template as Item[];

  it('is installed at start with every action disabled until the page reports its handlers', () => {
    const menu = startMenu({ settings: () => SETTINGS, emit: vi.fn() });
    expect(electron.setApplicationMenu).toHaveBeenCalledTimes(1);
    expect(actionItems(installed()).every((item) => item.enabled === false)).toBe(true);
    menu.setEnabled(['panel.toggle']);
    expect(byId(installed(), 'panel.toggle')!.enabled).toBe(true);
    expect(byId(installed(), 'sidebar.toggle')!.enabled).toBe(false);
    menu.stop();
  });

  it('rebuilds when an override changes attention.next to Cmd+Alt+J', () => {
    let settings = SETTINGS;
    const menu = startMenu({ settings: () => settings, emit: vi.fn() });
    expect(byId(installed(), 'attention.next')!.accelerator).toBe('Cmd+Shift+J');
    settings = { ...SETTINGS, keymap: { 'attention.next': 'Cmd+Alt+J' } };
    emit('settings.changed', { settings, resolvedTheme: 'light' });
    expect(byId(installed(), 'attention.next')!.accelerator).toBe('Cmd+Alt+J');
    menu.stop();
    const calls = electron.setApplicationMenu.mock.calls.length;
    emit('settings.changed', { settings, resolvedTheme: 'light' });
    expect(electron.setApplicationMenu).toHaveBeenCalledTimes(calls);
  });

  // The panel's finding of 2026-11-12, "tab-chord expansion past F24": a valid stored Select tab chord whose key is not
  // the digit 1 is the first tab's alone, and the menu installs with it
  it('installs with a stored Select tab of F21: Select Tab 1 holds it and tabs 2 to 9 none; Cmd+Alt+1 still numbers', () => {
    const menu = startMenu({ settings: () => ({ ...SETTINGS, keymap: { 'tab.select': 'F21' } }), emit: vi.fn() });
    expect(electron.setApplicationMenu).toHaveBeenCalledTimes(1);
    const tabs = Array.from({ length: 9 }, (_, i) => byId(installed(), `tab.select:${i + 1}`)?.accelerator ?? null);
    expect(tabs).toEqual(['F21', null, null, null, null, null, null, null, null]);
    menu.stop();
    const numbered = menuTemplate(ACTIONS, { 'tab.select': 'Cmd+Alt+1' }, ALL, vi.fn());
    expect(Array.from({ length: 9 }, (_, i) => byId(numbered, `tab.select:${i + 1}`)?.accelerator)).toEqual(Array.from({ length: 9 }, (_, i) => `Cmd+Alt+${i + 1}`));
  });

  it('does not rebuild for an unchanged enabled set', () => {
    const menu = startMenu({ settings: () => SETTINGS, emit: vi.fn() });
    menu.setEnabled(['panel.toggle', 'sidebar.toggle']);
    const calls = electron.setApplicationMenu.mock.calls.length;
    menu.setEnabled(['sidebar.toggle', 'panel.toggle']);
    expect(electron.setApplicationMenu).toHaveBeenCalledTimes(calls);
    menu.stop();
  });
});

// E5 start: the editor's save in the File menu (E5 execution document, Interfaces *The close guard and the action*)
describe('File ▸ Save file', () => {
  it('follows the tab items as its own group, at ⌘S', () => {
    const file = top(menuTemplate(ACTIONS, {}, ALL, vi.fn()), 'File')!.submenu as Item[];
    expect(file.map((item) => item.id ?? item.type)).toEqual(['session.new', 'separator', 'tab.close', 'tab.reopen', 'separator', 'file.save', 'file.commentLine']);
    expect(byId(file, 'file.save')).toMatchObject({ label: 'Save file', accelerator: 'Cmd+S' });
    expect(byId(file, 'file.commentLine')).toMatchObject({ label: 'Comment on this line' }); // E11: unbound by default
    expect(byId(file, 'file.commentLine')?.accelerator).toBeUndefined();
  });
});
// E5 end

// U6a start (the UX wave's U6, first landing; A9, A7's first sentence, decisions 2 to 5, 10 and 12): the menus drawn
// from the table's order, placements and submenus, with separators between groups of ids. Every generic assertion runs
// over the table and over the table extended with sample rows shaped as the siblings' will be.
describe('the menus drawn from the table', () => {
  const PLACEMENT_LABEL = { app: 'MAWS', file: 'File', edit: 'Edit', view: 'View', go: 'Go', help: 'Help' } as const;
  const submenuOf = (template: Item[], label: string) => (template.find((item) => item.label === label)?.submenu ?? []) as Item[];
  // Each top-level menu's action items with the submenu they sit in (null directly in the menu).
  const placed = (template: Item[]) =>
    template.flatMap((menu) =>
      (menu.submenu as Item[]).flatMap((item) =>
        Array.isArray(item.submenu)
          ? (item.submenu as Item[]).filter((child) => child.id !== undefined).map((child) => ({ menu: menu.label, submenu: item.label ?? null, id: child.id! }))
          : item.id !== undefined ? [{ menu: menu.label, submenu: null, id: item.id }] : [],
      ),
    );
  // A menu as it reads: an item its label (a role its role), a submenu `<label> ▸`, a separator '—'.
  const shape = (items: Item[]) => items.map((item) => (item.type === 'separator' ? '—' : Array.isArray(item.submenu) ? `${item.label} ▸` : (item.label ?? String(item.role))));
  const subsequence = (whole: string[], part: string[]) => {
    let at = 0;
    for (const token of whole) if (token === part[at]) at++;
    return at === part.length;
  };

  it.each(TABLES)('places every menu-sink row once (Select tab nine times) under its placement and its submenu (%s)', (_name, table) => {
    const where = placed(menuTemplate(table, {}, new Set(idsOf(table)), vi.fn())).filter((entry) => !EDIT_ITEMS.has(entry.id));
    for (const id of idsOf(table).filter((id) => table[id].sink === 'menu')) {
      const spec = table[id];
      const found = where.filter((entry) => actionOf({ id: entry.id }) === id);
      expect(found.length, id).toBe(id === 'tab.select' ? 9 : 1);
      for (const entry of found) expect({ menu: entry.menu, submenu: entry.submenu }, id).toEqual({ menu: PLACEMENT_LABEL[spec.menu!], submenu: spec.submenu ?? null });
    }
  });

  it.each(TABLES)('opens, closes and separates no menu with a separator, nor sets two in a row (%s)', (_name, table) => {
    const menus = (items: Item[]): Item[][] => [items, ...items.flatMap((item) => (Array.isArray(item.submenu) ? menus(item.submenu as Item[]) : []))];
    for (const items of menus(menuTemplate(table, {}, new Set(idsOf(table)), vi.fn()))) {
      const read = shape(items);
      expect(read[0], read.join(' ')).not.toBe('—');
      expect(read.at(-1), read.join(' ')).not.toBe('—');
      expect(read.join(' '), 'two separators in a row').not.toContain('— —');
    }
  });

  it('puts an edit row after the Edit menu’s own items, in its submenu', () => {
    const edit = submenuOf(menuTemplate(EXTENDED_TABLE, {}, new Set(idsOf(EXTENDED_TABLE)), vi.fn()), 'Edit');
    expect(shape(edit)).toEqual(['Undo', 'Redo', '—', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'delete', 'Select All', '—', 'Sample ▸']);
    expect((edit.at(-1)!.submenu as Item[]).map((item) => item.id)).toEqual([sample('sample.menu')]);
    expect(shape(submenuOf(menuTemplate(ACTIONS, {}, ALL, vi.fn()), 'Edit')).at(-1)).toBe('Select All'); // no edit row today: nothing after
  });

  it('reads View and Go in groups, with Tabs, More surfaces, Comments, Appearance and Developer as submenus', () => {
    const template = menuTemplate(ACTIONS, {}, ALL, vi.fn());
    const view = submenuOf(template, 'View');
    expect(view.filter((item) => Array.isArray(item.submenu)).map((item) => item.label)).toEqual(['Tabs', 'More surfaces', 'Comments', 'Appearance', 'Developer']);
    // a subsequence, so a later row may stand between them (U6b's zoom rows, U11's channel)
    expect(subsequence(shape(view), [
      'Overview', 'Artifacts', 'Tabs ▸', '—', 'Split / move to other pane', 'Focus other pane', 'Expand pane', '—',
      'Toggle sidebar', 'Toggle session cards', 'Expand surface', 'Float conversation over surface', '—',
      'Terminal', 'Review', 'Files', 'Browser', 'More surfaces ▸', '—', 'Move to side surface', 'Move to tab', '—',
      'Comments ▸', 'Appearance ▸', 'Usage', '—', 'Developer ▸', '—', 'togglefullscreen',
    ]), shape(view).join(' · ')).toBe(true);
    expect(shape(submenuOf(view, 'Tabs'))).toEqual(Array.from({ length: 9 }, (_, i) => `Select Tab ${i + 1}`));
    expect(shape(submenuOf(view, 'More surfaces'))).toEqual(['Source control', 'Subagents', 'Background tasks', 'Session info', 'Questions']);
    expect(shape(submenuOf(view, 'Comments'))).toEqual(['Expand comments', 'Minimize comments', 'Hide comments']);
    expect(shape(submenuOf(view, 'Developer'))).toEqual(['reload', 'forceReload', 'toggleDevTools']);
    expect(subsequence(shape(submenuOf(template, 'Go')), [
      'Command palette', '—', 'Previous session', 'Next session', 'Mark session unread', 'Next Needs-you', '—',
      'Next tab in strip', 'Previous tab in strip', '—', 'Focus next region', 'Focus previous region', 'Focus sidebar',
    ]), shape(submenuOf(template, 'Go')).join(' · ')).toBe(true);
  });

  it('gives Terminal, Review and Files their chords (l5-code-08)', () => {
    const template = menuTemplate(ACTIONS, {}, ALL, vi.fn());
    expect(['surface.terminal', 'surface.review', 'surface.files'].map((id) => byId(template, id)?.accelerator)).toEqual(['Cmd+J', 'Cmd+Shift+D', 'Cmd+Shift+F']);
  });

  it('a stored rebinding wins over a default added later: the menu carries the accelerator once (decision 10)', () => {
    const chord = SAMPLE_ROWS['sample.menu'].chord;
    const template = menuTemplate(EXTENDED_TABLE, { 'palette.open': chord }, new Set(idsOf(EXTENDED_TABLE)), vi.fn());
    expect(byId(template, 'palette.open')!.accelerator).toBe(chord);
    expect(byId(template, sample('sample.menu'))!.accelerator).toBeUndefined();
    expect(items(template).filter((item) => item.accelerator === chord)).toHaveLength(1);
    // an override of a row build F does not know is never read
    const ignored = menuTemplate(EXTENDED_TABLE, { [sample('sample.menu')]: 'Cmd+Alt+Shift+Y' } as KeymapOverrides, new Set(idsOf(EXTENDED_TABLE)), vi.fn());
    expect(byId(ignored, sample('sample.menu'))!.accelerator).toBe(chord);
  });

  // A7: a page of the in-app browser takes only its own chords (src/main/browser/keys.ts), so the three reach the menu
  it('leaves ⌘J, ⇧⌘D and ⇧⌘F to the menu from a page of the in-app browser', () => {
    const down = (key: string, shift: boolean): KeyInput => ({ type: 'keyDown', key, meta: true, control: false, alt: false, shift });
    for (const input of [down('j', false), down('d', true), down('D', true), down('f', true), down('F', true)]) {
      expect(keyAction(input, { findOpen: false, loading: false }), JSON.stringify(input)).toBeNull();
    }
    expect(keyAction(down('f', false), { findOpen: false, loading: false })).toEqual({ kind: 'chrome', command: 'openFind' }); // the page's own ⌘F stays
  });
});
// U6a end
