// Getting to what needs you (charter §5.7; C5 execution document, M5): ⌘⇧J opens the oldest Needs-you session that is
// not the one in front of you, in the focused pane (a session tab, never the Overview, because the item wants an
// answer and the docked card is where scopes live); a notification click arrives from main as `attention.navigate`
// and opens the same way (W9: the item it names is no longer kept for a transcript jump nothing built); when main could
// not post an OS notification (`attention.notified { delivery: 'fallback' }`) the page shows a toast in its place.
import { isOpen } from '@shared/attention/kinds';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId, AttentionId } from '@shared/graph/ids';
import type { EventPayload, MawsBridge } from '@shared/ipc/schema';
import { tabId } from '@shared/ipc/schema/layout';
import { ipc } from '../ipc/client';
import { registerAction } from '../keymap/actions-runtime';
import { shownSession } from '../panel/host';
import { selectNeedsYou, useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { activeTab, currentSet } from '../stores/layout-model';
import { useNotices } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { nextNeedsYou } from './derive';
import { displayTitle } from '../sessions/title';

const openInFocusedPane = (appSessionId: AppSessionId) => {
  const layout = useLayout.getState();
  layout.setPanel({ maximized: false });
  layout.openTab({ kind: 'session', appSessionId }, { pane: 'focused' });
};

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

// E11 (W-C; E1's live sitting): a session whose tab is in front in a pane has its request on screen already, the
// docked card (C7); a toast would only cover the panel's action bar. A file tab of the session does not count (the
// docked card is in the session's own pane), and neither does a pane under a maximized panel (visibility.ts's rule).
// W-C review m1: an ask's surface is the panel's Question sheet, which E1 opens whenever the session is the shown one
// (a file tab of it counting), so for a `question` item the open panel showing that session is on screen too.
function requestOnScreen(appSessionId: AppSessionId, kind: AttentionItem['kind'] | undefined): boolean {
  const { main, regions } = useLayout.getState();
  const panelOpen = !regions.panel.collapsed;
  const inFront = currentSet(main).panes.some((pane) => pane.activeTabId === tabId({ kind: 'session', appSessionId }));
  if (inFront && !(regions.panel.maximized && panelOpen)) return true;
  return kind === 'question' && panelOpen && shownSession(main) === appSessionId;
}

// The session's latest list holds the item: the buffer of an outstanding attention snapshot first, else the store's.
function itemOf(appSessionId: AppSessionId, attentionId: AttentionId): AttentionItem | undefined {
  const attention = useAttention.getState();
  return (attention.pendingReplacements?.get(appSessionId) ?? attention.bySession.get(appSessionId))?.find((i) => i.id === attentionId);
}

const toastId = (attentionId: AttentionId) => `attention:${attentionId}`;

// E11 (W-C; E10's crash screenshot; A-47): a fallback toast lives while its item is open. Each toast's item, and whether
// the session's list has held it yet (main may announce an item before the page's list carries it).
type ToastedItems = Map<AttentionId, { appSessionId: AppSessionId; held: boolean }>;

function fallbackToast(toasted: ToastedItems, { appSessionId, attentionId, delivery }: EventPayload<'attention.notified'>): void {
  if (delivery !== 'fallback') return;
  const id = appSessionId as AppSessionId;
  const item = itemOf(id, attentionId as AttentionId);
  if (requestOnScreen(id, item?.kind)) return;
  if (item && !isOpen(item)) return; // settled before its notice arrived
  const record = useSessions.getState().records.get(id);
  const title = record ? displayTitle(record) : 'A session';
  useNotices.getState().toast({
    id: toastId(attentionId as AttentionId),
    level: 'warning',
    text: item?.summary ? `${title} needs you · ${item.summary}` : `${title} needs you`,
    actions: [{ label: 'Open session', run: () => openInFocusedPane(id) }],
    dismissible: true,
  });
  toasted.set(attentionId as AttentionId, { appSessionId: id, held: item !== undefined });
}

// A toast goes once its item is no longer open: answered, retired, or gone from its session's list (cleared with its
// dead host) after the list has held it. A toast the reader dismissed, or that timed out, is forgotten.
function retractSettled(toasted: ToastedItems): void {
  const shown = new Set(useNotices.getState().notices.map((notice) => notice.id));
  for (const [attentionId, entry] of toasted) {
    if (!shown.has(toastId(attentionId))) {
      toasted.delete(attentionId);
      continue;
    }
    const item = itemOf(entry.appSessionId, attentionId);
    if (item === undefined ? !entry.held : isOpen(item)) {
      entry.held ||= item !== undefined;
      continue;
    }
    toasted.delete(attentionId);
    useNotices.getState().dismiss(toastId(attentionId));
  }
}

export function connectAttention(client: MawsBridge = ipc): () => void {
  const toasted: ToastedItems = new Map();
  const offs = [
    registerAction('attention.next', openNextNeedsYou),
    client.on('attention.navigate', navigate),
    client.on('attention.notified', (notified) => fallbackToast(toasted, notified)),
    useAttention.subscribe(() => retractSettled(toasted)),
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
