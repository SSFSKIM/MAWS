import { describe, expect, it } from 'vitest';
import type { GitDiff, GitStatus } from '@shared/ipc/schema/git';
import { fakeClient } from '../../../../test/support/fake-client';
import { changeLine } from '../panel/summary/derive';
import { createGitStore } from './git';

const DIR = '/work/repo/sub';
const status = (over: Partial<GitStatus> = {}): GitStatus => ({
  repoRoot: '/work/repo', gitDir: '/work/repo/.git', commonDir: '/work/repo/.git', isWorktree: false, branch: 'main', head: 'abcdef1', upstream: null,
  remoteUrl: null, ahead: 0, behind: 0, dirty: true, files: [{ path: 'a.ts', oldPath: null, index: '.', worktree: 'M', untracked: false }], stashCount: 0,
  checkedAt: '2026-09-29T10:00:00.000Z', ...over,
});
const diff = (insertions: number): GitDiff => ({ patch: '', files: [{ path: 'a.ts', oldPath: null, insertions, deletions: 0, binary: false }] });
const DELAY = 5;
const wait = (ms = DELAY * 4) => new Promise((resolve) => setTimeout(resolve, ms));

function setup() {
  const fake = fakeClient();
  const store = createGitStore(fake.client, { diffDelayMs: DELAY });
  return { fake, store, entry: () => store.getState().entries.get(DIR) };
}

