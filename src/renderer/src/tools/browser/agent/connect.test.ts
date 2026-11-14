// E4c (Task 3.2): the Browser tool follows the agent (Design §10; Decision Log 6; restored for cua's leases, P1 A-54
// amended). On `browser.agent.acting` a window that shows the session opens the session's Browser tool when it has none,
// activated. U12a (M2; Interfaces §C, ruling R2; A-54 reversed): before it opens the tool it asks main to bring the
// agent's tab forward (`browser.agent.show`, with the event's tab) and waits for the answer, whatever it is; main decides,
// so the window itself selects nothing. Once per turn: after the first action of a turn the window shows, nothing asks,
// opens or activates again until the session's turn ends, so a person who moved to another panel tab, or closed the
// tool, is not pulled back on every action. Another session's action, or one the window does not show, asks and opens
// nothing.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient, type FakeClient } from '../../../../../../test/support/fake-client';
import { panelHost, registerPanelTool } from '../../../panel/host';
import { useLayout } from '../../../stores/layout';
import { useSessions } from '../../../stores/sessions';
import { browserTab, T1, T2, T3 } from '../../../test-support/browser';
import { installFakeMain, ok } from '../../../test-support/code';
import { A, B, mainShowing, panelOf, probeTool, resetPanelStores } from '../../../test-support/panel';
import { browserTool } from '../BrowserTool';
import { browser, resetBrowser, sessionTabs } from '../store';
import { connectBrowserAgent } from './connect';

let fake: FakeClient;
let disconnect: () => void;
let main: ReturnType<typeof installFakeMain>;
const browserTabs = (id: AppSessionId) => (panelOf(id)?.tabs ?? []).filter((t) => t.toolId === browserTool.id);
const acting = (appSessionId: AppSessionId, tabId = T1, actingSessionId = appSessionId) => fake.event('browser.agent.acting', { appSessionId, tabId, actingSessionId });
const THREAD = 'App-Thread' as AppSessionId; // a side thread of A, acting in A's tab (Decision Log 29)
const shows = () => fake.invoked('browser.agent.show');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
// an action, and the window's sequence run through main's answer (given at once unless the test holds it)
const acted = async (appSessionId: AppSessionId, tabId = T1, actingSessionId = appSessionId) => {
  acting(appSessionId, tabId, actingSessionId);
  await settle();
};
// the window connected to a main that holds `browser.agent.show` until the test answers it
const holdingMain = () => {
  disconnect();
  fake = fakeClient({});
  disconnect = connectBrowserAgent(fake.client);
};
const busy = (id: AppSessionId, value: boolean) =>
  useSessions.setState((s) => ({ engine: new Map(s.engine).set(id, { appSessionId: id, busy: value } as unknown as EngineSessionStatus) }));

// main's answer: the session's selected tab after the ask, whole (the agent's tab when it came forward)
const answer = (tabId: string | null) => ({ selected: tabId === null ? null : browserTab(tabId, A) });
const listedSelection = () => sessionTabs(browser.getState(), A).selected;

beforeEach(() => {
  resetPanelStores();
  resetBrowser();
  browser.setState({ sessions: new Map([[A, { tabs: [browserTab(T1, A), browserTab(T2, A)], selected: T1 }]]) }); // this window's list

  main = installFakeMain(() => ok());
  registerPanelTool(browserTool);
  busy(A, true);
  fake = fakeClient({ 'browser.agent.show': answer(T1) });
  disconnect = connectBrowserAgent(fake.client);
});
afterEach(() => {
  disconnect();
  delete (window as { maws?: unknown }).maws;
});

