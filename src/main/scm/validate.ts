// What a local mutation may act on (E6 execution document, Design §3): the renderer's paths checked against a fresh
// `git status`, never their spelling alone. Only an entry git itself lists, in the state the command needs, passes; a
// path that is empty, absolute, holds a NUL or a newline, or climbs with `..` is refused before any lookup. Pure: the
// service reads the status and builds the argv.
import type { GitFileStatus, GitStatus } from '@shared/ipc/schema/git';
import type { ScmDiscardInput, ScmRefusal, ScmRefusalCode } from '@shared/ipc/schema/scm';

// Every command but `scm.status` runs only in a checkout the engine trusts (service.ts, plans.ts).
export const UNTRUSTED_DETAIL = 'MAWS runs git here only after you trust the folder in a session';

export const refusal = (refused: ScmRefusalCode, detail: string, output = ''): ScmRefusal => ({ refused, detail, output });

// Why a path cannot name an entry of the checkout, or null.
export function pathProblem(path: string): string | null {
  if (path === '') return 'an empty path';
  if (path.startsWith('/')) return 'an absolute path';
  if (path.includes('\0') || path.includes('\n')) return 'a path holding a NUL or a newline';
  if (path.split('/').includes('..')) return 'a path climbing out with ..';
  return null;
}

// A conflict: porcelain v2 writes `U`, `AA` and `DD` only for unmerged (`u`) records, so these codes are exact.
export function isUnmerged(file: GitFileStatus): boolean {
  const { index, worktree } = file;
  return index === 'U' || worktree === 'U' || (index === 'A' && worktree === 'A') || (index === 'D' && worktree === 'D');
}

const hasStaged = (file: GitFileStatus) => !file.untracked && !isUnmerged(file) && file.index !== '.';
const unique = (paths: string[]) => [...new Set(paths)];
const changed = (path: string, what: string) =>
  refusal('changed', `${JSON.stringify(path)} is not ${what} in the checkout's status now; the list moved since it was shown`);

// Each path once, refused at the first that is unsafe or that `accept` does not take from the status.
function resolve<T>(paths: readonly string[], accept: (path: string) => T | ScmRefusal): T[] | ScmRefusal {
  const out: T[] = [];
  for (const path of unique([...paths])) {
    const problem = pathProblem(path);
    if (problem !== null) return refusal('changed', `${JSON.stringify(path)} is ${problem}, not an entry of the checkout`);
    const accepted = accept(path);
    if (isRefusal(accepted)) return accepted;
    out.push(accepted);
  }
  return out;
}

export function isRefusal(value: unknown): value is ScmRefusal {
  return typeof value === 'object' && value !== null && 'refused' in value;
}

// `add`: an entry with something to stage (a worktree change, untracked, or a conflict, which `add` marks resolved). An
// untracked directory entry (`udir/`) stages its contents and loses its slash.
export function stageTargets(status: GitStatus, paths: readonly string[]): { paths: string[] } | ScmRefusal {
  const resolved = resolve(paths, (path) => {
    const entry = status.files.find((file) => file.path === path && (file.untracked || isUnmerged(file) || file.worktree !== '.'));
    if (entry === undefined) return changed(path, 'listed with a change to stage');
    return entry.untracked && path.endsWith('/') ? path.slice(0, -1) : path;
  });
  return isRefusal(resolved) ? resolved : { paths: unique(resolved) };
}

// `restore --staged` (or `rm --cached` without a HEAD): an entry with a staged change, named by its path or, for a rename,
// by either name; a rename passes both so the source comes back to the index too.
export function unstageTargets(status: GitStatus, paths: readonly string[]): { paths: string[] } | ScmRefusal {
  const resolved = resolve(paths, (path) => {
    const entry = status.files.find((file) => !file.untracked && (file.path === path || file.oldPath === path));
    if (entry !== undefined && isUnmerged(entry)) return refusal('unmerged', `${JSON.stringify(path)} has a merge conflict; resolve it and stage it instead`);
    if (entry === undefined || !hasStaged(entry)) return changed(path, 'listed with a staged change');
    return entry.oldPath === null ? [entry.path] : [entry.path, entry.oldPath];
  });
  return isRefusal(resolved) ? resolved : { paths: unique(resolved.flat()) };
}

// Unstaged entries go back to the index's content (`restore --worktree`); untracked ones are deleted (`clean`), a
// directory entry keeping its slash. A conflict is never discarded from here.
export function discardTargets(status: GitStatus, entries: ScmDiscardInput['entries']): { restore: string[]; clean: string[] } | ScmRefusal {
  const restore: string[] = [];
  const clean: string[] = [];
  for (const { path, group } of entries) {
    const resolved = resolve([path], (p) => {
      if (group === 'untracked') {
        return status.files.some((file) => file.untracked && file.path === p) ? p : changed(p, 'listed as untracked');
      }
      const entry = status.files.find((file) => !file.untracked && file.path === p);
      if (entry !== undefined && isUnmerged(entry)) return refusal('unmerged', `${JSON.stringify(p)} has a merge conflict; resolve it in the file or a terminal`);
      return entry !== undefined && entry.worktree !== '.' ? p : changed(p, 'listed with an unstaged change');
    });
    if (isRefusal(resolved)) return resolved;
    (group === 'untracked' ? clean : restore).push(...resolved);
  }
  return { restore: unique(restore), clean: unique(clean) };
}

// A commit needs a resolved index with something staged, and a message that is not blank.
export function commitRefusal(status: GitStatus, message: string): ScmRefusal | null {
  const conflicts = status.files.filter(isUnmerged);
  if (conflicts.length > 0) return refusal('unmerged', `Resolve ${conflicts.length === 1 ? 'the conflict' : `${conflicts.length} conflicts`} before committing`);
  if (!status.files.some(hasStaged)) return refusal('nothing_staged', 'Nothing is staged to commit');
  if (message.trim() === '') return refusal('empty_message', 'The commit message is empty');
  return null;
}
