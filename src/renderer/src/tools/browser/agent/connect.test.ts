// E4c (Task 3.2): the Browser tool follows the agent (Design §10; Decision Log 6). On `browser.agent.acting` a window
// that shows the session opens the session's Browser tool when it has none, activated, and lets main's selection stand
// (no tab id is sent: main already selected the acting tab, or kept the person's). Once per turn: after the first
// action of a turn the window shows, nothing opens or activates again until the session's turn ends, so a person who
// moved to another panel tab, or closed the tool, is not pulled back on every action. Another session's action, or one
// the window does not show, opens nothing.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient, type FakeClient } from '../../../../../../test/support/fake-client';
import { panelHost, registerPanelTool } from '../../../panel/host';
import { useLayout } from '../../../stores/layout';
import { useSessions } from '../../../stores/sessions';
import { T1, T2 } from '../../../test-support/browser';
import { installFakeMain, ok } from '../../../test-support/code';
import { A, B, mainShowing, panelOf, probeTool, resetPanelStores } from '../../../test-support/panel';
import { browserTool } from '../BrowserTool';
import { connectBrowserAgent } from './connect';

let fake: FakeClient;
let disconnect: () => void;
let main: ReturnType<typeof installFakeMain>;
const browserTabs = (id: AppSessionId) => (panelOf(id)?.tabs ?? []).filter((t) => t.toolId === browserTool.id);
const acting = (appSessionId: AppSessionId, tabId = T1, actingSessionId = appSessionId) => fake.event('browser.agent.acting', { appSessionId, tabId, actingSessionId });
const THREAD = 'App-Thread' as AppSessionId; // a side thread of A, acting in A's tab (Decision Log 29)
const busy = (id: AppSessionId, value: boolean) =>
  useSessions.setState((s) => ({ engine: new Map(s.engine).set(id, { appSessionId: id, busy: value } as unknown as EngineSessionStatus) }));

beforeEach(() => {
  resetPanelStores();
  main = installFakeMain(() => ok());
  registerPanelTool(browserTool);
  busy(A, true);
  fake = fakeClient({});
  disconnect = connectBrowserAgent(fake.client);
});
afterEach(() => {
  disconnect();
  delete (window as { maws?: unknown }).maws;
});

describe('the Browser tool follows the agent', () => {
  it('opens the shown session’s Browser tool, activated, without selecting a tab over main', () => {
    acting(A);
    expect(browserTabs(A)).toHaveLength(1);
    expect(panelOf(A)!.activeTabId).toBe(browserTabs(A)[0]!.id);
    expect(main.callsOf('browser.tabs.select')).toEqual([]);
  });

  it('opens once: later actions of the turn neither add nor activate it again', () => {
    const { tool } = probeTool('terminal', { multiInstance: false });
    registerPanelTool(tool);
    acting(A);
    const terminal = panelHost.addTool('terminal', { appSessionId: A, activate: true }); // the person moves away
    acting(A, T2);
    expect(browserTabs(A)).toHaveLength(1);
    expect(panelOf(A)!.activeTabId).toBe(terminal);
  });

  it('a Browser tool already open is left as it is', () => {
    const { tool } = probeTool('terminal', { multiInstance: false });
    registerPanelTool(tool);
    panelHost.addTool(browserTool.id, { appSessionId: A, params: { appSessionId: A }, activate: false });
    const terminal = panelHost.addTool('terminal', { appSessionId: A, activate: true });
    acting(A);
    expect(browserTabs(A)).toHaveLength(1);
    expect(panelOf(A)!.activeTabId).toBe(terminal);
  });

  it('a pinned Browser tool counts as open', () => {
    const { tool } = probeTool('terminal', { multiInstance: false });
    registerPanelTool(tool);
    panelHost.addTool(browserTool.id, { appSessionId: A, pin: true, activate: false });
    const terminal = panelHost.addTool('terminal', { appSessionId: A, activate: true });
    acting(A);
    expect(browserTabs(A).filter((t) => !t.pinned)).toHaveLength(0);
    expect(panelOf(A)!.activeTabId).toBe(terminal); // neither added nor activated over the person's tab
  });

  it('a tool the person closed during the turn stays closed until the turn ends; the next turn opens it again', async () => {
    acting(A);
    await panelHost.closeTab(browserTabs(A)[0]!.id);
    acting(A);
    expect(browserTabs(A)).toHaveLength(0);
    busy(A, false); // the turn ended
    busy(A, true);
    acting(A);
    expect(browserTabs(A)).toHaveLength(1);
  });

  it('an action outside any turn (the e2e seam) opens a tool that is absent, every time', async () => {
    busy(A, false);
    acting(A);
    expect(browserTabs(A)).toHaveLength(1);
    await panelHost.closeTab(browserTabs(A)[0]!.id);
    acting(A);
    expect(browserTabs(A)).toHaveLength(1); // no turn marked the session, so the close does not hold
  });

  it('a session the window does not show opens nothing, and its action does not use up the turn’s open', () => {
    busy(B, true);
    acting(B);
    expect(browserTabs(B)).toHaveLength(0);
    useLayout.setState({ main: mainShowing(B) });
    acting(B);
    expect(browserTabs(B)).toHaveLength(1);
  });

  it("a side thread acting in its shown parent's tab opens the parent's tool once per the thread's turn; a close holds until it ends", async () => {
    busy(A, false); // the parent is idle; its thread is in a turn
    busy(THREAD, true);
    acting(A, T1, THREAD);
    expect(browserTabs(A)).toHaveLength(1);
    await panelHost.closeTab(browserTabs(A)[0]!.id);
    acting(A, T1, THREAD);
    expect(browserTabs(A)).toHaveLength(0); // the person's close holds for the rest of the thread's turn
    busy(THREAD, false);
    busy(THREAD, true);
    acting(A, T1, THREAD);
    expect(browserTabs(A)).toHaveLength(1);
  });

  it("the thread's turn and the parent's are counted apart: each opens the parent's tool at most once", async () => {
    busy(THREAD, true);
    acting(A); // the parent's own turn
    await panelHost.closeTab(browserTabs(A)[0]!.id);
    acting(A);
    expect(browserTabs(A)).toHaveLength(0);
    acting(A, T1, THREAD); // the thread's first action in the parent's tab this turn
    expect(browserTabs(A)).toHaveLength(1);
    await panelHost.closeTab(browserTabs(A)[0]!.id);
    acting(A, T1, THREAD);
    acting(A);
    expect(browserTabs(A)).toHaveLength(0);
  });

  it('opens nothing once disconnected', () => {
    disconnect();
    acting(A);
    expect(browserTabs(A)).toHaveLength(0);
  });
});
