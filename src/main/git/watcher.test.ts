import { watch as fsWatch } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitChangedSchema, type GitChanged, type GitStatus } from '@shared/ipc/schema/git';
import { GitFixture } from '../../../test/support/git-fixture';
import { GitTimeoutError } from './runner';
import { GitService } from './service';
import { classifyCommonPath, classifyGitPath, classifyRootPath, GitWatcher, type WatchFn } from './watcher';

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
