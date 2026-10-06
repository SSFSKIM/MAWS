// E3 (M3): the Side pane (E3 execution document, Design §6, M3's proofs): one tab per session, re-targeted by `open`;
// the panel rule (a thread opened while its parent is not shown is added without activation and a toast says where);
// the chip strip of the session's threads, newest first; the thread view yielding to a main tab of the same thread
// and publishing the child it draws for the unread rule.
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Anchor } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import type { Lineage, SessionRecord } from '@shared/graph/session';
import { record } from '../../../../test/support/builders';
import { instanceOf, panelHost } from '../panel/host';
import type { PanelToolContext } from '../panel/tool';
import { useLayout } from '../stores/layout';
import { activeTab, sessionOfTab } from '../stores/layout-model';
import { useNotices } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { A, B, panelOf, resetPanelStores } from '../test-support/panel';
import { openSideThread, revealNewThread, SIDE_TOOL_ID } from './actions';
import { registerSidePane } from './register';
import { sideChildrenShown, sidePaneOf, useSidePane } from './store';
import { sideThreadsOf, sideTool } from './SideTool';

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
  return { appSessionId: A, session: record(A), status: null, pinned: false, visible: true, focusRequest: 0, setTitle: () => {}, close: () => {}, openTool: panelHost.addTool, ...over };
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
    const chips = [...document.querySelectorAll('[data-side-chip]')];
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
});
