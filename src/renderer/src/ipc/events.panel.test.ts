import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitStatus } from '@shared/ipc/schema/git';
import { fakeClient } from '../../../../test/support/fake-client';
import { useGit } from '../stores/git';
import { connectPanelEvents } from './events';
import { queryClient } from './query';

const status = { repoRoot: '/r', gitDir: '/r/.git', commonDir: '/r/.git', isWorktree: false, branch: 'main', head: 'a', upstream: null, remoteUrl: null, ahead: 0, behind: 0, dirty: false, files: [], stashCount: 0, checkedAt: 'now' } satisfies GitStatus;

afterEach(() => vi.restoreAllMocks());

describe('panel events', () => {
  it('feeds git.changed to the git store and invalidates a session’s fs.workflows on fs.workflowChanged, until disconnected', () => {
    const fake = fakeClient();
    const applyChanged = vi.fn();
    const original = useGit.getState().applyChanged;
    useGit.setState({ applyChanged });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    const disconnect = connectPanelEvents(fake.client);

    const changed = { repoRoot: '/r', status, reason: 'worktree' as const };
    fake.event('git.changed', changed);
    expect(applyChanged).toHaveBeenCalledWith(changed);
    fake.event('fs.workflowChanged', { appSessionId: 'A', runId: 'run-1' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['maws', 'fs.workflows', { appSessionId: 'A' }] });

    disconnect();
    fake.event('git.changed', changed);
    fake.event('fs.workflowChanged', { appSessionId: 'A', runId: 'run-2' });
    expect(applyChanged).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
    useGit.setState({ applyChanged: original });
  });
});
