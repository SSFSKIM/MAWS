// The client half of the settings (P5 O3-A; docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §3, contract O3X3): the
// fields the app draws or acts on (the theme, the keymap, the notifications, the appearance, voice, the browser, the
// usage banner's threshold, the supervisor's shape and the quit question's default, the comments view and the export
// author), in `<profile>/settings.json` from version 21, written by main alone. The file's rules; the service that
// composes it with the machine half is ./settings.ts.
import { readFileSync } from 'node:fs';
import { ClientSettingsSchema, type ClientSettings, type Settings, type SettingsPatch, type SettingsState, type SupervisorShape, type ThemeSetting } from '@shared/ipc/schema/settings';
import { applyClientPatch, clientSettingsDefaults, isUnifiedSettings, mergeSettings, migrateClientSettings, migrateSettings, splitSettings, splitSettingsPatch } from '@shared/settings/defaults';
import type { MachineSettingsService } from '../settings/machine';
import { openSettingsFile, type SettingsFileRules } from '../settings/store';

// A unified file (version 1 to 20) is read for its client fields and never written here: only the split (run under
// `spine.lock`, src/main/settings/split.ts) rewrites it, after it has saved the machine's fields, so a run that could not
// split (refused the spine) keeps the person's client settings on screen without losing their machine settings.
export const clientSettingsRules: SettingsFileRules<ClientSettings> = {
  read: (raw) =>
    isUnifiedSettings(raw)
      ? { value: splitSettings(migrateSettings(raw)).client, readOnly: 'it is a unified settings file the split has not converted (the split runs only under spine.lock)' }
      : { value: migrateClientSettings(raw) },
  defaults: clientSettingsDefaults,
  validate: (value) => ClientSettingsSchema.parse(value),
};

// The renderer's one `Settings` over the two halves: the client file, read and written here, and the machine half's
// service. A patch is cut by owner, field by field, so a machine field changes only `machine-settings.json` and a client
// field only `settings.json`; the machine half is written first, and a half that refuses its write throws (what the
// other half wrote stays written).
export interface ComposedSettings {
  readonly settings: Settings;
  update(patch: SettingsPatch): Settings; // persists before returning
}

export function composeSettings({ clientFile, machine }: { clientFile: string; machine: MachineSettingsService }): ComposedSettings {
  const store = openSettingsFile(clientFile, clientSettingsRules);
  return {
    get settings() {
      return mergeSettings(store.value, machine.state());
    },
    update(patch) {
      const routed = splitSettingsPatch(patch);
      if (routed.machine) machine.update(routed.machine);
      if (routed.client) store.update((current) => applyClientPatch(current, routed.client!));
      return mergeSettings(store.value, machine.state());
    },
  };
}

// P5 O2 M7's read of the launch's shape, before any daemon and before `spine.lock` (§2): the client file's own field,
// read without the lock and writing nothing (no migration persisted, no warning: the store that opens the file once the
// lock is settled says what is wrong with it). A file this build cannot read gives the default shape, as its store's
// defaults would.
export function readLaunchShape(file: string): SupervisorShape {
  try {
    return clientSettingsRules.read(JSON.parse(readFileSync(file, 'utf8'))).value.supervisor.shape;
  } catch {
    return clientSettingsDefaults().supervisor.shape;
  }
}

export type ResolvedTheme = SettingsState['resolvedTheme'];

export function resolveTheme(theme: ThemeSetting, osPrefersDark: boolean): ResolvedTheme {
  if (theme === 'system') return osPrefersDark ? 'dark' : 'light';
  return theme;
}
