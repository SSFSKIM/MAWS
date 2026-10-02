import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_DEFAULTS_V8 } from '@shared/settings/defaults';
import { DEFAULT_SETTINGS, openSettingsStore, resolveTheme } from './store';

let dir: string;
let file: string;

beforeEach(() => {
  vi.restoreAllMocks();
  dir = mkdtempSync(join(tmpdir(), 'maws-settings-'));
  file = join(dir, 'settings.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const v3 = (theme: string) => ({ ...SETTINGS_DEFAULTS_V8, theme });
// W7: a file an earlier version wrote has no budget switch; W13: and, before version 8, the engine's pin
const PIN = { pinnedVersion: '2.1.283' };
const { memoryBudget: _switch, ...ENGINE_V8_LESS_SWITCH } = SETTINGS_DEFAULTS_V8.engine;
void _switch;
const ENGINE_BEFORE_V7 = { ...ENGINE_V8_LESS_SWITCH, ...PIN };
const before8 = (theme: string) => ({ ...v3(theme), version: 7, engine: { ...SETTINGS_DEFAULTS_V8.engine, ...PIN } });
const before7 = (theme: string) => ({ ...v3(theme), engine: ENGINE_BEFORE_V7 });
// W3: nor, before version 6, a permissions section
const before6 = (theme: string) => {
  const { permissions: _p, ...rest } = before7(theme);
  void _p;
  return rest;
};
const v3Json = (theme: string) => JSON.stringify(v3(theme));
const FIXTURES = join(__dirname, '../../../test/fixtures/settings');

describe('settings store', () => {
  it('defaults to light when there is no file yet, silently and without writing one', () => {
    const warn = vi.spyOn(console, 'warn');
    expect(DEFAULT_SETTINGS).toEqual(v3('light'));
    expect(openSettingsStore(file).settings).toEqual(DEFAULT_SETTINGS);
    expect(warn).not.toHaveBeenCalled();
    expect(readdirSync(dir)).toEqual([]);
  });

  it('reads the persisted setting', () => {
    writeFileSync(file, v3Json('dark'));
    expect(openSettingsStore(file).settings).toEqual(v3('dark'));
  });

  it.each([
    ['unparseable JSON', '{"version":3,'],
    ['an unknown theme', JSON.stringify({ ...v3('sepia') })],
    ['an unknown later version', JSON.stringify({ ...v3('dark'), version: 9 })], // C12: 4 is the current version; W2: 5; W3: 6; W7: 7; W13: 8
    ['a version 2 file with a version 3 section', JSON.stringify({ version: 2, theme: 'dark', keymap: {}, notifications: { enabled: true, sound: false }, usage: { nearLimitPercent: 90 } })],
    ['an unknown key', JSON.stringify({ ...v3('dark'), font: 'x' })],
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
    expect(store.update({ theme: 'dark' })).toEqual(v3('dark'));
    expect(store.settings).toEqual(v3('dark'));
    expect(readFileSync(file, 'utf8')).toBe(v3Json('dark'));
    expect(readdirSync(dir)).toEqual(['settings.json']);
    expect(openSettingsStore(file).settings).toEqual(v3('dark'));
  });

  it('creates the settings directory when it does not exist yet', () => {
    const nested = join(dir, 'fresh', 'settings.json');
    openSettingsStore(nested).update({ theme: 'system' });
    expect(readFileSync(nested, 'utf8')).toBe(v3Json('system'));
  });

  it('keeps what a patch leaves out, including a key present as undefined', () => {
    const store = openSettingsStore(file);
    store.update({ theme: 'dark' });
    expect(store.update({})).toEqual(v3('dark'));
    expect(store.update({ theme: undefined })).toEqual(v3('dark'));
  });

  it('persists keymap overrides and the notification policy', () => {
    const store = openSettingsStore(file);
    store.update({ keymap: { 'attention.next': 'Cmd+Alt+J', 'tab.close': null }, notifications: { enabled: false, sound: true } });
    expect(openSettingsStore(file).settings).toEqual({
      ...SETTINGS_DEFAULTS_V8,
      keymap: { 'attention.next': 'Cmd+Alt+J', 'tab.close': null },
      notifications: { enabled: false, sound: true, kinds: SETTINGS_DEFAULTS_V8.notifications.kinds },
    });
  });

  it('resolves system against the OS and leaves explicit themes alone', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('settings migrate v1 and v2 to v3', () => {
  it('migrates a version 1 file to version 3, rewrites it and logs one line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    writeFileSync(file, readFileSync(join(FIXTURES, 'v1.json')));
    expect(openSettingsStore(file).settings).toEqual(v3('dark'));
    expect(readFileSync(file, 'utf8')).toBe(v3Json('dark'));
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^\[settings\] migrated .*settings\.json from version 1 to 8$/)); // C12: to 4; W2: to 5; W3: to 6; W7: to 7; W13: to 8
  });

  it("migrates C5's version 2 file keeping its keymap override and notification policy, and rewrites it once", () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    writeFileSync(file, readFileSync(join(FIXTURES, 'v2.json')));
    const migrated = { ...v3('system'), keymap: { 'attention.next': 'Cmd+Alt+J' }, notifications: { enabled: false, sound: true, kinds: SETTINGS_DEFAULTS_V8.notifications.kinds } };
    expect(openSettingsStore(file).settings).toEqual(migrated);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/from version 2 to 8$/)); // C12: to 4; W2: to 5; W3: to 6; W7: to 7; W13: to 8
    log.mockClear();
    expect(openSettingsStore(file).settings).toEqual(migrated);
    expect(log).not.toHaveBeenCalled();
  });

  // C12 start: C11's version 3 file gains the budget's defaults and is rewritten once
  it('migrates a version 3 file to version 4 with the budget’s defaults, rewrites it once and logs one line', () => { // W2: to 5
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { memoryBudgetMiB: _m, statefulMcpServers: _s, ...engineV3 } = ENGINE_BEFORE_V7;
    void _m;
    void _s;
    writeFileSync(file, JSON.stringify({ ...before6('dark'), version: 3, engine: { ...engineV3, subagentModel: 'haiku' }, appearance: { monoFont: null } }));
    const migrated = { ...v3('dark'), engine: { ...SETTINGS_DEFAULTS_V8.engine, subagentModel: 'haiku' } };
    expect(openSettingsStore(file).settings).toEqual(migrated);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/from version 3 to 8$/));
  });
  // C12 end

  // W2 start: C12's version 4 file gains the transcript's default width and is rewritten once
  it('migrates a version 4 file to version 5 with the default width, rewrites it once and logs one line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    writeFileSync(file, JSON.stringify({ ...before6('dark'), version: 4, appearance: { monoFont: 'Hack' } }));
    const migrated = { ...v3('dark'), appearance: { monoFont: 'Hack', transcriptWidth: 768 } };
    expect(openSettingsStore(file).settings).toEqual(migrated);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/from version 4 to 8$/));
  });
  // W2 end

  // W3 start: W2's version 5 file gains the auto fallback's default and is rewritten once
  it('migrates a version 5 file to version 6 with acceptEdits as the auto fallback, rewrites it once and logs one line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    writeFileSync(file, JSON.stringify({ ...before6('dark'), version: 5 }));
    expect(openSettingsStore(file).settings).toEqual(v3('dark'));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(v3('dark'));
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/from version 5 to 8$/));
  });
  // W3 end

  // W7 start: W3's version 6 file gains the budget's switch, on, and is rewritten once
  it('migrates a version 6 file to version 7 with the budget on, keeping its own budget, rewrites it once and logs one line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const v6 = { ...before7('dark'), version: 6, engine: { ...ENGINE_BEFORE_V7, memoryBudgetMiB: 6144 } };
    writeFileSync(file, JSON.stringify(v6));
    const migrated = { ...v3('dark'), engine: { ...SETTINGS_DEFAULTS_V8.engine, memoryBudgetMiB: 6144 } };
    expect(openSettingsStore(file).settings).toEqual(migrated);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/from version 6 to 8$/));
  });
  // W7 end

  // W13 start: W7's version 7 file loses the engine's pin, keeps a chosen binary, and is rewritten once
  it('migrates a version 7 file to version 8 without the pin, keeping a chosen binary, rewrites it once and logs one line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const v7 = before8('dark');
    writeFileSync(file, JSON.stringify({ ...v7, engine: { ...v7.engine, binaryPath: '/opt/claude', pinnedVersion: '2.1.290' } }));
    const migrated = { ...v3('dark'), engine: { ...SETTINGS_DEFAULTS_V8.engine, binaryPath: '/opt/claude' } };
    expect(openSettingsStore(file).settings).toEqual(migrated);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/from version 7 to 8$/));
  });
  // W13 end

  it('never rewrites a file that is already version 8, nor writes defaults into it', () => { // C12: version 4; W2: version 5; W3: version 6; W7: version 7; W13: version 8
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const text = JSON.stringify({ ...v3('system'), usage: { nearLimitPercent: 80 } }, null, 2); // not the store's own formatting
    writeFileSync(file, text);
    openSettingsStore(file);
    expect(readFileSync(file, 'utf8')).toBe(text);
    expect(log).not.toHaveBeenCalled();
  });
});

