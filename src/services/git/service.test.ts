import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitStatusSchema, type GitChanged } from '@shared/ipc/schema/git';
import { GitFixture, runGit } from '../../../test/support/git-fixture';
import { GitTimeoutError, NotARepositoryError, type ExecFileFn } from './runner';
import { GitService, withoutUserInfo } from './service';

// Every test runs git against a temporary repository the fixture made; never this checkout or the owner's repositories.
describe('git service answers status, branches, diff and log', () => {
  let repo: GitFixture;
  let service: GitService;
  beforeEach(async () => {
    repo = await GitFixture.create();
    service = new GitService({ env: repo.serviceEnv() });
  });
  afterEach(() => {
    service.dispose();
    repo.dispose();
  });

  it('reports a clean repository, then an untracked file, then the file staged', async () => {
    const clean = await service.status(repo.root);
    expect(clean).toMatchObject({
      repoRoot: repo.root,
      gitDir: join(repo.root, '.git'),
      commonDir: join(repo.root, '.git'),
      isWorktree: false,
      branch: 'main',
      upstream: null,
      remoteUrl: null,
      ahead: 0,
      behind: 0,
      dirty: false,
      files: [],
      stashCount: 0,
    });
    expect(GitStatusSchema.parse(clean)).toEqual(clean); // the X2 output schema the renderer's client checks
    expect(clean.head).toMatch(/^[0-9a-f]{40}$/);
    expect(Number.isNaN(Date.parse(clean.checkedAt))).toBe(false);

    await repo.write('notes.txt', 'draft\n');
    const untracked = await service.status(repo.root);
    expect(untracked.dirty).toBe(true);
    expect(untracked.files).toEqual([{ path: 'notes.txt', oldPath: null, index: '?', worktree: '?', untracked: true }]);

    await repo.git('add', 'notes.txt');
    expect((await service.status(repo.root)).files).toEqual([{ path: 'notes.txt', oldPath: null, index: 'A', worktree: '.', untracked: false }]);
  });

  it('answers for a directory inside the repository with the repository root', async () => {
    await repo.write('src/deep/file.ts', 'x\n');
    expect((await service.status(repo.path('src/deep'))).repoRoot).toBe(repo.root);
  });

  it('lists main as the current branch', async () => {
    await repo.git('branch', 'feature');
    expect(await service.branches(repo.root)).toEqual({
      current: 'main',
      branches: [
        { name: 'feature', upstream: null, isCurrent: false },
        { name: 'main', upstream: null, isCurrent: true },
      ],
    });
  });

  it('reports remoteUrl null without an upstream, and the upstream remote URL once main tracks a local bare remote', async () => {
    expect((await service.status(repo.root)).remoteUrl).toBeNull();
    const bare = await repo.addBareRemote();
    const tracked = await service.status(repo.root);
    expect(tracked).toMatchObject({ upstream: 'origin/main', remoteUrl: bare, ahead: 0, behind: 0 });
    await repo.write('README.md', 'hello\nagain\n');
    await repo.git('commit', '-q', '-am', 'second');
    expect(await service.status(repo.root)).toMatchObject({ ahead: 1, behind: 0, remoteUrl: bare });
    expect((await service.branches(repo.root)).branches).toEqual([{ name: 'main', upstream: 'origin/main', isCurrent: true }]);
  });

  it('without an upstream, reports origin, else the sole remote, else null; an upstream keeps its own remote', async () => {
    // The fixture writes its own temporary repository's config; nothing is fetched.
    await repo.git('remote', 'add', 'fork', 'https://github.com/someone/fork.git');
    expect(await service.status(repo.root)).toMatchObject({ upstream: null, remoteUrl: 'https://github.com/someone/fork.git' }); // the sole remote
    await repo.git('remote', 'add', 'origin', 'https://github.com/owner/repo.git');
    // One spawn answers which remote and its URL: rev-parse, status and stash list, then the one config read.
    const spawn = vi.fn(execFile as unknown as ExecFileFn);
    const counted = new GitService({ env: repo.serviceEnv(), execFile: spawn });
    expect(await counted.status(repo.root)).toMatchObject({ upstream: null, remoteUrl: 'https://github.com/owner/repo.git' }); // origin wins
    expect(spawn.mock.calls.map(([, args]) => args[2])).toEqual(['rev-parse', 'status', 'stash', 'config']);
    counted.dispose();
    await repo.git('remote', 'add', 'third', 'https://example.com/third.git');
    await repo.git('remote', 'remove', 'origin');
    expect((await service.status(repo.root)).remoteUrl).toBeNull(); // two remotes, neither origin
    await repo.addBareRemote(); // origin again, and main tracks origin/main
    await repo.git('config', 'branch.main.remote', 'fork'); // main now tracks fork/main (a ref never fetched)
    const tracked = await service.status(repo.root);
    expect(tracked.upstream).toBe('fork/main');
    expect(tracked.remoteUrl).toBe('https://github.com/someone/fork.git');
  });

  it('strips user-info from the remote URL before it leaves main', async () => {
    await repo.addBareRemote();
    // The fixture rewrites its own temporary repository's config; nothing is fetched.
    await repo.git('remote', 'set-url', 'origin', 'https://ghp_secret:x-oauth@github.com/owner/repo.git');
    expect((await service.status(repo.root)).remoteUrl).toBe('https://github.com/owner/repo.git');
    expect(withoutUserInfo('https://token@example.com/o/r.git')).toBe('https://example.com/o/r.git');
    expect(withoutUserInfo('ssh://git@github.com/o/r.git')).toBe('ssh://github.com/o/r.git');
    expect(withoutUserInfo('git@github.com:o/r.git')).toBe('git@github.com:o/r.git'); // scp form: a login name, no secret
    expect(withoutUserInfo('/private/var/folders/x/remote')).toBe('/private/var/folders/x/remote');
  });

  it('recognises a linked worktree under .claude/worktrees with its own branch and the main repository as common dir', async () => {
    const wt = await repo.addWorktree('wt');
    const status = await service.status(wt);
    expect(status).toMatchObject({ repoRoot: wt, isWorktree: true, branch: 'wt', commonDir: join(repo.root, '.git'), dirty: false });
    expect(status.gitDir).toBe(join(repo.root, '.git', 'worktrees', 'wt'));
  });

  it('counts stashes without creating one', async () => {
    // The fixture stashes (a write); the service only lists.
    await repo.write('README.md', 'stashed\n');
    await repo.git('stash', '-q');
    expect((await service.status(repo.root)).stashCount).toBe(1);
  });

  it('diffs the worktree scope with the edit and its counts, the staged scope and all against HEAD', async () => {
    await repo.write('README.md', 'hello\nworld\n');
    const worktree = await service.diff({ directory: repo.root, scope: 'worktree' });
    expect(worktree.patch).toContain('+world');
    expect(worktree.files).toEqual([{ path: 'README.md', oldPath: null, insertions: 1, deletions: 0, binary: false }]);
    expect((await service.diff({ directory: repo.root, scope: 'staged' })).files).toEqual([]);

    await repo.git('add', 'README.md');
    expect((await service.diff({ directory: repo.root, scope: 'worktree' })).files).toEqual([]);
    expect((await service.diff({ directory: repo.root, scope: 'staged' })).files).toMatchObject([{ path: 'README.md', insertions: 1 }]);
    await repo.write('README.md', 'hello\nworld\nagain\n');
    const all = await service.diff({ directory: repo.root, scope: 'all', context: 0 });
    expect(all.files).toMatchObject([{ path: 'README.md', insertions: 2, deletions: 0 }]);
    expect(all.patch).toContain('@@ -1,0 +2,2 @@');
  });

  // Final-wave probe (2026-09-29, Apple Git 2.50.1): `git diff` over a stale stat cache refreshes and rewrites the
  // index through `index.lock` even under GIT_OPTIONAL_LOCKS=0, which `git status` honours and `git diff` does not;
  // `diff.autoRefreshIndex=false` is the switch it reads.
  // The final re-review (D25): the watcher's own status is no writer of the index, which is what keeps status → index
  // → ignore rebuild → pass → status from looping. `git status` refreshes a stale stat cache and writes the index
  // unless GIT_OPTIONAL_LOCKS=0, which the runner sets for every read.
  it('never rewrites the index: a status over a stale stat cache leaves .git/index byte-identical', async () => {
    await repo.setMtime('README.md', 1_700_000_000); // stat-dirty, content clean
    const index = join(repo.root, '.git', 'index');
    const before = readFileSync(index);
    const { mtimeMs } = statSync(index);
    expect((await service.status(repo.root)).dirty).toBe(false);
    expect(readFileSync(index).equals(before)).toBe(true);
    expect(statSync(index).mtimeMs).toBe(mtimeMs);
  });

  it('never rewrites the index: a diff over a stale stat cache leaves .git/index untouched and still shows the real edit', async () => {
    await repo.write('NOTES.md', 'notes\n');
    await repo.git('add', 'NOTES.md');
    await repo.git('commit', '-q', '-m', 'notes');
    await repo.write('README.md', 'hello\nworld\n');
    await repo.setMtime('NOTES.md', Math.floor(Date.now() / 1000) + 60); // stat-dirty, content clean
    const index = statSync(join(repo.root, '.git', 'index'));
    for (const scope of ['worktree', 'all'] as const) {
      const diff = await service.diff({ directory: repo.root, scope });
      expect(diff.patch).toContain('+world');
      expect(diff.files.map((f) => f.path)).toEqual(['README.md']);
    }
    const after = statSync(join(repo.root, '.git', 'index'));
    expect([after.ino, after.mtimeMs]).toEqual([index.ino, index.mtimeMs]);
  });

  it('diffs a path alone, a rename with its source, and a binary file', async () => {
    await repo.write('other.txt', 'one\n');
    await repo.write('logo.bin', 'a\0b');
    await repo.git('add', '.');
    await repo.git('commit', '-q', '-m', 'more');
    await repo.git('mv', 'other.txt', 'renamed.txt');
    await repo.write('README.md', 'changed\n');
    await repo.write('logo.bin', 'c\0d');
    expect((await service.diff({ directory: repo.root, scope: 'all', path: 'README.md' })).files.map((f) => f.path)).toEqual(['README.md']);
    const files = (await service.diff({ directory: repo.root, scope: 'all' })).files;
    expect(files).toContainEqual({ path: 'renamed.txt', oldPath: 'other.txt', insertions: 0, deletions: 0, binary: false });
    expect(files).toContainEqual({ path: 'logo.bin', oldPath: null, insertions: 0, deletions: 0, binary: true });
  });

  it('with a base, diffs the branch since its merge base (three-dot), and refuses a base that reads as an option', async () => {
    await repo.git('checkout', '-q', '-b', 'feature');
    await repo.write('feature.txt', 'f\n');
    await repo.git('add', 'feature.txt');
    await repo.git('commit', '-q', '-m', 'feature');
    await repo.git('checkout', '-q', 'main');
    await repo.write('README.md', 'main moved\n');
    await repo.git('commit', '-q', '-am', 'main moves on');
    await repo.git('checkout', '-q', 'feature');
    const branch = await service.diff({ directory: repo.root, scope: 'all', base: 'main' });
    expect(branch.files.map((f) => f.path)).toEqual(['feature.txt']); // main's later commit is not in the branch's own change
    await expect(service.diff({ directory: repo.root, scope: 'all', base: '--output=/tmp/x' })).rejects.toThrow('invalid base: --output=/tmp/x');
    await expect(service.diff({ directory: repo.root, scope: 'worktree', base: 'main' })).rejects.toThrow("base applies to scope 'all' only");
  });

  // E11 (tracker row E6 · C4 "diff prefix config reshapes git.diff headers"): every scope pins a/ and b/, as untracked does
  it.each<{ settings: [string, string][] }>([
    { settings: [['diff.mnemonicPrefix', 'true']] },
    { settings: [['diff.noprefix', 'true']] },
    { settings: [['diff.srcPrefix', 'old:'], ['diff.dstPrefix', 'new:']] },
  ])('answers a/ and b/ headers in every scope whatever the configuration asks for ($settings)', async ({ settings }) => {
    await repo.git('checkout', '-q', '-b', 'feature');
    await repo.write('README.md', 'staged\n');
    await repo.git('commit', '-q', '-am', 'feature');
    for (const [key, value] of settings) await repo.git('config', key, value);
    await repo.write('README.md', 'staged again\n');
    await repo.git('add', 'README.md');
    await repo.write('README.md', 'and the worktree\n');
    const headers = ['diff --git a/README.md b/README.md', '--- a/README.md', '+++ b/README.md'];
    for (const input of [{ scope: 'worktree' }, { scope: 'staged' }, { scope: 'all' }, { scope: 'all', base: 'main' }] as const) {
      const lines = (await service.diff({ directory: repo.root, ...input })).patch.split('\n');
      for (const header of headers) expect(lines, JSON.stringify(input)).toContain(header);
    }
  });

  it('logs with a limit; the root commit has no parents', async () => {
    const [commit] = (await service.log({ directory: repo.root, limit: 1 })).commits;
    expect(commit).toMatchObject({ author: 'MAWS Fixture', subject: 'initial', parents: [] });
    expect(commit.sha).toBe((await repo.git('rev-parse', 'HEAD')).trim());
    expect(commit.shortSha).toBe(commit.sha.slice(0, commit.shortSha.length));
    expect(Number.isNaN(Date.parse(commit.authoredAt))).toBe(false);
    await repo.write('README.md', 'second\n');
    await repo.git('commit', '-q', '-am', 'second');
    const both = (await service.log({ directory: repo.root, limit: 5, path: 'README.md' })).commits;
    expect(both.map((c) => c.subject)).toEqual(['second', 'initial']);
    expect(both[0].parents).toEqual([both[1].sha]);
  });

  it('fails "not a git repository" outside any repository', async () => {
    await expect(service.status('/tmp')).rejects.toThrow(NotARepositoryError);
    await expect(service.status('/tmp')).rejects.toThrow(/^not a git repository$/);
    await expect(service.log({ directory: '/tmp', limit: 1 })).rejects.toThrow(/^not a git repository$/);
  });

  it('refuses a relative directory', async () => {
    await expect(service.status('relative/dir')).rejects.toThrow('directory must be absolute: relative/dir');
  });
});

