// Staging (E4b Design §4 and §15; Decision Log 5, 23): Chrome's stores are copied into `<userData>/browser/import/<uuid>/`
// before anything opens them, because Chrome's own files are locked and change under a running Chrome. Only regular
// files are copied (an `lstat` first: `copyFile` would follow a symlinked source), each with the companions SQLite
// needs to roll a hot journal or WAL forward, never over an existing destination. The copy is opened read-write (it is
// MAWS's own) and nothing writes to it. Deleted on every exit of an inspection or an import, and by the boot sweep.
import { randomUUID } from 'node:crypto';
import { constants, rmSync } from 'node:fs';
import { copyFile, lstat, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { storeVersion } from './chrome/sqlite';

export interface Staging {
  id: string;
  dir: string;
}

export type StoreName = 'History' | 'Cookies';
// `missing`: the profile has no such store (the category has nothing to import); `unreadable`: it exists but could not
// be copied safely, `code` saying why (`symlink`, `EBUSY`, `EEXIST`, …).
export type StagedStore = { ok: true; file: string } | { ok: false; error: 'missing' | 'unreadable'; code: string };
export type OpenedStore = { ok: true; db: DatabaseSync; storeVersion: number } | { ok: false; code: string };

const COMPANIONS = ['-journal', '-wal', '-shm'];
// Chrome keeps the cookie store under Network/ in current versions and beside the profile in older ones.
const LOCATIONS: Record<StoreName, string[][]> = { History: [['History']], Cookies: [['Network', 'Cookies'], ['Cookies']] };

export async function createStaging(userData: string): Promise<Staging> {
  const root = join(userData, 'browser', 'import');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const dir = join(root, id);
  await mkdir(dir, { mode: 0o700 }); // fails rather than reuse a directory
  return { id, dir };
}

export async function deleteStaging(staging: Staging): Promise<void> {
  await rm(staging.dir, { recursive: true, force: true });
}

// At `will-quit`, where nothing asynchronous finishes.
export function deleteStagingSync(staging: Staging): void {
  rmSync(staging.dir, { recursive: true, force: true });
}

export async function stageStore(profilePath: string, staging: Staging, store: StoreName): Promise<StagedStore> {
  for (const parts of LOCATIONS[store]) {
    const source = await locate(profilePath, parts);
    if (source === 'missing') continue;
    if (source === 'symlink') return { ok: false, error: 'unreadable', code: 'symlink' };
    return copyWithCompanions(source, join(staging.dir, store));
  }
  return { ok: false, error: 'missing', code: 'ENOENT' };
}

// The store's path when every component under the profile is a real directory and the store a regular file.
async function locate(profilePath: string, parts: string[]): Promise<string | 'missing' | 'symlink'> {
  let path = profilePath;
  for (const [i, part] of parts.entries()) {
    path = join(path, part);
    const kind = await kindOf(path);
    if (kind === 'missing') return 'missing';
    const last = i === parts.length - 1;
    if (last ? kind !== 'file' : kind !== 'directory') return 'symlink'; // a link, or anything but the expected kind
  }
  return path;
}

async function copyWithCompanions(source: string, destination: string): Promise<StagedStore> {
  const companions: string[] = [];
  for (const suffix of COMPANIONS) {
    const kind = await kindOf(source + suffix);
    if (kind === 'missing') continue;
    if (kind !== 'file') return { ok: false, error: 'unreadable', code: 'symlink' };
    companions.push(suffix);
  }
  try {
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    for (const suffix of companions) await copyFile(source + suffix, destination + suffix, constants.COPYFILE_EXCL);
  } catch (error) {
    return { ok: false, error: 'unreadable', code: codeOf(error) };
  }
  return { ok: true, file: destination };
}

async function kindOf(path: string): Promise<'missing' | 'file' | 'directory' | 'other'> {
  try {
    const info = await lstat(path);
    return info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    return 'other';
  }
}

// SQLite's primary result codes a staged store fails with (sqlite3.h), named for the report's error.
const SQLITE_CODES: Record<number, string> = { 5: 'SQLITE_BUSY', 6: 'SQLITE_LOCKED', 10: 'SQLITE_IOERR', 11: 'SQLITE_CORRUPT', 14: 'SQLITE_CANTOPEN', 26: 'SQLITE_NOTADB' };

// Opened read-write so a hot journal or WAL copied beside it is applied (Decision Log 23); the caller closes `db`.
export function openStagedStore(file: string): OpenedStore {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file);
    return { ok: true, db, storeVersion: storeVersion(db) };
  } catch (error) {
    db?.close();
    return { ok: false, code: codeOf(error) };
  }
}

function codeOf(error: unknown): string {
  const { code, errcode } = (error ?? {}) as { code?: unknown; errcode?: unknown };
  if (typeof errcode === 'number') return SQLITE_CODES[errcode & 0xff] ?? 'SQLITE_ERROR';
  return typeof code === 'string' ? code : 'unknown';
}
