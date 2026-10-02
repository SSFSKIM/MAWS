// A missing settings file is a first run. Startup can display defaults for an unreadable/invalid file, but writes
// refuse that file rather than replacing it with defaults. Migration persistence failure does not undo migration.
// Main holds the profile lock; synchronous read-modify-write also keeps multiple store handles from losing patches.
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SettingsSchema, type Settings, type SettingsPatch, type SettingsState, type ThemeSetting } from '@shared/ipc/schema';
import { applySettingsPatch, migrateSettings, SETTINGS_DEFAULTS_V8 } from '@shared/settings/defaults';
import { atomicWriteFileSync } from '../files/atomic-write';

export const DEFAULT_SETTINGS: Settings = SETTINGS_DEFAULTS_V8;
const defaults = (): Settings => structuredClone(DEFAULT_SETTINGS);

export type ResolvedTheme = SettingsState['resolvedTheme'];

export function resolveTheme(theme: ThemeSetting, osPrefersDark: boolean): ResolvedTheme {
  if (theme === 'system') return osPrefersDark ? 'dark' : 'light';
  return theme;
}

export interface SettingsStore {
  readonly settings: Settings;
  update(patch: SettingsPatch): Settings; // persists before returning
}

export function openSettingsStore(file: string): SettingsStore {
  let current = read(file);
  return {
    get settings() {
      return current;
    },
    update(patch) {
      const next = SettingsSchema.parse(applySettingsPatch(read(file, true), patch));
      write(file, next);
      current = next;
      return current;
    },
  };
}

function read(file: string, forUpdate = false): Settings {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaults();
    if (forUpdate) throw error;
    console.warn(`[settings] cannot read ${file}; using defaults`, error);
    return defaults();
  }
  let raw: unknown;
  let settings: Settings;
  try {
    raw = JSON.parse(text);
    settings = migrateSettings(raw);
  } catch (error) {
    if (forUpdate) throw error;
    console.warn(`[settings] invalid ${file}; using defaults`, error);
    return defaults();
  }
  const from = (raw as { version: unknown }).version;
  if (!forUpdate && from !== settings.version) {
    try {
      write(file, settings);
      console.log(`[settings] migrated ${file} from version ${String(from)} to ${settings.version}`);
    } catch (error) {
      console.warn(`[settings] cannot persist migration of ${file}; keeping migrated settings in memory`, error);
    }
  }
  return settings;
}

function write(file: string, settings: Settings): void {
  mkdirSync(dirname(file), { recursive: true });
  atomicWriteFileSync(file, JSON.stringify(settings));
}
