import { execFile as nodeExecFile } from 'node:child_process';
import { watch as fsWatch, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitChangedSchema, type GitChanged, type GitStatus } from '@shared/ipc/schema/git';
import { RECONCILE_MS, watchTree } from '@shared/fs/watch-tree';
import { drain, errno, FakeWatchFs } from '../../../test/support/fake-watch-fs';
import { GitFixture } from '../../../test/support/git-fixture';
import { GitTimeoutError, type ExecFileFn } from './runner';
import { GitService } from './service';
import { classifyCommonPath, classifyGitPath, classifyRootPath, GitWatcher, INNER_CAP, isNestedRepository, POLL_MS, refMatters, type WatchFn } from './watcher';

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
    // A remote fetched into a namespace of its own (`remote.review.fetch=+refs/heads/*:refs/custom/review/*`) tracks as
    // `custom/review/main`; its ref counts, and so does any ref outside the namespaces known not to be it.
    const custom = status({ branch: 'main', upstream: 'custom/review/main' });
    for (const sub of ['refs/custom/review/main', 'refs/custom', 'refs/other/thing']) expect(refMatters(sub, custom), sub).toBe(true);
    for (const sub of ['refs/remotes/origin/main', 'refs/tags/v1']) expect(refMatters(sub, custom), sub).toBe(false);
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

  // The parent's status reads a submodule's HEAD, index and refs for the gitlink's line; a commit on a branch inside it
  // moves its index and its reflog's logs/HEAD, not the HEAD file.
  it("counts a submodule's HEAD, reflog HEAD, index and reftable under modules/, at any depth, as the parent's worktree", () => {
    for (const sub of ['modules/up/HEAD', 'modules/libs/up/HEAD', 'modules/libs/up/logs/HEAD', 'modules/libs/up/index', 'modules/a/modules/b/HEAD', 'modules/a/modules/b/index', 'modules/up/reftable/tables.list']) {
      expect(classifyGitPath(sub), sub).toBe('worktree');
    }
    for (const sub of ['modules', 'modules/up', 'modules/up/HEAD.lock', 'modules/up/index.lock', 'modules/up/objects/ab/cdef', 'modules/up/FETCH_HEAD', 'modules/up/ORIG_HEAD', 'modules/up/COMMIT_EDITMSG', 'modules/up/config', 'worktrees/wt/modules/up/HEAD']) {
      expect(classifyGitPath(sub), sub).toBeNull();
    }
    expect(classifyRootPath('.git/modules/libs/up/HEAD', '.git')).toBe('worktree');
    expect(classifyCommonPath('modules/up/HEAD')).toBeNull(); // the main worktree's submodules, not a linked worktree's
  });

  it("counts a reftable repository's tables as refs, which no ref filter rules out since their names carry no ref", () => {
    for (const sub of ['reftable', 'reftable/tables.list', 'reftable/0x000000000001-0x000000000003-60af3f9a.ref']) expect(classifyGitPath(sub), sub).toBe('refs');
    expect(classifyGitPath('reftable/tables.list.lock')).toBeNull();
    expect(classifyCommonPath('reftable/tables.list')).toBe('refs');
    expect(classifyCommonPath('worktrees/other/reftable/tables.list')).toBeNull(); // another worktree's HEAD
    expect(refMatters('reftable/tables.list', status({ branch: 'feat/x', upstream: 'origin/feat/x' }))).toBe(true);
    expect(refMatters('reftable/0x000000000001-0x000000000003-60af3f9a.ref', status({ branch: null, upstream: null }))).toBe(true);
  });
});

