// A plugin's panes in MAWS's panel (R2; charter D-9 as amended 2026-10-01, the waves plan's R2 rulings: "Pane as an X5
// panel tool per roster entry ('Plugin panes'), opened by the roster pushes and closed by `ui_close`"). The roster per
// session comes from the engine: read with `session.ui.panes` when a session becomes attached in this renderer (what a
// surface that places panes reads on mount), then followed through the live `plugin.panes` events; it is forgotten when
// the session's surface goes. Every roster change reconciles the session's `plugin-pane` tabs with it: a pane with no
// tab gets one (selected only when it is the pane the engine shows and its session is on screen), a tab whose pane left
// the roster closes without asking the engine, and a standing focus request selects and focuses its pane's tab.
import type { PaneRoster } from '@shared/engine/surface';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { instanceOf, panelHost, registerPanelTool, setTitle } from '../panel/host';
import { useLayout } from '../stores/layout';
import { activeTab, sessionOfTab } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import { panesClient, setPanesClient, usePaneRosters } from './pane-roster';
import { markGone, PLUGIN_PANE_TOOL, pluginPaneTool, type PluginPaneState } from './PaneTool';

export { usePaneRoster, usePanes } from './pane-roster';

const shownSession = (): AppSessionId | null => sessionOfTab(activeTab(useLayout.getState().main));

const paneTabs = (appSessionId: AppSessionId) => (useLayout.getState().panelBySession.get(appSessionId)?.tabs ?? []).filter((t) => t.toolId === PLUGIN_PANE_TOOL);
const stateOf = (tabId: string) => instanceOf(tabId)?.state as PluginPaneState | undefined;

// The tab showing `paneId` in the session's panel, if any.
export function paneTab(appSessionId: AppSessionId, paneId: string): string | null {
  return paneTabs(appSessionId).find((t) => stateOf(t.id)?.paneId === paneId)?.id ?? null;
}

// A tab's suffix: the pane's title, else its id (the engine's own rule for a tab label).
const titleOf = (roster: PaneRoster | undefined, paneId: string) => roster?.panes.find((p) => p.id === paneId)?.title || paneId;

// Selects the pane's tab, adding it when it has none.
export function openPaneTab(appSessionId: AppSessionId, paneId: string): void {
  const tab = paneTab(appSessionId, paneId);
  if (tab !== null) panelHost.selectTab(tab);
  else setTitle(panelHost.addTool(PLUGIN_PANE_TOOL, { appSessionId, params: { paneId } }), titleOf(usePaneRosters.getState().rosters.get(appSessionId), paneId));
}

const answered = new Map<AppSessionId, string>(); // the focus request each session's roster carried and this window answered

function reconcile(appSessionId: AppSessionId): void {
  if (!useLayout.getState().hydrated) return; // the barrier passes hydration's tabs first; reconciled again once it has
  const roster = usePaneRosters.getState().rosters.get(appSessionId) ?? null;
  const open = new Set((roster?.panes ?? []).map((p) => p.id));
  const kept = new Set<string>();
  for (const tab of paneTabs(appSessionId)) {
    const state = stateOf(tab.id);
    // a restored tab names no pane (a tab persists as its ref alone); a pane that left the roster closed engine-side
    if (state?.paneId && open.has(state.paneId) && !kept.has(state.paneId)) {
      kept.add(state.paneId);
      setTitle(tab.id, titleOf(roster ?? undefined, state.paneId));
      continue;
    }
    if (state) markGone(state);
    void panelHost.closeTab(tab.id);
  }
  if (!roster) return;
  const shown = shownSession() === appSessionId;
  for (const pane of roster.panes) {
    if (kept.has(pane.id)) continue;
    const tab = panelHost.addTool(PLUGIN_PANE_TOOL, { appSessionId, params: { paneId: pane.id }, activate: shown && pane.id === roster.shownId });
    setTitle(tab, titleOf(roster, pane.id));
  }
  // a plugin's `$.ui.open({ focus: true })`: honoured on screen (its tab selected, its body takes the keyboard and says
  // so), refused for a session this window does not show
  const request = roster.focusRequestedId;
  if (request === null) {
    answered.delete(appSessionId);
    return;
  }
  if (answered.get(appSessionId) === request) return;
  answered.set(appSessionId, request);
  if (shown && open.has(request)) {
    openPaneTab(appSessionId, request);
    void panesClient().invoke('session.ui.paneFocus', { appSessionId, id: request });
  } else void panesClient().invoke('session.ui.paneFocus', { appSessionId, id: null });
}

function setRoster(appSessionId: AppSessionId, roster: PaneRoster | null): void {
  usePaneRosters.setState((s) => {
    const rosters = new Map(s.rosters);
    if (roster === null) rosters.delete(appSessionId);
    else rosters.set(appSessionId, roster);
    return { rosters };
  });
  if (roster === null) answered.delete(appSessionId);
  reconcile(appSessionId);
}

const isAttached = (appSessionId: AppSessionId): boolean => {
  const status = useSessions.getState().engine.get(appSessionId);
  return status?.process === 'ready' && status.uiSurface !== undefined;
};

// Registers the tool (never unregistered: a registration's disposer closes the tool's tabs, which StrictMode's effect
// replay would do) and follows the rosters. Returns the disconnect.
export function connectPluginPanes(client: MawsBridge = ipc): () => void {
  setPanesClient(client);
  registerPanelTool(pluginPaneTool);
  const attached = new Set<AppSessionId>();
  const pushed = new Map<AppSessionId, number>(); // pushes seen per session, so a read older than a push is dropped
  const read = (appSessionId: AppSessionId) => {
    const before = pushed.get(appSessionId) ?? 0;
    void client.invoke('session.ui.panes', { appSessionId }).then((result) => {
      if (!result.ok || !attached.has(appSessionId) || (pushed.get(appSessionId) ?? 0) !== before) return;
      setRoster(appSessionId, result.value);
    });
  };
  const follow = () => {
    const now = new Set([...useSessions.getState().engine.keys()].filter(isAttached));
    for (const id of now) {
      if (attached.has(id)) continue;
      attached.add(id);
      read(id);
    }
    for (const id of [...attached]) {
      if (now.has(id)) continue;
      attached.delete(id);
      pushed.delete(id);
      setRoster(id, null);
    }
  };
  follow();
  const offSessions = useSessions.subscribe((s, prev) => {
    if (s.engine !== prev.engine) follow();
  });
  const offLayout = useLayout.subscribe((s, prev) => {
    if (s.hydrated && !prev.hydrated) for (const id of usePaneRosters.getState().rosters.keys()) reconcile(id);
  });
  const offEvents = client.on('session.eventBatch', ({ appSessionId, events }) => {
    const id = appSessionId as AppSessionId;
    let latest: PaneRoster | null = null;
    for (const event of events) if (event.kind === 'plugin.panes') latest = { panes: event.panes, shownId: event.shownId, focusedId: event.focusedId, focusRequestedId: event.focusRequestedId };
    if (latest === null) return;
    pushed.set(id, (pushed.get(id) ?? 0) + 1);
    setRoster(id, latest);
  });
  return () => {
    offSessions();
    offLayout();
    offEvents();
  };
}

// Tests.
export function resetPaneRosters(): void {
  usePaneRosters.setState({ rosters: new Map() });
  answered.clear();
  setPanesClient(ipc);
}
