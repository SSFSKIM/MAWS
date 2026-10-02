import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SettingsPatchSchema, SettingsSchema, type Settings } from '../ipc/schema/settings';
import { applySettingsPatch, migrateSettings, SETTINGS_DEFAULTS_V8 } from './defaults';

const fixture = (name: string): unknown => JSON.parse(readFileSync(resolve(__dirname, '../../../test/fixtures/settings', name), 'utf8'));
// W13: the pin every version from 3 to 7 wrote (version 8 drops it)
const PIN = { pinnedVersion: '2.1.283' };
// W7: the engine section every version from 4 to 6 wrote (version 7 adds the budget's switch), with the pin
const { memoryBudget: _switch, ...ENGINE_V8_LESS_SWITCH } = SETTINGS_DEFAULTS_V8.engine;
void _switch;
const ENGINE_BEFORE_V7 = { ...ENGINE_V8_LESS_SWITCH, ...PIN };
// W13: an engine section as version 8 holds it: the pin gone
const unpinned = <E extends { pinnedVersion?: string }>(engine: E): Omit<E, 'pinnedVersion'> => {
  const { pinnedVersion: _pin, ...rest } = engine;
  void _pin;
  return rest;
};
// W3: the sections every version before 6 wrote (version 6 adds the permissions)
const { permissions: _permissions, ...SECTIONS_BEFORE_V6 } = SETTINGS_DEFAULTS_V8;
void _permissions;
const BEFORE_V6 = { ...SECTIONS_BEFORE_V6, engine: ENGINE_BEFORE_V7 };
const ON = { memoryBudget: { enabled: true } }; // W7: what a migrated engine section gains

