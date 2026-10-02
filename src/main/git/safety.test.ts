import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitFixture } from '../../../test/support/git-fixture';
import { FakeHolderHost } from '../../../test/support/holder-host';
import { createGitRunner, GitTimeoutError } from './runner';
import { GitService } from './service';
import { WorktreeService } from './worktrees';

// Executable configs and mutations belong only to these disposable repositories, never the owner's checkout.
describe('Git safety regressions', () => {
  let repo: GitFixture;
  beforeEach(async () => { repo = await GitFixture.create(); });
  afterEach(() => repo.dispose());

  it.each([false, true])('refuses a branch advanced after validation (acknowledgeUnmerged=%s)', async (acknowledgeUnmerged) => {
    const head = (await repo.git('rev-parse', 'HEAD')).trim();
    await repo.git('branch', 'victim');
    const tip = (await repo.git('commit-tree', 'HEAD^{tree}', '-p', head, '-m', 'unmerged work')).trim();
    const run = createGitRunner({ env: repo.serviceEnv() });
    let raced = false;
    const service = new WorktreeService({
      holders: { dispatch: new FakeHolderHost().dispatch, sessions: { list: () => [] } },
      git: async (directory, args) => {
        // Move the real ref at the mutation boundary, after every service-side read.
        if ((args[0] === 'branch' && args.includes('-D')) || args[0] === 'update-ref') {
          await repo.git('update-ref', 'refs/heads/victim', tip, head);
          raced = true;
        }
        return run(directory, args);
      },
    });
    const result = await service.deleteBranch({ repoRoot: repo.root, branch: 'victim', expect: { head }, acknowledgeUnmerged });
    expect(raced).toBe(true);
    expect(result).toMatchObject({ refused: 'changed' });
    expect((await repo.git('rev-parse', 'refs/heads/victim')).trim()).toBe(tip);
  });

  it('reads status without executing a repository fsmonitor hook', async () => {
    const marker = repo.path('fsmonitor-ran');
    const hook = await repo.write('.git/fsmonitor-hook', `#!/bin/sh\nprintf ran > '${marker}'\nprintf 'token\\0'\n`);
    chmodSync(hook, 0o755);
    await repo.git('config', 'core.fsmonitor', hook);
    const service = new GitService({ env: repo.serviceEnv() });
    try {
      expect((await service.status(repo.root)).branch).toBe('main');
      expect(existsSync(marker)).toBe(false);
    } finally { service.dispose(); }
  });

  it('disables external diff and textconv drivers without disabling configured content normalization', async () => {
    const marker = repo.path('.git/external-ran');
    const external = await repo.write('.git/external', `#!/bin/sh\nprintf ran > '${marker}'\n`);
    chmodSync(external, 0o755);
    await repo.git('config', 'diff.external', external);
    await repo.git('config', 'diff.custom.command', external);
    await repo.git('config', 'diff.custom.textconv', external);
    await repo.git('config', 'filter.normalize.clean', 'tr a-z A-Z');
    await repo.write('.gitattributes', 'README.md filter=normalize diff=custom\n');
    await repo.write('README.md', 'HELLO\n');
    await repo.git('add', '.');
    await repo.git('commit', '-qm', 'normalized');
    await repo.write('README.md', 'hello\n');
    const service = new GitService({ env: repo.serviceEnv() });
    try {
      // These bytes differ on disk but normalize to the index: disabling clean filters invents a change.
      expect((await service.status(repo.root)).dirty).toBe(false);
      expect((await service.diff({ directory: repo.root, scope: 'all' })).files).toEqual([]);
      await repo.write('README.md', 'changed\n');
      expect((await service.diff({ directory: repo.root, scope: 'all' })).patch).toContain('+CHANGED');
      expect(existsSync(marker)).toBe(false);
    } finally { service.dispose(); }
  });

  it('does not verify signatures through a configured executable while listing stashes', async () => {
    const marker = repo.path('.git/signature-ran');
    const verifier = await repo.write('.git/verifier', `#!/bin/sh\nprintf ran > '${marker}'\nexit 1\n`);
    chmodSync(verifier, 0o755);
    await repo.git('config', 'gpg.program', verifier);
    await repo.git('config', 'log.showSignature', 'true');
    const tree = (await repo.git('rev-parse', 'HEAD^{tree}')).trim();
    const commit = await repo.write('.git/signed-commit', `tree ${tree}\nauthor Fixture <fixture@maws.invalid> 1700000000 +0000\ncommitter Fixture <fixture@maws.invalid> 1700000000 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n fake\n -----END PGP SIGNATURE-----\n\nstash\n`);
    const oid = (await repo.git('hash-object', '-t', 'commit', '-w', commit)).trim();
    await repo.git('update-ref', '--create-reflog', 'refs/stash', oid);
    const service = new GitService({ env: repo.serviceEnv() });
    try {
      expect((await service.status(repo.root)).stashCount).toBe(1);
      expect(existsSync(marker)).toBe(false);
    } finally { service.dispose(); }
  });

  it('refuses transports even when repository protocol configuration allows them', async () => {
    await repo.addBareRemote();
    await repo.git('config', 'protocol.file.allow', 'always');
    const run = createGitRunner({ env: repo.serviceEnv() });
    await expect(run(repo.root, ['ls-remote', 'origin'])).rejects.toThrow("transport 'file' not allowed");
  });

  it('stops a SIGTERM-ignoring post-checkout descendant before timeout recovery', async () => {
    const pidFile = repo.path('.git/hook-pid');
    const script = await repo.write('.git/linger.cjs', `const fs = require('node:fs');\nprocess.on('SIGTERM', () => {});\nfs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 50);\n`);
    const hook = await repo.write('.git/hooks/post-checkout', `#!/bin/sh\nexec '${process.execPath}' '${script}' >/dev/null 2>&1\n`);
    chmodSync(hook, 0o755);
    const run = createGitRunner({ env: repo.serviceEnv() });
    try {
      await expect(run(repo.root, ['worktree', 'add', '-b', 'timeout', repo.path('checkout')])).rejects.toBeInstanceOf(GitTimeoutError);
      expect(existsSync(pidFile)).toBe(true); // prove the hook actually ran
      const pid = Number(readFileSync(pidFile, 'utf8'));
      await expect.poll(() => alive(pid), { timeout: 2000 }).toBe(false);
    } finally {
      if (existsSync(pidFile)) {
        const pid = Number(readFileSync(pidFile, 'utf8'));
        if (alive(pid)) process.kill(pid, 'SIGKILL');
      }
    }
  }, 20_000);

  it('diffs from a subdirectory in repository-relative paths despite diff.relative', async () => {
    await repo.write('root.txt', 'root\n');
    await repo.write('sub/child.txt', 'child\n');
    await repo.git('add', 'root.txt', 'sub/child.txt');
    await repo.git('config', 'diff.relative', 'true');
    const service = new GitService({ env: repo.serviceEnv() });
    try {
      const directory = repo.path('sub');
      const diff = await service.diff({ directory, scope: 'staged' });
      expect(diff.files.map((file) => file.path)).toEqual(['root.txt', 'sub/child.txt']);
      expect(diff.patch).toContain('diff --git a/root.txt b/root.txt');
      expect(diff.patch).toContain('diff --git a/sub/child.txt b/sub/child.txt');
      expect((await service.status(directory)).files.map((file) => file.path)).toEqual(diff.files.map((file) => file.path));
      const single = await service.diff({ directory, scope: 'staged', path: 'root.txt' });
      expect(single.files.map((file) => file.path)).toEqual(['root.txt']);
    } finally { service.dispose(); }
  });
});

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}