describe('the Browser tool follows the agent', () => {
  it('asks main for the event’s tab, then opens the shown session’s Browser tool, activated; the window selects nothing itself', async () => {
    await acted(A, T2);
    expect(shows()).toEqual([{ tabId: T2 }]);
    expect(browserTabs(A)).toHaveLength(1);
    expect(panelOf(A)!.activeTabId).toBe(browserTabs(A)[0]!.id);
    expect(main.callsOf('browser.tabs.select')).toEqual([]);
    expect(fake.invoked('browser.tabs.select')).toEqual([]);
  });

  it('opens once: later actions of the turn neither ask, add nor activate it again', async () => {
    const { tool } = probeTool('terminal', { multiInstance: false });
    registerPanelTool(tool);
    await acted(A);
    const terminal = panelHost.addTool('terminal', { appSessionId: A, activate: true }); // the person moves away
    await acted(A, T2);
    expect(shows()).toEqual([{ tabId: T1 }]);
    expect(browserTabs(A)).toHaveLength(1);
    expect(panelOf(A)!.activeTabId).toBe(terminal);
  });

  it('a Browser tool already open, in view or behind another tool, is left as it is and nothing is asked', async () => {
    const { tool } = probeTool('terminal', { multiInstance: false });
    registerPanelTool(tool);
    const browser = panelHost.addTool(browserTool.id, { appSessionId: A, params: { appSessionId: A }, activate: true });
    busy(A, false); // outside a turn, so each action is judged afresh
    await acted(A);
    expect(panelOf(A)!.activeTabId).toBe(browser);
    const terminal = panelHost.addTool('terminal', { appSessionId: A, activate: true });
    await acted(A);
    expect(shows()).toEqual([]);
    expect(browserTabs(A)).toHaveLength(1);
    expect(panelOf(A)!.activeTabId).toBe(terminal);
  });

  it('a pinned Browser tool counts as open', async () => {
    const { tool } = probeTool('terminal', { multiInstance: false });
    registerPanelTool(tool);
    panelHost.addTool(browserTool.id, { appSessionId: A, pin: true, activate: false });
    const terminal = panelHost.addTool('terminal', { appSessionId: A, activate: true });
    await acted(A);
    expect(shows()).toEqual([]);
    expect(browserTabs(A).filter((t) => !t.pinned)).toHaveLength(0);
    expect(panelOf(A)!.activeTabId).toBe(terminal); // neither added nor activated over the person's tab
  });

  it('a tool the person closed during the turn stays closed until the turn ends; the next turn opens it again', async () => {
    await acted(A);
    await panelHost.closeTab(browserTabs(A)[0]!.id);
    await acted(A);
    expect(browserTabs(A)).toHaveLength(0);
    busy(A, false); // the turn ended
    busy(A, true);
    await acted(A);
    expect(browserTabs(A)).toHaveLength(1);
    expect(shows()).toHaveLength(2); // one ask per turn's opening
  });

  it('an action outside any turn (the e2e seam) opens a tool that is absent, every time', async () => {
    busy(A, false);
    await acted(A);
    expect(browserTabs(A)).toHaveLength(1);
    await panelHost.closeTab(browserTabs(A)[0]!.id);
    await acted(A);
    expect(browserTabs(A)).toHaveLength(1); // no turn marked the session, so the close does not hold
  });

  it('a session the window does not show asks and opens nothing, and its action does not use up the turn’s open', async () => {
    busy(B, true);
    await acted(B);
    expect(shows()).toEqual([]);
    expect(browserTabs(B)).toHaveLength(0);
    useLayout.setState({ main: mainShowing(B) });
    await acted(B);
    expect(browserTabs(B)).toHaveLength(1);
  });

  // UX wave U7b (§N): behind a page the session is not on screen, as one that is not in front.
  it('behind a page the shown session’s action asks and opens nothing, and does not use up the turn’s open', async () => {
    useLayout.getState().openDestination({ kind: 'projects' });
    await acted(A);
    expect(shows()).toEqual([]);
    expect(browserTabs(A)).toHaveLength(0);
    useLayout.getState().closeDestination();
    await acted(A);
    expect(browserTabs(A)).toHaveLength(1);
  });

  it("a side thread acting in its shown parent's tab opens the parent's tool once per the thread's turn; a close holds until it ends", async () => {
    busy(A, false); // the parent is idle; its thread is in a turn
    busy(THREAD, true);
    await acted(A, T1, THREAD);
    expect(browserTabs(A)).toHaveLength(1);
    await panelHost.closeTab(browserTabs(A)[0]!.id);
    await acted(A, T1, THREAD);
    expect(browserTabs(A)).toHaveLength(0); // the person's close holds for the rest of the thread's turn
    busy(THREAD, false);
    busy(THREAD, true);
    await acted(A, T1, THREAD);
    expect(browserTabs(A)).toHaveLength(1);
  });

  it("the thread's turn and the parent's are counted apart: each opens the parent's tool at most once", async () => {
    busy(THREAD, true);
    await acted(A); // the parent's own turn
    await panelHost.closeTab(browserTabs(A)[0]!.id);
    await acted(A);
    expect(browserTabs(A)).toHaveLength(0);
    await acted(A, T1, THREAD); // the thread's first action in the parent's tab this turn
    expect(browserTabs(A)).toHaveLength(1);
    await panelHost.closeTab(browserTabs(A)[0]!.id);
    await acted(A, T1, THREAD);
    await acted(A);
    expect(browserTabs(A)).toHaveLength(0);
  });

  it('opens nothing once disconnected', async () => {
    disconnect();
    await acted(A);
    expect(shows()).toEqual([]);
    expect(browserTabs(A)).toHaveLength(0);
  });
});

