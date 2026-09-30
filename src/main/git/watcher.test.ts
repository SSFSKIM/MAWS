import { execFile as nodeExecFile } from 'node:child_process';
import { watch as fsWatch } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitChangedSchema, type GitChanged, type GitStatus } from '@shared/ipc/schema/git';
import { GitFixture } from '../../../test/support/git-fixture';
import { GitTimeoutError, type ExecFileFn } from './runner';
import { GitService } from './service';
import { classifyCommonPath, classifyGitPath, classifyRootPath, GitWatcher, INNER_CAP, refMatters, type WatchFn } from './watcher';

const ROOT = '/repo';

function status(over: Partial<GitStatus> = {}): GitStatus {
  return {
    repoRoot: ROOT,
    gitDir: `${ROOT}/.git`,
    commonDir: `${ROOT}/.git`,
    isWorktree: false,
    branch: 'main',
    head: 'a'.repeat(40),
    upstream: null,
    remoteUrl: null,
    ahead: 0,
    behind: 0,
    dirty: false,
    files: [],
    stashCount: 0,
    checkedAt: '2026-09-28T00:00:00.000Z',
    ...over,
  };
}

// A watch function that records every open watch and lets the test deliver filesystem events by hand.
function fakeWatch() {
  const opened: { path: string; listener: (event: string, filename: string | null) => void; closed: boolean }[] = [];
  const watch: WatchFn = (path, _options, listener) => {
    const entry = { path, listener, closed: false };
    opened.push(entry);
    return { close: () => void (entry.closed = true), on: () => {} };
  };
  return { watch, opened, fire: (path: string, filename: string) => opened.filter((w) => w.path === path && !w.closed).forEach((w) => w.listener('change', filename)) };
}

describe('the repository watcher classifies paths', () => {
  it('counts .git paths only for HEAD, ORIG_HEAD, MERGE_HEAD, index, packed-refs, refs/** and config; objects/** and git\'s *.lock are ignored', () => {
    expect(classifyGitPath('HEAD')).toBe('head');
    expect(classifyGitPath('ORIG_HEAD')).toBe('head');
    expect(classifyGitPath('MERGE_HEAD')).toBe('head');
    expect(classifyGitPath('index')).toBe('index');
    expect(classifyGitPath('packed-refs')).toBe('refs');
    expect(classifyGitPath('refs/heads/main')).toBe('refs');
    expect(classifyGitPath('config')).toBe('refs'); // `branch -u`, `remote set-url`: upstream and remoteUrl live here
    expect(classifyGitPath('config.lock')).toBeNull();
    expect(classifyGitPath('refs/heads/main.lock')).toBeNull();
    expect(classifyGitPath('index.lock')).toBeNull();
    expect(classifyGitPath('objects/ab/cdef')).toBeNull();
    expect(classifyGitPath('logs/HEAD')).toBeNull();
    expect(classifyGitPath('COMMIT_EDITMSG')).toBeNull();
    expect(classifyGitPath('FETCH_HEAD')).toBeNull();
    // git-lfs's clean filter runs under `git status` and stores what it cleans under the git dir, like objects/**
    expect(classifyGitPath('lfs/objects/ab/cd/abcd1234')).toBeNull();
    expect(classifyGitPath('lfs/tmp/abcd1234')).toBeNull();
    expect(classifyGitPath('lfs')).toBeNull();
    expect(classifyRootPath('.git/lfs/incomplete/abcd', '.git')).toBeNull();
  });

  it('reads a ref as this worktree\'s only when it is its branch, its upstream or the stash; packed-refs and config always', () => {
    const on = status({ branch: 'feat/x', upstream: 'origin/feat/x' });
    for (const sub of ['refs/heads/feat/x', 'refs/remotes/origin/feat/x', 'refs/heads/origin/feat/x', 'refs/stash', 'packed-refs', 'config', 'refs', 'refs/heads', 'refs/heads/feat', 'refs/remotes/origin']) {
      expect(refMatters(sub, on), sub).toBe(true);
    }
    for (const sub of ['refs/heads/main', 'refs/heads/feat/xy', 'refs/remotes/origin/main', 'refs/remotes/upstream', 'refs/tags/v1', 'refs/notes/commits']) {
      expect(refMatters(sub, on), sub).toBe(false);
    }
    const detached = status({ branch: null, upstream: null });
    expect(refMatters('refs/heads/main', detached)).toBe(false);
    expect(refMatters('refs/stash', detached)).toBe(true);
  });

  it('treats everything else under the root as the worktree, and reads the git dir inside it through the git rule', () => {
    expect(classifyRootPath('src/a.ts', '.git')).toBe('worktree');
    expect(classifyRootPath('.gitignore', '.git')).toBe('worktree');
    expect(classifyRootPath('.git/index', '.git')).toBe('index');
    expect(classifyRootPath('.git/objects/ab/cd', '.git')).toBeNull();
    expect(classifyRootPath('.git', '.git')).toBeNull();
    expect(classifyRootPath('.git', null)).toBeNull(); // a linked worktree's pointer file
    expect(classifyRootPath('.git/config', '.git')).toBe('refs');
    // A tracked lock file in the worktree is a change like any other; only git's own locks inside the git dir are ignored.
    expect(classifyRootPath('Cargo.lock', '.git')).toBe('worktree');
    expect(classifyRootPath('web/yarn.lock', '.git')).toBe('worktree');
    expect(classifyRootPath('.git/index.lock', '.git')).toBeNull();
  });

  it('reads a linked worktree\'s common dir only for the shared refs, packed-refs and config', () => {
    expect(classifyCommonPath('refs/heads/wt')).toBe('refs');
    expect(classifyCommonPath('refs/remotes/origin/main')).toBe('refs');
    expect(classifyCommonPath('packed-refs')).toBe('refs');
    expect(classifyCommonPath('config')).toBe('refs');
    expect(classifyCommonPath('refs/heads/wt.lock')).toBeNull();
    expect(classifyCommonPath('HEAD')).toBeNull(); // the main worktree's own HEAD and index are not this worktree's
    expect(classifyCommonPath('index')).toBeNull();
    expect(classifyCommonPath('objects/ab/cd')).toBeNull();
    expect(classifyCommonPath('worktrees/wt/index')).toBeNull(); // the per-worktree git dir has its own watch
  });
});

