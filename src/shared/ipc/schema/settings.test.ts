import { describe, expect, it } from 'vitest';
import { SettingsPatchSchema, SettingsSchema } from './settings';

const base = { version: 2, theme: 'light', keymap: {}, notifications: { enabled: true, sound: false } } as const;
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

  it('is version 2 and carries the notification policy', () => {
    expect(SettingsSchema.safeParse({ version: 1, theme: 'light' }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...base, notifications: { enabled: true } }).success).toBe(false);
  });

  it('patches keymap and notifications like the theme', () => {
    expect(SettingsPatchSchema.safeParse({ keymap: { 'tab.close': null } }).success).toBe(true);
    expect(SettingsPatchSchema.safeParse({ notifications: { enabled: false, sound: false } }).success).toBe(true);
    expect(SettingsPatchSchema.safeParse({ version: 2 }).success).toBe(false);
  });
});