describe('settings patch merges one kind and keeps its siblings', () => {
  it('changes one gateway field and keeps the rest of the state', () => {
    const store = openSettingsStore(file);
    expect(store.update({ gateway: { relayUnreachable: 'wait' } })).toEqual({ ...DEFAULT_SETTINGS, gateway: { ...DEFAULT_SETTINGS.gateway, relayUnreachable: 'wait' } });
  });

  it('patches one notification kind and leaves its four siblings; a notifications field leaves kinds alone', () => {
    const store = openSettingsStore(file);
    const siblings = { approvals: false, questions: false, planReviews: false, errors: true, heldPeerMessages: true };
    store.update({ notifications: { kinds: siblings } });
    expect(store.update({ notifications: { kinds: { errors: false } } }).notifications.kinds).toEqual({ ...siblings, errors: false });
    expect(store.update({ notifications: { enabled: false } }).notifications).toEqual({ enabled: false, sound: false, kinds: { ...siblings, errors: false } });
    expect(openSettingsStore(file).settings.notifications.kinds).toEqual({ ...siblings, errors: false });
  });

  it('refuses a merged state the schema refuses, and keeps the previous one', () => {
    const store = openSettingsStore(file);
    expect(() => store.update({ usage: { nearLimitPercent: 20 } })).toThrow();
    expect(store.settings).toEqual(DEFAULT_SETTINGS);
  });
});
