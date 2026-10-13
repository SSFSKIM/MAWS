import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_DEFAULTS_V14 } from '@shared/settings/defaults';
import { DEFAULT_SETTINGS, openSettingsStore, resolveTheme } from './store';

let dir: string;
let file: string;

beforeEach(() => {
  vi.restoreAllMocks();
  dir = mkdtempSync(join(tmpdir(), 'maws-settings-'));
  file = join(dir, 'settings.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const v3 = (theme: string) => ({ ...SETTINGS_DEFAULTS_V14, theme });
// W7: a file an earlier version wrote has no budget switch; W13: and, before version 8, the engine's pin
const PIN = { pinnedVersion: '2.1.283' };
const { memoryBudget: _switch, ...ENGINE_V8_LESS_SWITCH } = SETTINGS_DEFAULTS_V14.engine;
void _switch;
const ENGINE_BEFORE_V7 = { ...ENGINE_V8_LESS_SWITCH, ...PIN };
// P3-D: nor, before version 14, the design-system defaults
const before14 = (theme: string) => {
  const { artifacts: _d, ...rest } = v3(theme);
  void _d;
  return { ...rest, version: 13 };
};
// P2-C: nor, before version 13, a mods section or the owner channel's two notification groups
const before13 = (theme: string) => {
  const { mods: _m, ...rest } = before14(theme);
  void _m;
  const { asyncInput: _a, essential: _e, ...kinds } = rest.notifications.kinds;
  void _a;
  void _e;
  return { ...rest, version: 12, notifications: { ...rest.notifications, kinds } };
};
// cua #90: nor, before version 12, the bookmarks bar's switch
const before12 = (theme: string) => {
  const { bookmarksBar: _bar, ...browser } = before13(theme).browser;
  void _bar;
  return { ...before13(theme), browser, version: 11 };
};
// E4a: nor, before version 11, a browser section
const before11 = (theme: string) => {
  const { browser: _b, ...rest } = before12(theme);
  void _b;
  return { ...rest, version: 10 };
};
// E10: nor, before version 10, a supervisor section
const before10 = (theme: string) => {
  const { supervisor: _s, ...rest } = before11(theme);
  void _s;
  return { ...rest, version: 9 };
};
// E9: nor, before version 9, a voice section
const before9 = (theme: string) => {
  const { voice: _v, ...rest } = before10(theme);
  void _v;
  return { ...rest, version: 8 };
};
const before8 = (theme: string) => ({ ...before9(theme), version: 7, engine: { ...SETTINGS_DEFAULTS_V14.engine, ...PIN } });
const before7 = (theme: string) => ({ ...before9(theme), engine: ENGINE_BEFORE_V7 });
// W3: nor, before version 6, a permissions section
const before6 = (theme: string) => {
  const { permissions: _p, ...rest } = before7(theme);
  void _p;
  return rest;
};
const v3Json = (theme: string) => JSON.stringify(v3(theme));
const FIXTURES = join(__dirname, '../../../test/fixtures/settings');

describe('settings persistence regressions', () => {
  it('keeps migrated dark settings when the rewrite fails and retries on a later patch', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const original = '{"version":1,"theme":"dark"}';
    writeFileSync(file, original);
    chmodSync(dir, 0o500);
    let store: ReturnType<typeof openSettingsStore>;
    try {
      store = openSettingsStore(file);
      expect(store.settings.theme).toBe('dark');
      expect(readFileSync(file, 'utf8')).toBe(original);
    } finally {
      chmodSync(dir, 0o700);
    }
    store.update({ notifications: { enabled: false } });
    expect(openSettingsStore(file).settings).toMatchObject({ theme: 'dark', notifications: { enabled: false } });
  });

  it('refuses a patch when the disk file is unreadable or invalid instead of persisting defaults', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const original = '{"version":1,"theme":"dark"';
    writeFileSync(file, original);
    const store = openSettingsStore(file);
    expect(() => store.update({ notifications: { sound: true } })).toThrow();
    expect(readFileSync(file, 'utf8')).toBe(original);
    writeFileSync(file, v3Json('dark'));
    chmodSync(file, 0o000);
    try {
      expect(() => store.update({ notifications: { sound: true } })).toThrow();
    } finally {
      chmodSync(file, 0o600);
    }
    expect(readFileSync(file, 'utf8')).toBe(v3Json('dark'));
  });

  it('merges an unrelated patch against the latest disk settings, not a stale snapshot', () => {
    const first = openSettingsStore(file);
    const second = openSettingsStore(file);
    first.update({ engine: { binaryPath: '/opt/custom/claude' } });
    second.update({ notifications: { sound: true } });
    expect(openSettingsStore(file).settings).toMatchObject({ engine: { binaryPath: '/opt/custom/claude' }, notifications: { sound: true } });
  });
});

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
    ['an unknown later version', JSON.stringify({ ...v3('dark'), version: 15 })], // C12: 4 is the current version; W2: 5; W3: 6; W7: 7; W13: 8; E9: 9; E10: 10; E4a: 11; cua #90: 12; P2-C: 13; P3-D: 14
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
      ...SETTINGS_DEFAULTS_V14,
      keymap: { 'attention.next': 'Cmd+Alt+J', 'tab.close': null },
      notifications: { enabled: false, sound: true, kinds: SETTINGS_DEFAULTS_V14.notifications.kinds },
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
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^\[settings\] migrated .*settings\.json from version 1 to 14$/)); // C12: to 4; W2: to 5; W3: to 6; W7: to 7; W13: to 8; E9: to 9; E10: to 10; E4a: to 11; cua #90: to 12; P2-C: to 13; P3-D: to 14
  });

  it("migrates C5's version 2 file keeping its keymap override and notification policy, and rewrites it once", () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    writeFileSync(file, readFileSync(join(FIXTURES, 'v2.json')));
    const migrated = { ...v3('system'), keymap: { 'attention.next': 'Cmd+Alt+J' }, notifications: { enabled: false, sound: true, kinds: SETTINGS_DEFAULTS_V14.notifications.kinds } };
    expect(openSettingsStore(file).settings).toEqual(migrated);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/from version 2 to 14$/)); // C12: to 4; W2: to 5; W3: to 6; W7: to 7; W13: to 8; E9: to 9; E10: to 10; E4a: to 11; cua #90: to 12; P2-C: to 13; P3-D: to 14
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
    const migrated = { ...v3('dark'), engine: { ...SETTINGS_DEFAULTS_V14.engine, subagentModel: 'haiku' } };
    expect(openSettingsStore(file).settings).toEqual(migrated);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/from version 3 to 14$/));
  });
  // C12 end

  // W2 start: C12's version 4 file gains the transcript's default width and is rewritten once
  it('migrates a version 4 file to version 5 with the default width, rewrites it once and logs one line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    writeFileSync(file, JSON.stringify({ ...before6('dark'), version: 4, appearance: { monoFont: 'Hack' } }));
    const migrated = { ...v3('dark'), appearance: { monoFont: 'Hack', transcriptWidth: 768 } };
    expect(openSettingsStore(file).settings).toEqual(migrated);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/from version 4 to 14$/));
  });
  // W2 end

  // W3 start: W2's version 5 file gains the auto fallback's default and is rewritten once
  it('migrates a version 5 file to version 6 with acceptEdits as the auto fallback, rewrites it once and logs one line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    writeFileSync(file, JSON.stringify({ ...before6('dark'), version: 5 }));
    expect(openSettingsStore(file).settings).toEqual(v3('dark'));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(v3('dark'));
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/from version 5 to 14$/));
  });
  // W3 end

  // W7 start: W3's version 6 file gains the budget's switch, on, and is rewritten once
  it('migrates a version 6 file to version 7 with the budget on, keeping its own budget, rewrites it once and logs one line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const v6 = { ...before7('dark'), version: 6, engine: { ...ENGINE_BEFORE_V7, memoryBudgetMiB: 6144 } };
    writeFileSync(file, JSON.stringify(v6));
    const migrated = { ...v3('dark'), engine: { ...SETTINGS_DEFAULTS_V14.engine, memoryBudgetMiB: 6144 } };
    expect(openSettingsStore(file).settings).toEqual(migrated);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/from version 6 to 14$/));
  });
  // W7 end

  // W13 start: W7's version 7 file loses the engine's pin, keeps a chosen binary, and is rewritten once
  it('migrates a version 7 file to version 8 without the pin, keeping a chosen binary, rewrites it once and logs one line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const v7 = before8('dark');
    writeFileSync(file, JSON.stringify({ ...v7, engine: { ...v7.engine, binaryPath: '/opt/claude', pinnedVersion: '2.1.290' } }));
    const migrated = { ...v3('dark'), engine: { ...SETTINGS_DEFAULTS_V14.engine, binaryPath: '/opt/claude' } };
    expect(openSettingsStore(file).settings).toEqual(migrated);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/from version 7 to 14$/));
  });
  // W13 end

  // E9 start: W13's version 8 file gains the voice section, the system locale, and is rewritten once
  it('migrates a version 8 file to version 9 with the voice section, keeping every other value, rewrites it once and logs one line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const v8 = { ...before9('dark'), keymap: { 'attention.next': 'Cmd+Alt+J' }, usage: { nearLimitPercent: 80 } };
    writeFileSync(file, JSON.stringify(v8));
    const migrated = { ...v3('dark'), keymap: { 'attention.next': 'Cmd+Alt+J' }, usage: { nearLimitPercent: 80 }, voice: { locale: null } };
    expect(openSettingsStore(file).settings).toEqual(migrated);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/from version 8 to 14$/));
    log.mockClear();
    expect(openSettingsStore(file).update({ voice: { locale: 'en-US' } }).voice).toEqual({ locale: 'en-US' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ ...migrated, voice: { locale: 'en-US' } });
    expect(log).not.toHaveBeenCalled();
  });
  // E9 end

  // E10 start: E9's version 9 file gains the supervisor section with its defaults, and is rewritten once
  it('migrates a version 9 file to version 10 with the supervisor section, keeping every other value, rewrites it once and logs one line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const v9 = { ...before10('dark'), voice: { locale: 'en-GB' }, usage: { nearLimitPercent: 80 } };
    writeFileSync(file, JSON.stringify(v9));
    const migrated = { ...v3('dark'), voice: { locale: 'en-GB' }, usage: { nearLimitPercent: 80 } };
    expect(openSettingsStore(file).settings).toEqual(migrated);
    expect(migrated.supervisor).toEqual({ idleExitMinutes: 10, keepRunningDefault: true });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/from version 9 to 14$/));
    log.mockClear();
    expect(openSettingsStore(file).update({ supervisor: { idleExitMinutes: null } }).supervisor).toEqual({ idleExitMinutes: null, keepRunningDefault: true });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ ...migrated, supervisor: { idleExitMinutes: null, keepRunningDefault: true } });
    expect(log).not.toHaveBeenCalled();
  });
  // E10 end

  // E4a start: E10's version 10 file gains the browser section with its defaults, and is rewritten once
  it('migrates a version 10 file to version 11 with the browser section, keeping every other value, rewrites it once and logs one line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const v10 = { ...before11('dark'), supervisor: { idleExitMinutes: 30, keepRunningDefault: false }, voice: { locale: 'en-GB' } };
    writeFileSync(file, JSON.stringify(v10));
    const migrated = { ...v3('dark'), supervisor: { idleExitMinutes: 30, keepRunningDefault: false }, voice: { locale: 'en-GB' } };
    expect(openSettingsStore(file).settings).toEqual(migrated);
    expect(migrated.browser).toEqual({ profile: null, searchUrl: 'https://www.google.com/search?q=%s', linkTarget: 'in-app', bookmarksBar: 'shown' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/from version 10 to 14$/));
    log.mockClear();
    expect(openSettingsStore(file).update({ browser: { linkTarget: 'external' } }).browser).toEqual({ ...migrated.browser, linkTarget: 'external' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ ...migrated, browser: { ...migrated.browser, linkTarget: 'external' } });
    expect(log).not.toHaveBeenCalled();
  });
  // E4a end

  // cua #90 start: E4a's version 11 file gains the bookmarks bar's switch, shown, and is rewritten once
  it('migrates a version 11 file to version 12 with the bookmarks bar shown, keeping every other value, rewrites it once and logs one line (P2-C: then to 13)', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const v11 = before12('dark');
    writeFileSync(file, JSON.stringify({ ...v11, browser: { ...v11.browser, linkTarget: 'external' } }));
    const migrated = { ...v3('dark'), browser: { ...v3('dark').browser, linkTarget: 'external' } };
    expect(openSettingsStore(file).settings).toEqual(migrated);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/from version 11 to 14$/));
  });
  // cua #90 end

  // P2-C start (2026-10-09): cua #90's version 12 file gains the mods section and the two owner-channel groups, rewritten once
  it('migrates a version 12 file to version 13 with the to-human lane and its two groups on, keeping every other value, rewrites it once and logs one line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const v12 = before13('dark');
    writeFileSync(file, JSON.stringify({ ...v12, notifications: { ...v12.notifications, kinds: { ...v12.notifications.kinds, errors: false } }, browser: { ...v12.browser, bookmarksBar: 'hidden' } }));
    const migrated = { ...v3('dark'), notifications: { ...v3('dark').notifications, kinds: { ...v3('dark').notifications.kinds, errors: false } }, browser: { ...v3('dark').browser, bookmarksBar: 'hidden' } };
    expect(openSettingsStore(file).settings).toEqual(migrated);
    expect(migrated.mods).toEqual({ toHuman: { enabled: true } });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/from version 12 to 14$/));
    log.mockClear();
    expect(openSettingsStore(file).update({ mods: { toHuman: { enabled: false } } }).mods).toEqual({ toHuman: { enabled: false } });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ ...migrated, mods: { toHuman: { enabled: false } } });
    expect(log).not.toHaveBeenCalled();
  });
  // P2-C end

  // P3-D start (2026-10-13): P2-C's version 13 file gains the design-system defaults, rewritten once
  it('migrates a version 13 file to version 14 with the house system and no Space defaults, keeping every other value, rewrites it once and logs one line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    writeFileSync(file, JSON.stringify({ ...before14('dark'), mods: { toHuman: { enabled: false } } }));
    const migrated = { ...v3('dark'), mods: { toHuman: { enabled: false } } };
    expect(openSettingsStore(file).settings).toEqual(migrated);
    expect(migrated.artifacts).toEqual({ defaultDesignSystem: null, spaceDesignSystems: {} });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/from version 13 to 14$/));
  });
  // P3-D end

  it('never rewrites a file that is already version 14, nor writes defaults into it', () => { // C12: version 4; W2: version 5; W3: version 6; W7: version 7; W13: version 8; E9: version 9; E10: version 10; E4a: version 11; cua #90: version 12; P2-C: version 13; P3-D: version 14
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
    const siblings = { approvals: false, questions: false, planReviews: false, errors: true, heldPeerMessages: true, asyncInput: false, essential: true /* P2-C */ };
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
