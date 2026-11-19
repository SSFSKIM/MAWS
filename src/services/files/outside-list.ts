// The walk and the listing of a path of this machine for another machine's chooser (UX wave U6f,
// docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, §B and decisions 7, 8 and 18). Both
// touch nothing inside a folder macOS protects unless the request opens it: a click on another Mac must not raise a
// privacy prompt on this one, where nobody may be sitting. The path is resolved by the home folders' own walk
// (src/shared/machine/home-folders.ts), a path outside the home and a file at its end allowed, each link followed
// where it stands; a listing then reads one folder's entries by their directory entry types alone, so no entry is
// stat'ed, read or followed, and a folder of thousands of names on a slow disk costs one `readdir`.
import { readdir } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { OUTSIDE_LIST_PAGE, type FilesListOutsideOutput, type OutsideEntry } from '@shared/ipc/schema/files';
import { isProtected, walk, type Home, type Resolved } from '@shared/machine/home-folders';

/**
 * `path` (absolute) walked to its real path. `open`: the person said to open the protected folders the path names, and
 * those its last component's target lies in when that is a link (the walk's own `open`); a protected folder any other
 * link on the way leads into, and every one without it, answers `protected` before anything inside it is touched.
 */
export function walkOutside(path: string, where: Home, open: boolean): Promise<Resolved> {
  return walk(path, where, { opened: () => false, open, file: true, outside: true });
}

export const refused = (reason: Extract<FilesListOutsideOutput, { status: 'refused' }>['reason']): FilesListOutsideOutput => ({ status: 'refused', reason });
const errno = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;

/**
 * One page of the folder at `real`, the real path `walkOutside` ended at (read as walked, never resolved again from the
 * path as typed), the names after `cursor` in the listing's order.
 */
export async function listOutsideFolder(real: string, where: Home, cursor?: string, page = OUTSIDE_LIST_PAGE): Promise<FilesListOutsideOutput> {
  let entries: OutsideEntry[];
  try {
    entries = (await readdir(real, { withFileTypes: true })).map((entry) => {
      const kind = entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : entry.isSymbolicLink() ? 'link' : 'other';
      const at = join(real, entry.name);
      return { name: entry.name, path: at, kind, protected: kind === 'dir' && isProtected(at, where) };
    });
  } catch (error) {
    const code = errno(error);
    return refused(code === 'ENOTDIR' ? 'not-a-folder' : code === 'ENOENT' ? 'no-folder' : 'unreadable');
  }
  entries.sort(order);
  const start = startAfter(entries, cursor);
  const shown = entries.slice(start, start + page);
  return { status: 'listed', path: real, parent: real === sep ? null : dirname(real), home: where.home, entries: shown, cursor: start + page < entries.length ? shown.at(-1)!.name : null };
}

/**
 * The listing's one total order, which a cursor pages by: folders before everything else (a file, a link and anything
 * else are one kind); inside a kind, a name that begins with a dot after the others; then the names without regard to
 * case (their lower-cased forms, by code unit), and the names themselves where those are equal.
 */
function order(a: Pick<OutsideEntry, 'name' | 'kind'>, b: Pick<OutsideEntry, 'name' | 'kind'>): number {
  return Number(a.kind !== 'dir') - Number(b.kind !== 'dir') || Number(a.name.startsWith('.')) - Number(b.name.startsWith('.')) || byUnits(a.name.toLowerCase(), b.name.toLowerCase()) || byUnits(a.name, b.name);
}
const byUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Where the page after `cursor` starts: after the entry of that name. A name no longer in the folder is placed as a
 * folder's would be, so a folder changed between two pages repeats an entry rather than drops one.
 */
function startAfter(sorted: readonly OutsideEntry[], cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const at = sorted.findIndex((entry) => entry.name === cursor);
  if (at >= 0) return at + 1;
  return sorted.filter((entry) => order(entry, { name: cursor, kind: 'dir' }) <= 0).length;
}
