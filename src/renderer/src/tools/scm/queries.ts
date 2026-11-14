// The two reads the Source control tool and the summary's push-state row share (E6 execution document, Design §6), with
// one owner for their keys and the PR state's rules, so the two surfaces cost one poll and nothing writes a key by
// hand. Light on purpose: the summary imports it, so it imports nothing of the tool's components or stores.
//
// `scm.status`: the checkout's trust, remotes and gh state. `scm.pr.state`: the branch's PR and its checks, polled every
// 2 minutes only while a surface shows it and the window is shown, asked only for a branch of a trusted checkout with a
// remote. Both are asked again when the repository's head or refs move (a push from anywhere, a new remote or upstream),
// and `scm.status` when a session's setup records trust: one app-level listener (`connectPanelEvents`, ipc/events.ts)
// does it through `invalidateScmQueries`, so neither surface subscribes to an event of its own (E11 W-D).
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandResult, MawsBridge } from '@shared/ipc/schema';
import type { ScmPrState, ScmStatus } from '@shared/ipc/schema/scm';
import { ipc } from '../../ipc/client';
import { IpcCommandError, queryClient, useCommand } from '../../ipc/query';

// `useCommand`'s keys (`['maws', name, input]`), and each command's prefix for every session. UX wave U8c-2 (the branch
// review, finding 7): the PR state's key names the checkout after its input, which is the session's alone: main answers
// for the checkout the session works in, so an answer is that checkout's, and a checkout on a branch of another's name
// never reads the other's.
export const SCM_STATUS_QUERIES = ['maws', 'scm.status'] as const;
export const PR_STATE_QUERIES = ['maws', 'scm.pr.state'] as const;
export const scmStatusKey = (appSessionId: AppSessionId) => [...SCM_STATUS_QUERIES, { appSessionId }];
export const prStateKey = (appSessionId: AppSessionId, checkout: string) => [...PR_STATE_QUERIES, { appSessionId, refresh: false }, { checkout }];

export const PR_STATE_POLL = { staleTime: 60_000, refetchInterval: 120_000, refetchIntervalInBackground: false } as const; // main keeps an answer 60 s

// The scm queries of the sessions `which` picks, every one of `prefixes` (both reads by default).
export function invalidateScmQueries(which: (appSessionId: AppSessionId) => boolean, prefixes: readonly (readonly unknown[])[] = [SCM_STATUS_QUERIES, PR_STATE_QUERIES]): void {
  for (const queryKey of prefixes) void queryClient.invalidateQueries({ queryKey, predicate: sessionsOf(which) });
}

// UX wave U8c-2 (fix wave 1): the sessions whose working folder changed. Both reads are keyed by the session alone, and
// their answers were the checkout the agent left: each is reset, so a read still out (which an invalidation would let
// land as the answer) is cancelled and its answer dropped, nothing of the old checkout is shown, and a read in use is
// asked again at once, of the folder main's record now names. A published PR's lookup still out for one of them was the
// old checkout's too: it is superseded, so its answer is not written.
export function resetScmQueries(which: (appSessionId: AppSessionId) => boolean): void {
  for (const [appSessionId, lookup] of lookups) if (which(appSessionId)) lookups.set(appSessionId, lookup + 1);
  for (const queryKey of [SCM_STATUS_QUERIES, PR_STATE_QUERIES]) void queryClient.resetQueries({ queryKey, predicate: sessionsOf(which) });
}

// The keys' third part names the session; a key without one names none and is passed over.
const sessionsOf = (which: (appSessionId: AppSessionId) => boolean) => (query: { queryKey: readonly unknown[] }) => {
  const appSessionId = (query.queryKey[2] as { appSessionId?: AppSessionId } | undefined)?.appSessionId;
  return appSessionId !== undefined && which(appSessionId);
};

// P5 E312: the session published a change for review (the status's `published`, from the engine's
// code_change_published: a PR created, merged, closed, …), which moves no ref the watcher sees. When its time moves, a
// PR state a surface holds is asked of gh again at once, past main's kept answer, as the row's Refresh asks; otherwise
// the poll shows it up to two minutes late. A publish older than the poll (a status first seen after a reload) is one
// the poll has read already. A publish heard while nothing holds the PR state is left for a later status carrying it:
// a row opened within the poll reads main's kept answer, which may predate it. An answer that lands after a later
// publish's lookup began is superseded and leaves the PR state to that lookup. An ordinary read of the PR state still
// out when the answer lands (the poll's, or one a ref move asked for), begun before the publish was heard or while its
// lookup ran, may hold the state from before it: it is cancelled, keeping the data it would have replaced, so the
// answer is the last written.
const publishedSeen = new Map<AppSessionId, string>();
const lookups = new Map<AppSessionId, number>();
// `checkout` is the session's working folder as the page holds it, whose PR state the lookup's answer is.
export function refreshPublishedPrState(appSessionId: AppSessionId, checkout: string, published: EngineSessionStatus['published'], client: MawsBridge): void {
  if (published === undefined || publishedSeen.get(appSessionId) === published.at) return;
  const key = prStateKey(appSessionId, checkout);
  if (Date.now() - Date.parse(published.at) >= PR_STATE_POLL.refetchInterval || queryClient.getQueryState(key) === undefined) return;
  publishedSeen.set(appSessionId, published.at);
  const lookup = (lookups.get(appSessionId) ?? 0) + 1;
  lookups.set(appSessionId, lookup);
  void client.invoke('scm.pr.state', { appSessionId, refresh: true }).then((result) => {
    if (lookups.get(appSessionId) === lookup) writeLookup(key, result);
  });
}

