// The Source control tool's four lists (E6 execution document, Design §5), derived purely from C4's status: Conflicts,
// Staged, Unstaged and Untracked, each entry with the change its side of git's XY field names. Porcelain v2 writes `U`,
// `AA` and `DD` only for `u` (unmerged) records and never for `1` records, so the conflict codes are read from
// `index`/`worktree` without a field of their own. A file changed in the index and again in the working tree (`MM`) is
// listed in Staged and in Unstaged, as git shows it. No I/O and no React here.
import type { GitFileStatus, GitStatus } from '@shared/ipc/schema/git';

export type ScmGroupName = 'conflicts' | 'staged' | 'unstaged' | 'untracked';
export const SCM_GROUPS: readonly ScmGroupName[] = ['conflicts', 'staged', 'unstaged', 'untracked']; // as the body shows them

export type ScmChange =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'type-changed'
  | 'untracked'
  | 'both-modified'
  | 'both-added'
  | 'both-deleted'
  | 'added-by-one-side'
  | 'deleted-by-one-side';

export interface ScmEntry {
  path: string; // repository-relative, as git lists it (an untracked directory keeps its trailing slash)
  oldPath: string | null; // a rename's or copy's source, on the side that renamed it
  change: ScmChange;
}

export type ScmGroups = Readonly<Record<ScmGroupName, readonly ScmEntry[]>>;
export interface ScmSelection {
  group: ScmGroupName;
  path: string;
}

export function unmerged(file: GitFileStatus): boolean {
  return file.index === 'U' || file.worktree === 'U' || (file.index === 'A' && file.worktree === 'A') || (file.index === 'D' && file.worktree === 'D');
}

const SIDE_CHANGES: Record<string, ScmChange> = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', T: 'type-changed' };

function sideEntry(file: GitFileStatus, code: string): ScmEntry {
  const change = SIDE_CHANGES[code] ?? 'modified';
  return { path: file.path, oldPath: change === 'renamed' || change === 'copied' ? file.oldPath : null, change };
}

function conflictChange({ index, worktree }: GitFileStatus): ScmChange {
  if (index === 'U' && worktree === 'U') return 'both-modified';
  if (index === 'A' && worktree === 'A') return 'both-added';
  if (index === 'D' && worktree === 'D') return 'both-deleted';
  return index === 'A' || worktree === 'A' ? 'added-by-one-side' : 'deleted-by-one-side'; // AU/UA, DU/UD
}

export function groupsOf(status: GitStatus | null): ScmGroups {
  const groups: Record<ScmGroupName, ScmEntry[]> = { conflicts: [], staged: [], unstaged: [], untracked: [] };
  for (const file of status?.files ?? []) {
    if (file.untracked) groups.untracked.push({ path: file.path, oldPath: null, change: 'untracked' });
    else if (unmerged(file)) groups.conflicts.push({ path: file.path, oldPath: null, change: conflictChange(file) });
    else {
      if (file.index !== '.') groups.staged.push(sideEntry(file, file.index));
      if (file.worktree !== '.') groups.unstaged.push(sideEntry(file, file.worktree));
    }
  }
  return groups;
}

// Where a listed path lives on disk: under git's own spelling of the repository's root.
export const checkoutPath = (repoRoot: string, path: string) => `${repoRoot.replace(/\/+$/, '')}/${path}`;

export function isListed(groups: ScmGroups, selection: ScmSelection): boolean {
  return groups[selection.group].some((entry) => entry.path === selection.path);
}

// Where an open() target, or a selection whose group no longer lists it, is shown: Staged first (what the next commit
// takes), then the body's order.
const TARGET_ORDER: readonly ScmGroupName[] = ['staged', 'conflicts', 'unstaged', 'untracked'];
export function findTarget(groups: ScmGroups, path: string): ScmSelection | null {
  const group = TARGET_ORDER.find((name) => groups[name].some((entry) => entry.path === path));
  return group ? { group, path } : null;
}
