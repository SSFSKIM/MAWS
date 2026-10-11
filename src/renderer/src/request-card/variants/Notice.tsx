// An attention item that is not a request (an error, an interrupted turn, auto mode unavailable, a held peer message):
// its summary and its age, and for `auto_mode_unavailable` the remedy X1 names. Nothing to answer: these retire on the
// next human turn or by C3's expiry. Never takes keys, never blocks the editor.
// E11 F2b (plan 2.4; owner decision 1): an outcome says when it happened ("2 weeks ago"), not how long it waited; an
// error offers Dismiss, and shown in its opened session (`seenHere`: the composer's notice) for two continuous seconds
// while the window is in front it counts as seen (L102's dwell), which takes it out of Needs you while the session keeps
// saying it ended with an error.
import { useEffect } from 'react';
import type { AttentionItem } from '@shared/graph/attention';
import { PERMISSION_MODE_LABELS } from '@shared/sessions/permission-mode-labels';
import { useNow } from '../../app/use-now';
import { ipc } from '../../ipc/client';
import { itemAge } from '../../sidebar/derive';
import { CardButton, Muted } from '../controls';

const acknowledge = ({ appSessionId, id }: Pick<AttentionItem, 'appSessionId' | 'id'>, how: 'seen' | 'dismissed') =>
  void ipc.invoke('attention.acknowledge', { appSessionId, attentionId: id, how });

// L102's dwell (the owner's ruling at P2-F's sitting, "2초 확인 후 해제"): seen after this long shown continuously in
// front; a glance that turns away keeps the card in Needs you.
export const SEEN_DWELL_MS = 2_000;

// Seen: shown for SEEN_DWELL_MS while the document is visible and the window has focus, counted from mount or from
// when the window comes forward; the document hiding or the window going behind restarts the count. Keyed by the item's
// identity, so the same item re-read from the store does not restart it.
function useSeenWhileInFront({ appSessionId, id }: AttentionItem, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const inFront = () => document.visibilityState === 'visible' && document.hasFocus();
    const check = () => {
      if (!inFront()) {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        return;
      }
      timer ??= setTimeout(() => {
        if (inFront()) acknowledge({ appSessionId, id }, 'seen');
        else timer = null;
      }, SEEN_DWELL_MS);
    };
    check();
    window.addEventListener('focus', check);
    window.addEventListener('blur', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener('focus', check);
      window.removeEventListener('blur', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [appSessionId, id, enabled]);
}

export function NoticeBody({ item, seenHere = false }: { item: AttentionItem; seenHere?: boolean }) {
  const now = useNow();
  const isError = item.kind === 'error';
  useSeenWhileInFront(item, seenHere && isError && (item.state === 'pending' || item.state === 'delivered'));
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-fg">{item.summary}</p>
      <Muted>{itemAge(item, now)}</Muted>
      {item.kind === 'auto_mode_unavailable' && (
        <CardButton className="self-start" onClick={() => void ipc.invoke('session.setPermissionMode', { appSessionId: item.appSessionId, mode: 'default' })}>
          Switch to {PERMISSION_MODE_LABELS.default} mode
        </CardButton>
      )}
      {isError && item.state !== 'retired' && (
        <CardButton className="self-start" onClick={() => acknowledge(item, 'dismissed')}>
          Dismiss
        </CardButton>
      )}
    </div>
  );
}
