import type { MenuItemConstructorOptions } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '@shared/ipc/schema';
import { ACTIONS, ACTION_IDS, type ActionId } from '@shared/keymap/actions';
import { SETTINGS_DEFAULTS_V9 } from '@shared/settings/defaults';

interface Contents {
  id: number;
  selectAll(): void;
}
const electron = vi.hoisted(() => ({
  setApplicationMenu: vi.fn(),
  windows: [] as { webContents: Contents }[],
  focused: null as Contents | null,
}));
vi.mock('electron', () => ({
  Menu: { buildFromTemplate: (template: unknown) => ({ template }), setApplicationMenu: electron.setApplicationMenu },
  BrowserWindow: { getAllWindows: () => electron.windows },
  webContents: { getFocusedWebContents: () => electron.focused },
}));

const { emit } = await import('./ipc/events');
const { menuTemplate, startMenu } = await import('./menu');

type Item = MenuItemConstructorOptions;
const SETTINGS: Settings = SETTINGS_DEFAULTS_V9;
const ALL = new Set<ActionId>(ACTION_IDS);
const MENU_SINK = ACTION_IDS.filter((id) => ACTIONS[id].sink === 'menu');

function items(template: Item[]): Item[] {
  return template.flatMap((item) => [item, ...(Array.isArray(item.submenu) ? items(item.submenu) : [])]);
}
const actionItems = (template: Item[]) => items(template).filter((item) => item.id !== undefined && item.id !== 'edit.selectAll');
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
    expect(edit).toEqual(expect.arrayContaining(['undo', 'redo', 'cut', 'copy', 'paste']));
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
  const contents = (id: number): Contents => ({ id, selectAll: vi.fn() });
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
