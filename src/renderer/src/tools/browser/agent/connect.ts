// E4c (Task 3.2): the Browser tool follows the agent (E4c execution document, Design §10; Decision Log 6), connected once
// from App.tsx's E4c block. Removed with the browser tools in E13 M4 and restored on the owner's decision for cua's
// leases (P1 A-54, amended): main emits `browser.agent.acting` when a cua lease's first acting command arrives on a tab
// (src/main/browser/cua/connection.ts), without selecting it (the owner's choice for agent tabs; E4c selected it unless
// the person was using the selected tab). A window that shows the session opens the session's Browser tool when none is
// open (a pinned one counts), activated, as E1's `connectAsks` opens the sheet; it never switches the main view or the
// shown session. No tab id goes with the open: main's selection stands, so the tool shows the session's selected tab, the
// one the person is using included, and a page they are typing in is never swapped from here.
//
// Once per turn: the first action of a turn the window shows decides, and nothing opens or activates that session's tool
// again until the turn ends (`busy` leaves true), so a person who moved to another panel tab, or closed the tool, is not
// pulled back on every action. The turn is the acting session's (a side thread acting in its parent's tab: the thread's
// turn, the parent being idle), else the tab owner's. An action in a session the window does not show opens nothing and
// uses nothing up.
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../../ipc/client';
import { panelHost, shownSession, usePanelHost } from '../../../panel/host';
import { useLayout } from '../../../stores/layout';
import { useSessions } from '../../../stores/sessions';
import { browserTool, type BrowserParams } from '../BrowserTool';

const hasBrowserTool = (appSessionId: AppSessionId) => useLayout.getState().panelTabsOf(appSessionId).some((tab) => tab.toolId === browserTool.id);
const inTurn = (appSessionId: AppSessionId) => useSessions.getState().engine.get(appSessionId)?.busy === true;

export function connectBrowserAgent(client: MawsBridge = ipc): () => void {
  // a session in a turn → the sessions whose Browser tool that turn has had its one open of (or found open)
  const followed = new Map<AppSessionId, Set<AppSessionId>>();

  const offs = [
    client.on('browser.agent.acting', ({ appSessionId, actingSessionId }) => {
      if (shownSession() !== appSessionId) return;
      const turn = [actingSessionId, appSessionId].find(inTurn);
      if (turn !== undefined) {
        const opened = followed.get(turn) ?? new Set<AppSessionId>();
        if (opened.has(appSessionId)) return;
        followed.set(turn, opened.add(appSessionId));
      }
      if (hasBrowserTool(appSessionId) || !usePanelHost.getState().tools.has(browserTool.id)) return;
      panelHost.addTool<BrowserParams>(browserTool.id, { appSessionId, params: { appSessionId }, activate: true });
    }),
    useSessions.subscribe(() => {
      for (const turn of followed.keys()) if (!inTurn(turn)) followed.delete(turn);
    }),
  ];
  return () => {
    followed.clear();
    offs.forEach((off) => off());
  };
}
