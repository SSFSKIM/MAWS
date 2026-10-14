// E3 (M3): the Side pane (E3 execution document, Design §6, M3's proofs): one tab per session, re-targeted by `open`;
// the panel rule (a thread opened while its parent is not shown is added without activation and a toast says where);
// the chip strip of the session's threads, newest first; the thread view yielding to a main tab of the same thread
// and publishing the child it draws for the unread rule.
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Anchor } from '@shared/anchor/anchor';
import { promotionMessage } from '@shared/anchor/message';
import type { AppSessionId } from '@shared/graph/ids';
import type { Lineage, SessionRecord } from '@shared/graph/session';
import type { SideExchange } from '@shared/side/question';
import { digest, record, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { rowsOf } from '../transcript/model/derive';
import { applyEvents, createState } from '../transcript/model/reduce';
import { builder, uuid } from '../transcript/model/test-events';
import { useTranscriptStore } from '../transcript';
import { instanceOf, panelHost } from '../panel/host';
import type { PanelToolContext } from '../panel/tool';
import { useLayout } from '../stores/layout';
import { activeTab, sessionOfTab } from '../stores/layout-model';
import { useNotices } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { A, B, panelOf, resetPanelStores } from '../test-support/panel';
import { openSideThread, revealNewThread, SIDE_TOOL_ID } from './actions';
import { registerSidePane } from './register';
import { resetSideQuestions, setInlineQuestions, setSideView, sideChildrenShown, sidePaneOf, useSidePane } from './store';
import { sideThreadsOf, sideTool } from './SideTool';
import { promotionQuestionOf, ThreadView } from './ThreadView';
// E4d start
import { registerPanelTool } from '../panel/host';
import { installFakeMain, ok } from '../test-support/code';
import { browserTab, T1 } from '../test-support/browser';
import { browserTool } from '../tools/browser/BrowserTool';
// E4d end
// P2-E1 start (2026-10-09)
import { deliverableUrl } from '@shared/maws/deliverable';
import { useCommentCard } from './card/store';
import { artifactUrl } from '@shared/artifacts/scheme'; // P3-L (M5b)
import { ARTIFACTS_TOOL_ID, type ArtifactsParams } from '../tools/artifacts/ArtifactsTool'; // P3-L (M5b)
// P2-E1 end
import { browser, resetBrowser } from '../tools/browser/store'; // P2-F L146
import { registerDock } from '../tools/browser/comment/dock'; // P2-F L146

const ONE = 'side-one' as AppSessionId;
const TWO = 'side-two' as AppSessionId;
const ANCHOR: Anchor = { kind: 'file-line', locator: '/work/app-a/x.ts#L42', label: 'x.ts:42', path: '/work/app-a/x.ts', line: 42 };

const lineage = (over: Partial<Lineage> = {}): Lineage => ({ kind: 'side-thread', parentAppSessionId: A, parentEngineSessionId: null, anchor: ANCHOR, openedBy: 'comment', ...over });
const thread = (id: AppSessionId, createdAt: string, over: Partial<Lineage> = {}): SessionRecord => ({ ...record(id), createdAt, lineage: lineage(over) });

const sideTabs = (id: AppSessionId) => (panelOf(id)?.tabs ?? []).filter((t) => t.toolId === SIDE_TOOL_ID);
const shown = () => sessionOfTab(activeTab(useLayout.getState().main));

function withThreads(...threads: SessionRecord[]) {
  const records = new Map(useSessions.getState().records);
  for (const t of threads) records.set(t.appId, t);
  useSessions.setState({ records });
}

function ctx(over: Partial<PanelToolContext> = {}): PanelToolContext {
  return { appSessionId: A, session: record(A), status: null, pinned: false, visible: true, focusRequest: 0, setTitle: () => {}, close: () => {}, openTool: panelHost.addTool, editorHost: { surface: 'panel', tabId: 'side:test' }, ...over };
}

function mount(over: Partial<PanelToolContext> = {}) {
  const Body = sideTool.render;
  return render(<Body state={{ appSessionId: A }} ctx={ctx(over)} />);
}

beforeEach(() => {
  resetPanelStores();
  useSidePane.setState({ panes: new Map() });
  useNotices.setState({ notices: [] });
  registerSidePane();
});
afterEach(() => cleanup());

describe('the Side pane', () => {
  it('registers as a single-instance, unpinnable tool offered from "+"', () => {
    expect(panelHost.tools().find((t) => t.id === SIDE_TOOL_ID)).toMatchObject({ multiInstance: false, pinnable: false, menu: true });
  });

  it('one tab per session: a second open re-targets it to the other thread', () => {
    act(() => openSideThread(A, ONE));
    act(() => openSideThread(A, TWO));
    const tabs = sideTabs(A);
    expect(tabs).toHaveLength(1);
    expect(panelOf(A)?.activeTabId).toBe(tabs[0].id);
    expect(instanceOf(tabs[0].id)?.state).toEqual({ appSessionId: A });
    expect(sidePaneOf(useSidePane.getState(), A).view).toEqual({ kind: 'thread', childAppSessionId: TWO });
    expect(useLayout.getState().regions.panel.collapsed).toBe(false);
  });

  it('a thread opened while its parent is not shown waits in the parent’s panel and a toast says where; the main view stays', () => {
    useSessions.setState({ records: new Map(useSessions.getState().records).set(B, { ...record(B), title: { text: 'Refactor', source: 'user' } }) });
    act(() => revealNewThread(B, ONE));
    expect(shown()).toBe(A);
    expect(sideTabs(B)).toHaveLength(1);
    expect(panelOf(B)?.activeTabId).not.toBe(sideTabs(B)[0].id);
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['Side thread opened in the panel of Refactor']);
    expect(sidePaneOf(useSidePane.getState(), B).view).toEqual({ kind: 'thread', childAppSessionId: ONE });
    act(() => revealNewThread(A, TWO)); // the parent is shown: on screen, no toast
    expect(panelOf(A)?.activeTabId).toBe(sideTabs(A)[0].id);
    expect(useNotices.getState().notices).toHaveLength(1);
  });

  it('lists the session’s side threads newest first, not its forks or another session’s threads', () => {
    const fork = { ...record('fork-x'), lineage: lineage({ kind: 'fork', openedBy: 'fork', anchor: undefined }) };
    const other = thread('other-thread' as AppSessionId, '2026-10-06T03:00:00.000Z', { parentAppSessionId: B });
    withThreads(thread(ONE, '2026-10-06T01:00:00.000Z'), thread(TWO, '2026-10-06T02:00:00.000Z', { anchor: undefined, openedBy: 'btw' }), fork, other);
    expect(sideThreadsOf(useSessions.getState().records, A).map((r) => r.appId)).toEqual([TWO, ONE]);
    mount();
    const chips = [...document.querySelectorAll('[data-side-chip]:not([data-side-chip="btw"])')];
    expect(chips.map((chip) => chip.textContent?.replace(/^\W+/, ''))).toEqual(['Side question', 'x.ts:42']);
    expect(chips[0].getAttribute('aria-current')).toBe('true'); // no view chosen: the newest
  });

  it('with no thread, the empty state says how to start one', () => {
    mount();
    expect(screen.getByText('No side threads yet. Comment on a line, or type /btw in the composer.')).toBeTruthy();
  });

  it('the thread view yields to a main tab of the thread, and comes back when that tab closes; it publishes the child only while drawn', async () => {
    withThreads(thread(ONE, '2026-10-06T01:00:00.000Z'));
    act(() => openSideThread(A, ONE));
    mount();
    expect(screen.getByRole('button', { name: 'Open x.ts:42' })).toBeTruthy();
    expect(sideChildrenShown()).toEqual(new Map([[A, ONE]]));
    await userEvent.click(screen.getByRole('button', { name: 'Open as tab' }));
    expect(screen.getByText('Shown in the main area')).toBeTruthy();
    expect(sideChildrenShown()).toEqual(new Map());
    act(() => useLayout.getState().closeTab(`session:${ONE}`));
    expect(screen.queryByText('Shown in the main area')).toBeNull();
    expect(sideChildrenShown()).toEqual(new Map([[A, ONE]]));
    cleanup();
    mount({ visible: false });
    expect(sideChildrenShown()).toEqual(new Map());
  });

  it('the anchor header opens the file at its line in the parent’s context', async () => {
    withThreads(thread(ONE, '2026-10-06T01:00:00.000Z'));
    act(() => openSideThread(A, ONE));
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Open x.ts:42' }));
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'file', path: '/work/app-a/x.ts', line: 42, appSessionId: A });
  });

  // E4d start: a page element thread's header opens the page in the parent's browser (E4d execution document, Design §10)
  it('a page element thread’s header shows its URL as a button opening the page in the parent’s browser; another kind’s URL stays text', async () => {
    const url = 'http://127.0.0.1:4000/comment.html';
    const page: Anchor = { kind: 'browser-element', locator: '#increment', label: 'button “Increment”', pageUrl: url, css: '#increment' };
    withThreads(thread(ONE, '2026-10-06T01:00:00.000Z', { anchor: page }));
    registerPanelTool(browserTool);
    const main = installFakeMain((name, input) => (name === 'browser.tabs.open' ? ok({ tab: browserTab(T1, input.appSessionId as AppSessionId, { url }), reused: false }) : ok()));
    act(() => openSideThread(A, ONE));
    mount();
    await userEvent.click(screen.getByRole('button', { name: url }));
    expect(main.callsOf('browser.tabs.open')).toEqual([{ appSessionId: A, url, select: true, reuse: 'url' }]);
    expect(panelOf(A)!.tabs.some((t) => t.toolId === browserTool.id)).toBe(true);
    expect(panelOf(ONE)).toBeUndefined();
    cleanup();
    const pr: Anchor = { kind: 'pr-line', locator: 'https://github.com/o/r/pull/7/files#diff-1R3', label: 'x.ts:3 · PR #7', pageUrl: 'https://github.com/o/r/pull/7/files', path: 'x.ts', line: 3, side: 'new', prNumber: 7 };
    withThreads(thread(ONE, '2026-10-06T01:00:00.000Z', { anchor: pr }));
    mount();
    expect(screen.queryByRole('button', { name: pr.pageUrl })).toBeNull();
    expect(screen.getByText(pr.pageUrl!)).toBeDefined();
  });

  it('a thread nested in a thread opens its page in its own parent’s browser, as the chip in its transcript does', async () => {
    const url = 'http://127.0.0.1:4000/comment.html';
    const page: Anchor = { kind: 'browser-element', locator: '#increment', label: 'button “Increment”', pageUrl: url, css: '#increment' };
    withThreads(thread(ONE, '2026-10-06T01:00:00.000Z'), thread(TWO, '2026-10-06T02:00:00.000Z', { parentAppSessionId: ONE, anchor: page }));
    registerPanelTool(browserTool);
    const main = installFakeMain((name, input) => (name === 'browser.tabs.open' ? ok({ tab: browserTab(T1, input.appSessionId as AppSessionId, { url }), reused: false }) : ok()));
    render(<ThreadView parent={ONE} child={TWO} visible={false} />);
    await userEvent.click(screen.getByRole('button', { name: url }));
    expect(main.callsOf('browser.tabs.open')).toEqual([{ appSessionId: ONE, url, select: true, reuse: 'url' }]);
  });
  // E4d end

  // P2-E1 start (2026-10-09): "Show in artifact" ("Show in deliverable" until P3-L's cutover) re-docks a thread opened
  // from an artifact element (P2-E1 document, D7). ELEMENT is an anchor stored before the cutover, on E2's scheme.
  describe('Show in artifact', () => {
    const RECORD_ID = '00000000-0000-4000-8000-0000000000e1';
    const ELEMENT: Anchor = { kind: 'artifact-element', locator: '#hero', label: 'Dashboard v1 › h1#hero “Sales overview”', pageUrl: deliverableUrl(A, RECORD_ID, 1) };
    const SHOW = 'Show in artifact';
    beforeEach(() => {
      useCommentCard.setState({ open: null });
      // the Artifacts tool as the panel opens it: its state is what it was asked to show
      registerPanelTool<unknown[], ArtifactsParams>({
        id: ARTIFACTS_TOOL_ID, title: 'Artifacts', icon: () => null, pinnable: true, multiInstance: false,
        createState: (init) => [init.params],
        open: (state, params) => void state.push(params),
        beforeClose: async () => true,
        dispose: () => {},
        render: () => null,
      });
    });
    afterEach(() => useCommentCard.setState({ open: null }));

    it('is offered in the header of a thread on an artifact element whose page names an artifact (E2’s scheme’s too), and of no other', () => {
      withThreads(thread(ONE, '2026-10-06T01:00:00.000Z', { anchor: ELEMENT }));
      const view = render(<ThreadView parent={A} child={ONE} visible />);
      expect(screen.getByRole('button', { name: SHOW })).toBeTruthy();
      view.unmount();
      for (const anchor of [ANCHOR, { ...ELEMENT, pageUrl: 'https://example.com/page.html' }, { ...ELEMENT, pageUrl: undefined }]) {
        withThreads(thread(ONE, '2026-10-06T01:00:00.000Z', { anchor }));
        const other = render(<ThreadView parent={A} child={ONE} visible />);
        expect(screen.queryByRole('button', { name: SHOW })).toBeNull();
        other.unmount();
      }
    });

    it('is hidden while a main tab shows the thread', () => {
      withThreads(thread(ONE, '2026-10-06T01:00:00.000Z', { anchor: ELEMENT }));
      act(() => useLayout.getState().openTab({ kind: 'session', appSessionId: ONE }));
      render(<ThreadView parent={A} child={ONE} visible />);
      expect(screen.getByText('Shown in the main area')).toBeTruthy();
      expect(screen.queryByRole('button', { name: SHOW })).toBeNull();
    });

    it('on a page stored before the cutover, opens the parent’s Artifacts tool on the record’s artifact at its latest version, and a card on the thread for that panel’s viewer to claim', async () => {
      withThreads(thread(ONE, '2026-10-06T01:00:00.000Z', { anchor: ELEMENT }));
      act(() => openSideThread(A, ONE));
      mount();
      await userEvent.click(screen.getByRole('button', { name: SHOW }));
      const tab = panelOf(A)!.tabs.find((t) => t.toolId === ARTIFACTS_TOOL_ID)!;
      expect(panelOf(A)!.activeTabId).toBe(tab.id);
      expect(instanceOf(tab.id)!.state).toEqual([{ target: RECORD_ID }]); // no version: the latest
      expect(useCommentCard.getState().open).toMatchObject({
        parent: A,
        anchor: ELEMENT,
        host: 'artifact-page',
        hostId: null,
        claimMode: 'panel',
        rect: null,
        target: { kind: 'artifact-page', artifactId: RECORD_ID, revision: null, version: 1 },
        phase: { kind: 'thread', child: ONE, echo: null },
      });
    });

    // P3-L (M5b): a thread on an HTML artifact's page (the store's scheme) re-docks into the panel's Artifacts tool
    it('on an artifact store page, opens the parent’s Artifacts tool on the artifact and a card for its viewer to claim', async () => {
      const page: Anchor = { ...ELEMENT, label: 'Dashboard v2 › h1#hero “Sales overview”', pageUrl: artifactUrl(RECORD_ID, 7, 'index.html') };
      withThreads(thread(ONE, '2026-10-06T01:00:00.000Z', { anchor: page }));
      act(() => openSideThread(A, ONE));
      mount();
      await userEvent.click(screen.getByRole('button', { name: SHOW }));
      const tab = panelOf(A)!.tabs.find((t) => t.toolId === ARTIFACTS_TOOL_ID)!;
      expect(panelOf(A)!.activeTabId).toBe(tab.id);
      expect(instanceOf(tab.id)!.state).toEqual([{ target: RECORD_ID }]); // the latest
      expect(useCommentCard.getState().open).toMatchObject({
        parent: A, anchor: page, host: 'artifact-page', hostId: null, claimMode: 'panel',
        target: { kind: 'artifact-page', artifactId: RECORD_ID, revision: 7 }, phase: { kind: 'thread', child: ONE, echo: null },
      });
    });
  });
  // P2-E1 end

  // P2-F L146: "Show in browser" re-docks a page thread into the card under the pane that shows its page
  describe('Show in browser', () => {
    const PAGE = 'http://127.0.0.1:4000/comment.html';
    const ELEMENT: Anchor = { kind: 'browser-element', locator: '#increment', label: 'button “Increment”', pageUrl: PAGE, css: '#increment' };
    const SHOW = 'Show in browser';
    const offs: (() => void)[] = [];
    const withTab = (url: string) => act(() => browser.setState({ sessions: new Map([[A, { tabs: [browserTab(T1, A, { url })], selected: T1 }]]) }));
    beforeEach(() => useCommentCard.setState({ open: null }));
    afterEach(() => {
      offs.splice(0).forEach((off) => off());
      useCommentCard.setState({ open: null });
      resetBrowser();
    });

    it('is offered only while a pane of this window holds a tab on the thread’s page', () => {
      withThreads(thread(ONE, '2026-10-06T01:00:00.000Z', { anchor: ELEMENT }));
      render(<ThreadView parent={A} child={ONE} visible />);
      expect(screen.queryByRole('button', { name: SHOW })).toBeNull(); // no tab
      withTab(PAGE);
      expect(screen.queryByRole('button', { name: SHOW })).toBeNull(); // a tab, but no pane holds its view
      act(() => void offs.push(registerDock(T1, 'pane-1')));
      expect(screen.getByRole('button', { name: SHOW })).toBeTruthy();
      withTab('http://127.0.0.1:4000/other.html');
      expect(screen.queryByRole('button', { name: SHOW })).toBeNull(); // the pane moved to another page
      withTab(PAGE);
      act(() => offs.splice(0).forEach((off) => off()));
      expect(screen.queryByRole('button', { name: SHOW })).toBeNull(); // the pane let the view go
    });

    it('opens the thread’s card for the page’s pane to claim; the Side pane yields it until Show here', async () => {
      withThreads(thread(ONE, '2026-10-06T01:00:00.000Z', { anchor: ELEMENT }));
      withTab(PAGE);
      offs.push(registerDock(T1, 'pane-1'));
      act(() => openSideThread(A, ONE));
      mount();
      expect(sideChildrenShown().get(A)).toBe(ONE);
      await userEvent.click(screen.getByRole('button', { name: SHOW }));
      expect(useCommentCard.getState().open).toMatchObject({
        parent: A, anchor: ELEMENT, host: 'browser', hostId: null, claimMode: null, rect: null,
        target: { kind: 'browser', pageUrl: PAGE }, phase: { kind: 'thread', child: ONE, echo: null },
      });
      expect(sideChildrenShown().get(A), 'the pane stopped drawing the thread, so the page’s pane may claim its card').toBeUndefined();
      expect(screen.getByText('Shown in the card under the page')).toBeTruthy();
      expect(screen.queryByRole('button', { name: SHOW })).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Show here' }));
      expect(useCommentCard.getState().open).toBeNull();
      expect(sideChildrenShown().get(A)).toBe(ONE);
    });

    it('is hidden while a main tab shows the thread', () => {
      withThreads(thread(ONE, '2026-10-06T01:00:00.000Z', { anchor: ELEMENT }));
      withTab(PAGE);
      offs.push(registerDock(T1, 'pane-1'));
      act(() => useLayout.getState().openTab({ kind: 'session', appSessionId: ONE }));
      render(<ThreadView parent={A} child={ONE} visible />);
      expect(screen.queryByRole('button', { name: SHOW })).toBeNull();
    });

    // P2-F S-browser-return (the owner's ruling at P2-F's sitting, A5b.2): Browser was the panel's tool and the Side pane
    // took its place, so no pane holds the page; the Side pane reopens Browser in the panel and re-docks the thread there
    describe('Reopen in browser', () => {
      const REOPEN = 'Reopen in browser';
      let main: ReturnType<typeof installFakeMain>;
      beforeEach(() => {
        registerPanelTool(browserTool);
        main = installFakeMain(() => ok());
        withThreads(thread(ONE, '2026-10-06T01:00:00.000Z', { anchor: ELEMENT }));
      });
      const browserInPanel = () => act(() => void panelHost.addTool(browserTool.id, { appSessionId: A, activate: false }));

      it('is offered while the page is a tab of the parent’s browser held by the panel’s Browser and no pane of this window shows it', () => {
        withTab(PAGE);
        act(() => openSideThread(A, ONE));
        mount();
        expect(screen.queryByRole('button', { name: REOPEN })).toBeNull(); // the panel holds no Browser
        browserInPanel();
        expect(screen.getByRole('button', { name: REOPEN })).toBeTruthy();
        expect(screen.queryByRole('button', { name: SHOW })).toBeNull();
        act(() => void offs.push(registerDock(T1, 'pane-1')));
        expect(screen.queryByRole('button', { name: REOPEN }), 'a pane holds the page: Show in browser instead').toBeNull();
        expect(screen.getByRole('button', { name: SHOW })).toBeTruthy();
        act(() => offs.splice(0).forEach((off) => off()));
        withTab('http://127.0.0.1:4000/other.html');
        expect(screen.queryByRole('button', { name: REOPEN }), 'the page is gone from the browser').toBeNull();
      });

      it('reopens Browser in the panel on the page’s tab and opens the thread’s card for the panel’s pane to claim', async () => {
        withTab(PAGE);
        browserInPanel();
        act(() => openSideThread(A, ONE));
        mount();
        await userEvent.click(screen.getByRole('button', { name: REOPEN }));
        const browserTabRef = panelOf(A)!.tabs.find((t) => t.toolId === browserTool.id)!;
        expect(panelOf(A)!.activeTabId, 'Browser is the panel’s tool again').toBe(browserTabRef.id);
        expect(main.callsOf('browser.tabs.select')).toEqual([{ appSessionId: A, tabId: T1 }]);
        expect(useCommentCard.getState().open).toMatchObject({
          parent: A, anchor: ELEMENT, host: 'browser', hostId: null, claimMode: 'panel', rect: null,
          target: { kind: 'browser', pageUrl: PAGE }, phase: { kind: 'thread', child: ONE, echo: null },
        });
      });

      it('is hidden while a main tab shows the thread', () => {
        withTab(PAGE);
        browserInPanel();
        act(() => useLayout.getState().openTab({ kind: 'session', appSessionId: ONE }));
        render(<ThreadView parent={A} child={ONE} visible />);
        expect(screen.queryByRole('button', { name: REOPEN })).toBeNull();
      });
    });
  });
});

