// Main's read-only git service (C4 execution document, Interfaces "Git service" and M6; charter §4.5): status,
// branches, diff and log for any directory inside a repository or linked worktree, and the ref-counted repository
// watcher. Only these subcommands ever run: `rev-parse`, `status`, `stash list`, `remote get-url`, `config --get-regexp`
// (remote URLs only), `for-each-ref`, `diff`, `log`. Nothing stages, commits, stashes, checks out, fetches, or adds or removes a worktree (C10 and P1 own
// mutation; E6's `refresh` only asks the watcher to read again); worktrees under `<repo>/.claude/worktrees/` need no special case, `rev-parse` reports them as linked.
// Paths in answers are relative to the repository root, and a `path` argument is read the same way.
import { stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { GitBranches, GitChanged, GitDiff, GitDiffFile, GitDiffInput, GitLog, GitLogInput, GitStatus } from '@shared/ipc/schema/git';
import { parseBranches, parseLog, parseNumstat, parseRevParse, parseStatus, upstreamRemote } from './porcelain';
import { createGitRunner, GitCommandError, GitTimeoutError, type ExecFileFn, type GitRun } from './runner';
import { GitWatcher, type WatchFn, type WatchOwner } from './watcher';

export interface GitServiceOptions {
  emit?: (change: GitChanged) => void; // `git.changed`; main passes the router's emit
  env?: NodeJS.ProcessEnv; // where PATH, HOME and MAWS_GIT are read; process.env by default
  execFile?: ExecFileFn;
  watch?: WatchFn;
}

export class GitService {
  private readonly run: GitRun;
  private readonly watcher: GitWatcher;

  constructor(options: GitServiceOptions = {}) {
    this.run = createGitRunner({ env: options.env, execFile: options.execFile });
    this.watcher = new GitWatcher({ status: (directory) => this.status(directory), emit: options.emit ?? (() => {}), watch: options.watch });
  }

  async status(directory: string): Promise<GitStatus> {
    requireAbsolute(directory);
    const { repoRoot, gitDir, commonDir } = parseRevParse(
      await this.run(directory, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir']),
    );
    const [porcelain, stashes] = await Promise.all([
      this.run(repoRoot, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal']),
      this.run(repoRoot, ['stash', 'list', '--format=%H']),
    ]);
    const { branch, head, upstream, ahead, behind, files } = parseStatus(porcelain);
    return {
      repoRoot,
      gitDir,
      commonDir,
      isWorktree: gitDir !== commonDir,
      branch,
      head,
      upstream,
      remoteUrl: await this.remoteUrl(repoRoot, upstream),
      ahead,
      behind,
      dirty: files.length > 0,
      files,
      stashCount: stashes.split('\n').filter((line) => line !== '').length,
      checkedAt: new Date().toISOString(),
    };
  }

  async branches(directory: string): Promise<GitBranches> {
    requireAbsolute(directory);
    return parseBranches(await this.run(directory, ['for-each-ref', '--format=%(refname:short)%00%(upstream:short)%00%(HEAD)', 'refs/heads']));
  }

  // `worktree`: the working tree against the index; `staged`: the index against HEAD; `all`: the working tree against
  // HEAD, or with a `base` the branch's own change since its merge base with `base` (`<base>...HEAD`); `untracked` (E6):
  // one untracked file as `git add` would stage it.
  async diff({ directory, scope, base, path, context }: GitDiffInput): Promise<GitDiff> {
    requireAbsolute(directory);
    if (base !== undefined) {
      if (base === '' || base.startsWith('-')) throw new Error(`invalid base: ${base}`); // never an option in a revision's place
      if (scope !== 'all') throw new Error("base applies to scope 'all' only");
    }
    if (scope === 'untracked') return this.untrackedDiff(directory, path, context);
    const range = base !== undefined ? [`${base}...HEAD`] : scope === 'staged' ? ['--cached'] : scope === 'all' ? ['HEAD'] : [];
    // `git diff` refreshes a stale stat cache and rewrites the index through `index.lock` whatever GIT_OPTIONAL_LOCKS
    // says (probed on Apple Git 2.50.1; `git status` honours it); `diff.autoRefreshIndex=false` turns that write off.
    const common = ['-c', 'diff.autoRefreshIndex=false', 'diff', '--no-relative', '--no-color', '--no-ext-diff', '--no-textconv'];
    const [patch, numstat] = await Promise.all([
      this.run(directory, [...common, `-U${context ?? 3}`, ...range, ...pathspec(path)]),
      this.run(directory, [...common, '--numstat', '-z', ...range, ...pathspec(path)]),
    ]);
    return { patch, files: parseNumstat(numstat) };
  }

  async log({ directory, limit, path }: GitLogInput): Promise<GitLog> {
    requireAbsolute(directory);
    try {
      const out = await this.run(directory, ['log', '--no-show-signature', '--format=%H%x00%h%x00%an%x00%aI%x00%s%x00%P', '-z', '-n', String(limit), ...pathspec(path)]);
      return { commits: parseLog(out) };
    } catch (error) {
      if (error instanceof GitCommandError && /does not have any commits yet/.test(error.stderr)) return { commits: [] };
      throw error;
    }
  }

  // Ref-counted per repository root and per owner (the requesting window); answers the directory's status.
  watch(directory: string, owner?: WatchOwner): Promise<GitStatus> {
    requireAbsolute(directory);
    return this.watcher.watch(directory, owner);
  }

  unwatch(directory: string, owner?: WatchOwner): void {
    this.watcher.unwatch(directory, owner);
  }

  // Every watch the owner still holds, as when its window closes or reloads.
  release(owner: WatchOwner): void {
    this.watcher.release(owner);
  }

  // E6: after a mutation, the watcher re-reads the directory's root now (no-op for a root nobody watches), so
  // `git.changed` reaches every surface within one status read and stays the one ordered publication path. The root is
  // git's own answer for the directory, the key the watcher holds it by (a subdirectory, a symlinked spelling). Best
  // effort: a failure here leaves the change to the watcher's own events.
  refresh(directory: string): void {
    requireAbsolute(directory);
    void this.run(directory, ['rev-parse', '--path-format=absolute', '--show-toplevel']).then(
      (out) => this.watcher.refreshNow(out.trim()),
      () => {},
    );
  }

  dispose(): void {
    this.watcher.dispose();
  }

  // An untracked file has no diff in the other scopes; this is what `git add` would stage, from the top level, with the
  // fresh status as the confinement: only a path it lists as an untracked file (exact, not a `dir/` entry) is read.
  // `--no-index` opens whatever path it is given, so a lexical check would read through an untracked symlinked
  // directory or name `.git/config`; git lists neither. An untracked symlink to a file (or to nothing) diffs as git
  // shows one: mode 120000 and its target's path. A listed symlink to a directory is refused: `--no-index` takes a
  // directory on one side as `<dir>/<other side's basename>` and would read `<target>/null` (probed, Apple Git 2.50.1).
  // Exit 1 is git's "differs", which every listed file does (an empty one by its header); an empty answer is git
  // failing to read the path (it went since the status), which exits 1 too.
  private async untrackedDiff(directory: string, path: string | undefined, context: number | undefined): Promise<GitDiff> {
    if (path === undefined) throw new Error('the untracked scope needs a path');
    const refused = () => new Error(`not an untracked file: ${path}`);
    const { repoRoot, files } = await this.status(directory);
    if (path.endsWith('/') || !files.some((file) => file.untracked && file.path === path)) throw refused();
    if ((await stat(join(repoRoot, path)).catch(() => null))?.isDirectory()) throw refused();
    const patch = await this.run(
      repoRoot,
      ['-c', 'diff.autoRefreshIndex=false', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-index', `-U${context ?? 3}`, '--', '/dev/null', path],
      { acceptExitCodes: [1] },
    );
    if (patch === '') throw refused();
    return { patch, files: [addedFileFacts(path, patch)] };
  }

  // The remote's URL as configured, without user-info: the upstream's remote, or with no upstream `origin` (else the sole
  // remote) so a branch not yet pushed still names its repository. Null for a local upstream, when no remote qualifies,
  // or when the remote has no URL. Never a fetch. A timeout still fails the status.
  private async remoteUrl(repoRoot: string, upstream: string | null): Promise<string | null> {
    try {
      let url: string | null;
      if (upstream === null) url = await this.defaultRemoteUrl(repoRoot);
      else {
        const remote = upstreamRemote(upstream);
        url = remote === null ? null : (await this.run(repoRoot, ['remote', 'get-url', remote])).trim();
      }
      return url ? withoutUserInfo(url) : null;
    } catch (error) {
      if (error instanceof GitTimeoutError) throw error;
      return null;
    }
  }

  // With no upstream (C10's worktree branches, before a push), one read of every remote's configured URL answers both
  // which remote and its URL: `origin`'s, else the only remote's. As configured, so an `insteadOf` rewrite that
  // `remote get-url` would apply is not; git exits 1 when no remote has a URL.
  private async defaultRemoteUrl(repoRoot: string): Promise<string | null> {
    const urls = new Map<string, string>();
    for (const entry of (await this.run(repoRoot, ['config', '-z', '--get-regexp', '^remote\\..*\\.url$'])).split('\0')) {
      const newline = entry.indexOf('\n');
      if (newline === -1) continue;
      const name = entry.slice('remote.'.length, newline - '.url'.length);
      if (!urls.has(name)) urls.set(name, entry.slice(newline + 1)); // a remote's first URL, as `remote get-url` answers
    }
    return urls.get('origin') ?? (urls.size === 1 ? [...urls.values()][0] : null);
  }
}

// `https://token@host/…` → `https://host/…`: a credential in a URL-form remote never reaches the renderer. The scp form
// (`git@host:owner/repo`) carries a login name, not a secret, and is left as it is.
export function withoutUserInfo(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/]*@/i, '$1'); // up to the authority's last '@'
}

// One added file's counts read off its own patch (`--numstat -z` under `--no-index` lists `/dev/null` and the path as
// separate fields, not the shape parseNumstat reads): every `+` line after the header, or binary.
function addedFileFacts(path: string, patch: string): GitDiffFile {
  const lines = patch.split('\n');
  const firstHunk = lines.findIndex((line) => line.startsWith('@@'));
  const header = firstHunk === -1 ? lines : lines.slice(0, firstHunk);
  const binary = header.some((line) => line.startsWith('Binary files ') || line === 'GIT binary patch');
  const insertions = binary || firstHunk === -1 ? 0 : lines.slice(firstHunk).filter((line) => line.startsWith('+')).length;
  return { path, oldPath: null, insertions, deletions: 0, binary };
}

function requireAbsolute(directory: string): void {
  if (!isAbsolute(directory)) throw new Error(`directory must be absolute: ${directory}`);
}

// A repository-relative path, taken literally (no globbing) whichever directory inside the repository git runs in.
function pathspec(path: string | undefined): string[] {
  return path === undefined ? [] : ['--', `:(top,literal)${path}`];
}
