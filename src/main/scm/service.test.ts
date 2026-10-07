// The local service over a fake read runner, a fake status and a fake mutating runner: the argv of every mutation, the
// trust gate's environment, the per-checkout chain, the fresh-status rule and the watcher refresh. The real-repository
// behaviour (hooks, the index on disk) is service.git.test.ts's.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { GitFileStatus, GitStatus } from '@shared/ipc/schema/git';
import { TrustStoreFixture } from '../../../test/support/trust-store';
import { GitCommandError, GitTimeoutError, NotARepositoryError } from '../git/runner';
import { ScmService, type ScmServiceDeps } from './service';

// `realpath` as node answers it, except that a test may hold the first call for one path until it releases it.
// E11: every file `readFile` was asked for, so a test can say what trust read
const fsGate = vi.hoisted(() => ({ path: null as string | null, held: null as Promise<void> | null, reads: [] as string[] }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    realpath: async (path: string) => {
      if (path === fsGate.path && fsGate.held !== null) {
        const held = fsGate.held;
        fsGate.path = null;
        await held;
      }
      return actual.realpath(path);
    },
    readFile: (async (path: string, options?: unknown) => {
      fsGate.reads.push(String(path));
      return actual.readFile(path, options as never);
    }) as typeof actual.readFile,
  };
});

const ID = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;
const OTHER = 'b2222222-2222-4222-8222-222222222222' as AppSessionId;

const file = (path: string, xy: string, oldPath: string | null = null): GitFileStatus =>
  xy === '??' ? { path, oldPath: null, index: '?', worktree: '?', untracked: true } : { path, oldPath, index: xy[0], worktree: xy[1], untracked: false };

