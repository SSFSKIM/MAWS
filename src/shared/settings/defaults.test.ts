import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SettingsPatchSchema, SettingsSchema, type Settings } from '../ipc/schema/settings';
import { applySettingsPatch, migrateSettings, SETTINGS_DEFAULTS_V3 } from './defaults';

const fixture = (name: string): unknown => JSON.parse(readFileSync(resolve(__dirname, '../../../test/fixtures/settings', name), 'utf8'));

describe('settings migrate v1 and v2 to v3', () => {
  it('holds the defaults the document states, and they validate', () => {
    expect(SETTINGS_DEFAULTS_V3).toEqual({
      version: 3,
      theme: 'light',
      keymap: {},
      notifications: { enabled: true, sound: false, kinds: { approvals: true, questions: true, planReviews: true, errors: true, heldPeerMessages: false } },
      engine: { binaryPath: null, pinnedVersion: '2.1.283', subagentModel: null },
      gateway: { defaultRoute: 'gateway', relayUnreachable: 'ask', offerDirect: true },
      usage: { nearLimitPercent: 90 },
      appearance: { monoFont: null },
    });
    expect(SettingsSchema.parse(SETTINGS_DEFAULTS_V3)).toEqual(SETTINGS_DEFAULTS_V3);
  });

  it('migrates the v1 fixture to the defaults with its theme', () => {
    expect(migrateSettings(fixture('v1.json'))).toEqual({ ...SETTINGS_DEFAULTS_V3, theme: 'dark' });
  });

  it('migrates the v2 fixture keeping its theme, its keymap override and its notification policy', () => {
    const migrated = migrateSettings(fixture('v2.json'));
    expect(SettingsSchema.safeParse(migrated).success).toBe(true);
    expect(migrated).toEqual({
      ...SETTINGS_DEFAULTS_V3,
      theme: 'system',
      keymap: { 'attention.next': 'Cmd+Alt+J' },
      notifications: { enabled: false, sound: true, kinds: SETTINGS_DEFAULTS_V3.notifications.kinds },
    });
  });

  it('is the identity over a v3 object', () => {
    const v3: Settings = { ...SETTINGS_DEFAULTS_V3, theme: 'dark', gateway: { defaultRoute: 'direct', relayUnreachable: 'wait', offerDirect: false }, appearance: { monoFont: 'JetBrainsMono Nerd Font' } };
    expect(migrateSettings(structuredClone(v3))).toEqual(v3);
  });

  it('never shares the defaults object with a migrated result', () => {
    const migrated = migrateSettings(fixture('v1.json'));
    migrated.notifications.kinds.errors = false;
    expect(SETTINGS_DEFAULTS_V3.notifications.kinds.errors).toBe(true);
  });
});

describe('settings v3 validates and refuses unknown versions', () => {
  it.each([
    ['a v4 object', { ...SETTINGS_DEFAULTS_V3, version: 4 }],
    ['a v0 object', { version: 0, theme: 'light' }],
    ['no version', { theme: 'light' }],
    ['not an object', 'settings'],
    ['an invalid v1 file', { version: 1, theme: 'sepia' }],
    ['a v2 file with a key v2 never had', { version: 2, theme: 'light', keymap: {}, notifications: { enabled: true, sound: false }, engine: {} }],
    ['a v3 file missing a section', { ...SETTINGS_DEFAULTS_V3, appearance: undefined }],
  ])('refuses %s', (_, raw) => {
    expect(() => migrateSettings(raw)).toThrow();
  });

  it('holds each v3 field to its range', () => {
    const bad = (patch: Record<string, unknown>) => SettingsSchema.safeParse({ ...SETTINGS_DEFAULTS_V3, ...patch }).success;
    expect(bad({ usage: { nearLimitPercent: 49 } })).toBe(false);
    expect(bad({ usage: { nearLimitPercent: 101 } })).toBe(false);
    expect(bad({ usage: { nearLimitPercent: 90.5 } })).toBe(false);
    expect(bad({ gateway: { ...SETTINGS_DEFAULTS_V3.gateway, relayUnreachable: 'retry' } })).toBe(false);
    expect(bad({ appearance: { monoFont: '' } })).toBe(false);
    expect(bad({ appearance: { monoFont: 'x'.repeat(201) } })).toBe(false);
    expect(bad({ notifications: { enabled: true, sound: false } })).toBe(false); // kinds is required in v3
  });
});

describe('settings patch merges one kind and keeps its siblings', () => {
  const siblings = { approvals: false, questions: false, planReviews: false, errors: true, heldPeerMessages: true };
  const state: Settings = { ...SETTINGS_DEFAULTS_V3, notifications: { enabled: true, sound: false, kinds: siblings } };

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
  });
});
