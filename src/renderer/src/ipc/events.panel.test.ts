import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { GitStatus } from '@shared/ipc/schema/git';
import { PR_STATE_POLL, prStateKey } from '../tools/scm/queries';
import { fakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
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

  // P5 O3-E final review: main's host.status, which it emits after re-reading the daemon at each ready of the machine
  // host, has the git store re-ask the watches that machine could not answer.
  it('has the git store re-ask its unanswered watches on host.status from that machine, until disconnected', () => {
    const fake = fakeClient();
    const retryUnanswered = vi.fn();
    const original = useGit.getState().retryUnanswered;
    useGit.setState({ retryUnanswered });
    const disconnect = connectPanelEvents(fake.client);
    fake.event('host.status', {}, OTHER_MACHINE);
    expect(retryUnanswered).toHaveBeenCalledWith(OTHER_MACHINE);
    disconnect();
    fake.event('host.status', {});
    expect(retryUnanswered).toHaveBeenCalledTimes(1);
    useGit.setState({ retryUnanswered: original });
  });

  // P5 E312: a session's status, with the change it last published (the status's `published`, from the engine's
  // code_change_published) when given one; and a PR state main might answer, with the branch's PR in `state` when given.
  const sessionStatus = (appSessionId: string, at?: string, action = 'created') => ({ appSessionId, status: at === undefined ? {} : { published: { url: 'https://github.com/o/r/pull/7', action, at } } });
  const prState = (checkedAt: string, state?: 'OPEN' | 'MERGED') => ({
    checkedAt,
    branch: 'feat',
    gh: { state: 'ready', path: '/gh', version: '2' },
    pr: state === undefined ? null : { number: 7, url: 'https://github.com/o/r/pull/7', title: 'Feat', state, isDraft: false, reviewDecision: null, baseRefName: 'main', headRefName: 'feat', mergeStateStatus: state === 'OPEN' ? 'BLOCKED' : null, checks: { summary: state === 'OPEN' ? 'pending' : 'pass', items: [] } },
    error: null,
  });
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

  // A published change moves no ref the watcher sees: when its time moves, a PR state a surface holds is asked of gh
  // again at once, past main's kept answer, as the row's Refresh asks. The same publish seen again, a session whose PR
  // state nothing holds, a status without one and a publish older than the poll ask nothing.
  it('re-asks gh for a held PR state when the session publishes a change', async () => {
    const fake = fakeClient();
    const disconnect = connectPanelEvents(fake.client);
    const A = 'A' as AppSessionId;
    const answer = prState('later');
    queryClient.setQueryData(prStateKey(A), prState('earlier'));
    const now = new Date().toISOString();
    const stale = new Date(Date.now() - PR_STATE_POLL.refetchInterval - 1000).toISOString();

    fake.event('session.status', sessionStatus('B', now));
    fake.event('session.status', sessionStatus(A));
    fake.event('session.status', sessionStatus(A, stale));
    expect(fake.invoked('scm.pr.state')).toEqual([]);

    fake.event('session.status', sessionStatus(A, now));
    fake.event('session.status', sessionStatus(A, now));
    expect(fake.invoked('scm.pr.state')).toEqual([{ appSessionId: A, refresh: true }]);
    await fake.reply('scm.pr.state', answer);
    expect(queryClient.getQueryData(prStateKey(A))).toEqual(answer);

    disconnect();
    fake.event('session.status', sessionStatus(A, new Date(Date.now() + 1000).toISOString()));
    expect(fake.invoked('scm.pr.state')).toHaveLength(1);
    queryClient.clear();
  });

  // Two publishes close together (a PR created, then merged) ask twice. The first lookup's answer, landing after the
  // second's (gh slower while it read the checks), is superseded and leaves the newer answer standing.
  it('keeps the later publish’s answer when the earlier lookup lands last', async () => {
    const fake = fakeClient();
    const disconnect = connectPanelEvents(fake.client);
    const C = 'C' as AppSessionId;
    queryClient.setQueryData(prStateKey(C), prState('before'));

    fake.event('session.status', sessionStatus(C, ago(2000), 'created'));
    fake.event('session.status', sessionStatus(C, ago(1000), 'merged'));
    expect(fake.invoked('scm.pr.state')).toEqual([{ appSessionId: C, refresh: true }, { appSessionId: C, refresh: true }]);
    await fake.reply('scm.pr.state', prState('second', 'MERGED'), 1);
    expect(queryClient.getQueryData(prStateKey(C))).toEqual(prState('second', 'MERGED'));
    await fake.reply('scm.pr.state', prState('first', 'OPEN'));
    expect(queryClient.getQueryData(prStateKey(C))).toEqual(prState('second', 'MERGED'));

    disconnect();
    queryClient.clear();
  });

  // An ordinary read of the PR state (the poll's, or one a ref move asked for) still out when the publish's answer lands
  // may hold the state from before the publish: landing after it, it would put that state back for up to two minutes.
  // Such a read is cancelled, whether it began before the publish was heard or while its lookup ran.
  it('keeps the publish’s answer over an ordinary read that lands after it', async () => {
    const fake = fakeClient();
    const disconnect = connectPanelEvents(fake.client);
    const E = 'E' as AppSessionId;
    const ordinaryRead = () =>
      void queryClient.prefetchQuery({
        queryKey: prStateKey(E),
        queryFn: async () => {
          const result = await fake.client.invoke('scm.pr.state', { appSessionId: E, refresh: false });
          if (!result.ok) throw new Error(result.error.message);
          return result.value;
        },
      });
    queryClient.setQueryData(prStateKey(E), prState('before'));

    ordinaryRead();
    fake.event('session.status', sessionStatus(E, ago(2000), 'created'));
    expect(fake.invoked('scm.pr.state')).toEqual([{ appSessionId: E, refresh: false }, { appSessionId: E, refresh: true }]);
    await fake.reply('scm.pr.state', prState('created', 'OPEN'), 1);
    await fake.reply('scm.pr.state', prState('before'));
    expect(queryClient.getQueryData(prStateKey(E))).toEqual(prState('created', 'OPEN'));

    fake.event('session.status', sessionStatus(E, ago(1000), 'merged'));
    ordinaryRead();
    expect(fake.invoked('scm.pr.state').slice(2)).toEqual([{ appSessionId: E, refresh: true }, { appSessionId: E, refresh: false }]);
    await fake.reply('scm.pr.state', prState('merged', 'MERGED'));
    await fake.reply('scm.pr.state', prState('created', 'OPEN'));
    expect(queryClient.getQueryData(prStateKey(E))).toEqual(prState('merged', 'MERGED'));

    disconnect();
    queryClient.clear();
  });

  // A publish heard while no surface holds the session's PR state asks nothing and stays unconsumed: a row opened within
  // the poll then reads main's kept answer from before it, so the next status carrying it asks gh past that answer.
  it('asks for a publish heard before the PR state was held once a later status carries it', async () => {
    const fake = fakeClient();
    const disconnect = connectPanelEvents(fake.client);
    const D = 'D' as AppSessionId;
    const at = ago(1000);

    fake.event('session.status', sessionStatus(D, at));
    expect(fake.invoked('scm.pr.state')).toEqual([]);
    queryClient.setQueryData(prStateKey(D), prState('kept'));
    fake.event('session.status', sessionStatus(D, at));
    expect(fake.invoked('scm.pr.state')).toEqual([{ appSessionId: D, refresh: true }]);
    await fake.reply('scm.pr.state', prState('fresh', 'OPEN'));
    expect(queryClient.getQueryData(prStateKey(D))).toEqual(prState('fresh', 'OPEN'));
    fake.event('session.status', sessionStatus(D, at));
    expect(fake.invoked('scm.pr.state')).toHaveLength(1);

    disconnect();
    queryClient.clear();
  });
});
