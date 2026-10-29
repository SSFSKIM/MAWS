// P3-F wave S (F16, obs 7a): an artifact main tab's context menu moves the artifact into the panel ("Show in panel"),
// the mirror of the panel record's "Move to tab": the tab closes, then the Artifacts tool shows the artifact in the panel
// beside the most recently active chat in the loaded artifact's project (an unprojected artifact uses its tab set).
// Without an open project chat, the item is disabled and says why, even with a pinned Artifacts tab. P4-B3: through
// the transfer's move (shell/transfer.ts),
// which carries the editor's state, so the tab's own guard is not asked.
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_MACHINE } from '../../../../test/support/machine';
import { EMPTY_TAB_SET, LAYOUT_DEFAULTS, NO_PROJECT, tabId, type LayoutMain, type TabRef } from '@shared/ipc/schema/layout';
import { resetSlots } from '../app/slots';
import type { LibraryRow } from '@shared/ipc/schema/library';
import { library, libraryRow, resetLibrary } from '../library/store';
import { TRANSFER_COPY } from '../tools/artifacts/copy';
import { registerEditorHost } from '../panel/editor-host';
import { instanceOf, panelHost, registerPanelTool } from '../panel/host';
import { useLayout } from '../stores/layout';
import { allTabs } from '../stores/layout-model';
import { fail, installFakeMain, ok } from '../test-support/code';
import { A, panelOf, resetPanelStores, sessionTab } from '../test-support/panel';
import { ARTIFACTS_TOOL_ID, artifactsTool, type ArtifactsHandle } from '../tools/artifacts/ArtifactsTool';
import { MainArea } from './MainArea';
import { SHOW_IN_PANEL_COPY, Tab, useTabLabel } from './Tab';
import type { SessionRecord } from '@shared/graph/session';
import { record } from '../../../../test/support/builders';
import { laneAState } from '../lane-a/test-support/lane-a-state'; // P5 O9
import { applyLaneAState, resetLaneAStore } from '../stores/lane-a'; // P5 O9
import { useSessions } from '../stores/sessions';
import { addressOf } from '@shared/machine/address';
import type { AppSessionId } from '@shared/graph/ids';
import { OTHER_MACHINE } from '../../../../test/support/machine';

const DECK = '00000000-0000-4000-8000-000000000001';
const ARTIFACT: TabRef = { id: tabId({ kind: 'artifact', artifactId: DECK, machine: TEST_MACHINE }), kind: 'artifact', artifactId: DECK, machine: TEST_MACHINE, pinned: false };
const offs: (() => void)[] = [];
const metadata: LibraryRow = { id: DECK, kind: 'presentation', title: 'Launch deck', createdBy: { kind: 'human' }, createdAt: 0, updatedAt: 0, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 0, sessions: [] };

const showing = (...tabs: TabRef[]): LayoutMain => ({ ...LAYOUT_DEFAULTS.main, sets: { [NO_PROJECT]: { ...EMPTY_TAB_SET, panes: [{ tabs, activeTabId: ARTIFACT.id }] } } });
const artifactTabOpen = () => allTabs(useLayout.getState().main).some((t) => t.id === ARTIFACT.id);
const viewOf = (id: string | undefined) => (id ? (instanceOf(id)?.state as ArtifactsHandle | undefined)?.snapshot().view : undefined);

async function menuItem(): Promise<HTMLElement> {
  await waitFor(() => expect(libraryRow(library.getState(), DECK).value).toEqual(metadata));
  fireEvent.contextMenu(document.querySelector<HTMLElement>(`[data-tab-id="${ARTIFACT.id}"]`)!);
  const menu = await screen.findByRole('menu');
  return within(menu).getByRole('menuitem', { name: SHOW_IN_PANEL_COPY.label });
}

