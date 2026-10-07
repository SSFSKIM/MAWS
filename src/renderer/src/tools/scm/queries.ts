// The two reads the Source control tool and the summary's push-state row share (E6 execution document, Design §6), with
// one owner for their keys and the PR state's rules, so the two surfaces cost one poll and nothing writes a key by
// hand. Light on purpose: the summary imports it, so it imports nothing of the tool's components or stores.
//
// `scm.status`: the checkout's trust, remotes and gh state. `scm.pr.state`: the branch's PR and its checks, polled every
// 2 minutes only while a surface shows it and the window is shown, asked only for a branch of a trusted checkout with a
// remote. Both are asked again when the repository's head or refs move (a push from anywhere, a new remote or upstream).
import { useEffect, useRef } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { ScmStatus } from '@shared/ipc/schema/scm';
import { ipc } from '../../ipc/client';
import { queryClient, useCommand } from '../../ipc/query';

// `useCommand`'s keys (`['maws', name, input]`), and each command's prefix for every session.
export const SCM_STATUS_QUERIES = ['maws', 'scm.status'] as const;
export const PR_STATE_QUERIES = ['maws', 'scm.pr.state'] as const;
export const scmStatusKey = (appSessionId: AppSessionId) => [...SCM_STATUS_QUERIES, { appSessionId }];
export const prStateKey = (appSessionId: AppSessionId) => [...PR_STATE_QUERIES, { appSessionId, refresh: false }];

export const PR_STATE_POLL = { staleTime: 60_000, refetchInterval: 120_000, refetchIntervalInBackground: false } as const; // main keeps an answer 60 s

// The checkout's `scm.status`, read again when its repository's head or refs move (`root`, null until the status names
// it): `git remote add`, a remote's URL or an upstream set by a push change the remotes and defaults it answers (the
// watcher reads `config` as refs).
export function useScmStatus(appSessionId: AppSessionId, root: string | null) {
  useReReadOnHeadOrRefs(root, appSessionId, scmStatusKey);
  return useCommand('scm.status', { appSessionId });
}

// The session's query under `keyOf` is read again when C4's watcher says the repository at `root` moved its head or
// refs.
function useReReadOnHeadOrRefs(root: string | null, appSessionId: AppSessionId, keyOf: (appSessionId: AppSessionId) => readonly unknown[]): void {
  useEffect(() => {
    if (root === null) return;
    return ipc.on('git.changed', (event) => {
      if (event.repoRoot === root && (event.reason === 'head' || event.reason === 'refs')) void queryClient.invalidateQueries({ queryKey: keyOf(appSessionId) });
    });
  }, [root, appSessionId, keyOf]);
}

// Something to ask gh about: a branch of a trusted checkout with a remote.
function prStateEnabled(branch: string | null, scm: ScmStatus | undefined): boolean {
  return branch !== null && scm !== undefined && scm.trusted && scm.remotes.length > 0;
}

// The PR state of the session's checkout on `branch`, whose repository root is `root` (the `git.changed` events name
// it). The query is the session's, so the tool and the row share one poll, while main answers for the branch the
// checkout was on when asked; a query that stops asking keeps its last answer. So an answer is shown only while there
// is something to ask and only when it names the current branch: after a switch nothing is said until the new branch's
// answer, and nothing on a detached head or once trust or the last remote is gone. An answer naming no branch (main
// found the checkout untrusted, not a repository or detached) carries no PR and stands: the row reads trust from it.
// E11: an answer naming another branch is asked again at once, once per pair of branches (a switch made while nothing
// showed the query leaves a fresh answer for the old branch, which the poll would otherwise keep for up to 2 minutes).
export function usePrState(appSessionId: AppSessionId, { root, branch, scm }: { root: string; branch: string | null; scm: ScmStatus | undefined }) {
  useReReadOnHeadOrRefs(root, appSessionId, prStateKey);
  const enabled = prStateEnabled(branch, scm);
  const query = useCommand('scm.pr.state', { appSessionId, refresh: false }, { ...PR_STATE_POLL, enabled });
  const answer = query.data;
  const reasked = useRef<string | null>(null);
  const named = answer?.branch ?? null;
  useEffect(() => {
    const mismatch = enabled && named !== null && named !== branch ? `${named}\0${branch}` : null;
    if (mismatch !== null && reasked.current !== mismatch) void queryClient.invalidateQueries({ queryKey: prStateKey(appSessionId) });
    reasked.current = mismatch;
  }, [enabled, named, branch, appSessionId]);
  return {
    data: enabled && answer !== undefined && (answer.branch === null || answer.branch === branch) ? answer : undefined,
    error: enabled ? query.error : null,
  };
}
