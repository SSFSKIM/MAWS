// The machine's home as a remote setup reads it (P5 O7 M9, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "Remote setup"): the folder list's reads (`machine.folders.list`, src/services/machine/folders.ts) and the endpoint's
// setup policy (`setupRefusal`, src/endpoint/policy.ts) share it, so both read a path the same way.
//
// Neither may raise a macOS privacy prompt by itself: on the mini such a dialog holds CI. The TCC-protected folders are
// `~/Desktop`, `~/Documents`, `~/Downloads`, `~/Pictures`, `~/Movies`, `~/Music` and `~/Library`, and anything under
// `~/Library/Mobile Documents` (each iCloud folder is its own, `Mobile Documents` itself included). A protected folder's own
// entry is read in its parent, as any other; what is inside it is touched only once it was opened (`opened`, the caller's
// rule). A path is resolved one component at a time, each checked before it is touched, a link's target too, so nothing
// past an unopened protected folder is ever stat'ed, read or followed.
import { lstat, readlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** The home and the platform (only macOS protects folders), injected so a test reads a fake home. */
export type Home = { home: string; platform: NodeJS.Platform };

export const PROTECTED_FOLDERS = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music', 'Library'] as const;
const MOBILE_DOCUMENTS = join('Library', 'Mobile Documents');
/** More links than this in one resolution is a loop (the kernel's own bound, MAXSYMLINKS). */
const LINKS_MAX = 32;

/** Why a path is not one a setup reads: missing or no directory, outside the home, through a link out of it, or in a protected folder not opened. */
export type HomeRefusal = 'no-folder' | 'outside-home' | 'symlink-escape' | 'protected';
export type Resolved = { ok: true; real: string } | { ok: false; reason: HomeRefusal };

/** Whether `path` is `root` or lies under it (both absolute and normalized). */
export function within(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

/** `~` and `~/…` under the home, an absolute path normalized; null for anything else (a relative path, `~user`). */
export function expandHome(path: string, home: string): string | null {
  if (path === '~') return resolve(home);
  if (path.startsWith('~/')) return resolve(home, path.slice(2));
  return isAbsolute(path) ? resolve(path) : null;
}

/** Whether `path` (absolute, normalized) is one of the protected folders. */
export function isProtected(path: string, where: Home): boolean {
  if (where.platform !== 'darwin') return false;
  const rel = relative(where.home, path);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return false;
  return (PROTECTED_FOLDERS as readonly string[]).includes(rel) || within(rel, MOBILE_DOCUMENTS);
}

/** Whether what is inside `path` may be touched: every protected folder it is, or lies in, was opened. */
export function readableInside(path: string, where: Home, opened: (folder: string) => boolean): boolean {
  for (let folder = path; within(folder, where.home); folder = dirname(folder)) {
    if (isProtected(folder, where) && !opened(folder)) return false;
    if (folder === where.home) break;
  }
  return true;
}

/**
 * `path`'s real path, a directory under the home, read so that nothing inside a protected folder `opened` doesn't admit is
 * touched, and what is inside the result may be read too (a listing reads it, a setup's project and trust reads look in
 * it). Every link on the way must stay under the home, out and back in included.
 */
export async function resolveInHome(path: string, where: Home, opened: (folder: string) => boolean): Promise<Resolved> {
  const home = resolve(where.home);
  const named = isAbsolute(path) ? resolve(path) : null;
  if (named === null || !within(named, home)) return { ok: false, reason: 'outside-home' };
  let rest = parts(home, named);
  let current = home;
  let links = 0;
  while (rest.length > 0) {
    const next = join(current, rest.shift()!);
    if (!readableInside(current, { ...where, home }, opened)) return { ok: false, reason: 'protected' };
    const entry = await entryOf(next);
    if (entry === null) return { ok: false, reason: 'no-folder' };
    const { link, directory } = entry;
    if (link !== null) {
      if (++links > LINKS_MAX) return { ok: false, reason: 'symlink-escape' };
      const target = resolve(current, link);
      if (!within(target, home)) return { ok: false, reason: 'symlink-escape' };
      rest = [...parts(home, target), ...rest];
      current = home;
      continue;
    }
    if (!directory) return { ok: false, reason: 'no-folder' };
    current = next;
  }
  if (!readableInside(current, { ...where, home }, opened)) return { ok: false, reason: 'protected' };
  return { ok: true, real: current };
}

/** One entry as its own (never followed): a link's target, or whether it is a directory; null when it can't be read. */
async function entryOf(path: string): Promise<{ link: string | null; directory: boolean } | null> {
  try {
    const entry = await lstat(path);
    return { link: entry.isSymbolicLink() ? await readlink(path) : null, directory: entry.isDirectory() };
  } catch {
    return null;
  }
}

const parts = (home: string, path: string): string[] => relative(home, path).split(sep).filter((part) => part !== '');
