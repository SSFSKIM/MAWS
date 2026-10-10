import { describe, expect, it } from 'vitest';
import { SETTINGS_DEFAULTS_V13 } from '../../settings/defaults';
import { commands, SettingsPatchSchema, SettingsSchema } from './settings'; // C12: commands

const base = SETTINGS_DEFAULTS_V13;
const issueCodes = (value: unknown) => {
  const parsed = SettingsSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.code);
};

describe('settings keymap is a partial record', () => {
  it('accepts no overrides, one override and an unbinding', () => {
    expect(SettingsSchema.safeParse(base).success).toBe(true);
    expect(SettingsSchema.safeParse({ ...base, keymap: { 'attention.next': 'Cmd+Alt+J' } }).success).toBe(true);
    expect(SettingsSchema.safeParse({ ...base, keymap: { 'tab.close': null } }).success).toBe(true);
  });

  it('rejects an unknown action id', () => {
    expect(issueCodes({ ...base, keymap: { zzz: 'Cmd+J' } })).toContain('unrecognized_keys');
  });

  it('rejects a malformed chord', () => {
    expect(issueCodes({ ...base, keymap: { 'tab.close': 'Cmd J!' } })).toEqual(['invalid_format']);
  });

  it('is version 11 (W13: no engine pin; E9: the voice section; E10: the supervisor section; E4a: the browser section) and carries the notification policy', () => {
    expect(SettingsSchema.safeParse({ ...base, version: 10 }).success).toBe(false); // E4a
    expect(SettingsSchema.safeParse({ ...base, browser: undefined }).success).toBe(false); // E4a
    expect(SettingsSchema.safeParse({ ...base, version: 9 }).success).toBe(false); // E10
    expect(SettingsSchema.safeParse({ ...base, supervisor: undefined }).success).toBe(false); // E10
    expect(SettingsSchema.safeParse({ ...base, version: 8 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...base, voice: undefined }).success).toBe(false); // E9
    expect(SettingsSchema.safeParse({ ...base, version: 7 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...base, engine: { ...base.engine, pinnedVersion: '2.1.283' } }).success).toBe(false);
    expect(SettingsSchema.safeParse({ version: 1, theme: 'light' }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...base, version: 2 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...base, notifications: { enabled: true, sound: false } }).success).toBe(false);
  });

  it('patches keymap and notifications like the theme', () => {
    expect(SettingsPatchSchema.safeParse({ keymap: { 'tab.close': null } }).success).toBe(true);
    expect(SettingsPatchSchema.safeParse({ notifications: { enabled: false, sound: false } }).success).toBe(true);
    expect(SettingsPatchSchema.safeParse({ version: 3 }).success).toBe(false);
  });
});

// C12 start (C12 execution document, Interfaces "X2 additions"); W13: settings.engineCustody retired with custody
describe('settings.engineApplied', () => {
  it('is main’s, answers nothing but its completion, and custody’s read is gone', () => {
    expect(commands).not.toHaveProperty('settings.engineCustody');
    expect(commands['settings.engineApplied'].owner).toBe('main');
    expect(commands['settings.engineApplied'].output.safeParse(undefined).success).toBe(true);
  });
});
// C12 end

// W6 route executor: ClaudeUsage's control API through main
describe('settings.usageControls and settings.usageAction', () => {
  it('are main’s', () => {
    expect(commands['settings.usageControls'].owner).toBe('main');
    expect(commands['settings.usageAction'].owner).toBe('main');
  });
  it('take each action with the fields it needs and nothing else', () => {
    const input = commands['settings.usageAction'].input;
    for (const ok of [{ action: 'route', uuid: 'u' }, { action: 'add', email: null }, { action: 'add', email: 'a@b' }, { action: 'add' }, { action: 'reconnect', uuid: 'u' }, { action: 'remove', uuid: 'u', confirm: true }, { action: 'remove', uuid: 'u' }, { action: 'panel' }]) {
      expect(input.safeParse(ok).success, JSON.stringify(ok)).toBe(true);
    }
    for (const bad of [{ action: 'route' }, { action: 'route', uuid: '' }, { action: 'switch', uuid: 'u' }, { action: 'panel', uuid: 'u' }, { action: 'add', email: '' }]) {
      expect(input.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
  it('answer availability with a reason, and an action’s result or refusal', () => {
    const output = commands['settings.usageControls'].output;
    expect(output.safeParse({ available: false, reason: 'no_route', state: null }).success).toBe(true);
    expect(output.safeParse({ available: false, reason: 'gone', state: null }).success).toBe(false);
    const result = commands['settings.usageAction'].output;
    expect(result.safeParse({ ok: true, drainTarget: 'u', drainTargetIsManual: true, shown: null }).success).toBe(true);
    expect(result.safeParse({ ok: true, drainTarget: 'u' }).success).toBe(false);
    expect(result.safeParse({ ok: false, reason: 'not_ready', message: 'm' }).success).toBe(true);
    expect(result.safeParse({ ok: false }).success).toBe(false);
  });
});
