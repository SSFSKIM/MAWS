// E4c (Task 3.1): the browser action row's Open tab (E4c execution document, Design §10), registered as
// `TranscriptActions.openBrowserTab` from App.tsx's E4c block: the Browser tool on the row's tab. The tab's own session
// as the window's mirror lists it (a side thread acts in its parent's tabs too, Decision Log 29), else the row's; the
// tool selects the tab (BrowserTool's `tabId`).
import type { AppSessionId } from '@shared/graph/ids';
import { panelHost } from '../../../panel/host';
import { browserTool, type BrowserParams } from '../BrowserTool';
import { browser } from '../store';

export function openBrowserTab(appSessionId: AppSessionId, tabId: string): void {
  const owner = [...browser.getState().sessions].find(([, { tabs }]) => tabs.some((tab) => tab.tabId === tabId))?.[0] ?? appSessionId;
  panelHost.addTool<BrowserParams>(browserTool.id, { appSessionId: owner, params: { tabId, appSessionId: owner }, activate: true });
}
