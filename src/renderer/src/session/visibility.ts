// Which sessions are on screen (residue *Unread*; §5.7): a session is visible while its tab is the active tab of a
// pane, the main region is not covered by a maximized panel, the window has focus and the page is visible. Every change
// is reported to main as `session.setVisible`, which the source turns into the unread rule and `lastSeen`. A session
// tab with no record yet (an unstarted session) is reported once its record arrives. E3: a side thread the Side pane
// draws is visible too while the panel is open on its parent, maximized or not (the pane publishes it only while its
// tab is selected), or the thread's unread mark would never clear. P2-E1: so is the thread a comment card draws while
// its host is on screen (the card publishes it only then). P3-G (§D1.3): a floating panel covers the main region as a
// maximized one does, and the floating card draws the shown session on screen while it is open (not as its pill).
// P4-B3: likewise the main split's card, whose pane is not on screen while it floats.
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { surfaceSession, surfaceTabs } from '../panel/surface-model';
import { useLayout, type LayoutState } from '../stores/layout';
import { SIDE_TOOL_ID } from '../side/actions';
import { currentSet, floatingPane } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import { sideChildrenShown, useSidePane } from '../side/store'; // E3
import { useCommentCard } from '../side/card/store'; // P2-E1
import { panelInMain } from '../app/regions'; // P3-G
import { openCardSession, useFloatingCard } from '../shell/floating'; // P3-G

export function visibleSessions(
  layout: LayoutState,
  records: ReadonlyMap<AppSessionId, SessionRecord>,
  windowActive: boolean,
  sideChildren: ReadonlyMap<AppSessionId, AppSessionId> = new Map(), // E3: parent → the child its Side pane draws
): Set<AppSessionId> {
  const visible = new Set<AppSessionId>();
  if (!windowActive) return visible;
  const { main, regions } = layout;
  const context = surfaceSession(layout);
  const surfaces = surfaceTabs(layout, context);
  if (surfaces.length === 0 || !panelInMain(regions)) {
    const set = currentSet(main); // W12: the strips show the current set
    const floated = floatingPane(set); // P4-B3: a pane that yielded into the split's card is not on screen; its card is
    set.panes.forEach((pane, i) => {
      const tab = pane.tabs.find((t) => t.id === pane.activeTabId);
      if (i !== floated && tab?.kind === 'session' && records.has(tab.appSessionId)) visible.add(tab.appSessionId);
    });
  }
  // E3 start: the open panel shows the session of the focused pane's active tab (a file tab's included, C5's region),
  // maximized or not; the child its Side pane draws is on screen
  if (!regions.panel.collapsed && surfaces.some((tab) => tab.toolId === SIDE_TOOL_ID)) {
    const child = context === null ? undefined : sideChildren.get(context);
    if (child !== undefined && records.has(child)) visible.add(child);
  }
  // E3 end
  // P2-E1 start (2026-10-09): the thread a comment card draws on screen (its host visible); read from the card's store
  const card = useCommentCard.getState().shownThread;
  if (card !== null && records.has(card.child)) visible.add(card.child);
  // P2-E1 end
  // P3-G start: the session the open floating card draws (either card, P4-B3)
  const floating = openCardSession(layout);
  if (floating !== null && records.has(floating)) visible.add(floating);
  // P3-G end
  return visible;
}

export function connectVisibility(client: MawsBridge = ipc, stores = { layout: useLayout, sessions: useSessions, side: useSidePane /* E3 */ }): () => void {
  let viewing: AppSessionId | null = null;
  let reported = new Set<AppSessionId>();
  const send = (appSessionId: AppSessionId, visible: boolean) =>
    void client.invoke('session.setVisible', { appSessionId, visible }).then((result) => {
      if (!result.ok) console.warn('[shell] session.setVisible failed', result.error);
    });

  const update = () => {
    const layout = stores.layout.getState();
    const { main } = layout;
    const windowActive = document.hasFocus() && document.visibilityState === 'visible';
    const next = visibleSessions(layout, stores.sessions.getState().records, windowActive, sideChildrenShown(stores.side.getState()));
    for (const id of reported) if (!next.has(id)) send(id, false);
    for (const id of next) if (!reported.has(id)) send(id, true);
    reported = next;
    const set = currentSet(main);
    const pane = set.panes[set.focusedPane];
    const tab = pane?.tabs.find((entry) => entry.id === pane.activeTabId);
    const focused = tab?.kind === 'session' && next.has(tab.appSessionId) ? tab.appSessionId : null;
    if (viewing !== focused) {
      viewing = focused;
      void client.invoke('attention.viewing', { appSessionId: focused });
    }
  };

  const offLayout = stores.layout.subscribe((state, before) => {
    if (state.main !== before.main || state.regions !== before.regions || state.panelPinned !== before.panelPinned || state.panelBySession !== before.panelBySession || state.panelActiveNoSession !== before.panelActiveNoSession || state.panelSurfaces !== before.panelSurfaces || state.knownSession !== before.knownSession) update();
  });
  const offSessions = stores.sessions.subscribe((state, before) => state.records !== before.records && update());
  const offSide = stores.side.subscribe((state, before) => state.panes !== before.panes && update()); // E3
  const offCard = useCommentCard.subscribe((state, before) => state.shownThread !== before.shownThread && update()); // P2-E1
  const offFloating = useFloatingCard.subscribe((state, before) => state.closed !== before.closed && update()); // P3-G
  window.addEventListener('focus', update);
  window.addEventListener('blur', update);
  document.addEventListener('visibilitychange', update);
  update();
  return () => {
    offLayout();
    offSessions();
    offSide(); // E3
    offCard(); // P2-E1
    offFloating(); // P3-G
    window.removeEventListener('focus', update);
    window.removeEventListener('blur', update);
    document.removeEventListener('visibilitychange', update);
    for (const id of reported) send(id, false);
    void client.invoke('attention.viewing', { appSessionId: null });
  };
}
