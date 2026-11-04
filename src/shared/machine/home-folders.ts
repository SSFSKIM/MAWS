// The machine's home as a remote setup reads it (P5 O7 M9, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "Remote setup"): the folder list's reads (`machine.folders.list`, src/services/machine/folders.ts), the endpoint's setup
// policy (`setupRefusal`, src/endpoint/policy.ts) and the setup's guarded handlers (src/services/machine/setup.ts) share
// it, so each reads a path the same way.
//
// None may raise a macOS privacy prompt by itself: on the mini such a dialog holds CI. The TCC-protected folders are
// `~/Desktop`, `~/Documents`, `~/Downloads`, `~/Pictures`, `~/Movies`, `~/Music` and `~/Library`, and anything under
// `~/Library/Mobile Documents` (each iCloud folder is its own, `Mobile Documents` itself included). A protected folder's own
// entry is read in its parent, as any other; what is inside it is touched only once it was opened (`opened`, the caller's
// rule).
//
// A path is resolved as the kernel resolves it, one component at a time from the home, each checked before it is
// touched: a link is followed where it stands (a `..` after it climbs from its target, never collapsed beforehand), and
// each name is taken as its folder lists it, so `documents` on a case-insensitive volume is `Documents` (the protected
// names are compared folded too, case and Unicode form as macOS's default volumes compare them). Nothing past an
// unopened protected folder is ever stat'ed, read or followed.
import { lstat, readdir, readlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, sep } from 'node:path';

/** The home and the platform (only macOS protects folders), injected so a test reads a fake home. */
export type Home = { home: string; platform: NodeJS.Platform };

export const PROTECTED_FOLDERS = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music', 'Library'] as const;
/** More links than this in one resolution is a loop (the kernel's own bound, MAXSYMLINKS). */
const LINKS_MAX = 32;

/** Why a path is not one a setup reads: missing or no directory, outside the home, through a link out of it, or in a protected folder not opened. */
export type HomeRefusal = 'no-folder' | 'outside-home' | 'symlink-escape' | 'protected';
export type Resolved = { ok: true; real: string } | { ok: false; reason: HomeRefusal };

/** A name as macOS's default volumes compare it: case- and Unicode-form-insensitive. */
const fold = (name: string): string => name.normalize('NFC').toLowerCase();
const partsOf = (path: string): string[] => path.split(sep).filter((part) => part !== '');
const sameParts = (a: readonly string[], b: readonly string[], where: Home): boolean => a.length === b.length && a.every((part, i) => (where.platform === 'darwin' ? fold(part) === fold(b[i]) : part === b[i]));

