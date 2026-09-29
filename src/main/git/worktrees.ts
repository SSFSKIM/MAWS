// The worktree service (C10 execution document, Interfaces "Worktrees" and M2; charter §4.5): every git mutation MAWS
// makes, beside C4's read-only service and through C4's runner (`/usr/bin/git` or MAWS_GIT, the fixed environment, the
// 10 s timeout). Worktrees are created where the engine's `EnterWorktree` puts its own (`<repoRoot>/.claude/worktrees/
// <name>`, SPEC §47 11.1), and the cleanup ladder's destructive steps (`remove`, `deleteBranch`) re-read git before
// acting and answer a refusal when what the caller saw is no longer true. Which process is in a worktree comes from
// holder authority (a fresh registry read and C3's process table), never the index's projection. No network, no `gc`,
// no write to `info/exclude` (the engine appends its own block there).
//
// Every command takes a repository root and normalises it to the main worktree's root (a linked worktree's path works
// too); every path is matched against `git worktree list` as an NFC realpath on both sides.
import { lstat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { ipcError } from '@shared/ipc/errors';
import type {
  GitBranchDeleted,
  GitWorktreeAddInput,
  GitWorktreeDeleteBranchInput,
  GitWorktreeList,
  GitWorktreeRemoved,
  GitWorktreeRemoveInput,
} from '@shared/ipc/schema/git';
import { validateWorktreeName, worktreeDirName, type BranchStatus, type WorktreeInfo, type WorktreeStatus } from '@shared/sessions/worktree';
import { CommandFailure, registerMainHandler } from '../ipc/router';
import { canonicalPath, occupancyOf, type HolderDeps } from '../sessions/holders';
import { parseStatus } from './porcelain';
import { GitCommandError, GitTimeoutError, type GitRun } from './runner';

export interface WorktreeServiceDeps {
  git: GitRun;
  holders: HolderDeps; // occupancy: C3's process table, C4's fresh registry read, the index's records
}

export class WorktreeService {
  constructor(private readonly deps: WorktreeServiceDeps) {}

  async list(repoRoot: string): Promise<GitWorktreeList> {
    const { root, commonDir } = await this.mainRoot(repoRoot);
    return { repoRoot: root, commonDir, worktrees: await this.entries(root) };
  }

  // null when git does not list the path (removed, or never a worktree). A listed entry whose directory is gone
  // (`prunable`) has nothing to inspect: no changes, and its occupancy is still asked, since a process can outlive it.
  async status(repoRoot: string, path: string): Promise<WorktreeStatus | null> {
    const { root } = await this.mainRoot(repoRoot);
    const entry = await this.find(root, path);
    if (entry === null) return null;
    const [dirty, occupancy] = await Promise.all([
      entry.prunable ? { tracked: 0, untracked: 0 } : this.changes(entry.path),
      occupancyOf(this.deps.holders, entry.path),
    ]);
    const busy = processes(occupancy) > 0 || entry.locked;
    return { ...entry, dirty, occupancy, state: busy ? 'busy' : dirty.tracked + dirty.untracked > 0 ? 'dirty' : 'clean' };
  }

  // null when there is no such local branch. base: the main worktree's branch, else 'HEAD'; ahead: commits on the
  // branch that base does not have.
  async branch(repoRoot: string, branch: string): Promise<BranchStatus | null> {
    const { root } = await this.mainRoot(repoRoot);
    const head = await this.resolve(root, `refs/heads/${branch}`);
    if (head === null) return null;
    const [entries, base] = await Promise.all([this.entries(root), this.baseOf(root)]);
    const baseRev = base === 'HEAD' ? 'HEAD' : `refs/heads/${base}`;
    const ahead = Number((await this.git(root, ['rev-list', '--count', `${baseRev}..refs/heads/${branch}`, '--'])).trim());
    const checkedOutAt = entries.find((e) => e.branch === branch)?.path ?? null;
    return { repoRoot: root, branch, head, checkedOutAt, base, ahead, merged: ahead === 0 };
  }

  // Every refusal is decided before anything is created. `-b`, never the engine's `-B`: a branch the owner has is
  // never reset; `--no-track`: the base never becomes the new branch's upstream.
  async add({ repoRoot, name, branch }: GitWorktreeAddInput): Promise<WorktreeInfo> {
    const invalid = validateWorktreeName(name);
    if (invalid !== null) throw new Error(invalid);
    const { root } = await this.mainRoot(repoRoot);
    if ((await this.resolve(root, 'HEAD')) === null) throw new Error('repository has no commits');
    const path = join(root, '.claude', 'worktrees', worktreeDirName(name));
    const entries = await this.entries(root);
    if ((await exists(path)) || entries.some((e) => e.path === path)) throw new Error('worktree path exists');
    await this.requireBranchName(root, branch.name);
    const existing = await this.resolve(root, `refs/heads/${branch.name}`);
    if (branch.kind === 'new') {
      if (existing !== null) throw new Error('branch exists');
      const base = branch.base;
      if (base === '' || base.startsWith('-') || (await this.resolve(root, `${base}^{commit}`)) === null) throw new Error(`base not found: ${base}`);
      await this.git(root, ['worktree', 'add', '--no-track', '-b', branch.name, path, base]);
    } else {
      if (existing === null) throw new Error('branch missing');
      const holder = entries.find((e) => e.branch === branch.name);
      if (holder) throw new Error(`branch checked out at ${holder.path}`);
      await this.git(root, ['worktree', 'add', path, branch.name]);
    }
    const created = await this.find(root, path);
    if (created === null) throw new Error(`git worktree add did not list ${path}`);
    return created;
  }

  // The checkout, revalidated against the identity the caller captured. `--force` only with the acknowledged discard;
  // a locked worktree is refused rather than forced twice. A directory already gone is only pruned.
  async remove({ repoRoot, path, expect, discard }: GitWorktreeRemoveInput): Promise<GitWorktreeRemoved> {
    const status = await this.status(repoRoot, path);
    if (status === null) return { refused: 'missing', detail: `${path} is not a worktree of this repository` };
    if (status.isMain) throw new Error('the main worktree cannot be removed');
    if (status.branch !== expect.branch || status.head !== expect.head) {
      return { refused: 'changed', detail: `expected ${identity(expect)}, git shows ${identity(status)}` };
    }
    const live = processes(status.occupancy);
    if (live > 0) return { refused: 'busy', detail: `${live} ${live === 1 ? 'session' : 'sessions'} live here` };
    if (status.locked) return { refused: 'locked', detail: `${status.path} is locked (git worktree lock)` };
    const changes = status.dirty.tracked + status.dirty.untracked;
    if (changes > 0 && !discard) return { refused: 'dirty', detail: `${changes} uncommitted ${changes === 1 ? 'change' : 'changes'}` };
    if (!status.prunable) await this.git(status.repoRoot, ['worktree', 'remove', ...(discard ? ['--force'] : []), status.path]);
    await this.git(status.repoRoot, ['worktree', 'prune']);
    return { removed: true, prunedOnly: status.prunable };
  }

  // The branch, revalidated against the head the caller captured; an unmerged branch needs the acknowledgement.
  async deleteBranch({ repoRoot, branch, expect, acknowledgeUnmerged }: GitWorktreeDeleteBranchInput): Promise<GitBranchDeleted> {
    const status = await this.branch(repoRoot, branch);
    if (status === null) return { refused: 'missing', detail: `no branch ${branch}` };
    if (status.head !== expect.head) return { refused: 'changed', detail: `expected ${branch} at ${short(expect.head)}, git shows ${short(status.head)}` };
    if (status.checkedOutAt !== null) return { refused: 'checked_out', detail: `checked out at ${status.checkedOutAt}` };
    if (!status.merged && !acknowledgeUnmerged) {
      return { refused: 'unmerged', detail: `${status.ahead} ${status.ahead === 1 ? 'commit' : 'commits'} not on ${status.base}` };
    }
    await this.git(status.repoRoot, ['branch', '-D', '--', branch]);
    return { deleted: true, wasMerged: status.merged };
  }

  // The main worktree's root: the parent of the common dir when that is a `.git` directory (linked worktrees share
  // it), else the toplevel (a submodule's `.git/modules/<name>`), as the trust key is derived (src/main/sessions/trust.ts).
  private async mainRoot(repoRoot: string): Promise<{ root: string; commonDir: string }> {
    requireAbsolute(repoRoot);
    const out = await this.git(repoRoot, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir']);
    const [toplevel, commonDir] = out.split('\n').map((line) => line.trim());
    if (!toplevel || !commonDir) throw new Error(`git rev-parse answered no toplevel and common dir for ${repoRoot}`);
    const root = basename(commonDir) === '.git' ? dirname(commonDir) : toplevel;
    return { root: await canonicalPath(root), commonDir: await canonicalPath(commonDir) };
  }

  // `worktree list --porcelain -z`: NUL-terminated attribute lines, an empty one between stanzas; the first is the main
  // worktree. The branch is what git says, never derived from the directory's name.
  private async entries(root: string): Promise<WorktreeInfo[]> {
    const out = await this.git(root, ['worktree', 'list', '--porcelain', '-z']);
    const stanzas: Map<string, string>[] = [];
    let current: Map<string, string> | null = null;
    for (const line of out.split('\0')) {
      if (line === '') {
        current = null;
        continue;
      }
      if (current === null) stanzas.push((current = new Map()));
      const space = line.indexOf(' ');
      current.set(space === -1 ? line : line.slice(0, space), space === -1 ? '' : line.slice(space + 1));
    }
    const managedPrefix = join(root, '.claude', 'worktrees') + '/';
    return Promise.all(
      stanzas.map(async (stanza, i) => {
        const path = await canonicalPath(stanza.get('worktree') ?? '');
        const ref = stanza.get('branch');
        return {
          repoRoot: root,
          path,
          branch: ref === undefined ? null : ref.replace(/^refs\/heads\//, ''),
          head: stanza.get('HEAD') ?? '',
          isMain: i === 0,
          locked: stanza.has('locked'),
          prunable: stanza.has('prunable'),
          managed: path.startsWith(managedPrefix),
        };
      }),
    );
  }

  private async find(root: string, path: string): Promise<WorktreeInfo | null> {
    requireAbsolute(path);
    const target = await canonicalPath(path);
    return (await this.entries(root)).find((e) => e.path === target) ?? null;
  }

  // The engine's own cleanliness probe (SPEC §23 3.2): tracked changes and untracked files, ignored files excluded,
  // a submodule's own dirt ignored.
  private async changes(path: string): Promise<WorktreeStatus['dirty']> {
    const { files } = parseStatus(await this.git(path, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal', '--ignore-submodules=dirty']));
    const untracked = files.filter((f) => f.untracked).length;
    return { tracked: files.length - untracked, untracked };
  }

  private async baseOf(root: string): Promise<string> {
    try {
      return (await this.git(root, ['symbolic-ref', '--short', '-q', 'HEAD'])).trim() || 'HEAD';
    } catch (error) {
      if (error instanceof GitCommandError) return 'HEAD'; // the main worktree is on a detached HEAD
      throw error;
    }
  }

  // The full object name `rev` names, or null when git cannot resolve it.
  private async resolve(root: string, rev: string): Promise<string | null> {
    try {
      return (await this.git(root, ['rev-parse', '--verify', '--quiet', rev])).trim() || null;
    } catch (error) {
      if (error instanceof GitCommandError) return null;
      throw error;
    }
  }

  private async requireBranchName(root: string, name: string): Promise<void> {
    try {
      await this.git(root, ['check-ref-format', '--branch', name]);
    } catch (error) {
      if (error instanceof GitCommandError) throw new Error(`invalid branch name: ${name}`, { cause: error });
      throw error;
    }
  }

  private git(directory: string, args: string[]): Promise<string> {
    return this.deps.git(directory, args);
  }
}

// Main's handlers for `git.worktree.*`: a git call killed at its 10 s timeout answers `timeout`, as C4's `git.*` do;
// a refusal decided before acting is `internal` with its named message (`worktree path exists`, `base not found: …`).
export function registerWorktreeHandlers(service: WorktreeService): void {
  registerMainHandler('git.worktree.list', ({ repoRoot }) => relay(() => service.list(repoRoot)));
  registerMainHandler('git.worktree.status', ({ repoRoot, path }) => relay(() => service.status(repoRoot, path)));
  registerMainHandler('git.worktree.branch', ({ repoRoot, branch }) => relay(() => service.branch(repoRoot, branch)));
  registerMainHandler('git.worktree.add', (input) => relay(() => service.add(input)));
  registerMainHandler('git.worktree.remove', (input) => relay(() => service.remove(input)));
  registerMainHandler('git.worktree.deleteBranch', (input) => relay(() => service.deleteBranch(input)));
}

async function relay<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof GitTimeoutError) throw new CommandFailure(ipcError('timeout', error.message));
    throw error;
  }
}

function processes(o: WorktreeStatus['occupancy']): number {
  return o.self + o.foreign + o.unbound;
}

function identity(w: { branch: string | null; head: string }): string {
  return `${w.branch ?? 'detached HEAD'} at ${short(w.head)}`;
}

function short(head: string): string {
  return head.slice(0, 12);
}

function requireAbsolute(path: string): void {
  if (!isAbsolute(path)) throw new Error(`path must be absolute: ${path}`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}
