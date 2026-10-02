// The worktree service (C10 execution document, Interfaces "Worktrees" and M2; charter §4.5): every git mutation MAWS
// makes, beside C4's read-only service and through C4's runner (`/usr/bin/git` or MAWS_GIT, the fixed environment, the
// 10 s timeout). Worktrees are created where the engine's `EnterWorktree` puts its own (`<repoRoot>/.claude/worktrees/
// <name>`, SPEC §47 11.1), and the cleanup ladder's destructive steps (`remove`, `deleteBranch`) re-read git before
// acting and answer a refusal when what the caller saw is no longer true. Which process is in a worktree comes from
// holder authority (a fresh registry read and C3's process table), never the index's projection. No network, no `gc`,
// no write to `info/exclude` but the engine's own runtime block, once (C12).
//
// Every command takes a repository root and normalises it to the main worktree's root (a linked worktree's path works
// too); every path is matched against `git worktree list` as an NFC realpath on both sides.
import { lstat } from 'node:fs/promises';
// C12 start
import { appendFile, mkdir, readFile } from 'node:fs/promises';
// C12 end
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import type {
  GitBranchDeleted,
  GitWorktreeAddInput,
  GitWorktreeDeleteBranchInput,
  GitWorktreeList,
  GitWorktreeRemoved,
  GitWorktreeRemoveInput,
} from '@shared/ipc/schema/git';
import { validateWorktreeName, worktreeDirName, type BranchStatus, type WorktreeInfo, type WorktreeStatus } from '@shared/sessions/worktree';
import { canonicalPath, occupancyOf, type HolderDeps } from '../sessions/holders';
import { parseStatus } from './porcelain';
import { GitCommandError, type GitRun } from './runner';

export interface WorktreeServiceDeps {
  git: GitRun;
  holders: HolderDeps; // occupancy: C3's process table, C4's fresh registry read, the index's records
}

// `add` failed in or after git's own `worktree add`, which may have created something (a caller reads git back); every
// other `add` failure is a refusal decided before anything was created. `cause` is the runner's error (a timeout included).
export class WorktreeAddFailed extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WorktreeAddFailed';
  }
}

// C12 start: the engine's runtime-exclude block (2.1.283, `ensureClaudeRuntimeFilesExcluded`, cli.pretty.js 337187-337211),
// written the way the engine writes it: appended once to the common dir's `info/exclude` unless the file already holds
// the marker, after a newline when the file does not end in one. `**/.claude/worktrees/` is in it, so a worktree MAWS
// makes leaves the main checkout clean as one the engine makes does (the architect's ruling at C12 M5). MAWS never
// removes it, and a write that fails leaves the created worktree alone: it only costs the main checkout its clean read.
export const RUNTIME_EXCLUDE_MARKER = '# claude-code-runtime';
const RUNTIME_EXCLUDE_PATTERNS = [
  '**/.claude/scheduled_tasks.lock', '**/.claude/scheduled_tasks.json', '**/.claude/routines/.state/', '**/.claude/worktrees/', '**/.claude/checkpoints/',
  '**/.claude/mailbox/', '**/.claude/agent-registry.json', '**/.claude/agent-memory-local', '**/.claude/first-run', '**/.claude/assistant-daemon-state.json',
];
export const RUNTIME_EXCLUDE_BLOCK = [RUNTIME_EXCLUDE_MARKER, ...RUNTIME_EXCLUDE_PATTERNS, ''].join('\n');

export interface ExcludeFs {
  readFile(file: string, encoding: 'utf8'): Promise<string>;
  appendFile(file: string, data: string): Promise<void>;
  mkdir(dir: string, opts: { recursive: true }): Promise<unknown>;
}
const NODE_FS: ExcludeFs = { readFile, appendFile, mkdir };