/** Whether `path` is `root` or lies under it (both absolute and normalized). */
export function within(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

/** The parts of `path` (absolute, normalized) below the home, or null when it is not under it. */
function belowHome(path: string, where: Home): string[] | null {
  const home = partsOf(where.home);
  const parts = partsOf(path);
  return parts.length >= home.length && sameParts(parts.slice(0, home.length), home, where) ? parts.slice(home.length) : null;
}

/** `~` and `~/…` under the home, an absolute path as given (resolved by the walk, `..` included); null for anything else. */
export function expandHome(path: string, home: string): string | null {
  if (path === '~') return home;
  if (path.startsWith('~/')) return `${home}${sep}${path.slice(2)}`;
  return isAbsolute(path) ? path : null;
}

/** Whether `path` (absolute, normalized) is one of the protected folders, its names compared folded. */
export function isProtected(path: string, where: Home): boolean {
  if (where.platform !== 'darwin') return false;
  const below = belowHome(path, where)?.map(fold);
  if (below === undefined || below.length === 0) return false;
  if (below.length === 1 && PROTECTED_FOLDERS.some((name) => fold(name) === below[0])) return true;
  return below[0] === 'library' && below[1] === 'mobile documents';
}

/** Whether what is inside `path` (absolute, normalized) may be touched: every protected folder it is, or lies in, was opened. */
export function readableInside(path: string, where: Home, opened: (folder: string) => boolean): boolean {
  const below = belowHome(path, where);
  if (below === null) return true; // outside the home nothing is protected
  for (let depth = below.length; depth > 0; depth--) {
    const folder = join(where.home, ...below.slice(0, depth));
    if (isProtected(folder, where) && !opened(folder)) return false;
  }
  return true;
}

export type WalkOptions = {
  /** The protected folders the caller opened. */
  opened(folder: string): boolean;
  /** The folder list's `open: true`: the protected folders the named path enters itself, before any link, are opened. */
  open?: boolean;
  /** The last part may be a file (a pointer git or the trust read follows). */
  file?: boolean;
  /** The path, or a link on it, may lead out of the home (a pointer read outside it touches no protected folder). */
  outside?: boolean;
};

/**
 * `path`'s real path, a directory under the home, read so that nothing inside a protected folder `opened` doesn't admit is
 * touched, and what is inside the result may be read too (a listing reads it, a setup's project and trust reads look in
 * it). Every link on the way must stay under the home, out and back in included.
 */
export function resolveInHome(path: string, where: Home, opened: (folder: string) => boolean): Promise<Resolved> {
  return walk(path, where, { opened });
}

/** The walk `resolveInHome` is, with the folder list's `open`, a file at the end, or a pointer out of the home allowed. */
export async function walk(path: string, where: Home, options: WalkOptions): Promise<Resolved> {
  if (!isAbsolute(path)) return { ok: false, reason: 'outside-home' };
  const home = where.home;
  const homeParts = partsOf(home);
  const named = partsOf(path);
  let parts: string[];
  let current: string;
  if (named.length >= homeParts.length && sameParts(named.slice(0, homeParts.length), homeParts, where)) [current, parts] = [home, named.slice(homeParts.length)];
  else if (options.outside === true) [current, parts] = [sep, named];
  else return { ok: false, reason: 'outside-home' };
  const entered = new Set<string>(); // the protected folders the named path entered itself (the list's `open`)
  const opened = (folder: string) => options.opened(folder) || (options.open === true && entered.has(folder));
  let followed = false;
  let links = 0;
  while (parts.length > 0) {
    const name = parts.shift()!;
    if (name === '.') continue;
    if (name === '..') {
      const up = dirname(current);
      if (options.outside !== true && belowHome(up, where) === null) return { ok: false, reason: followed ? 'symlink-escape' : 'outside-home' };
      current = up;
      continue;
    }
    if (!readableInside(current, where, opened)) return { ok: false, reason: 'protected' };
    const entry = await entryOf(current, name, where);
    if (entry === null) return { ok: false, reason: 'no-folder' };
    const next = join(current, entry.name);
    if (entry.link !== null) {
      if (++links > LINKS_MAX) return { ok: false, reason: 'symlink-escape' };
      followed = true;
      const target = partsOf(entry.link);
      if (!isAbsolute(entry.link)) parts = [...target, ...parts]; // from the link's own folder, `current`
      else if (target.length >= homeParts.length && sameParts(target.slice(0, homeParts.length), homeParts, where)) [current, parts] = [home, [...target.slice(homeParts.length), ...parts]];
      else if (options.outside === true) [current, parts] = [sep, [...target, ...parts]];
      else return { ok: false, reason: 'symlink-escape' };
      continue;
    }
    if (!entry.directory) return parts.length === 0 && options.file === true ? { ok: true, real: next } : { ok: false, reason: 'no-folder' };
    if (!followed && isProtected(next, where)) entered.add(next);
    current = next;
  }
  if (!readableInside(current, where, opened)) return { ok: false, reason: 'protected' };
  return { ok: true, real: current };
}

/**
 * One entry of `folder` as its own (never followed): its name as the folder lists it, its link's target, or whether it
 * is a directory; null when there is none. `folder` is one whose inside may be read.
 */
async function entryOf(folder: string, name: string, where: Home): Promise<{ name: string; link: string | null; directory: boolean } | null> {
  try {
    const stat = await lstat(join(folder, name));
    const listed = await listedName(folder, name, where);
    return { name: listed, link: stat.isSymbolicLink() ? await readlink(join(folder, listed)) : null, directory: stat.isDirectory() };
  } catch {
    return null;
  }
}

/** `name` as `folder` lists it: itself when listed so, else the one entry a case- and form-insensitive volume took it for. */
async function listedName(folder: string, name: string, where: Home): Promise<string> {
  const names = await readdir(folder);
  if (names.includes(name)) return name;
  const folded = fold(name);
  return (where.platform === 'darwin' ? names.find((entry) => fold(entry) === folded) : undefined) ?? names.find((entry) => entry.normalize('NFC') === name.normalize('NFC')) ?? name;
}
