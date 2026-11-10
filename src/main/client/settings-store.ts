// The client half of the settings (P5 O3-A; docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §3, contract O3X3): the
// fields the app draws or acts on (the theme, the keymap, the notifications, the appearance, voice, the browser, the
// usage banner's threshold, the comments view and the export author, and the supervisor's two retired fields), in
// `<profile>/settings.json` from version 21, written by main alone. The file's rules; the service that composes it with
// the machine half is ./settings.ts.
import { readFileSync } from 'node:fs';
import { ClientSettingsSchema, type ClientSettings, type Settings, type SettingsPatch, type SettingsState, type ThemeSetting } from '@shared/ipc/schema/settings';
import { applyClientPatch, clientSettingsDefaults, isUnifiedSettings, mergeSettings, migrateClientSettings, migrateSettings, splitSettings, splitSettingsPatch } from '@shared/settings/defaults';
import type { MachineSettingsService } from '@shared/spine/machine-settings';
import { openSettingsFile, type SettingsFileRules } from '@shared/settings/file-store';

// A unified file (version 1 to 20) is read for its client fields and never written here: only the split (run under
// `spine.lock`, src/services/settings/split.ts) rewrites it, after it has saved the machine's fields, so a run that could not
// split (refused the spine) keeps the person's client settings on screen without losing their machine settings.
export const clientSettingsRules: SettingsFileRules<ClientSettings> = {
  read: (raw) =>
    isUnifiedSettings(raw)
      ? { value: retireShape(splitSettings(migrateSettings(raw)).client), readOnly: 'it is a unified settings file the split has not converted (the split runs only under spine.lock)' }
      : { value: retireShape(migrateClientSettings(raw)) },
  defaults: clientSettingsDefaults,
  validate: (value) => ClientSettingsSchema.parse(value),
};

// P5 O15 M2 (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, "Settings"): `supervisor.shape` selects nothing
// any more, every launch runs on `mawsd`. The field stays in the schema at its type, so every saved file parses, and is
// read and stored as `daemon` whatever the file or a caller says: here, at the store's read and at its set, and nowhere
// else. `keepRunningDefault`, retired too, is kept as stored and read by nothing.
function retireShape(settings: ClientSettings): ClientSettings {
  return settings.supervisor.shape === 'daemon' ? settings : { ...settings, supervisor: { ...settings.supervisor, shape: 'daemon' } };
}

// The renderer's one `Settings` over the two halves: the client file, read and written here, and the machine half's
// service. A patch is cut by owner, field by field, so a machine field changes only `machine-settings.json` and a client
// field only `settings.json`; the machine half is written first and awaited (P5 O3-D M5b: on the daemon shape it
// crosses a socket to `mawsd`, Interfaces §G), and a half that refuses its write rejects (what the other half wrote
// stays written; a machine refusal leaves the client file untouched).
export interface ComposedSettings {
  readonly settings: Settings;
  update(patch: SettingsPatch): Promise<Settings>; // resolves once both halves persisted
}

// P5 O3-D M5b follow-up (D24, D26): on the daemon shape the split is `mawsd`'s, at its spine's first load, which main's
// first read of the machine half sets off; at the first launch on a profile before the split, main opens a unified
// client file that is converted moments later in the same run (the cold start: a few seconds at most). `split` resolves
// once the process that splits has done it; a client change made before then waits for it, at most the cold start's
// bound, rather than failing, and past the bound fails saying why with nothing written.
export const SPLIT_WAIT_MS = 30_000;

export function composeSettings({ clientFile, machine, split }: { clientFile: string; machine: MachineSettingsService; split?: () => Promise<void> }): ComposedSettings {
  const store = openSettingsFile(clientFile, clientSettingsRules);
  let awaitingSplit = split !== undefined && unifiedOnDisk(clientFile);
  return {
    get settings() {
      return mergeSettings(store.value, machine.state());
    },
    async update(patch) {
      const routed = splitSettingsPatch(patch);
      if (routed.machine) await machine.update(routed.machine);
      if (routed.client) {
        if (awaitingSplit) {
          await within(split!(), SPLIT_WAIT_MS, `the machine daemon has not converted settings.json to this version's format within ${SPLIT_WAIT_MS / 1000} s`);
          awaitingSplit = false; // converted, or the split could not write it: the store's own read says which
        }
        store.update((current) => retireShape(applyClientPatch(current, routed.client!)));
      }
      return mergeSettings(store.value, machine.state());
    },
  };
}

function unifiedOnDisk(file: string): boolean {
  try {
    return isUnifiedSettings(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return false; // absent or unreadable: the store's own read and write say what it is
  }
}

function within(promise: Promise<void>, ms: number, why: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_resolve, reject) => (timer = setTimeout(() => reject(new Error(why)), ms)));
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

export type ResolvedTheme = SettingsState['resolvedTheme'];

export function resolveTheme(theme: ThemeSetting, osPrefersDark: boolean): ResolvedTheme {
  if (theme === 'system') return osPrefersDark ? 'dark' : 'light';
  return theme;
}
