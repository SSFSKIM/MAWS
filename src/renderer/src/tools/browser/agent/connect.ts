// E4c (Task 3.2): the Browser tool follows the agent (E4c execution document, Design §10; Decision Log 6), connected once
// from App.tsx's E4c block. Main emits `browser.agent.acting` when an agent action targets a tab, after it selected that
// tab in its session (or kept the tab the person is using selected). A window that shows the session opens the
// session's Browser tool when none is open (a pinned one counts), activated, as E1's `connectAsks` opens the sheet; it
// never switches the main view or the shown session. No tab id goes with the open: main's selection stands, so the tool
// shows the acting tab, or the one the person is using, and a page they are typing in is never swapped from here.
//
// Once per turn: the first action of a turn the window shows decides, and nothing opens or activates again until the
// session's turn ends (`busy` leaves true), so a person who moved to another panel tab, or closed the tool, is not
// pulled back on every action. An action in a session the window does not show opens nothing and uses nothing up.
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../../ipc/client';
import { panelHost, usePanelHost } from '../../../panel/host';
import { useLayout } from '../../../stores/layout';
import { activeTab, sessionOfTab } from '../../../stores/layout-model';
import { useSessions } from '../../../stores/sessions';
import { browserTool, type BrowserParams } from '../BrowserTool';

const shownSession = (): AppSessionId | null => sessionOfTab(activeTab(useLayout.getState().main));
const hasBrowserTool = (appSessionId: AppSessionId) => useLayout.getState().panelTabsOf(appSessionId).some((tab) => tab.toolId === browserTool.id);
const inTurn = (appSessionId: AppSessionId) => useSessions.getState().engine.get(appSessionId)?.busy === true;

export function connectBrowserAgent(client: MawsBridge = ipc): () => void {
  const followed = new Set<AppSessionId>(); // sessions whose turn has had its one open (or found the tool open)

  const offs = [
    client.on('browser.agent.acting', ({ appSessionId }) => {
      if (followed.has(appSessionId) || shownSession() !== appSessionId) return;
      if (inTurn(appSessionId)) followed.add(appSessionId);
      if (hasBrowserTool(appSessionId) || !usePanelHost.getState().tools.has(browserTool.id)) return;
      panelHost.addTool<BrowserParams>(browserTool.id, { appSessionId, params: { appSessionId }, activate: true });
    }),
    useSessions.subscribe(() => {
      for (const appSessionId of followed) if (!inTurn(appSessionId)) followed.delete(appSessionId);
    }),
  ];
  return () => {
    followed.clear();
    offs.forEach((off) => off());
  };
}
