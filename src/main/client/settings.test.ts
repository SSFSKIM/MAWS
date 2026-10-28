import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { MachineRef } from '@shared/machine/ref'; // P5 O6 M2: the router's local machine
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientSettingsDefaults, machineSettingsDefaults, SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { startMachineSettings, type MachineSettingsService } from '../settings/machine'; // P5 O3-A
import { settingsPaths, splitSettingsFiles } from '../settings/split'; // P5 O3-A

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
      id: 1,
      mainFrame,
      send: (...args: unknown[]) => void win.sent.push(args),
      isDestroyed: () => false,
      on: () => {}, // the router follows the page's end for its ClientRef
    },
  };
  return { theme, win, handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>() };
});
vi.mock('../windows', () => ({ appWindows: () => [electron.win] })); // E2: the app-window registry
vi.mock('electron', () => ({
  nativeTheme: electron.theme,
  BrowserWindow: {
    getAllWindows: () => [electron.win],
    fromWebContents: (wc: unknown) => (wc === electron.win.webContents ? electron.win : null),
  },
  ipcMain: { handle: (channel: string, handler: never) => void electron.handlers.set(channel, handler) },
}));

let startSettings: typeof import('./settings').startSettings;
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
  router.installRouter({ appUrl: 'http://localhost:5173/', local: 'LocalMachineRef0000000' as MachineRef });
  ({ startSettings } = await import('./settings'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// P5 O3-A: as main starts them, holding spine.lock (src/main/index.ts's startSpineData): the split, once, then the machine
// half and the client service over both files; `refused` as in a run refused the spine.
let machine: MachineSettingsService;
const start = ({ refused = null }: { refused?: string | null } = {}) => {
  const paths = settingsPaths(dir);
  const split = refused === null ? splitSettingsFiles(paths, undefined, () => {}) : null;
  machine = startMachineSettings(paths.machine, { refused: refused ?? split?.machineRefused ?? null, unsplit: split?.unsplit });
  return startSettings({ clientFile: paths.client, machine });
};
const machineFile = () => join(dir, 'machine-settings.json');

const invoke = (name: string, input?: unknown) =>
  electron.handlers.get(`maws:cmd:${name}`)!({ sender: electron.win.webContents, senderFrame: electron.win.webContents.mainFrame }, input);
const state = (theme: string, resolvedTheme: string) => ({ settings: { ...SETTINGS_DEFAULTS_V21, theme }, resolvedTheme });
const changed = (theme: string, resolvedTheme: string) => ['maws:evt:settings.changed', state(theme, resolvedTheme)];
const clearRecords = () => {
  electron.win.backgrounds = [];
  electron.win.sent = [];
};

describe('theme switching in main', () => {
  it('starts light by default: native chrome, window background and a settings.changed on start', async () => {
    const settings = start();
    expect(electron.theme.themeSource).toBe('light');
    expect(settings.state()).toEqual(state('light', 'light'));
    expect(electron.win.sent).toEqual([changed('light', 'light')]);
    expect(electron.win.backgrounds).toEqual(['#faf9f6']);
    await expect(invoke('settings.get')).resolves.toEqual({ ok: true, value: state('light', 'light') });
  });

  it('settings.set dark flips native chrome, the window background and the file, and emits settings.changed', async () => {
    start();
    clearRecords();
    await expect(invoke('settings.set', { theme: 'dark' })).resolves.toEqual({ ok: true, value: state('dark', 'dark') });
    expect(electron.theme.themeSource).toBe('dark');
    expect(electron.win.backgrounds).toEqual(['#131313']);
    expect(electron.win.sent).toEqual([changed('dark', 'dark')]);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ ...clientSettingsDefaults(), theme: 'dark' }); // P5 O3-A: the client file
    await expect(invoke('settings.get')).resolves.toEqual({ ok: true, value: state('dark', 'dark') });
  });

  // C11 start
  it('settings.set of one gateway field changes that field alone, and settings.changed carries the whole state', async () => {
    start();
    clearRecords();
    const whole = { settings: { ...SETTINGS_DEFAULTS_V21, gateway: { ...SETTINGS_DEFAULTS_V21.gateway, relayUnreachable: 'wait' } }, resolvedTheme: 'light' };
    await expect(invoke('settings.set', { gateway: { relayUnreachable: 'wait' } })).resolves.toEqual({ ok: true, value: whole });
    expect(electron.win.sent).toEqual([['maws:evt:settings.changed', whole]]);
    await expect(invoke('settings.set', { notifications: { kinds: { errors: false } } })).resolves.toMatchObject({
      ok: true,
      value: { settings: { notifications: { enabled: true, sound: false, kinds: { ...SETTINGS_DEFAULTS_V21.notifications.kinds, errors: false } } } },
    });
  });
  // C11 end

  it('settings.set with an invalid theme changes nothing', async () => {
    start();
    clearRecords();
    await expect(invoke('settings.set', { theme: 'sepia' })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(electron.theme.themeSource).toBe('light');
    expect(electron.win.sent).toEqual([]);
  });

  it('comes back with the persisted theme on the next start', () => {
    writeFileSync(file, '{"version":2,"theme":"dark","keymap":{},"notifications":{"enabled":true,"sound":false}}');
    const settings = start();
    expect(electron.theme.themeSource).toBe('dark');
    expect(settings.state().resolvedTheme).toBe('dark');
    expect(electron.win.backgrounds).toEqual(['#131313']);
  });

  it('system follows the OS, and an OS change re-emits settings.changed', () => {
    writeFileSync(file, '{"version":2,"theme":"system","keymap":{},"notifications":{"enabled":true,"sound":false}}');
    electron.theme.osDark = true;
    const settings = start();
    expect(electron.theme.themeSource).toBe('system');
    expect(settings.state()).toEqual(state('system', 'dark'));
    clearRecords();
    electron.theme.osDark = false;
    electron.theme.fireUpdated();
    expect(electron.win.sent).toEqual([changed('system', 'light')]);
    expect(electron.win.backgrounds).toEqual(['#faf9f6']);
  });

  it('an OS change that does not move the resolved theme emits nothing', () => {
    start();
    clearRecords();
    electron.theme.osDark = true;
    electron.theme.fireUpdated();
    expect(electron.win.sent).toEqual([]);
  });
});

// P5 O3-A (docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §3; O3-A acceptance 4): one renderer API over two files
describe('the settings route each field to its owner’s file', () => {
  const bytes = (path: string) => readFileSync(path, 'utf8');

  it('a machine field changes only machine-settings.json, a client field only settings.json, and each set publishes once', async () => {
    start();
    expect(() => bytes(file)).toThrow(); // a first run writes no client file until a client field is set
    const machineBytes = bytes(machineFile()); // the split's defaults
    await invoke('settings.set', { theme: 'dark' });
    expect(bytes(machineFile())).toBe(machineBytes);
    const client = bytes(file);
    clearRecords();
    const archived = await invoke('settings.set', { sessions: { archiveInactiveDays: 7 }, supervisor: { idleExitMinutes: 30 } });
    expect(archived).toMatchObject({ ok: true, value: { settings: { sessions: { archiveInactiveDays: 7 }, supervisor: { idleExitMinutes: 30, keepRunningDefault: true, shape: 'daemon' } } } });
    expect(bytes(file)).toBe(client);
    expect(JSON.parse(bytes(machineFile()))).toEqual({ ...machineSettingsDefaults(), sessions: { archiveInactiveDays: 7 }, supervisor: { idleExitMinutes: 30 } });
    expect(electron.win.sent).toHaveLength(1);

    const machineAfter = bytes(machineFile());
    clearRecords();
    await invoke('settings.set', { supervisor: { keepRunningDefault: false }, artifacts: { commentsView: 'hide' } });
    expect(bytes(machineFile())).toBe(machineAfter);
    expect(JSON.parse(bytes(file))).toEqual({ ...clientSettingsDefaults(), theme: 'dark', supervisor: { keepRunningDefault: false, shape: 'daemon' }, artifacts: { commentsView: 'hide' } });
    expect(electron.win.sent).toHaveLength(1);
    expect(machineBytes).not.toBe(machineAfter);
  });

  it('a change the machine half makes itself publishes the merged settings', () => {
    start();
    clearRecords();
    machine.update({ mods: { toHuman: { enabled: false } } });
    expect(electron.win.sent).toEqual([['maws:evt:settings.changed', { settings: { ...SETTINGS_DEFAULTS_V21, mods: { toHuman: { enabled: false } } }, resolvedTheme: 'light' }]]);
  });

  it('in a run refused the spine a machine field is refused and nothing is written, while a client field is still kept', async () => {
    writeFileSync(file, JSON.stringify({ ...clientSettingsDefaults(), theme: 'dark' }));
    writeFileSync(machineFile(), JSON.stringify({ ...machineSettingsDefaults(), gateway: { ...machineSettingsDefaults().gateway, defaultRoute: 'direct' } }));
    const before = bytes(machineFile());
    const settings = start({ refused: 'spine.lock is held by pid 4242 (build 1.0.0+abc)' });
    expect(settings.state().settings).toMatchObject({ theme: 'dark', gateway: { defaultRoute: 'direct' } }); // read, both halves
    clearRecords();
    await expect(invoke('settings.set', { gateway: { relayUnreachable: 'wait' } })).resolves.toMatchObject({ ok: false, error: { message: expect.stringContaining('pid 4242') } });
    expect(bytes(machineFile())).toBe(before);
    await expect(invoke('settings.set', { theme: 'light' })).resolves.toMatchObject({ ok: true, value: { settings: { theme: 'light' } } });
    expect(JSON.parse(bytes(file))).toMatchObject({ theme: 'light' });
    expect(bytes(machineFile())).toBe(before);
  });

  // the holder's split in progress: its machine file written, settings.json not yet rewritten as the client file
  it('a refused run meeting a split in progress reads both halves, finishes nothing and writes neither file', async () => {
    const unified = JSON.stringify({ ...SETTINGS_DEFAULTS_V21, version: 20, theme: 'dark', gateway: { ...SETTINGS_DEFAULTS_V21.gateway, defaultRoute: 'direct' } });
    const machineText = JSON.stringify({ ...machineSettingsDefaults(), gateway: { ...machineSettingsDefaults().gateway, defaultRoute: 'direct' } });
    writeFileSync(file, unified);
    writeFileSync(machineFile(), machineText);
    const settings = start({ refused: 'spine.lock is held by pid 4242 (build 1.0.0+abc)' });
    expect(settings.state().settings).toMatchObject({ version: 21, theme: 'dark', gateway: { defaultRoute: 'direct' } });
    await expect(invoke('settings.set', { theme: 'light' })).resolves.toMatchObject({ ok: false, error: { message: expect.stringContaining('not written this run') } });
    await expect(invoke('settings.set', { gateway: { offerDirect: false } })).resolves.toMatchObject({ ok: false, error: { message: expect.stringContaining('pid 4242') } });
    expect(bytes(file)).toBe(unified);
    expect(bytes(machineFile())).toBe(machineText);
  });

  it('a refused run over a unified file the split has not converted reads it whole and writes neither file', async () => {
    const unified = JSON.stringify({ ...SETTINGS_DEFAULTS_V21, version: 20, theme: 'dark', engine: { ...SETTINGS_DEFAULTS_V21.engine, subagentModel: 'haiku' } });
    writeFileSync(file, unified);
    const settings = start({ refused: 'spine.lock is held by pid 4242 (build 1.0.0+abc)' });
    // the client half from the unified file; the machine half's file is absent, so its defaults stand (P5 O3-A: the
    // person's machine fields stay in the unified file, untouched, for the next run that holds the lock)
    expect(settings.state().settings.theme).toBe('dark');
    await expect(invoke('settings.set', { theme: 'light' })).resolves.toMatchObject({ ok: false });
    await expect(invoke('settings.set', { engine: { subagentModel: null } })).resolves.toMatchObject({ ok: false });
    expect(bytes(file)).toBe(unified);
    expect(() => bytes(machineFile())).toThrow();
  });
});
