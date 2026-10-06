import { chmodSync, existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitFixture } from '../../../test/support/git-fixture';
import { createGitRunner, execGit, GitCommandError, gitEnv, GitTimeoutError, NotARepositoryError, spawnGit, type ExecFileFn } from './runner';

// The `GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` pairs an environment carries, in order.
function configOf(env: NodeJS.ProcessEnv): [string, string | undefined][] {
  return Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, i) => [env[`GIT_CONFIG_KEY_${i}`]!, env[`GIT_CONFIG_VALUE_${i}`]]);
}

// A stand-in for execFile that answers once, as a git that exited with `code` would.
function answering(stdout: string, stderr: string, code: number | null = 0): ExecFileFn {
  return (_file, _args, _options, callback) => {
    const error = code === 0 ? null : Object.assign(new Error(`Git exited with ${code}`), { code: code ?? undefined });
    queueMicrotask(() => callback(error, stdout, stderr));
  };
}

const SAFETY = [
  ['core.fsmonitor', 'false'],
  ['credential.helper', ''],
  ['log.showSignature', 'false'],
  ['safe.directory', ''],
];

describe('git runner modes keep transport off and hooks per mode', () => {
  const inherited = { PATH: '/usr/bin:/bin', HOME: '/Users/nobody', GIT_DIR: '/elsewhere', GIT_CONFIG_PARAMETERS: "'core.hooksPath=/evil'", FOO: 'bar' };

  it('read is the environment it always was, key for key, and the default', () => {
    const expected = {
      PATH: '/usr/bin:/bin',
      HOME: '/Users/nobody',
      GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'false',
      GIT_CONFIG_KEY_1: 'credential.helper', GIT_CONFIG_VALUE_1: '',
      GIT_CONFIG_KEY_2: 'log.showSignature', GIT_CONFIG_VALUE_2: 'false',
      GIT_CONFIG_KEY_3: 'safe.directory', GIT_CONFIG_VALUE_3: '',
      GIT_CONFIG_KEY_4: 'core.hooksPath', GIT_CONFIG_VALUE_4: '/dev/null',
      GIT_CONFIG_COUNT: '5',
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
      LC_ALL: 'C',
      GIT_PAGER: 'cat',
      GIT_EXTERNAL_DIFF: '/usr/bin/false',
      GIT_SSH_COMMAND: '/usr/bin/false',
      GIT_ALLOW_PROTOCOL: '',
    };
    expect(gitEnv(inherited, 'read')).toEqual(expected);
    expect(gitEnv(inherited)).toEqual(expected);
  });

  it('checkout is read without core.hooksPath, so worktree add runs checkout hooks', () => {
    const env = gitEnv(inherited, 'checkout');
    expect(configOf(env)).toEqual(SAFETY);
    const read = gitEnv(inherited, 'read');
    delete read.GIT_CONFIG_KEY_4;
    delete read.GIT_CONFIG_VALUE_4;
    expect(env).toEqual({ ...read, GIT_CONFIG_COUNT: '4' });
  });

  it('mutate takes the captured shell environment without its git, parent-session or launcher variables, and keeps transport off', () => {
    const captured = {
      PATH: '/opt/homebrew/bin:/usr/bin:/bin',
      HOME: '/Users/owner',
      LANG: 'en_US.UTF-8',
      SSH_AUTH_SOCK: '/private/tmp/agent.sock',
      GPG_TTY: '/dev/ttys001',
      GIT_DIR: '/elsewhere/.git',
      GIT_INDEX_FILE: '/elsewhere/index',
      GIT_CONFIG_PARAMETERS: "'core.fsmonitor=true'",
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/evil',
      GIT_ASKPASS: '/usr/local/bin/askpass',
      CLAUDE_CODE_SESSION_ID: 'parent', CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1',
      MAWS_E2E: '1', ELECTRON_RUN_AS_NODE: '1',
    };
    const env = gitEnv({ PATH: '/usr/bin:/bin', HOME: '/var/empty', MAWS_GIT: '/opt/git' }, 'mutate', captured);
    expect(env).toMatchObject({ PATH: captured.PATH, HOME: captured.HOME, LANG: captured.LANG, SSH_AUTH_SOCK: captured.SSH_AUTH_SOCK, GPG_TTY: captured.GPG_TTY });
    expect(configOf(env)).toEqual(SAFETY); // no core.hooksPath: the repository's hooks run
    expect(env).toMatchObject({
      GIT_ALLOW_PROTOCOL: '', GIT_SSH_COMMAND: '/usr/bin/false', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0',
      GIT_PAGER: 'cat', GIT_EDITOR: 'true', GIT_EXTERNAL_DIFF: '/usr/bin/false', LC_ALL: 'C',
    });
    // Every git variable is MAWS's own: nothing inherited redirects the repository or injects configuration.
    expect(Object.keys(env).filter((key) => key.startsWith('GIT_')).sort()).toEqual([
      'GIT_ALLOW_PROTOCOL', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_KEY_1', 'GIT_CONFIG_KEY_2', 'GIT_CONFIG_KEY_3',
      'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_VALUE_1', 'GIT_CONFIG_VALUE_2', 'GIT_CONFIG_VALUE_3', 'GIT_EDITOR', 'GIT_EXTERNAL_DIFF',
      'GIT_OPTIONAL_LOCKS', 'GIT_PAGER', 'GIT_SSH_COMMAND', 'GIT_TERMINAL_PROMPT',
    ]);
    for (const name of ['CLAUDE_CODE_SESSION_ID', 'CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'MAWS_E2E', 'MAWS_GIT', 'ELECTRON_RUN_AS_NODE']) expect(env).not.toHaveProperty(name);
  });

  describe('against a scratch repository', () => {
    let repo: GitFixture;
    beforeEach(async () => {
      repo = await GitFixture.create();
      await repo.git('config', 'user.name', 'Panel');
      await repo.git('config', 'user.email', 'panel@maws.invalid');
    });
    afterEach(() => repo.dispose());

    const run = (args: string[], env: NodeJS.ProcessEnv) =>
      spawnGit({ binary: '/usr/bin/git', directory: repo.root, args, env, timeoutMs: 10_000, acceptExitCodes: [], execFile: execGit });

    it('runs the repository pre-commit hook under mutate, never under read', async () => {
      const marker = repo.path('hook-ran');
      chmodSync(await repo.write('.git/hooks/pre-commit', `#!/bin/sh\nprintf ran > '${marker}'\n`), 0o755);
      const captured = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: repo.home };
      await run(['commit', '--allow-empty', '-q', '-m', 'read'], gitEnv(captured, 'read'));
      expect(existsSync(marker)).toBe(false);
      await run(['commit', '--allow-empty', '-q', '-m', 'mutate'], gitEnv({}, 'mutate', captured));
      expect(existsSync(marker)).toBe(true);
      expect((await repo.git('log', '--format=%s')).split('\n')).toEqual(['mutate', 'read', 'initial', '']);
    });

    it('refuses transports under mutate even when the repository allows them', async () => {
      await repo.addBareRemote();
      await repo.git('config', 'protocol.file.allow', 'always');
      const env = gitEnv({}, 'mutate', { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: repo.home });
      await expect(run(['ls-remote', 'origin'], env)).rejects.toThrow("transport 'file' not allowed");
    });
  });
});

describe('git runner keeps both streams on failure and accepts named exit codes', () => {
  let repo: GitFixture;
  beforeEach(async () => {
    repo = await GitFixture.create();
    await repo.write('new.txt', 'one\ntwo\n');
  });
  afterEach(() => repo.dispose());

  const NO_INDEX = ['diff', '--no-color', '--no-ext-diff', '--no-index', '--', '/dev/null', 'new.txt'];

  it('resolves an accepted exit code with its output and code', async () => {
    const answer = await spawnGit({ binary: '/usr/bin/git', directory: repo.root, args: NO_INDEX, env: gitEnv(repo.serviceEnv()), timeoutMs: 10_000, acceptExitCodes: [1], execFile: execGit });
    expect(answer.exitCode).toBe(1);
    expect(answer.stdout).toContain('+++ b/new.txt');
    expect(answer.stderr).toBe('');
    const read = createGitRunner({ env: repo.serviceEnv() });
    expect(await read(repo.root, NO_INDEX, { acceptExitCodes: [1] })).toBe(answer.stdout);
  });

  it('throws GitCommandError with the exit code and both streams when the code is not accepted', async () => {
    const read = createGitRunner({ env: repo.serviceEnv() });
    const error = await read(repo.root, NO_INDEX).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(GitCommandError);
    expect(error).toMatchObject({ exitCode: 1, stderr: '' });
    expect((error as GitCommandError).stdout).toContain('+two');
  });

  it('keeps the last 256 KiB of each stream on a failure', async () => {
    const big = (tail: string) => `${'x'.repeat(300 * 1024)}${tail}`;
    const error = await spawnGit({
      binary: 'git', directory: '/r', args: ['commit'], env: {}, timeoutMs: 1000, acceptExitCodes: [],
      execFile: answering(big('out-end'), `error: the first line\n${big('err-end')}`, 1),
    }).then(() => null, (e: unknown) => e as GitCommandError);
    expect(error).toBeInstanceOf(GitCommandError);
    expect(error!.stdout).toHaveLength(256 * 1024);
    expect(error!.stdout.endsWith('out-end')).toBe(true);
    expect(error!.stderr).toHaveLength(256 * 1024);
    expect(error!.stderr.endsWith('err-end')).toBe(true);
    expect(error!.message).toBe('git commit failed: the first line'); // named from the whole stream, not its kept end
  });

  it('names the failure from stderr, and only the read runner reads "not a git repository" as no repository', async () => {
    const stderr = 'fatal: not a git repository (or any of the parent directories): .git\n';
    const spawned = await spawnGit({ binary: 'git', directory: '/r', args: ['commit'], env: {}, timeoutMs: 1000, acceptExitCodes: [], execFile: answering('hook said so', stderr, 128) })
      .then(() => null, (e: unknown) => e);
    expect(spawned).toBeInstanceOf(GitCommandError); // a hook's own words are kept, whatever they say
    expect(spawned).toMatchObject({ message: 'git commit failed: not a git repository (or any of the parent directories): .git', exitCode: 128, stdout: 'hook said so' });
    await expect(createGitRunner({ execFile: answering('', stderr, 128) })('/r', ['status'])).rejects.toBeInstanceOf(NotARepositoryError);
  });

  it('honours a per-call timeout', async () => {
    vi.useFakeTimers();
    try {
      const hung: ExecFileFn = () => {};
      const pending = createGitRunner({ execFile: hung })('/r', ['commit'], { timeoutMs: 60_000 });
      let error: unknown = null;
      void pending.catch((e: unknown) => (error = e));
      await vi.advanceTimersByTimeAsync(10_600); // past the default 10 s and its grace
      expect(error).toBeNull();
      await vi.advanceTimersByTimeAsync(50_000);
      expect(error).toBeInstanceOf(GitTimeoutError);
      expect((error as Error).message).toBe('git commit timed out after 60 s in /r');
    } finally {
      vi.useRealTimers();
    }
  });
});
