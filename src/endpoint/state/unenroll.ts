// The state directory's side of `mawsd endpoint unenroll` (O14 M1, Interfaces §B): the files an enrollment leaves, put
// back to the state O10 M10 ships in. Every private key the directory holds is destroyed, at its top and under each
// earlier `stale-*/` (a key moved aside by the key-without-ledger rule, or an earlier unenroll's), because a retired key
// that lingered could sign backdated events its retirement would verify (RL §5.2); a later enrollment generates a new
// key under the same ref. The ids of the destroyed keys are kept in the new `stale-<time>/keys.json`, written before
// anything is destroyed; the pending provisioning's record goes before the key files, so no crash leaves a record that
// would write a destroyed key back. What the enrollment kept besides is moved to that directory, for the record.
import * as fs from 'node:fs';
import { join } from 'node:path';
import { removeFile, syncDirectory, writeAtomic } from './files';

/** The name of a directory things are moved aside to, by the time of the move. */
export const STALE_DIRECTORY = (now: number) => `stale-${new Date(now).toISOString().replace(/:/g, '-')}`;

/** Holding private key material, destroyed: the provisioning's record first (it holds the machine key too). */
const PRIVATE = ['provisioning.json', 'machine-key.json', 'delegation.json'] as const;
/** The enrollment's other files and directories, moved aside. */
const MOVED = ['grants.json', 'enrollment.json', 'org.json', 'legacy.json', 'listings.json', 'notified.json', 'retirement.json', 'signatures', 'inbound'] as const;

/** The `stale-*` directories directly under `dir` (a symlink of that name is none). */
export function staleDirectories(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('stale-'))
    .map((entry) => join(dir, entry.name));
}

/** A new, private `stale-<time>[-n]/` under `dir`. */
function freshAside(dir: string, now: number): string {
  const base = join(dir, STALE_DIRECTORY(now));
  for (let n = 0; ; n++) {
    const path = n === 0 ? base : `${base}-${n}`;
    try {
      fs.mkdirSync(path, { mode: 0o700 });
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

/** Unenrolls `dir` as the header says, `keyIds` being the ids of the keys it destroys; returns the new directory. */
export function unenrollDirectory(dir: string, now: number, keyIds: readonly string[]): string {
  const earlier = staleDirectories(dir);
  const aside = freshAside(dir, now);
  writeAtomic(aside, 'keys.json', `${JSON.stringify({ keyIds }, null, 2)}\n`);
  syncDirectory(dir);
  for (const from of [dir, ...earlier]) for (const name of PRIVATE) removeFile(from, name);
  for (const name of MOVED) {
    if (fs.existsSync(join(dir, name))) fs.renameSync(join(dir, name), join(aside, name));
  }
  syncDirectory(aside);
  syncDirectory(dir);
  return aside;
}
