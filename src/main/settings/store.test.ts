import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as z from 'zod';
import { SettingsSchema, type Settings } from '@shared/ipc/schema/settings';
import { clientSettingsDefaults, machineSettingsDefaults, mergeSettings, migrateClientSettings, migrateMachineSettings, SETTINGS_DEFAULTS_V21, splitSettings as splitOf } from '@shared/settings/defaults';
import { composeSettings, resolveTheme } from '../client/settings-store';
import { startMachineSettings } from './machine';
import { settingsPaths, splitSettingsFiles } from './split';
import { openSettingsFile } from './store';

let dir: string;
let file: string;
let machineFile: string;

beforeEach(() => {
  vi.restoreAllMocks();
  dir = mkdtempSync(join(tmpdir(), 'maws-settings-'));
  file = join(dir, 'settings.json');
  machineFile = join(dir, 'machine-settings.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// P5 O3-A (docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §3): the profile's settings as main opens them holding
// spine.lock: the split of a unified file, once (logging one line), the machine half, and the merged settings over both
// files; `onDisk` is what the two files hold, merged.
const DEFAULT_SETTINGS = SETTINGS_DEFAULTS_V21;
const open = () => {
  const paths = settingsPaths(dir);
  const split = splitSettingsFiles(paths);
  return composeSettings({ clientFile: paths.client, machine: startMachineSettings(paths.machine, { refused: split.machineRefused, unsplit: split.unsplit }) });
};
const onDisk = () => mergeSettings(migrateClientSettings(JSON.parse(readFileSync(file, 'utf8'))), migrateMachineSettings(JSON.parse(readFileSync(machineFile, 'utf8'))));
const v3 = (theme: string) => ({ ...SETTINGS_DEFAULTS_V21, theme });
// P5 O2 M7: a version 19 file (and every earlier one) has no supervisor shape; migrated, it runs under the machine daemon
const before20 = (theme: string) => {
  const { shape: _shape, ...supervisor } = v3(theme).supervisor;
  void _shape;
  return { ...v3(theme), supervisor, version: 19 };
};
const shaped = <T extends { supervisor: object }>(earlier: T) => ({ ...earlier, version: 21, supervisor: { ...earlier.supervisor, shape: 'daemon' } }); // P5 O3-A: the merged settings
// Version 19 (the owner's ruling of 2026-10-28): a version 18 file's launch profile has an output style, the user
// scope's `user` (and so a version 17 file's).
const before19 = (theme: string) => ({ ...before20(theme), version: 18, engine: { ...before20(theme).engine, launchProfile: { ...before20(theme).engine.launchProfile, outputStyle: 'user' } } });
// UX1: v17 has neither policy; earlier fixtures must not inherit current fields.
const before18 = (theme: string) => {
  const { sessions: _sessions, ...rest } = before19(theme);
  const { turnFinished: _finished, ...kinds } = rest.notifications.kinds;
  void _sessions;
  void _finished;
  return { ...rest, version: 17, notifications: { ...rest.notifications, kinds } };
};
const ux1Policies = (earlier: { notifications: { enabled: boolean; sound: boolean; kinds: object } }) => ({ sessions: { archiveInactiveDays: null }, notifications: { ...earlier.notifications, kinds: { ...earlier.notifications.kinds, turnFinished: true } } });
// P4-A2 (2026-10-21): a version 16 file has no launch profile; a migrated one has the user scope (version 19: no style).
const USER_SCOPE = { plugins: { off: [] }, hooks: 'user' };
const before17 = (theme: string) => {
  const { launchProfile: _profile, ...engine } = before18(theme).engine;
  void _profile;
  return { ...before18(theme), engine, version: 16 };
};
// P4-R8 (2026-10-21): a version 15 file has no app MCP servers (P4-A2: nor a launch profile).
const before16 = (theme: string) => {
  const { mcpServers: _servers, ...engine } = before17(theme).engine;
  void _servers;
  return { ...before17(theme), engine, version: 15 };
};
// W7: a file an earlier version wrote has no budget switch; W13: and, before version 8, the engine's pin
const PIN = { pinnedVersion: '2.1.283' };
const { memoryBudget: _switch, ...ENGINE_V8_LESS_SWITCH } = before16('light').engine;
void _switch;
const ENGINE_BEFORE_V7 = { ...ENGINE_V8_LESS_SWITCH, ...PIN };
// P4-B1: nor, before version 15, the comments view
const before15 = (theme: string) => {
  const { commentsView: _view, ...artifacts } = before16(theme).artifacts;
  void _view;
  return { ...before16(theme), artifacts, version: 14 };
};
// P3-D: nor, before version 14, the design-system defaults
const before14 = (theme: string) => {
  const { artifacts: _d, ...rest } = before15(theme);
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
const before8 = (theme: string) => ({ ...before9(theme), version: 7, engine: { ...before9(theme).engine, ...PIN } });
const before7 = (theme: string) => ({ ...before9(theme), engine: ENGINE_BEFORE_V7 });
// W3: nor, before version 6, a permissions section
const before6 = (theme: string) => {
  const { permissions: _p, ...rest } = before7(theme);
  void _p;
  return rest;
};
const clientJson = (theme: string) => JSON.stringify({ ...clientSettingsDefaults(), theme }); // P5 O3-A: a client file
const FIXTURES = join(__dirname, '../../../test/fixtures/settings');

describe('settings persistence regressions', () => {
  // P5 O3-A: the split's writes fail; the run keeps the unified file's values in memory, writes neither file, and the
  // next start splits it
  it('keeps migrated dark settings when the split cannot write, refuses writes this run, and splits at the next start', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const original = JSON.stringify({ ...before6('dark'), version: 5, engine: { ...ENGINE_BEFORE_V7, subagentModel: 'haiku' } });
    writeFileSync(file, original);
    chmodSync(dir, 0o500);
    let store: ReturnType<typeof open>;
    try {
      store = open();
      expect(store.settings).toMatchObject({ theme: 'dark', engine: { subagentModel: 'haiku' } });
      expect(readFileSync(file, 'utf8')).toBe(original);
      expect(readdirSync(dir)).toEqual(['settings.json']);
    } finally {
      chmodSync(dir, 0o700);
    }
    expect(() => store.update({ notifications: { enabled: false } })).toThrow(/not written this run/);
    expect(() => store.update({ engine: { subagentModel: null } })).toThrow(/not written this run/);
    expect(readFileSync(file, 'utf8')).toBe(original);
    expect(open().update({ notifications: { enabled: false } })).toMatchObject({ theme: 'dark', engine: { subagentModel: 'haiku' }, notifications: { enabled: false } });
    expect(onDisk()).toMatchObject({ theme: 'dark', engine: { subagentModel: 'haiku' }, notifications: { enabled: false } });
  });

  it('refuses a patch when the disk file is unreadable or invalid instead of persisting defaults', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const original = '{"version":1,"theme":"dark"';
    writeFileSync(file, original);
    const store = open();
    expect(() => store.update({ notifications: { sound: true } })).toThrow();
    expect(readFileSync(file, 'utf8')).toBe(original);
    expect(() => store.update({ engine: { subagentModel: 'haiku' } })).toThrow(/not written this run/); // P5 O3-A: nor a machine file over it
    expect(readdirSync(dir)).toEqual(['settings.json']);
    writeFileSync(file, clientJson('dark'));
    chmodSync(file, 0o000);
    try {
      expect(() => store.update({ notifications: { sound: true } })).toThrow();
    } finally {
      chmodSync(file, 0o600);
    }
    expect(readFileSync(file, 'utf8')).toBe(clientJson('dark'));
  });

  it('merges an unrelated patch against the latest disk settings, not a stale snapshot', () => {
    const first = open();
    const second = open();
    first.update({ engine: { binaryPath: '/opt/custom/claude' }, notifications: { enabled: false } });
    second.update({ gateway: { offerDirect: false }, notifications: { sound: true } }); // P5 O3-A: each file merged against its own latest
    expect(open().settings).toMatchObject({ engine: { binaryPath: '/opt/custom/claude' }, gateway: { offerDirect: false }, notifications: { enabled: false, sound: true } });
  });
});

describe('settings store', () => {
  it('defaults to light when there is no file yet, silently and without writing one', () => {
    const warn = vi.spyOn(console, 'warn');
    expect(DEFAULT_SETTINGS).toEqual(v3('light'));
    expect(open().settings).toEqual(DEFAULT_SETTINGS);
    expect(warn).not.toHaveBeenCalled();
    // P5 O3-A: the machine file is written with its defaults, so a profile any split build started always has one
    expect(readdirSync(dir)).toEqual(['machine-settings.json']);
    expect(JSON.parse(readFileSync(machineFile, 'utf8'))).toEqual(machineSettingsDefaults());
  });

  it('reads the persisted setting', () => {
    writeFileSync(file, clientJson('dark'));
    writeFileSync(machineFile, JSON.stringify({ ...machineSettingsDefaults(), permissions: { autoFallback: 'plan' } }));
    expect(open().settings).toEqual({ ...v3('dark'), permissions: { autoFallback: 'plan' } });
  });

  it.each([
    ['unparseable JSON', '{"version":3,'],
    ['an unknown theme', JSON.stringify({ ...v3('sepia') })],
    ['an unknown later version', JSON.stringify({ ...clientSettingsDefaults(), theme: 'dark', version: 22 })], // P5 O3-A: a client file of a later version; C12: 4 is the current version; W2: 5; W3: 6; W7: 7; W13: 8; E9: 9; E10: 10; E4a: 11; cua #90: 12; P2-C: 13; P3-D: 14; P4-B1: 15; P4-R8: 16; P4-A2: 17; UX1: 18; the style removed: 19; P5 O2: 20; P5 O3-A: 21
    ['a merged object, which no file holds', JSON.stringify({ ...v3('dark') })], // P5 O3-A
    ['a version 2 file with a version 3 section', JSON.stringify({ version: 2, theme: 'dark', keymap: {}, notifications: { enabled: true, sound: false }, usage: { nearLimitPercent: 90 } })],
    ['an unknown key', JSON.stringify({ ...v3('dark'), font: 'x' })],
    ['a version 1 file that is not valid version 1', '{"version":1,"theme":"sepia"}'],
  ])('replaces a file with %s by the defaults and warns, never throws', (_, content) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeFileSync(file, content);
    expect(open().settings).toEqual(DEFAULT_SETTINGS);
    expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(file), expect.anything());
  });

  it('replaces an unreadable path by the defaults and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mkdirSync(file);
    expect(open().settings).toEqual(DEFAULT_SETTINGS);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('persists an update as compact JSON through a temporary file, leaving only the two settings files', () => {
    const store = open();
    expect(store.update({ theme: 'dark', gateway: { relayUnreachable: 'wait' } })).toEqual({ ...v3('dark'), gateway: { ...v3('dark').gateway, relayUnreachable: 'wait' } });
    expect(store.settings).toEqual({ ...v3('dark'), gateway: { ...v3('dark').gateway, relayUnreachable: 'wait' } });
    for (const persisted of [readFileSync(file, 'utf8'), readFileSync(machineFile, 'utf8')]) expect(persisted, 'compact JSON without whitespace or a trailing newline').toBe(JSON.stringify(JSON.parse(persisted)));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ ...clientSettingsDefaults(), theme: 'dark' });
    expect(readdirSync(dir).sort()).toEqual(['machine-settings.json', 'settings.json']);
    expect(open().settings).toEqual({ ...v3('dark'), gateway: { ...v3('dark').gateway, relayUnreachable: 'wait' } });
  });

  it('creates the settings directory when it does not exist yet', () => {
    const nested = join(dir, 'fresh');
    const paths = settingsPaths(nested);
    composeSettings({ clientFile: paths.client, machine: startMachineSettings(paths.machine, { refused: null }) }).update({ theme: 'system', sessions: { archiveInactiveDays: 30 } });
    expect(JSON.parse(readFileSync(paths.client, 'utf8'))).toEqual({ ...clientSettingsDefaults(), theme: 'system' });
    expect(JSON.parse(readFileSync(paths.machine, 'utf8'))).toEqual({ ...machineSettingsDefaults(), sessions: { archiveInactiveDays: 30 } });
  });

  it('keeps what a patch leaves out, including a key present as undefined', () => {
    const store = open();
    store.update({ theme: 'dark' });
    expect(store.update({})).toEqual(v3('dark'));
    expect(store.update({ theme: undefined })).toEqual(v3('dark'));
  });

  it('persists keymap overrides and the notification policy', () => {
    const store = open();
    store.update({ keymap: { 'attention.next': 'Cmd+Alt+J', 'tab.close': null }, notifications: { enabled: false, sound: true } });
    expect(open().settings).toEqual({
      ...SETTINGS_DEFAULTS_V21,
      keymap: { 'attention.next': 'Cmd+Alt+J', 'tab.close': null },
      notifications: { enabled: false, sound: true, kinds: SETTINGS_DEFAULTS_V21.notifications.kinds },
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
    expect(open().settings).toEqual(v3('dark'));
    expect(onDisk()).toEqual(v3('dark'));
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^\[settings\] split .*settings\.json \(version 1\) into machine-settings\.json \(version 1\) and the client file \(version 21\)$/)); // C12: to 4; W2: to 5; W3: to 6; W7: to 7; W13: to 8; E9: to 9; E10: to 10; E4a: to 11; cua #90: to 12; P2-C: to 13; P3-D: to 14; P4-B1: to 15; P4-R8: to 16; P4-A2: to 17; UX1: to 18; the style removed: to 19; P5 O2: to 20
  });

  it("migrates C5's version 2 file keeping its keymap override and notification policy, and rewrites it once", () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    writeFileSync(file, readFileSync(join(FIXTURES, 'v2.json')));
    const migrated = { ...v3('system'), keymap: { 'attention.next': 'Cmd+Alt+J' }, notifications: { enabled: false, sound: true, kinds: SETTINGS_DEFAULTS_V21.notifications.kinds } };
    expect(open().settings).toEqual(migrated);
    expect(onDisk()).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\(version 2\) into machine-settings\.json \(version 1\) and the client file \(version 21\)$/)); // C12: to 4; W2: to 5; W3: to 6; W7: to 7; W13: to 8; E9: to 9; E10: to 10; E4a: to 11; cua #90: to 12; P2-C: to 13; P3-D: to 14; P4-B1: to 15; P4-R8: to 16; P4-A2: to 17; UX1: to 18; the style removed: to 19; P5 O2: to 20
    log.mockClear();
    expect(open().settings).toEqual(migrated);
    expect(log).not.toHaveBeenCalled();
  });

  // C12 start: C11's version 3 file gains the budget's defaults and is rewritten once
  it('migrates a version 3 file to version 4 with the budget’s defaults, rewrites it once and logs one line', () => { // W2: to 5
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { memoryBudgetMiB: _m, statefulMcpServers: _s, ...engineV3 } = ENGINE_BEFORE_V7;
    void _m;
    void _s;
    writeFileSync(file, JSON.stringify({ ...before6('dark'), version: 3, engine: { ...engineV3, subagentModel: 'haiku' }, appearance: { monoFont: null } }));
    const migrated = { ...v3('dark'), engine: { ...SETTINGS_DEFAULTS_V21.engine, subagentModel: 'haiku' } };
    expect(open().settings).toEqual(migrated);
    expect(onDisk()).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\(version 3\) into machine-settings\.json \(version 1\) and the client file \(version 21\)$/));
  });
  // C12 end

  // W2 start: C12's version 4 file gains the transcript's default width and is rewritten once
  it('migrates a version 4 file to version 5 with the default width, rewrites it once and logs one line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    writeFileSync(file, JSON.stringify({ ...before6('dark'), version: 4, appearance: { monoFont: 'Hack' } }));
    const migrated = { ...v3('dark'), appearance: { monoFont: 'Hack', transcriptWidth: 768 } };
    expect(open().settings).toEqual(migrated);
    expect(onDisk()).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\(version 4\) into machine-settings\.json \(version 1\) and the client file \(version 21\)$/));
  });
  // W2 end

  // W3 start: W2's version 5 file gains the auto fallback's default and is rewritten once
  it('migrates a version 5 file to version 6 with acceptEdits as the auto fallback, rewrites it once and logs one line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    writeFileSync(file, JSON.stringify({ ...before6('dark'), version: 5 }));
    expect(open().settings).toEqual(v3('dark'));
    expect(onDisk()).toEqual(v3('dark'));
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\(version 5\) into machine-settings\.json \(version 1\) and the client file \(version 21\)$/));
  });
  // W3 end

  // W7 start: W3's version 6 file gains the budget's switch, on, and is rewritten once
  it('migrates a version 6 file to version 7 with the budget on, keeping its own budget, rewrites it once and logs one line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const v6 = { ...before7('dark'), version: 6, engine: { ...ENGINE_BEFORE_V7, memoryBudgetMiB: 6144 } };
    writeFileSync(file, JSON.stringify(v6));
    const migrated = { ...v3('dark'), engine: { ...SETTINGS_DEFAULTS_V21.engine, memoryBudgetMiB: 6144 } };
    expect(open().settings).toEqual(migrated);
    expect(onDisk()).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\(version 6\) into machine-settings\.json \(version 1\) and the client file \(version 21\)$/));
  });
  // W7 end

  // W13 start: W7's version 7 file loses the engine's pin, keeps a chosen binary, and is rewritten once
  it('migrates a version 7 file to version 8 without the pin, keeping a chosen binary, rewrites it once and logs one line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const v7 = before8('dark');
    writeFileSync(file, JSON.stringify({ ...v7, engine: { ...v7.engine, binaryPath: '/opt/claude', pinnedVersion: '2.1.290' } }));
    const migrated = { ...v3('dark'), engine: { ...SETTINGS_DEFAULTS_V21.engine, binaryPath: '/opt/claude' } };
    expect(open().settings).toEqual(migrated);
    expect(onDisk()).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\(version 7\) into machine-settings\.json \(version 1\) and the client file \(version 21\)$/));
  });
  // W13 end

  // E9 start: W13's version 8 file gains the voice section, the system locale, and is rewritten once
  it('migrates a version 8 file to version 9 with the voice section, keeping every other value, rewrites it once and logs one line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const v8 = { ...before9('dark'), keymap: { 'attention.next': 'Cmd+Alt+J' }, usage: { nearLimitPercent: 80 } };
    writeFileSync(file, JSON.stringify(v8));
    const migrated = { ...v3('dark'), keymap: { 'attention.next': 'Cmd+Alt+J' }, usage: { nearLimitPercent: 80 }, voice: { locale: null } };
    expect(open().settings).toEqual(migrated);
    expect(onDisk()).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\(version 8\) into machine-settings\.json \(version 1\) and the client file \(version 21\)$/));
    log.mockClear();
    expect(open().update({ voice: { locale: 'en-US' } }).voice).toEqual({ locale: 'en-US' });
    expect(onDisk()).toEqual({ ...migrated, voice: { locale: 'en-US' } });
    expect(log).not.toHaveBeenCalled();
  });
  // E9 end

  // E10 start: E9's version 9 file gains the supervisor section with its defaults, and is rewritten once
  it('migrates a version 9 file to version 10 with the supervisor section, keeping every other value, rewrites it once and logs one line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const v9 = { ...before10('dark'), voice: { locale: 'en-GB' }, usage: { nearLimitPercent: 80 } };
    writeFileSync(file, JSON.stringify(v9));
    const migrated = { ...v3('dark'), voice: { locale: 'en-GB' }, usage: { nearLimitPercent: 80 } };
    expect(open().settings).toEqual(migrated);
    expect(migrated.supervisor).toEqual({ idleExitMinutes: 10, keepRunningDefault: true, shape: 'daemon' }); // P5 O2 M7: then to 20
    expect(onDisk()).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\(version 9\) into machine-settings\.json \(version 1\) and the client file \(version 21\)$/));
    log.mockClear();
    expect(open().update({ supervisor: { idleExitMinutes: null } }).supervisor).toEqual({ idleExitMinutes: null, keepRunningDefault: true, shape: 'daemon' });
    expect(onDisk()).toEqual({ ...migrated, supervisor: { idleExitMinutes: null, keepRunningDefault: true, shape: 'daemon' } });
    expect(log).not.toHaveBeenCalled();
  });
  // E10 end

  // E4a start: E10's version 10 file gains the browser section with its defaults, and is rewritten once
  it('migrates a version 10 file to version 11 with the browser section, keeping every other value, rewrites it once and logs one line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const v10 = { ...before11('dark'), supervisor: { idleExitMinutes: 30, keepRunningDefault: false }, voice: { locale: 'en-GB' } };
    writeFileSync(file, JSON.stringify(v10));
    const migrated = { ...v3('dark'), supervisor: { idleExitMinutes: 30, keepRunningDefault: false, shape: 'daemon' }, voice: { locale: 'en-GB' } };
    expect(open().settings).toEqual(migrated);
    expect(migrated.browser).toEqual({ profile: null, searchUrl: 'https://www.google.com/search?q=%s', linkTarget: 'in-app', bookmarksBar: 'shown' });
    expect(onDisk()).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\(version 10\) into machine-settings\.json \(version 1\) and the client file \(version 21\)$/));
    log.mockClear();
    expect(open().update({ browser: { linkTarget: 'external' } }).browser).toEqual({ ...migrated.browser, linkTarget: 'external' });
    expect(onDisk()).toEqual({ ...migrated, browser: { ...migrated.browser, linkTarget: 'external' } });
    expect(log).not.toHaveBeenCalled();
  });
  // E4a end

  // cua #90 start: E4a's version 11 file gains the bookmarks bar's switch, shown, and is rewritten once
  it('migrates a version 11 file to version 12 with the bookmarks bar shown, keeping every other value, rewrites it once and logs one line (P2-C: then to 13)', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const v11 = before12('dark');
    writeFileSync(file, JSON.stringify({ ...v11, browser: { ...v11.browser, linkTarget: 'external' } }));
    const migrated = { ...v3('dark'), browser: { ...v3('dark').browser, linkTarget: 'external' } };
    expect(open().settings).toEqual(migrated);
    expect(onDisk()).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\(version 11\) into machine-settings\.json \(version 1\) and the client file \(version 21\)$/));
  });
  // cua #90 end

  // P2-C start (2026-10-09): cua #90's version 12 file gains the mods section and the two owner-channel groups, rewritten once
  it('migrates a version 12 file to version 13 with the to-human lane and its two groups on, keeping every other value, rewrites it once and logs one line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const v12 = before13('dark');
    writeFileSync(file, JSON.stringify({ ...v12, notifications: { ...v12.notifications, kinds: { ...v12.notifications.kinds, errors: false } }, browser: { ...v12.browser, bookmarksBar: 'hidden' } }));
    const migrated = { ...v3('dark'), notifications: { ...v3('dark').notifications, kinds: { ...v3('dark').notifications.kinds, errors: false } }, browser: { ...v3('dark').browser, bookmarksBar: 'hidden' } };
    expect(open().settings).toEqual(migrated);
    expect(migrated.mods).toEqual({ toHuman: { enabled: true } });
    expect(onDisk()).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\(version 12\) into machine-settings\.json \(version 1\) and the client file \(version 21\)$/));
    log.mockClear();
    expect(open().update({ mods: { toHuman: { enabled: false } } }).mods).toEqual({ toHuman: { enabled: false } });
    expect(onDisk()).toEqual({ ...migrated, mods: { toHuman: { enabled: false } } });
    expect(log).not.toHaveBeenCalled();
  });
  // P2-C end

  // P3-D start (2026-10-13): P2-C's version 13 file gains the design-system defaults, rewritten once
  it('migrates a version 13 file to version 14 with the house system and no Space defaults, keeping every other value, rewrites it once and logs one line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    writeFileSync(file, JSON.stringify({ ...before14('dark'), mods: { toHuman: { enabled: false } } }));
    const migrated = { ...v3('dark'), mods: { toHuman: { enabled: false } } };
    expect(open().settings).toEqual(migrated);
    expect(migrated.artifacts).toEqual({ defaultDesignSystem: null, spaceDesignSystems: {}, commentsView: 'expand' }); // P4-B1: then to 15
    expect(onDisk()).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\(version 13\) into machine-settings\.json \(version 1\) and the client file \(version 21\)$/));
  });
  // P3-D end

  // P4-B1 start (2026-10-20): P3-D's version 14 file gains the comments view, rewritten once
  it('migrates a version 14 file to version 15 with the cards in the margin, keeping every other value, rewrites it once and logs one line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    writeFileSync(file, JSON.stringify(before15('dark')));
    const migrated = v3('dark');
    expect(open().settings).toEqual(migrated);
    expect(migrated.artifacts.commentsView).toBe('expand');
    expect(onDisk()).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\(version 14\) into machine-settings\.json \(version 1\) and the client file \(version 21\)$/));
  });
  // P4-B1 end

  // P4-R8 start (2026-10-21): P4-B1's version 15 file gains an empty app server list, rewritten once
  it('migrates a version 15 file to version 16 with no app servers, keeps every other value and rewrites it once', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const v15 = { ...before16('dark'), engine: { ...before16('dark').engine, binaryPath: '/opt/claude', subagentModel: 'haiku', statefulMcpServers: ['plugin:ptc:ptc'], memoryBudget: { enabled: false } }, artifacts: { ...before16('dark').artifacts, commentsView: 'hide' } };
    writeFileSync(file, JSON.stringify(v15));
    const migrated = { ...shaped(v15), ...ux1Policies(v15), engine: { ...v15.engine, mcpServers: [], launchProfile: USER_SCOPE } }; // P4-A2: then to 17
    expect(open().settings).toEqual(migrated);
    expect(onDisk()).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\(version 15\) into machine-settings\.json \(version 1\) and the client file \(version 21\)$/));
    log.mockClear();
    expect(open().settings).toEqual(migrated);
    expect(log).not.toHaveBeenCalled();
  });
  // P4-R8 end

  // P4-A2 start (2026-10-21): P4-R8's version 16 file gains the user scope, rewritten once; the profile then persists
  it('migrates a version 16 file to version 20 with the user scope, keeps every other value and rewrites it once', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const v16 = { ...before17('dark'), engine: { ...before17('dark').engine, binaryPath: '/opt/claude', statefulMcpServers: ['plugin:ptc:ptc'], mcpServers: [{ name: 'notion', type: 'http', url: 'https://mcp.notion.com/mcp' }] }, mods: { toHuman: { enabled: false } } };
    writeFileSync(file, JSON.stringify(v16));
    const migrated = { ...shaped(v16), ...ux1Policies(v16), engine: { ...v16.engine, launchProfile: USER_SCOPE } };
    expect(open().settings).toEqual(migrated);
    expect(onDisk()).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\(version 16\) into machine-settings\.json \(version 1\) and the client file \(version 21\)$/));
    log.mockClear();
    const launchProfile = { plugins: { off: ['ptc@ptc-tool'] }, hooks: 'none' as const };
    expect(open().update({ engine: { launchProfile } }).engine).toEqual({ ...migrated.engine, launchProfile });
    expect(onDisk()).toEqual({ ...migrated, engine: { ...migrated.engine, launchProfile } });
    expect(open().settings.engine.launchProfile).toEqual(launchProfile);
    expect(log).not.toHaveBeenCalled();
  });
  // P4-A2 end

  it('migrates a v17 file once, filling both policies and preserving owner choices', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const saved = { ...before18('dark'), notifications: { ...before18('dark').notifications, sound: true } };
    writeFileSync(file, JSON.stringify(saved));
    const migrated = { ...shaped(saved), ...ux1Policies(saved), engine: { ...saved.engine, launchProfile: USER_SCOPE } };
    expect(open().settings).toEqual(migrated);
    expect(onDisk()).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\(version 17\) into machine-settings\.json \(version 1\) and the client file \(version 21\)$/));
    log.mockClear();
    expect(open().settings).toEqual(migrated);
    expect(log).not.toHaveBeenCalled();
  });

  // Version 19 (the owner's ruling of 2026-10-28): a version 18 file drops its launch profile's output style, rewritten
  // once; a profile that chose MAWS's (the engine's default style) keeps the user's from now on
  it('migrates a version 18 file to version 19 without the profile’s style, keeps every other value and rewrites it once (P5 O2: then to 20)', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const saved = { ...before19('dark'), engine: { ...before19('dark').engine, launchProfile: { plugins: { off: ['ptc@ptc-tool'] }, outputStyle: 'maws', hooks: 'none' } } };
    writeFileSync(file, JSON.stringify(saved));
    const migrated = shaped({ ...saved, engine: { ...saved.engine, launchProfile: { plugins: { off: ['ptc@ptc-tool'] }, hooks: 'none' } } });
    expect(open().settings).toEqual(migrated);
    expect(onDisk()).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\(version 18\) into machine-settings\.json \(version 1\) and the client file \(version 21\)$/));
    log.mockClear();
    expect(open().settings).toEqual(migrated);
    expect(log).not.toHaveBeenCalled();
  });

  // P5 O2 M7: a version 19 file gains the supervisor's shape, the machine daemon, rewritten once
  it('migrates a version 19 file to version 20 under the machine daemon, keeps every other value and rewrites it once', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const saved = { ...before20('dark'), supervisor: { idleExitMinutes: null, keepRunningDefault: false }, sessions: { archiveInactiveDays: 14 } };
    writeFileSync(file, JSON.stringify(saved));
    const migrated = shaped(saved);
    expect(open().settings).toEqual(migrated);
    expect(onDisk()).toEqual(migrated);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\(version 19\) into machine-settings\.json \(version 1\) and the client file \(version 21\)$/));
    log.mockClear();
    expect(open().settings).toEqual(migrated);
    expect(log).not.toHaveBeenCalled();
  });

  // C12: version 4; W2: version 5; W3: version 6; W7: version 7; W13: version 8; E9: version 9; E10: version 10; E4a: version 11; cua #90: version 12; P2-C: version 13; P3-D: version 14; P4-B1: version 15; P4-R8: version 16; P4-A2: version 17; UX1: version 18; the style removed: version 19; P5 O2: version 20; P5 O3-A: the client file at 21 beside the machine file at 1
  it('never rewrites files already split, nor writes defaults into them', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const text = JSON.stringify({ ...clientSettingsDefaults(), theme: 'system', usage: { nearLimitPercent: 80 } }, null, 2); // not the store's own formatting
    const machineText = JSON.stringify({ ...machineSettingsDefaults(), engine: { ...machineSettingsDefaults().engine, subagentModel: 'haiku' } }, null, 2);
    writeFileSync(file, text);
    writeFileSync(machineFile, machineText);
    expect(open().settings).toMatchObject({ theme: 'system', usage: { nearLimitPercent: 80 }, engine: { subagentModel: 'haiku' } });
    expect(readFileSync(file, 'utf8')).toBe(text);
    expect(readFileSync(machineFile, 'utf8')).toBe(machineText);
    expect(log).not.toHaveBeenCalled();
  });
});

