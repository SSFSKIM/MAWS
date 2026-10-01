import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SettingsPatchSchema, SettingsSchema, type Settings } from '../ipc/schema/settings';
import { applySettingsPatch, migrateSettings, SETTINGS_DEFAULTS_V5 } from './defaults';

const fixture = (name: string): unknown => JSON.parse(readFileSync(resolve(__dirname, '../../../test/fixtures/settings', name), 'utf8'));

describe('settings migrate v1 and v2 to v3', () => {
  it('holds the defaults the document states, and they validate', () => {
    expect(SETTINGS_DEFAULTS_V5).toEqual({
      version: 5, // C12: 4; W2: 5
      theme: 'light',
      keymap: {},
      notifications: { enabled: true, sound: false, kinds: { approvals: true, questions: true, planReviews: true, errors: true, heldPeerMessages: false } },
      engine: { binaryPath: null, pinnedVersion: '2.1.283', subagentModel: null, memoryBudgetMiB: null, statefulMcpServers: [] /* C12 */ },
      gateway: { defaultRoute: 'gateway', relayUnreachable: 'ask', offerDirect: true },
      usage: { nearLimitPercent: 90 },
      appearance: { monoFont: null, transcriptWidth: 768 /* W2 */ },
    });
    expect(SettingsSchema.parse(SETTINGS_DEFAULTS_V5)).toEqual(SETTINGS_DEFAULTS_V5);
  });

  it('migrates the v1 fixture to the defaults with its theme', () => {
    expect(migrateSettings(fixture('v1.json'))).toEqual({ ...SETTINGS_DEFAULTS_V5, theme: 'dark' });
  });

  it('migrates the v2 fixture keeping its theme, its keymap override and its notification policy', () => {
    const migrated = migrateSettings(fixture('v2.json'));
    expect(SettingsSchema.safeParse(migrated).success).toBe(true);
    expect(migrated).toEqual({
      ...SETTINGS_DEFAULTS_V5,
      theme: 'system',
      keymap: { 'attention.next': 'Cmd+Alt+J' },
      notifications: { enabled: false, sound: true, kinds: SETTINGS_DEFAULTS_V5.notifications.kinds },
    });
  });

  // C12 start: version 4 (the memory budget); a v3 object gains the budget's defaults. W2: the identity moves to v5, and
  // a v3 or v4 object gains the transcript's default width.
  it('is the identity over a v5 object', () => {
    const v5: Settings = { ...SETTINGS_DEFAULTS_V5, theme: 'dark', gateway: { defaultRoute: 'direct', relayUnreachable: 'wait', offerDirect: false }, appearance: { monoFont: 'JetBrainsMono Nerd Font', transcriptWidth: 1280 }, engine: { ...SETTINGS_DEFAULTS_V5.engine, memoryBudgetMiB: 6144, statefulMcpServers: ['plugin:ptc:ptc'] } };
    expect(migrateSettings(structuredClone(v5))).toEqual(v5);
  });

  it('migrates a v3 object to v5 keeping every v3 value, with the budget’s defaults and the default width', () => {
    const { memoryBudgetMiB: _m, statefulMcpServers: _s, ...engineV3 } = { ...SETTINGS_DEFAULTS_V5.engine, binaryPath: '/opt/claude', subagentModel: 'haiku' };
    void _m;
    void _s;
    const v3 = { ...SETTINGS_DEFAULTS_V5, version: 3, theme: 'dark', keymap: { 'attention.next': 'Cmd+Alt+J' }, usage: { nearLimitPercent: 80 }, engine: engineV3, appearance: { monoFont: 'Hack' } };
    const migrated = migrateSettings(structuredClone(v3));
    expect(migrated).toEqual({ ...v3, version: 5, engine: { ...engineV3, memoryBudgetMiB: null, statefulMcpServers: [] }, appearance: { monoFont: 'Hack', transcriptWidth: 768 } });
    expect(SettingsSchema.safeParse(migrated).success).toBe(true);
  });
  // C12 end

  // W2 start
  it('migrates a v4 object to v5 keeping every v4 value, with the default width', () => {
    const v4 = { ...SETTINGS_DEFAULTS_V5, version: 4, theme: 'dark', engine: { ...SETTINGS_DEFAULTS_V5.engine, memoryBudgetMiB: 6144 }, appearance: { monoFont: 'Hack' } };
    const migrated = migrateSettings(structuredClone(v4));
    expect(migrated).toEqual({ ...v4, version: 5, appearance: { monoFont: 'Hack', transcriptWidth: 768 } });
    expect(SettingsSchema.safeParse(migrated).success).toBe(true);
  });
  // W2 end

  it('never shares the defaults object with a migrated result', () => {
    const migrated = migrateSettings(fixture('v1.json'));
    migrated.notifications.kinds.errors = false;
    expect(SETTINGS_DEFAULTS_V5.notifications.kinds.errors).toBe(true);
  });
});

