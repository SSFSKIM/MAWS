import { chmodSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitFixture } from '../../../test/support/git-fixture';
import { createMutatingRunner, MUTATING_SUBCOMMANDS } from './mutate';
import { GitCommandError, GitTimeoutError, type ExecFileFn } from './runner';

function answering(stdout: string, stderr: string, code = 0): ExecFileFn {
  return vi.fn<ExecFileFn>((_file, _args, _options, callback) => {
    const error = code === 0 ? null : Object.assign(new Error(`Git exited with ${code}`), { code });
    queueMicrotask(() => callback(error, stdout, stderr));
  });
}

describe('mutating runner refuses subcommands off the allowlist', () => {
  it('names exactly the local mutations', () => {
    expect(MUTATING_SUBCOMMANDS).toEqual(['add', 'restore', 'rm', 'clean', 'commit']);
  });

  it.each([
    ['push', 'origin'], ['fetch'], ['pull'], ['ls-remote', 'origin'], ['remote', 'add', 'x', 'y'], ['config', 'core.hooksPath', '/x'],
    ['reset', '--hard'], ['checkout', '.'], ['stash'], ['worktree', 'add', 'x'], ['-c', 'core.hooksPath=/x', 'commit'], ['--exec-path=/tmp', 'add'], [''], [],
  ].map((args) => ({ args })))(
    'refuses $args before reading the environment or spawning', async ({ args }) => {
      const execFile = answering('', '');
      const captured = vi.fn(async () => ({ PATH: '/usr/bin' }));
      const run = createMutatingRunner({ env: {}, captured, execFile });
      await expect(run('/repo', args, { timeoutMs: 1000 })).rejects.toThrow(/not an allowed mutation/);
      expect(execFile).not.toHaveBeenCalled();
      expect(captured).not.toHaveBeenCalled();
    },
  );

  it('runs an allowed subcommand with MAWS_GIT, -C and the mutate environment built from the capture', async () => {
    const execFile = answering('staged\n', 'warning: LF\n');
    const run = createMutatingRunner({ env: { MAWS_GIT: '/opt/git', PATH: '/usr/bin' }, captured: async () => ({ PATH: '/opt/homebrew/bin:/usr/bin', HOME: '/Users/o', GIT_DIR: '/x' }), execFile });
    expect(await run('/repo', ['add', '--', ':(top,literal)a.txt'], { timeoutMs: 1000 })).toEqual({ stdout: 'staged\n', stderr: 'warning: LF\n' });
    const [file, args, options] = vi.mocked(execFile).mock.calls[0];
    expect(file).toBe('/opt/git');
    expect(args).toEqual(['-C', '/repo', 'add', '--', ':(top,literal)a.txt']);
    expect(options.env).toMatchObject({ PATH: '/opt/homebrew/bin:/usr/bin', HOME: '/Users/o', GIT_EDITOR: 'true', GIT_ALLOW_PROTOCOL: '' });
    expect(options.env).not.toHaveProperty('GIT_DIR');
  });

  it('answers a non-zero exit as GitCommandError with the exit code and both streams', async () => {
    const run = createMutatingRunner({ env: {}, captured: async () => ({}), execFile: answering('nope\n', 'husky - pre-commit failed\n', 1) });
    const error = await run('/repo', ['commit', '-m', 'x'], { timeoutMs: 1000 }).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(GitCommandError);
    expect(error).toMatchObject({ exitCode: 1, stdout: 'nope\n', stderr: 'husky - pre-commit failed\n' });
  });

  it('honours timeoutMs', async () => {
    vi.useFakeTimers();
    try {
      const run = createMutatingRunner({ env: {}, captured: async () => ({}), execFile: () => {} });
      let error: unknown = null;
      void run('/repo', ['commit', '-m', 'x'], { timeoutMs: 60_000 }).catch((e: unknown) => (error = e));
      await vi.advanceTimersByTimeAsync(59_000);
      expect(error).toBeNull();
      await vi.advanceTimersByTimeAsync(1_600);
      expect(error).toBeInstanceOf(GitTimeoutError);
      expect((error as Error).message).toBe('git commit timed out after 60 s in /repo');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the last 256 KiB of each stream on success', async () => {
    const big = `${'x'.repeat(300 * 1024)}end`;
    const run = createMutatingRunner({ env: {}, captured: async () => ({}), execFile: answering(big, big) });
    const { stdout, stderr } = await run('/repo', ['add', '--', 'a'], { timeoutMs: 1000 });
    expect([stdout.length, stderr.length]).toEqual([256 * 1024, 256 * 1024]);
    expect(stdout.endsWith('end')).toBe(true);
  });
});

describe('mutating runner against a scratch repository', () => {
  let repo: GitFixture;
  beforeEach(async () => {
    repo = await GitFixture.create();
    await repo.git('config', 'user.name', 'Panel');
    await repo.git('config', 'user.email', 'panel@maws.invalid');
  });
  afterEach(() => repo.dispose());

  // Git runs a commit hook with its stdout sent to git's stderr, so a hook's words arrive on stderr whichever stream it
  // wrote; the error keeps both, which is what the panel's notice joins.
  it('commits with the hook seeing the captured environment, and a hook failing on stdout alone keeps its words and HEAD', async () => {
    const seen = repo.path('hook-env');
    chmodSync(await repo.write('.git/hooks/pre-commit', `#!/bin/sh\nprintf '%s' "$FROM_SHELL" > '${seen}'\n`), 0o755);
    const captured = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: repo.home, FROM_SHELL: 'login shell', GIT_DIR: '/nonexistent/.git' };
    const run = createMutatingRunner({ env: {}, captured: async () => captured });
    await repo.write('a.txt', 'a\n');
    await run(repo.root, ['add', '--', ':(top,literal)a.txt'], { timeoutMs: 10_000 });
    await run(repo.root, ['commit', '-m', 'From the panel\n\nbody kept whole'], { timeoutMs: 60_000 });
    expect(readFileSync(seen, 'utf8')).toBe('login shell');
    expect(await repo.git('log', '-1', '--format=%B')).toBe('From the panel\n\nbody kept whole\n\n');

    const head = await repo.git('rev-parse', 'HEAD');
    chmodSync(await repo.write('.git/hooks/pre-commit', '#!/bin/sh\necho nope\nexit 1\n'), 0o755);
    await repo.write('a.txt', 'b\n');
    await run(repo.root, ['add', '--', ':(top,literal)a.txt'], { timeoutMs: 10_000 });
    const error = await run(repo.root, ['commit', '-m', 'refused'], { timeoutMs: 60_000 }).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(GitCommandError);
    expect(error).toMatchObject({ exitCode: 1, message: 'git commit failed: nope' });
    const { stdout, stderr } = error as GitCommandError;
    expect(`${stdout}${stderr}`).toContain('nope');
    expect(await repo.git('rev-parse', 'HEAD')).toBe(head);
  });
});
