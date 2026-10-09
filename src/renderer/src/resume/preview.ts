// The resume chooser's lazy preview (the P2 spec, child P2-D, G4): the recent turns of the settled selection only, read
// through main's `session.recentTurns` after a short debounce (the first selection at once), a stale answer dropped, a
// fresh one cached for half a minute so moving back and forth reads nothing twice. Reading launches no engine and
// changes no read state: the read is main's bounded transcript tail, and nothing here calls `session.setVisible`.
import { useEffect, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { RecentTurns } from '@shared/ipc/schema/session';
import { ipc } from '../ipc/client';

export const PREVIEW_TURNS = 6;
export const SETTLE_MS = 150; // Claude Desktop settles a moved selection 120 ms and a search's first row 300 ms
export const CACHE_MS = 30_000; // Desktop's staleTime

export type PreviewState = { status: 'idle' } | { status: 'loading' } | { status: 'ready'; value: RecentTurns } | { status: 'error' };

const cache = new Map<AppSessionId, { at: number; value: RecentTurns }>();
const fresh = (appSessionId: AppSessionId): RecentTurns | null => {
  const hit = cache.get(appSessionId);
  return hit && Date.now() - hit.at < CACHE_MS ? hit.value : null;
};

// Tests start each case cold.
export const clearPreviewCache = (): void => cache.clear();

// The preview of `appSessionId` (null: nothing selected). `immediate` skips the debounce (the selection a chooser opens on).
export function useRecentTurns(appSessionId: AppSessionId | null, immediate: boolean, client: MawsBridge = ipc): PreviewState {
  const [answer, setAnswer] = useState<{ id: AppSessionId; state: PreviewState } | null>(null);
  useEffect(() => {
    if (appSessionId === null || fresh(appSessionId) !== null) return;
    let live = true;
    const timer = setTimeout(
      () => {
        setAnswer({ id: appSessionId, state: { status: 'loading' } });
        client.invoke('session.recentTurns', { appSessionId, limit: PREVIEW_TURNS }).then(
          (result) => {
            if (result.ok) cache.set(appSessionId, { at: Date.now(), value: result.value });
            if (live) setAnswer({ id: appSessionId, state: result.ok ? { status: 'ready', value: result.value } : { status: 'error' } });
          },
          () => live && setAnswer({ id: appSessionId, state: { status: 'error' } }),
        );
      },
      immediate ? 0 : SETTLE_MS,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [appSessionId, immediate, client]);
  if (appSessionId === null) return { status: 'idle' };
  const cached = fresh(appSessionId);
  if (cached !== null) return { status: 'ready', value: cached };
  // until the settled read starts, the pane says it is loading rather than showing the previous session's turns
  return answer?.id === appSessionId ? answer.state : { status: 'loading' };
}