describe('settings v3 validates and refuses unknown versions', () => {
  it.each([
    ['a v6 object', { ...SETTINGS_DEFAULTS_V5, version: 6 }], // W2: v5 is the current version
    ['a v3 file with a v4 field', { ...SETTINGS_DEFAULTS_V5, version: 3, appearance: { monoFont: null } }], // C12: v3 never had the budget's fields
    ['a v4 file with a v5 field', { ...SETTINGS_DEFAULTS_V5, version: 4 }], // W2: v4 never had the transcript's width
    ['a v0 object', { version: 0, theme: 'light' }],
    ['no version', { theme: 'light' }],
    ['not an object', 'settings'],
    ['an invalid v1 file', { version: 1, theme: 'sepia' }],
    ['a v2 file with a key v2 never had', { version: 2, theme: 'light', keymap: {}, notifications: { enabled: true, sound: false }, engine: {} }],
    ['a v3 file missing a section', { ...SETTINGS_DEFAULTS_V5, appearance: undefined }],
  ])('refuses %s', (_, raw) => {
    expect(() => migrateSettings(raw)).toThrow();
  });

  // C12 start: the budget's fields
  it('holds each v4 field to its range', () => {
    const bad = (engine: Record<string, unknown>) => SettingsSchema.safeParse({ ...SETTINGS_DEFAULTS_V5, engine: { ...SETTINGS_DEFAULTS_V5.engine, ...engine } }).success;
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
    const bad = (patch: Record<string, unknown>) => SettingsSchema.safeParse({ ...SETTINGS_DEFAULTS_V5, ...patch }).success;
    expect(bad({ usage: { nearLimitPercent: 49 } })).toBe(false);
    expect(bad({ usage: { nearLimitPercent: 101 } })).toBe(false);
    expect(bad({ usage: { nearLimitPercent: 90.5 } })).toBe(false);
    expect(bad({ gateway: { ...SETTINGS_DEFAULTS_V5.gateway, relayUnreachable: 'retry' } })).toBe(false);
    expect(bad({ appearance: { monoFont: '' } })).toBe(false);
    expect(bad({ appearance: { monoFont: 'x'.repeat(201) } })).toBe(false);
    expect(bad({ appearance: { monoFont: null, transcriptWidth: 800 } })).toBe(false); // W2: Claude Desktop's three widths only
    expect(bad({ appearance: { monoFont: null } })).toBe(false); // W2: the width is required in v5
    expect(bad({ notifications: { enabled: true, sound: false } })).toBe(false); // kinds is required in v3
  });
});

describe('settings patch merges one kind and keeps its siblings', () => {
  const siblings = { approvals: false, questions: false, planReviews: false, errors: true, heldPeerMessages: true };
  const state: Settings = { ...SETTINGS_DEFAULTS_V5, notifications: { enabled: true, sound: false, kinds: siblings } };

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
