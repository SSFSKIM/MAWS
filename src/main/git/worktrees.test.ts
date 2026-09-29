import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { cleanupState } from '@shared/sessions/worktree';
import { record } from '../../../test/support/builders';
import { runGit } from '../../../test/support/git-fixture';
import { FakeHolderHost } from '../../../test/support/holder-host';
import { emptyRepository, ScratchRepo } from '../../../test/support/scratch-repo';
import { createGitRunner, type ExecFileFn } from './runner';
import { WorktreeService } from './worktrees';

// worktrees.ts registers its handlers through main's router, which imports Electron; nothing here reaches it.
vi.mock('electron', () => ({ ipcMain: { handle: () => {} }, BrowserWindow: { fromWebContents: () => null } }));

const sid = (s: string) => s as SessionId;

describe('worktree service over scratch repositories', () => {
  let repo: ScratchRepo;
  let host: FakeHolderHost;
  let records: SessionRecord[];
  let service: WorktreeService;
  let spawn: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    repo = await ScratchRepo.create({ sentinels: false });
    host = new FakeHolderHost();
    records = [];
    spawn = vi.fn(execFile as unknown as ExecFileFn);
    service = new WorktreeService({
      git: createGitRunner({ env: repo.serviceEnv(), execFile: spawn as unknown as ExecFileFn }),
      holders: { dispatch: host.dispatch, sessions: { list: () => records } },
    });
  });
  afterEach(() => repo.dispose());

  const newBranch = (name: string, base = 'HEAD') => ({ kind: 'new' as const, name, base });
  const managed = (dir: string) => join(repo.root, '.claude', 'worktrees', dir);

  describe('worktree add, list, status, branch', () => {
    it('creates <root>/.claude/worktrees/feat+login on worktree-feat+login from HEAD, as the engine names its own', async () => {
      const head = await repo.head();
      const info = await service.add({ repoRoot: repo.root, name: 'feat/login', branch: newBranch('worktree-feat+login') });
      expect(info).toEqual({ repoRoot: repo.root, path: managed('feat+login'), branch: 'worktree-feat+login', head, isMain: false, locked: false, prunable: false, managed: true });
      expect(await repo.worktreePaths()).toContain(managed('feat+login'));
      expect(await repo.head('refs/heads/worktree-feat+login')).toBe(head);
      // --no-track: a new branch never takes the base as its upstream
      await expect(runGit(repo.root, ['config', '--get', 'branch.worktree-feat+login.merge'])).rejects.toThrow();
    });

    it('refuses, before anything is created: a taken path, an existing branch, a bad base, a bad name, an invalid branch name', async () => {
      await service.add({ repoRoot: repo.root, name: 'one', branch: newBranch('worktree-one') });
      const before = await repo.worktreePaths();
      await expect(service.add({ repoRoot: repo.root, name: 'one', branch: newBranch('worktree-other') })).rejects.toThrow('worktree path exists');
      await expect(service.add({ repoRoot: repo.root, name: 'two', branch: newBranch('main') })).rejects.toThrow('branch exists');
      await expect(service.add({ repoRoot: repo.root, name: 'two', branch: newBranch('worktree-two', 'no-such-branch') })).rejects.toThrow('base not found: no-such-branch');
      await expect(service.add({ repoRoot: repo.root, name: 'two', branch: newBranch('worktree-two', '--orphan') })).rejects.toThrow('base not found: --orphan');
      await expect(service.add({ repoRoot: repo.root, name: '../escape', branch: newBranch('worktree-x') })).rejects.toThrow("Worktree name cannot contain a '..' segment");
      await expect(service.add({ repoRoot: repo.root, name: '-rf', branch: newBranch('worktree-x') })).rejects.toThrow("Worktree name cannot start with '-'");
      await expect(service.add({ repoRoot: repo.root, name: 'two', branch: newBranch('bad..name') })).rejects.toThrow('invalid branch name: bad..name');
      expect(await repo.worktreePaths()).toEqual(before);
      expect(existsSync(managed('two'))).toBe(false);
      expect(await repo.hasBranch('worktree-two')).toBe(false);
    });

    it('refuses a repository without commits', async () => {
      const empty = emptyRepository();
      try {
        await empty.ready;
        await expect(service.add({ repoRoot: empty.root, name: 'a', branch: newBranch('worktree-a') })).rejects.toThrow('repository has no commits');
        expect(existsSync(join(empty.root, '.claude'))).toBe(false);
      } finally {
        empty.dispose();
      }
    });

    it('checks out an existing branch, and refuses one that is missing or checked out elsewhere', async () => {
      await runGit(repo.root, ['branch', 'feature']);
      const info = await service.add({ repoRoot: repo.root, name: 'feature', branch: { kind: 'existing', name: 'feature' } });
      expect(info).toMatchObject({ path: managed('feature'), branch: 'feature', managed: true });
      await expect(service.add({ repoRoot: repo.root, name: 'again', branch: { kind: 'existing', name: 'feature' } })).rejects.toThrow(
        `branch checked out at ${managed('feature')}`,
      );
      await expect(service.add({ repoRoot: repo.root, name: 'again', branch: { kind: 'existing', name: 'nope' } })).rejects.toThrow('branch missing');
    });

    it('creates the sibling under the main root when asked from a linked worktree', async () => {
      const first = await service.add({ repoRoot: repo.root, name: 'first', branch: newBranch('worktree-first') });
      const second = await service.add({ repoRoot: first.path, name: 'second', branch: newBranch('worktree-second') });
      expect(second.path).toBe(managed('second'));
      expect(second.repoRoot).toBe(repo.root);
      expect((await service.list(first.path)).repoRoot).toBe(repo.root);
    });

    it('lists the main worktree, a managed one, a hand-made one at any path on any branch, and a detached one', async () => {
      const outside = repo.scratchDir();
      await service.add({ repoRoot: repo.root, name: 'm', branch: newBranch('worktree-m') });
      await repo.addWorktreeAt(join(outside, 'hand'), 'hand/made');
      await repo.addDetachedWorktree(join(outside, 'det'));
      await runGit(repo.root, ['worktree', 'lock', '--reason', 'kept', join(outside, 'hand')]);
      const list = await service.list(repo.root);
      expect(list.repoRoot).toBe(repo.root);
      expect(list.commonDir).toBe(join(repo.root, '.git'));
      const byPath = Object.fromEntries(list.worktrees.map((w) => [w.path, w]));
      expect(byPath[repo.root]).toMatchObject({ branch: 'main', isMain: true, managed: false, locked: false });
      expect(byPath[managed('m')]).toMatchObject({ branch: 'worktree-m', isMain: false, managed: true });
      expect(byPath[join(outside, 'hand')]).toMatchObject({ branch: 'hand/made', managed: false, locked: true, prunable: false });
      expect(byPath[join(outside, 'det')]).toMatchObject({ branch: null, managed: false, head: await repo.head() });
    });

    it('reports status: clean, dirty with the counts, null for a path git does not list', async () => {
      const w = await service.add({ repoRoot: repo.root, name: 's', branch: newBranch('worktree-s') });
      await expect(service.status(repo.root, w.path)).resolves.toMatchObject({ ...w, dirty: { tracked: 0, untracked: 0 }, state: 'clean' });
      writeFileSync(join(w.path, 'new.txt'), 'x\n');
      await expect(service.status(repo.root, w.path)).resolves.toMatchObject({ dirty: { tracked: 0, untracked: 1 }, state: 'dirty' });
      writeFileSync(join(w.path, 'README.md'), 'changed\n');
      await expect(service.status(repo.root, w.path)).resolves.toMatchObject({ dirty: { tracked: 1, untracked: 1 }, state: 'dirty' });
      await expect(service.status(repo.root, repo.scratchDir())).resolves.toBeNull();
    });

    it('is busy for a registry holder in a worktree the index never saw, and for a record-less reservation there', async () => {
      const w = await service.add({ repoRoot: repo.root, name: 'b', branch: newBranch('worktree-b') });
      host.hold('eng-terminal', { kind: 'terminal', pid: 77 }, w.path);
      await expect(service.status(repo.root, w.path)).resolves.toMatchObject({ state: 'busy', occupancy: { unbound: 1, self: 0, foreign: 0 } });
      host.registry.length = 0;
      host.reserve('bootstrap-1', w.path);
      await expect(service.status(repo.root, w.path)).resolves.toMatchObject({ state: 'busy', occupancy: { self: 1, unbound: 0 } });
    });

    it('is busy for a process in a subdirectory, and a linked worktree’s process leaves the main checkout alone', async () => {
      const w = await service.add({ repoRoot: repo.root, name: 'sub', branch: newBranch('worktree-sub') });
      mkdirSync(join(w.path, 'src'));
      host.hold('eng-sub', { kind: 'terminal', pid: 78 }, join(w.path, 'src'));
      await expect(service.status(repo.root, w.path)).resolves.toMatchObject({ state: 'busy', occupancy: { unbound: 1 } });
      // (the main checkout is dirty here, not busy: `.claude/` is untracked until the engine writes its info/exclude block)
      await expect(service.status(repo.root, repo.root)).resolves.toMatchObject({ state: 'dirty', occupancy: { unbound: 0 } });
    });

    it('names idle and live sessions here: three records, one of them reserved', async () => {
      const w = await service.add({ repoRoot: repo.root, name: 'o', branch: newBranch('worktree-o') });
      records.push(
        record('r1', { directory: w.path, engineSessionId: sid('eng-1') }),
        record('r2', { directory: w.path, engineSessionId: sid('eng-2') }),
        record('r3', { directory: w.path, engineSessionId: sid('eng-3') }),
      );
      host.reserve('r2', w.path, { engineSessionId: sid('eng-2') });
      const status = await service.status(repo.root, w.path);
      expect(status?.occupancy).toEqual({ self: 1, foreign: 0, unbound: 0, idle: 2, archived: 0, idleAppSessionIds: ['r1', 'r3'], liveAppSessionIds: ['r2'] });
      expect(status?.state).toBe('busy');
    });

    it('fails with C4’s message when the registry fails closed, never answering clean', async () => {
      const w = await service.add({ repoRoot: repo.root, name: 'f', branch: newBranch('worktree-f') });
      host.registryFailure = 'holder registry unreadable: EACCES';
      await expect(service.status(repo.root, w.path)).rejects.toThrow('holder registry unreadable: EACCES');
    });

    it('reports a branch: checked out where, ahead of the main worktree’s branch, null when missing', async () => {
      const w = await service.add({ repoRoot: repo.root, name: 'br', branch: newBranch('worktree-br') });
      await expect(service.branch(repo.root, 'worktree-br')).resolves.toEqual({
        repoRoot: repo.root, branch: 'worktree-br', head: w.head, checkedOutAt: w.path, base: 'main', ahead: 0, merged: true,
      });
      const moved = await repo.commitIn(w.path, 'feature.txt');
      await expect(service.branch(repo.root, 'worktree-br')).resolves.toMatchObject({ head: moved, ahead: 1, merged: false });
      await expect(service.branch(repo.root, 'nope')).resolves.toBeNull();
    });

    it('matches a worktree reached through a symlink by its realpath', async () => {
      const outside = repo.scratchDir();
      mkdirSync(join(outside, 'real'));
      symlinkSync(join(outside, 'real'), join(outside, 'link'));
      await repo.addWorktreeAt(join(outside, 'link', 'wt'), 'via-link');
      await expect(service.status(repo.root, join(outside, 'link', 'wt'))).resolves.toMatchObject({ path: join(outside, 'real', 'wt'), branch: 'via-link' });
      await expect(service.status(repo.root, join(outside, 'real', 'wt'))).resolves.toMatchObject({ state: 'clean' });
    });
  });

  describe('cleanup state machine', () => {
    const identity = (w: { branch: string | null; head: string }) => ({ branch: w.branch, head: w.head });

    it('remove refuses dirty without discard, removes with it and prunes; the branch stays', async () => {
      const w = await service.add({ repoRoot: repo.root, name: 'd', branch: newBranch('worktree-d') });
      writeFileSync(join(w.path, 'scratch.txt'), 'x\n');
      await expect(service.remove({ repoRoot: repo.root, path: w.path, expect: identity(w), discard: false })).resolves.toEqual({ refused: 'dirty', detail: '1 uncommitted change' });
      expect(existsSync(w.path)).toBe(true);
      await expect(service.remove({ repoRoot: repo.root, path: w.path, expect: identity(w), discard: true })).resolves.toEqual({ removed: true, prunedOnly: false });
      expect(existsSync(w.path)).toBe(false);
      await expect(service.status(repo.root, w.path)).resolves.toBeNull();
      expect(await repo.hasBranch('worktree-d')).toBe(true);
    });

    it('remove refuses busy, locked, a moved head or branch, and a path git does not list', async () => {
      const w = await service.add({ repoRoot: repo.root, name: 'g', branch: newBranch('worktree-g') });
      host.hold('eng-x', { kind: 'terminal', pid: 5 }, w.path);
      host.hold('eng-y', { kind: 'terminal', pid: 6 }, w.path);
      await expect(service.remove({ repoRoot: repo.root, path: w.path, expect: identity(w), discard: true })).resolves.toEqual({ refused: 'busy', detail: '2 sessions live here' });
      host.registry.length = 0;
      await runGit(repo.root, ['worktree', 'lock', w.path]);
      await expect(service.remove({ repoRoot: repo.root, path: w.path, expect: identity(w), discard: true })).resolves.toMatchObject({ refused: 'locked' });
      await runGit(repo.root, ['worktree', 'unlock', w.path]);
      const moved = await repo.commitIn(w.path, 'moved.txt');
      const stale = await service.remove({ repoRoot: repo.root, path: w.path, expect: identity(w), discard: false });
      expect(stale).toMatchObject({ refused: 'changed' });
      expect('detail' in stale && stale.detail).toContain(moved.slice(0, 12));
      await expect(service.remove({ repoRoot: repo.root, path: w.path, expect: { branch: 'other', head: moved }, discard: false })).resolves.toMatchObject({ refused: 'changed' });
      expect(existsSync(w.path)).toBe(true);
      await expect(service.remove({ repoRoot: repo.root, path: join(repo.root, 'nowhere'), expect: identity(w), discard: false })).resolves.toMatchObject({ refused: 'missing' });
      await expect(service.remove({ repoRoot: repo.root, path: repo.root, expect: { branch: 'main', head: await repo.head() }, discard: false })).rejects.toThrow(
        'the main worktree cannot be removed',
      );
    });

    it('remove prunes a worktree whose directory was deleted by hand', async () => {
      const w = await service.add({ repoRoot: repo.root, name: 'p', branch: newBranch('worktree-p') });
      rmSync(w.path, { recursive: true, force: true });
      await expect(service.status(repo.root, w.path)).resolves.toMatchObject({ prunable: true, state: 'clean' });
      await expect(service.remove({ repoRoot: repo.root, path: w.path, expect: identity(w), discard: false })).resolves.toEqual({ removed: true, prunedOnly: true });
      expect(await repo.worktreePaths()).not.toContain(w.path);
    });

    it('deleteBranch refuses checked_out, a moved head and unmerged without the acknowledgement, and deletes with it', async () => {
      const w = await service.add({ repoRoot: repo.root, name: 'u', branch: newBranch('worktree-u') });
      const head = await repo.commitIn(w.path, 'work.txt');
      await expect(service.deleteBranch({ repoRoot: repo.root, branch: 'worktree-u', expect: { head }, acknowledgeUnmerged: true })).resolves.toEqual({
        refused: 'checked_out',
        detail: `checked out at ${w.path}`,
      });
      await expect(service.remove({ repoRoot: repo.root, path: w.path, expect: { branch: 'worktree-u', head }, discard: false })).resolves.toEqual({ removed: true, prunedOnly: false });
      await expect(service.deleteBranch({ repoRoot: repo.root, branch: 'worktree-u', expect: { head: w.head }, acknowledgeUnmerged: true })).resolves.toMatchObject({ refused: 'changed' });
      await expect(service.deleteBranch({ repoRoot: repo.root, branch: 'worktree-u', expect: { head }, acknowledgeUnmerged: false })).resolves.toEqual({
        refused: 'unmerged',
        detail: '1 commit not on main',
      });
      expect(await repo.hasBranch('worktree-u')).toBe(true);
      await expect(service.deleteBranch({ repoRoot: repo.root, branch: 'worktree-u', expect: { head }, acknowledgeUnmerged: true })).resolves.toEqual({ deleted: true, wasMerged: false });
      expect(await repo.hasBranch('worktree-u')).toBe(false);
      await expect(service.deleteBranch({ repoRoot: repo.root, branch: 'worktree-u', expect: { head }, acknowledgeUnmerged: true })).resolves.toMatchObject({ refused: 'missing' });
    });

    it('walks the ladder for a hand-made worktree with no record: remove only, then later the branch; the state follows', async () => {
      const outside = repo.scratchDir();
      const path = await repo.addWorktreeAt(join(outside, 'anything'), 'hand/made');
      const { worktrees } = await service.list(repo.root);
      const captured = worktrees.find((w) => w.path === path);
      expect(captured).toBeDefined();
      const read = async () => cleanupState({ worktree: await service.status(repo.root, path), branch: await service.branch(repo.root, 'hand/made') });
      expect(await read()).toBe('clean');
      await expect(service.remove({ repoRoot: repo.root, path, expect: identity(captured!), discard: false })).resolves.toEqual({ removed: true, prunedOnly: false });
      expect(await read()).toBe('detached');
      await expect(service.deleteBranch({ repoRoot: repo.root, branch: 'hand/made', expect: { head: captured!.head }, acknowledgeUnmerged: false })).resolves.toEqual({
        deleted: true,
        wasMerged: true,
      });
      expect(await read()).toBe('gone');
    });

    it('never runs gc, fetch or anything outside the worktree commands, and leaves info/exclude alone', async () => {
      const exclude = join(repo.root, '.git', 'info', 'exclude');
      const before = existsSync(exclude) ? readFileSync(exclude, 'utf8') : null;
      const w = await service.add({ repoRoot: repo.root, name: 'all', branch: newBranch('worktree-all') });
      await service.status(repo.root, w.path);
      await service.branch(repo.root, 'worktree-all');
      await service.remove({ repoRoot: repo.root, path: w.path, expect: { branch: w.branch, head: w.head }, discard: false });
      await service.deleteBranch({ repoRoot: repo.root, branch: 'worktree-all', expect: { head: w.head }, acknowledgeUnmerged: false });
      const subcommands = new Set(spawn.mock.calls.map(([, args]) => (args as string[])[2]));
      expect([...subcommands].sort()).toEqual(['branch', 'check-ref-format', 'rev-list', 'rev-parse', 'status', 'symbolic-ref', 'worktree']);
      const mutations = spawn.mock.calls.map(([, args]) => (args as string[]).slice(2)).filter((a) => a[0] === 'branch' || (a[0] === 'worktree' && a[1] !== 'list'));
      expect(mutations.map((a) => a.slice(0, 2).join(' '))).toEqual(['worktree add', 'worktree remove', 'worktree prune', 'branch -D']);
      expect(existsSync(exclude) ? readFileSync(exclude, 'utf8') : null).toBe(before);
    });
  });
});