describe('scm service', () => {
  let root: string; // the checkout: a real directory, so the trust key is its realpath
  let trust: TrustStoreFixture;
  let files: GitFileStatus[];
  let head: string;
  let read: ReturnType<typeof vi.fn<ScmServiceDeps['read']>>;
  let readStatus: ReturnType<typeof vi.fn<ScmServiceDeps['status']>>;
  let mutate: ReturnType<typeof vi.fn<ScmServiceDeps['mutate']>>;
  let refresh: ReturnType<typeof vi.fn<ScmServiceDeps['refresh']>>;
  let records: Map<AppSessionId, { directory: string; worktree: { path: string; branch: string | null } | null }>;
  let captured: Record<string, string>;

  const statusOf = (directory: string): GitStatus => ({
    repoRoot: directory, gitDir: `${directory}/.git`, commonDir: `${directory}/.git`, isWorktree: false, branch: 'main', head, upstream: 'origin/main',
    remoteUrl: null, ahead: 0, behind: 0, dirty: files.length > 0, files: [...files], stashCount: 0, checkedAt: '2026-10-06T00:00:00.000Z',
  });

  function service(): ScmService {
    return new ScmService({
      records: (id) => records.get(id) ?? null,
      read, status: readStatus, mutate, refresh,
      captured: async () => captured,
      env: {},
      emit: () => {},
      now: () => Date.parse('2026-10-06T12:00:00.000Z'),
    });
  }

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-scm-')));
    trust = new TrustStoreFixture();
    trust.write({ [root]: { hasTrustDialogAccepted: true } });
    captured = { HOME: root, CLAUDE_CONFIG_DIR: trust.configHome };
    files = [file('a.txt', '.M'), file('s.ts', 'M.'), file('new.ts', 'R.', 'old.ts'), file('u.txt', '??'), file('udir/', '??')];
    head = 'abc123';
    records = new Map([[ID, { directory: root, worktree: null }]]);
    read = vi.fn<ScmServiceDeps['read']>(async (directory, args) => {
      if (args[0] === 'rev-parse') return `${directory}\n${directory}/.git\n${directory}/.git\n`; // the trust key's read
      if (args[0] === 'log') return `${'f'.repeat(40)}\0From the panel\n`;
      if (args.join(' ') === 'remote -v') return ''; // scm.status: no remote (E11: one `remote -v`)
      throw new Error(`unexpected read: git ${args.join(' ')}`);
    });
    readStatus = vi.fn<ScmServiceDeps['status']>(async (directory) => statusOf(directory));
    mutate = vi.fn<ScmServiceDeps['mutate']>(async () => ({ stdout: '', stderr: '' }));
    refresh = vi.fn();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    trust.dispose();
    rmSync(root, { recursive: true, force: true });
  });

  describe('builds the exact argv of each mutation', () => {
    it('stages through add with literal top-level pathspecs, a directory entry without its slash', async () => {
      const answer = await service().stage({ appSessionId: ID, paths: ['a.txt', 'udir/'] });
      expect(mutate).toHaveBeenCalledExactlyOnceWith(root, ['add', '--', ':(top,literal)a.txt', ':(top,literal)udir'], { timeoutMs: 10_000 });
      expect(answer).toEqual({ ok: true, status: statusOf(root), output: '' });
    });

    it('unstages through restore --staged, a rename by both names', async () => {
      await service().unstage({ appSessionId: ID, paths: ['s.ts', 'new.ts'] });
      expect(mutate).toHaveBeenCalledExactlyOnceWith(root, ['restore', '--staged', '--', ':(top,literal)s.ts', ':(top,literal)new.ts', ':(top,literal)old.ts'], { timeoutMs: 10_000 });
    });

    it('unstages through rm --cached on an unborn HEAD, which restore cannot resolve', async () => {
      head = '';
      files = [file('a.txt', 'AM')];
      await service().unstage({ appSessionId: ID, paths: ['a.txt'] });
      expect(mutate).toHaveBeenCalledExactlyOnceWith(root, ['rm', '--cached', '-r', '-f', '--', ':(top,literal)a.txt'], { timeoutMs: 10_000 });
    });

    it('discards unstaged entries through restore --worktree and untracked ones through clean, in one operation', async () => {
      await service().discard({ appSessionId: ID, entries: [{ path: 'a.txt', group: 'unstaged' }] });
      expect(mutate).toHaveBeenLastCalledWith(root, ['restore', '--worktree', '--', ':(top,literal)a.txt'], { timeoutMs: 10_000 });
      await service().discard({ appSessionId: ID, entries: [{ path: 'u.txt', group: 'untracked' }] });
      expect(mutate).toHaveBeenLastCalledWith(root, ['clean', '-f', '--', ':(top,literal)u.txt'], { timeoutMs: 10_000 });
      mutate.mockClear();
      mutate.mockResolvedValueOnce({ stdout: '', stderr: '' }).mockResolvedValueOnce({ stdout: 'Removing u.txt\nRemoving udir/\n', stderr: '' });
      const answer = await service().discard({ appSessionId: ID, entries: [{ path: 'u.txt', group: 'untracked' }, { path: 'a.txt', group: 'unstaged' }, { path: 'udir/', group: 'untracked' }] });
      expect(mutate.mock.calls.map(([, args]) => args)).toEqual([
        ['restore', '--worktree', '--', ':(top,literal)a.txt'],
        ['clean', '-f', '-d', '--', ':(top,literal)u.txt', ':(top,literal)udir/'],
      ]);
      expect(answer).toMatchObject({ ok: true, output: 'Removing u.txt\nRemoving udir/' });
    });

    it('commits with the message as one argument, --no-verify only when asked, and answers the new commit', async () => {
      const message = '-From the panel\n\nbody kept whole';
      const answer = await service().commit({ appSessionId: ID, message, noVerify: false });
      expect(mutate).toHaveBeenLastCalledWith(root, ['commit', '-m', message], { timeoutMs: 60_000 });
      expect(read).toHaveBeenLastCalledWith(root, ['log', '-1', '--format=%H%x00%s']);
      expect(answer).toMatchObject({ ok: true, commit: { sha: 'f'.repeat(40), subject: 'From the panel' } });
      await service().commit({ appSessionId: ID, message: 'skip', noVerify: true });
      expect(mutate).toHaveBeenLastCalledWith(root, ['commit', '-m', 'skip', '--no-verify'], { timeoutMs: 60_000 });
    });

    it('acts in a linked worktree when the session has one', async () => {
      const worktree = join(root, 'wt');
      mkdirSync(worktree);
      records.set(ID, { directory: root, worktree: { path: worktree, branch: 'wt' } });
      // a linked worktree's trust key is its main checkout's root, read from the common dir
      const answer = read.getMockImplementation()!;
      read.mockImplementation(async (directory, args) => (args[0] === 'rev-parse' ? `${worktree}\n${root}/.git\n${root}/.git/worktrees/wt\n` : answer(directory, args)));
      await service().stage({ appSessionId: ID, paths: ['a.txt'] });
      expect(readStatus).toHaveBeenCalledWith(worktree);
      expect(mutate).toHaveBeenCalledWith(worktree, expect.any(Array), expect.any(Object));
      expect(refresh).toHaveBeenCalledExactlyOnceWith(worktree);
    });
  });

  describe('reads the status before and after, and asks the watcher once', () => {
    it('validates against the status read before and answers the one read after', async () => {
      readStatus.mockImplementationOnce(async (directory) => statusOf(directory)).mockImplementationOnce(async (directory) => ({ ...statusOf(directory), files: [file('a.txt', 'M.')] }));
      const answer = await service().stage({ appSessionId: ID, paths: ['a.txt'] });
      expect(readStatus).toHaveBeenCalledTimes(2);
      expect(answer).toMatchObject({ ok: true, status: { files: [file('a.txt', 'M.')] } });
      expect(refresh).toHaveBeenCalledExactlyOnceWith(root);
    });

    it('answers changed for a path the fresh status does not list in that state, running nothing', async () => {
      for (const paths of [['nope.txt'], ['s.ts'], ['../a.txt'], [`${root}/a.txt`]]) {
        expect(await service().stage({ appSessionId: ID, paths }), paths[0]).toMatchObject({ refused: 'changed' });
      }
      expect(await service().unstage({ appSessionId: ID, paths: ['a.txt'] })).toMatchObject({ refused: 'changed' });
      expect(await service().discard({ appSessionId: ID, entries: [{ path: 's.ts', group: 'unstaged' }] })).toMatchObject({ refused: 'changed' });
      expect(mutate).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    });

    it('refuses commits and discards the index cannot take', async () => {
      expect(await service().commit({ appSessionId: ID, message: '   ', noVerify: false })).toMatchObject({ refused: 'empty_message' });
      files = [file('a.txt', '.M')];
      expect(await service().commit({ appSessionId: ID, message: 'x', noVerify: false })).toMatchObject({ refused: 'nothing_staged' });
      files = [file('a.txt', 'M.'), file('c.ts', 'UU')];
      expect(await service().commit({ appSessionId: ID, message: 'x', noVerify: false })).toMatchObject({ refused: 'unmerged' });
      expect(await service().discard({ appSessionId: ID, entries: [{ path: 'c.ts', group: 'unstaged' }] })).toMatchObject({ refused: 'unmerged' });
      expect(await service().stage({ appSessionId: ID, paths: ['c.ts'] })).toMatchObject({ ok: true }); // marks it resolved
      expect(mutate).toHaveBeenCalledOnce();
    });

    it("answers git's failure as git_failed with both streams, stdout first, and still asks the watcher", async () => {
      mutate.mockRejectedValueOnce(new GitCommandError('git commit failed: nope', 'nope\nhusky - pre-commit failed\n', 1, 'lint: 2 problems\n'));
      const answer = await service().commit({ appSessionId: ID, message: 'x', noVerify: false });
      expect(answer).toEqual({ refused: 'git_failed', detail: 'git commit failed: nope', output: 'lint: 2 problems\nnope\nhusky - pre-commit failed' });
      expect(refresh).toHaveBeenCalledExactlyOnceWith(root);
      expect(readStatus).toHaveBeenCalledOnce(); // no status is answered with a refusal
    });

    it('keeps the first command’s output when the second of a discard fails', async () => {
      mutate.mockResolvedValueOnce({ stdout: '', stderr: 'Updated 1 path from the index\n' }).mockRejectedValueOnce(new GitCommandError('git clean failed: x', 'x\n', 1, ''));
      const answer = await service().discard({ appSessionId: ID, entries: [{ path: 'a.txt', group: 'unstaged' }, { path: 'u.txt', group: 'untracked' }] });
      expect(answer).toEqual({ refused: 'git_failed', detail: 'git clean failed: x', output: 'Updated 1 path from the index\nx' });
    });

    it('lets a timeout through for the router to answer, after asking the watcher', async () => {
      mutate.mockRejectedValueOnce(new GitTimeoutError('git commit timed out after 60 s'));
      await expect(service().commit({ appSessionId: ID, message: 'x', noVerify: false })).rejects.toBeInstanceOf(GitTimeoutError);
      expect(refresh).toHaveBeenCalledExactlyOnceWith(root);
    });

    it('answers not_repository when the checkout is not in a repository', async () => {
      readStatus.mockRejectedValueOnce(new NotARepositoryError());
      expect(await service().stage({ appSessionId: ID, paths: ['a.txt'] })).toMatchObject({ refused: 'not_repository' });
      expect(mutate).not.toHaveBeenCalled();
    });

    it('fails an unknown session as files.* does', async () => {
      await expect(service().stage({ appSessionId: OTHER, paths: ['a.txt'] })).rejects.toThrow(`unknown app session: ${OTHER}`);
      await expect(service().status(OTHER)).rejects.toThrow(`unknown app session: ${OTHER}`);
    });
  });

  describe("scm trust reads the captured environment's config home", () => {
    it('refuses every mutation in a checkout the capture’s config does not trust, whatever the process’s says', async () => {
      const processStore = new TrustStoreFixture();
      try {
        processStore.write({ [root]: { hasTrustDialogAccepted: true } });
        vi.stubEnv('CLAUDE_CONFIG_DIR', processStore.configHome);
        trust.write({});
        const scm = service();
        expect(await scm.stage({ appSessionId: ID, paths: ['a.txt'] })).toMatchObject({ refused: 'untrusted' });
        expect(await scm.unstage({ appSessionId: ID, paths: ['s.ts'] })).toMatchObject({ refused: 'untrusted' });
        expect(await scm.discard({ appSessionId: ID, entries: [{ path: 'a.txt', group: 'unstaged' }] })).toMatchObject({ refused: 'untrusted' });
        expect(await scm.commit({ appSessionId: ID, message: 'x', noVerify: false })).toMatchObject({ refused: 'untrusted' });
        expect(await scm.status(ID)).toMatchObject({ trusted: false, trustKey: root });
        expect(readStatus).not.toHaveBeenCalled();
        expect(mutate).not.toHaveBeenCalled();
        expect(refresh).not.toHaveBeenCalled();

        processStore.write({});
        trust.write({ [root]: { hasTrustDialogAccepted: true } });
        expect(await scm.stage({ appSessionId: ID, paths: ['a.txt'] })).toMatchObject({ ok: true });
        expect(await scm.status(ID)).toMatchObject({ trusted: true });
      } finally {
        processStore.dispose();
      }
    });

    // E11 (tracker row E6 "small per-call costs in scm.*"): the gate reads the trust key and the store, never the files
    // trust would load (`.claude/settings*.json`, `.mcp.json`), which only the session's trust card shows
    it('reads the trust key and the store only, on a mutation and on status', async () => {
      const scm = service();
      fsGate.reads = [];
      expect(await scm.stage({ appSessionId: ID, paths: ['a.txt'] })).toMatchObject({ ok: true });
      expect(await scm.status(ID)).toMatchObject({ trusted: true });
      expect(fsGate.reads.filter((path) => path.startsWith(root))).toEqual([]);
      expect(fsGate.reads.length).toBeGreaterThan(0); // the store was read
    });

    it('reads trust again on every command', async () => {
      const scm = service();
      expect(await scm.stage({ appSessionId: ID, paths: ['a.txt'] })).toMatchObject({ ok: true });
      trust.write({});
      expect(await scm.stage({ appSessionId: ID, paths: ['a.txt'] })).toMatchObject({ refused: 'untrusted' });
    });
  });

  describe('serialises mutations per checkout', () => {
    it('runs a second click only after the first answered, never interleaving their status reads', async () => {
      const order: string[] = [];
      let release!: () => void;
      readStatus.mockImplementation(async (directory) => {
        order.push(`status ${readStatus.mock.calls.length}`);
        return statusOf(directory);
      });
      mutate.mockImplementationOnce(async (_directory, args) => {
        order.push(`mutate ${args.at(-1)}`);
        await new Promise<void>((resolve) => { release = resolve; });
        return { stdout: '', stderr: '' };
      }).mockImplementation(async (_directory, args) => {
        order.push(`mutate ${args.at(-1)}`);
        return { stdout: '', stderr: '' };
      });
      const scm = service();
      const first = scm.stage({ appSessionId: ID, paths: ['a.txt'] });
      const second = scm.stage({ appSessionId: ID, paths: ['u.txt'] });
      await vi.waitFor(() => expect(order).toContain('mutate :(top,literal)a.txt'), { timeout: 5_000 }); // 1 s is not enough under load
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(order).toEqual(['status 1', 'mutate :(top,literal)a.txt']);
      release();
      await Promise.all([first, second]);
      expect(order).toEqual(['status 1', 'mutate :(top,literal)a.txt', 'status 2', 'status 3', 'mutate :(top,literal)u.txt', 'status 4']);
    });

    it('applies two clicks in the order they were made even when the second checkout path resolves first', async () => {
      const link = join(tmpdir(), `maws-scm-order-${process.pid}-${Date.now()}`);
      symlinkSync(root, link);
      let release!: () => void;
      fsGate.path = root;
      fsGate.held = new Promise<void>((resolve) => { release = resolve; });
      try {
        records.set(OTHER, { directory: link, worktree: null });
        const scm = service();
        const first = scm.stage({ appSessionId: ID, paths: ['a.txt'] }); // its realpath is held
        const second = scm.stage({ appSessionId: OTHER, paths: ['u.txt'] }); // another spelling, answered at once
        await new Promise((resolve) => setTimeout(resolve, 30));
        release();
        await Promise.all([first, second]);
        expect(mutate.mock.calls.map(([, args]) => args.at(-1))).toEqual([':(top,literal)a.txt', ':(top,literal)u.txt']);
      } finally {
        fsGate.path = null;
        fsGate.held = null;
        rmSync(link, { force: true });
      }
    });

    it('keys the chain by realpath, so two spellings of one checkout share it, and a refusal does not break it', async () => {
      const link = join(tmpdir(), `maws-scm-link-${process.pid}-${Date.now()}`);
      symlinkSync(root, link);
      try {
        records.set(OTHER, { directory: link, worktree: null });
        let release!: () => void;
        let entered = 0;
        mutate.mockImplementationOnce(async () => {
          entered += 1;
          await new Promise<void>((resolve) => { release = resolve; });
          return { stdout: '', stderr: '' };
        }).mockImplementation(async () => {
          entered += 1;
          return { stdout: '', stderr: '' };
        });
        const scm = service();
        const first = scm.stage({ appSessionId: ID, paths: ['a.txt'] });
        const refused = scm.stage({ appSessionId: OTHER, paths: ['nope'] });
        const second = scm.stage({ appSessionId: OTHER, paths: ['a.txt'] });
        await vi.waitFor(() => expect(entered).toBe(1), { timeout: 5_000 });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(entered).toBe(1);
        release();
        expect(await refused).toMatchObject({ refused: 'changed' });
        await Promise.all([first, second]);
        expect(entered).toBe(2);
      } finally {
        rmSync(link, { force: true });
      }
    });
  });

  describe('status', () => {
    it('answers trust, the remotes without user-info, the default remote and base, and gh missing when it is on no PATH', async () => {
      read.mockImplementation(async (directory, args) => {
        const command = args.join(' ');
        if (args[0] === 'rev-parse') return `${directory}\n${directory}/.git\n${directory}/.git\n`;
        // E11 (tracker row E6 "small per-call costs in scm.*"): one `remote -v`; a remote with no URL lists none
        if (command === 'remote -v') return 'origin\thttps://user:token@github.com/o/r.git (fetch)\norigin\thttps://user:token@github.com/o/r.git (push)\nupstream\t\n';
        if (command === 'for-each-ref --format=%(HEAD)%00%(upstream:remotename) refs/heads') return ' \0\n*\0upstream\n';
        if (command === 'symbolic-ref -q refs/remotes/upstream/HEAD') return 'refs/remotes/upstream/trunk\n';
        throw new Error(`unexpected read: git ${command}`);
      });
      expect(await service().status(ID)).toEqual({
        directory: root, repository: true, trusted: true, trustKey: root,
        remotes: [{ name: 'origin', url: 'https://github.com/o/r.git' }, { name: 'upstream', url: null }],
        defaultRemote: 'upstream', defaultBase: 'trunk', gh: { state: 'missing' }, checkedAt: '2026-10-06T12:00:00.000Z',
      });
      expect(readStatus).not.toHaveBeenCalled();
      expect(read.mock.calls.filter(([, args]) => args[0] === 'remote').map(([, args]) => args.join(' '))).toEqual(['remote -v']);
    });

    it('falls back to origin, then the sole remote, and answers no base when the remote has no HEAD', async () => {
      let remotes = 'fork\norigin\n';
      read.mockImplementation(async (directory, args) => {
        const command = args.join(' ');
        if (args[0] === 'rev-parse') return `${directory}\n${directory}/.git\n${directory}/.git\n`;
        if (command === 'remote -v') return remotes.split('\n').filter(Boolean).map((name) => `${name}\t/srv/${name}.git (fetch)\n${name}\t/srv/${name}.git (push)\n`).join('');
        if (args[0] === 'for-each-ref') return '*\0\n'; // the current branch has no upstream
        if (args[0] === 'symbolic-ref') throw new GitCommandError('git symbolic-ref failed: x', '', 1, '');
        throw new Error(`unexpected read: git ${command}`);
      });
      expect(await service().status(ID)).toMatchObject({ defaultRemote: 'origin', defaultBase: null });
      remotes = 'fork\n';
      expect(await service().status(ID)).toMatchObject({ defaultRemote: 'fork' });
      remotes = 'fork\nmirror\n';
      expect(await service().status(ID)).toMatchObject({ defaultRemote: null, defaultBase: null });
      remotes = '';
      expect(await service().status(ID)).toMatchObject({ remotes: [], defaultRemote: null });
    });

    // E11 (tracker row E6 "small per-call costs in scm.*"): the gh probe's failure is not kept, and rejects nothing unhandled
    it('drops a gh probe that failed, so the next status probes again', async () => {
      let calls = 0;
      const scm = new ScmService({
        records: (id) => records.get(id) ?? null,
        read: async (directory, args) => {
          if (args[0] === 'rev-parse') return `${directory}\n${directory}/.git\n${directory}/.git\n`;
          if (args.join(' ') === 'remote -v') return '';
          throw new Error(`unexpected read: git ${args.join(' ')}`);
        },
        status: readStatus, mutate, refresh,
        captured: async () => {
          calls += 1;
          if (calls === 2) throw new Error('the login shell did not answer'); // the gh probe's read (the trust read is the first)
          return captured;
        },
        env: {},
        emit: () => {},
        now: () => Date.parse('2026-10-06T12:00:00.000Z'),
      });
      await expect(scm.status(ID)).rejects.toThrow('the login shell did not answer');
      expect(await scm.status(ID)).toMatchObject({ gh: { state: 'missing' } });
    });

    it('answers a directory outside any repository without reading remotes', async () => {
      read.mockImplementation(async () => { throw new NotARepositoryError(); });
      expect(await service().status(ID)).toMatchObject({ directory: root, repository: false, trusted: true, remotes: [], defaultRemote: null, defaultBase: null });
      expect(read).toHaveBeenCalledOnce(); // the trust key's rev-parse
    });
  });
});
