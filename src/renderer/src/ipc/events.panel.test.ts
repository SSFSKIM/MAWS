import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { GitStatus } from '@shared/ipc/schema/git';
import { PR_STATE_POLL, prStateKey } from '../tools/scm/queries';
import { fakeClient } from '../../../../test/support/fake-client';
import { TEST_MACHINE } from '../../../../test/support/machine';
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
    expect(applyChanged).toHaveBeenCalledWith(changed, TEST_MACHINE);
    fake.event('fs.workflowChanged', { appSessionId: 'A', runId: 'run-1' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['maws', 'fs.workflows', { appSessionId: 'A' }] });

    disconnect();
    fake.event('git.changed', changed);
    fake.event('fs.workflowChanged', { appSessionId: 'A', runId: 'run-2' });
    expect(applyChanged).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
    useGit.setState({ applyChanged: original });
  });

  // P5 E312: the session published a change for review (the status's `published`, from the engine's
  // code_change_published), which moves no ref the watcher sees: when its time moves, a PR state a surface holds is
  // asked of gh again at once, past main's kept answer, as the row's Refresh asks. The same publish seen again, a session
  // whose PR state nothing holds, a status without one and a publish older than the poll ask nothing.
  it('re-asks gh for a held PR state when the session publishes a change', async () => {
    const fake = fakeClient();
    const disconnect = connectPanelEvents(fake.client);
    const A = 'A' as AppSessionId;
    const answer = { checkedAt: 'later', branch: 'feat', gh: { state: 'ready', path: '/gh', version: '2', error: null }, pr: null, error: null };
    queryClient.setQueryData(prStateKey(A), { ...answer, checkedAt: 'earlier' });
    const status = (appSessionId: string, at?: string) => ({ appSessionId, status: at === undefined ? {} : { published: { url: 'https://github.com/o/r/pull/7', action: 'created', at } } });
    const now = new Date().toISOString();
    const stale = new Date(Date.now() - PR_STATE_POLL.refetchInterval - 1000).toISOString();

    fake.event('session.status', status('B', now));
    fake.event('session.status', status(A));
    fake.event('session.status', status(A, stale));
    expect(fake.invoked('scm.pr.state')).toEqual([]);

    fake.event('session.status', status(A, now));
    fake.event('session.status', status(A, now));
    expect(fake.invoked('scm.pr.state')).toEqual([{ appSessionId: A, refresh: true }]);
    await fake.reply('scm.pr.state', answer);
    expect(queryClient.getQueryData(prStateKey(A))).toEqual(answer);

    disconnect();
    fake.event('session.status', status(A, new Date(Date.now() + 1000).toISOString()));
    expect(fake.invoked('scm.pr.state')).toHaveLength(1);
    queryClient.clear();
  });
});
