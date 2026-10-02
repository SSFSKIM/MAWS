// `settings.json` in `userData`: read once at start, written whole through a temporary file and a rename, so a crash
// mid-write leaves the previous file rather than half of one. A missing file is a first run; an unreadable or invalid
// one is replaced by the defaults with a warning (the bad file is overwritten on the next write), never a crash.
// An earlier version's file (C1's version 1, C5's version 2) is migrated to version 3 here, in the store, and rewritten
// once; a file that already validates is never rewritten on read. The schema never defaults.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SettingsSchema, type Settings, type SettingsPatch, type SettingsState, type ThemeSetting } from '@shared/ipc/schema';
import { applySettingsPatch, migrateSettings, SETTINGS_DEFAULTS_V8 } from '@shared/settings/defaults';

export const DEFAULT_SETTINGS: Settings = SETTINGS_DEFAULTS_V8;
const defaults = (): Settings => structuredClone(DEFAULT_SETTINGS);

// C11: every step (v1 → v2, C5's, and v2 → v3) is `migrateSettings`; the store rewrites the file when it moved a version.
function migrate(file: string, raw: unknown): Settings {
  const settings = migrateSettings(raw);
  const from = (raw as { version: unknown }).version;
  if (from !== settings.version) {
    write(file, settings);
    console.log(`[settings] migrated ${file} from version ${String(from)} to ${settings.version}`);
  }
  return settings;
}

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
      const next = SettingsSchema.parse(applySettingsPatch(current, patch)); // C11: the one merge rule
      write(file, next);
      current = next;
      return current;
    },
  };
}

function read(file: string): Settings {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaults();
    console.warn(`[settings] cannot read ${file}; using defaults`, error);
    return defaults();
  }
  try {
    return migrate(file, JSON.parse(text));
  } catch (error) {
    console.warn(`[settings] invalid ${file}; using defaults`, error);
    return defaults();
  }
}

function write(file: string, settings: Settings): void {
  const temporary = `${file}.${process.pid}.tmp`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(temporary, JSON.stringify(settings));
  renameSync(temporary, file);
}