describe('the repository watcher debounces, coalesces and backs off', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs one status 250 ms after the last event and emits the fresh status only when it changed', async () => {
    const fake = fakeWatch();
    let current = status();
    const read = vi.fn(async () => current);
    const emitted: GitChanged[] = [];
    const watcher = new GitWatcher({ status: read, emit: (e) => emitted.push(e), watch: fake.watch, statFile: async () => null });
    expect(await watcher.watch(`${ROOT}/src`)).toEqual(current);
    expect(emitted).toEqual([{ repoRoot: ROOT, status: current, reason: 'initial' }]);
    await vi.advanceTimersByTimeAsync(1000); // the settle pass after the watch opens finds nothing new
    expect(emitted).toHaveLength(1);
    const reads = read.mock.calls.length;

    current = status({ dirty: true, files: [{ path: 'a.ts', oldPath: null, index: '.', worktree: 'M', untracked: false }] });
    fake.fire(ROOT, 'a.ts');
    await vi.advanceTimersByTimeAsync(200);
    fake.fire(ROOT, '.git/index');
    await vi.advanceTimersByTimeAsync(200);
    expect(read.mock.calls.length).toBe(reads); // still inside the trailing window
    await vi.advanceTimersByTimeAsync(60);
    expect(read.mock.calls.length).toBe(reads + 1);
    expect(emitted.at(-1)).toEqual({ repoRoot: ROOT, status: current, reason: 'index' });

    fake.fire(ROOT, 'a.ts'); // nothing the projection sees changed: silent
    await vi.advanceTimersByTimeAsync(300);
    expect(read.mock.calls.length).toBe(reads + 2);
    expect(emitted).toHaveLength(2);
    watcher.dispose();
  });

  it('says head when HEAD moved, whatever paths the change touched', async () => {
    const fake = fakeWatch();
    let current = status();
    const emitted: GitChanged[] = [];
    const watcher = new GitWatcher({ status: async () => current, emit: (e) => emitted.push(e), watch: fake.watch, statFile: async () => null });
    await watcher.watch(ROOT);
    await vi.advanceTimersByTimeAsync(300);
    current = status({ head: 'b'.repeat(40) });
    fake.fire(ROOT, '.git/refs/heads/main');
    fake.fire(ROOT, '.git/index');
    await vi.advanceTimersByTimeAsync(300);
    expect(emitted.at(-1)?.reason).toBe('head');
    watcher.dispose();
  });

  it('keeps one status in flight per root and re-runs once when dirtied meanwhile', async () => {
    const fake = fakeWatch();
    let release: (s: GitStatus) => void = () => {};
    let n = 0;
    const read = vi.fn(() => (n++ < 2 ? Promise.resolve(status()) : new Promise<GitStatus>((resolve) => (release = resolve))));
    const watcher = new GitWatcher({ status: read, emit: () => {}, watch: fake.watch, statFile: async () => null });
    await watcher.watch(ROOT);
    await vi.advanceTimersByTimeAsync(300); // settle pass: read 2
    fake.fire(ROOT, 'a.ts');
    await vi.advanceTimersByTimeAsync(300); // read 3 starts and hangs
    expect(read).toHaveBeenCalledTimes(3);
    fake.fire(ROOT, 'b.ts');
    await vi.advanceTimersByTimeAsync(300);
    fake.fire(ROOT, 'c.ts');
    await vi.advanceTimersByTimeAsync(300);
    expect(read).toHaveBeenCalledTimes(3); // none started while one is in flight
    release(status());
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(4); // exactly one re-run for everything that arrived meanwhile
    release(status());
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(4);
    watcher.dispose();
  });

  it('after a status timeout debounces that root at 5 s until a status succeeds', async () => {
    const fake = fakeWatch();
    let failing = false;
    const read = vi.fn(async () => {
      if (failing) throw new GitTimeoutError('git status timed out after 10 s in /repo');
      return status();
    });
    const error = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const watcher = new GitWatcher({ status: read, emit: () => {}, watch: fake.watch, statFile: async () => null });
    await watcher.watch(ROOT);
    await vi.advanceTimersByTimeAsync(300);
    failing = true;
    fake.fire(ROOT, 'a.ts');
    await vi.advanceTimersByTimeAsync(300);
    const afterTimeout = read.mock.calls.length;
    fake.fire(ROOT, 'b.ts');
    await vi.advanceTimersByTimeAsync(4900);
    expect(read.mock.calls.length).toBe(afterTimeout); // backed off
    failing = false;
    await vi.advanceTimersByTimeAsync(200);
    expect(read.mock.calls.length).toBe(afterTimeout + 1);
    fake.fire(ROOT, 'c.ts');
    await vi.advanceTimersByTimeAsync(300);
    expect(read.mock.calls.length).toBe(afterTimeout + 2); // a success restores 250 ms
    expect(error).toHaveBeenCalled();
    watcher.dispose();
  });

  it('ref-counts per repository root and watches a linked worktree git dir that lies outside its root', async () => {
    const fake = fakeWatch();
    const wt = status({ repoRoot: '/repo/.claude/worktrees/wt', gitDir: '/repo/.git/worktrees/wt', isWorktree: true, branch: 'wt' });
    const read = vi.fn(async (directory: string) => (directory.startsWith('/repo/.claude/') ? wt : status()));
    const watcher = new GitWatcher({ status: read, emit: () => {}, watch: fake.watch, statFile: async () => null });
    await watcher.watch(ROOT);
    await watcher.watch(`${ROOT}/src`);
    await watcher.watch(ROOT);
    expect(fake.opened.map((w) => w.path)).toEqual([ROOT]); // the main repository's .git is inside its root
    await watcher.watch('/repo/.claude/worktrees/wt');
    // A linked worktree: its root, its own git dir, and the common dir where the shared refs live.
    expect(fake.opened.map((w) => w.path)).toEqual([ROOT, '/repo/.claude/worktrees/wt', '/repo/.git/worktrees/wt', '/repo/.git']);

    watcher.unwatch(`${ROOT}/src`);
    watcher.unwatch(ROOT);
    watcher.unwatch('/never/watched'); // no-op
    expect(fake.opened[0].closed).toBe(false);
    watcher.unwatch(ROOT);
    expect(fake.opened[0].closed).toBe(true);
    watcher.unwatch(ROOT); // below zero is a no-op
    watcher.dispose();
    expect(fake.opened.every((w) => w.closed)).toBe(true);
  });

  it('counts each owner apart and releases everything an owner still holds at once', async () => {
    const fake = fakeWatch();
    const watcher = new GitWatcher({ status: async () => status(), emit: () => {}, watch: fake.watch, statFile: async () => null });
    await watcher.watch(ROOT, 1);
    await watcher.watch(`${ROOT}/src`, 1);
    await watcher.watch(ROOT, 2);
    watcher.unwatch(`${ROOT}/src`, 2); // not owner 2's: a no-op
    watcher.release(1); // window 1 closed or reloaded holding two
    expect(fake.opened[0].closed).toBe(false);
    watcher.unwatch(ROOT, 1); // already released
    expect(fake.opened[0].closed).toBe(false);
    watcher.release(2);
    expect(fake.opened[0].closed).toBe(true);
    await watcher.watch(ROOT, 1); // a reloaded window watches afresh
    expect(fake.opened.filter((w) => !w.closed)).toHaveLength(1);
    watcher.dispose();
  });

  it('holds nothing for a watch whose owner was released while its status was being read', async () => {
    const fake = fakeWatch();
    let answer!: (s: GitStatus) => void;
    const read = vi.fn(() => new Promise<GitStatus>((resolve) => (answer = resolve)));
    const watcher = new GitWatcher({ status: read, emit: () => {}, watch: fake.watch, statFile: async () => null });
    const pending = watcher.watch(ROOT, 1);
    watcher.release(1); // did-navigate while git status runs
    answer(status());
    expect(await pending).toEqual(status());
    expect(fake.opened).toEqual([]); // no root opened, no count left behind
    const again = watcher.watch(ROOT, 1); // the reloaded page watches afresh
    answer(status());
    await again;
    expect(fake.opened.map((w) => w.closed)).toEqual([false]);
    watcher.release(1);
    expect(fake.opened.map((w) => w.closed)).toEqual([true]);
    watcher.dispose();
  });

  it('emits for a content write to a file inside an untracked directory, which porcelain lists as the directory alone', async () => {
    const fake = fakeWatch();
    const files = new Map<string, { size: number; mtimeMs: number }>([[`${ROOT}/new/`, { size: 96, mtimeMs: 1 }]]);
    const current = status({ dirty: true, files: [{ path: 'new/', oldPath: null, index: '?', worktree: '?', untracked: true }] });
    const emitted: GitChanged[] = [];
    const watcher = new GitWatcher({ status: async () => current, emit: (e) => emitted.push(e), watch: fake.watch, statFile: async (path) => files.get(path) ?? null });
    await watcher.watch(ROOT);
    await vi.advanceTimersByTimeAsync(300);
    const quiet = emitted.length;

    files.set(`${ROOT}/new/a.txt`, { size: 3, mtimeMs: 2 });
    fake.fire(ROOT, 'new/a.txt');
    await vi.advanceTimersByTimeAsync(300);
    expect(emitted).toHaveLength(quiet + 1);
    expect(emitted.at(-1)).toMatchObject({ reason: 'worktree', status: current });

    fake.fire(ROOT, 'new/a.txt'); // an event that left the file as it was: silent
    await vi.advanceTimersByTimeAsync(300);
    expect(emitted).toHaveLength(quiet + 1);
    files.set(`${ROOT}/new/a.txt`, { size: 3, mtimeMs: 3 }); // same size, a second write
    fake.fire(ROOT, 'new/a.txt');
    await vi.advanceTimersByTimeAsync(300);
    expect(emitted).toHaveLength(quiet + 2);
    fake.fire(ROOT, 'elsewhere.txt'); // not beneath an untracked directory and not listed: nothing moved
    await vi.advanceTimersByTimeAsync(300);
    expect(emitted).toHaveLength(quiet + 2);
    watcher.dispose();
  });

  it('keeps facts for at most INNER_CAP files beneath untracked directories, and a touched file beyond them counts as a change', async () => {
    const fake = fakeWatch();
    const current = status({ dirty: true, files: [{ path: 'node_modules/', oldPath: null, index: '?', worktree: '?', untracked: true }] });
    const statFile = vi.fn<(path: string) => Promise<{ size: number; mtimeMs: number }>>(async () => ({ size: 1, mtimeMs: 1 }));
    const emitted: GitChanged[] = [];
    const watcher = new GitWatcher({ status: async () => current, emit: (e) => emitted.push(e), watch: fake.watch, statFile });
    await watcher.watch(ROOT);
    await vi.advanceTimersByTimeAsync(300);
    const file = (i: number) => `node_modules/pkg/f${i}.js`;
    for (let i = 0; i <= INNER_CAP; i++) fake.fire(ROOT, file(i));
    statFile.mockClear();
    const quiet = emitted.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(statFile.mock.calls.filter(([path]) => String(path).includes('/pkg/'))).toHaveLength(INNER_CAP); // the last is not kept
    expect(emitted).toHaveLength(quiet + 1);

    fake.fire(ROOT, file(0)); // kept, unchanged: silent
    await vi.advanceTimersByTimeAsync(300);
    expect(emitted).toHaveLength(quiet + 1);
    fake.fire(ROOT, file(INNER_CAP)); // beyond the cap: cannot be judged, so it is a change
    await vi.advanceTimersByTimeAsync(300);
    expect(emitted).toHaveLength(quiet + 2);
    watcher.dispose();
  });

  it('fails a watch whose git dir watch cannot open, closing what it opened and registering nothing', async () => {
    const fake = fakeWatch();
    const wt = status({ repoRoot: '/wt', gitDir: '/repo/.git/worktrees/wt', isWorktree: true });
    let refuse = true;
    const watch: WatchFn = (path, options, listener) => {
      if (refuse && path === wt.gitDir) throw Object.assign(new Error(`ENOENT: no such file or directory, watch '${path}'`), { code: 'ENOENT' });
      return fake.watch(path, options, listener);
    };
    const emitted: GitChanged[] = [];
    const watcher = new GitWatcher({ status: async () => wt, emit: (e) => emitted.push(e), watch, statFile: async () => null });
    await expect(watcher.watch('/wt')).rejects.toThrow('ENOENT');
    expect(fake.opened.map((w) => [w.path, w.closed])).toEqual([['/wt', true]]);
    expect(emitted).toEqual([]);
    watcher.unwatch('/wt'); // nothing was counted
    refuse = false;
    await watcher.watch('/wt'); // a later watch opens the root afresh
    expect(fake.opened.filter((w) => !w.closed).map((w) => w.path)).toEqual(['/wt', wt.gitDir, wt.commonDir]);
    watcher.dispose();
  });

  it('caps each debounce window at 1 s from its first event, so a writer that never pauses cannot starve the status', async () => {
    const fake = fakeWatch();
    const reads: number[] = [];
    const start = Date.now();
    const watcher = new GitWatcher({ status: async () => (reads.push(Date.now() - start), status()), emit: () => {}, watch: fake.watch, statFile: async () => null });
    await watcher.watch(ROOT);
    await vi.advanceTimersByTimeAsync(300); // the settle pass
    reads.length = 0;
    const from = Date.now() - start;
    for (let t = 0; t < 3000; t += 100) {
      fake.fire(ROOT, 'target/debug/build.log');
      await vi.advanceTimersByTimeAsync(100);
    }
    const within = reads.map((at) => at - from);
    expect(within.length).toBeGreaterThanOrEqual(2);
    expect(within[0]).toBeLessThanOrEqual(1000);
    expect(within[1]).toBeLessThanOrEqual(2000);
    watcher.dispose();
  });

  it('watches a linked worktree\'s common dir and reads its shared refs and config as refs', async () => {
    const fake = fakeWatch();
    let current = status({ repoRoot: '/wt', gitDir: '/repo/.git/worktrees/wt', isWorktree: true, branch: 'wt', upstream: 'origin/main' });
    const emitted: GitChanged[] = [];
    const read = vi.fn(async () => current);
    const watcher = new GitWatcher({ status: read, emit: (e) => emitted.push(e), watch: fake.watch, statFile: async () => null });
    await watcher.watch('/wt');
    await vi.advanceTimersByTimeAsync(300);
    const reads = read.mock.calls.length;
    fake.fire('/repo/.git', 'objects/ab/cd');
    fake.fire('/repo/.git', 'index'); // the main worktree's index
    await vi.advanceTimersByTimeAsync(300);
    expect(read.mock.calls.length).toBe(reads); // nothing of this worktree's
    current = { ...current, behind: 1 };
    fake.fire('/repo/.git', 'refs/remotes/origin/main');
    await vi.advanceTimersByTimeAsync(300);
    expect(emitted.at(-1)).toMatchObject({ reason: 'refs', status: { behind: 1 } });
    watcher.dispose();
  });

  it('reads the worktree git dir events through the git rule', async () => {
    const fake = fakeWatch();
    let current = status({ repoRoot: '/wt', gitDir: '/repo/.git/worktrees/wt', isWorktree: true });
    const emitted: GitChanged[] = [];
    const watcher = new GitWatcher({ status: async () => current, emit: (e) => emitted.push(e), watch: fake.watch, statFile: async () => null });
    await watcher.watch('/wt');
    await vi.advanceTimersByTimeAsync(300);
    current = { ...current, stashCount: 1 };
    fake.fire('/repo/.git/worktrees/wt', 'objects/xx'); // ignored: no status
    await vi.advanceTimersByTimeAsync(300);
    expect(emitted).toHaveLength(1);
    fake.fire('/repo/.git/worktrees/wt', 'index');
    await vi.advanceTimersByTimeAsync(300);
    expect(emitted.at(-1)?.reason).toBe('index');
    watcher.dispose();
  });

  // Counts the status runs one burst of events causes, each burst in a debounce window of its own.
  function counter(read: { mock: { calls: unknown[] } }, fire: (path: string, filename: string) => void) {
    return async (path: string, ...filenames: string[]) => {
      const before = read.mock.calls.length;
      for (const filename of filenames) fire(path, filename);
      await vi.advanceTimersByTimeAsync(1100);
      return read.mock.calls.length - before;
    };
  }

  it('runs no status for writes inside a linked worktree under the root: one of the engine layout, one git registers, a nested .git', async () => {
    const fake = fakeWatch();
    const read = vi.fn(async () => status());
    let linked = ['/repo/hand/made', '/elsewhere/wt', '/repo'];
    const linkedWorktrees = vi.fn(async () => linked);
    const watcher = new GitWatcher({ status: read, emit: () => {}, watch: fake.watch, statFile: async () => null, linkedWorktrees });
    await watcher.watch(ROOT);
    expect(linkedWorktrees).toHaveBeenCalledWith('/repo/.git');
    const runs = counter(read, fake.fire);
    await runs(ROOT); // the settle pass
    expect(await runs(ROOT, '.claude/worktrees/a/src/x.ts', '.claude/worktrees/a/.git', 'pkg/.claude/worktrees/b/y.ts')).toBe(0); // the engine's, registered or not yet
    expect(await runs(ROOT, 'hand/made/src/y.ts', 'hand/made/.git', 'vendor/clone/.git')).toBe(0);
    expect(await runs(ROOT, '.claude/worktrees/a')).toBe(1); // the checkout's own directory appearing or going is the parent's
    expect(await runs(ROOT, 'hand/made')).toBe(1);
    expect(await runs(ROOT, 'hand/other.ts')).toBe(1);
    // a worktree added meanwhile: its registration in the common dir re-reads the list, which is not itself a change
    linked = [...linked, '/repo/later'];
    expect(await runs(ROOT, '.git/worktrees/later/gitdir')).toBe(0);
    expect(linkedWorktrees).toHaveBeenCalledTimes(2);
    expect(await runs(ROOT, 'later/f.ts')).toBe(0);
    expect(await runs(ROOT, '.git/worktrees/later/HEAD', '.git/worktrees/later/index')).toBe(0); // its own git dir
    expect(linkedWorktrees).toHaveBeenCalledTimes(2);
    watcher.dispose();
  });

  it('re-reads the linked worktrees from a linked worktree\'s common dir watch, and from a separate git dir', async () => {
    const fake = fakeWatch();
    const wt = status({ repoRoot: '/wt', gitDir: '/repo/.git/worktrees/wt', isWorktree: true, branch: 'wt' });
    const separate = status({ repoRoot: '/work', gitDir: '/gitdir', commonDir: '/gitdir' });
    const linkedWorktrees = vi.fn(async () => ['/wt/nested']);
    const read = vi.fn(async (directory: string) => (directory.startsWith('/wt') ? wt : separate));
    const watcher = new GitWatcher({ status: read, emit: () => {}, watch: fake.watch, statFile: async () => null, linkedWorktrees });
    await watcher.watch('/wt');
    await watcher.watch('/work');
    const runs = counter(read, fake.fire);
    await runs('/wt');
    expect(await runs('/wt', 'nested/a.ts')).toBe(0);
    expect(linkedWorktrees.mock.calls).toEqual([['/repo/.git'], ['/gitdir']]);
    await runs('/repo/.git', 'worktrees/other/gitdir');
    await runs('/gitdir', 'worktrees/x');
    expect(linkedWorktrees.mock.calls).toEqual([['/repo/.git'], ['/gitdir'], ['/repo/.git'], ['/gitdir']]);
    watcher.dispose();
  });

  it('re-checks a root for a ref only when the ref can move its status: its branch, its upstream, the stash, packed-refs, config', async () => {
    const fake = fakeWatch();
    const main = status({ upstream: 'origin/main' });
    const wt = status({ repoRoot: '/wt', gitDir: '/repo/.git/worktrees/wt', isWorktree: true, branch: 'wt' });
    const read = vi.fn(async (directory: string) => (directory === '/wt' ? wt : main));
    const watcher = new GitWatcher({ status: read, emit: () => {}, watch: fake.watch, statFile: async () => null, linkedWorktrees: async () => [] });
    await watcher.watch(ROOT);
    const runs = counter(read, fake.fire);
    await runs(ROOT);
    // the main checkout: a commit in a linked worktree moves only that worktree's branch, a tag moves nothing listed
    expect(await runs(ROOT, '.git/refs/heads/wt', '.git/refs/tags/v1', '.git/refs/remotes/origin/other', '.git/worktrees/wt/HEAD', '.git/worktrees/wt/index')).toBe(0);
    for (const ref of ['.git/refs/heads/main', '.git/refs/remotes/origin/main', '.git/refs/stash', '.git/packed-refs', '.git/config', '.git/refs/heads']) {
      expect(await runs(ROOT, ref), ref).toBe(1);
    }
    watcher.dispose();

    const linked = new GitWatcher({ status: read, emit: () => {}, watch: fake.watch, statFile: async () => null, linkedWorktrees: async () => [] });
    await linked.watch('/wt');
    const wtRuns = counter(read, fake.fire);
    await wtRuns('/wt');
    // the common dir: another worktree's branch and its per-worktree files are not this one's
    expect(await wtRuns('/repo/.git', 'refs/heads/main', 'worktrees/other/HEAD', 'worktrees/other/index', 'HEAD', 'index')).toBe(0);
    expect(await wtRuns('/repo/.git', 'refs/heads/wt')).toBe(1);
    expect(await wtRuns('/repo/.git', 'packed-refs')).toBe(1);
    expect(await wtRuns('/repo/.git/worktrees/wt', 'HEAD')).toBe(1); // its own git dir
    linked.dispose();
  });

  // A ref is judged by the last status's branch and upstream, which a status in flight may be about to change (`checkout
  // -b next` read, then a commit on next): while one runs, every ref counts.
  it('counts any ref while a status is in flight, since the branch it is judged by may be moving', async () => {
    const fake = fakeWatch();
    let release: (s: GitStatus) => void = () => {};
    let hang = false;
    let current = status();
    const read = vi.fn(() => (hang ? new Promise<GitStatus>((resolve) => (release = resolve)) : Promise.resolve(current)));
    const watcher = new GitWatcher({ status: read, emit: () => {}, watch: fake.watch, statFile: async () => null, linkedWorktrees: async () => [] });
    await watcher.watch(ROOT);
    await vi.advanceTimersByTimeAsync(300);
    const reads = read.mock.calls.length;
    hang = true;
    fake.fire(ROOT, '.git/HEAD');
    await vi.advanceTimersByTimeAsync(300); // a status starts and hangs; the last one said main
    fake.fire(ROOT, '.git/refs/heads/next');
    await vi.advanceTimersByTimeAsync(300);
    hang = false;
    current = status({ branch: 'next' });
    release(current);
    await vi.advanceTimersByTimeAsync(0);
    expect(read.mock.calls.length).toBe(reads + 2); // the ref that arrived meanwhile re-ran it
    fake.fire(ROOT, '.git/refs/heads/main'); // judged by next now
    await vi.advanceTimersByTimeAsync(1100);
    expect(read.mock.calls.length).toBe(reads + 2);
    watcher.dispose();
  });

  // The back-off side of the debounce cap: once a status timed out, a writer that never pauses gets one status 5 s after
  // each window's first event (debounce and cap both 5 s), never sooner and never starved; the first success restores
  // the 250 ms debounce and the 1 s cap.
  it('under back-off caps each window at 5 s from its first event, and a success restores the 1 s cap', async () => {
    const fake = fakeWatch();
    let failing = false;
    const reads: number[] = [];
    const start = Date.now();
    const read = vi.fn(async () => {
      reads.push(Date.now() - start);
      if (failing) throw new GitTimeoutError('git status timed out after 10 s in /repo');
      return status();
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const watcher = new GitWatcher({ status: read, emit: () => {}, watch: fake.watch, statFile: async () => null, linkedWorktrees: async () => [] });
    await watcher.watch(ROOT);
    await vi.advanceTimersByTimeAsync(300);
    failing = true;
    fake.fire(ROOT, 'a.ts');
    await vi.advanceTimersByTimeAsync(300); // times out: back-off from here
    reads.length = 0;
    const from = Date.now() - start;
    const writeFor = async (ms: number) => {
      for (let t = 0; t < ms; t += 100) {
        fake.fire(ROOT, 'target/debug/build.log');
        await vi.advanceTimersByTimeAsync(100);
      }
    };
    await writeFor(10_000);
    expect(reads.map((at) => at - from)).toEqual([5000, 10_000]);
    failing = false;
    await writeFor(8000);
    expect(reads.map((at) => at - from)).toEqual([5000, 10_000, 15_000, 16_000, 17_000, 18_000]);
    watcher.dispose();
  });
});

