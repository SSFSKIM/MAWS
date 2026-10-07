// `<userData>/browser/profiles.json`'s one owner in main (E4b Design §11; Decision Log 27, 33): read once at boot, held
// in memory, written whole through `atomicWriteFile`. E4a's `partitionFor` and `browser.profiles.list` read `list()`
// through `BrowserDeps.profiles`, so a record written in this boot is seen in this boot. A record is put at the end of
// a `done` import, and again by a toggle or a boot load's statuses; a removal drops it. Writes are serialised, and the
// memory changes only once the file holds the new list. A file that cannot be read is moved aside as
// `profiles.json.broken-<epoch>`, the store starts empty, and `fileBroken` says so for this boot (Design §13; Decision
// Log 35): the renderer announces it, and the boot sweep then removes the partitions no record names.
import { mkdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ImportedProfileSchema, ImportedProfilesFileSchema, type ImportedProfile } from '@shared/browser/profiles';
import { atomicWriteFile } from '../../files/atomic-write';
import { importLog } from './log';

export const profilesFile = (userData: string) => join(userData, 'browser', 'profiles.json');

export class ImportedProfiles {
  private writes: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly file: string,
    private records: readonly ImportedProfile[],
    readonly fileBroken: boolean,
  ) {}

  static open(userData: string, { now = Date.now }: { now?: () => number } = {}): ImportedProfiles {
    const file = profilesFile(userData);
    const read = readProfilesFile(file);
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
      const next = change(this.records);
      if (next === null) return;
      const text = `${JSON.stringify(ImportedProfilesFileSchema.parse({ version: 1, profiles: next }), null, 2)}\n`;
      mkdirSync(dirname(this.file), { recursive: true });
      await atomicWriteFile(this.file, text);
      this.records = next;
    });
    this.writes = done.catch(() => {}); // a failed write fails its caller, not the next one
    return done;
  }
}

function readProfilesFile(file: string): ImportedProfile[] | 'broken' {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? [] : 'broken';
  }
  try {
    const parsed = ImportedProfilesFileSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data.profiles : 'broken';
  } catch {
    return 'broken'; // a SyntaxError quotes the file: never logged
  }
}
