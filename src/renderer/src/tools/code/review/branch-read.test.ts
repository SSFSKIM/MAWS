// The branch read in the window (UX wave U5b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md,
// §E's transitions; M9's async case 1 and S21's window half): one ask in flight per checkout, one more for any number of
// moves meanwhile; asked when a holder comes into view, on `head` or `refs`, and two minutes after the last answer while
// held; nothing while no holder is in view, the last answer kept; a failure keeps the last answer and says its kind.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitBranchCommits } from '@shared/ipc/schema/git';
import { TEST_MACHINE } from '../../../../../../test/support/machine';
import { createClient } from '../../../ipc/client';
import { connectPanelEvents } from '../../../ipc/events';
import { deferred, installFakeMain, ok } from '../../../test-support/code';
import { BRANCH_READ_EVERY_MS, branchReadOf, createBranchReads, useBranchReads } from './branch-read';

const MERGE_BASE = '9d0c1b2a39485766a5b4c3d2e1f0a9b8c7d6e5f4';
const MOVED_BASE = '1111111111111111111111111111111111111111';
const answer = (over: Partial<GitBranchCommits> = {}): GitBranchCommits => ({ base: { ref: 'origin/main', mergeBase: MERGE_BASE }, upstream: 'origin/feature/x', commits: [], counts: { all: 4, notPushed: 2, pushed: 2 }, behind: 0, ...over });
const TARGET = { machine: TEST_MACHINE, repoRoot: '/repo', directory: '/repo' };
const STATUS = { repoRoot: '/repo', gitDir: '/repo/.git', commonDir: '/repo/.git', isWorktree: false, branch: 'feature/x', head: 'abc', upstream: 'origin/feature/x', remoteUrl: null, ahead: 0, behind: 0, dirty: false, files: [], stashCount: 0, checkedAt: '2026-11-15T10:00:00.000Z' };

describe('the branch read (UX wave U5b-2)', () => {
  afterEach(() => {
    vi.useRealTimers();
    useBranchReads.getState().reset();
  });

  it('holds the first ask open; two git.changed with reason head make exactly one more ask; a failure keeps the last answer', async () => {
    const held = [deferred<ReturnType<typeof ok>>(), deferred<ReturnType<typeof ok>>(), deferred<ReturnType<typeof ok>>()];
    let asked = 0;
    const main = installFakeMain((name) => {
      if (name !== 'git.branchCommits') return ok();
      const next = held[asked]!;
      asked += 1;
      return next.promise;
    });
    const offEvents = connectPanelEvents(createClient(() => main.bridge));
    const off = useBranchReads.getState().hold(TARGET);
    await vi.waitFor(() => expect(main.callsOf('git.branchCommits')).toEqual([{ directory: '/repo', limit: 50 }]));
    main.emit('git.changed', { repoRoot: '/repo', status: STATUS, reason: 'head' });
    main.emit('git.changed', { repoRoot: '/repo', status: STATUS, reason: 'head' });
    expect(main.callsOf('git.branchCommits')).toHaveLength(1); // one in flight
    held[0]!.resolve(ok(answer()));
    await vi.waitFor(() => expect(main.callsOf('git.branchCommits')).toHaveLength(2));
    expect(branchReadOf(useBranchReads.getState(), TEST_MACHINE, '/repo')).toEqual({ answer: answer(), failure: null });
    held[1]!.resolve({ ok: false, error: { code: 'host_unavailable', message: 'the link dropped' } } as never);
    await vi.waitFor(() => expect(branchReadOf(useBranchReads.getState(), TEST_MACHINE, '/repo')?.failure).not.toBeNull());
    expect(branchReadOf(useBranchReads.getState(), TEST_MACHINE, '/repo')).toEqual({ answer: answer(), failure: { status: 'error', message: 'the link dropped', code: 'host_unavailable' } });
    expect(main.callsOf('git.branchCommits')).toHaveLength(2); // exactly one more for the two moves
    main.emit('git.changed', { repoRoot: '/repo', status: STATUS, reason: 'worktree' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(main.callsOf('git.branchCommits')).toHaveLength(2); // a worktree change is not a move of HEAD or a ref
    main.emit('git.changed', { repoRoot: '/repo', status: STATUS, reason: 'refs' }); // the next event asks again
    await vi.waitFor(() => expect(main.callsOf('git.branchCommits')).toHaveLength(3));
    off();
    offEvents();
  });

  it('asks when a holder comes into view, and two minutes after the last answer while held; nothing while none is in view, the answer kept (S21)', async () => {
    vi.useFakeTimers();
    let base = MERGE_BASE;
    const main = installFakeMain((name) => (name === 'git.branchCommits' ? ok(answer({ base: { ref: 'origin/main', mergeBase: base }, behind: base === MERGE_BASE ? 0 : 3 })) : ok()));
    const store = createBranchReads(createClient(() => main.bridge));
    let off = store.getState().hold(TARGET);
    await vi.advanceTimersByTimeAsync(0);
    expect(main.callsOf('git.branchCommits')).toHaveLength(1);
    base = MOVED_BASE; // only refs/remotes/origin/main advanced: no git.changed
    await vi.advanceTimersByTimeAsync(BRANCH_READ_EVERY_MS - 1);
    expect(branchReadOf(store.getState(), TEST_MACHINE, '/repo')?.answer?.behind).toBe(0); // the old count until the next ask
    await vi.advanceTimersByTimeAsync(1);
    expect(main.callsOf('git.branchCommits')).toHaveLength(2);
    expect(branchReadOf(store.getState(), TEST_MACHINE, '/repo')?.answer).toMatchObject({ behind: 3, base: { mergeBase: MOVED_BASE } });
    off(); // out of view
    await vi.advanceTimersByTimeAsync(BRANCH_READ_EVERY_MS * 3);
    store.getState().changed(TEST_MACHINE, '/repo');
    expect(main.callsOf('git.branchCommits')).toHaveLength(2);
    expect(branchReadOf(store.getState(), TEST_MACHINE, '/repo')?.answer?.behind).toBe(3); // kept
    off = store.getState().hold(TARGET); // shown again: at once
    await vi.advanceTimersByTimeAsync(0);
    expect(main.callsOf('git.branchCommits')).toHaveLength(3);
    off();
  });
});