// Real repositories, real FSEvents. Each wait is bounded; the "within 1 s" pin is measured from the write.
describe('git.changed from a watched fixture repository', () => {
  let repo: GitFixture;
  let service: GitService;
  let events: GitChanged[];
  beforeEach(async () => {
    repo = await GitFixture.create();
    events = [];
    service = new GitService({ emit: (e) => events.push(e), env: repo.serviceEnv() });
  });
  afterEach(() => {
    service.dispose();
    repo.dispose();
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 600)); // past the settle pass and one debounce
  async function nextChange(from: number, withinMs: number): Promise<{ event: GitChanged; ms: number }> {
    const start = Date.now();
    while (Date.now() - start < withinMs) {
      if (events.length > from) return { event: events[from], ms: Date.now() - start };
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`no git.changed within ${withinMs} ms`);
  }

  it('emits worktree within 1 s of a write, stays silent for a byte-identical save, and emits for each content write to a dirty file', async () => {
    await service.watch(repo.root);
    await settle();
    const baseline = events.length;

    await repo.write('scratch.txt', 'one\n');
    const first = await nextChange(baseline, 1000);
    expect(first.event).toMatchObject({ repoRoot: repo.root, reason: 'worktree', status: { dirty: true, files: [{ path: 'scratch.txt', untracked: true }] } });
    expect(GitChangedSchema.parse(first.event)).toEqual(first.event); // what main's emit validates before sending

    // A whole-second mtime (itself a change) so the identical save below can restore it exactly.
    await settle();
    await repo.setMtime('scratch.txt', 1_700_000_000);
    await nextChange(events.length, 1000);
    await settle();
    const quiet = events.length;
    await repo.rewriteIdentical('scratch.txt');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(events.length).toBe(quiet);

    await repo.write('scratch.txt', 'two\n'); // same size, new mtime: the porcelain status is identical
    const second = await nextChange(quiet, 1000);
    expect(second.event.status.files).toEqual(first.event.status.files);
    await settle();
    const before = events.length;
    await repo.write('scratch.txt', 'three\n');
    await nextChange(before, 1000);

    // The same holds for a tracked file that is already modified.
    await repo.write('README.md', 'hello\nedited\n');
    await nextChange(events.length, 1000);
    await settle();
    const dirtyTracked = events.length;
    await repo.write('README.md', 'hello\nedited again\n');
    const again = await nextChange(dirtyTracked, 1000);
    expect(again.event.status.files).toContainEqual({ path: 'README.md', oldPath: null, index: '.', worktree: 'M', untracked: false });
  }, 15_000);

  it('emits for each content write to a file inside an untracked directory', async () => {
    await repo.write('notes/draft.md', 'one\n');
    await service.watch(repo.root);
    await settle();
    const baseline = events.length;
    await repo.write('notes/draft.md', 'two\n'); // the directory's entries are unchanged: only the file's facts move
    const { event } = await nextChange(baseline, 1000);
    expect(event).toMatchObject({ reason: 'worktree', status: { files: [{ path: 'notes/', untracked: true }] } });
    await settle();
    const before = events.length;
    await repo.write('notes/draft.md', 'three\n');
    await nextChange(before, 1000);
  }, 10_000);

  it('emits head for a commit', async () => {
    await repo.write('README.md', 'hello\nmore\n');
    const watched = await service.watch(repo.root);
    await settle();
    const baseline = events.length;
    await repo.git('commit', '-q', '-am', 'second');
    const { event } = await nextChange(baseline, 2000);
    expect(event.reason).toBe('head');
    expect(event.status.head).not.toBe(watched.head);
    expect(event.status.dirty).toBe(false);
  }, 10_000);

  it('emits for an edit to a tracked lock file', async () => {
    await repo.write('Cargo.lock', 'version = 3\n');
    await repo.git('add', 'Cargo.lock');
    await repo.git('commit', '-q', '-m', 'lock');
    await service.watch(repo.root);
    await settle();
    const baseline = events.length;
    await repo.write('Cargo.lock', 'version = 4\n');
    const { event } = await nextChange(baseline, 1000);
    expect(event).toMatchObject({ reason: 'worktree', status: { files: [{ path: 'Cargo.lock', worktree: 'M' }] } });
  }, 10_000);

  it('emits for a linked worktree when a shared ref in the common dir moves its ahead/behind', async () => {
    await repo.addBareRemote();
    const wt = await repo.addWorktree('wt');
    await repo.git('-C', wt, 'branch', '-q', '-u', 'origin/main'); // wt tracks origin/main (config in the common dir)
    const watched = await service.watch(wt);
    expect(watched).toMatchObject({ isWorktree: true, upstream: 'origin/main', behind: 0 });
    await settle();
    const baseline = events.length;
    // In the main repository (a write inside the temporary fixture only): main moves on and the remote-tracking ref
    // follows, as a push or fetch would; nothing under the worktree's root or its own git dir changes.
    await repo.write('README.md', 'hello\nmain moved\n');
    await repo.git('commit', '-q', '-am', 'main moves');
    await repo.git('update-ref', 'refs/remotes/origin/main', 'main');
    const { event } = await nextChange(baseline, 2000);
    expect(event).toMatchObject({ repoRoot: wt, reason: 'refs', status: { branch: 'wt', behind: 1 } });
  }, 10_000);

  // The churn: a session working in a linked worktree under the root writes there continuously. Git never reads a nested
  // checkout's files as the parent's (with the engine's runtime exclude, not even its directory), so those writes must
  // not run the parent's status; without the exclude they also emitted, since `.claude/` is then an untracked directory.
  it.each([
    ['without', false],
    ['with', true],
  ])("runs no status of the main repository for writes inside its linked worktrees, %s the engine's runtime exclude", async (_label, excluded) => {
    const execFile = vi.fn(nodeExecFile as unknown as ExecFileFn);
    const local = new GitService({ emit: (e) => events.push(e), execFile, env: repo.serviceEnv() });
    const engine = await repo.addWorktree('engine');
    await repo.git('worktree', 'add', '-q', 'hand/made', '-b', 'hand'); // a hand-made one elsewhere under the root
    if (excluded) await repo.write('.git/info/exclude', '**/.claude/worktrees/\n/hand/\n');
    const statusRuns = () => execFile.mock.calls.filter(([, args]) => args[2] === 'status' && args[1] === repo.root).length;
    try {
      await local.watch(repo.root);
      await settle();
      const [runs, emitted] = [statusRuns(), events.length];
      for (let i = 0; i < 5; i++) {
        await repo.write(`.claude/worktrees/engine/src/f${i}.ts`, `${i}\n`);
        await repo.write(`hand/made/g${i}.ts`, `${i}\n`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await repo.git('-C', engine, 'add', '-A');
      await repo.git('-C', engine, 'commit', '-q', '-m', 'work in the linked worktree'); // its own index, HEAD and branch
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(statusRuns()).toBe(runs);
      expect(events.length).toBe(emitted);
      await repo.write('root.txt', 'x\n'); // the main checkout's own write still runs and emits
      await nextChange(emitted, 2000);
      expect(statusRuns()).toBeGreaterThan(runs);
    } finally {
      local.dispose();
    }
  }, 15_000);

  it('emits nothing after the last unwatch', async () => {
    const spy = vi.fn(fsWatch as unknown as WatchFn);
    const local = new GitService({ emit: (e) => events.push(e), watch: spy, env: repo.serviceEnv() });
    await local.watch(repo.root);
    await settle();
    local.unwatch(repo.root);
    const after = events.length;
    await repo.write('late.txt', 'x\n');
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(events.length).toBe(after);
    expect(spy).toHaveBeenCalledTimes(1);
    local.dispose();
  }, 10_000);
});
