// Main's read-only git service (C4 execution document, Interfaces "Git service" and M6; charter §4.5): status,
// branches, diff and log for any directory inside a repository or linked worktree, and the ref-counted repository
// watcher. Only these subcommands ever run: `rev-parse`, `status`, `stash list`, `remote get-url`, `config --get-regexp`
// (remote URLs only), `for-each-ref`, `diff`, `log`, for the watcher's prune on Linux `ls-files` and `check-ignore`, and
// for UX wave U5b-2's three reads (`branchCommits`, `commitDiff`, `changesSince`) `merge-base`, `rev-list` and
// `symbolic-ref`, all three reads too. Nothing stages, commits, stashes, checks out, fetches, or adds or removes a worktree (C10 and P1 own
// mutation; E6's `refresh` only asks the watcher to read again); worktrees under `<repo>/.claude/worktrees/` need no special case, `rev-parse` reports them as linked.
// Paths in answers are relative to the repository root, and a `path` argument is read the same way.
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import {
  UNTRACKED_COUNT_BYTES, UNTRACKED_COUNT_FILES, type GitBranchCommits, type GitBranchCommitsInput, type GitBranches, type GitChanged, type GitChangesSince,
  type GitChangesSinceInput, type GitCommitDiff, type GitCommitDiffInput, type GitDiff, type GitDiffFile, type GitDiffInput, type GitLog, type GitLogInput, type GitStatus,
} from '@shared/ipc/schema/git';
import { countAddedLines, type CountHooks } from '../fs/count-lines';
import { commitNamed, defaultBaseRef, headCommit, mergeBaseWithHead } from './default-base';
import { gitIgnored } from './ignored';
import { parseBranches, parseCurrentUpstream, parseLog, parseNumstat, parseRevParse, parseStatus, upstreamRemote } from './porcelain';
import { createGitReader, createGitRunner, GitCommandError, GitTimeoutError, type ExecFileFn, type GitRead, type GitRun } from './runner';
import { GitWatcher, type WatchFn, type WatchOwner } from './watcher';

// The repository a directory lies in: its top level (the watcher's key for a root), git dir and common dir.
const REV_PARSE = ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir'];

export interface GitServiceOptions {
  emit?: (change: GitChanged) => void; // `git.changed`; main passes the router's emit
  env?: NodeJS.ProcessEnv; // where PATH, HOME and MAWS_GIT are read; process.env by default
  execFile?: ExecFileFn;
  watch?: WatchFn;
  log?: (line: string) => void; // P5 O3-E: the watcher's root lines (GitWatcherDeps.log)
  countHooks?: CountHooks; // test-only: `changesSince`'s count of a new file, between its listing and its open (../fs/count-lines.ts)
}

export class GitService {
  private readonly run: GitRun;
  private readonly read: GitRead; // the prune's listings, streamed (D21)
  private readonly watcher: GitWatcher;
  private readonly countHooks: CountHooks | undefined;

  constructor(options: GitServiceOptions = {}) {
    this.run = createGitRunner({ env: options.env, execFile: options.execFile });
    this.read = createGitReader({ env: options.env });
    this.countHooks = options.countHooks;
    // P5 O3-E M1: the watcher's prune on Linux reads what git ignores through this runner (`ls-files`, `check-ignore`).
    this.watcher = new GitWatcher({ status: (directory) => this.status(directory), emit: options.emit ?? (() => {}), watch: options.watch, ignored: (root) => gitIgnored(this.run, root, this.read), log: options.log });
  }

  async status(directory: string): Promise<GitStatus> {
    requireAbsolute(directory);
    const { repoRoot, gitDir, commonDir } = parseRevParse(await this.run(directory, REV_PARSE));
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
    return this.diffOf(directory, range, path, context);
  }

  // The patch and the counts of one `git diff` range, as every scope reads them. `ended`: the range is closed with `--`
  // even with no path (U5b-2's reads, whose revisions are whole ids a file could be named like).
  private async diffOf(directory: string, range: string[], path: string | undefined, context: number | undefined, ended = false): Promise<GitDiff> {
    const [patch, numstat] = await Promise.all([
      this.run(directory, [...DIFF, `-U${context ?? 3}`, ...range, ...pathspec(path, ended)]),
      this.run(directory, [...DIFF, '--numstat', '-z', ...range, ...pathspec(path, ended)]),
    ]);
    return { patch, files: parseNumstat(numstat) };
  }

  async log({ directory, limit, path }: GitLogInput): Promise<GitLog> {
    requireAbsolute(directory);
    try {
      const out = await this.run(directory, ['log', '--no-show-signature', LOG_FORMAT, '-z', '-n', String(limit), ...pathspec(path)]);
      return { commits: parseLog(out) };
    } catch (error) {
      if (error instanceof GitCommandError && /does not have any commits yet/.test(error.stderr)) return { commits: [] };
      throw error;
    }
  }

