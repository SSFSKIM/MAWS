// Getting to what needs you (charter §5.7; C5 execution document, M5): ⌘⇧J opens the oldest Needs-you session that is
// not the one in front of you, in the focused pane (a session tab, never the Overview, because the item wants an
// answer and the docked card is where scopes live); a notification click arrives from main as `attention.navigate`
// and opens the same way (W9: the item it names is no longer kept for a transcript jump nothing built; P2-C M6: an
// owner-channel item it names opens at its mark in the report, anchor.ts); when main could
// not post an OS notification (`attention.notified { delivery: 'fallback' }`) the page shows a toast in its place.
import { isOpen } from '@shared/attention/kinds';
import { previewLine } from '@shared/owner/preview';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId, AttentionId } from '@shared/graph/ids';
import type { EventPayload, MawsBridge } from '@shared/ipc/schema';
import { tabId } from '@shared/ipc/schema/layout';
import { ASK_SHEET_TOOL_ID } from '@shared/maws/panes';
import { ipc } from '../ipc/client';
import { registerAction } from '../keymap/actions-runtime';
import { surfaceSession, surfaceTabs } from '../panel/surface-model';
import { SIDE_TOOL_ID } from '../side/actions';
import { selectNeedsYou, useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { activeTab, currentSet, floatingPane } from '../stores/layout-model';
import { useNotices } from '../stores/notices';
import { queueComposerAttachment } from '../stores/composer';
import { useSessions } from '../stores/sessions';
import { sideChildrenShown } from '../side/store';
import { useCommentCard } from '../side/card/store'; // P2-E1
import { askSheet } from '../tools/maws/ask/store';
import { openAnchor, ownerAnchorOf } from './anchor'; // P2-C
import { nextNeedsYou } from './derive';
import { displayTitle } from '../sessions/title';
import { panelInMain } from '../app/regions'; // P3-G
import { openCardSession } from '../shell/floating'; // P3-G

const openInFocusedPane = (appSessionId: AppSessionId) => {
  const layout = useLayout.getState();
  layout.revealMain(); // P3-G: a maximized or floating panel docks
  layout.openTab({ kind: 'session', appSessionId }, { pane: 'focused' });
};

function openNextNeedsYou(): void {
  const rows = selectNeedsYou(useAttention.getState(), useSessions.getState());
  const tab = activeTab(useLayout.getState().main);
  const current = tab?.kind === 'session' ? tab.appSessionId : null;
  const next = nextNeedsYou(rows, current);
  if (next) openItem(next.appSessionId, next.oldest);
}

function navigate({ appSessionId, attentionId }: EventPayload<'attention.navigate'>): void {
  const id = appSessionId as AppSessionId;
  openItem(id, attentionId === null ? undefined : itemOf(id, attentionId as AttentionId));
}

// P2-C start (2026-10-10; M6): an owner-channel item opens at its anchor in the report (anchor.ts); any other, its session
function openItem(appSessionId: AppSessionId, item: AttentionItem | undefined): void {
  const anchor = item === undefined ? null : ownerAnchorOf(item);
  if (anchor !== null) openAnchor(appSessionId, anchor);
  else openInFocusedPane(appSessionId);
}
// P2-C end

// E11 (W-C; E1's live sitting): a session whose tab is in front in a pane has its request on screen already, the
// docked card (C7); a toast would only cover the panel's action bar. A file tab of the session does not count (the
// docked card is in the session's own pane), and neither does a pane under a maximized panel (visibility.ts's rule). P3-G:
// nor one under a floating panel, where the open floating card is the session's pane (its docked request included).
// P4-B3: nor a pane floating in the split's card, which counts while it is open, as the panel's card does.
// W-C review m1: an ask's surface is the panel's Question sheet, which E1 opens whenever the session is the shown one
// (a file tab of it counting), so for a `maws` ask the open panel showing that session is on screen too. Scale-review C
// scalpel-3#1: only a `maws` ask; the engine's AskUserQuestion is a `question` item as well, but its card docks in the
// session's own composer (swap.ts), so the panel does not show it. Scale-review C scalpel-2#3: a side thread drawn in
// the open panel's Side pane is its whole session pane, docked card included (visibility.ts counts it the same way).
function requestOnScreen(appSessionId: AppSessionId, item: AttentionItem | undefined): boolean {
  const layout = useLayout.getState();
  const { main, regions } = layout;
  const context = surfaceSession(layout);
  const surfaces = surfaceTabs(layout, context);
  const panelOpen = !regions.panel.collapsed;
  const toolOnScreen = (toolId: string) => panelOpen && surfaces.some((tab) => tab.toolId === toolId);
  const set = currentSet(main);
  // P4-B3: a pane that yielded into the split's card is not in front (its tab stays active); the open card is (below)
  const inFront = set.panes.some((pane, i) => i !== floatingPane(set) && pane.activeTabId === tabId({ kind: 'session', appSessionId }));
  if (inFront && (surfaces.length === 0 || !panelInMain(regions))) return true;
  if (openCardSession(layout) === appSessionId) return true; // P3-G
  if (toolOnScreen(SIDE_TOOL_ID) && context !== null && sideChildrenShown().get(context) === appSessionId) return true;
  // P2-E1 start (2026-10-09): a thread a comment card draws on screen shows its requests inline (C7's card in the card's
  // thread), as the Side pane shows a thread's
  if (useCommentCard.getState().shownThread?.child === appSessionId) return true;
  // P2-E1 end
  return item !== undefined && isMawsAsk(item) && toolOnScreen(ASK_SHEET_TOOL_ID) && context === appSessionId;
}

// A `maws` ask's item: its originating event read as `maws.ask.opened` (swapOf's test), or, not read yet, an ask the
// Question sheet's store holds under its request id (the store follows every live `maws.ask.*` batch). P2-C2: an async
// ask's `async_input` item too, which carries no mark anchor.
function isMawsAsk(item: AttentionItem): boolean {
  if (item.kind !== 'question' && !(item.kind === 'async_input' && item.anchor === undefined)) return false;
  const request = useAttention.getState().requests.get(item.id);
  if (request !== undefined && request !== null) return request.kind === 'maws.ask.opened';
  return [...askSheet(item.appSessionId).getState().asks.values()].some((ask) => ask.requestId === item.request.requestId);
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

function fallbackToast(toasted: ToastedItems, { appSessionId, attentionId, delivery, error, reply }: EventPayload<'attention.notified'>): void {
  if (delivery === 'os') return;
  if (error) {
    // Add to the restored draft, never replace it. A busy or unmounted composer
    // keeps this queue until it can take the text; dismissing the toast loses nothing.
    if (reply !== undefined) queueComposerAttachment(appSessionId, { files: [], text: reply });
    useNotices.getState().toast({ level: 'danger', text: `${error}${reply !== undefined ? ' Reply not sent; kept in the session composer.' : ''}`, actions: [], dismissible: true });
    return;
  }
  if (attentionId === null) {
    const record = useSessions.getState().records.get(appSessionId);
    const digest = useSessions.getState().digests.get(appSessionId);
    useNotices.getState().toast({ level: 'info', text: `${record ? displayTitle(record) : 'A session'} finished${digest?.lastAssistantLine ? ` · ${digest.lastAssistantLine}` : ''}`,
      actions: [{ label: 'Open', run: () => useLayout.getState().openSession(appSessionId) }], dismissible: true });
    return;
  }
  const id = appSessionId as AppSessionId;
  const item = itemOf(id, attentionId as AttentionId);
  if (delivery === 'fallback' && requestOnScreen(id, item)) return;
  if (item && !isOpen(item)) return; // settled before its notice arrived
  const record = useSessions.getState().records.get(id);
  const title = record ? displayTitle(record) : 'A session';
  useNotices.getState().toast({
    id: toastId(attentionId as AttentionId),
    level: 'warning',
    text: item?.summary ? `${title} needs you · ${previewLine(item.summary, 200) ?? item.summary}` : `${title} needs you`, // E11 F2b (plan 2.6)
    actions: [{ label: 'Open session', run: () => openItem(id, item) }], // P2-C: an owner-channel item at its mark
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
