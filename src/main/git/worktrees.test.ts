import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'; // C12: mkdtempSync, realpathSync, statSync
import { tmpdir } from 'node:os'; // C12
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
import { ensureRuntimeExclude, RUNTIME_EXCLUDE_BLOCK, RUNTIME_EXCLUDE_MARKER, WorktreeService, type ExcludeFs } from './worktrees'; // C12: the exclude block

// The service is Electron-free (its handlers are worktrees-register.ts's): any import of Electron from here fails.
vi.mock('electron', () => {
  throw new Error('WorktreeService must not load Electron');
});

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
      await expect(service.add({ repoRoot: repo.root, name: '../escape', branch: newBranch('worktree-x') })).rejects.toThrow("Worktree name cannot contain a '.' or '..' segment");
      // '.' would be `.claude/worktrees` itself
      await expect(service.add({ repoRoot: repo.root, name: '.', branch: newBranch('worktree-x') })).rejects.toThrow("Worktree name cannot contain a '.' or '..' segment");
      await expect(service.add({ repoRoot: repo.root, name: '.git', branch: newBranch('worktree-x') })).rejects.toThrow("Worktree name cannot contain '.git', a name git reserves");
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

    // C12 start: the engine's runtime-exclude block (2.1.283, `ensureClaudeRuntimeFilesExcluded`: `# claude-code-runtime`
    // then its ten patterns, `**/.claude/worktrees/` among them, appended once to the common dir's info/exclude), so a
    // worktree MAWS makes leaves the main checkout clean as one the engine makes does (the architect's ruling at C12 M5)
    describe('the runtime exclude block', () => {
      const exclude = () => join(repo.root, '.git', 'info', 'exclude');
      const read = () => readFileSync(exclude(), 'utf8');
      const count = (text: string, line: string) => text.split('\n').filter((l) => l === line).length;

      it('absent: add writes the engine’s block, and the main checkout stays clean', async () => {
        const before = read();
        expect(before).not.toContain(RUNTIME_EXCLUDE_MARKER);
        const info = await service.add({ repoRoot: repo.root, name: 'one', branch: newBranch('worktree-one') });
        expect(read()).toBe(`${before}${before.endsWith('\n') || before === '' ? '' : '\n'}${RUNTIME_EXCLUDE_BLOCK}`);
        expect(RUNTIME_EXCLUDE_BLOCK.split('\n')).toEqual(expect.arrayContaining([RUNTIME_EXCLUDE_MARKER, '**/.claude/worktrees/']));
        expect(await service.status(repo.root, repo.root)).toMatchObject({ state: 'clean', dirty: { tracked: 0, untracked: 0 } });
        expect(info.path).toBe(managed('one'));
      });

      it('present (the engine’s own block, written before): untouched, byte for byte', async () => {
        const engines = `# git ls-files --others --exclude-from=.git/info/exclude\n*.log\n${RUNTIME_EXCLUDE_MARKER}\n**/.claude/worktrees/\n`;
        writeFileSync(exclude(), engines);
        await service.add({ repoRoot: repo.root, name: 'two', branch: newBranch('worktree-two') });
        expect(read()).toBe(engines);
      });

      it('repeated creation writes one block, from a linked worktree too; a missing info directory is made', async () => {
        rmSync(join(repo.root, '.git', 'info'), { recursive: true, force: true });
        const first = await service.add({ repoRoot: repo.root, name: 'a', branch: newBranch('worktree-a') });
        await service.add({ repoRoot: repo.root, name: 'b', branch: newBranch('worktree-b') });
        await service.add({ repoRoot: first.path, name: 'c', branch: newBranch('worktree-c') });
        expect(count(read(), RUNTIME_EXCLUDE_MARKER)).toBe(1);
        expect(count(read(), '**/.claude/worktrees/')).toBe(1);
      });

      // re-review of f0ea3676: the read, the marker check and the append are one step per common dir
      it('two writes started before either appends end with one block: the second reads only after the first appended', async () => {
        const dir = join(repo.root, 'fake-common');
        let text = '';
        const calls: string[] = [];
        let release!: () => void;
        const firstRead = new Promise<void>((r) => (release = r));
        const fs: ExcludeFs = {
          readFile: async () => {
            calls.push('read');
            if (calls.filter((c) => c === 'read').length === 1) await firstRead;
            return text;
          },
          appendFile: async (_file, data) => {
            calls.push('append');
            text += data;
          },
          mkdir: async () => undefined,
        };
        const both = Promise.all([ensureRuntimeExclude(dir, fs), ensureRuntimeExclude(dir, fs)]);
        await new Promise((r) => setTimeout(r, 10));
        expect(calls).toEqual(['read']); // the second is queued behind the first, not reading
        release();
        await both;
        expect(calls).toEqual(['read', 'append', 'read']);
        expect(text).toBe(RUNTIME_EXCLUDE_BLOCK);
      });

      it('two concurrent creations in one repository leave one block', async () => {
        await Promise.all([
          service.add({ repoRoot: repo.root, name: 'x', branch: newBranch('worktree-x') }),
          service.add({ repoRoot: repo.root, name: 'y', branch: newBranch('worktree-y') }),
        ]);
        expect(count(read(), RUNTIME_EXCLUDE_MARKER)).toBe(1);
      });

      it('writes to the common dir’s info/exclude when the git dir is separate from the checkout', async () => {
        const base = realpathSync(mkdtempSync(join(tmpdir(), 'maws-sep-')));
        try {
          const work = join(base, 'work');
          const gitDir = join(base, 'gitdir');
          await runGit(base, ['init', '-q', '-b', 'main', `--separate-git-dir=${gitDir}`, work]);
          writeFileSync(join(work, 'a.txt'), 'a\n');
          await runGit(work, ['add', 'a.txt']);
          await runGit(work, ['commit', '-q', '-m', 'a']);
          await service.add({ repoRoot: work, name: 'sep', branch: newBranch('worktree-sep') });
          expect(readFileSync(join(gitDir, 'info', 'exclude'), 'utf8')).toContain(RUNTIME_EXCLUDE_BLOCK);
          expect(statSync(join(work, '.git')).isFile()).toBe(true); // the checkout's .git is still git's pointer file
          expect(existsSync(join(work, '.git', 'info'))).toBe(false);
        } finally {
          rmSync(base, { recursive: true, force: true });
        }
      });

      it('a refused add writes nothing', async () => {
        const before = read();
        await expect(service.add({ repoRoot: repo.root, name: '-bad', branch: newBranch('worktree-bad') })).rejects.toThrow();
        expect(read()).toBe(before);
      });
    });
    // C12 end

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
      // C12: the main checkout is clean, not busy (add wrote the engine's runtime exclude block, `.claude/worktrees/` in it)
      await expect(service.status(repo.root, repo.root)).resolves.toMatchObject({ state: 'clean', occupancy: { unbound: 0 } });
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

    it('reads a branch name as a name, never as revision syntax: main~1, main^{}, main@{0} are no branches', async () => {
      await repo.commitIn(repo.root, 'second.txt'); // so main~1 names a commit
      for (const name of ['main~1', 'main~0', 'main^{}', 'main@{0}', 'main^']) {
        await expect(service.branch(repo.root, name), name).resolves.toBeNull();
        await expect(service.deleteBranch({ repoRoot: repo.root, branch: name, expect: { head: await repo.head() }, acknowledgeUnmerged: true }), name).resolves.toMatchObject({
          refused: 'missing',
        });
      }
      expect(await repo.hasBranch('main')).toBe(true);
      await expect(service.add({ repoRoot: repo.root, name: 'rev', branch: { kind: 'existing', name: 'main~1' } })).rejects.toThrow('invalid branch name: main~1');
    });

    // git lists the main worktree of a separate-git-dir repository at the git dir itself (the checkout's `.git` is a
    // pointer file and nothing points back), so the main checkout is matched through the root git resolves from it
    it('reads the main checkout of a separate-git-dir repository, lists it at the checkout, and keeps a created worktree off it', async () => {
      const base = realpathSync(mkdtempSync(join(tmpdir(), 'maws-sep-')));
      try {
        const work = join(base, 'work');
        const gitDir = join(base, 'gitdir');
        await runGit(base, ['init', '-q', '-b', 'main', `--separate-git-dir=${gitDir}`, work]);
        writeFileSync(join(work, 'a.txt'), 'a\n');
        await runGit(work, ['add', 'a.txt']);
        await runGit(work, ['commit', '-q', '-m', 'a']);
        const head = (await runGit(work, ['rev-parse', 'HEAD'])).trim();
        await expect(service.status(work, work)).resolves.toMatchObject({ repoRoot: work, path: work, isMain: true, branch: 'main', head, state: 'clean' });
        const w = await service.add({ repoRoot: work, name: 'sep', branch: newBranch('worktree-sep') });
        expect(w.path).toBe(join(work, '.claude', 'worktrees', 'sep'));
        const list = await service.list(work);
        expect(list).toMatchObject({ repoRoot: work, commonDir: gitDir });
        expect(list.worktrees.map((e) => [e.path, e.isMain])).toEqual([[work, true], [w.path, false]]);
        writeFileSync(join(work, 'b.txt'), 'b\n');
        await expect(service.status(join(work, '.claude'), work)).resolves.toMatchObject({ state: 'dirty', dirty: { tracked: 0, untracked: 1 } });
        await expect(service.status(work, gitDir)).resolves.toBeNull();
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    });

    // Debt wave 6: asked from a linked worktree of such a repository, the root is the checkout whose own `.git` points
    // at the common dir, found among the worktree's ancestors (where the engine's layout puts managed worktrees).
    it('asked from a linked worktree of a separate-git-dir repository, finds the main checkout through the common dir', async () => {
      const base = realpathSync(mkdtempSync(join(tmpdir(), 'maws-sep-linked-')));
      try {
        const work = join(base, 'work');
        const gitDir = join(base, 'gitdir');
        await runGit(base, ['init', '-q', '-b', 'main', `--separate-git-dir=${gitDir}`, work]);
        await runGit(work, ['commit', '-q', '--allow-empty', '-m', 'a']);
        const w = await service.add({ repoRoot: work, name: 'sep', branch: newBranch('worktree-sep') });
        const deep = join(w.path, 'src');
        mkdirSync(deep);
        for (const asked of [w.path, deep]) {
          const list = await service.list(asked);
          expect(list, asked).toMatchObject({ repoRoot: work, commonDir: gitDir });
          expect(list.worktrees.map((e) => [e.path, e.isMain])).toEqual([[work, true], [w.path, false]]);
        }
        await expect(service.status(w.path, w.path)).resolves.toMatchObject({ repoRoot: work, path: w.path, isMain: false, branch: 'worktree-sep' });
        await expect(service.status(w.path, work)).resolves.toMatchObject({ repoRoot: work, isMain: true, branch: 'main' });
        const again = await service.add({ repoRoot: w.path, name: 'from-linked', branch: newBranch('worktree-from-linked') });
        expect(again.path).toBe(join(work, '.claude', 'worktrees', 'from-linked')); // beside the first, not inside it
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
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

    it('never runs gc, fetch or anything outside the worktree commands; info/exclude gains the runtime block only (C12), which removal leaves', async () => {
      const exclude = join(repo.root, '.git', 'info', 'exclude');
      const before = existsSync(exclude) ? readFileSync(exclude, 'utf8') : null;
      const w = await service.add({ repoRoot: repo.root, name: 'all', branch: newBranch('worktree-all') });
      await service.status(repo.root, w.path);
      await service.branch(repo.root, 'worktree-all');
      await service.remove({ repoRoot: repo.root, path: w.path, expect: { branch: w.branch, head: w.head }, discard: false });
      await service.deleteBranch({ repoRoot: repo.root, branch: 'worktree-all', expect: { head: w.head }, acknowledgeUnmerged: false });
      const subcommands = new Set(spawn.mock.calls.map(([, args]) => (args as string[])[2]));
      expect([...subcommands].sort()).toEqual(['check-ref-format', 'rev-list', 'rev-parse', 'show-ref', 'status', 'symbolic-ref', 'update-ref', 'worktree']);
      const mutations = spawn.mock.calls.map(([, args]) => (args as string[]).slice(2)).filter((a) => a[0] === 'update-ref' || (a[0] === 'worktree' && a[1] !== 'list'));
      expect(mutations.map((a) => a.slice(0, 2).join(' '))).toEqual(['worktree add', 'worktree remove', 'worktree prune', 'update-ref --no-deref']);
      // C12: add appended the engine's runtime block (never removed by MAWS); the ladder wrote nothing else there
      expect(readFileSync(exclude, 'utf8')).toBe(`${before ?? ''}${before && !before.endsWith('\n') ? '\n' : ''}${RUNTIME_EXCLUDE_BLOCK}`);
    });
  });
});