// P5 O3-A (docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §3, O3-A acceptance 2 and 3): the split, once and idempotent
describe('the settings split', () => {
  // The merged settings with every field away from its default, and the unified file an O2-era profile holds of them
  const merged = (): Settings => ({
    ...SETTINGS_DEFAULTS_V21, theme: 'dark',
    keymap: { 'attention.next': 'Cmd+Alt+J' },
    engine: { ...SETTINGS_DEFAULTS_V21.engine, subagentModel: 'haiku', mcpServers: [{ name: 'notion', type: 'http', url: 'https://mcp.notion.com/mcp' }] },
    gateway: { defaultRoute: 'direct', relayUnreachable: 'wait', offerDirect: false },
    usage: { nearLimitPercent: 75 },
    permissions: { autoFallback: 'plan' },
    supervisor: { idleExitMinutes: 30, keepRunningDefault: false, shape: 'embedded' },
    mods: { toHuman: { enabled: false } },
    artifacts: { defaultDesignSystem: '6f1c1d2e-0b7a-4c55-9a3e-2f1b0c9d8e71', spaceDesignSystems: {}, commentsView: 'hide', exportAuthorName: 'Kim Min' },
    sessions: { archiveInactiveDays: 14 },
  });
  const unified = () => ({ ...merged(), version: 20 });
  const paths = () => settingsPaths(dir);
  const io = (fail?: { path: string; nth: number }) => {
    let writes = 0;
    return {
      read: (path: string) => { try { return readFileSync(path, 'utf8'); } catch { return null; } },
      write: (path: string, text: string) => {
        writes += 1;
        if (fail && path === fail.path && writes === fail.nth) throw Object.assign(new Error('the disk went away'), { code: 'EIO' });
        writeFileSync(path, text);
      },
    };
  };

  it('writes each file exactly its owner’s fields: the machine file at 1, settings.json at 21', () => {
    writeFileSync(file, JSON.stringify(unified()));
    expect(splitSettingsFiles(paths(), undefined, () => {})).toEqual({ outcome: 'split', machineRefused: null, unsplit: null });
    const machine = JSON.parse(readFileSync(machineFile, 'utf8'));
    const client = JSON.parse(readFileSync(file, 'utf8'));
    expect(Object.keys(machine).sort()).toEqual(['artifacts', 'engine', 'gateway', 'mods', 'permissions', 'sessions', 'supervisor', 'version']);
    expect(machine).toMatchObject({ version: 1, supervisor: { idleExitMinutes: 30 }, artifacts: { defaultDesignSystem: '6f1c1d2e-0b7a-4c55-9a3e-2f1b0c9d8e71', spaceDesignSystems: {} } });
    expect(machine.supervisor).not.toHaveProperty('shape');
    expect(machine.artifacts).not.toHaveProperty('commentsView');
    expect(Object.keys(client).sort()).toEqual(['appearance', 'artifacts', 'browser', 'keymap', 'notifications', 'supervisor', 'theme', 'usage', 'version', 'voice']);
    expect(client).toMatchObject({ version: 21, supervisor: { keepRunningDefault: false, shape: 'embedded' }, artifacts: { commentsView: 'hide', exportAuthorName: 'Kim Min' } });
    expect(client.supervisor).not.toHaveProperty('idleExitMinutes');
    expect(onDisk()).toEqual(merged());
  });

  // Every point a start can stop at, and the start after it: the same two files, nothing lost or doubled
  it.each([
    ['writing the machine file', 1],
    ['writing the client file, after the machine file', 2],
  ])('converges to the same files after an interruption while %s', (_, nth) => {
    writeFileSync(file, JSON.stringify(unified()));
    const target = nth === 1 ? machineFile : file;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const interrupted = splitSettingsFiles(paths(), io({ path: target, nth }), () => {});
    expect(warn).toHaveBeenCalledOnce();
    if (nth === 1) {
      // nothing written: the unified file intact, its machine fields held in memory for this run with writes refused
      expect(interrupted).toMatchObject({ outcome: 'none', unsplit: splitOf(merged()).machine });
      expect(interrupted.machineRefused).toMatch(/could not be written/);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(unified());
      expect(readdirSync(dir)).toEqual(['settings.json']);
    } else {
      // the machine file written and authoritative; settings.json still unified, read and not written this run
      expect(interrupted).toEqual({ outcome: 'split', machineRefused: null, unsplit: null });
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(unified());
      expect(JSON.parse(readFileSync(machineFile, 'utf8'))).toEqual(splitOf(merged()).machine);
    }
    const next = splitSettingsFiles(paths(), undefined, () => {});
    expect(next.outcome).toBe(nth === 1 ? 'split' : 'finished');
    expect(onDisk()).toEqual(merged());
    expect(splitSettingsFiles(paths(), undefined, () => {}).outcome).toBe('none');
    expect(onDisk()).toEqual(merged());
  });

  it('a crash between the two writes leaves the machine file authoritative: a later unified write the old build made is not read for machine fields', () => {
    writeFileSync(file, JSON.stringify(unified()));
    splitSettingsFiles(paths(), io({ path: file, nth: 2 }), () => {});
    vi.restoreAllMocks();
    // settings.json still unified, edited meanwhile (a pre-split build's write of a client field and a machine field)
    writeFileSync(file, JSON.stringify({ ...unified(), theme: 'light', gateway: { defaultRoute: 'gateway', relayUnreachable: 'ask', offerDirect: true } }));
    splitSettingsFiles(paths(), undefined, () => {});
    expect(onDisk()).toEqual({ ...merged(), theme: 'light' }); // the client field taken; the machine file's gateway kept
  });

  it('a settings.json this build cannot read creates no machine file over it, and the run refuses machine writes', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const text of ['{"version":20,', JSON.stringify({ ...unified(), theme: 'sepia' }), JSON.stringify({ ...clientSettingsDefaults(), version: 22 })]) {
      writeFileSync(file, text);
      const outcome = splitSettingsFiles(paths(), undefined, () => {});
      expect(outcome.outcome).toBe('none');
      expect(outcome.machineRefused).toMatch(/is not a settings file this build reads[\s\S]*machine-settings\.json is not created over it/);
      expect(readdirSync(dir)).toEqual(['settings.json']);
      expect(readFileSync(file, 'utf8')).toBe(text);
    }
  });

  it('a client file whose machine file has gone gains the machine defaults, and keeps its own bytes', () => {
    const text = clientJson('dark');
    writeFileSync(file, text);
    expect(splitSettingsFiles(paths(), undefined, () => {}).outcome).toBe('machine');
    expect(readFileSync(file, 'utf8')).toBe(text);
    expect(JSON.parse(readFileSync(machineFile, 'utf8'))).toEqual(machineSettingsDefaults());
  });

  // O3-A acceptance 7: a build before the split opens the split files. Its reading was the unified migration ending in
  // version 20's schema (`SettingsSchema` at 20): neither file is a version it knows, so its store keeps the defaults in
  // memory, refuses writes, and writes neither file at open (its rule for a file it cannot read).
  it('a build before the split reads neither file as its own', () => {
    writeFileSync(file, JSON.stringify(unified()));
    splitSettingsFiles(paths(), undefined, () => {});
    const preSplit = SettingsSchema.extend({ version: z.literal(20) });
    expect(preSplit.safeParse(JSON.parse(readFileSync(file, 'utf8'))).success).toBe(false);
    expect(preSplit.safeParse(JSON.parse(readFileSync(machineFile, 'utf8'))).success).toBe(false);
    const before = [readFileSync(file, 'utf8'), readFileSync(machineFile, 'utf8')];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const preSplitStore = openSettingsFile(file, { read: (raw) => ({ value: preSplit.parse(raw) }), defaults: () => ({ ...SETTINGS_DEFAULTS_V21, version: 20 as const }), validate: (value) => preSplit.parse(value) });
    expect(preSplitStore.value.theme).toBe('light'); // the defaults, not the person's dark
    expect(() => preSplitStore.update((settings) => ({ ...settings, theme: 'dark' }))).toThrow();
    expect([readFileSync(file, 'utf8'), readFileSync(machineFile, 'utf8')]).toEqual(before);
  });
});

