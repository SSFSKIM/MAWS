// Main's read-only git service (C4 execution document, Interfaces "Git service" and M6; charter §4.5): status,
// branches, diff and log for any directory inside a repository or linked worktree, and the ref-counted repository
// watcher. Only these subcommands ever run: `rev-parse`, `status`, `stash list`, `remote get-url`, `for-each-ref`,
// `diff`, `log`. Nothing stages, commits, stashes, checks out, fetches, or adds or removes a worktree (C10 and P1 own
// mutation); worktrees under `<repo>/.claude/worktrees/` need no special case, `rev-parse` reports them as linked.
// Paths in answers are relative to the repository root, and a `path` argument is read the same way.
import { isAbsolute } from 'node:path';
import type { GitBranches, GitChanged, GitDiff, GitDiffInput, GitLog, GitLogInput, GitStatus } from '@shared/ipc/schema/git';
import { parseBranches, parseLog, parseNumstat, parseRevParse, parseStatus, upstreamRemote } from './porcelain';
import { createGitRunner, GitCommandError, GitTimeoutError, type ExecFileFn, type GitRun } from './runner';
import { GitWatcher, type WatchFn } from './watcher';

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
  // HEAD, or with a `base` the branch's own change since its merge base with `base` (`<base>...HEAD`).
  async diff({ directory, scope, base, path, context }: GitDiffInput): Promise<GitDiff> {
    requireAbsolute(directory);
    if (base !== undefined) {
      if (base === '' || base.startsWith('-')) throw new Error(`invalid base: ${base}`); // never an option in a revision's place
      if (scope !== 'all') throw new Error("base applies to scope 'all' only");
    }
    const range = base !== undefined ? [`${base}...HEAD`] : scope === 'staged' ? ['--cached'] : scope === 'all' ? ['HEAD'] : [];
    const common = ['diff', '--no-color', '--no-ext-diff', '--no-textconv'];
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

  // Ref-counted per repository root; answers the directory's status.
  watch(directory: string): Promise<GitStatus> {
    requireAbsolute(directory);
    return this.watcher.watch(directory);
  }

  unwatch(directory: string): void {
    this.watcher.unwatch(directory);
  }

  dispose(): void {
    this.watcher.dispose();
  }

  // The upstream's remote URL as configured, without user-info; null without an upstream, for a local upstream, or when
  // the remote has no URL. Never a fetch. A timeout still fails the status.
  private async remoteUrl(repoRoot: string, upstream: string | null): Promise<string | null> {
    const remote = upstreamRemote(upstream);
    if (remote === null) return null;
    try {
      return withoutUserInfo((await this.run(repoRoot, ['remote', 'get-url', remote])).trim()) || null;
    } catch (error) {
      if (error instanceof GitTimeoutError) throw error;
      return null;
    }
  }
}

// `https://token@host/…` → `https://host/…`: a credential in a URL-form remote never reaches the renderer. The scp form
// (`git@host:owner/repo`) carries a login name, not a secret, and is left as it is.
export function withoutUserInfo(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/]*@/i, '$1'); // up to the authority's last '@'
}

function requireAbsolute(directory: string): void {
  if (!isAbsolute(directory)) throw new Error(`directory must be absolute: ${directory}`);
}

// A repository-relative path, taken literally (no globbing) whichever directory inside the repository git runs in.
function pathspec(path: string | undefined): string[] {
  return path === undefined ? [] : ['--', `:(top,literal)${path}`];
}
