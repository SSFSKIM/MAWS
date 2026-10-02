// Getting to what needs you (charter §5.7; C5 execution document, M5): ⌘⇧J opens the oldest Needs-you session that is
// not the one in front of you, in the focused pane (a session tab, never the Overview, because the item wants an
// answer and the docked card is where scopes live); a notification click arrives from main as `attention.navigate`
// and opens the same way (W9: the item it names is no longer kept for a transcript jump nothing built); when main could
// not post an OS notification (`attention.notified { delivery: 'fallback' }`) the page shows a toast in its place.
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
import { displayTitle } from '../sessions/title';

const openInFocusedPane = (appSessionId: AppSessionId) => useLayout.getState().openTab({ kind: 'session', appSessionId }, { pane: 'focused' });

function openNextNeedsYou(): void {
  const rows = selectNeedsYou(useAttention.getState(), useSessions.getState());
  const tab = activeTab(useLayout.getState().main);
  const current = tab?.kind === 'session' ? tab.appSessionId : null;
  const next = nextNeedsYou(rows, current);
  if (next) openInFocusedPane(next.appSessionId);
}

function navigate({ appSessionId }: EventPayload<'attention.navigate'>): void {
  openInFocusedPane(appSessionId as AppSessionId);
}

function fallbackToast({ appSessionId, attentionId, delivery }: EventPayload<'attention.notified'>): void {
  if (delivery !== 'fallback') return;
  const id = appSessionId as AppSessionId;
  const attention = useAttention.getState();
  // The item may still sit in the buffer of an outstanding attention snapshot.
  const items = [...(attention.bySession.get(id) ?? []), ...(attention.pendingReplacements?.get(id) ?? [])];
  const summary = items.find((i) => i.id === attentionId)?.summary;
  const record = useSessions.getState().records.get(id);
  const title = record ? displayTitle(record) : 'A session';
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
  // Subscribed first, then the snapshot (C1's rule): a click main could not deliver before this page listened (a
  // re-created or reloaded window) is pulled here, and the call tells main this page now hears the event. The answer is
  // applied even after a disconnect: main clears the queue on read, so under StrictMode's remount the first call's
  // answer is the only one carrying it, and opening a tab is a store action that needs no live connection.
  void client.invoke('attention.pendingNavigate', undefined).then((result) => {
    if (!result.ok) console.warn('[attention] attention.pendingNavigate unavailable', result.error);
    else if (result.value.navigate) navigate(result.value.navigate);
  });
  return () => offs.forEach((off) => off());
}
