import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SettingsPatchSchema, SettingsSchema, type Settings } from '../ipc/schema/settings';
import { applySettingsPatch, migrateSettings, SETTINGS_DEFAULTS_V7 } from './defaults';

const fixture = (name: string): unknown => JSON.parse(readFileSync(resolve(__dirname, '../../../test/fixtures/settings', name), 'utf8'));
// W7: the engine section every version from 4 to 6 wrote (version 7 adds the budget's switch)
const { memoryBudget: _switch, ...ENGINE_BEFORE_V7 } = SETTINGS_DEFAULTS_V7.engine;
void _switch;
// W3: the sections every version before 6 wrote (version 6 adds the permissions)
const { permissions: _permissions, ...SECTIONS_BEFORE_V6 } = SETTINGS_DEFAULTS_V7;
void _permissions;
const BEFORE_V6 = { ...SECTIONS_BEFORE_V6, engine: ENGINE_BEFORE_V7 };
const ON = { memoryBudget: { enabled: true } }; // W7: what a migrated engine section gains

describe('settings migrate v1 and v2 to v3', () => {
  it('holds the defaults the document states, and they validate', () => {
    expect(SETTINGS_DEFAULTS_V7).toEqual({
      version: 7, // C12: 4; W2: 5; W3: 6; W7: 7
      theme: 'light',
      keymap: {},
      notifications: { enabled: true, sound: false, kinds: { approvals: true, questions: true, planReviews: true, errors: true, heldPeerMessages: false } },
      engine: { binaryPath: null, pinnedVersion: '2.1.283', subagentModel: null, memoryBudgetMiB: null, statefulMcpServers: [] /* C12 */, memoryBudget: { enabled: true } /* W7 */ },
      gateway: { defaultRoute: 'gateway', relayUnreachable: 'ask', offerDirect: true },
      usage: { nearLimitPercent: 90 },
      appearance: { monoFont: null, transcriptWidth: 768 /* W2 */ },
      permissions: { autoFallback: 'acceptEdits' }, // W3
    });
    expect(SettingsSchema.parse(SETTINGS_DEFAULTS_V7)).toEqual(SETTINGS_DEFAULTS_V7);
  });

  it('migrates the v1 fixture to the defaults with its theme', () => {
    expect(migrateSettings(fixture('v1.json'))).toEqual({ ...SETTINGS_DEFAULTS_V7, theme: 'dark' });
  });

  it('migrates the v2 fixture keeping its theme, its keymap override and its notification policy', () => {
    const migrated = migrateSettings(fixture('v2.json'));
    expect(SettingsSchema.safeParse(migrated).success).toBe(true);
    expect(migrated).toEqual({
      ...SETTINGS_DEFAULTS_V7,
      theme: 'system',
      keymap: { 'attention.next': 'Cmd+Alt+J' },
      notifications: { enabled: false, sound: true, kinds: SETTINGS_DEFAULTS_V7.notifications.kinds },
    });
  });

  // C12 start: version 4 (the memory budget); a v3 object gains the budget's defaults. W2: the identity moves to v5, and
  // a v3 or v4 object gains the transcript's default width. W3: the identity moves to v6. W7: to v7, and every earlier
  // object gains the budget's switch, on.
  it('is the identity over a v7 object', () => {
    const v7: Settings = {
      ...SETTINGS_DEFAULTS_V7,
      theme: 'dark',
      gateway: { defaultRoute: 'direct', relayUnreachable: 'wait', offerDirect: false },
      appearance: { monoFont: 'JetBrainsMono Nerd Font', transcriptWidth: 1280 },
      engine: { ...SETTINGS_DEFAULTS_V7.engine, memoryBudgetMiB: 6144, statefulMcpServers: ['plugin:ptc:ptc'], memoryBudget: { enabled: false } },
      permissions: { autoFallback: 'default' },
    };
    expect(migrateSettings(structuredClone(v7))).toEqual(v7);
  });

  it('migrates a v3 object to v7 keeping every v3 value, with the budget’s defaults, the default width, the default fallback and the budget on', () => {
    const { memoryBudgetMiB: _m, statefulMcpServers: _s, ...engineV3 } = { ...ENGINE_BEFORE_V7, binaryPath: '/opt/claude', subagentModel: 'haiku' };
    void _m;
    void _s;
    const v3 = { ...BEFORE_V6, version: 3, theme: 'dark', keymap: { 'attention.next': 'Cmd+Alt+J' }, usage: { nearLimitPercent: 80 }, engine: engineV3, appearance: { monoFont: 'Hack' } };
    const migrated = migrateSettings(structuredClone(v3));
    expect(migrated).toEqual({ ...v3, version: 7, engine: { ...engineV3, memoryBudgetMiB: null, statefulMcpServers: [], ...ON }, appearance: { monoFont: 'Hack', transcriptWidth: 768 }, permissions: { autoFallback: 'acceptEdits' } });
    expect(SettingsSchema.safeParse(migrated).success).toBe(true);
  });
  // C12 end

  // W2 start
  it('migrates a v4 object to v7 keeping every v4 value, with the default width, the default fallback and the budget on', () => {
    const v4 = { ...BEFORE_V6, version: 4, theme: 'dark', engine: { ...ENGINE_BEFORE_V7, memoryBudgetMiB: 6144 }, appearance: { monoFont: 'Hack' } };
    const migrated = migrateSettings(structuredClone(v4));
    expect(migrated).toEqual({ ...v4, version: 7, engine: { ...v4.engine, ...ON }, appearance: { monoFont: 'Hack', transcriptWidth: 768 }, permissions: { autoFallback: 'acceptEdits' } });
    expect(SettingsSchema.safeParse(migrated).success).toBe(true);
  });
  // W2 end

  // W3 start
  it('migrates a v5 object to v7 keeping every v5 value, with acceptEdits as the auto fallback and the budget on', () => {
    const v5 = { ...BEFORE_V6, version: 5, theme: 'dark', appearance: { monoFont: 'Hack', transcriptWidth: 960 } };
    const migrated = migrateSettings(structuredClone(v5));
    expect(migrated).toEqual({ ...v5, version: 7, engine: { ...v5.engine, ...ON }, permissions: { autoFallback: 'acceptEdits' } });
    expect(SettingsSchema.safeParse(migrated).success).toBe(true);
  });

  it('takes any engine mode but auto as the fallback', () => {
    expect(SettingsPatchSchema.safeParse({ permissions: { autoFallback: 'plan' } }).success).toBe(true);
    expect(SettingsPatchSchema.safeParse({ permissions: { autoFallback: 'auto' } }).success).toBe(false);
    expect(applySettingsPatch(SETTINGS_DEFAULTS_V7, { permissions: { autoFallback: 'default' } }).permissions).toEqual({ autoFallback: 'default' });
  });
  // W3 end

  // W7 start
  it('migrates a v6 object to v7 keeping every v6 value, its own budget and stateful servers included, with the budget on', () => {
    const v6 = { ...SECTIONS_BEFORE_V6, version: 6, theme: 'dark', engine: { ...ENGINE_BEFORE_V7, memoryBudgetMiB: 6144, statefulMcpServers: ['plugin:ptc:ptc'] }, permissions: { autoFallback: 'plan' } };
    const migrated = migrateSettings(structuredClone(v6));
    expect(migrated).toEqual({ ...v6, version: 7, engine: { ...v6.engine, ...ON } });
    expect(SettingsSchema.safeParse(migrated).success).toBe(true);
  });

  it('takes the switch as one object a patch replaces whole, and nothing but a boolean in it', () => {
    const off = applySettingsPatch(SETTINGS_DEFAULTS_V7, SettingsPatchSchema.parse({ engine: { memoryBudget: { enabled: false } } }));
    expect(off.engine).toEqual({ ...SETTINGS_DEFAULTS_V7.engine, memoryBudget: { enabled: false } });
    expect(SettingsPatchSchema.safeParse({ engine: { memoryBudget: {} } }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ engine: { memoryBudget: { enabled: 'off' } } }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ engine: { memoryBudget: { enabled: true, limitMiB: 1 } } }).success).toBe(false);
  });
  // W7 end

  it('never shares the defaults object with a migrated result', () => {
    const migrated = migrateSettings(fixture('v1.json'));
    migrated.notifications.kinds.errors = false;
    expect(SETTINGS_DEFAULTS_V7.notifications.kinds.errors).toBe(true);
  });
});

