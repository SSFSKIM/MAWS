// The page's registration (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md, §O; T18; the composite's
// §7 and X4): `<sminos home>/sheet/surfaces/<name>.json`, the file by which a terminal session's tool learns that a
// surface can show its sheet, and where. On the daemon's run path: Node builtins and the shared writer (itself
// builtins alone), so the heartbeat needs nothing loaded.
//
// It is written by replace (the shared writer: a temporary file created exclusively, following no link, at mode 0600,
// then renamed over it), so a reader in a loop never sees a part of it. Where the sminos home does not exist nothing is
// written and nothing made, so a machine without sminos gets no directory from MAWS; `sheet/` and `surfaces/` are made
// at mode 0700 when absent, and one that is a link or not a directory is refused, as C3's Confinement refuses one. At a
// clean stop the file is removed, under the same confinement and making nothing, if it is a regular file that still
// names this process; after a death it stays, and its pid and its age make it not alive to a reader.
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFileSync } from '@shared/fs/atomic-write';

export interface Registration {
  v: 1;
  name: string;
  pid: number;
  url: string; // the page's origin, no path, no trailing slash: a reader appends `/s/<session>`
  reach: 'local';
  heartbeatAt: string; // toISOString()
}

export type RegistrationWrite = 'written' | 'no-home' | 'refused';

export const surfacesDir = (home: string): string => join(home, 'sheet', 'surfaces');

// `mawsd` for the default profile's daemon; any other is `mawsd-<12 hex of the profile path's SHA-1>`, so a scratch
// daemon sharing a home never writes the default one's file.
export function registrationName(defaultProfile: boolean, profileDir: string): string {
  return defaultProfile ? 'mawsd' : `mawsd-${createHash('sha1').update(profileDir).digest('hex').slice(0, 12)}`;
}

const kindOf = (path: string): 'directory' | 'other' | null => {
  try {
    return lstatSync(path).isDirectory() ? 'directory' : 'other';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
};

// A directory of the home's, made at 0700 when absent; false when it is a link or not a directory.
function confined(dir: string): boolean {
  let kind = kindOf(dir);
  if (kind === null) {
    try {
      mkdirSync(dir, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    kind = kindOf(dir); // made meanwhile by another: looked at again
  }
  return kind === 'directory';
}

const homeExists = (home: string): boolean => {
  try {
    return statSync(home).isDirectory();
  } catch {
    return false;
  }
};

/** Writes the registration by replace. Throws only for a failure of the write itself (a full volume), which the caller logs. */
export function writeRegistration(home: string, registration: Registration): RegistrationWrite {
  if (!homeExists(home)) return 'no-home';
  if (!confined(join(home, 'sheet')) || !confined(surfacesDir(home))) return 'refused';
  atomicWriteFileSync(join(surfacesDir(home), `${registration.name}.json`), `${JSON.stringify(registration)}\n`); // its temporary name, `.<uuid>.tmp`, no reader takes for a registration
  return 'written';
}

/**
 * Removes the registration `name` only while it is a regular file that still names `pid`: another process's file, a link,
 * a FIFO (opened without blocking) or a directory at its name is left as it stands. 'left' for each of those and for a
 * file already gone; it throws only for what the caller should log (a home whose permissions changed meanwhile).
 */
export function removeRegistration(home: string, name: string, pid: number): 'removed' | 'left' {
  if (!homeExists(home) || kindOf(join(home, 'sheet')) !== 'directory' || kindOf(surfacesDir(home)) !== 'directory') return 'left'; // the write's confinement, making nothing
  const file = join(surfacesDir(home), `${name}.json`);
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (codeOf(error) === 'ENOENT' || codeOf(error) === 'ELOOP') return 'left'; // gone, or a link
    throw error;
  }
  let named: unknown;
  try {
    if (!fstatSync(fd).isFile()) return 'left';
    try {
      named = (JSON.parse(readFileSync(fd, 'utf8')) as { pid?: unknown }).pid;
    } catch {
      return 'left'; // not a registration: nothing of ours
    }
  } finally {
    closeSync(fd);
  }
  if (named !== pid) return 'left';
  try {
    unlinkSync(file);
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return 'left'; // gone meanwhile
    throw error;
  }
  return 'removed';
}

const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;