// One write at a time per common dir (the service's `mainRoot` canonicalises it), so two creations in one repository
// never both find no marker and append two blocks (re-review of f0ea3676): each read, check and append runs after the
// previous one for that directory settled. The chain entry is dropped once it is the last.
const excludeChains = new Map<string, Promise<void>>();
// Debt wave 6: the nearest ancestor of `path` whose `.git` is a pointer file to `commonDir` (canonical), else null.
async function checkoutAbove(path: string, commonDir: string): Promise<string | null> {
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    const pointer = await readFile(join(dir, '.git'), 'utf8').catch(() => null); // absent, or a `.git` directory
    const target = pointer?.match(/^gitdir:\s*(.+?)\s*$/m)?.[1];
    if (target !== undefined && (await canonicalPath(resolve(dir, target))) === commonDir) return dir;
    if (dirname(dir) === dir) return null;
  }
}

export function ensureRuntimeExclude(commonDir: string, fs: ExcludeFs = NODE_FS): Promise<void> {
  const next = (excludeChains.get(commonDir) ?? Promise.resolve()).then(() => writeRuntimeExclude(commonDir, fs));
  excludeChains.set(commonDir, next);
  void next.then(() => {
    if (excludeChains.get(commonDir) === next) excludeChains.delete(commonDir);
  });
  return next;
}

