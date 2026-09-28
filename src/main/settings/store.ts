// `settings.json` in `userData`: read once at start, written whole through a temporary file and a rename, so a crash
// mid-write leaves the previous file rather than half of one. A missing file is a first run; an unreadable or invalid
// one is replaced by the defaults with a warning (the bad file is overwritten on the next write), never a crash.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SettingsSchema, type Settings, type SettingsPatch, type SettingsState, type ThemeSetting } from '@shared/ipc/schema';

export const DEFAULT_SETTINGS: Settings = { version: 1, theme: 'light' }; // light-first (D-4, charter §10 item 10)

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
      const given = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
      const next = SettingsSchema.parse({ ...current, ...given });
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
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return DEFAULT_SETTINGS;
    console.warn(`[settings] cannot read ${file}; using defaults`, error);
    return DEFAULT_SETTINGS;
  }
  try {
    return SettingsSchema.parse(JSON.parse(text));
  } catch (error) {
    console.warn(`[settings] invalid ${file}; using defaults`, error);
    return DEFAULT_SETTINGS;
  }
}

function write(file: string, settings: Settings): void {
  const temporary = `${file}.${process.pid}.tmp`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(temporary, JSON.stringify(settings));
  renameSync(temporary, file);
}