// git status (probed with `--untracked-files=all`) enters a directory whose `.git` is an empty directory, a junk file, a
// gitfile naming nothing, or a git dir without a valid HEAD, and lists only the directory of one whose `.git` is a git
// dir or a gitfile naming one.
describe('the repository watcher reads a nested `.git` as git does', () => {
  let base: string;
  beforeEach(() => void (base = realpathSync(mkdtempSync(join(tmpdir(), 'maws-nested-')))));
  afterEach(() => rmSync(base, { recursive: true, force: true }));
  const gitDir = (dir: string, head: string | null, common = dir) => {
    mkdirSync(join(common, 'objects'), { recursive: true });
    mkdirSync(join(common, 'refs'), { recursive: true });
    mkdirSync(dir, { recursive: true });
    if (head !== null) writeFileSync(join(dir, 'HEAD'), head);
  };
  const shape = (name: string, make: (dir: string) => void) => {
    const dir = join(base, name);
    mkdirSync(dir, { recursive: true });
    make(dir);
    return dir;
  };

  it('counts a git dir with a valid HEAD, objects/ and refs/, or a gitfile naming one; nothing else', async () => {
    gitDir(join(base, 'elsewhere'), 'ref: refs/heads/main\n');
    gitDir(join(base, 'main.git', 'worktrees', 'wt'), 'a'.repeat(40) + '\n', join(base, 'main.git'));
    writeFileSync(join(base, 'main.git', 'worktrees', 'wt', 'commondir'), '../..\n');
    const yes = {
      clone: shape('clone', (dir) => gitDir(join(dir, '.git'), 'ref: refs/heads/main\n')),
      detached: shape('detached', (dir) => gitDir(join(dir, '.git'), 'b'.repeat(40) + '\n')),
      reftable: shape('reftable', (dir) => gitDir(join(dir, '.git'), 'ref: refs/heads/.invalid\n')),
      symlinked: shape('symlinked', (dir) => {
        gitDir(join(dir, '.git'), null);
        symlinkSync('refs/heads/main', join(dir, '.git', 'HEAD'));
      }),
      gitfile: shape('gitfile', (dir) => writeFileSync(join(dir, '.git'), `gitdir: ${join(base, 'elsewhere')}\n`)),
      relative: shape('relative', (dir) => writeFileSync(join(dir, '.git'), 'gitdir: ../elsewhere\n')),
      worktree: shape('worktree', (dir) => writeFileSync(join(dir, '.git'), `gitdir: ${join(base, 'main.git', 'worktrees', 'wt')}\n`)),
    };
    const no = {
      none: shape('none', () => {}),
      empty: shape('empty', (dir) => mkdirSync(join(dir, '.git'))),
      junk: shape('junk', (dir) => writeFileSync(join(dir, '.git'), 'not a gitfile\n')),
      nowhere: shape('nowhere', (dir) => writeFileSync(join(dir, '.git'), `gitdir: ${join(base, 'missing')}\n`)),
      headless: shape('headless', (dir) => gitDir(join(dir, '.git'), null)), // `git init` caught before its HEAD
      junkHead: shape('junkHead', (dir) => gitDir(join(dir, '.git'), 'garbage\n')),
    };
    for (const [name, dir] of Object.entries(yes)) expect(await isNestedRepository(dir), name).toBe(true);
    for (const [name, dir] of Object.entries(no)) expect(await isNestedRepository(dir), name).toBe(false);
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

  it('retries a timed-out status once, 5 s later, when no further event comes; a timed-out retry waits for the next event', async () => {
    const fake = fakeWatch();
    let failing = false;
    let current = status();
    const read = vi.fn(async () => {
      if (failing) throw new GitTimeoutError('git status timed out after 10 s in /repo');
      return current;
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const emitted: GitChanged[] = [];
    const watcher = new GitWatcher({ status: read, emit: (e) => emitted.push(e), watch: fake.watch, statFile: async () => null });
    await watcher.watch(ROOT);
    await vi.advanceTimersByTimeAsync(300);
    const settled = read.mock.calls.length;

    failing = true;
    current = status({ dirty: true, files: [{ path: 'a.ts', oldPath: null, index: '.', worktree: 'M', untracked: false }] });
    fake.fire(ROOT, 'a.ts'); // the last change, and its status times out
    await vi.advanceTimersByTimeAsync(300);
    expect(read.mock.calls.length).toBe(settled + 1);
    failing = false;
    await vi.advanceTimersByTimeAsync(4900);
    expect(read.mock.calls.length).toBe(settled + 1);
    await vi.advanceTimersByTimeAsync(200); // the retry
    expect(read.mock.calls.length).toBe(settled + 2);
    expect(emitted.at(-1)).toEqual({ repoRoot: ROOT, status: current, reason: 'worktree' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read.mock.calls.length).toBe(settled + 2); // a success schedules nothing

    failing = true;
    fake.fire(ROOT, 'b.ts');
    await vi.advanceTimersByTimeAsync(300); // times out
    await vi.advanceTimersByTimeAsync(5000); // the retry times out too
    expect(read.mock.calls.length).toBe(settled + 4);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read.mock.calls.length).toBe(settled + 4); // bounded: one retry per change
    failing = false;
    fake.fire(ROOT, 'c.ts'); // a new event still reads, under the back-off
    await vi.advanceTimersByTimeAsync(5000);
    expect(read.mock.calls.length).toBe(settled + 5);
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
    await watcher.watch(ROOT, 'p1');
    await watcher.watch(`${ROOT}/src`, 'p1');
    await watcher.watch(ROOT, 'p2');
    watcher.unwatch(`${ROOT}/src`, 'p2'); // not owner 2's: a no-op
    watcher.release('p1'); // window 1 closed or reloaded holding two
    expect(fake.opened[0].closed).toBe(false);
    watcher.unwatch(ROOT, 'p1'); // already released
    expect(fake.opened[0].closed).toBe(false);
    watcher.release('p2');
    expect(fake.opened[0].closed).toBe(true);
    await watcher.watch(ROOT, 'p1'); // a reloaded window watches afresh
    expect(fake.opened.filter((w) => !w.closed)).toHaveLength(1);
    watcher.dispose();
  });

  it('holds nothing for a watch whose owner was released while its status was being read', async () => {
    const fake = fakeWatch();
    let answer!: (s: GitStatus) => void;
    const read = vi.fn(() => new Promise<GitStatus>((resolve) => (answer = resolve)));
    const watcher = new GitWatcher({ status: read, emit: () => {}, watch: fake.watch, statFile: async () => null });
    const pending = watcher.watch(ROOT, 'p1');
    watcher.release('p1'); // did-navigate while git status runs
    answer(status());
    expect(await pending).toEqual(status());
    expect(fake.opened).toEqual([]); // no root opened, no count left behind
    const again = watcher.watch(ROOT, 'p1'); // the reloaded page watches afresh
    answer(status());
    await again;
    expect(fake.opened.map((w) => w.closed)).toEqual([false]);
    watcher.release('p1');
    expect(fake.opened.map((w) => w.closed)).toEqual([true]);
    watcher.dispose();
  });

  it('emits for a content write to a file inside an untracked directory, which porcelain lists as the directory alone', async () => {
    const fake = fakeWatch();
    const files = new Map<string, { size: number; mtimeMs: number }>([[`${ROOT}/new/`, { size: 96, mtimeMs: 1 }]]);
    const current = status({ dirty: true, files: [{ path: 'new/', oldPath: null, index: '?', worktree: '?', untracked: true }] });
    const emitted: GitChanged[] = [];
    const watcher = new GitWatcher({ status: async () => current, emit: (e) => emitted.push(e), watch: fake.watch, statFile: async (path) => files.get(path) ?? null, isRepository: async () => false });
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
    const isRepository = vi.fn<(directory: string) => Promise<boolean>>(async () => false);
    const emitted: GitChanged[] = [];
    const watcher = new GitWatcher({ status: async () => current, emit: (e) => emitted.push(e), watch: fake.watch, statFile, isRepository });
    await watcher.watch(ROOT);
    await vi.advanceTimersByTimeAsync(300);
    const file = (i: number) => `node_modules/pkg/f${i}.js`;
    for (let i = 0; i <= INNER_CAP; i++) fake.fire(ROOT, file(i));
    statFile.mockClear();
    const quiet = emitted.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(statFile.mock.calls.filter(([path]) => String(path).includes('/pkg/'))).toHaveLength(INNER_CAP); // the last is not kept
    expect(isRepository.mock.calls).toEqual([[`${ROOT}/node_modules`], [`${ROOT}/node_modules/pkg`]]); // one ask per directory, not per file
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

  // Git never enters a directory holding a `.git` of its own while it lists untracked files: the repository is one
  // `dir/` line, or lies inside an untracked parent's, and nothing beneath it is the root's. A gitlink (a submodule, or
  // an embedded clone whose `.git` is a directory) is tracked, and its status is the parent's to read.
  it('runs no status for writes inside a repository nested under an untracked directory once a pass has found it; a tracked one keeps counting', async () => {
    const fake = fakeWatch();
    const untracked = (path: string) => ({ path, oldPath: null, index: '?', worktree: '?', untracked: true });
    const current = status({ dirty: true, files: [untracked('direct/'), untracked('notes/'), untracked('vendor/'), { path: 'emb', oldPath: null, index: '.', worktree: 'M', untracked: false }] });
    const files = new Map<string, { size: number; mtimeMs: number }>();
    const write = (rel: string, mtimeMs: number) => files.set(`${ROOT}/${rel}`, { size: 1, mtimeMs });
    const repos = new Set([`${ROOT}/vendor/clone`, `${ROOT}/direct`, `${ROOT}/emb`]);
    const isRepository = vi.fn(async (directory: string) => repos.has(directory));
    const read = vi.fn(async () => current);
    const emitted: GitChanged[] = [];
    const watcher = new GitWatcher({ status: read, emit: (e) => emitted.push(e), watch: fake.watch, statFile: async (path) => files.get(path) ?? null, isRepository, linkedWorktrees: async () => [] });
    await watcher.watch(ROOT);
    const runs = counter(read, fake.fire);
    await runs(ROOT);
    const quiet = emitted.length;

    // a clone inside the untracked `vendor/`, found by asking each directory: its first write costs one status that finds nothing new
    write('vendor/clone/src/a.ts', 1);
    expect(await runs(ROOT, 'vendor/clone/src/a.ts')).toBe(1);
    expect(isRepository).toHaveBeenCalledWith(`${ROOT}/vendor/clone`);
    write('vendor/clone/src/a.ts', 2);
    expect(await runs(ROOT, 'vendor/clone/src/a.ts', 'vendor/clone/.git/index', 'vendor/clone/.git/HEAD')).toBe(0);
    // a clone listed as `direct/`, found from a write through its own `.git/`
    expect(await runs(ROOT, 'direct/.git/refs/heads/main')).toBe(1);
    write('direct/x.ts', 1);
    expect(await runs(ROOT, 'direct/x.ts')).toBe(0);
    expect(emitted).toHaveLength(quiet); // nothing inside a nested repository moved the parent

    // a `.git` that is no repository (an empty directory, a junk file) leaves its directory the root's: asked, not assumed
    expect(await runs(ROOT, 'notes/.git/config')).toBe(1);
    expect(emitted).toHaveLength(quiet); // what lies in a `.git` is never the root's file
    write('notes/draft.md', 1);
    expect(await runs(ROOT, 'notes/draft.md')).toBe(1);
    expect(emitted).toHaveLength(quiet + 1);
    // a repository created over a file the projection holds: the pass that finds it lets the file go, no later one does
    repos.add(`${ROOT}/notes`);
    expect(await runs(ROOT, 'notes/.git/HEAD')).toBe(1);
    const created = emitted.length;
    expect(await runs(ROOT, 'elsewhere.ts', 'notes/draft.md')).toBe(1);
    expect(emitted).toHaveLength(created);
    // a tracked repository is the parent's, whatever its `.git` is
    expect(await runs(ROOT, 'emb/src/c.ts')).toBe(1);
    expect(await runs(ROOT, 'emb/.git/index')).toBe(1);
    expect(isRepository).not.toHaveBeenCalledWith(`${ROOT}/emb`);
    watcher.dispose();
  });

  // A rename names only what moved (`mv vendor/clone away && mkdir vendor/clone`, or `mv vendor away`), never what lay
  // beneath it, so an event naming a found repository's directory, its `.git` or a directory above it forgets it at once.
  it("forgets a found repository on an event naming its directory, its `.git` or a directory above it, and when a pass finds it gone", async () => {
    const fake = fakeWatch();
    const current = status({ dirty: true, files: [{ path: 'vendor/', oldPath: null, index: '?', worktree: '?', untracked: true }] });
    const files = new Map<string, { size: number; mtimeMs: number }>();
    const write = (rel: string, mtimeMs: number) => files.set(`${ROOT}/${rel}`, { size: 1, mtimeMs });
    const repos = new Set<string>();
    const read = vi.fn(async () => current);
    const emitted: GitChanged[] = [];
    const watcher = new GitWatcher({ status: read, emit: (e) => emitted.push(e), watch: fake.watch, statFile: async (path) => files.get(path) ?? null, isRepository: async (directory) => repos.has(directory), linkedWorktrees: async () => [] });
    await watcher.watch(ROOT);
    const runs = counter(read, fake.fire);
    await runs(ROOT);
    let round = 0;
    const found = async () => {
      repos.add(`${ROOT}/vendor/clone`);
      write('vendor/clone/src/a.ts', ++round);
      expect(await runs(ROOT, 'vendor/clone/src/a.ts')).toBe(1);
      expect(await runs(ROOT, 'vendor/clone/src/a.ts')).toBe(0);
      repos.delete(`${ROOT}/vendor/clone`); // what replaces it is no repository
    };
    for (const event of ['vendor/clone', 'vendor', 'vendor/clone/.git']) {
      await found();
      const file = `vendor/clone/new${round}.ts`;
      write(file, 1);
      expect(await runs(ROOT, event, file), event).toBe(1); // the replacement's first file, in the rename's own window
      const before = emitted.length;
      write(file, 2);
      expect(await runs(ROOT, file), event).toBe(1);
      expect(emitted, event).toHaveLength(before + 1); // it is the root's: a content write to it emits
    }
    // a `.git` gone with no event naming it: the next pass, for whatever it runs, asks again and forgets it
    await found();
    expect(await runs(ROOT, 'elsewhere.ts')).toBe(1);
    write('vendor/clone/late.ts', 1);
    expect(await runs(ROOT, 'vendor/clone/late.ts')).toBe(1);
    watcher.dispose();
  });

  it("re-checks the parent for a submodule's HEAD, reflog and index under the git dir's modules/, at any depth", async () => {
    const fake = fakeWatch();
    let current = status();
    const read = vi.fn(async () => current);
    const emitted: GitChanged[] = [];
    const watcher = new GitWatcher({ status: read, emit: (e) => emitted.push(e), watch: fake.watch, statFile: async () => null, linkedWorktrees: async () => [] });
    await watcher.watch(ROOT);
    const runs = counter(read, fake.fire);
    await runs(ROOT);
    // a commit on a branch inside `libs/up` (a name with a slash): what git writes there, HEAD itself untouched
    current = status({ dirty: true, files: [{ path: 'libs/up', oldPath: null, index: '.', worktree: 'M', untracked: false }] });
    expect(await runs(ROOT, '.git/modules/libs/up/index.lock', '.git/modules/libs/up/index', '.git/modules/libs/up/logs/HEAD', '.git/modules/libs/up/refs/heads/feat')).toBe(1);
    expect(emitted.at(-1)).toEqual({ repoRoot: ROOT, status: current, reason: 'worktree' });
    for (const path of ['.git/modules/libs/up/HEAD', '.git/modules/a/modules/b/HEAD']) expect(await runs(ROOT, path), path).toBe(1);
    // what the parent's status never reads there: the objects, a fetch, git's locks
    expect(await runs(ROOT, '.git/modules/libs/up/objects/ab/cdef', '.git/modules/libs/up/FETCH_HEAD', '.git/modules/libs/up/refs/remotes/origin/main', '.git/modules/libs/up/HEAD.lock')).toBe(0);
    watcher.dispose();

    // a linked worktree's submodules live under its own git dir; the common dir's are the main worktree's
    const wt = status({ repoRoot: '/wt', gitDir: '/repo/.git/worktrees/wt', isWorktree: true, branch: 'wt' });
    const wtRead = vi.fn(async () => wt);
    const linked = new GitWatcher({ status: wtRead, emit: () => {}, watch: fake.watch, statFile: async () => null, linkedWorktrees: async () => [] });
    await linked.watch('/wt');
    const wtRuns = counter(wtRead, fake.fire);
    await wtRuns('/wt');
    expect(await wtRuns('/repo/.git/worktrees/wt', 'modules/up/HEAD')).toBe(1);
    expect(await wtRuns('/repo/.git', 'modules/up/HEAD', 'modules/up/index')).toBe(0);
    linked.dispose();
  });

  it('re-checks a reftable repository for any write to its tables, whatever ref moved', async () => {
    const fake = fakeWatch();
    let current = status({ upstream: 'origin/main' });
    const read = vi.fn(async () => current);
    const emitted: GitChanged[] = [];
    const watcher = new GitWatcher({ status: read, emit: (e) => emitted.push(e), watch: fake.watch, statFile: async () => null, linkedWorktrees: async () => [] });
    await watcher.watch(ROOT);
    const runs = counter(read, fake.fire);
    await runs(ROOT);
    expect(await runs(ROOT, '.git/reftable/tables.list.lock')).toBe(0);
    current = status({ upstream: 'origin/main', behind: 1 }); // `update-ref refs/remotes/origin/main`, as git writes it
    expect(await runs(ROOT, '.git/reftable/0x000000000006-0x000000000006-882c0787.temp.dypC0x', '.git/reftable/0x000000000006-0x000000000006-45dce094.ref', '.git/reftable/tables.list')).toBe(1);
    expect(emitted.at(-1)).toMatchObject({ reason: 'refs', status: { behind: 1 } });
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

// E6: a mutation from the panel asks for the root's status at once rather than after the debounce, through the
// watcher's own refresh, so its compare-and-emit stays the one publication path.
describe('git watcher refreshes a root on demand', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function watched() {
    const fake = fakeWatch();
    let current = status();
    const read = vi.fn(async () => current);
    const emitted: GitChanged[] = [];
    const watcher = new GitWatcher({ status: read, emit: (e) => emitted.push(e), watch: fake.watch, statFile: async () => null });
    await watcher.watch(ROOT);
    await vi.advanceTimersByTimeAsync(1000); // the settle pass
    return { fake, read, emitted, watcher, set: (next: GitStatus) => (current = next) };
  }
  const staged = status({ dirty: true, files: [{ path: 'a.ts', oldPath: null, index: 'M', worktree: '.', untracked: false }] });

  it('cancels the pending debounce, reads now and emits once the status differs', async () => {
    const { fake, read, emitted, watcher, set } = await watched();
    const reads = read.mock.calls.length;
    set(staged);
    fake.fire(ROOT, '.git/index'); // the debounce is pending
    watcher.refreshNow(ROOT);
    await vi.advanceTimersByTimeAsync(0);
    expect(read.mock.calls.length).toBe(reads + 1);
    expect(emitted.at(-1)).toEqual({ repoRoot: ROOT, status: staged, reason: 'index' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(read.mock.calls.length).toBe(reads + 1); // the cancelled debounce never runs
    expect(emitted).toHaveLength(2);
    watcher.refreshNow(ROOT); // nothing moved: read, and silent
    await vi.advanceTimersByTimeAsync(0);
    expect(read.mock.calls.length).toBe(reads + 2);
    expect(emitted).toHaveLength(2);
    watcher.dispose();
  });

  it('does nothing for a root nobody watches', async () => {
    const { read, emitted, watcher } = await watched();
    const reads = read.mock.calls.length;
    watcher.refreshNow('/elsewhere');
    await vi.advanceTimersByTimeAsync(1000);
    expect(read.mock.calls.length).toBe(reads);
    expect(emitted).toHaveLength(1);
    watcher.unwatch(ROOT);
    watcher.refreshNow(ROOT); // closed with its last watcher
    await vi.advanceTimersByTimeAsync(1000);
    expect(read.mock.calls.length).toBe(reads);
    watcher.dispose();
  });

  it('marks again while a status is in flight, so exactly one more read follows it', async () => {
    const fake = fakeWatch();
    let release: (s: GitStatus) => void = () => {};
    let n = 0;
    const emitted: GitChanged[] = [];
    const read = vi.fn(() => (n++ < 2 ? Promise.resolve(status()) : new Promise<GitStatus>((resolve) => (release = resolve))));
    const watcher = new GitWatcher({ status: read, emit: (e) => emitted.push(e), watch: fake.watch, statFile: async () => null });
    await watcher.watch(ROOT);
    await vi.advanceTimersByTimeAsync(300); // settle pass: read 2
    fake.fire(ROOT, 'a.ts');
    await vi.advanceTimersByTimeAsync(300); // read 3 starts and hangs
    expect(read).toHaveBeenCalledTimes(3);
    watcher.refreshNow(ROOT);
    watcher.refreshNow(ROOT);
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(3); // none started while one is in flight
    release(status());
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(4); // the one re-run, which reads what the mutation left
    release(staged);
    await vi.advanceTimersByTimeAsync(0);
    expect(emitted.at(-1)).toMatchObject({ status: staged });
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(4);
    watcher.dispose();
  });
});

// P5 O3-E M1 (Interfaces §B): on Linux each recursive call is the watch tree, given a prune per call; an exhausted tree
// puts its root in polling; an event with no filename (a reconcile, a poll) re-reads the status and the cached facts
// of the files beneath untracked directories.
describe('the repository watcher over the watch tree', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  // The tree over an in-memory filesystem rooted at the repository, taking the prune the watcher passes.
  function treeOver(fs: FakeWatchFs): WatchFn {
    return (path, options, listener) => watchTree(path, { prune: options.prune, fs: fs.options }, listener);
  }
  const dirty = status({ dirty: true, files: [{ path: 'a.ts', oldPath: null, index: '.', worktree: 'M', untracked: false }] });

  it("prunes the root's ignored directories, its git dir's objects/ and lfs/ and the checkouts nested in it; a git dir or common dir outside it loses objects/ and lfs/ alone", async () => {
    const fake = fakeWatch();
    const prunes = new Map<string, (dir: string) => boolean | Promise<boolean>>();
    const watch: WatchFn = (path, options, listener) => {
      prunes.set(path, options.prune!);
      return fake.watch(path, options, listener);
    };
    const asked: string[] = [];
    const ignored = vi.fn<(root: string) => Promise<(dir: string) => Promise<boolean>>>(async () => async (dir) => (asked.push(dir), dir === 'node_modules'));
    const wt = status({ repoRoot: '/wt', gitDir: '/repo/.git/worktrees/wt', isWorktree: true, branch: 'wt' });
    const read = async (directory: string) => (directory === '/wt' ? wt : status());
    const watcher = new GitWatcher({ status: read, emit: () => {}, watch, statFile: async () => null, ignored, linkedWorktrees: async () => [`${ROOT}/wts/other`, '/wt'] });
    await watcher.watch(ROOT);
    expect(ignored).not.toHaveBeenCalled(); // read only once the tree asks: never on macOS, whose watch takes no prune
    const root = prunes.get(ROOT)!;
    for (const dir of ['node_modules', '.git/objects', '.git/lfs', '.claude/worktrees/wt', 'wts/other']) expect(await root(dir), dir).toBe(true);
    for (const dir of ['src', '.git', '.git/refs', '.git/refs/heads', '.git/worktrees', '.git/worktrees/wt', '.git/logs', '.git/modules', '.claude', '.claude/worktrees', 'wts']) expect(await root(dir), dir).toBe(false);
    expect(ignored.mock.calls).toEqual([[ROOT]]); // once per root
    expect(asked.sort()).toEqual(['.claude', '.claude/worktrees', 'node_modules', 'src', 'wts']); // git's own directories never go to its ignore rules

    await watcher.watch('/wt');
    for (const path of [wt.gitDir, wt.commonDir]) {
      const prune = prunes.get(path)!;
      for (const dir of ['objects', 'lfs']) expect(await prune(dir), `${path} ${dir}`).toBe(true);
      for (const dir of ['refs', 'refs/heads', 'refs/remotes/origin', 'worktrees', 'worktrees/wt', 'logs', 'reftable', 'modules']) expect(await prune(dir), `${path} ${dir}`).toBe(false);
    }
    expect(ignored.mock.calls).toEqual([[ROOT]]);
    watcher.dispose();
  });

  it.each(['ENOSPC', 'EMFILE'])('polls git status every POLL_MS once its tree reports %s, emits only when the projection moved, and stops at unwatch', async (code) => {
    const fs = new FakeWatchFs(ROOT);
    fs.mkdir('.git/refs');
    fs.mkdir('src');
    fs.failWatch = (path) => (path === `${ROOT}/src` ? errno(code, path) : null);
    let current = status();
    const read = vi.fn(async () => current);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const emitted: GitChanged[] = [];
    const watcher = new GitWatcher({ status: read, emit: (e) => emitted.push(e), watch: treeOver(fs), statFile: async () => null });
    await watcher.watch(ROOT);
    await drain();
    expect(warn.mock.calls).toEqual([[`[git] watch exhausted under ${ROOT} (${code}): polling`]]);
    expect(fs.watched()).toEqual([]); // the partial tree is closed
    await vi.advanceTimersByTimeAsync(POLL_MS); // the settle pass after the watch opened, then the first poll
    const reads = read.mock.calls.length;
    const quiet = emitted.length;
    await vi.advanceTimersByTimeAsync(POLL_MS - 1);
    expect(read.mock.calls.length).toBe(reads);
    await vi.advanceTimersByTimeAsync(1);
    expect(read.mock.calls.length).toBe(reads + 1);
    expect(emitted).toHaveLength(quiet); // nothing moved

    current = dirty;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(read.mock.calls.length).toBe(reads + 2);
    expect(emitted.slice(quiet)).toEqual([{ repoRoot: ROOT, status: dirty, reason: 'worktree' }]);

    watcher.unwatch(ROOT);
    await vi.advanceTimersByTimeAsync(POLL_MS * 4);
    expect(read.mock.calls.length).toBe(reads + 2);
    expect(warn).toHaveBeenCalledTimes(1);
    // A new watch starts from events again.
    fs.failWatch = () => null;
    await watcher.watch(ROOT);
    await drain();
    expect(fs.watched().sort()).toEqual(['', '.git', '.git/refs', 'src']);
    watcher.dispose();
  });

  it("polls when the root's own watch reports exhaustion, which reaches it on a later tick", async () => {
    const fs = new FakeWatchFs(ROOT);
    fs.failWatch = (path) => errno('ENOSPC', path);
    const read = vi.fn(async () => status());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const watcher = new GitWatcher({ status: read, emit: () => {}, watch: treeOver(fs), statFile: async () => null });
    await expect(watcher.watch(ROOT)).resolves.toEqual(status());
    await drain();
    expect(warn.mock.calls).toEqual([[`[git] watch exhausted under ${ROOT} (ENOSPC): polling`]]);
    await vi.advanceTimersByTimeAsync(300);
    const reads = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(read.mock.calls.length).toBe(reads + 1);
    watcher.dispose();
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(read.mock.calls.length).toBe(reads + 1);
  });

  it('polls at twice POLL_MS after a status timeout, until a status succeeds', async () => {
    const fs = new FakeWatchFs(ROOT);
    fs.failWatch = (path) => errno('ENOSPC', path);
    let failing = false;
    const read = vi.fn(async () => {
      if (failing) throw new GitTimeoutError('git status timed out after 10 s in /repo');
      return status();
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const watcher = new GitWatcher({ status: read, emit: () => {}, watch: treeOver(fs), statFile: async () => null });
    await watcher.watch(ROOT);
    await drain();
    await vi.advanceTimersByTimeAsync(POLL_MS); // the settle pass and the first poll
    failing = true;
    const reads = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_MS); // times out
    expect(read.mock.calls.length).toBe(reads + 1);
    await vi.advanceTimersByTimeAsync(POLL_MS * 2 - 1);
    expect(read.mock.calls.length).toBe(reads + 1); // backed off: one poll per 10 s, and no retry of its own
    await vi.advanceTimersByTimeAsync(1);
    expect(read.mock.calls.length).toBe(reads + 2);
    failing = false;
    await vi.advanceTimersByTimeAsync(POLL_MS * 2); // succeeds
    expect(read.mock.calls.length).toBe(reads + 3);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(read.mock.calls.length).toBe(reads + 4);
    watcher.dispose();
  });

  // Review of M1 (finding 2): a poll that finds a status already running waits for it, and the next poll is timed from
  // that pass's end; the debounce's own continuation never adds a second schedule while the root polls.
  it('times each poll from the end of the pass before it, a status in flight included, at twice POLL_MS after a timeout', async () => {
    const fs = new FakeWatchFs(ROOT);
    fs.failWatch = (path) => errno('ENOSPC', path);
    const start = Date.now();
    const starts: number[] = [];
    let first = true;
    const read = vi.fn(() => {
      starts.push(Date.now() - start);
      if (first) {
        first = false;
        return Promise.resolve(status());
      }
      // Every later status times out at the runner's 10 s.
      return new Promise<GitStatus>((_resolve, reject) => setTimeout(() => reject(new GitTimeoutError('git status timed out after 10 s in /repo')), 10_000));
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const watcher = new GitWatcher({ status: read, emit: () => {}, watch: treeOver(fs), statFile: async () => null });
    await watcher.watch(ROOT);
    await drain();
    await vi.advanceTimersByTimeAsync(45_000);
    // The settle pass at 250 ms runs until 10,250; the poll due at 5,000 waits for it, then 10 s after it ends.
    expect(starts).toEqual([0, 250, 20_250, 40_250]);
    watcher.dispose();
  });

  it("finds a tracked file's modification whose event was lost at the tree's next slow reconcile", async () => {
    const fs = new FakeWatchFs(ROOT);
    fs.write('a.ts');
    let current = status();
    const emitted: GitChanged[] = [];
    const watcher = new GitWatcher({ status: async () => current, emit: (e) => emitted.push(e), watch: treeOver(fs), statFile: async () => null });
    await watcher.watch(ROOT);
    await drain();
    await vi.advanceTimersByTimeAsync(1000);
    const quiet = emitted.length;
    current = dirty; // its callback withheld
    await vi.advanceTimersByTimeAsync(RECONCILE_MS - 1001);
    await drain();
    expect(emitted).toHaveLength(quiet);
    await vi.advanceTimersByTimeAsync(1);
    await drain();
    await vi.advanceTimersByTimeAsync(300);
    expect(emitted.slice(quiet)).toEqual([{ repoRoot: ROOT, status: dirty, reason: 'worktree' }]);
    watcher.dispose();
  });

  it('re-reads the facts of a known file beneath an untracked directory on an event with no filename', async () => {
    const fake = fakeWatch();
    const files = new Map<string, { size: number; mtimeMs: number }>([[`${ROOT}/new/a.txt`, { size: 3, mtimeMs: 1 }]]);
    const current = status({ dirty: true, files: [{ path: 'new/', oldPath: null, index: '?', worktree: '?', untracked: true }] });
    const emitted: GitChanged[] = [];
    const watcher = new GitWatcher({ status: async () => current, emit: (e) => emitted.push(e), watch: fake.watch, statFile: async (path) => files.get(path) ?? null, isRepository: async () => false });
    await watcher.watch(ROOT);
    fake.fire(ROOT, 'new/a.txt'); // known from here on
    await vi.advanceTimersByTimeAsync(1000);
    const quiet = emitted.length;
    files.set(`${ROOT}/new/a.txt`, { size: 3, mtimeMs: 2 }); // its event lost
    fake.opened[0].listener('rename', null);
    await vi.advanceTimersByTimeAsync(300);
    expect(emitted).toHaveLength(quiet + 1);
    fake.opened[0].listener('rename', null); // nothing moved since: silent
    await vi.advanceTimersByTimeAsync(300);
    expect(emitted).toHaveLength(quiet + 1);
    watcher.dispose();
  });

  it('names a file written in a directory made after the watch within the debounce', async () => {
    const fs = new FakeWatchFs(ROOT);
    let current = status();
    const read = vi.fn(async () => current);
    const emitted: GitChanged[] = [];
    const watcher = new GitWatcher({ status: read, emit: (e) => emitted.push(e), watch: treeOver(fs), statFile: async () => null, isRepository: async () => false });
    await watcher.watch(ROOT);
    await drain();
    await vi.advanceTimersByTimeAsync(1000);
    const quiet = emitted.length;
    fs.write('fresh/inner/a.ts');
    current = status({ dirty: true, files: [{ path: 'fresh/', oldPath: null, index: '?', worktree: '?', untracked: true }] });
    fs.fire('', 'rename', 'fresh');
    await drain();
    expect(fs.watched().sort()).toEqual(['', 'fresh', 'fresh/inner']);
    await vi.advanceTimersByTimeAsync(250);
    expect(emitted.slice(quiet)).toEqual([{ repoRoot: ROOT, status: current, reason: 'worktree' }]);
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
  // Until a count of status runs holds still for 800 ms: past the settle pass and, where the watch is the tree (Linux),
  // the status its initial walk's end asks for, which a check-ignore batch inside the walk can put after `settle`.
  const runsSettle = async (statusRuns: () => number) => {
    for (let last = -1; statusRuns() !== last; ) {
      last = statusRuns();
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  };
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
      await runsSettle(statusRuns);
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

  it('runs no status of the parent for writes inside a clone nested under an untracked directory, once a pass has found it', async () => {
    const execFile = vi.fn(nodeExecFile as unknown as ExecFileFn);
    const local = new GitService({ emit: (e) => events.push(e), execFile, env: repo.serviceEnv() });
    await repo.git('init', '-q', 'vendor/clone');
    const clone = repo.path('vendor/clone');
    await repo.write('vendor/clone/a.txt', '0\n');
    await repo.write('notes/draft.md', '0\n');
    await repo.write('notes/.git', 'not a gitfile\n'); // no repository: git enters `notes/` as any other directory
    const statusRuns =() => execFile.mock.calls.filter(([, args]) => args[2] === 'status' && args[1] === repo.root).length;
    // Until no status has started for a while: the pass that finds the clone lands after its status returns, and a write
    // meanwhile still costs one (more under load), so what runs before that is not counted.
    const statusesSettle = async () => {
      for (let last = -1; statusRuns() !== last; ) {
        last = statusRuns();
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    };
    try {
      const watched = await local.watch(repo.root);
      expect(watched.files.map((file) => file.path)).toEqual(['notes/', 'vendor/']);
      await settle();
      const emitted = events.length;
      await repo.write('vendor/clone/a.txt', '1\n'); // the write that finds it
      await statusesSettle();
      const runs = statusRuns();
      for (let i = 2; i <= 4; i++) {
        await repo.write('vendor/clone/a.txt', `${i}\n`); // each in a debounce window of its own
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      await repo.git('-C', clone, 'add', '-A');
      await repo.git('-C', clone, 'commit', '-q', '-m', 'work in the nested clone');
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(events.length).toBe(emitted); // nothing in the clone ever emitted
      expect(statusRuns()).toBe(runs); // and once found, nothing in it runs a status
      await repo.write('notes/draft.md', '1\n'); // a plain untracked directory's file still emits, a junk `.git` beside it
      await nextChange(emitted, 2000);
    } finally {
      local.dispose();
    }
  }, 15_000);

  // A commit on a branch inside a submodule writes its index and reflog under `.git/modules/<name>/`, nothing in the
  // worktree and not the HEAD file; the parent's status now lists the gitlink modified.
  it('emits for a commit on a branch inside a submodule', async () => {
    const upstream = await GitFixture.create();
    try {
      await repo.git('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', upstream.root, 'libs/up');
      await repo.git('commit', '-q', '-m', 'submodule');
      const sub = repo.path('libs/up');
      await repo.git('-C', sub, 'checkout', '-q', '-b', 'feat');
      expect((await service.watch(repo.root)).files).toEqual([]);
      await settle();
      const baseline = events.length;
      await repo.git('-C', sub, 'commit', '-q', '--allow-empty', '-m', 'in the submodule');
      const { event } = await nextChange(baseline, 2000);
      expect(event).toMatchObject({ reason: 'worktree', status: { files: [{ path: 'libs/up', worktree: 'M', untracked: false }] } });
    } finally {
      upstream.dispose();
    }
  }, 10_000);

  // Every ref of a reftable repository, HEAD's too, lives in its tables; `git refs migrate` needs git 2.46.
  it('emits refs for a reftable repository when a remote-tracking ref moves its ahead/behind', async ({ skip }) => {
    try {
      await repo.git('refs', 'migrate', '--ref-format=reftable');
    } catch {
      return skip('this git cannot migrate a repository to reftable');
    }
    await repo.addBareRemote();
    await repo.write('README.md', 'hello\nahead\n');
    await repo.git('commit', '-q', '-am', 'ahead');
    expect(await service.watch(repo.root)).toMatchObject({ upstream: 'origin/main', ahead: 1 });
    await settle();
    const baseline = events.length;
    await repo.git('update-ref', 'refs/remotes/origin/main', 'main'); // as a push would: only the tables move
    const { event } = await nextChange(baseline, 2000);
    expect(event).toMatchObject({ reason: 'refs', status: { ahead: 0 } });
  }, 10_000);

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