describe('git store', () => {
  it('two watchers of one directory invoke git.watch once and git.unwatch once after both release', async () => {
    const { fake, store, entry } = setup();
    const first = store.getState().watch(DIR);
    const second = store.getState().watch(DIR);
    expect(fake.invoked('git.watch')).toEqual([{ directory: DIR }]);
    await fake.reply('git.watch', status());
    expect(fake.invoked('git.diff')).toEqual([{ directory: DIR, scope: 'all' }]);
    await fake.reply('git.diff', diff(3));
    expect(entry()).toMatchObject({ root: '/work/repo', status: status(), uncommitted: { files: diff(3).files }, error: null });
    first();
    await wait();
    expect(fake.invoked('git.unwatch')).toEqual([]);
    second();
    await wait();
    expect(fake.invoked('git.unwatch')).toEqual([{ directory: DIR }]);
  });

  it('a git.changed for the root takes the status and re-runs git.diff once, even when two events arrive during one diff', async () => {
    const { fake, store, entry } = setup();
    store.getState().watch(DIR);
    await fake.reply('git.watch', status());
    expect(fake.pending('git.diff')).toBe(1); // the watch's own diff, held
    const changed = status({ files: [...status().files, { path: 'b.ts', oldPath: null, index: '.', worktree: 'M', untracked: false }] });
    store.getState().applyChanged({ repoRoot: '/work/repo', status: changed, reason: 'worktree' });
    await wait();
    store.getState().applyChanged({ repoRoot: '/work/repo', status: changed, reason: 'worktree' });
    await wait();
    expect(entry()!.status).toBe(changed);
    expect(fake.invoked('git.diff')).toHaveLength(1); // one in flight per directory
    await fake.reply('git.diff', diff(1));
    expect(fake.invoked('git.diff')).toHaveLength(2); // the changes during it re-run it once
    await fake.reply('git.diff', diff(2));
    await wait();
    expect(fake.invoked('git.diff')).toHaveLength(2);
    expect(entry()!.uncommitted!.files).toEqual(diff(2).files);
  });

  it('ignores a git.changed for another root, and for a directory nobody watches any more', async () => {
    const { fake, store, entry } = setup();
    const release = store.getState().watch(DIR);
    await fake.reply('git.watch', status());
    await fake.reply('git.diff', diff(1));
    store.getState().applyChanged({ repoRoot: '/elsewhere', status: status({ repoRoot: '/elsewhere' }), reason: 'worktree' });
    await wait();
    expect(entry()!.status!.repoRoot).toBe('/work/repo');
    release();
    store.getState().applyChanged({ repoRoot: '/work/repo', status: status({ branch: 'other' }), reason: 'head' });
    await wait();
    expect(entry()).toBeUndefined();
    expect(fake.invoked('git.diff')).toHaveLength(1);
  });

  it('a clean status needs no diff and forgets the last one, so a tree that turns dirty again waits for a fresh sum', async () => {
    const { fake, store, entry } = setup();
    store.getState().watch(DIR);
    await fake.reply('git.watch', status());
    await fake.reply('git.diff', diff(1));
    store.getState().applyChanged({ repoRoot: '/work/repo', status: status({ dirty: false, files: [] }), reason: 'index' });
    await wait();
    expect(entry()!.uncommitted).toBeNull();
    expect(fake.invoked('git.diff')).toHaveLength(1);
    store.getState().applyChanged({ repoRoot: '/work/repo', status: status(), reason: 'worktree' });
    expect(entry()!.uncommitted).toBeNull();
    await wait();
    expect(fake.invoked('git.diff')).toHaveLength(2);
  });

  it('a git.watch failure sets error and leaves root null', async () => {
    const { fake, store, entry } = setup();
    store.getState().watch(DIR);
    await fake.fail('git.watch', 'not a git repository');
    expect(entry()).toEqual({ root: null, status: null, uncommitted: null, error: 'not a git repository' });
    expect(fake.invoked('git.diff')).toEqual([]);
  });

  it('a git.diff failure after a successful watch keeps the status and records why', async () => {
    const { fake, store, entry } = setup();
    store.getState().watch(DIR);
    await fake.reply('git.watch', status());
    await fake.fail('git.diff', 'git diff failed: bad object');
    expect(entry()).toMatchObject({ root: '/work/repo', status: status(), uncommitted: null, error: 'git diff failed: bad object' });
  });

  it('a second watcher after the first released re-runs git.watch and one git.diff, showing nothing of the first mount meanwhile', async () => {
    const { fake, store, entry } = setup();
    const release = store.getState().watch(DIR);
    await fake.reply('git.watch', status());
    await fake.reply('git.diff', diff(1));
    release();
    await wait();
    expect(entry()).toBeUndefined(); // forgotten: a stale root would take a git.changed before the new watch answers
    store.getState().applyChanged({ repoRoot: '/work/repo', status: status(), reason: 'worktree' });
    store.getState().watch(DIR);
    expect(fake.invoked('git.watch')).toHaveLength(2);
    expect(entry()).toBeUndefined();
    const fresh = status({ files: [...status().files, { path: 'b.ts', oldPath: null, index: '.', worktree: 'M', untracked: false }] });
    await fake.reply('git.watch', fresh);
    expect(fake.invoked('git.diff')).toHaveLength(2);
    // Before the new diff answers the change line is unknown, never the first mount's sum beside a fresh file count.
    expect(changeLine(entry()!.status, entry()!.uncommitted?.files ?? null)).toEqual({ kind: 'unknown' });
    await fake.reply('git.diff', diff(4));
    expect(changeLine(entry()!.status, entry()!.uncommitted?.files ?? null)).toMatchObject({ kind: 'change', insertions: 4, files: 2 });
  });

  it('a bridge that throws is recorded as the entry’s error, and a later diff still runs', async () => {
    const fake = fakeClient();
    const invoke = fake.client.invoke;
    let throwing: string | null = 'git.watch';
    fake.client.invoke = ((name: string, input: never) => (name === throwing ? Promise.reject(new Error(`bridge gone: ${name}`)) : invoke(name as never, input))) as never;
    const store = createGitStore(fake.client, { diffDelayMs: DELAY });
    const entry = () => store.getState().entries.get(DIR);
    const release = store.getState().watch(DIR);
    await wait();
    expect(entry()).toEqual({ root: null, status: null, uncommitted: null, error: 'bridge gone: git.watch' });
    release();
    await wait();

    throwing = 'git.diff';
    store.getState().watch(DIR);
    await fake.reply('git.watch', status());
    await wait();
    expect(entry()).toMatchObject({ status: status(), uncommitted: null, error: 'bridge gone: git.diff' });
    throwing = null;
    store.getState().applyChanged({ repoRoot: '/work/repo', status: status(), reason: 'worktree' });
    await wait();
    expect(fake.pending('git.diff')).toBe(1); // not stuck in flight
    await fake.reply('git.diff', diff(2));
    expect(entry()).toMatchObject({ uncommitted: { files: diff(2).files }, error: null });
  });

  it('a release before git.watch answers unwatches only once the watch has landed', async () => {
    const { fake, store } = setup();
    const release = store.getState().watch(DIR);
    release();
    await wait();
    expect(fake.invoked('git.unwatch')).toEqual([]);
    await fake.reply('git.watch', status());
    await wait();
    expect(fake.invoked('git.unwatch')).toEqual([{ directory: DIR }]);
    expect(fake.invoked('git.diff')).toEqual([]); // nobody watches: no diff
  });

  it('a released watcher’s disposer is idempotent', async () => {
    const { fake, store } = setup();
    const a = store.getState().watch(DIR);
    const b = store.getState().watch(DIR);
    await fake.reply('git.watch', status());
    a();
    a();
    await wait();
    expect(fake.invoked('git.unwatch')).toEqual([]);
    b();
    await wait();
    expect(fake.invoked('git.unwatch')).toHaveLength(1);
  });
});
