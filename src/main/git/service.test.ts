import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitStatusSchema } from '@shared/ipc/schema/git';
import { GitFixture } from '../../../test/support/git-fixture';
import { GitTimeoutError, NotARepositoryError, type ExecFileFn } from './runner';
import { GitService } from './service';

// Every test runs git against a temporary repository the fixture made; never this checkout or the owner's repositories.
describe('git service answers status, branches, diff and log', () => {
  let repo: GitFixture;
  let service: GitService;
  beforeEach(async () => {
    repo = await GitFixture.create();
    service = new GitService();
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
      expect(options).toMatchObject({ timeout: 10_000, maxBuffer: 64 * 1024 * 1024 });
      // Exactly this environment: the caller's GIT_DIR (or any other git variable) never reaches the child.
      expect(options.env).toEqual({ PATH: '/usr/bin:/bin', HOME: '/Users/nobody', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' });
      subcommands.add(args[2] === 'stash' || args[2] === 'remote' ? `${args[2]} ${args[3]}` : args[2]);
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
