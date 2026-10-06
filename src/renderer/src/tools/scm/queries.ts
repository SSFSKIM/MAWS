// The two reads the Source control tool and the summary's push-state row share (E6 execution document, Design §6), with
// one owner for their keys and the PR state's rules, so the two surfaces cost one poll and nothing writes a key by
// hand. Light on purpose: the summary imports it, so it imports nothing of the tool's components or stores.
//
// `scm.status`: the checkout's trust, remotes and gh state. `scm.pr.state`: the branch's PR and its checks, polled every
// 2 minutes only while a surface shows it and the window is shown, asked only for a branch of a trusted checkout with a
// remote, and asked again when the repository's head or refs move (a push from anywhere, a new upstream).
import { useEffect } from 'react';
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

export function useScmStatus(appSessionId: AppSessionId) {
  return useCommand('scm.status', { appSessionId });
}

// Something to ask gh about: a branch of a trusted checkout with a remote.
export function prStateEnabled(branch: string | null, scm: ScmStatus | undefined): boolean {
  return branch !== null && scm !== undefined && scm.trusted && scm.remotes.length > 0;
}

// The PR state of the session's checkout, whose repository root is `root` (the `git.changed` events name it).
export function usePrState(appSessionId: AppSessionId, { root, enabled }: { root: string; enabled: boolean }) {
  useEffect(
    () =>
      ipc.on('git.changed', (event) => {
        if (event.repoRoot === root && (event.reason === 'head' || event.reason === 'refs')) void queryClient.invalidateQueries({ queryKey: prStateKey(appSessionId) });
      }),
    [root, appSessionId],
  );
  return useCommand('scm.pr.state', { appSessionId, refresh: false }, { ...PR_STATE_POLL, enabled });
}
