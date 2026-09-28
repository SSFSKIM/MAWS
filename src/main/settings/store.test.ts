import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, openSettingsStore, resolveTheme } from './store';

let dir: string;
let file: string;

beforeEach(() => {
  vi.restoreAllMocks();
  dir = mkdtempSync(join(tmpdir(), 'maws-settings-'));
  file = join(dir, 'settings.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const REST = { keymap: {}, notifications: { enabled: true, sound: false } } as const;
const v2 = (theme: string) => ({ version: 2, theme, ...REST });
const v2Json = (theme: string) => JSON.stringify(v2(theme));

describe('settings store', () => {
  it('defaults to light when there is no file yet, silently and without writing one', () => {
    const warn = vi.spyOn(console, 'warn');
    expect(DEFAULT_SETTINGS).toEqual(v2('light'));
    expect(openSettingsStore(file).settings).toEqual(DEFAULT_SETTINGS);
    expect(warn).not.toHaveBeenCalled();
    expect(readdirSync(dir)).toEqual([]);
  });

  it('reads the persisted setting', () => {
    writeFileSync(file, v2Json('dark'));
    expect(openSettingsStore(file).settings).toEqual(v2('dark'));
  });

  it.each([
    ['unparseable JSON', '{"version":2,'],
    ['an unknown theme', JSON.stringify({ ...v2('sepia') })],
    ['another version', JSON.stringify({ ...v2('dark'), version: 3 })],
    ['an unknown key', JSON.stringify({ ...v2('dark'), font: 'x' })],
    ['a version 1 file that is not valid version 1', '{"version":1,"theme":"sepia"}'],
  ])('replaces a file with %s by the defaults and warns, never throws', (_, content) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeFileSync(file, content);
    expect(openSettingsStore(file).settings).toEqual(DEFAULT_SETTINGS);
    expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(file), expect.anything());
  });

  it('replaces an unreadable path by the defaults and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mkdirSync(file);
    expect(openSettingsStore(file).settings).toEqual(DEFAULT_SETTINGS);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('persists an update as compact JSON through a temporary file, leaving only settings.json', () => {
    const store = openSettingsStore(file);
    expect(store.update({ theme: 'dark' })).toEqual(v2('dark'));
    expect(store.settings).toEqual(v2('dark'));
    expect(readFileSync(file, 'utf8')).toBe(v2Json('dark'));
    expect(readdirSync(dir)).toEqual(['settings.json']);
    expect(openSettingsStore(file).settings).toEqual(v2('dark'));
  });

  it('creates the settings directory when it does not exist yet', () => {
    const nested = join(dir, 'fresh', 'settings.json');
    openSettingsStore(nested).update({ theme: 'system' });
    expect(readFileSync(nested, 'utf8')).toBe(v2Json('system'));
  });

  it('keeps what a patch leaves out, including a key present as undefined', () => {
    const store = openSettingsStore(file);
    store.update({ theme: 'dark' });
    expect(store.update({})).toEqual(v2('dark'));
    expect(store.update({ theme: undefined })).toEqual(v2('dark'));
  });

  it('persists keymap overrides and the notification policy', () => {
    const store = openSettingsStore(file);
    store.update({ keymap: { 'attention.next': 'Cmd+Alt+J', 'tab.close': null }, notifications: { enabled: false, sound: true } });
    expect(openSettingsStore(file).settings).toEqual({
      version: 2,
      theme: 'light',
      keymap: { 'attention.next': 'Cmd+Alt+J', 'tab.close': null },
      notifications: { enabled: false, sound: true },
    });
  });

  it('resolves system against the OS and leaves explicit themes alone', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('layout and settings migrate', () => {
  it('migrates a version 1 file to version 2, rewrites it and logs one line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    writeFileSync(file, '{"version":1,"theme":"dark"}');
    expect(openSettingsStore(file).settings).toEqual(v2('dark'));
    expect(readFileSync(file, 'utf8')).toBe(v2Json('dark'));
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^\[settings\] migrated .*settings\.json from version 1 to 2$/));
  });

  it('does not migrate a file that is already version 2', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    writeFileSync(file, v2Json('system'));
    openSettingsStore(file);
    expect(log).not.toHaveBeenCalled();
  });
});