describe('settings migrate v1 and v2 to v3', () => {
  it('holds the defaults the document states, and they validate', () => {
    expect(SETTINGS_DEFAULTS_V8).toEqual({
      version: 8, // C12: 4; W2: 5; W3: 6; W7: 7; W13: 8
      theme: 'light',
      keymap: {},
      notifications: { enabled: true, sound: false, kinds: { approvals: true, questions: true, planReviews: true, errors: true, heldPeerMessages: false } },
      engine: { binaryPath: null, subagentModel: null, memoryBudgetMiB: null, statefulMcpServers: [] /* C12 */, memoryBudget: { enabled: true } /* W7 */ }, // W13: no pin
      gateway: { defaultRoute: 'gateway', relayUnreachable: 'ask', offerDirect: true },
      usage: { nearLimitPercent: 90 },
      appearance: { monoFont: null, transcriptWidth: 768 /* W2 */ },
      permissions: { autoFallback: 'acceptEdits' }, // W3
    });
    expect(SettingsSchema.parse(SETTINGS_DEFAULTS_V8)).toEqual(SETTINGS_DEFAULTS_V8);
  });

  it('migrates the v1 fixture to the defaults with its theme', () => {
    expect(migrateSettings(fixture('v1.json'))).toEqual({ ...SETTINGS_DEFAULTS_V8, theme: 'dark' });
  });

  it('migrates the v2 fixture keeping its theme, its keymap override and its notification policy', () => {
    const migrated = migrateSettings(fixture('v2.json'));
    expect(SettingsSchema.safeParse(migrated).success).toBe(true);
    expect(migrated).toEqual({
      ...SETTINGS_DEFAULTS_V8,
      theme: 'system',
      keymap: { 'attention.next': 'Cmd+Alt+J' },
      notifications: { enabled: false, sound: true, kinds: SETTINGS_DEFAULTS_V8.notifications.kinds },
    });
  });

  // W10: ⌥Enter's hold (`composer.steer`) is gone; a file that overrode it keeps everything else
  it('drops an override of a retired action instead of refusing the file, at the current version and an earlier one', () => {
    const current = { ...SETTINGS_DEFAULTS_V8, theme: 'dark', keymap: { 'composer.steer': 'Cmd+Enter', 'attention.next': 'Cmd+Alt+J' } };
    expect(migrateSettings(current)).toEqual({ ...SETTINGS_DEFAULTS_V8, theme: 'dark', keymap: { 'attention.next': 'Cmd+Alt+J' } });
    const v2 = { version: 2, theme: 'system', keymap: { 'composer.steer': null }, notifications: { enabled: true, sound: false } };
    expect(migrateSettings(v2).keymap).toEqual({});
    expect(() => migrateSettings({ ...SETTINGS_DEFAULTS_V8, keymap: { 'composer.nothing': 'Cmd+J' } })).toThrow(); // an unknown id still refuses
  });

  // C12 start: version 4 (the memory budget); a v3 object gains the budget's defaults. W2: the identity moves to v5, and
  // a v3 or v4 object gains the transcript's default width. W3: the identity moves to v6. W7: to v7, and every earlier
  // object gains the budget's switch, on. W13: the identity moves to v8, and every earlier object loses its pin.
  it('is the identity over a v8 object', () => {
    const v8: Settings = {
      ...SETTINGS_DEFAULTS_V8,
      theme: 'dark',
      gateway: { defaultRoute: 'direct', relayUnreachable: 'wait', offerDirect: false },
      appearance: { monoFont: 'JetBrainsMono Nerd Font', transcriptWidth: 1280 },
      engine: { ...SETTINGS_DEFAULTS_V8.engine, memoryBudgetMiB: 6144, statefulMcpServers: ['plugin:ptc:ptc'], memoryBudget: { enabled: false } },
      permissions: { autoFallback: 'default' },
    };
    expect(migrateSettings(structuredClone(v8))).toEqual(v8);
  });

  it('migrates a v3 object to v8 keeping every v3 value, with the budget’s defaults, the default width, the default fallback and the budget on', () => {
    const { memoryBudgetMiB: _m, statefulMcpServers: _s, ...engineV3 } = { ...ENGINE_BEFORE_V7, binaryPath: '/opt/claude', subagentModel: 'haiku' };
    void _m;
    void _s;
    const v3 = { ...BEFORE_V6, version: 3, theme: 'dark', keymap: { 'attention.next': 'Cmd+Alt+J' }, usage: { nearLimitPercent: 80 }, engine: engineV3, appearance: { monoFont: 'Hack' } };
    const migrated = migrateSettings(structuredClone(v3));
    expect(migrated).toEqual({ ...v3, version: 8, engine: { ...unpinned(engineV3), memoryBudgetMiB: null, statefulMcpServers: [], ...ON }, appearance: { monoFont: 'Hack', transcriptWidth: 768 }, permissions: { autoFallback: 'acceptEdits' } });
    expect(SettingsSchema.safeParse(migrated).success).toBe(true);
  });
  // C12 end

  // W2 start
  it('migrates a v4 object to v8 keeping every v4 value, with the default width, the default fallback and the budget on', () => {
    const v4 = { ...BEFORE_V6, version: 4, theme: 'dark', engine: { ...ENGINE_BEFORE_V7, memoryBudgetMiB: 6144 }, appearance: { monoFont: 'Hack' } };
    const migrated = migrateSettings(structuredClone(v4));
    expect(migrated).toEqual({ ...v4, version: 8, engine: { ...unpinned(v4.engine), ...ON }, appearance: { monoFont: 'Hack', transcriptWidth: 768 }, permissions: { autoFallback: 'acceptEdits' } });
    expect(SettingsSchema.safeParse(migrated).success).toBe(true);
  });
  // W2 end

  // W3 start
  it('migrates a v5 object to v8 keeping every v5 value, with acceptEdits as the auto fallback and the budget on', () => {
    const v5 = { ...BEFORE_V6, version: 5, theme: 'dark', appearance: { monoFont: 'Hack', transcriptWidth: 960 } };
    const migrated = migrateSettings(structuredClone(v5));
    expect(migrated).toEqual({ ...v5, version: 8, engine: { ...unpinned(v5.engine), ...ON }, permissions: { autoFallback: 'acceptEdits' } });
    expect(SettingsSchema.safeParse(migrated).success).toBe(true);
  });

  it('takes any engine mode but auto as the fallback', () => {
    expect(SettingsPatchSchema.safeParse({ permissions: { autoFallback: 'plan' } }).success).toBe(true);
    expect(SettingsPatchSchema.safeParse({ permissions: { autoFallback: 'auto' } }).success).toBe(false);
    expect(applySettingsPatch(SETTINGS_DEFAULTS_V8, { permissions: { autoFallback: 'default' } }).permissions).toEqual({ autoFallback: 'default' });
  });
  // W3 end

  // W7 start
  it('migrates a v6 object to v8 keeping every v6 value, its own budget and stateful servers included, with the budget on', () => {
    const v6 = { ...SECTIONS_BEFORE_V6, version: 6, theme: 'dark', engine: { ...ENGINE_BEFORE_V7, memoryBudgetMiB: 6144, statefulMcpServers: ['plugin:ptc:ptc'] }, permissions: { autoFallback: 'plan' } };
    const migrated = migrateSettings(structuredClone(v6));
    expect(migrated).toEqual({ ...v6, version: 8, engine: { ...unpinned(v6.engine), ...ON } });
    expect(SettingsSchema.safeParse(migrated).success).toBe(true);
  });

  it('takes the switch as one object a patch replaces whole, and nothing but a boolean in it', () => {
    const off = applySettingsPatch(SETTINGS_DEFAULTS_V8, SettingsPatchSchema.parse({ engine: { memoryBudget: { enabled: false } } }));
    expect(off.engine).toEqual({ ...SETTINGS_DEFAULTS_V8.engine, memoryBudget: { enabled: false } });
    expect(SettingsPatchSchema.safeParse({ engine: { memoryBudget: {} } }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ engine: { memoryBudget: { enabled: 'off' } } }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ engine: { memoryBudget: { enabled: true, limitMiB: 1 } } }).success).toBe(false);
  });
  // W7 end

  // W13 start: v7 → v8 drops the pin (charter D-1 as amended 2026-10-01); a chosen binary stays chosen, any pin is dropped
  it('migrates a v7 object to v8 dropping its pin and keeping every other value, a chosen binary path included', () => {
    for (const pinnedVersion of ['2.1.283', '2.1.290']) {
      const v7 = { ...SETTINGS_DEFAULTS_V8, version: 7, theme: 'dark', engine: { ...SETTINGS_DEFAULTS_V8.engine, binaryPath: '/opt/claude', pinnedVersion, memoryBudget: { enabled: false } } };
      const migrated = migrateSettings(structuredClone(v7));
      expect(migrated).toEqual({ ...v7, version: 8, engine: unpinned(v7.engine) });
      expect(SettingsSchema.safeParse(migrated).success).toBe(true);
    }
  });
  // W13 end

  it('never shares the defaults object with a migrated result', () => {
    const migrated = migrateSettings(fixture('v1.json'));
    migrated.notifications.kinds.errors = false;
    expect(SETTINGS_DEFAULTS_V8.notifications.kinds.errors).toBe(true);
  });
});

