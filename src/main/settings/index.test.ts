import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_DEFAULTS_V4 } from '@shared/settings/defaults';

// A fake nativeTheme that behaves like Electron's (`shouldUseDarkColors` follows `themeSource`, `system` follows the
// fake OS), one fake app window that records its background colour and the events sent to it, and an `ipcMain` that
// records the router's handlers so commands go through the real router.
const electron = vi.hoisted(() => {
  const updated: (() => void)[] = [];
  // Writing `themeSource` fires `updated` synchronously, as the worst case of Electron's behaviour.
  let source: 'system' | 'light' | 'dark' = 'system';
  const theme = {
    osDark: false,
    get themeSource() {
      return source;
    },
    set themeSource(value) {
      source = value;
      theme.fireUpdated();
    },
    get shouldUseDarkColors() {
      return source === 'system' ? theme.osDark : source === 'dark';
    },
    on: (_: 'updated', listener: () => void) => void updated.push(listener),
    fireUpdated: () => updated.forEach((l) => l()),
    reset() {
      updated.length = 0;
      theme.osDark = false;
      source = 'system';
    },
  };
  const mainFrame = { url: 'http://localhost:5173/' };
  const win = {
    backgrounds: [] as string[],
    sent: [] as unknown[][],
    setBackgroundColor(colour: string) {
      this.backgrounds.push(colour);
    },
    webContents: {
      mainFrame,
      send: (...args: unknown[]) => void win.sent.push(args),
      isDestroyed: () => false,
    },
  };
  return { theme, win, handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>() };
});
vi.mock('electron', () => ({
  nativeTheme: electron.theme,
  BrowserWindow: {
    getAllWindows: () => [electron.win],
    fromWebContents: (wc: unknown) => (wc === electron.win.webContents ? electron.win : null),
  },
  ipcMain: { handle: (channel: string, handler: never) => void electron.handlers.set(channel, handler) },
}));

let startSettings: typeof import('./index').startSettings;
let dir: string;
let file: string;

beforeEach(async () => {
  vi.resetModules();
  electron.theme.reset();
  electron.handlers.clear();
  electron.win.backgrounds = [];
  electron.win.sent = [];
  dir = mkdtempSync(join(tmpdir(), 'maws-theme-'));
  file = join(dir, 'settings.json');
  const router = await import('../ipc/router');
  router.installRouter({ appUrl: 'http://localhost:5173/' });
  ({ startSettings } = await import('./index'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const invoke = (name: string, input?: unknown) =>
  electron.handlers.get(`maws:cmd:${name}`)!({ sender: electron.win.webContents, senderFrame: electron.win.webContents.mainFrame }, input);
const state = (theme: string, resolvedTheme: string) => ({ settings: { ...SETTINGS_DEFAULTS_V4, theme }, resolvedTheme });
const changed = (theme: string, resolvedTheme: string) => ['maws:evt:settings.changed', state(theme, resolvedTheme)];
const clearRecords = () => {
  electron.win.backgrounds = [];
  electron.win.sent = [];
};

describe('theme switching in main', () => {
  it('starts light by default: native chrome, window background and a settings.changed on start', async () => {
    const settings = startSettings(file);
    expect(electron.theme.themeSource).toBe('light');
    expect(settings.state()).toEqual(state('light', 'light'));
    expect(electron.win.sent).toEqual([changed('light', 'light')]);
    expect(electron.win.backgrounds).toEqual(['#faf9f6']);
    await expect(invoke('settings.get')).resolves.toEqual({ ok: true, value: state('light', 'light') });
  });

  it('settings.set dark flips native chrome, the window background and the file, and emits settings.changed', async () => {
    startSettings(file);
    clearRecords();
    await expect(invoke('settings.set', { theme: 'dark' })).resolves.toEqual({ ok: true, value: state('dark', 'dark') });
    expect(electron.theme.themeSource).toBe('dark');
    expect(electron.win.backgrounds).toEqual(['#131313']);
    expect(electron.win.sent).toEqual([changed('dark', 'dark')]);
    expect(readFileSync(file, 'utf8')).toBe(JSON.stringify({ ...SETTINGS_DEFAULTS_V4, theme: 'dark' }));
    await expect(invoke('settings.get')).resolves.toEqual({ ok: true, value: state('dark', 'dark') });
  });

  // C11 start
  it('settings.set of one gateway field changes that field alone, and settings.changed carries the whole state', async () => {
    startSettings(file);
    clearRecords();
    const whole = { settings: { ...SETTINGS_DEFAULTS_V4, gateway: { ...SETTINGS_DEFAULTS_V4.gateway, relayUnreachable: 'wait' } }, resolvedTheme: 'light' };
    await expect(invoke('settings.set', { gateway: { relayUnreachable: 'wait' } })).resolves.toEqual({ ok: true, value: whole });
    expect(electron.win.sent).toEqual([['maws:evt:settings.changed', whole]]);
    await expect(invoke('settings.set', { notifications: { kinds: { errors: false } } })).resolves.toMatchObject({
      ok: true,
      value: { settings: { notifications: { enabled: true, sound: false, kinds: { ...SETTINGS_DEFAULTS_V4.notifications.kinds, errors: false } } } },
    });
  });
  // C11 end

  it('settings.set with an invalid theme changes nothing', async () => {
    startSettings(file);
    clearRecords();
    await expect(invoke('settings.set', { theme: 'sepia' })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(electron.theme.themeSource).toBe('light');
    expect(electron.win.sent).toEqual([]);
  });

  it('comes back with the persisted theme on the next start', () => {
    writeFileSync(file, '{"version":2,"theme":"dark","keymap":{},"notifications":{"enabled":true,"sound":false}}');
    const settings = startSettings(file);
    expect(electron.theme.themeSource).toBe('dark');
    expect(settings.state().resolvedTheme).toBe('dark');
    expect(electron.win.backgrounds).toEqual(['#131313']);
  });

  it('system follows the OS, and an OS change re-emits settings.changed', () => {
    writeFileSync(file, '{"version":2,"theme":"system","keymap":{},"notifications":{"enabled":true,"sound":false}}');
    electron.theme.osDark = true;
    const settings = startSettings(file);
    expect(electron.theme.themeSource).toBe('system');
    expect(settings.state()).toEqual(state('system', 'dark'));
    clearRecords();
    electron.theme.osDark = false;
    electron.theme.fireUpdated();
    expect(electron.win.sent).toEqual([changed('system', 'light')]);
    expect(electron.win.backgrounds).toEqual(['#faf9f6']);
  });

  it('an OS change that does not move the resolved theme emits nothing', () => {
    startSettings(file);
    clearRecords();
    electron.theme.osDark = true;
    electron.theme.fireUpdated();
    expect(electron.win.sent).toEqual([]);
  });
});
