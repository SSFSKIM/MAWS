// E4c (Task 3.2): the Browser tool follows the agent (E4c execution document, Design §10; Decision Log 6), connected once
// from App.tsx's E4c block. Removed with the browser tools in E13 M4 and restored on the owner's decision for cua's
// leases (P1 A-54, amended): main emits `browser.agent.acting` when a cua lease's first acting command arrives on a tab
// (src/main/browser/cua/connection.ts), without selecting it. A window that shows the session opens the session's Browser
// tool when none is open (a pinned one counts), activated, as E1's `connectAsks` opens the sheet; it never switches the
// main view or the shown session.
//
// U12a (the UX wave's U12 execution document, M2 and Interfaces §C; ruling R2; A-54 reversed, "Yes, unless I use mine"):
// the Browser that opens by itself shows the agent's tab. Only this window knows it is about to open the Browser by
// itself, and only main knows whether the person uses the selected tab, so before it opens the tool the window asks main
// (`browser.agent.show`, with the event's tab), which selects the agent's tab unless the person uses the selected one or
// a panel shows it (`agentTabComesForward`, src/main/browser/agent/control.ts). The window waits for the answer, whatever
// it is (a refusal included: the tab closed meanwhile), so the panel mounts on main's selection; then, if the session is
// still the one shown and still has no Browser tool, it opens the tool as before. If no answer comes, nothing opens. The
// window itself selects nothing, and a Browser tool already open, in view or not, is never moved.
//
// Once per turn: the first action of a turn the window shows decides, and nothing asks, opens or activates that session's
// tool again until the turn ends (`busy` leaves true), so a person who moved to another panel tab, or closed the tool,
// is not pulled back on every action. The turn is the acting session's (a side thread acting in its parent's tab: the
// thread's turn, the parent being idle), else the tab owner's. An action in a session the window does not show opens
// nothing and uses nothing up. The turn's opening is used up before the wait, so an action during it asks nothing more;
// outside any turn (the e2e seam) one ask at a time per session holds the same.
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
  const asking = new Set<AppSessionId>(); // the sessions whose opening waits for main's answer
  let connected = true;
  const mayOpen = (appSessionId: AppSessionId) => shownSession() === appSessionId && !hasBrowserTool(appSessionId) && usePanelHost.getState().tools.has(browserTool.id);

  const offs = [
    client.on('browser.agent.acting', ({ appSessionId, tabId, actingSessionId }) => {
      if (shownSession() !== appSessionId) return;
      const turn = [actingSessionId, appSessionId].find(inTurn);
      if (turn !== undefined) {
        const opened = followed.get(turn) ?? new Set<AppSessionId>();
        if (opened.has(appSessionId)) return;
        followed.set(turn, opened.add(appSessionId));
      }
      if (asking.has(appSessionId) || !mayOpen(appSessionId)) return;
      asking.add(appSessionId);
      const answered = () => {
        asking.delete(appSessionId);
        if (connected && mayOpen(appSessionId)) panelHost.addTool<BrowserParams>(browserTool.id, { appSessionId, params: { appSessionId }, activate: true });
      };
      void client.invoke('browser.agent.show', { tabId }).then(answered, answered); // whatever the answer is
    }),
    useSessions.subscribe(() => {
      for (const turn of followed.keys()) if (!inTurn(turn)) followed.delete(turn);
    }),
  ];
  return () => {
    connected = false;
    followed.clear();
    asking.clear();
    offs.forEach((off) => off());
  };
}