describe('settings patch merges one kind and keeps its siblings', () => {
  it('changes one gateway field and keeps the rest of the state', () => {
    const store = open();
    expect(store.update({ gateway: { relayUnreachable: 'wait' } })).toEqual({ ...DEFAULT_SETTINGS, gateway: { ...DEFAULT_SETTINGS.gateway, relayUnreachable: 'wait' } });
  });

  it('patches one notification kind and leaves its four siblings; a notifications field leaves kinds alone', () => {
    const store = open();
    const siblings = { turnFinished: false, approvals: false, questions: false, planReviews: false, errors: true, heldPeerMessages: true, asyncInput: false, essential: true /* P2-C */ };
    store.update({ notifications: { kinds: siblings } });
    expect(store.update({ notifications: { kinds: { errors: false } } }).notifications.kinds).toEqual({ ...siblings, errors: false });
    expect(store.update({ notifications: { enabled: false } }).notifications).toEqual({ enabled: false, sound: false, kinds: { ...siblings, errors: false } });
    expect(open().settings.notifications.kinds).toEqual({ ...siblings, errors: false });
  });

  it('refuses a merged state the schema refuses, and keeps the previous one', () => {
    const store = open();
    expect(() => store.update({ usage: { nearLimitPercent: 20 } })).toThrow();
    expect(store.settings).toEqual(DEFAULT_SETTINGS);
  });
});
