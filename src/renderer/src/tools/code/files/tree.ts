// The Files tree as data (C8c execution document, M2's decisions): one flat list of rows derived from the roots, the
// listings the store holds and the expanded set, so a 5,000-entry directory is one virtual list rather than nested
// components. Pure. Paths are absolute and POSIX; the renderer has no `node:path`.
import type { SessionRecord } from '@shared/graph/session';
import type { FilesEntry, FilesListOutput } from '@shared/ipc/schema/files';

export type Listing = { status: 'loading' } | { status: 'ok'; value: FilesListOutput } | { status: 'error'; message: string };
export type RootRole = 'directory' | 'additional directory' | 'worktree';
export interface RootCandidate {
  path: string;
  role: RootRole;
}

export const dirname = (path: string): string => {
  const cut = path.lastIndexOf('/');
  return cut <= 0 ? '/' : path.slice(0, cut);
};
export const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1) || path;
export const joinPath = (dir: string, name: string): string => (dir.endsWith('/') ? dir + name : `${dir}/${name}`);

// Whether a realpath the service answered (a root, an event's path) names the file a caller spelled another way: the
// same string, the same string but for case (APFS is case-insensitive and the native realpath canonicalises case), or
// the spelling under macOS's one firmlinked prefix (`/tmp/x` is `/private/tmp/x`). Nothing looser: a path that merely
// ends like a root is another file, and taking it for one would open a different in-root file (K4). Used only to match,
// never to grant: the service judges every path it is given.
export function sameFile(real: string, given: string): boolean {
  if (real === given) return true;
  const r = real.toLowerCase();
  const g = given.toLowerCase();
  return r === g || (g.startsWith('/') && r === `/private${g}`);
}

// The session's roots as the record declares them, in the service's order (directory, additional directories, the
// worktree when it differs), each with the role its row names.
export function rootsFor(record: Pick<SessionRecord, 'directory' | 'additionalDirectories' | 'worktree'>): RootCandidate[] {
  const out: RootCandidate[] = [];
  const add = (path: string, role: RootRole) => {
    if (!out.some((c) => c.path === path)) out.push({ path, role });
  };
  add(record.directory, 'directory');
  for (const path of record.additionalDirectories) add(path, 'additional directory');
  if (record.worktree) add(record.worktree.path, 'worktree');
  return out;
}

// The role of a root the service listed (a realpath), from the record's candidates.
export function roleOf(rootPath: string, candidates: readonly RootCandidate[]): RootRole | null {
  return candidates.find((c) => sameFile(rootPath, c.path))?.role ?? null;
}

// `.git` is hidden only as a root's direct child; a nested `.git` (a submodule's file) is shown, and so are dotfiles.
export const hidden = (entry: FilesEntry, parentIsRoot: boolean): boolean => parentIsRoot && entry.name === '.git';

// The root that holds `path` (the most specific when roots nest), the path respelled under that root's realpath, and
// the directories to expand to show it, from the root down to its parent. Null when no root holds it.
export function expandTo(roots: readonly string[], path: string): { root: string; path: string; ancestors: string[] } | null {
  let best: { root: string; rest: string } | null = null;
  for (const root of roots) {
    const rest = restUnder(root, path);
    if (rest !== null && (best === null || root.length > best.root.length)) best = { root, rest };
  }
  if (best === null) return null;
  const segments = best.rest.split('/').filter(Boolean);
  const ancestors = [best.root];
  let at = best.root;
  for (const segment of segments.slice(0, -1)) ancestors.push((at = joinPath(at, segment)));
  return { root: best.root, path: segments.reduce(joinPath, best.root), ancestors: segments.length === 0 ? [] : ancestors };
}

// What follows the root in `path` ('' for the root itself), when some leading part of `path` names the root.
function restUnder(root: string, path: string): string | null {
  if (!path.startsWith('/')) return null;
  for (let cut = path.length; cut > 0; cut = path.lastIndexOf('/', cut - 1)) {
    if (sameFile(root, path.slice(0, cut))) return path.slice(cut);
  }
  return null;
}

export type TreeRow =
  | { kind: 'root'; key: string; path: string; depth: 0; name: string; role: RootRole | null; expanded: boolean }
  | { kind: 'entry'; key: string; path: string; depth: number; entry: FilesEntry; expanded: boolean }
  | { kind: 'notice'; key: string; path: string; depth: number; notice: 'empty' | 'truncated' | 'error' | 'refused'; message: string | null };

const REFUSAL = "path outside the session's directories";

export function rowsOf({
  roots,
  listing,
  expanded,
  roles,
}: {
  roots: readonly FilesEntry[];
  listing: (path: string) => Listing | undefined;
  expanded: ReadonlySet<string>;
  roles: ReadonlyMap<string, RootRole>;
}): TreeRow[] {
  const rows: TreeRow[] = [];
  const children = (dir: string, depth: number, isRoot: boolean) => {
    const found = listing(dir);
    if (!found || found.status === 'loading') return;
    if (found.status === 'error') {
      const refused = found.message === REFUSAL;
      rows.push({ kind: 'notice', key: `${dir}\n!`, path: dir, depth, notice: refused ? 'refused' : 'error', message: found.message });
      return;
    }
    const shown = found.value.entries.filter((entry) => !hidden(entry, isRoot));
    if (shown.length === 0) rows.push({ kind: 'notice', key: `${dir}\n!`, path: dir, depth, notice: 'empty', message: null });
    for (const entry of shown) {
      const open = entry.kind === 'dir' && expanded.has(entry.path);
      rows.push({ kind: 'entry', key: entry.path, path: entry.path, depth, entry, expanded: open });
      if (open) children(entry.path, depth + 1, false);
    }
    if (found.value.truncated) rows.push({ kind: 'notice', key: `${dir}\n…`, path: dir, depth, notice: 'truncated', message: null });
  };
  for (const root of roots) {
    const open = expanded.has(root.path);
    rows.push({ kind: 'root', key: `root\n${root.path}`, path: root.path, depth: 0, name: basename(root.path), role: roles.get(root.path) ?? null, expanded: open });
    if (open) children(root.path, 1, true);
  }
  return rows;
}
