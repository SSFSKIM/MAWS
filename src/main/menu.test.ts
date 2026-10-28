import { EventEmitter } from 'node:events';
import type { MenuItemConstructorOptions } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientOf } from './ipc/clients';
import type { Settings } from '@shared/ipc/schema';
import { ACTIONS, ACTION_IDS, type ActionId } from '@shared/keymap/actions';
import { SETTINGS_DEFAULTS_V19 } from '@shared/settings/defaults';

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
const SETTINGS: Settings = SETTINGS_DEFAULTS_V19;
const ALL = new Set<ActionId>(ACTION_IDS);
const MENU_SINK = ACTION_IDS.filter((id) => ACTIONS[id].sink === 'menu');

function items(template: Item[]): Item[] {
  return template.flatMap((item) => [item, ...(Array.isArray(item.submenu) ? items(item.submenu) : [])]);
}
const EDIT_ITEMS = new Set(['edit.selectAll', 'edit.undo', 'edit.redo']); // the Edit menu's own items, not actions (P4-B2 K6: Undo, Redo)
const actionItems = (template: Item[]) => items(template).filter((item) => item.id !== undefined && !EDIT_ITEMS.has(item.id));
const actionOf = (item: Item) => item.id!.split(':')[0] as ActionId;
const byId = (template: Item[], id: string) => items(template).find((item) => item.id === id);
const top = (template: Item[], label: string) => template.find((item) => item.label === label);

describe('application menu', () => {
  it('contains exactly the menu-sink actions, each with its effective chord', () => {
    const template = menuTemplate(ACTIONS, {}, ALL, vi.fn());
    expect([...new Set(actionItems(template).map(actionOf))].sort()).toEqual([...MENU_SINK].sort());
    for (const item of actionItems(template)) {
      const id = actionOf(item);
      if (id === 'tab.select') continue; // expanded below
      expect(item.accelerator ?? null, id).toBe(ACTIONS[id].chord);
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