beforeEach(() => {
  resetPanelStores();
  resetLibrary();
  installFakeMain((name) => {
    if (name === 'library.get') return ok({ row: metadata });
    if (name === 'library.list') return ok({ rows: [], counts: {} });
    if (name === 'layout.get') return ok({ value: null });
    if (name === 'layout.set' || name === 'artifacts.markViewed') return ok();
    return fail(`not answered here: ${name}`);
  });
  offs.push(registerPanelTool(artifactsTool));
});
afterEach(() => {
  cleanup();
  resetSlots();
  offs.splice(0).forEach((off) => off());
});

describe('Show in panel on an artifact tab', () => {
  it('moves the artifact into the panel of the session the pane shows next: the tab closes, the record shows', async () => {
    useLayout.setState({ main: showing(sessionTab(A), ARTIFACT) });
    render(<MainArea />);
    fireEvent.click(await menuItem());
    await waitFor(() => expect(artifactTabOpen()).toBe(false));
    const own = panelOf(A);
    expect(own?.tabs.map((t) => t.toolId)).toEqual([ARTIFACTS_TOOL_ID]);
    expect(own?.activeTabId).toBe(own?.tabs[0]?.id);
    expect(viewOf(own?.tabs[0]?.id)).toEqual({ kind: 'record', artifactId: DECK, machine: TEST_MACHINE });
  });

  it('with no project session, stays disabled even with a pinned Artifacts tab', async () => {
    let pinned = '';
    act(() => void (pinned = panelHost.addTool(ARTIFACTS_TOOL_ID, { appSessionId: null, pin: true })));
    useLayout.setState({ main: showing(ARTIFACT) });
    render(<MainArea />);
    const item = await menuItem();
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.getAttribute('title')).toBe(TRANSFER_COPY.noProjectSession);
    fireEvent.click(item);
    await act(async () => {});
    expect(artifactTabOpen()).toBe(true);
    expect(viewOf(pinned)).toEqual({ kind: 'list' });
  });

  it('with no session to show it beside and no pinned Artifacts tab, is disabled and says why', async () => {
    useLayout.setState({ main: showing(ARTIFACT) });
    render(<MainArea />);
    const item = await menuItem();
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.getAttribute('title')).toBe(TRANSFER_COPY.noProjectSession);
    fireEvent.click(item);
    await act(async () => {});
    expect(artifactTabOpen()).toBe(true);
    expect(useLayout.getState().panelBySession.size).toBe(0);
  });

  // P4-B3 (its Decision Log 19): the editor's state goes with the artifact (the transfer's hand-off), so nothing can be
  // lost and the tab's own guard is not asked.
  it('moves without asking the tab’s own guard', async () => {
    useLayout.setState({ main: showing(sessionTab(A), ARTIFACT) });
    const closeGuard = vi.fn(async () => false);
    act(() => void registerEditorHost({ surface: 'main', tabId: ARTIFACT.id }, { title: 'Deck', closeGuard }));
    render(<MainArea />);
    fireEvent.click(await menuItem());
    await waitFor(() => expect(artifactTabOpen()).toBe(false));
    expect(closeGuard).not.toHaveBeenCalled();
    expect(viewOf(panelOf(A)?.tabs[0]?.id)).toEqual({ kind: 'record', artifactId: DECK, machine: TEST_MACHINE });
  });

  // P3-F wave S (F16 review): the Artifacts tab the artifact lands in may show another one, whose guard can keep it. That
  // guard is asked before the tab lets go, once, so a refusal leaves the artifact where it was, never nowhere.
  describe('when the panel’s Artifacts tab shows another artifact', () => {
    let asks = 0;
    let allow = false;
    let dest = '';
    beforeEach(() => {
      asks = 0;
      useLayout.setState({ main: showing(sessionTab(A), ARTIFACT) });
      act(() => void (dest = panelHost.addTool(ARTIFACTS_TOOL_ID, { appSessionId: A, params: { target: 'other-1', machine: TEST_MACHINE }, activate: false })));
      const closeGuard = async () => {
        asks += 1;
        return allow;
      };
      act(() => void registerEditorHost({ surface: 'panel', tabId: dest }, { title: 'Other', closeGuard }));
    });

    it('its guard keeping it leaves the main tab open and that record in place', async () => {
      allow = false;
      render(<MainArea />);
      fireEvent.click(await menuItem());
      await act(async () => {});
      expect(artifactTabOpen()).toBe(true);
      expect(viewOf(dest)).toEqual({ kind: 'record', artifactId: 'other-1', machine: TEST_MACHINE });
      expect(asks).toBe(1);
    });

    it('its guard letting go is asked once, and the artifact lands', async () => {
      allow = true;
      render(<MainArea />);
      fireEvent.click(await menuItem());
      await waitFor(() => expect(artifactTabOpen()).toBe(false));
      expect(viewOf(dest)).toEqual({ kind: 'record', artifactId: DECK, machine: TEST_MACHINE });
      expect(asks).toBe(1);
    });
  });

  it('is offered on artifact tabs only', async () => {
    useLayout.setState({ main: showing(sessionTab(A), ARTIFACT) });
    render(<MainArea />);
    fireEvent.contextMenu(document.querySelector<HTMLElement>(`[data-tab-id="${sessionTab(A).id}"]`)!);
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: SHOW_IN_PANEL_COPY.label })).toBeNull();
  });
});

