// The local service against real temporary repositories (E6 acceptance item 1): C4's read runner and status, the
// mutating runner under a captured environment, a trust store of the test's own. Every repository here is a fresh
// directory under the system temp root; global and system git configuration are kept out by the fixture's empty HOME.
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { ScmMutation } from '@shared/ipc/schema/scm';
import { GitFixture, runGit } from '../../../test/support/git-fixture';
import { TrustStoreFixture } from '../../../test/support/trust-store';
import { createMutatingRunner } from '../git/mutate';
import { createGitRunner } from '../git/runner';
import { GitService } from '../git/service';
import { ScmService } from './service';

const ID = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;

describe('scm service stages, unstages, discards and commits against a real repository', () => {
  let repo: GitFixture;
  let trust: TrustStoreFixture;
  let git: GitService;
  let refresh: ReturnType<typeof vi.fn<(directory: string) => void>>;
  let directory: string;

  function service(): ScmService {
    const captured = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: repo.home, CLAUDE_CONFIG_DIR: trust.configHome };
    return new ScmService({
      records: (id) => (id === ID ? { directory, worktree: null } : null),
      read: createGitRunner({ env: repo.serviceEnv() }),
      status: (d) => git.status(d),
      mutate: createMutatingRunner({ env: {}, captured: async () => captured }),
      refresh,
      captured: async () => captured,
      env: {},
      emit: () => {},
    });
  }
  const porcelain = async () => (await repo.git('status', '--porcelain')).split('\n').filter((line) => line !== '');
  const ok = (answer: ScmMutation) => {
    expect(answer, JSON.stringify(answer)).toMatchObject({ ok: true });
    return answer as Extract<ScmMutation, { ok: true }>;
  };

  beforeEach(async () => {
    repo = await GitFixture.create();
    directory = repo.root;
    await repo.git('config', 'user.name', 'Panel');
    await repo.git('config', 'user.email', 'panel@maws.invalid');
    trust = new TrustStoreFixture();
    trust.write({ [repo.root]: { hasTrustDialogAccepted: true } });
    git = new GitService({ env: repo.serviceEnv() });
    refresh = vi.fn();
  });
  afterEach(() => {
    git.dispose();
    trust.dispose();
    repo.dispose();
  });

  it('stages and unstages a modification, an untracked directory and a rename, answering the status after', async () => {
    const scm = service();
    await repo.write('README.md', 'hello\nchanged\n');
    await repo.write('udir/x.txt', 'x\n');
    const staged = ok(await scm.stage({ appSessionId: ID, paths: ['README.md', 'udir/'] }));
    expect(await porcelain()).toEqual(['M  README.md', 'A  udir/x.txt']);
    expect(staged.status.files.map((f) => `${f.index}${f.worktree} ${f.path}`)).toEqual(['M. README.md', 'A. udir/x.txt']);
    ok(await scm.unstage({ appSessionId: ID, paths: ['README.md', 'udir/x.txt'] }));
    expect(await porcelain()).toEqual([' M README.md', '?? udir/']);

    await repo.git('mv', 'README.md', 'READ.md');
    ok(await scm.unstage({ appSessionId: ID, paths: ['READ.md'] }));
    expect(await porcelain()).toEqual([' D README.md', '?? READ.md', '?? udir/']);
    expect(refresh.mock.calls).toEqual([[directory], [directory], [directory]]);
  });

  it('unstages in a repository with no commit yet', async () => {
    const bare = realpathSync(mkdtempSync(join(tmpdir(), 'maws-scm-unborn-')));
    try {
      await runGit(bare, ['init', '-q', '-b', 'main']);
      trust.write({ [bare]: { hasTrustDialogAccepted: true } });
      directory = bare;
      writeFileSync(join(bare, 'a.txt'), 'a\n');
      await runGit(bare, ['add', 'a.txt']);
      writeFileSync(join(bare, 'a.txt'), 'a\nmore\n'); // AM: the index differs from the file and there is no HEAD
      ok(await service().unstage({ appSessionId: ID, paths: ['a.txt'] }));
      expect(await runGit(bare, ['status', '--porcelain'])).toBe('?? a.txt\n');
      expect(readFileSync(join(bare, 'a.txt'), 'utf8')).toBe('a\nmore\n');
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it('discards an unstaged change to the index and deletes untracked files and directories', async () => {
    const scm = service();
    await repo.write('README.md', 'staged\n');
    await repo.git('add', 'README.md');
    await repo.write('README.md', 'staged\nand unstaged\n');
    await repo.write('untracked.txt', 'u\n');
    await repo.write('udir/x.txt', 'x\n');
    const answer = ok(await scm.discard({ appSessionId: ID, entries: [{ path: 'README.md', group: 'unstaged' }, { path: 'untracked.txt', group: 'untracked' }, { path: 'udir/', group: 'untracked' }] }));
    expect(readFileSync(repo.path('README.md'), 'utf8')).toBe('staged\n'); // the staged part is kept
    expect(existsSync(repo.path('untracked.txt'))).toBe(false);
    expect(existsSync(repo.path('udir'))).toBe(false);
    expect(await porcelain()).toEqual(['M  README.md']);
    expect(answer.output).toContain('Removing untracked.txt');
    expect(refresh).toHaveBeenCalledExactlyOnceWith(directory);
  });

  it('commits with the hooks running, skips them with --no-verify, and keeps a stdout-only hook failure’s words', async () => {
    const scm = service();
    const marker = repo.path('hook-ran');
    chmodSync(await repo.write('.git/hooks/pre-commit', `#!/bin/sh\ntouch '${marker}'\n`), 0o755);
    await repo.write('a.txt', 'a\n');
    ok(await scm.stage({ appSessionId: ID, paths: ['a.txt'] }));
    const committed = ok(await scm.commit({ appSessionId: ID, message: 'From the panel\n\nbody', noVerify: false }));
    expect(existsSync(marker)).toBe(true);
    expect(committed.commit).toEqual({ sha: (await repo.git('rev-parse', 'HEAD')).trim(), subject: 'From the panel' });
    expect(committed.status.head).toBe(committed.commit!.sha);
    expect(await repo.git('log', '-1', '--format=%B')).toBe('From the panel\n\nbody\n\n');

    rmSync(marker);
    await repo.write('b.txt', 'b\n');
    ok(await scm.stage({ appSessionId: ID, paths: ['b.txt'] }));
    ok(await scm.commit({ appSessionId: ID, message: 'skipped', noVerify: true }));
    expect(existsSync(marker)).toBe(false);

    chmodSync(await repo.write('.git/hooks/pre-commit', '#!/bin/sh\necho nope\nexit 1\n'), 0o755);
    await repo.write('c.txt', 'c\n');
    ok(await scm.stage({ appSessionId: ID, paths: ['c.txt'] }));
    const head = await repo.git('rev-parse', 'HEAD');
    const refused = await scm.commit({ appSessionId: ID, message: 'refused', noVerify: false });
    expect(refused).toMatchObject({ refused: 'git_failed', detail: expect.stringContaining('nope') });
    expect((refused as { output: string }).output).toContain('nope');
    expect(await repo.git('rev-parse', 'HEAD')).toBe(head);
    expect(refresh).toHaveBeenCalledTimes(6);
    expect(new Set(refresh.mock.calls.map(([d]) => d))).toEqual(new Set([directory]));
  });

  it('refuses an untrusted checkout and an unlisted path, running nothing', async () => {
    await repo.write('a.txt', 'a\n');
    expect(await service().stage({ appSessionId: ID, paths: ['nope.txt'] })).toMatchObject({ refused: 'changed' });
    trust.write({ [`${repo.root}-other`]: { hasTrustDialogAccepted: true } });
    expect(await service().stage({ appSessionId: ID, paths: ['a.txt'] })).toMatchObject({ refused: 'untrusted' });
    expect(await porcelain()).toEqual(['?? a.txt']);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refuses to discard a conflict and accepts staging it, which marks it resolved', async () => {
    await repo.write('c.txt', 'base\n');
    await repo.git('add', 'c.txt');
    await repo.git('commit', '-q', '-m', 'base');
    await repo.git('checkout', '-q', '-b', 'other');
    await repo.write('c.txt', 'other\n');
    await repo.git('commit', '-q', '-am', 'other');
    await repo.git('checkout', '-q', 'main');
    await repo.write('c.txt', 'main\n');
    await repo.git('commit', '-q', '-am', 'main');
    await repo.git('merge', 'other').catch(() => {}); // the conflict
    expect(await porcelain()).toEqual(['UU c.txt']);
    const scm = service();
    expect(await scm.discard({ appSessionId: ID, entries: [{ path: 'c.txt', group: 'unstaged' }] })).toMatchObject({ refused: 'unmerged' });
    expect(await scm.commit({ appSessionId: ID, message: 'merge', noVerify: false })).toMatchObject({ refused: 'unmerged' });
    await repo.write('c.txt', 'resolved\n');
    ok(await scm.stage({ appSessionId: ID, paths: ['c.txt'] }));
    expect(await porcelain()).toEqual(['M  c.txt']);
  });
});
