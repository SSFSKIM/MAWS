import { describe, expect, it } from 'vitest';
import { SETTINGS_DEFAULTS_V7 } from '../../settings/defaults';
import { commands, SettingsPatchSchema, SettingsSchema } from './settings'; // C12: commands

const base = SETTINGS_DEFAULTS_V7;
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

  it('is version 3 and carries the notification policy', () => {
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

// C12 start: MAWS's custody of the pinned engine (C12 execution document, Interfaces "X2 additions")
describe('settings.engineCustody and settings.engineApplied', () => {
  const manifest = { version: '2.1.283', sha256: 'd8cb1e5c', size: 225036032, source: '/s/2.1.283', copiedAt: '2026-09-29T12:00:00.000Z' };
  it('custody is the copy with its manifest, a refusal with its message, or null when custody does not run', () => {
    expect(commands['settings.engineCustody'].output.safeParse({ state: 'ok', path: '/u/engine/2.1.283/claude', manifest }).success).toBe(true);
    for (const state of ['missing', 'mismatch', 'version']) expect(commands['settings.engineCustody'].output.safeParse({ state, path: '/p', message: 'm' }).success).toBe(true);
    expect(commands['settings.engineCustody'].output.safeParse(null).success).toBe(true);
    expect(commands['settings.engineCustody'].output.safeParse({ state: 'ok', path: '/p', message: 'm' }).success).toBe(false);
    expect(commands['settings.engineCustody'].output.safeParse({ state: 'gone', path: '/p', message: 'm' }).success).toBe(false);
  });
  it('both are main’s, and engineApplied answers nothing but its completion', () => {
    expect(commands['settings.engineCustody'].owner).toBe('main');
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
    expect(result.safeParse({ ok: true, drainTarget: 'u' }).success).toBe(true);
    expect(result.safeParse({ ok: false, reason: 'not_ready', message: 'm' }).success).toBe(true);
    expect(result.safeParse({ ok: false }).success).toBe(false);
  });
});
