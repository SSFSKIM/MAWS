// What changed in a session's working folder, as Files draws it (UX wave U6b-3a,
// docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3a-what-changed.md, decisions 4, 5, 8 to 10 and 14, Interfaces §C): the
// Changed group's rows from the status the git store holds, the letters and dots of the tree's rows, and the set of a
// status's entries, by which the tree learns that what git ignores may have moved. Pure. Paths are absolute and POSIX.
import type { GitFileStatus, GitStatus } from '@shared/ipc/schema/git';
import { unmerged } from '../review/review-model';
import { basename, dirname, joinPath } from './tree';

export type ChangeLetter = 'M' | 'A' | 'U' | 'D' | 'R' | '!';

export interface ChangedRow {
  path: string; // absolute: the repository's root joined with `rel`, without a trailing slash
  rel: string; // as the status lists it; a folder's with no trailing slash
  oldRel: string | null; // a rename's source
  letter: ChangeLetter; // decision 4
  folder: boolean; // an untracked folder, or a submodule
  onDisk: boolean; // false: D, and a conflict both sides deleted
}

export interface Marks {
  letter(path: string): ChangeLetter | null;
  dot(dir: string): ChangeLetter | null; // the weightiest letter of the rows beneath `dir`
}

// R1: Desktop's three tones. Tokens only.
export const LETTER_TONE: Record<ChangeLetter, 'text-danger' | 'text-warning' | 'text-success'> = {
  '!': 'text-danger',
  D: 'text-danger',
  M: 'text-warning',
  A: 'text-success',
  U: 'text-success',
  R: 'text-success',
};

// Decision 10: the dot takes the weightiest change beneath: a conflict, then a modification, then a deletion, then the rest.
const WEIGHT: Record<ChangeLetter, number> = { '!': 0, M: 1, D: 2, A: 3, U: 3, R: 3 };

// Decision 4, the first that applies.
function letterOf(file: GitFileStatus): ChangeLetter {
  if (unmerged(file)) return '!';
  if (file.untracked) return 'U';
  if (file.worktree === 'D' || (file.index === 'D' && file.worktree === '.')) return 'D';
  if (file.index === 'R' || file.worktree === 'R') return 'R';
  if (file.index === 'A' || file.index === 'C') return 'A';
  return 'M';
}

const trimSlash = (path: string): string => path.replace(/\/+$/, '');

// Decisions 4 and 5: one row per path (of two entries on one path the one on disk stands), conflicts first, then every
// row by its path.
export function changedRows(status: GitStatus): ChangedRow[] {
  const byPath = new Map<string, ChangedRow>();
  for (const file of status.files) {
    const letter = letterOf(file);
    const rel = trimSlash(file.path);
    const row: ChangedRow = {
      path: joinPath(status.repoRoot, rel),
      rel,
      oldRel: file.oldPath,
      letter,
      folder: file.path.endsWith('/') || file.submodule === true,
      onDisk: letter !== 'D' && !(file.index === 'D' && file.worktree === 'D'),
    };
    const held = byPath.get(rel);
    if (held === undefined || (!held.onDisk && row.onDisk)) byPath.set(rel, row);
  }
  const byRel = (a: ChangedRow, b: ChangedRow) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);
  const rows = [...byPath.values()];
  return [...rows.filter((row) => row.letter === '!').sort(byRel), ...rows.filter((row) => row.letter !== '!').sort(byRel)];
}

// The entry Review on Uncommitted lists for a row (decision 6's rows that open Review): an untracked folder's with its
// slash, as the status lists it; a rename whose new path the working tree has lost by its source, which is all
// `git diff HEAD` lists of it (the branch panel's scalpel 3); every other row by its own path.
export function reviewEntry(row: ChangedRow): string {
  if (row.folder && row.letter === 'U') return `${row.rel}/`;
  if (row.letter === 'D' && row.oldRel !== null) return row.oldRel;
  return row.rel;
}

// A path's normal form for matching, as `sameFile` matches (the same but for case, or the `/private` spelling). A mark
// is drawn and grants nothing.
const normal = (path: string): string => {
  const lower = path.toLowerCase();
  return lower.startsWith('/private/') ? lower.slice('/private'.length) : lower;
};

// Decision 9, built once per status: a letter by its path, `U` beneath an untracked folder, a dot for every folder above
// a row.
export function marksOf(rows: readonly ChangedRow[]): Marks {
  const letters = new Map<string, ChangeLetter>();
  const dots = new Map<string, ChangeLetter>();
  const untracked = new Set<string>();
  for (const row of rows) {
    const path = normal(row.path);
    letters.set(path, row.letter);
    if (row.folder && row.letter === 'U') untracked.add(path);
    for (let dir = dirname(path); ; dir = dirname(dir)) {
      const held = dots.get(dir);
      if (held === undefined || WEIGHT[row.letter] < WEIGHT[held]) dots.set(dir, row.letter);
      if (dir === '/') break;
    }
  }
  return {
    letter(path) {
      const at = normal(path);
      const own = letters.get(at);
      if (own !== undefined) return own;
      if (untracked.size === 0) return null;
      for (let dir = dirname(at); dir !== '/'; dir = dirname(dir)) if (untracked.has(dir)) return 'U';
      return null;
    },
    dot: (dir) => dots.get(normal(dir)) ?? null,
  };
}

// The set of a status's entries as one string: each path with its two letters and whether it is untracked, in the
// status's order. Equal for two statuses that list the same entries in the same states, whatever else of them differs
// (decision 14 (b); U6b-3b reads it too).
export function statusSet(status: GitStatus): string {
  return JSON.stringify(status.files.map((file) => [file.path, file.index, file.worktree, file.untracked]));
}

// What follows `base` in `path` ('' for `base` itself) when `path` lies under it, matched segment by segment in the
// normal form (as marks are matched); null otherwise.
export function pathUnder(base: string, path: string): string | null {
  const want = normal(trimSlash(base));
  if (normal(path) === want) return '';
  for (let cut = path.indexOf('/', 1); cut > 0; cut = path.indexOf('/', cut + 1)) {
    if (normal(path.slice(0, cut)) === want) return path.slice(cut + 1);
  }
  return null;
}

// Decision 8: the path a row shows, from the working folder for a row under it and from the repository's root otherwise
// (`rel`). `path` is the entry's absolute path.
export function shownPath(path: string, rel: string, working: string | null): string {
  const rest = working === null ? null : pathUnder(working, path);
  return rest === null || rest === '' ? rel : rest;
}

// A Changed row's name and folder (decision 6): a file's name, then its folder; a folder's name with its slash, then its
// parent folder. `shown` is the whole path the row shows, its title.
export function labelOf(row: ChangedRow, working: string | null): { name: string; folder: string; shown: string } {
  const path = shownPath(row.path, row.rel, working);
  const cut = path.lastIndexOf('/');
  const slash = row.folder ? '/' : '';
  return { name: `${basename(path)}${slash}`, folder: cut < 0 ? '' : path.slice(0, cut + 1), shown: `${path}${slash}` };
}