describe('settings v3 validates and refuses unknown versions', () => {
  it.each([
    ['a v9 object', { ...SETTINGS_DEFAULTS_V8, version: 9 }], // W2: v5 is the current version; W3: v6; W7: v7; W13: v8
    ['a v7 file without its pin', { ...SETTINGS_DEFAULTS_V8, version: 7 }], // W13: every v7 file wrote one
    ['a v8 file with a pin', { ...SETTINGS_DEFAULTS_V8, engine: { ...SETTINGS_DEFAULTS_V8.engine, ...PIN } }], // W13: v8 never has it
    ['a v6 file with a v7 field', { ...SETTINGS_DEFAULTS_V8, version: 6, engine: { ...SETTINGS_DEFAULTS_V8.engine, ...PIN } }], // W7: v6 never had the budget's switch
    ['a v3 file with a v4 field', { ...SETTINGS_DEFAULTS_V8, version: 3, engine: ENGINE_BEFORE_V7, appearance: { monoFont: null } }], // C12: v3 never had the budget's fields
    ['a v4 file with a v5 field', { ...SETTINGS_DEFAULTS_V8, version: 4, engine: ENGINE_BEFORE_V7 }], // W2: v4 never had the transcript's width
    ['a v0 object', { version: 0, theme: 'light' }],
    ['no version', { theme: 'light' }],
    ['not an object', 'settings'],
    ['an invalid v1 file', { version: 1, theme: 'sepia' }],
    ['a v2 file with a key v2 never had', { version: 2, theme: 'light', keymap: {}, notifications: { enabled: true, sound: false }, engine: {} }],
    ['a v3 file missing a section', { ...SETTINGS_DEFAULTS_V8, appearance: undefined }],
  ])('refuses %s', (_, raw) => {
    expect(() => migrateSettings(raw)).toThrow();
  });

  // C12 start: the budget's fields
  it('holds each v4 field to its range', () => {
    const bad = (engine: Record<string, unknown>) => SettingsSchema.safeParse({ ...SETTINGS_DEFAULTS_V8, engine: { ...SETTINGS_DEFAULTS_V8.engine, ...engine } }).success;
    expect(bad({ memoryBudgetMiB: 511 })).toBe(false);
    expect(bad({ memoryBudgetMiB: 512 })).toBe(true);
    expect(bad({ memoryBudgetMiB: 1024.5 })).toBe(false);
    expect(bad({ statefulMcpServers: [''] })).toBe(false);
    expect(bad({ statefulMcpServers: ['x'.repeat(201)] })).toBe(false);
    expect(bad({ statefulMcpServers: Array.from({ length: 65 }, (_, i) => `s${i}`) })).toBe(false);
    expect(bad({ statefulMcpServers: ['plugin:ptc:ptc'] })).toBe(true);
    expect(SettingsPatchSchema.safeParse({ engine: { memoryBudgetMiB: null } }).success).toBe(true);
  });
  // C12 end

  it('holds each v3 field to its range', () => {
    const bad = (patch: Record<string, unknown>) => SettingsSchema.safeParse({ ...SETTINGS_DEFAULTS_V8, ...patch }).success;
    expect(bad({ usage: { nearLimitPercent: 49 } })).toBe(false);
    expect(bad({ usage: { nearLimitPercent: 101 } })).toBe(false);
    expect(bad({ usage: { nearLimitPercent: 90.5 } })).toBe(false);
    expect(bad({ gateway: { ...SETTINGS_DEFAULTS_V8.gateway, relayUnreachable: 'retry' } })).toBe(false);
    expect(bad({ appearance: { monoFont: '' } })).toBe(false);
    expect(bad({ appearance: { monoFont: 'x'.repeat(201) } })).toBe(false);
    expect(bad({ appearance: { monoFont: null, transcriptWidth: 800 } })).toBe(false); // W2: Claude Desktop's three widths only
    expect(bad({ appearance: { monoFont: null } })).toBe(false); // W2: the width is required in v5
    expect(bad({ notifications: { enabled: true, sound: false } })).toBe(false); // kinds is required in v3
  });
});

