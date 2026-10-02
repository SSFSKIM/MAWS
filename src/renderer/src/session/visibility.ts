// Which sessions are on screen (residue *Unread*; §5.7): a session is visible while its tab is the active tab of a
// pane, the main region is not covered by a maximized panel, the window has focus and the page is visible. Every change
// is reported to main as `session.setVisible`, which the source turns into the unread rule and `lastSeen`. A session
// tab with no record yet (an unstarted session) is reported once its record arrives.
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { MawsBridge } from '@shared/ipc/schema';
import type { LayoutMain, LayoutRegions } from '@shared/ipc/schema/layout';
import { ipc } from '../ipc/client';
import { useLayout } from '../stores/layout';
import { currentSet } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';

export function visibleSessions(
  main: LayoutMain,
  regions: LayoutRegions,
  records: ReadonlyMap<AppSessionId, SessionRecord>,
  windowActive: boolean,
): Set<AppSessionId> {
  const visible = new Set<AppSessionId>();
  if (!windowActive || (regions.panel.maximized && !regions.panel.collapsed)) return visible;
  for (const pane of currentSet(main).panes) { // W12: the strips show the current set
    const tab = pane.tabs.find((t) => t.id === pane.activeTabId);
    if (tab?.kind === 'session' && records.has(tab.appSessionId)) visible.add(tab.appSessionId);
  }
  return visible;
}

export function connectVisibility(client: MawsBridge = ipc, stores = { layout: useLayout, sessions: useSessions }): () => void {
  let reported = new Set<AppSessionId>();
  const send = (appSessionId: AppSessionId, visible: boolean) =>
    void client.invoke('session.setVisible', { appSessionId, visible }).then((result) => {
      if (!result.ok) console.warn('[shell] session.setVisible failed', result.error);
    });

  const update = () => {
    const { main, regions } = stores.layout.getState();
    const windowActive = document.hasFocus() && document.visibilityState === 'visible';
    const next = visibleSessions(main, regions, stores.sessions.getState().records, windowActive);
    for (const id of reported) if (!next.has(id)) send(id, false);
    for (const id of next) if (!reported.has(id)) send(id, true);
    reported = next;
  };

  const offLayout = stores.layout.subscribe((state, before) => {
    if (state.main !== before.main || state.regions !== before.regions) update();
  });
  const offSessions = stores.sessions.subscribe((state, before) => state.records !== before.records && update());
  window.addEventListener('focus', update);
  window.addEventListener('blur', update);
  document.addEventListener('visibilitychange', update);
  update();
  return () => {
    offLayout();
    offSessions();
    window.removeEventListener('focus', update);
    window.removeEventListener('blur', update);
    document.removeEventListener('visibilitychange', update);
    for (const id of reported) send(id, false);
  };
}