  // UX wave U5b-2 (Interfaces §C): the branch read. The base is the default-branch rule's (./default-base.ts); the
  // commits are `<merge base>..HEAD`, newest first, at most `limit`, and with no base the newest of HEAD. A row is pushed
  // when the upstream holds it: false for every row with no upstream, null for every row (and null halves in `counts`)
  // when the upstream is configured and git cannot resolve it. `counts` and `behind` are of the whole range.
  // One snapshot (the branch's max panel, the document's Decision Log 52): HEAD, the base ref and the upstream are each
  // resolved to a commit once, and every later step names those ids, never a ref, so a history that moves while the read
  // runs cannot make one step disagree with another (more not pushed than in all, a negative pushed count).
  async branchCommits({ directory, limit }: GitBranchCommitsInput): Promise<GitBranchCommits> {
    requireAbsolute(directory);
    const [ref, upstream, head] = await Promise.all([defaultBaseRef(this.run, directory), this.currentUpstream(directory), headCommit(this.run, directory)]);
    if (head === null) return { base: null, upstream: upstream.name, commits: [], counts: null, behind: null };
    // the merge base beside `behind`: each walks the history, seconds apiece in a large repository with no commit-graph (P5)
    const [mergeBase, behindRef, upstreamCommit] = await Promise.all([
      ref === null ? null : mergeBaseWithHead(this.run, directory, ref.commit, head),
      ref === null ? null : this.run(directory, ['rev-list', '--count', ref.commit, `^${head}`, '--']).then(Number),
      upstream.ref === null || upstream.gone ? null : commitNamed(this.run, directory, upstream.ref),
    ]);
    const base = ref === null || mergeBase === null ? null : { ...ref, mergeBase };
    const range = base === null ? [head] : [head, `^${base.mergeBase}`];
    const [rows, notPushed, all] = await Promise.all([
      this.run(directory, ['log', '--no-show-signature', LOG_FORMAT, '-z', '-n', String(limit), ...range, '--']).then(parseLog),
      // the range's commits the upstream does not hold: few on a branch, and never more than the range
      upstreamCommit === null ? null : this.run(directory, ['rev-list', ...range, `^${upstreamCommit}`, '--']).then(shas),
      base === null ? null : this.run(directory, ['rev-list', '--count', ...range, '--']).then(Number),
    ]);
    const behind = base === null ? null : behindRef;
    const pushedOf = (sha: string) => (upstream.ref === null ? false : notPushed === null ? null : !notPushed.has(sha));
    return {
      base: base === null ? null : { ref: base.ref, mergeBase: base.mergeBase },
      upstream: upstream.name,
      commits: rows.map((commit) => ({ ...commit, pushed: pushedOf(commit.sha) })),
      counts: all === null ? null : {
        all,
        notPushed: upstream.ref === null ? all : notPushed === null ? null : notPushed.size,
        pushed: upstream.ref === null ? 0 : notPushed === null ? null : all - notPushed.size,
      },
      behind,
    };
  }

  // UX wave U5b-2 (Interfaces §C): the commit read. The commit against its first parent (a merge commit so too, never a
  // combined diff), a root commit with every line added; `onHead` is whether HEAD holds it. `patch: false` reads no diff.
  async commitDiff({ directory, commit, path, context, patch = true }: GitCommitDiffInput): Promise<GitCommitDiff> {
    requireAbsolute(directory);
    const read = await this.commitOf(directory, commit); // first: a hash that names no commit is refused as that
    if (!patch) return { commit: read, onHead: await this.holdsCommit(directory, commit), patch: '', files: [] };
    // a root commit has no parent to diff against; `log --root` shows it as created, which needs no empty tree's id
    // (that id differs between a SHA-1 and a SHA-256 repository)
    const [onHead, diff] = await Promise.all([
      this.holdsCommit(directory, commit),
      read.parents.length > 0 ? this.diffOf(directory, [read.parents[0], commit], path, context, true) : this.rootDiff(directory, commit, path, context),
    ]);
    return { commit: read, onHead, ...diff };
  }

