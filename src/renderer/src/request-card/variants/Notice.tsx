// An attention item that is not a request (an error, an interrupted turn, auto mode unavailable, a held peer message):
// its summary and how long it has waited, and for `auto_mode_unavailable` the remedy X1 names. Nothing to answer:
// these retire on the next human turn or by C3's expiry. Never takes keys, never blocks the editor.
import type { AttentionItem } from '@shared/graph/attention';
import { PERMISSION_MODE_LABELS } from '@shared/sessions/permission-mode-labels';
import { useNow } from '../../app/use-now';
import { ipc } from '../../ipc/client';
import { needsYouAge } from '../../sidebar/derive';
import { CardButton, Muted } from '../controls';

export function NoticeBody({ item }: { item: AttentionItem }) {
  const now = useNow();
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-fg">{item.summary}</p>
      <Muted>waiting {needsYouAge(item, now)}</Muted>
      {item.kind === 'auto_mode_unavailable' && (
        <CardButton className="self-start" onClick={() => void ipc.invoke('session.setPermissionMode', { appSessionId: item.appSessionId, mode: 'default' })}>
          Switch to {PERMISSION_MODE_LABELS.default} mode
        </CardButton>
      )}
    </div>
  );
}
