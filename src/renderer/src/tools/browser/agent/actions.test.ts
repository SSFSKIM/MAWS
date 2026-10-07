// E4c (Task 3.1): a browser action row's Open tab (Design §10): the Browser tool in the tab's own session, which selects
// the tab in main; a side thread acting in its parent's tab opens the parent's tool, and a tab the window's mirror does
// not list is looked for in the row's session.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerPanelTool } from '../../../panel/host';
import { installFakeMain, ok } from '../../../test-support/code';
import { browserTab, T1, T2 } from '../../../test-support/browser';
import { A, B, panelOf, resetPanelStores } from '../../../test-support/panel';
import { browserTool } from '../BrowserTool';
import { browser, resetBrowser } from '../store';
import { openBrowserTab } from './actions';

let main: ReturnType<typeof installFakeMain>;
const browserTabs = (id: typeof A) => (panelOf(id)?.tabs ?? []).filter((t) => t.toolId === browserTool.id);

beforeEach(() => {
  resetPanelStores();
  resetBrowser();
  registerPanelTool(browserTool);
  main = installFakeMain(() => ok());
  browser.setState({ sessions: new Map([[B, { tabs: [browserTab(T1, B)], selected: T1 }]]) });
});
afterEach(() => {
  delete (window as { maws?: unknown }).maws;
});

describe('openBrowserTab', () => {
  it('opens the Browser tool in the session that holds the tab, which selects it, activated', () => {
    openBrowserTab(A, T1);
    expect(browserTabs(A)).toEqual([]);
    expect(browserTabs(B)).toHaveLength(1);
    expect(panelOf(B)!.activeTabId).toBe(browserTabs(B)[0]!.id);
    expect(main.callsOf('browser.tabs.select')).toEqual([{ appSessionId: B, tabId: T1 }]);
  });

  it('a tab the mirror does not list is asked of the row’s session', () => {
    openBrowserTab(A, T2);
    expect(browserTabs(A)).toHaveLength(1);
    expect(main.callsOf('browser.tabs.select')).toEqual([{ appSessionId: A, tabId: T2 }]);
  });
});
