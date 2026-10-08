// An attention item that is not a request (an error, an interrupted turn, auto mode unavailable, a held peer message):
// its summary and its age, and for `auto_mode_unavailable` the remedy X1 names. Nothing to answer: these retire on the
// next human turn or by C3's expiry. Never takes keys, never blocks the editor.
// E11 F2b (plan 2.4; owner decision 1): an outcome says when it happened ("2 weeks ago"), not how long it waited; an
// error offers Dismiss, and shown in its opened session (`seenHere`: the composer's notice) while the window is in front
// it counts as seen, which takes it out of Needs you while the session keeps saying it ended with an error.
import { useEffect } from 'react';
import type { AttentionItem } from '@shared/graph/attention';
import { PERMISSION_MODE_LABELS } from '@shared/sessions/permission-mode-labels';
import { useNow } from '../../app/use-now';
import { ipc } from '../../ipc/client';
import { itemAge } from '../../sidebar/derive';
import { CardButton, Muted } from '../controls';

const acknowledge = (item: AttentionItem, how: 'seen' | 'dismissed') => void ipc.invoke('attention.acknowledge', { appSessionId: item.appSessionId, attentionId: item.id, how });

// Seen: shown while the document is visible and the window has focus, at mount or when the window comes forward.
function useSeenWhileInFront(item: AttentionItem, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let done = false;
    const check = () => {
      if (done || document.visibilityState !== 'visible' || !document.hasFocus()) return;
      done = true;
      acknowledge(item, 'seen');
    };
    check();
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [item, enabled]);
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