// Never rejects: a failure is logged and leaves the created worktree alone.
async function writeRuntimeExclude(commonDir: string, fs: ExcludeFs): Promise<void> {
  const file = join(commonDir, 'info', 'exclude');
  try {
    let text = '';
    try {
      text = await fs.readFile(file, 'utf8');
      if (text.includes(RUNTIME_EXCLUDE_MARKER)) return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await fs.mkdir(join(commonDir, 'info'), { recursive: true });
    }
    await fs.appendFile(file, (text !== '' && !text.endsWith('\n') ? '\n' : '') + RUNTIME_EXCLUDE_BLOCK);
  } catch (error) {
    console.warn(`[worktrees] the runtime exclude block was not written to ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
// C12 end

// A repository as the service resolves it: the main worktree's root, the common dir, and whether the root is known to
// be the main checkout (see `mainRoot`).
interface Repo {
  root: string;
  commonDir: string;
  isMain: boolean;
}

export class WorktreeService {
  constructor(private readonly deps: WorktreeServiceDeps) {}

  async list(repoRoot: string): Promise<GitWorktreeList> {
    const repo = await this.mainRoot(repoRoot);
    return { repoRoot: repo.root, commonDir: repo.commonDir, worktrees: await this.entries(repo) };
  }

  // null when git does not list the path (removed, or never a worktree). A listed entry whose directory is gone
  // (`prunable`) has nothing to inspect: no changes, and its occupancy is still asked, since a process can outlive it.
  async status(repoRoot: string, path: string): Promise<WorktreeStatus | null> {
    const repo = await this.mainRoot(repoRoot);
    requireAbsolute(path);
    const target = await canonicalPath(path);
    const entries = await this.entries(repo);
    const entry = entries.find((e) => e.path === target);
    if (entry === undefined) return null;
    // a worktree inside this one (the main checkout holds `.claude/worktrees/*`) answers for its own processes
    const nested = entries.filter((e) => e.path.startsWith(`${entry.path}/`)).map((e) => e.path);
    const [dirty, occupancy] = await Promise.all([
      entry.prunable ? { tracked: 0, untracked: 0 } : this.changes(entry.path),
      occupancyOf(this.deps.holders, entry.path, { nested }),
    ]);
    const busy = processes(occupancy) > 0 || entry.locked;
    return { ...entry, dirty, occupancy, state: busy ? 'busy' : dirty.tracked + dirty.untracked > 0 ? 'dirty' : 'clean' };
  }

  // null when there is no such local branch. base: the main worktree's branch, else 'HEAD'; ahead: commits on the
  // branch that base does not have.
  async branch(repoRoot: string, branch: string): Promise<BranchStatus | null> {
    const repo = await this.mainRoot(repoRoot);
    const { root } = repo;
    const head = await this.branchHead(root, branch);
    if (head === null) return null;
    const [entries, base] = await Promise.all([this.entries(repo), this.baseOf(root)]);
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
    const repo = await this.mainRoot(repoRoot);
    const { root, commonDir } = repo; // C12: commonDir, for the runtime exclude block
    if ((await this.resolve(root, 'HEAD')) === null) throw new Error('repository has no commits');
    const path = join(root, '.claude', 'worktrees', worktreeDirName(name));
    const entries = await this.entries(repo);
    if ((await exists(path)) || entries.some((e) => e.path === path)) throw new Error('worktree path exists');
    await this.requireBranchName(root, branch.name);
    const existing = await this.branchHead(root, branch.name);
    if (branch.kind === 'new') {
      if (existing !== null) throw new Error('branch exists');
      const base = branch.base;
      if (base === '' || base.startsWith('-') || (await this.resolve(root, `${base}^{commit}`)) === null) throw new Error(`base not found: ${base}`);
      await this.invokeAdd(root, ['worktree', 'add', '--no-track', '-b', branch.name, path, base]);
    } else {
      if (existing === null) throw new Error('branch missing');
      const holder = entries.find((e) => e.branch === branch.name);
      if (holder) throw new Error(`branch checked out at ${holder.path}`);
      await this.invokeAdd(root, ['worktree', 'add', path, branch.name]);
    }
    const created = await this.find(repo, path);
    if (created === null) throw new WorktreeAddFailed(`git worktree add did not list ${path}`);
    await ensureRuntimeExclude(commonDir); // C12
    return created;
  }

  // git's own `worktree add`: a failure here may have left the branch (created before the checkout) or the checkout (a
  // failing post-checkout hook), so it is told apart from the refusals above, which create nothing.
  private async invokeAdd(root: string, args: string[]): Promise<void> {
    try {
      await this.git(root, args);
    } catch (error) {
      throw new WorktreeAddFailed(error instanceof Error ? error.message : String(error), { cause: error });
    }
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
    let output: string;
    try {
      // Git checks worktree occupancy again at deletion and removes branch.<name> config. Without acknowledgement,
      // -d also refuses a newly unmerged tip; update-ref CAS has neither of these branch-deletion semantics.
      output = await this.git(status.repoRoot, ['branch', acknowledgeUnmerged ? '-D' : '-d', '--', branch]);
    } catch (error) {
      if (error instanceof GitCommandError) {
        if (/checked out at|used by worktree at/.test(error.stderr)) return { refused: 'checked_out', detail: error.stderr.trim() };
        if (/not fully merged/.test(error.stderr)) return { refused: 'unmerged', detail: error.stderr.trim() };
        if (/cannot lock ref|not found/.test(error.stderr)) return { refused: 'changed', detail: error.stderr.trim() };
      }
      throw error;
    }
    // A moved tip can still pass -d when it is merged, so verify the actual deletion in both acknowledgement states.
    const deletedHead = await this.deletedHead(status.repoRoot, branch, output);
    if (deletedHead === null) {
      return {
        refused: 'changed',
        detail: `Git reported deleting ${branch}, but its deleted commit could not be identified unambiguously; the branch was not recreated and branch config may have been dropped. Git said:\n${output.trim()}`,
      };
    }
    if (deletedHead !== expect.head) {
      const movement = `expected ${branch} at ${short(expect.head)}, but Git deleted ${deletedHead} after the branch moved`;
      try {
        // No -f: a branch created concurrently must never be overwritten. No auto-configured upstream, either.
        await this.git(status.repoRoot, ['branch', '--no-track', '--', branch, deletedHead]);
      } catch (error) {
        return { refused: 'changed', detail: `${movement}; could not recreate the branch: ${error instanceof Error ? error.message : String(error)}. Branch config was dropped by deletion.` };
      }
      return { refused: 'changed', detail: `${movement}; recreated the branch at that commit. Branch config was dropped by deletion.` };
    }
    return { deleted: true, wasMerged: status.merged };
  }

  // Deletion reports an object-ID abbreviation, not revision syntax: a hex-looking branch/tag cannot redirect it.
  // Reject ambiguity even if only one of the matching objects is a commit; never guess what Git deleted.
  private async deletedHead(root: string, branch: string, output: string): Promise<string | null> {
    const match = output.trim().match(/^Deleted branch (.+) \(was ([0-9a-f]{4,64})\)\.$/);
    if (match === null || match[1] !== branch) return null;
    try {
      const candidates = (await this.git(root, ['rev-parse', `--disambiguate=${match[2]}`])).trim().split('\n');
      const oid = candidates[0];
      if (candidates.length !== 1 || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid)) return null;
      return (await this.resolve(root, `${oid}^{commit}`)) === oid ? oid : null;
    } catch (error) {
      if (error instanceof GitCommandError) return null;
      throw error;
    }
  }

  // The main worktree's root: the parent of the common dir when that is a `.git` directory (linked worktrees share
  // it), else the toplevel (a submodule's `.git/modules/<name>`, a separate git dir). `isMain`: the root is the main
  // checkout, known because the common dir is its `.git` or because the git dir asked from it is the common dir itself
  // (not a linked worktree's `worktrees/<name>`). Asked from a linked worktree of a separate-git-dir repository, where
  // git records no path from the common dir to the main checkout, the root is the nearest ancestor whose own `.git`
  // pointer names the common dir (the engine's layout and MAWS's put worktrees under the checkout's
  // `.claude/worktrees/`); a linked worktree outside its main checkout leaves no trace of it and is its own root (git's
  // limit). The trust key follows the engine's rule instead (src/main/sessions/trust.ts).
  private async mainRoot(repoRoot: string): Promise<Repo> {
    requireAbsolute(repoRoot);
    const out = await this.git(repoRoot, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir', '--git-dir']);
    const [toplevel, commonDir, gitDir] = out.split('\n').map((line) => line.trim());
    if (!toplevel || !commonDir || !gitDir) throw new Error(`git rev-parse answered no toplevel, common dir and git dir for ${repoRoot}`);
    const [common, git, top] = await Promise.all([canonicalPath(commonDir), canonicalPath(gitDir), canonicalPath(toplevel)]);
    if (basename(commonDir) === '.git') return { root: await canonicalPath(dirname(commonDir)), commonDir: common, isMain: true };
    if (git === common) return { root: top, commonDir: common, isMain: true };
    const checkout = await checkoutAbove(top, common);
    return { root: checkout ?? top, commonDir: common, isMain: checkout !== null };
  }

  // `worktree list --porcelain -z`: NUL-terminated attribute lines, an empty one between stanzas; the first is the main
  // worktree. The branch is what git says, never derived from the directory's name. When the git dir is separate from
  // the checkout (`git init --separate-git-dir`), git lists the main worktree at the git dir itself, having no pointer
  // back to the checkout; that entry is the root when the root is known to be the main checkout.
  private async entries(repo: Repo): Promise<WorktreeInfo[]> {
    const { root } = repo;
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
        const listed = await canonicalPath(stanza.get('worktree') ?? '');
        const path = i === 0 && repo.isMain && !stanza.has('bare') && listed === repo.commonDir ? root : listed;
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

  private async find(repo: Repo, path: string): Promise<WorktreeInfo | null> {
    requireAbsolute(path);
    const target = await canonicalPath(path);
    return (await this.entries(repo)).find((e) => e.path === target) ?? null;
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

  // The head of the local branch named exactly `name`, or null. `show-ref --verify` looks the full ref up as a ref,
  // never as revision syntax: `rev-parse --verify refs/heads/main~1` would answer main's parent for a branch that does
  // not exist.
  private async branchHead(root: string, name: string): Promise<string | null> {
    try {
      return (await this.git(root, ['show-ref', '--verify', '--hash', `refs/heads/${name}`])).trim() || null;
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