// P5 O6 M2 (M6's scene): a session tab whose record the page does not hold (another machine not loaded in this run) is
// titled by the title the tab last knew, not "New chat".
describe('a session tab’s label without its record', () => {
  it('is the tab’s last-known title', () => {
    const onB = addressOf(OTHER_MACHINE, 'b-session' as AppSessionId);
    const { result } = renderHook(() => useTabLabel({ id: `session:${onB}`, kind: 'session', appSessionId: onB, pinned: false, title: 'B’s shared session' }));
    expect(result.current.title).toBe('B’s shared session');
  });
});

// P5 O9 (the owner's Q1): a session a terminal or a `--bg` job holds and MAWS drives through its bridge reads like any
// MAWS session, with a small marker in its pane's tab naming where it runs, the hover card's line as its title; only
// while the session's controls port is lane A.
describe('a session tab driven through its holder’s bridge', () => {
  const tab = sessionTab(A);
  const holding = (holder: SessionRecord['holder']) => act(() => useSessions.setState({ records: new Map([[A, record(A, { title: { text: 'Fix drag', source: 'user' }, holder })]]) }));
  const marker = () => document.querySelector<HTMLElement>(`[data-tab-id="${tab.id}"] [data-holder-marker]`);
  afterEach(() => resetLaneAStore());

  it('marks a bridged terminal session Terminal, titled with the hover card’s line, and nothing else', () => {
    holding({ kind: 'self' });
    render(<Tab tab={tab} pane={0} domId="t-0" active stop onKeyDown={() => {}} />);
    expect(marker()).toBeNull(); // MAWS's own
    holding({ kind: 'terminal', pid: 4242 });
    expect(marker()).toBeNull(); // read-only: no bridge drives it
    act(() => applyLaneAState(A, laneAState(A, { bridge: 'starting', reason: 'the session’s bridge is starting' })));
    expect(marker()).toBeNull(); // no port yet
    act(() => applyLaneAState(A, laneAState(A)));
    expect(marker()?.textContent).toBe('Terminal');
    expect(marker()?.title).toBe('Running in Terminal · driven through sminos’s bridge');
    act(() => applyLaneAState(A, null));
    expect(marker()).toBeNull();
  });

  it('marks a bridged background job’s session Background job', () => {
    holding({ kind: 'background_job', pid: null, jobId: 'job-1' });
    act(() => applyLaneAState(A, laneAState(A)));
    render(<Tab tab={tab} pane={0} domId="t-0" active stop onKeyDown={() => {}} />);
    expect(marker()?.textContent).toBe('Background job');
    expect(marker()?.title).toBe('Running as bg · job-1 · driven through sminos’s bridge');
  });
});