// A lookup past main's kept answer, written: an ordinary read still out is cancelled, keeping the data it would have
// replaced, so the lookup's answer is the last written; a failed lookup asks the query again.
function writeLookup(key: readonly unknown[], result: CommandResult<'scm.pr.state'>): Promise<void> {
  if (!result.ok) return queryClient.invalidateQueries({ queryKey: key });
  void queryClient.cancelQueries({ queryKey: key }); // reverts the read at once, before the answer is written
  queryClient.setQueryData(key, result.value);
  return Promise.resolve();
}

// The summary's Refresh (UX wave U8c-2, M6): gh asked again past main's kept answer, which is written only while no move
// reset the PR state and no later lookup began meanwhile, under the generation the published lookup and the reset share,
// and written as that lookup writes it (fix wave 1): an ordinary read begun before it is cancelled. A failed ask asks
// the query again, as before.
export async function refreshPrState(appSessionId: AppSessionId, checkout: string, client: MawsBridge): Promise<void> {
  const key = prStateKey(appSessionId, checkout);
  const lookup = (lookups.get(appSessionId) ?? 0) + 1;
  lookups.set(appSessionId, lookup);
  const result = await client.invoke('scm.pr.state', { appSessionId, refresh: true });
  if (lookups.get(appSessionId) === lookup) await writeLookup(key, result);
}

// The checkout's `scm.status`. Read again when its repository's head or refs move (`git remote add`, a remote's URL or an
// upstream set by a push change the remotes and defaults it answers; the watcher reads `config` as refs) and when a
// session's setup records trust.
export function useScmStatus(appSessionId: AppSessionId) {
  return useCommand('scm.status', { appSessionId });
}

// Something to ask gh about: a branch of a trusted checkout with a remote.
function prStateEnabled(branch: string | null, scm: ScmStatus | undefined): boolean {
  return branch !== null && scm !== undefined && scm.trusted && scm.remotes.length > 0;
}

// The PR state of the session's checkout on `branch`, read again when its repository's head or refs move. The query is
// the session's and its checkout's (`checkout`, the working folder the surface shows), so the tool and the row share one
// poll, while main answers for the branch the checkout was on when asked; a query that stops asking keeps its last answer. So an answer is shown only while there
// is something to ask and only when it names the current branch: after a switch nothing is said until the new branch's
// answer, and nothing on a detached head or once trust or the last remote is gone. An answer naming no branch (main
// found the checkout untrusted, not a repository or detached) carries no PR and stands: the row reads trust from it.
// E11: an answer naming another branch is asked again at once, once per pair of branches (a switch made while nothing
// showed the query leaves a fresh answer for the old branch, which the poll would otherwise keep for up to 2 minutes).
export function usePrState(appSessionId: AppSessionId, { checkout, branch, scm }: { checkout: string; branch: string | null; scm: ScmStatus | undefined }) {
  const enabled = prStateEnabled(branch, scm);
  const key = prStateKey(appSessionId, checkout);
  // `useCommand`'s query with the checkout in its key (its input stays the session's)
  const query = useQuery<ScmPrState, IpcCommandError>({
    queryKey: key,
    queryFn: async () => {
      const result = await ipc.invoke('scm.pr.state', { appSessionId, refresh: false });
      if (!result.ok) throw new IpcCommandError(result.error);
      return result.value;
    },
    ...PR_STATE_POLL,
    enabled,
  });
  const answer = query.data;
  const reasked = useRef<string | null>(null);
  const named = answer?.branch ?? null;
  useEffect(() => {
    const mismatch = enabled && named !== null && named !== branch ? `${named}\0${branch}` : null;
    if (mismatch !== null && reasked.current !== mismatch) void queryClient.invalidateQueries({ queryKey: prStateKey(appSessionId, checkout) });
    reasked.current = mismatch;
  }, [enabled, named, branch, appSessionId, checkout]);
  return {
    data: enabled && answer !== undefined && (answer.branch === null || answer.branch === branch) ? answer : undefined,
    error: enabled ? query.error : null,
  };
}