describe('settings patch merges one kind and keeps its siblings', () => {
  const siblings = { approvals: false, questions: false, planReviews: false, errors: true, heldPeerMessages: true };
  const state: Settings = { ...SETTINGS_DEFAULTS_V8, notifications: { enabled: true, sound: false, kinds: siblings } };

  it('validates a patch of one kind and changes that kind alone', () => {
    const patch = SettingsPatchSchema.parse({ notifications: { kinds: { errors: false } } });
    expect(applySettingsPatch(state, patch).notifications).toEqual({ enabled: true, sound: false, kinds: { ...siblings, errors: false } });
  });

  it('leaves kinds untouched when another notification field is patched', () => {
    expect(applySettingsPatch(state, { notifications: { enabled: false } }).notifications).toEqual({ enabled: false, sound: false, kinds: siblings });
  });

  it('patches a section by field and leaves the other sections as they were', () => {
    const next = applySettingsPatch(state, { gateway: { relayUnreachable: 'wait' } });
    expect(next).toEqual({ ...state, gateway: { ...state.gateway, relayUnreachable: 'wait' } });
  });

  it('replaces the keymap whole, so an override is removed by leaving it out', () => {
    const bound = applySettingsPatch(state, { keymap: { 'attention.next': 'Cmd+Alt+J', 'tab.close': null } });
    expect(applySettingsPatch(bound, { keymap: {} }).keymap).toEqual({});
  });

  it('ignores keys present as undefined, at both levels', () => {
    expect(applySettingsPatch(state, { theme: undefined, engine: { binaryPath: undefined }, notifications: { kinds: { errors: undefined } } })).toEqual(state);
  });

  it('returns a new object and never mutates its inputs', () => {
    const before = structuredClone(state);
    const next = applySettingsPatch(state, { notifications: { kinds: { approvals: true } } });
    expect(state).toEqual(before);
    expect(next.notifications.kinds).not.toBe(state.notifications.kinds);
  });

  it('refuses in the patch schema what the merge cannot apply', () => {
    expect(SettingsPatchSchema.safeParse({ version: 3 }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ notifications: { kinds: { toasts: true } } }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ engine: { binaryPath: 'claude' } }).success).toBe(false); // absolute only, never resolved through PATH (§4.1)
    expect(SettingsPatchSchema.safeParse({ engine: { binaryPath: '/opt/claude/2.1.283' } }).success).toBe(true);
    expect(SettingsPatchSchema.safeParse({ usage: {} }).success).toBe(true);
    expect(SettingsPatchSchema.safeParse({ appearance: { monoFont: null } }).success).toBe(true);
    expect(SettingsPatchSchema.safeParse({ appearance: { transcriptWidth: 960 } }).success).toBe(true); // W2
    expect(SettingsPatchSchema.safeParse({ appearance: { transcriptWidth: 1000 } }).success).toBe(false);
  });
});