describe('settings v3 validates and refuses unknown versions', () => {
  it.each([
    ['a v8 object', { ...SETTINGS_DEFAULTS_V7, version: 8 }], // W2: v5 is the current version; W3: v6; W7: v7
    ['a v6 file with a v7 field', { ...SETTINGS_DEFAULTS_V7, version: 6 }], // W7: v6 never had the budget's switch
    ['a v3 file with a v4 field', { ...SETTINGS_DEFAULTS_V7, version: 3, appearance: { monoFont: null } }], // C12: v3 never had the budget's fields
    ['a v4 file with a v5 field', { ...SETTINGS_DEFAULTS_V7, version: 4 }], // W2: v4 never had the transcript's width
    ['a v0 object', { version: 0, theme: 'light' }],
    ['no version', { theme: 'light' }],
    ['not an object', 'settings'],
    ['an invalid v1 file', { version: 1, theme: 'sepia' }],
    ['a v2 file with a key v2 never had', { version: 2, theme: 'light', keymap: {}, notifications: { enabled: true, sound: false }, engine: {} }],
    ['a v3 file missing a section', { ...SETTINGS_DEFAULTS_V7, appearance: undefined }],
  ])('refuses %s', (_, raw) => {
    expect(() => migrateSettings(raw)).toThrow();
  });

  // C12 start: the budget's fields
  it('holds each v4 field to its range', () => {
    const bad = (engine: Record<string, unknown>) => SettingsSchema.safeParse({ ...SETTINGS_DEFAULTS_V7, engine: { ...SETTINGS_DEFAULTS_V7.engine, ...engine } }).success;
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
    const bad = (patch: Record<string, unknown>) => SettingsSchema.safeParse({ ...SETTINGS_DEFAULTS_V7, ...patch }).success;
    expect(bad({ usage: { nearLimitPercent: 49 } })).toBe(false);
    expect(bad({ usage: { nearLimitPercent: 101 } })).toBe(false);
    expect(bad({ usage: { nearLimitPercent: 90.5 } })).toBe(false);
    expect(bad({ gateway: { ...SETTINGS_DEFAULTS_V7.gateway, relayUnreachable: 'retry' } })).toBe(false);
    expect(bad({ appearance: { monoFont: '' } })).toBe(false);
    expect(bad({ appearance: { monoFont: 'x'.repeat(201) } })).toBe(false);
    expect(bad({ appearance: { monoFont: null, transcriptWidth: 800 } })).toBe(false); // W2: Claude Desktop's three widths only
    expect(bad({ appearance: { monoFont: null } })).toBe(false); // W2: the width is required in v5
    expect(bad({ notifications: { enabled: true, sound: false } })).toBe(false); // kinds is required in v3
  });
});

describe('settings patch merges one kind and keeps its siblings', () => {
  const siblings = { approvals: false, questions: false, planReviews: false, errors: true, heldPeerMessages: true };
  const state: Settings = { ...SETTINGS_DEFAULTS_V7, notifications: { enabled: true, sound: false, kinds: siblings } };

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
    expect(applySettingsPatch(state, { theme: undefined, engine: { pinnedVersion: undefined }, notifications: { kinds: { errors: undefined } } })).toEqual(state);
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