describe('git invocation is read-only', () => {
  let repo: GitFixture;
  beforeEach(async () => {
    repo = await GitFixture.create();
  });
  afterEach(() => repo.dispose());

  it('invokes /usr/bin/git with GIT_OPTIONAL_LOCKS=0, no prompt, the C locale, a 10 s timeout, and only read subcommands', async () => {
    const spawn = vi.fn(execFile as unknown as ExecFileFn);
    const service = new GitService({ execFile: spawn, env: { PATH: '/usr/bin:/bin', HOME: '/Users/nobody', GIT_DIR: '/elsewhere' } });
    await repo.addBareRemote();
    await repo.write('README.md', 'edit\n');
    await service.status(repo.root);
    await service.branches(repo.root);
    await service.diff({ directory: repo.root, scope: 'all' });
    await service.log({ directory: repo.root, limit: 3 });
    service.dispose();

    expect(spawn).toHaveBeenCalled();
    const subcommands = new Set<string>();
    for (const [file, args, options] of spawn.mock.calls) {
      expect(file).toBe('/usr/bin/git');
      expect(args.slice(0, 2)).toEqual(['-C', repo.root]);
      expect(options).toMatchObject({ detached: true, maxBuffer: 64 * 1024 * 1024 });
      // Exactly this environment: the caller's GIT_DIR (or any other git variable) never reaches the child.
      expect(options.env).toMatchObject({ PATH: '/usr/bin:/bin', HOME: '/Users/nobody', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' });
      // The one configuration a call carries: every diff turns off its index refresh, which would write the index.
      const rest = args[2] === '-c' ? args.slice(4) : args.slice(2);
      if (rest[0] === 'diff') expect(args.slice(2, 4)).toEqual(['-c', 'diff.autoRefreshIndex=false']);
      else expect(args[2]).not.toBe('-c');
      subcommands.add(rest[0] === 'stash' || rest[0] === 'remote' ? `${rest[0]} ${rest[1]}` : rest[0]);
    }
    expect([...subcommands].sort()).toEqual(['diff', 'for-each-ref', 'log', 'remote get-url', 'rev-parse', 'stash list', 'status']);
  });

  it('uses MAWS_GIT when it is set', async () => {
    const spawn = vi.fn(execFile as unknown as ExecFileFn);
    const service = new GitService({ execFile: spawn, env: { PATH: process.env.PATH, MAWS_GIT: '/usr/bin/git' } });
    await service.status(repo.root);
    expect(spawn.mock.calls.every(([file]) => file === '/usr/bin/git')).toBe(true);
    const missing = new GitService({ env: { PATH: process.env.PATH, MAWS_GIT: '/nonexistent/git' } });
    await expect(missing.status(repo.root)).rejects.toThrow('git unavailable: /nonexistent/git: ENOENT');
  });

  it('turns a git call killed at the 10 s timeout into a timeout failure', async () => {
    const hung: ExecFileFn = (_file, _args, _options, callback) => {
      const error = Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM' as const, code: null });
      queueMicrotask(() => callback(error, '', ''));
    };
    const service = new GitService({ execFile: hung });
    await expect(service.status(repo.root)).rejects.toThrow(GitTimeoutError);
    await expect(service.status(repo.root)).rejects.toThrow(`git rev-parse timed out after 10 s in ${repo.root}`);
  });
});

// E6 (Design §7): what `git add` would stage for an untracked file, confined by the fresh status's own listing.
describe('git.diff untracked scope', () => {
  let repo: GitFixture;
  let service: GitService;
  let spawn: ReturnType<typeof vi.fn<ExecFileFn>>;
  let outside: string;
  beforeEach(async () => {
    repo = await GitFixture.create();
    spawn = vi.fn(execFile as unknown as ExecFileFn);
    service = new GitService({ env: repo.serviceEnv(), execFile: spawn });
    outside = realpathSync(mkdtempSync(join(tmpdir(), 'maws-git-outside-')));
  });
  afterEach(() => {
    service.dispose();
    repo.dispose();
    rmSync(outside, { recursive: true, force: true });
  });
  const noIndexCalls = () => spawn.mock.calls.filter(([, args]) => args.includes('--no-index'));

  it('answers a listed file as an all-added patch from the top level, its counts from the patch', async () => {
    await repo.write('src/kept.ts', 'kept\n'); // tracked, so status lists src/new.ts itself rather than `src/`
    await repo.git('add', 'src/kept.ts');
    await repo.git('commit', '-q', '-m', 'src');
    await repo.write('src/new.ts', 'one\ntwo\n');
    const diff = await service.diff({ directory: repo.path('src'), scope: 'untracked', path: 'src/new.ts' });
    expect(noIndexCalls().map(([, args]) => args)).toEqual([
      ['-C', repo.root, '-c', 'diff.autoRefreshIndex=false', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-index', '--src-prefix=a/', '--dst-prefix=b/', '-U3', '--', '/dev/null', 'src/new.ts'],
    ]);
    // The shape C8c's splitPatch reads as one `added` file: the git header, then `new file mode` before the first hunk.
    const lines = diff.patch.split('\n');
    expect(lines.slice(0, 5)).toEqual(['diff --git a/src/new.ts b/src/new.ts', 'new file mode 100644', expect.stringMatching(/^index 0+\.\.[0-9a-f]+$/), '--- /dev/null', '+++ b/src/new.ts']);
    expect(lines.slice(5)).toEqual(['@@ -0,0 +1,2 @@', '+one', '+two', '']);
    expect(diff.files).toEqual([{ path: 'src/new.ts', oldPath: null, insertions: 2, deletions: 0, binary: false }]);
    expect((await service.diff({ directory: repo.root, scope: 'untracked', path: 'src/new.ts', context: 0 })).patch).toContain('@@ -0,0 +1,2 @@');
  });

  it('reads an empty listed file (git exits 1 for it too) as added with nothing inserted, and a binary file as binary', async () => {
    await repo.write('empty.txt', '');
    const empty = await service.diff({ directory: repo.root, scope: 'untracked', path: 'empty.txt' });
    expect(empty.patch.split('\n').slice(0, 2)).toEqual(['diff --git a/empty.txt b/empty.txt', 'new file mode 100644']);
    expect(empty.patch).not.toContain('@@');
    expect(empty.files).toEqual([{ path: 'empty.txt', oldPath: null, insertions: 0, deletions: 0, binary: false }]);
    await repo.write('logo.bin', 'a\0b');
    const binary = await service.diff({ directory: repo.root, scope: 'untracked', path: 'logo.bin' });
    expect(binary.patch).toContain('Binary files /dev/null and b/logo.bin differ');
    expect(binary.files).toEqual([{ path: 'logo.bin', oldPath: null, insertions: 0, deletions: 0, binary: true }]);
  });

  it('diffs an untracked symlink to a file as git shows one, its target path and never the target content', async () => {
    writeFileSync(join(outside, 'secret'), 'outside secret\n');
    symlinkSync(join(outside, 'secret'), repo.path('link'));
    const diff = await service.diff({ directory: repo.root, scope: 'untracked', path: 'link' });
    expect(diff.patch).toContain('new file mode 120000');
    expect(diff.patch).toContain(`+${join(outside, 'secret')}`);
    expect(diff.patch).not.toContain('outside secret');
    expect(diff.files).toEqual([{ path: 'link', oldPath: null, insertions: 1, deletions: 0, binary: false }]);
  });

  it('refuses whatever the status does not list as an untracked file, and a listed symlink to a directory, before running any diff', async () => {
    writeFileSync(join(outside, 'secret'), 'outside secret\n');
    writeFileSync(join(outside, 'null'), 'outside null\n'); // what `--no-index -- /dev/null escape` would read
    symlinkSync(outside, repo.path('escape'));
    await repo.write('udir/x.txt', 'inner\n');
    await repo.write('.gitignore', 'ignored.log\n');
    await repo.write('ignored.log', 'ignored\n');
    expect((await service.status(repo.root)).files.filter((f) => f.untracked).map((f) => f.path)).toEqual(['.gitignore', 'escape', 'udir/']);
    for (const path of ['escape', 'udir/', 'udir', 'udir/x.txt', 'escape/secret', 'escape/null', '.git/config', 'ignored.log', 'README.md', 'missing.txt', '../outside', `${outside}/secret`]) {
      await expect(service.diff({ directory: repo.root, scope: 'untracked', path }), path).rejects.toThrow(`not an untracked file: ${path}`);
    }
    expect(noIndexCalls()).toEqual([]);
  });

  it('reads names git quotes or tab-ends in its header as the requested path', async () => {
    for (const [path, content] of [['naïve file.txt', 'x\n'], ['sp ace.txt', 'y\n'], ['e mpty.txt', ''], ['q"uote.txt', 'z\n']] as const) {
      await repo.write(path, content);
      const diff = await service.diff({ directory: repo.root, scope: 'untracked', path });
      expect(diff.files, path).toEqual([{ path, oldPath: null, insertions: content === '' ? 0 : 1, deletions: 0, binary: false }]);
    }
  });

  it.each<{ settings: [string, string][] }>([
    { settings: [['diff.mnemonicPrefix', 'true']] },
    { settings: [['diff.noprefix', 'true']] },
    { settings: [['diff.srcPrefix', 'old:'], ['diff.dstPrefix', 'new:']] },
  ])('answers whatever prefixes the configuration asks for ($settings)', async ({ settings }) => {
    for (const [key, value] of settings) await repo.git('config', key, value);
    await repo.write('new.txt', 'one\n');
    const diff = await service.diff({ directory: repo.root, scope: 'untracked', path: 'new.txt' });
    expect(diff.patch.split('\n')[0]).toBe('diff --git a/new.txt b/new.txt');
    expect(diff.files).toEqual([{ path: 'new.txt', oldPath: null, insertions: 1, deletions: 0, binary: false }]);
  });

  it('refuses an answer about another path: the entry became a symlink to a directory between the checks and the diff', async () => {
    writeFileSync(join(outside, 'null'), 'outside null\n');
    await repo.write('brief.txt', 'here\n');
    const swapping: ExecFileFn = (file, args, options, callback) => {
      if (args.includes('--no-index')) {
        rmSync(repo.path('brief.txt'));
        symlinkSync(outside, repo.path('brief.txt'));
      }
      return (execFile as unknown as ExecFileFn)(file, args, options, callback);
    };
    const racing = new GitService({ env: repo.serviceEnv(), execFile: swapping });
    try {
      await expect(racing.diff({ directory: repo.root, scope: 'untracked', path: 'brief.txt' })).rejects.toThrow('not an untracked file: brief.txt');
    } finally {
      racing.dispose();
    }
  });

  it('refuses a listed file that is gone when the diff runs rather than answering an empty patch', async () => {
    await repo.write('brief.txt', 'here\n');
    const vanishing: ExecFileFn = (file, args, options, callback) => {
      if (args.includes('--no-index')) rmSync(repo.path('brief.txt'));
      return (execFile as unknown as ExecFileFn)(file, args, options, callback);
    };
    const racing = new GitService({ env: repo.serviceEnv(), execFile: vanishing });
    try {
      await expect(racing.diff({ directory: repo.root, scope: 'untracked', path: 'brief.txt' })).rejects.toThrow('not an untracked file: brief.txt');
    } finally {
      racing.dispose();
    }
  });

  it('needs a path and refuses a base', async () => {
    await expect(service.diff({ directory: repo.root, scope: 'untracked' })).rejects.toThrow('the untracked scope needs a path');
    await expect(service.diff({ directory: repo.root, scope: 'untracked', path: 'a.txt', base: 'main' })).rejects.toThrow("base applies to scope 'all' only");
  });
});

// E6 (Design §1): after a mutation, main asks the watcher to re-read the checkout's root at once.
describe('git service refreshes a watched root on demand', () => {
  let repo: GitFixture;
  let service: GitService;
  let events: GitChanged[];
  beforeEach(async () => {
    repo = await GitFixture.create();
    events = [];
    // Watches that never deliver an event: whatever is emitted after the settle pass came from the refresh.
    service = new GitService({ env: repo.serviceEnv(), emit: (e) => events.push(e), watch: () => ({ close: () => {}, on: () => {} }) });
  });
  afterEach(() => {
    service.dispose();
    repo.dispose();
  });

  it('re-reads the root of a directory inside it and emits the moved status; an unwatched repository is left alone', async () => {
    await repo.write('sub/a.txt', 'a\n');
    await service.watch(repo.root);
    await new Promise((resolve) => setTimeout(resolve, 400)); // past the settle pass
    expect(events.map((e) => e.reason)).toEqual(['initial']);
    await repo.git('add', 'sub/a.txt');
    service.refresh(repo.path('sub'));
    await vi.waitFor(() => expect(events).toHaveLength(2), { timeout: 3000 });
    expect(events[1].status.files).toEqual([{ path: 'sub/a.txt', oldPath: null, index: 'A', worktree: '.', untracked: false }]);

    const other = await GitFixture.create();
    try {
      service.refresh(other.root);
      service.refresh(tmpdir()); // not a repository: nothing to refresh, nothing thrown
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(events).toHaveLength(2);
    } finally {
      other.dispose();
    }
  });
});

// UX wave U5b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md, Interfaces §C): the branch
// read, the commit read and the working-tree read over scratch repositories. Remote refs are written with `update-ref`,
// as a fetch leaves them; nothing reaches a network.
describe('the three reads', () => {
  let repo: GitFixture;
  let service: GitService;
  let initial: string;
  let outside: string;
  beforeEach(async () => {
    repo = await GitFixture.create();
    service = new GitService({ env: repo.serviceEnv() });
    initial = await rev('HEAD');
    outside = realpathSync(mkdtempSync(join(tmpdir(), 'maws-git-outside-')));
    writeFileSync(join(outside, 'secret.txt'), 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n'); // seven lines, never counted
  });
  afterEach(() => {
    service.dispose();
    repo.dispose();
    rmSync(outside, { recursive: true, force: true });
  });

  async function rev(name: string): Promise<string> {
    return (await repo.git('rev-parse', name)).trim();
  }
  async function commit(path: string, content: string, message = path): Promise<string> {
    await repo.write(path, content);
    await repo.git('add', path);
    await repo.git('commit', '-q', '-m', message);
    return rev('HEAD');
  }
  // `count` empty commits on top of HEAD, oldest first, without touching the work tree; HEAD's branch moves to the last
  async function emptyCommits(count: number, label: string): Promise<string[]> {
    const tree = await rev('HEAD^{tree}');
    const made: string[] = [];
    for (let i = 1; i <= count; i++) made.push((await repo.git('commit-tree', tree, '-p', made.at(-1) ?? (await rev('HEAD')), '-m', `${label} ${i}`)).trim());
    await repo.git('reset', '-q', '--soft', made.at(-1)!);
    return made;
  }
  const originAt = async (branch: string, sha: string) => {
    if (!(await repo.git('remote')).includes('origin')) await repo.git('remote', 'add', 'origin', 'https://example.invalid/origin.git');
    await repo.git('update-ref', `refs/remotes/origin/${branch}`, sha);
  };
  const track = async (branch: string) => {
    await repo.git('config', `branch.${branch}.remote`, 'origin');
    await repo.git('config', `branch.${branch}.merge`, `refs/heads/${branch}`);
  };
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n';

  describe('git.branchCommits', () => {
    it('reads 60 commits since the base, 55 of them not pushed: 50 rows at limit 50, counts of the whole range, pushed by the upstream', async () => {
      await originAt('main', initial);
      await repo.git('checkout', '-q', '-b', 'feature');
      const made = await emptyCommits(60, 'step');
      await originAt('feature', made[4]); // the first five are pushed
      await track('feature');

      const cut = await service.branchCommits({ directory: repo.root, limit: 50 });
      expect(cut.base).toEqual({ ref: 'origin/main', mergeBase: initial });
      expect(cut.upstream).toBe('origin/feature');
      expect(cut.commits).toHaveLength(50);
      expect(cut.commits.map((c) => c.sha)).toEqual(made.slice(10).reverse()); // newest first
      expect(cut.counts).toEqual({ all: 60, notPushed: 55, pushed: 5 });
      expect(cut.behind).toBe(0);
      expect(cut.commits.every((c) => c.pushed === false)).toBe(true);

      const whole = await service.branchCommits({ directory: repo.root, limit: 200 });
      expect(whole.commits).toHaveLength(60);
      for (const row of whole.commits) expect(row.pushed, row.subject).toBe(made.indexOf(row.sha) < 5);
      expect(whole.commits.at(-1)).toMatchObject({ subject: 'step 1', parents: [initial], pushed: true });
    });

    it('names the upstream as git.status names it', async () => {
      await originAt('main', initial);
      await track('main');
      expect((await service.branchCommits({ directory: repo.root, limit: 5 })).upstream).toBe((await service.status(repo.root)).upstream);
    });

    it('marks every row not pushed with no upstream, and pushed unknown with an upstream whose ref was deleted', async () => {
      await originAt('main', initial);
      await repo.git('checkout', '-q', '-b', 'feature');
      await emptyCommits(3, 'local');
      const untracked = await service.branchCommits({ directory: repo.root, limit: 10 });
      expect(untracked).toMatchObject({ upstream: null, counts: { all: 3, notPushed: 3, pushed: 0 } });
      expect(untracked.commits.map((c) => c.pushed)).toEqual([false, false, false]);

      await originAt('feature', await rev('HEAD~1'));
      await track('feature');
      await repo.git('update-ref', '-d', 'refs/remotes/origin/feature'); // as a pruning fetch leaves a deleted branch
      const gone = await service.branchCommits({ directory: repo.root, limit: 10 });
      expect((await service.status(repo.root)).upstream).toBe('origin/feature');
      expect(gone).toMatchObject({ upstream: 'origin/feature', counts: { all: 3, notPushed: null, pushed: null } });
      expect(gone.commits.map((c) => c.pushed)).toEqual([null, null, null]);
    });

    it('with no base, answers the newest commits of HEAD with no counts and no behind', async () => {
      await emptyCommits(4, 'on main'); // HEAD on main, no remote copy: no base
      const read = await service.branchCommits({ directory: repo.root, limit: 3 });
      expect(read).toMatchObject({ base: null, upstream: null, counts: null, behind: null });
      expect(read.commits.map((c) => c.subject)).toEqual(['on main 4', 'on main 3', 'on main 2']);
    });

    it('answers no commits and no base in a repository with no commit', async () => {
      await repo.git('checkout', '-q', '--orphan', 'empty');
      expect(await service.branchCommits({ directory: repo.root, limit: 5 })).toEqual({ base: null, upstream: null, commits: [], counts: null, behind: null });
    });

    // S21's services half: a fetch moves only the base's remote-tracking ref (a pull request of the branch merged there),
    // with HEAD and the upstream standing still; the read asked again answers the new merge base and behind
    it('answers the moved merge base and behind once only refs/remotes/origin/main advances', async () => {
      await originAt('main', initial);
      await repo.git('checkout', '-q', '-b', 'feature/x');
      const made = await emptyCommits(4, 'feature');
      await originAt('feature/x', made[3]);
      await track('feature/x');
      expect(await service.branchCommits({ directory: repo.root, limit: 10 })).toMatchObject({ base: { mergeBase: initial }, counts: { all: 4 }, behind: 0 });

      const tree = await rev('HEAD^{tree}');
      const merged = (await repo.git('commit-tree', tree, '-p', initial, '-p', made[1], '-m', 'merge the first two')).trim();
      await repo.git('update-ref', 'refs/remotes/origin/main', merged);
      const after = await service.branchCommits({ directory: repo.root, limit: 10 });
      expect(after).toMatchObject({ base: { ref: 'origin/main', mergeBase: made[1] }, counts: { all: 2, notPushed: 0, pushed: 2 }, behind: 1 });
      expect(after.commits.map((c) => c.sha)).toEqual([made[3], made[2]]);
    });
    // The branch's max panel, ruling 4 (Decision Log 52): one snapshot of HEAD and the upstream for every subprocess of
    // the read. HEAD moves while the read runs (after the whole range is counted, before the upstream's half is listed),
    // by more commits than the upstream holds, so a read that asked HEAD again would count more not pushed than in all.
    it('reads one snapshot of HEAD and the upstream: HEAD moving during the read leaves all = pushed + notPushed, none negative', async () => {
      await originAt('main', initial);
      await repo.git('checkout', '-q', '-b', 'feature');
      const made = await emptyCommits(10, 'step');
      await originAt('feature', made[1]); // the first two are pushed
      await track('feature');
      const tree = await rev('HEAD^{tree}');
      const real = execFile as unknown as ExecFileFn;
      let counted!: () => void;
      const wholeCounted = new Promise<void>((resolve) => (counted = resolve));
      let moved = false;
      const spawn: ExecFileFn = (file, args, options, callback) => {
        const revList = args.indexOf('rev-list');
        const whole = revList !== -1 && args.includes('--count') && args.includes(`^${initial}`);
        const notPushed = revList !== -1 && !args.includes('--count');
        if (whole) return real(file, args, options, (error, stdout, stderr) => (callback(error, stdout, stderr), counted()));
        if (!notPushed) return real(file, args, options, callback);
        void wholeCounted.then(async () => {
          let at = await rev('HEAD');
          for (let i = 1; i <= 5; i++) at = (await repo.git('commit-tree', tree, '-p', at, '-m', `moved ${i}`)).trim();
          await repo.git('reset', '-q', '--soft', at);
          moved = true;
          real(file, args, options, callback);
        });
      };
      const spied = new GitService({ execFile: spawn, env: repo.serviceEnv() });
      try {
        const read = await spied.branchCommits({ directory: repo.root, limit: 50 });
        expect(moved).toBe(true);
        expect(await rev('HEAD')).not.toBe(made[9]); // HEAD did move during the read
        expect(read.counts).toEqual({ all: 10, notPushed: 8, pushed: 2 });
        expect(read.counts!.all).toBe(read.counts!.notPushed! + read.counts!.pushed!);
        expect(read.commits.map((c) => c.sha)).toEqual([...made].reverse());
        expect(read.commits.map((c) => c.pushed)).toEqual([...made].reverse().map((sha) => made.indexOf(sha) < 2));
      } finally {
        spied.dispose();
      }
    });
  });

  describe('git.commitDiff', () => {
    it('reads a commit against its first parent, one file of it alone, and whether HEAD holds it', async () => {
      await commit('a.txt', 'one\n');
      const both = await commit('b.txt', 'two\n', 'two files');
      await repo.write('a.txt', 'one\nmore\n');
      await repo.git('add', 'a.txt');
      await repo.git('commit', '-q', '-m', 'edit a');
      const read = await service.commitDiff({ directory: repo.root, commit: both });
      expect(read.commit).toMatchObject({ sha: both, subject: 'two files' });
      expect(read.onHead).toBe(true);
      expect(read.files).toEqual([{ path: 'b.txt', oldPath: null, insertions: 1, deletions: 0, binary: false }]);
      expect(read.patch).toContain('diff --git a/b.txt b/b.txt');
      expect((await service.commitDiff({ directory: repo.root, commit: both, path: 'a.txt' })).files).toEqual([]);

      await repo.git('checkout', '-q', '-b', 'side', initial);
      expect((await service.commitDiff({ directory: repo.root, commit: both, patch: false })).onHead).toBe(false);
    });

    it('reads a merge commit against its first parent, never a combined diff', async () => {
      await repo.git('checkout', '-q', '-b', 'side');
      await commit('side.txt', 'side\n');
      await repo.git('checkout', '-q', 'main');
      await commit('main.txt', 'main\n');
      await repo.git('merge', '-q', '--no-edit', 'side');
      const merge = await rev('HEAD');
      const read = await service.commitDiff({ directory: repo.root, commit: merge });
      expect(read.commit.parents).toHaveLength(2);
      expect(read.files.map((f) => f.path)).toEqual(['side.txt']); // what the merge brought onto main
      expect(read.patch).not.toContain('diff --cc');
    });

    it('reads a commit with no parent with every line added', async () => {
      const read = await service.commitDiff({ directory: repo.root, commit: initial, context: 0 });
      expect(read.commit.parents).toEqual([]);
      expect(read.files).toEqual([{ path: 'README.md', oldPath: null, insertions: 1, deletions: 0, binary: false }]);
      expect(read.patch.startsWith('diff --git a/README.md b/README.md\nnew file mode')).toBe(true);
      expect((await service.commitDiff({ directory: repo.root, commit: initial, path: 'other.txt' })).files).toEqual([]);
    });

    it('answers patch: false with the commit and onHead alone, running no diff', async () => {
      const spawn = vi.fn(execFile as unknown as ExecFileFn);
      const spied = new GitService({ execFile: spawn, env: repo.serviceEnv() });
      try {
        expect(await spied.commitDiff({ directory: repo.root, commit: initial, patch: false })).toMatchObject({ onHead: true, patch: '', files: [] });
        const ran = spawn.mock.calls.map(([, args]) => args.slice(2));
        expect(ran.some((args) => args.includes('diff') || args.includes('-p') || args.includes('--numstat'))).toBe(false);
      } finally {
        spied.dispose();
      }
    });

    it('refuses a hash that names no commit, and one that names a tree, with a message that says so', async () => {
      const missing = 'f'.repeat(40);
      await expect(service.commitDiff({ directory: repo.root, commit: missing })).rejects.toThrow(`no commit ${missing} in this repository`);
      const tree = await rev('HEAD^{tree}');
      await expect(service.commitDiff({ directory: repo.root, commit: tree })).rejects.toThrow(`no commit ${tree} in this repository`);
    });

    // Review fix 1: a path is a literal pathspec after `--`, never an option; a file named like the commit's whole id
    // leaves the revisions revisions; a path outside the repository reads nothing outside it
    it('reads an option-shaped path as a literal path, a file named like a whole id as a file, and answers nothing for a path outside the repository', async () => {
      const parent = initial;
      await repo.write('--output=x', 'option-shaped\n');
      await repo.write('-p', 'dash p\n');
      await repo.write(parent, 'named like the parent\n'); // a file whose name is the parent's whole id
      await repo.git('add', '--', '--output=x', '-p', parent);
      await repo.git('commit', '-q', '-m', 'odd names');
      const odd = await rev('HEAD');
      await repo.write(odd, 'named like the commit itself\n'); // untracked: `odd` is both a revision and a file here
      for (const path of ['--output=x', '-p']) {
        const read = await service.commitDiff({ directory: repo.root, commit: odd, path });
        expect(read.files, path).toEqual([{ path, oldPath: null, insertions: 1, deletions: 0, binary: false }]);
      }
      expect(existsSync(repo.path('x'))).toBe(false); // no `--output` was obeyed
      const whole = await service.commitDiff({ directory: repo.root, commit: odd });
      expect(whole.files.map((f) => f.path).sort()).toEqual(['--output=x', '-p', parent].sort());
      // `:(top,literal)../…` names no path of the repository: git answers nothing (a file of that name beside it unread)
      writeFileSync(join(repo.root, '..', `${basename(repo.root)}-outside.txt`), 'outside\n');
      try {
        expect(await service.commitDiff({ directory: repo.root, commit: odd, path: `../${basename(repo.root)}-outside.txt` })).toMatchObject({ patch: '', files: [] });
      } finally {
        rmSync(join(repo.root, '..', `${basename(repo.root)}-outside.txt`), { force: true });
      }
    });

    it('reads a SHA-256 repository\'s root commit and the commit after it', async () => {
      const sha256 = realpathSync(mkdtempSync(join(tmpdir(), 'maws-git-sha256-')));
      try {
        const git = (...args: string[]) => runGit(sha256, args);
        await git('init', '-q', '--object-format=sha256', '-b', 'main');
        writeFileSync(join(sha256, 'first.txt'), 'one\ntwo\n');
        await git('add', 'first.txt');
        await git('commit', '-q', '-m', 'root');
        writeFileSync(join(sha256, 'first.txt'), 'one\ntwo\nthree\n');
        await git('commit', '-q', '-am', 'next');
        const [root, next] = [(await git('rev-parse', 'HEAD~1')).trim(), (await git('rev-parse', 'HEAD')).trim()];
        expect(root).toMatch(/^[0-9a-f]{64}$/);
        expect((await service.commitDiff({ directory: sha256, commit: root })).files).toEqual([{ path: 'first.txt', oldPath: null, insertions: 2, deletions: 0, binary: false }]);
        expect((await service.commitDiff({ directory: sha256, commit: next })).files).toEqual([{ path: 'first.txt', oldPath: null, insertions: 1, deletions: 0, binary: false }]);
      } finally {
        rmSync(sha256, { recursive: true, force: true });
      }
    });
  });

  describe('git.changesSince', () => {
    // The branch's max panel, ruling 4's sibling (Decision Log 52): the working tree against HEAD names one commit in both
    // its subprocesses. HEAD moves between the patch and the counts (to a commit holding the working tree's edit), so a
    // read that asked HEAD again would list no file beside a patch that shows one.
    it('reads HEAD once against HEAD: HEAD moving between the patch and the counts leaves them agreeing', async () => {
      await commit('a.txt', 'one\n');
      await repo.write('a.txt', 'one\ntwo\n');
      const real = execFile as unknown as ExecFileFn;
      let patched!: () => void;
      const patchRead = new Promise<void>((resolve) => (patched = resolve));
      let moved = false;
      const spawn: ExecFileFn = (file, args, options, callback) => {
        const diff = args.includes('diff');
        if (diff && !args.includes('--numstat')) return real(file, args, options, (error, stdout, stderr) => (callback(error, stdout, stderr), patched()));
        if (!(diff && args.includes('--numstat'))) return real(file, args, options, callback);
        void patchRead.then(async () => {
          await repo.git('commit', '-q', '-am', 'the edit, committed meanwhile');
          moved = true;
          real(file, args, options, callback);
        });
      };
      const spied = new GitService({ execFile: spawn, env: repo.serviceEnv() });
      try {
        const read = await spied.changesSince({ directory: repo.root, against: 'HEAD' });
        expect(moved).toBe(true);
        expect(read.patch).toContain('+two');
        expect(read.files.map((f) => [f.path, f.insertions, f.deletions])).toEqual([['a.txt', 1, 0]]);
      } finally {
        spied.dispose();
      }
    });

    // Review fix 1, the same three for the working-tree read
    it('reads an option-shaped path as a literal path, a file named like a whole id as a file, and answers nothing for a path outside the repository', async () => {
      await repo.write('--output=x', 'option-shaped\n');
      await repo.write('-p', 'dash p\n');
      await repo.git('add', '--', '--output=x', '-p');
      await repo.git('commit', '-q', '-m', 'odd names');
      const against = await rev('HEAD');
      await repo.write('--output=x', 'option-shaped\nedited\n');
      await repo.write('-p', 'dash p\nedited\n');
      await repo.write(against, 'named like the commit compared against\n'); // `against` is both a revision and a new file
      for (const path of ['--output=x', '-p']) {
        const read = await service.changesSince({ directory: repo.root, against, path });
        expect(read.files, path).toEqual([{ path, oldPath: null, insertions: 1, deletions: 0, binary: false }]);
      }
      expect(existsSync(repo.path('x'))).toBe(false);
      const whole = await service.changesSince({ directory: repo.root, against });
      expect(whole.files.map((f) => f.path).sort()).toEqual(['--output=x', '-p'].sort());
      expect(whole.untracked).toEqual([{ path: against, insertions: 1, binary: false }]);
      writeFileSync(join(repo.root, '..', `${basename(repo.root)}-outside.txt`), 'outside\n');
      try {
        expect(await service.changesSince({ directory: repo.root, against, path: `../${basename(repo.root)}-outside.txt` })).toEqual({ patch: '', files: [], untracked: [] });
      } finally {
        rmSync(join(repo.root, '..', `${basename(repo.root)}-outside.txt`), { force: true });
      }
    });

    it('against HEAD answers what git.diff\'s all scope answers for the same tree', async () => {
      await commit('kept.txt', 'kept\n');
      await repo.write('README.md', 'hello\nedited\n');
      await repo.write('kept.txt', 'kept\nand staged\n');
      await repo.git('add', 'kept.txt');
      const since = await service.changesSince({ directory: repo.root, against: 'HEAD' });
      const all = await service.diff({ directory: repo.root, scope: 'all' });
      expect({ patch: since.patch, files: since.files }).toEqual(all);
      expect(since.untracked).toEqual([]);
    });

    it('against a merge base lists a committed change, an uncommitted edit and a new file of twelve lines counted 12', async () => {
      await repo.git('checkout', '-q', '-b', 'feature');
      await commit('committed.txt', 'committed\n');
      await repo.write('README.md', 'hello\nuncommitted\n');
      await repo.write('notes/new.md', lines(12));
      const since = await service.changesSince({ directory: repo.path('notes'), against: initial });
      expect(since.files.map((f) => f.path).sort()).toEqual(['README.md', 'committed.txt']);
      expect(since.patch).toContain('+uncommitted');
      expect(since.untracked).toEqual([]); // the status lists the new folder as `notes/`, which is not a file
      await repo.write('top.md', lines(12));
      expect((await service.changesSince({ directory: repo.root, against: initial })).untracked).toEqual([{ path: 'top.md', insertions: 12, binary: false }]);
    });

    it('counts a binary new file as binary with no count, and a symbolic link to a file outside the repository 1 without opening it', async () => {
      await repo.write('image.bin', 'GIF89a\0\u0001\n');
      symlinkSync(join(outside, 'secret.txt'), repo.path('link.txt'));
      const { untracked } = await service.changesSince({ directory: repo.root, against: 'HEAD' });
      expect(untracked).toEqual([
        { path: 'image.bin', insertions: null, binary: true },
        { path: 'link.txt', insertions: 1, binary: false },
      ]);
    });

    it('reads nothing outside when a file, or an ancestor directory, is replaced by a link between the listing and the read', async () => {
      await repo.write('swapped.txt', lines(12));
      await repo.write('dir/inner.txt', lines(12));
      await repo.git('add', 'dir/inner.txt');
      await repo.git('commit', '-q', '-m', 'a tracked folder');
      await repo.write('dir/fresh.txt', lines(12)); // listed as itself: its folder is tracked
      const hooked = new GitService({
        env: repo.serviceEnv(),
        countHooks: {
          beforeOpen: (path) => {
            if (path === repo.path('swapped.txt')) {
              rmSync(path);
              symlinkSync(join(outside, 'secret.txt'), path);
            }
            if (path === repo.path('dir/fresh.txt')) {
              renameSync(repo.path('dir'), repo.path('moved-away'));
              writeFileSync(join(outside, 'fresh.txt'), 'outside\n'.repeat(7));
              symlinkSync(outside, repo.path('dir'));
            }
          },
        },
      });
      try {
        const { untracked } = await hooked.changesSince({ directory: repo.root, against: 'HEAD' });
        expect(untracked).toEqual([
          { path: 'dir/fresh.txt', insertions: null, binary: false }, // through the linked folder: no count
          { path: 'swapped.txt', insertions: 1, binary: false }, // a link now, counted as its one line; the target unread
        ]);
      } finally {
        hooked.dispose();
      }
    });

    it('gives a new file that grows past the cap during the read no count', async () => {
      await repo.write('growing.log', lines(3));
      const hooked = new GitService({ env: repo.serviceEnv(), countHooks: { afterOpen: (path) => appendFileSync(path, 'x'.repeat(2 * 1024 * 1024)) } });
      try {
        expect((await hooked.changesSince({ directory: repo.root, against: 'HEAD' })).untracked).toEqual([{ path: 'growing.log', insertions: null, binary: false }]);
      } finally {
        hooked.dispose();
      }
    });

    it('counts the first 200 new files the status lists, so file 201 has no entry, and none with a path', async () => {
      for (let i = 0; i < 201; i++) writeFileSync(repo.path(`new-${String(i).padStart(3, '0')}.txt`), lines(1));
      const { untracked } = await service.changesSince({ directory: repo.root, against: 'HEAD' });
      expect(untracked).toHaveLength(200);
      expect(untracked.at(-1)).toEqual({ path: 'new-199.txt', insertions: 1, binary: false });
      expect(untracked.some((entry) => entry.path === 'new-200.txt')).toBe(false);
      expect((await service.changesSince({ directory: repo.root, against: 'HEAD', path: 'new-000.txt' })).untracked).toEqual([]);
    });
  });

  it('runs only reads: config, for-each-ref, symbolic-ref, rev-parse, merge-base, rev-list, log, status and diff', async () => {
    await originAt('main', initial);
    await repo.git('checkout', '-q', '-b', 'feature');
    await commit('f.txt', 'f\n');
    await repo.write('new.txt', 'new\n');
    const spawn = vi.fn(execFile as unknown as ExecFileFn);
    const spied = new GitService({ execFile: spawn, env: repo.serviceEnv() });
    try {
      await spied.branchCommits({ directory: repo.root, limit: 5 });
      await spied.commitDiff({ directory: repo.root, commit: await rev('HEAD') });
      await spied.commitDiff({ directory: repo.root, commit: initial });
      await spied.changesSince({ directory: repo.root, against: initial });
    } finally {
      spied.dispose();
    }
    const subcommands = new Set(spawn.mock.calls.map(([, args]) => (args[2] === '-c' ? args[4] : args[2])));
    expect([...subcommands].sort()).toEqual(['config', 'diff', 'for-each-ref', 'log', 'merge-base', 'rev-list', 'rev-parse', 'status', 'symbolic-ref']);
  });
});
