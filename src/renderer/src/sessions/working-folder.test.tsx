import { act, cleanup, renderHook } from '@testing-library/react';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { afterEach, describe, expect, it } from 'vitest';
import { record } from '../../../../test/support/builders';
import { useSessions } from '../stores/sessions';
import { useWorkingFolder } from './working-folder';

const id = 'app-w' as AppSessionId;
const hold = (...records: SessionRecord[]) => useSessions.setState({ records: new Map(records.map((r) => [r.appId, r])) });

afterEach(() => {
  cleanup();
  hold();
});

// UX wave U8a (UC-4, first landing; decision 3 of its execution document)
describe('useWorkingFolder', () => {
  it('answers null while the window holds no record of the session', () => {
    hold(record('app-other', { directory: '/repo' }));
    expect(renderHook(() => useWorkingFolder(id)).result.current).toBeNull();
  });

  it("answers the record's working folder", () => {
    hold(record(id, { directory: '/repo', worktree: { path: '/repo/.claude/worktrees/w1', branch: 'worktree-w1' } }));
    const { result } = renderHook(() => useWorkingFolder(id));
    expect(result.current).toEqual({ path: '/repo/.claude/worktrees/w1', cwd: '/repo/.claude/worktrees/w1', launch: '/repo/.claude/worktrees/w1', moved: false });
  });

  it('keeps the same object while the folder is the same, and gives a new one when it changes', () => {
    const before = record(id, { directory: '/repo', worktree: null });
    hold(before);
    const { result } = renderHook(() => useWorkingFolder(id));
    const first = result.current;
    act(() => hold({ ...before, unread: true }));
    expect(result.current).toBe(first);
    act(() => hold({ ...before, worktree: { path: '/repo/.claude/worktrees/w1', branch: null } }));
    expect(result.current).not.toBe(first);
    expect(result.current?.path).toBe('/repo/.claude/worktrees/w1');
  });
});
