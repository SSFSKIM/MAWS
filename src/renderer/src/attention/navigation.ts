// Getting to what needs you (charter §5.7; C5 execution document, M5): ⌘⇧J opens the oldest Needs-you session that is
// not the one in front of you, in the focused pane (a session tab, never the Overview, because the item wants an
// answer and the docked card is where scopes live); a notification click arrives from main as `attention.navigate`
// and opens the same way, recording the item for C6's transcript to jump to; when main could not post an OS
// notification (`attention.notified { delivery: 'fallback' }`) the page shows a toast in its place.
import type { AppSessionId } from '@shared/graph/ids';
import type { EventPayload, MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { registerAction } from '../keymap/actions-runtime';
import { selectNeedsYou, useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { activeTab } from '../stores/layout-model';
import { useNotices } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { nextNeedsYou } from './derive';

const openInFocusedPane = (appSessionId: AppSessionId) => useLayout.getState().openTab({ kind: 'session', appSessionId }, { pane: 'focused' });

function openNextNeedsYou(): void {
  const rows = selectNeedsYou(useAttention.getState(), useSessions.getState());
  const tab = activeTab(useLayout.getState().main);
  const current = tab?.kind === 'session' ? tab.appSessionId : null;
  const next = nextNeedsYou(rows, current);
  if (next) openInFocusedPane(next.appSessionId);
}

function navigate({ appSessionId, attentionId }: EventPayload<'attention.navigate'>): void {
  openInFocusedPane(appSessionId as AppSessionId);
  useLayout.getState().requestFocus(attentionId === null ? null : { appSessionId: appSessionId as AppSessionId, attentionId });
}

function fallbackToast({ appSessionId, attentionId, delivery }: EventPayload<'attention.notified'>): void {
  if (delivery !== 'fallback') return;
  const id = appSessionId as AppSessionId;
  const attention = useAttention.getState();
  // The item may still sit in the buffer of an outstanding attention snapshot.
  const items = [...(attention.bySession.get(id) ?? []), ...(attention.pendingReplacements?.get(id) ?? [])];
  const summary = items.find((i) => i.id === attentionId)?.summary;
  const title = useSessions.getState().records.get(id)?.title.text ?? 'A session';
  useNotices.getState().toast({
    id: `attention:${attentionId}`,
    level: 'warning',
    text: summary ? `${title} needs you · ${summary}` : `${title} needs you`,
    actions: [{ label: 'Open session', run: () => openInFocusedPane(id) }],
    dismissible: true,
  });
}

export function connectAttention(client: MawsBridge = ipc): () => void {
  const offs = [
    registerAction('attention.next', openNextNeedsYou),
    client.on('attention.navigate', navigate),
    client.on('attention.notified', fallbackToast),
  ];
  return () => offs.forEach((off) => off());
}