// U12a (M2; Interfaces §C): main first, then the tool, so the panel mounts on the selection main has just made
describe("the window's sequence while main's answer is awaited", () => {
  beforeEach(holdingMain);

  it('opens no tool until main answers; then opens it, activated', async () => {
    acting(A);
    await settle();
    expect(fake.pending('browser.agent.show')).toBe(1);
    expect(browserTabs(A)).toHaveLength(0);
    await fake.reply('browser.agent.show', answer(T1));
    expect(browserTabs(A)).toHaveLength(1);
    expect(panelOf(A)!.activeTabId).toBe(browserTabs(A)[0]!.id);
  });

  it('opens the tool as today whatever main answers: the agent’s tab not selected, or a refusal', async () => {
    acting(A);
    await fake.reply('browser.agent.show', answer(T2)); // the person's tab stays selected
    expect(browserTabs(A)).toHaveLength(1);
    await panelHost.closeTab(browserTabs(A)[0]!.id);
    busy(A, false);
    busy(A, true); // a new turn
    acting(A);
    await fake.fail('browser.agent.show', 'unknown browser tab', 'invalid_input'); // the tab closed meanwhile
    expect(browserTabs(A)).toHaveLength(1);
  });

  it('a second action during the wait asks nothing more, and one tool opens', async () => {
    acting(A);
    acting(A, T2);
    await settle();
    expect(shows()).toEqual([{ tabId: T1 }]);
    await fake.reply('browser.agent.show', answer(T1));
    expect(browserTabs(A)).toHaveLength(1);
  });

  it('a second action during the wait outside any turn asks nothing more either', async () => {
    busy(A, false);
    acting(A);
    acting(A, T2);
    await settle();
    expect(shows()).toEqual([{ tabId: T1 }]);
    await fake.reply('browser.agent.show', answer(T1));
    expect(browserTabs(A)).toHaveLength(1);
  });

  it('the person opening the Browser during the wait leaves their one tool, not activated a second time', async () => {
    const { tool } = probeTool('terminal', { multiInstance: false });
    registerPanelTool(tool);
    acting(A);
    panelHost.addTool(browserTool.id, { appSessionId: A, params: { appSessionId: A }, activate: true }); // the person's own open
    const terminal = panelHost.addTool('terminal', { appSessionId: A, activate: true }); // and they move on
    await fake.reply('browser.agent.show', answer(T1));
    expect(browserTabs(A)).toHaveLength(1);
    expect(panelOf(A)!.activeTabId).toBe(terminal);
  });

  it('the shown session changing during the wait opens nothing', async () => {
    acting(A);
    useLayout.setState({ main: mainShowing(B) });
    await fake.reply('browser.agent.show', answer(T1));
    expect(browserTabs(A)).toHaveLength(0);
    expect(browserTabs(B)).toHaveLength(0);
  });

  it('a page opened during the wait opens nothing when the answer comes (asked again after the wait)', async () => {
    acting(A);
    useLayout.getState().openDestination({ kind: 'library' });
    await fake.reply('browser.agent.show', answer(T1));
    expect(browserTabs(A)).toHaveLength(0);
    expect(useLayout.getState().destination).toEqual({ kind: 'library' });
  });

  it('the person opening the Browser and closing it again during the wait drops the opening', async () => {
    acting(A);
    const opened = panelHost.addTool(browserTool.id, { appSessionId: A, params: { appSessionId: A }, activate: true });
    await panelHost.closeTab(opened);
    await fake.reply('browser.agent.show', answer(T1));
    expect(browserTabs(A)).toHaveLength(0);
  });

  it('the shown session changing and coming back during the wait drops the opening', async () => {
    acting(A);
    useLayout.setState({ main: mainShowing(B) });
    useLayout.setState({ main: mainShowing(A) });
    await fake.reply('browser.agent.show', answer(T1));
    expect(browserTabs(A)).toHaveLength(0);
  });

  it('no answer, no tool; a disconnect during the wait opens nothing when the answer comes', async () => {
    acting(A);
    await settle();
    expect(browserTabs(A)).toHaveLength(0);
    disconnect();
    await fake.reply('browser.agent.show', answer(T1));
    expect(browserTabs(A)).toHaveLength(0);
  });
});

// U12a (the branch review's ruling 7): the Browser opens by the agent only once this window's list of tabs names the
// selection main answered with, so its panel never mounts on the previous tab and claims that page's placement.
describe("the window's list holds main's selection before the tool opens", () => {
  beforeEach(holdingMain);

  // the session's selected tab, as this window lists it, at the moment its Browser tool appears
  const selectionAtOpen = () => {
    let seen: string | null | undefined;
    const off = useLayout.subscribe(() => {
      if (seen === undefined && browserTabs(A).length > 0) seen = listedSelection();
    });
    return { seen: () => seen, off };
  };

  it("names the agent's tab main selected when the tool opens, before main's own event, and the window sends no select", async () => {
    const watch = selectionAtOpen();
    acting(A, T2);
    await fake.reply('browser.agent.show', answer(T2));
    watch.off();
    expect(browserTabs(A)).toHaveLength(1);
    expect(watch.seen()).toBe(T2);
    expect(fake.invoked('browser.tabs.select')).toEqual([]);
  });

  it("lists the agent's tab with the selection when this window had not listed it yet", async () => {
    const watch = selectionAtOpen();
    acting(A, T3);
    await fake.reply('browser.agent.show', answer(T3));
    watch.off();
    expect(watch.seen()).toBe(T3);
    expect(sessionTabs(browser.getState(), A).tabs.map((tab) => tab.tabId)).toEqual([T1, T2, T3]);
  });

  it("opens as before, on the list as it is, when main answers that the agent's tab did not come forward", async () => {
    const watch = selectionAtOpen();
    acting(A, T2);
    await fake.reply('browser.agent.show', answer(T1));
    watch.off();
    expect(browserTabs(A)).toHaveLength(1);
    expect(watch.seen()).toBe(T1);
  });
});
