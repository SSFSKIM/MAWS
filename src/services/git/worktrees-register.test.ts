import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandName } from '@shared/ipc/schema';
import { fakeBus, type FakeBus } from '../../../test/support/fake-bus';
import { FakeHolderHost } from '../../../test/support/holder-host';
import { ScratchRepo } from '../../../test/support/scratch-repo';
import { createGitRunner, type ExecFileFn } from './runner';
import { WorktreeService } from './worktrees';
import { registerWorktreeHandlers } from './worktrees-register';

type Result = { ok: boolean; value?: unknown; error?: { code: string; message: string } };

// The M2 check of the execution document's Concrete Steps, on the services bus routed as main's router routes the
// renderer's `window.maws.invoke`: add, status, remove, deleteBranch over a scratch repository.
describe('main answers git.worktree.* on the services bus', () => {
  let repo: ScratchRepo;
  let bus: FakeBus;
  beforeEach(async () => {
    bus = fakeBus();
    repo = await ScratchRepo.create({ sentinels: false });
  });
  afterEach(() => {
    repo.dispose();
  });

  async function install(options: { execFile?: ExecFileFn } = {}) {
    const host = new FakeHolderHost();
    registerWorktreeHandlers(new WorktreeService({ git: createGitRunner({ env: repo.serviceEnv(), ...options }), holders: { dispatch: host.dispatch, sessions: { list: () => [] } } }), bus);
  }
  const invoke = (name: CommandName, input?: unknown) => bus.invoke(name, input) as Promise<Result>;

  it('adds, inspects, removes and deletes the branch of a worktree, as the DevTools check does', async () => {
    await install();
    const added = await invoke('git.worktree.add', { repoRoot: repo.root, name: 'm2', branch: { kind: 'new', name: 'worktree-m2', base: 'HEAD' } });
    expect(added).toMatchObject({ ok: true, value: { branch: 'worktree-m2', managed: true } });
    const w = added.value as { path: string; branch: string; head: string };
    expect(await repo.worktreePaths()).toContain(w.path);
    expect(await invoke('git.worktree.status', { repoRoot: repo.root, path: w.path })).toMatchObject({ ok: true, value: { state: 'clean' } });
    expect(await invoke('git.worktree.remove', { repoRoot: repo.root, path: w.path, expect: { branch: w.branch, head: w.head }, discard: false })).toEqual({
      ok: true,
      value: { removed: true, prunedOnly: false },
    });
    expect(await repo.worktreePaths()).not.toContain(w.path);
    expect(existsSync(w.path)).toBe(false);
    expect(await invoke('git.worktree.deleteBranch', { repoRoot: repo.root, branch: 'worktree-m2', expect: { head: w.head }, acknowledgeUnmerged: false })).toEqual({
      ok: true,
      value: { deleted: true, wasMerged: true },
    });
    expect(await repo.hasBranch('worktree-m2')).toBe(false);
  });

  it('answers a refusal decided before acting as internal with its named message', async () => {
    await install();
    expect(await invoke('git.worktree.add', { repoRoot: repo.root, name: 'x', branch: { kind: 'new', name: 'worktree-x', base: 'no-such' } })).toEqual({
      ok: false,
      error: { code: 'internal', message: 'base not found: no-such' },
    });
  });

  it('answers timeout when git is killed at its deadline', async () => {
    const hung: ExecFileFn = (_file, _args, _options, callback) => {
      queueMicrotask(() => callback(Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM' as const, code: null }), '', ''));
    };
    await install({ execFile: hung });
    expect(await invoke('git.worktree.list', { repoRoot: repo.root })).toEqual({
      ok: false,
      error: { code: 'timeout', message: `git rev-parse timed out after 10 s in ${repo.root}` },
    });
  });

  it('answers timeout when git’s own worktree add is killed at its deadline', async () => {
    const real = execFile as unknown as ExecFileFn;
    const hungAdd: ExecFileFn = (file, args, options, callback) => {
      if (!(args as string[]).includes('add')) return real(file, args, options, callback);
      queueMicrotask(() => callback(Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM' as const, code: null }), '', ''));
    };
    await install({ execFile: hungAdd });
    const result = await invoke('git.worktree.add', { repoRoot: repo.root, name: 'slow', branch: { kind: 'new', name: 'worktree-slow', base: 'HEAD' } });
    expect(result).toMatchObject({ ok: false, error: { code: 'timeout', message: expect.stringContaining('git worktree timed out') } });
  });
});