  // UX wave U5b-2 (Interfaces §C, R1): the working-tree read. The working tree against `against` with `git.diff`'s
  // arguments and prefixes; without `path`, the first UNTRACKED_COUNT_FILES untracked files the fresh status lists (in
  // its order, a `dir/` entry not one), each with its added lines read through an opened descriptor by the service
  // itself (decision 15), never by a git run a file.
  // `HEAD` is resolved to its commit once, so the patch and the counts name the same one (Decision Log 52); before the
  // first commit it stays `HEAD`, which git refuses in both alike.
  async changesSince({ directory, against, path, context }: GitChangesSinceInput): Promise<GitChangesSince> {
    requireAbsolute(directory);
    const since = against === 'HEAD' ? ((await headCommit(this.run, directory)) ?? against) : against;
    const [diff, untracked] = await Promise.all([
      this.diffOf(directory, [since], path, context, true),
      path === undefined ? this.untrackedCounts(directory) : [],
    ]);
    return { ...diff, untracked };
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
  // read exactly as `status` reads it, which is the key the watcher holds it by (a subdirectory, a symlinked spelling).
  // Best effort: a failure here leaves the change to the watcher's own events.
  refresh(directory: string): void {
    requireAbsolute(directory);
    void this.run(directory, REV_PARSE).then(
      (out) => this.watcher.refreshNow(parseRevParse(out).repoRoot),
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
  // failing to read the path (it went since the status), which exits 1 too. An answer whose header names any other path
  // is refused: the entry changed between the checks and the diff (a symlink to a directory swapped in reads as
  // `<path>/null`).
  private async untrackedDiff(directory: string, path: string | undefined, context: number | undefined): Promise<GitDiff> {
    if (path === undefined) throw new Error('the untracked scope needs a path');
    const refused = () => new Error(`not an untracked file: ${path}`);
    const { repoRoot, files } = await this.status(directory);
    if (path.endsWith('/') || !files.some((file) => file.untracked && file.path === path)) throw refused();
    if ((await stat(join(repoRoot, path)).catch(() => null))?.isDirectory()) throw refused();
    const patch = await this.run(
      repoRoot,
      // The prefixes are fixed so the header check reads `a/`/`b/` whatever the owner's diff.noprefix, mnemonicPrefix
      // or srcPrefix/dstPrefix say (`--default-prefix` needs git 2.41; Apple's is older).
      ['-c', 'diff.autoRefreshIndex=false', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-index', '--src-prefix=a/', '--dst-prefix=b/', `-U${context ?? 3}`, '--', '/dev/null', path],
      { acceptExitCodes: [1] },
    );
    if (!patchNames(patch, path)) throw refused();
    return { patch, files: [addedFileFacts(path, patch)] };
  }

  // The current branch's upstream: its name as the status names it, its full ref, and whether git can resolve it (a
  // deleted remote-tracking ref is `[gone]`). All null for a detached HEAD or a branch with no upstream.
  private async currentUpstream(directory: string): Promise<{ name: string | null; ref: string | null; gone: boolean }> {
    return parseCurrentUpstream(await this.run(directory, ['for-each-ref', '--format=%(HEAD)%00%(upstream)%00%(upstream:short)%00%(upstream:track)', 'refs/heads']));
  }

  // One commit by its whole id: a hash that names no commit (or names another object) is an error that says so.
  private async commitOf(directory: string, commit: string): Promise<GitLog['commits'][number]> {
    const missing = () => new Error(`no commit ${commit} in this repository`);
    let out: string;
    try {
      out = await this.run(directory, ['log', '--no-show-signature', LOG_FORMAT, '-z', '-n', '1', commit, '--']);
    } catch (error) {
      if (error instanceof GitCommandError) throw missing();
      throw error;
    }
    const [read] = parseLog(out);
    if (read?.sha !== commit) throw missing(); // a tag's id peels to its commit, which is not the object asked for
    return read;
  }

  // Whether HEAD holds the commit (`merge-base --is-ancestor` exits 1 when it does not); false before HEAD has a commit
  // (an orphan branch's).
  private async holdsCommit(directory: string, commit: string): Promise<boolean> {
    try {
      await this.run(directory, ['merge-base', '--is-ancestor', commit, 'HEAD']);
      return true;
    } catch (error) {
      if (error instanceof GitCommandError && (error.exitCode === 1 || /not a valid object name HEAD/i.test(error.stderr))) return false;
      throw error;
    }
  }

  // A root commit as created: `log -p --root` for the one commit, with the diff's own arguments (`log` refreshes no
  // index and runs no external diff here either).
  private async rootDiff(directory: string, commit: string, path: string | undefined, context: number | undefined): Promise<GitDiff> {
    const log = ['log', '--no-show-signature', '-n', '1', '--root', '--format=', '--no-relative', '--no-color', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/'];
    const [patch, numstat] = await Promise.all([
      this.run(directory, [...log, '-p', `-U${context ?? 3}`, commit, ...pathspec(path, true)]),
      this.run(directory, [...log, '--numstat', '-z', commit, ...pathspec(path, true)]),
    ]);
    return { patch, files: parseNumstat(numstat) };
  }

  // The new files' counts: the first UNTRACKED_COUNT_FILES untracked files a fresh status lists, read under the
  // repository's real root (an open with no link on the way takes no other spelling of it).
  private async untrackedCounts(directory: string): Promise<GitChangesSince['untracked']> {
    const { repoRoot } = parseRevParse(await this.run(directory, REV_PARSE));
    const [realRoot, porcelain] = await Promise.all([realpath(repoRoot), this.run(repoRoot, ['status', '--porcelain=v2', '-z', '--untracked-files=normal'])]);
    const listed = parseStatus(porcelain).files.filter((file) => file.untracked && !file.path.endsWith('/')).slice(0, UNTRACKED_COUNT_FILES);
    const counts: GitChangesSince['untracked'] = [];
    for (const { path } of listed) {
      const { insertions, binary } = await countAddedLines(realRoot, path, UNTRACKED_COUNT_BYTES, this.countHooks);
      counts.push({ path, insertions, binary });
    }
    return counts;
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

// Whether an added file's patch is about `path` and only it: one `diff --git a/<path> b/<path>` block, and its
// `+++ b/<path>` when it has one (an empty or binary file has none). Git writes a name holding a quote, a backslash, a
// control or (by default) a non-ASCII byte C-quoted (`"b/na\303\257ve.txt"`), and ends an unquoted `+++` name holding a
// space with a tab; both readings are undone before comparing.
function patchNames(patch: string, path: string): boolean {
  const lines = patch.split('\n');
  if (lines.filter((line) => line.startsWith('diff --git ')).length !== 1) return false;
  const firstHunk = lines.findIndex((line) => line.startsWith('@@'));
  const header = firstHunk === -1 ? lines : lines.slice(0, firstHunk);
  const rest = header[0].startsWith('diff --git ') ? header[0].slice('diff --git '.length) : null;
  if (rest === null) return false;
  const sides = rest.startsWith('"') ? quotedPair(rest) : rest === `a/${path} b/${path}` ? [`a/${path}`, `b/${path}`] : null;
  if (sides === null || sides[0] !== `a/${path}` || sides[1] !== `b/${path}`) return false;
  const plus = header.find((line) => line.startsWith('+++ '));
  return plus === undefined || unquoteC(plus.slice(4).replace(/\t$/, '')) === `b/${path}`;
}

// `"a/…" "b/…"`: the two C-quoted names of a `diff --git` line, unquoted; null when the line is not that shape.
function quotedPair(text: string): [string, string] | null {
  const end = (from: number) => {
    let i = from + 1;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    return i;
  };
  const first = end(0);
  if (text[first + 1] !== ' ' || text[first + 2] !== '"') return null;
  const second = end(first + 2);
  if (second !== text.length - 1) return null;
  return [unquoteC(text.slice(0, first + 1)), unquoteC(text.slice(first + 2))];
}

// Git's C-style quoting undone (`quote_c_style`): the escapes \a \b \t \n \v \f \r \" \\ and three-digit octal bytes.
function unquoteC(text: string): string {
  if (text.length < 2 || !text.startsWith('"') || !text.endsWith('"')) return text;
  const escapes: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };
  const chars = Array.from(text.slice(1, -1)); // by code point: a raw non-ASCII name (core.quotePath=false) stays whole
  const bytes: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== '\\') {
      bytes.push(...Buffer.from(chars[i], 'utf8'));
      continue;
    }
    const next = chars[++i] ?? '';
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(chars.slice(i, i + 3).join(''), 8));
      i += 2;
    } else bytes.push(escapes[next] ?? next.charCodeAt(0));
  }
  return Buffer.from(bytes).toString('utf8');
}

// `git diff` refreshes a stale stat cache and rewrites the index through `index.lock` whatever GIT_OPTIONAL_LOCKS says
// (probed on Apple Git 2.50.1; `git status` honours it); `diff.autoRefreshIndex=false` turns that write off. E11: the
// prefixes are pinned as the untracked scope pins them, so the owner's diff.noprefix, mnemonicPrefix or
// srcPrefix/dstPrefix never reshape the headers the renderer's patch reader expects
const DIFF = ['-c', 'diff.autoRefreshIndex=false', 'diff', '--no-relative', '--no-color', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/'];
const LOG_FORMAT = '--format=%H%x00%h%x00%an%x00%aI%x00%s%x00%P';

function requireAbsolute(directory: string): void {
  if (!isAbsolute(directory)) throw new Error(`directory must be absolute: ${directory}`);
}

// A repository-relative path, taken literally (no globbing) whichever directory inside the repository git runs in.
// `ended`: the revisions before it are closed with `--` even with no path.
function pathspec(path: string | undefined, ended = false): string[] {
  return path === undefined ? (ended ? ['--'] : []) : ['--', `:(top,literal)${path}`];
}

// `rev-list`'s one id a line, as a set.
function shas(out: string): Set<string> {
  return new Set(out.split('\n').filter((line) => line !== ''));
}
