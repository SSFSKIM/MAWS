import { describe, expect, it } from 'vitest';
import { SETTINGS_DEFAULTS_V19 } from '../../settings/defaults';
import { commands, SettingsPatchSchema, SettingsSchema } from './settings'; // C12: commands
import { LaunchProfileSchema, userScopeProfile } from '../../engine/launch-profile'; // P4-A2

const base = SETTINGS_DEFAULTS_V19;
const issueCodes = (value: unknown) => {
  const parsed = SettingsSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.code);
};

describe('export author setting', () => {
  it('accepts an additive explicit name or clearing it, and rejects blank and oversized identities', () => {
    expect(SettingsPatchSchema.parse({ artifacts: { exportAuthorName: '  Kim Min  ' } })).toEqual({ artifacts: { exportAuthorName: 'Kim Min' } });
    expect(SettingsPatchSchema.safeParse({ artifacts: { exportAuthorName: null } }).success).toBe(true);
    expect(SettingsSchema.safeParse(base).success).toBe(true); // current files validate without the optional author name
    for (const name of ['', '  ', 'x'.repeat(201)]) expect(SettingsPatchSchema.safeParse({ artifacts: { exportAuthorName: name } }).success).toBe(false);
  });
});

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

  it('is version 19 and carries the notification policy (P4-R8: the app MCP servers; P4-A2: the launch profile)', () => {
    expect(base.version).toBe(19);
    expect(SettingsSchema.safeParse({ ...base, version: 18 }).success).toBe(false); // the launch profile's style removed
    expect(SettingsSchema.safeParse({ ...base, version: 17 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...base, sessions: undefined }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...base, notifications: { ...base.notifications, kinds: { ...base.notifications.kinds, turnFinished: undefined } } }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...base, version: 16 }).success).toBe(false); // P4-A2
    expect(SettingsSchema.safeParse({ ...base, engine: { ...base.engine, launchProfile: undefined } }).success).toBe(false); // P4-A2: required, even at the user scope
    expect(SettingsSchema.safeParse({ ...base, version: 15 }).success).toBe(false); // P4-R8
    expect(SettingsSchema.safeParse({ ...base, engine: { ...base.engine, mcpServers: undefined } }).success).toBe(false); // P4-R8: required, even when empty
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

// P4-A2 start (2026-10-21): the launch profile, held to the engine's plugin keys and its two switches' values
describe('settings engine.launchProfile', () => {
  const profile = (plugins: unknown, rest: object = {}) => ({ ...userScopeProfile(), plugins: { off: plugins }, ...rest });

  it('takes the user scope and plugin ids as the engine keys them, name@marketplace', () => {
    expect(LaunchProfileSchema.safeParse(userScopeProfile()).success).toBe(true);
    expect(LaunchProfileSchema.safeParse(profile(['cc-plugin-diff@builtin', 'ptc@ptc-tool'], { hooks: 'none' })).success).toBe(true);
    expect(SettingsSchema.safeParse({ ...base, engine: { ...base.engine, launchProfile: profile(['cc-plugin-diff@builtin']) } }).success).toBe(true);
    expect(SettingsPatchSchema.safeParse({ engine: { launchProfile: profile(['cc-plugin-diff@builtin']) } }).success).toBe(true);
  });

  it('refuses a plugin id that is not name@marketplace, in the file and in a patch', () => {
    for (const id of ['__proto__', 'constructor', 'a b@c', 'x', '@builtin', 'ptc@', 'a@b@c', ' ptc@ptc-tool', `${'x'.repeat(256)}@m`, '']) {
      expect(LaunchProfileSchema.safeParse(profile([id])).success, JSON.stringify(id)).toBe(false);
      expect(SettingsSchema.safeParse({ ...base, engine: { ...base.engine, launchProfile: profile([id]) } }).success, JSON.stringify(id)).toBe(false);
      expect(SettingsPatchSchema.safeParse({ engine: { launchProfile: profile([id]) } }).success, JSON.stringify(id)).toBe(false);
    }
  });

  it('refuses an unknown key at either level, a value outside the two switches, and a partial profile', () => {
    expect(LaunchProfileSchema.safeParse({ ...userScopeProfile(), effort: 'high' }).success).toBe(false); // P4 Decision Log 8: no effort
    expect(LaunchProfileSchema.safeParse({ ...userScopeProfile(), plugins: { off: [], on: ['ptc@ptc-tool'] } }).success).toBe(false);
    for (const outputStyle of ['user', 'maws', 'default']) expect(LaunchProfileSchema.safeParse({ ...userScopeProfile(), outputStyle }).success, outputStyle).toBe(false); // version 19: no style
    expect(LaunchProfileSchema.safeParse({ ...userScopeProfile(), hooks: 'project' }).success).toBe(false);
    expect(LaunchProfileSchema.safeParse({ plugins: { off: [] } }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ engine: { launchProfile: { hooks: 'none' } } }).success).toBe(false); // replaced whole, never by field
  });

  it('holds the plugin list to 256 ids', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}@m`);
    expect(LaunchProfileSchema.safeParse(profile(ids(256))).success).toBe(true);
    expect(LaunchProfileSchema.safeParse(profile(ids(257))).success).toBe(false);
  });
});
// P4-A2 end

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
