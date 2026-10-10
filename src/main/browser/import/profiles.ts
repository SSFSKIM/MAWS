// `<userData>/browser/profiles.json`'s one owner in main (E4b Design §11; Decision Log 27, 33): read once at boot, held
// in memory, written whole through `atomicWriteFile`. E4a's `partitionFor` and `browser.profiles.list` read `browsable()`
// through `BrowserDeps.profiles`, so a record written in this boot is seen in this boot, and a profile under removal
// (`withdraw`) is no longer one a new tab opens in, while its record still stands. A record is put at the end of
// a `done` import, and again by a toggle or a boot load's statuses; a removal drops it. Writes are serialised, and the
// memory changes only once the file holds the new list. A file that cannot be read is moved aside as
// `profiles.json.broken-<epoch>`, the store starts empty, and `fileBroken` says so for this boot (Design §13; Decision
// Log 35): the renderer announces it, and the boot sweep then removes the partitions no record names.
// E11 (tracker row E4b "newer profiles.json treated as broken; sweep deletes imports"): a file whose `version` is newer
// than PROFILES_VERSION was written by a newer MAWS (the owner runs builds of several heads), so it is opened
// read-only, as `openDb` opens a newer index: its records are not listed (this build cannot read them), nothing is
// moved or written (`put` and `remove` reject), and `readOnly` tells the boot sweep to leave everything for that boot.
import { mkdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ImportedProfileSchema,
  ImportedProfilesFileSchema,
  ReadImportedProfilesFileSchema,
  ReadImportedProfilesFileV1Schema,
  PROFILES_FILE_VERSION,
  upgradeProfileV1,
  type ImportedProfile,
} from '@shared/browser/profiles';
import { atomicWriteFile } from '../../files/atomic-write';
import { importLog } from './log';

export const profilesFile = (userData: string) => join(userData, 'browser', 'profiles.json');
const PROFILES_VERSION = PROFILES_FILE_VERSION; // E11: the file's version this build writes and reads (2 since cua #90; 1 is upgraded)

export class ImportedProfiles {
  private writes: Promise<unknown> = Promise.resolve();
  private readonly withdrawn = new Set<string>();

  private constructor(
    private readonly file: string,
    private records: readonly ImportedProfile[],
    readonly fileBroken: boolean,
    private readonly newerVersion: number | null = null, // E11: the version a newer MAWS wrote; read-only when set
  ) {}

  // E11: the file a newer MAWS wrote, left as it is for this boot
  get readOnly(): boolean {
    return this.newerVersion !== null;
  }

  static open(userData: string, { now = Date.now }: { now?: () => number } = {}): ImportedProfiles {
    const file = profilesFile(userData);
    const read = readProfilesFile(file);
    if (typeof read === 'object' && 'newer' in read) {
      importLog({ kind: 'error', where: 'profiles', code: 'fileNewer', message: `profiles.json is version ${read.newer}, newer than this build reads; it is left as it is and nothing is swept this boot` });
      return new ImportedProfiles(file, [], false, read.newer);
    }
    if (read !== 'broken') return new ImportedProfiles(file, read, false);
    const aside = `profiles.json.broken-${now()}`;
    try {
      renameSync(file, join(dirname(file), aside));
      importLog({ kind: 'error', where: 'profiles', code: 'fileBroken', message: `profiles.json could not be read; moved aside as ${aside} and started empty` });
    } catch (error) {
      importLog({ kind: 'error', where: 'profiles', code: 'fileBrokenNotMoved', message: String((error as NodeJS.ErrnoException).code ?? '') });
    }
    return new ImportedProfiles(file, [], true);
  }

  list(): ImportedProfile[] {
    return [...this.records];
  }

  // The profiles a new tab may browse as: every record but those whose removal is under way.
  browsable(): ImportedProfile[] {
    return this.records.filter((record) => !this.withdrawn.has(record.profileDir));
  }

  // A removal's first act: the profile leaves `browsable()` so no tab opens in its partition while the removal empties
  // it; the returned release puts it back (a no-op once the record is dropped).
  withdraw(profileDir: string): () => void {
    this.withdrawn.add(profileDir);
    return () => void this.withdrawn.delete(profileDir);
  }

  get(profileDir: string): ImportedProfile | null {
    return this.records.find((record) => record.profileDir === profileDir) ?? null;
  }

  // Adds the record, or replaces the one of the same profile directory where it stands.
  async put(record: ImportedProfile): Promise<void> {
    const valid = ImportedProfileSchema.parse(record);
    await this.write((records) => {
      const at = records.findIndex((candidate) => candidate.profileDir === valid.profileDir);
      return at === -1 ? [...records, valid] : records.map((candidate, i) => (i === at ? valid : candidate));
    });
  }

  // cua #90: one record changed from its latest state, inside the write queue, so a change computed from an earlier read
  // (a sync's bookmarks state, a boot load's statuses, a toggle) never overwrites another writer's field. `change` answers
  // the new record, or null to write nothing; a record gone by then writes nothing. Answers the record written, or null.
  async update(profileDir: string, change: (record: ImportedProfile) => ImportedProfile | null): Promise<ImportedProfile | null> {
    let written: ImportedProfile | null = null;
    await this.write((records) => {
      const current = records.find((record) => record.profileDir === profileDir);
      const next = current ? change(current) : null;
      if (next === null) return null;
      written = ImportedProfileSchema.parse(next);
      if (written.profileDir !== profileDir) throw new Error('an update must keep the record’s profile directory');
      return records.map((record) => (record === current ? written! : record));
    });
    return written;
  }

  // Answers whether a record was there; writes only when one was.
  async remove(profileDir: string): Promise<boolean> {
    let removed = false;
    await this.write((records) => {
      const next = records.filter((record) => record.profileDir !== profileDir);
      removed = next.length !== records.length;
      return removed ? next : null;
    });
    return removed;
  }

  // Each change is computed from the list as the previous write left it; `null` writes nothing.
  private write(change: (records: readonly ImportedProfile[]) => readonly ImportedProfile[] | null): Promise<void> {
    const done = this.writes.then(async () => {
      if (this.newerVersion !== null) throw new Error(`profiles.json was written by a newer MAWS (version ${this.newerVersion}); it is read-only in this one`); // E11
      const next = change(this.records);
      if (next === null) return;
      const text = `${JSON.stringify(ImportedProfilesFileSchema.parse({ version: PROFILES_VERSION, profiles: next }), null, 2)}\n`;
      mkdirSync(dirname(this.file), { recursive: true });
      await atomicWriteFile(this.file, text);
      this.records = next;
    });
    this.writes = done.catch(() => {}); // a failed write fails its caller, not the next one
    return done;
  }
}

function readProfilesFile(file: string): ImportedProfile[] | 'broken' | { newer: number } {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? [] : 'broken';
  }
  try {
    const json = JSON.parse(text) as unknown;
    const version = typeof json === 'object' && json !== null ? (json as { version?: unknown }).version : undefined;
    if (typeof version === 'number' && Number.isInteger(version) && version > PROFILES_VERSION) return { newer: version }; // E11
    // cua #90: a version-1 file (E4b's) parses through its own schema and is upgraded in memory; the next write is version 2
    if (version === 1) {
      const v1 = ReadImportedProfilesFileV1Schema.safeParse(json);
      return v1.success ? v1.data.profiles.map(upgradeProfileV1) : 'broken';
    }
    const parsed = ReadImportedProfilesFileSchema.safeParse(json);
    return parsed.success ? parsed.data.profiles : 'broken';
  } catch {
    return 'broken'; // a SyntaxError quotes the file: never logged
  }
}