// E3 (M4): the question view (Design §7) and a promoted thread's header (M3's review)
describe('the Side pane’s question view', () => {
  const exchange = (over: Partial<SideExchange>): SideExchange => ({ id: 'op-1', question: 'What word?', state: 'answered', response: 'ZEBRA', synthetic: false, error: null, askedAt: '2026-10-06T10:00:00.000Z', answeredAt: '2026-10-06T10:00:02.000Z', ...over });
  let fake: FakeClient;
  const listing = (exchanges: SideExchange[]) => {
    fake = fakeClient({ 'side.question.list': { exchanges } });
    window.maws = fake.client;
  };
  beforeEach(() => resetSideQuestions());

  it('leads the strip with its chip; choosing it lists the host’s log, an answer, a substituted one with its notice, a pending and a failed one', async () => {
    withThreads(thread(ONE, '2026-10-06T01:00:00.000Z'));
    listing([
      exchange({}),
      exchange({ id: 'op-2', question: 'Why?', response: 'I can only answer from the conversation.', synthetic: true }),
      exchange({ id: 'op-3', question: 'And?', state: 'pending', response: null, answeredAt: null }),
      exchange({ id: 'op-4', question: 'Again?', state: 'failed', response: null, error: 'Side question cancelled' }),
    ]);
    mount();
    const chips = [...document.querySelectorAll('[data-side-chip]')];
    expect(chips.map((chip) => chip.getAttribute('data-side-chip'))).toEqual(['btw', ONE]);
    await userEvent.click(chips[0] as HTMLElement);
    expect(sidePaneOf(useSidePane.getState(), A).view).toEqual({ kind: 'btw' });
    await screen.findByText('ZEBRA');
    expect(fake.invoked('side.question.list')).toEqual([{ appSessionId: A }]);
    expect([...document.querySelectorAll('[data-side-exchange]')].map((el) => el.getAttribute('data-side-exchange'))).toEqual(['answered', 'answered', 'pending', 'failed']);
    expect(document.querySelectorAll('[data-side-synthetic]')).toHaveLength(1);
    expect(screen.getByText('The engine substituted this answer')).toBeTruthy();
    expect(screen.getByText('Answering…')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Side question cancelled');
  });

  // P2-A (2026-10-09; the execution document §5.6): Ask and Retry on an exited session start it (side), then ask
  it('on an exited session, Ask starts the session first and then asks once; nothing is acquired by opening the view', async () => {
    listing([exchange({})]);
    useSessions.setState({ engine: new Map([[A, status(A, { process: 'exited' } as never)]]) });
    act(() => setSideView(A, { kind: 'btw' }));
    mount();
    await screen.findByText('ZEBRA');
    expect(fake.invoked('session.acquire')).toEqual([]);
    expect(screen.getByText('Starts this session')).toBeTruthy();
    await userEvent.type(screen.getByRole('textbox', { name: 'Ask a side question' }), 'More?{Enter}');
    expect(fake.invoked('session.acquire')).toEqual([{ appSessionId: A, reason: 'side' }]);
    expect(screen.getByText('Starting…')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Ask' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fake.invoked('session.sideQuestion')).toEqual([]);
    await act(() => fake.reply('session.acquire', { status: 'ready', appSessionId: A, launched: true, joined: false }));
    expect(fake.invoked('session.sideQuestion')).toEqual([{ appSessionId: A, question: 'More?' }]);
    expect((screen.getByRole('textbox', { name: 'Ask a side question' }) as HTMLTextAreaElement).value).toBe('');
    expect(fake.invoked('session.acquire')).toHaveLength(1);
  });

  it('on an exited session, Retry starts it first; a refused start says why and asks nothing, the question kept', async () => {
    listing([exchange({ id: 'op-2', state: 'failed', response: null, error: 'The session ended' })]);
    useSessions.setState({ engine: new Map([[A, status(A, { process: 'exited' } as never)]]) });
    act(() => setSideView(A, { kind: 'btw' }));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(fake.invoked('session.acquire')).toEqual([{ appSessionId: A, reason: 'side' }]);
    await act(() => fake.reply('session.acquire', { status: 'ready', appSessionId: A, launched: true, joined: false }));
    expect(fake.invoked('session.sideQuestion')).toEqual([{ appSessionId: A, question: 'What word?', retryOf: 'op-2' }]);
    await userEvent.type(screen.getByRole('textbox', { name: 'Ask a side question' }), 'Again?{Enter}');
    await act(() => fake.reply('session.acquire', { status: 'missing_directory', appSessionId: A, directory: '/gone' }));
    expect(screen.getByText('Directory not found: /gone')).toBeTruthy();
    expect(fake.invoked('session.sideQuestion')).toHaveLength(1);
    expect((screen.getByRole('textbox', { name: 'Ask a side question' }) as HTMLTextAreaElement).value).toBe('Again?');
  });

  it('a session a terminal holds: Ask and Retry are disabled with the holder named; continuing as a thread stays possible', async () => {
    listing([exchange({}), exchange({ id: 'op-2', state: 'failed', response: null, error: 'The session ended' })]);
    useSessions.setState((s) => ({ records: new Map(s.records).set(A, { ...record(A), holder: { kind: 'terminal', pid: 42 } }), digests: new Map([[A, digest(A, { availability: 'foreign_held' })]]) }));
    act(() => setSideView(A, { kind: 'btw' }));
    mount();
    await screen.findByText('ZEBRA');
    expect(screen.getByText('Held by terminal · 42')).toBeTruthy();
    await userEvent.type(screen.getByRole('textbox', { name: 'Ask a side question' }), 'More?');
    expect((screen.getByRole('button', { name: 'Ask' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Continue as a side thread' }) as HTMLButtonElement).disabled).toBe(false);
    expect(fake.invoked('session.acquire')).toEqual([]);
  });

  it('with a ready process, Enter asks the field’s question; with nothing answered, continuing is disabled', async () => {
    listing([]);
    useSessions.setState({ engine: new Map([[A, status(A, { process: 'ready' } as never)]]) });
    act(() => setSideView(A, { kind: 'btw' }));
    mount();
    await screen.findByText(/Ask about the conversation without adding to it/);
    expect((screen.getByRole('button', { name: 'Continue as a side thread' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByRole('textbox', { name: 'Ask a side question' }), 'What word?{Enter}');
    expect(fake.invoked('session.sideQuestion')).toEqual([{ appSessionId: A, question: 'What word?' }]);
    expect((screen.getByRole('textbox', { name: 'Ask a side question' }) as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByText('What word?')).toBeTruthy(); // pending at once
  });

  // the architect's ruling (b): a thread's own side questions answer under its thread view, in the pane hosting it
  it('a thread’s side questions show under its thread view; the header’s toggle hides and shows them', async () => {
    withThreads(thread(ONE, '2026-10-06T01:00:00.000Z'));
    listing([exchange({})]);
    act(() => openSideThread(A, ONE));
    mount();
    expect(screen.queryByRole('button', { name: '/btw side questions' })).toBeNull(); // none asked, none open
    act(() => setInlineQuestions(ONE, true));
    await screen.findByText('ZEBRA');
    expect(document.querySelector(`[data-side-thread-view="${ONE}"] [data-side-btw-view="${ONE}"]`)).not.toBeNull();
    expect(fake.invoked('side.question.list')).toEqual([{ appSessionId: ONE }]);
    expect(shown()).toBe(A); // the main view stays
    const toggle = screen.getByRole('button', { name: '/btw side questions' }); // scale-review C scalpel-5#4: the name holds the visible "/btw"
    expect(toggle.textContent).toBe('/btw');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(toggle);
    expect(document.querySelector(`[data-side-btw-view="${ONE}"]`)).toBeNull();
    expect(screen.getByRole('button', { name: '/btw side questions' }).getAttribute('aria-pressed')).toBe('false'); // still offered: it has exchanges
    await userEvent.click(screen.getByRole('button', { name: '/btw side questions' }));
    expect(document.querySelector(`[data-side-btw-view="${ONE}"]`)).not.toBeNull();
  });

  it('a promoted thread’s header shows its opening question, read from the thread’s first prompt', () => {
    const b = builder();
    b.turn('u0', 'The parent’s copied history');
    b.end(['u0']);
    b.emit('turn.started', { userMessageUuid: uuid('u1'), origin: 'human' });
    b.emit('user.message', { messageUuid: uuid('u1'), content: promotionMessage([{ question: 'Why is this null-checked twice?', response: 'Defensive.' }, { question: 'Second?', response: 'Yes.' }], null), isReplay: false, isSynthetic: false, origin: 'human', bash: null });
    const rows = rowsOf(applyEvents(createState(null, null), b.events));
    expect(promotionQuestionOf(rows)).toBe('Why is this null-checked twice?');
    expect(promotionQuestionOf(rowsOf(applyEvents(createState(null, null), b.events.slice(0, 3))))).toBeNull();
  });

  // E11 (W-C): the header through the transcript-store selector, not only the pure reader
  it('renders a promoted thread’s header from its own transcript’s rows, and none for a thread a comment opened', () => {
    const b = builder();
    b.emit('turn.started', { userMessageUuid: uuid('u1'), origin: 'human' });
    b.emit('user.message', { messageUuid: uuid('u1'), content: promotionMessage([{ question: 'Why is this null-checked twice?', response: 'Defensive.' }], null), isReplay: false, isSynthetic: false, origin: 'human', bash: null });
    const btw: Anchor = { kind: 'none', locator: 'btw', label: 'Side question' };
    withThreads(thread(ONE, '2026-10-06T01:00:00.000Z', { openedBy: 'btw', anchor: btw }), thread(TWO, '2026-10-06T02:00:00.000Z'));
    const rows = rowsOf(applyEvents(createState(null, null), b.events));
    act(() => useTranscriptStore.setState({ entries: { [ONE]: { rows: [] } as never, [TWO]: { rows } as never } }));
    try {
      const view = render(<ThreadView parent={A} child={ONE} visible={false} />);
      expect(document.querySelector('[data-side-question]')).toBeNull(); // no rows read yet
      act(() => useTranscriptStore.setState((s) => ({ entries: { ...s.entries, [ONE]: { rows } as never } })));
      const header = document.querySelector<HTMLElement>(`[data-side-thread-view="${ONE}"] [data-side-question]`);
      expect(header?.textContent).toBe('Why is this null-checked twice?');
      expect(header?.title).toBe('Why is this null-checked twice?');
      view.unmount();
      render(<ThreadView parent={A} child={TWO} visible={false} />); // the same prompt in a thread a comment opened
      expect(document.querySelector('[data-side-question]')).toBeNull();
    } finally {
      useTranscriptStore.setState({ entries: {} });
    }
  });

  it('a thread promoted inside a promoted thread names its own question, the last promotion prompt, after a disk read', () => {
    const b = builder();
    b.emit('turn.started', { userMessageUuid: uuid('u1'), origin: 'human' });
    b.emit('user.message', { messageUuid: uuid('u1'), content: promotionMessage([{ question: 'The outer question?', response: 'Outer.' }], null), isReplay: false, isSynthetic: false, origin: 'human', bash: null });
    b.end(['u1']);
    b.emit('turn.started', { userMessageUuid: uuid('u2'), origin: 'human' });
    b.emit('user.message', { messageUuid: uuid('u2'), content: promotionMessage([{ question: 'The inner question?', response: 'Inner.' }], null), isReplay: false, isSynthetic: false, origin: 'human', bash: null });
    expect(promotionQuestionOf(rowsOf(applyEvents(createState(null, null), b.events)))).toBe('The inner question?');
  });
});
