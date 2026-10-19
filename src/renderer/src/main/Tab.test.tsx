// P3-F wave S (F16, obs 7a): an artifact main tab's context menu moves the artifact into the panel ("Show in panel"),
// the mirror of the panel record's "Open in tab": the tab closes through its close guard, then the Artifacts tool shows
// the artifact in the panel the person sees once the tab is gone (the session the focused pane then shows, else the
// pinned Artifacts tab every panel lists). With neither, the item is disabled and says why.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_TAB_SET, LAYOUT_DEFAULTS, NO_PROJECT, tabId, type LayoutMain, type TabRef } from '@shared/ipc/schema/layout';
import { resetSlots } from '../app/slots';
import { registerEditorHost } from '../panel/editor-host';
import { instanceOf, panelHost, registerPanelTool } from '../panel/host';
import { useLayout } from '../stores/layout';
import { allTabs } from '../stores/layout-model';
import { fail, installFakeMain, ok } from '../test-support/code';
import { A, panelOf, resetPanelStores, sessionTab } from '../test-support/panel';
import { ARTIFACTS_TOOL_ID, artifactsTool, type ArtifactsHandle } from '../tools/artifacts/ArtifactsTool';
import { MainArea } from './MainArea';
import { SHOW_IN_PANEL_COPY } from './Tab';

const DECK = 'deck-1';
const ARTIFACT: TabRef = { id: tabId({ kind: 'artifact', artifactId: DECK }), kind: 'artifact', artifactId: DECK, pinned: false };
const offs: (() => void)[] = [];

const showing = (...tabs: TabRef[]): LayoutMain => ({ ...LAYOUT_DEFAULTS.main, sets: { [NO_PROJECT]: { ...EMPTY_TAB_SET, panes: [{ tabs, activeTabId: ARTIFACT.id }] } } });
const artifactTabOpen = () => allTabs(useLayout.getState().main).some((t) => t.id === ARTIFACT.id);
const viewOf = (id: string | undefined) => (id ? (instanceOf(id)?.state as ArtifactsHandle | undefined)?.snapshot().view : undefined);

async function menuItem(): Promise<HTMLElement> {
  fireEvent.contextMenu(document.querySelector<HTMLElement>(`[data-tab-id="${ARTIFACT.id}"]`)!);
  const menu = await screen.findByRole('menu');
  return within(menu).getByRole('menuitem', { name: SHOW_IN_PANEL_COPY.label });
}

beforeEach(() => {
  resetPanelStores();
  installFakeMain((name) => {
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

  it('with no session to show it beside, shows it in the pinned Artifacts tab', async () => {
    let pinned = '';
    act(() => void (pinned = panelHost.addTool(ARTIFACTS_TOOL_ID, { appSessionId: null, pin: true })));
    useLayout.setState({ main: showing(ARTIFACT) });
    render(<MainArea />);
    fireEvent.click(await menuItem());
    await waitFor(() => expect(artifactTabOpen()).toBe(false));
    expect(viewOf(pinned)).toEqual({ kind: 'record', artifactId: DECK });
  });

  it('with no session to show it beside and no pinned Artifacts tab, is disabled and says why', async () => {
    useLayout.setState({ main: showing(ARTIFACT) });
    render(<MainArea />);
    const item = await menuItem();
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.getAttribute('title')).toBe(SHOW_IN_PANEL_COPY.noPanel);
    fireEvent.click(item);
    await act(async () => {});
    expect(artifactTabOpen()).toBe(true);
    expect(useLayout.getState().panelBySession.size).toBe(0);
  });

  it('a tab its editor’s closeGuard keeps stays, and nothing opens in the panel', async () => {
    useLayout.setState({ main: showing(sessionTab(A), ARTIFACT) });
    act(() => void registerEditorHost({ surface: 'main', tabId: ARTIFACT.id }, { title: 'Deck', closeGuard: async () => false }));
    render(<MainArea />);
    fireEvent.click(await menuItem());
    await act(async () => {});
    expect(artifactTabOpen()).toBe(true);
    expect(panelOf(A)).toBeUndefined();
  });

  it('is offered on artifact tabs only', async () => {
    useLayout.setState({ main: showing(sessionTab(A), ARTIFACT) });
    render(<MainArea />);
    fireEvent.contextMenu(document.querySelector<HTMLElement>(`[data-tab-id="${sessionTab(A).id}"]`)!);
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: SHOW_IN_PANEL_COPY.label })).toBeNull();
  });
});
