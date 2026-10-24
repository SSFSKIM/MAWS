// P3-F wave S (F16, obs 7a): an artifact main tab's context menu moves the artifact into the panel ("Show in panel"),
// the mirror of the panel record's "Move to tab": the tab closes, then the Artifacts tool shows the artifact in the panel
// beside the most recently active chat in the loaded artifact's project (an unprojected artifact uses its tab set).
// Without an open project chat, the item is disabled and says why, even with a pinned Artifacts tab. P4-B3: through
// the transfer's move (shell/transfer.ts),
// which carries the editor's state, so the tab's own guard is not asked.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { SHOW_IN_PANEL_COPY } from './Tab';

const DECK = '00000000-0000-4000-8000-000000000001';
const ARTIFACT: TabRef = { id: tabId({ kind: 'artifact', artifactId: DECK }), kind: 'artifact', artifactId: DECK, pinned: false };
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
    expect(viewOf(own?.tabs[0]?.id)).toEqual({ kind: 'record', artifactId: DECK });
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
    expect(viewOf(panelOf(A)?.tabs[0]?.id)).toEqual({ kind: 'record', artifactId: DECK });
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
      act(() => void (dest = panelHost.addTool(ARTIFACTS_TOOL_ID, { appSessionId: A, params: { target: 'other-1' }, activate: false })));
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
      expect(viewOf(dest)).toEqual({ kind: 'record', artifactId: 'other-1' });
      expect(asks).toBe(1);
    });

    it('its guard letting go is asked once, and the artifact lands', async () => {
      allow = true;
      render(<MainArea />);
      fireEvent.click(await menuItem());
      await waitFor(() => expect(artifactTabOpen()).toBe(false));
      expect(viewOf(dest)).toEqual({ kind: 'record', artifactId: DECK });
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
