// The rules every settings file keeps (C1; since P5 O3-A both of its files, the client's `settings.json` and the
// machine's `machine-settings.json`, each with its own `SettingsFileRules`). A missing file is a first run. Startup can
// display defaults for an unreadable/invalid file, but writes refuse that file rather than replacing it with defaults.
// Migration persistence failure does not undo migration. A file read-only for this run (a unified file the split has
// not converted, or every machine file in a run refused the spine) is read and never written.
// Main holds the profile lock; synchronous read-modify-write also keeps multiple store handles from losing patches.
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { atomicWriteFileSync } from '../files/atomic-write';

// How one file is read. `read` answers the file's value as this build reads it, or throws for a file it cannot own
// (invalid, or a version it does not know): `migrated` names the version it was migrated from (written back once, at
// open), `readOnly` why it may not be written this run. `validate` is the schema's parse before every write.
export interface SettingsFileRules<T> {
  read(raw: unknown): { value: T; migrated?: unknown; readOnly?: string };
  defaults(): T;
  validate(value: T): T;
}

export interface SettingsFileStore<T> {
  readonly value: T;
  update(change: (current: T) => T): T; // persists before returning; throws when the file may not be written
}

// `refused`: why nothing may write this file this run (P5 O3-A: the machine file in a run refused the spine); it is
// read, a migration of it is not persisted, and every update throws.
export function openSettingsFile<T>(file: string, rules: SettingsFileRules<T>, options: { refused?: string | null } = {}): SettingsFileStore<T> {
  const refused = options.refused ?? null;
  let current = read(file, rules, refused);
  return {
    get value() {
      return current;
    },
    update(change) {
      if (refused !== null) throw new Error(`${file} is not written this run: ${refused}`);
      const next = rules.validate(change(read(file, rules, refused, true)));
      write(file, next);
      current = next;
      return current;
    },
  };
}

function read<T>(file: string, rules: SettingsFileRules<T>, refused: string | null, forUpdate = false): T {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return rules.defaults();
    if (forUpdate) throw error;
    console.warn(`[settings] cannot read ${file}; using defaults`, error);
    return rules.defaults();
  }
  let reading: ReturnType<SettingsFileRules<T>['read']>;
  try {
    reading = rules.read(JSON.parse(text));
  } catch (error) {
    if (forUpdate) throw error;
    console.warn(`[settings] invalid ${file}; using defaults`, error);
    return rules.defaults();
  }
  if (reading.readOnly !== undefined) {
    if (forUpdate) throw new Error(`${file} is not written this run: ${reading.readOnly}`);
    return reading.value;
  }
  if (!forUpdate && reading.migrated !== undefined && refused === null) {
    try {
      write(file, reading.value);
      console.log(`[settings] migrated ${file} from version ${String(reading.migrated)} to ${String((reading.value as { version?: unknown }).version)}`);
    } catch (error) {
      console.warn(`[settings] cannot persist migration of ${file}; keeping migrated settings in memory`, error);
    }
  }
  return reading.value;
}

export function writeSettingsFile(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  atomicWriteFileSync(file, JSON.stringify(value));
}
const write = writeSettingsFile;
