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
// a panel shows a tab of the session (`agentTabComesForward`, src/main/browser/agent/control.ts). The window waits for the
// answer, whatever it is (a refusal included: the tab closed meanwhile). The person's act wins (the branch review's
// rulings 6 and 7): an opening is dropped when, while the answer is out, this window adds or removes the session's
// Browser tool or changes the session it shows; and when main answers that the agent's tab is the selected one, this
// window's list is told so first (`agentTabSelected`), so the panel mounts on that tab and never claims the previous
// tab's placement from a main tab that shows it. Otherwise the tool opens as before. If no answer comes, nothing opens.
// The window sends no selection of its own, and a Browser tool already open, in view or not, is never moved.
//
// Once per turn: the first action of a turn the window shows decides, and nothing asks, opens or activates that session's
// tool again until the turn ends (`busy` leaves true), so a person who moved to another panel tab, or closed the tool,
// is not pulled back on every action. The turn is the acting session's (a side thread acting in its parent's tab: the
// thread's turn, the parent being idle), else the tab owner's. An action in a session the window does not show opens
// nothing and uses nothing up. The turn's opening is used up before the wait, so an action during it asks nothing more;
// outside any turn (the e2e seam) one ask at a time per session holds the same.
import type { BrowserTab } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../../ipc/client';
import { panelHost, shownSession, usePanelHost } from '../../../panel/host';
import { pageOpen, useLayout } from '../../../stores/layout';
import { useSessions } from '../../../stores/sessions';
import { browserTool, type BrowserParams } from '../BrowserTool';
import { agentTabSelected } from '../store';

const hasBrowserTool = (appSessionId: AppSessionId) => useLayout.getState().panelTabsOf(appSessionId).some((tab) => tab.toolId === browserTool.id);
const inTurn = (appSessionId: AppSessionId) => useSessions.getState().engine.get(appSessionId)?.busy === true;
// UX wave U7b (§N): the session the window shows, and not behind a page, where the Browser follows no agent.
const onScreen = (appSessionId: AppSessionId) => shownSession() === appSessionId && !pageOpen(useLayout.getState());

export function connectBrowserAgent(client: MawsBridge = ipc): () => void {
  // a session in a turn → the sessions whose Browser tool that turn has had its one open of (or found open)
  const followed = new Map<AppSessionId, Set<AppSessionId>>();
  const asking = new Map<AppSessionId, () => void>(); // the sessions whose opening waits for main's answer → stop watching
  let connected = true;
  const mayOpen = (appSessionId: AppSessionId) => onScreen(appSessionId) && !hasBrowserTool(appSessionId) && usePanelHost.getState().tools.has(browserTool.id);
  // Whether the person acts on that Browser while the answer is out: any add or removal of the session's Browser tool
  // in this window, or any change of the session it shows, even one undone before the answer.
  const watch = (appSessionId: AppSessionId) => {
    const shown = shownSession();
    const has = hasBrowserTool(appSessionId);
    let moved = false;
    const off = useLayout.subscribe(() => {
      if (moved || (shownSession() === shown && hasBrowserTool(appSessionId) === has)) return;
      moved = true;
      off();
    });
    return { moved: () => moved, off };
  };

  const offs = [
    client.on('browser.agent.acting', ({ appSessionId, tabId, actingSessionId }) => {
      if (!onScreen(appSessionId)) return;
      const turn = [actingSessionId, appSessionId].find(inTurn);
      if (turn !== undefined) {
        const opened = followed.get(turn) ?? new Set<AppSessionId>();
        if (opened.has(appSessionId)) return;
        followed.set(turn, opened.add(appSessionId));
      }
      if (asking.has(appSessionId) || !mayOpen(appSessionId)) return;
      const person = watch(appSessionId);
      asking.set(appSessionId, person.off);
      const answered = (selected: BrowserTab | null) => {
        asking.delete(appSessionId);
        person.off();
        if (!connected || person.moved() || !mayOpen(appSessionId)) return;
        if (selected?.tabId === tabId) agentTabSelected(selected);
        // UX wave U7b (Interfaces §F): not the person's act. `mayOpen` already answered no behind a page, so this opens no
        // session; the origin travels with the call all the same.
        panelHost.addTool<BrowserParams>(browserTool.id, { appSessionId, params: { appSessionId }, activate: true, asked: 'agent' });
      };
      void client.invoke('browser.agent.show', { tabId }).then(
        (result) => answered(result.ok ? result.value.selected : null),
        () => answered(null), // whatever the answer is
      );
    }),
    useSessions.subscribe(() => {
      for (const turn of followed.keys()) if (!inTurn(turn)) followed.delete(turn);
    }),
  ];
  return () => {
    connected = false;
    followed.clear();
    for (const off of asking.values()) off();
    asking.clear();
    offs.forEach((off) => off());
  };
}
