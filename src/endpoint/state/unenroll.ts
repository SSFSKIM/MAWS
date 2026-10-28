// The state directory's side of `mawsd endpoint unenroll` (O14 M1, Interfaces §B): the files an enrollment leaves, put
// back to the state O10 M10 ships in. Every private key the directory holds is destroyed, at its top and under each
// earlier `stale-*/` (a key moved aside by the key-without-ledger rule, or an earlier unenroll's), because a retired key
// that lingered could sign backdated events its retirement would verify (RL §5.2); a later enrollment generates a new
// key under the same ref. The ids of the destroyed keys are kept in the new `stale-<time>/keys.json`, written before
// anything is destroyed; the pending provisioning's record goes before the key files, so no crash leaves a record that
// would write a destroyed key back. What the enrollment kept besides is moved to that directory, for the record, but
// the records RL10 keeps by project and position, `signatures/` and `inbound/` (non-secret): under a later enrollment of
// the same ref by the same authority, the signatures an earlier key made stay the ones a resend of a position the hub
// holds repeats, and the replay index keeps refusing a device's instruction at a new position (the O14 spec's Decision
// Log, M1's review rounds 1 and 2). Neither is keyed by org, so `records-authority.json` beside them names the authority
// they were made under (org, hub, recovery key), and an enrollment under another moves all three aside first
// (`moveRecordsAside`, `EndpointState.claimRecords`). The key-without-ledger rule never touches them.
import * as fs from 'node:fs';
import { join } from 'node:path';
import { removeFile, syncDirectory, writeAtomic } from './files';

/** The name of a directory things are moved aside to, by the time of the move. */
export const STALE_DIRECTORY = (now: number) => `stale-${new Date(now).toISOString().replace(/:/g, '-')}`;

/** Holding private key material, destroyed: the provisioning's record first (it holds the machine key too). */
const PRIVATE = ['provisioning.json', 'machine-key.json', 'delegation.json'] as const;
/** The records RL10 keeps by project and position, and the marker naming the authority they were made under. */
const RECORDS = ['signatures', 'inbound', 'records-authority.json'] as const;
/** The enrollment's other files and directories, moved aside. */
const MOVED = ['grants.json', 'enrollment.json', 'org.json', 'legacy.json', 'listings.json', 'notified.json', 'retirement.json'] as const;

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

/** Moves `dir`'s records and their marker to a new `stale-<time>/`, returned; nothing (null) when none is held. */
export function moveRecordsAside(dir: string, now: number): string | null {
  const held = RECORDS.filter((name) => fs.existsSync(join(dir, name)));
  if (held.length === 0) return null;
  const aside = freshAside(dir, now);
  for (const name of held) fs.renameSync(join(dir, name), join(aside, name));
  syncDirectory(aside);
  syncDirectory(dir);
  return aside;
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
