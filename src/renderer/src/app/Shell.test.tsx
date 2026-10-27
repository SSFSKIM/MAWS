import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../ipc/query';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { EMPTY_TAB_SET, LAYOUT_DEFAULTS, NO_PROJECT, type LayoutMain, type TabRef } from '@shared/ipc/schema/layout';
import { record } from '../../../../test/support/builders';
import { registerCloseGuard, registerAction, runAction } from '../keymap/actions-runtime';
import type { PanelHostProps } from '../panel/host-slot';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { useSettings } from '../stores/settings';
import { registerShellActions } from './shell-actions';
import { fakeClient } from '../../../../test/support/fake-client';
import { connectQuitWait } from '../lifecycle/quit-wait';
import { connectAttention } from '../attention/navigation';
import { useNotices } from '../stores/notices';
import { connectKeys } from '../keymap/dispatcher';
import { Sheet } from '../sessions/Sheet';
import { SessionDialogs } from '../sessions/SessionDialogs';
import { beforeCloseUnstarted } from '../sessions/setup-actions';
import { closeDialog } from '../sessions/dialogs';
import { ID, intent, putIntent, resetSetupStore } from '../test-support/setup-intents';
import { useState } from 'react';
import { Library } from '../library/Library';
import { resetLibrary } from '../library/store';
import { Shell } from './Shell';
import { registerSlot, resetSlots } from './slots';
import { toolbarTitle } from './Toolbar';
import { fillStores, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { probeTool, ref, resetPanelStores } from '../test-support/panel';
import { registerPanelTool } from '../panel/host';
import { PanelHost } from '../panel/PanelHost';
import { SETTINGS_DEFAULTS_V19 } from '@shared/settings/defaults';

vi.mock('./Diagnostics', () => ({ Diagnostics: () => <section aria-label="Diagnostics">diagnostics</section> }));

const A = 'app-a' as AppSessionId;
const sessionTab = (id: string): TabRef => ({ id: `session:${id}`, kind: 'session', appSessionId: id as AppSessionId, pinned: false });
const withActive = (tab: TabRef): LayoutMain => ({ ...LAYOUT_DEFAULTS.main, sets: { [NO_PROJECT]: { ...EMPTY_TAB_SET, panes: [{ tabs: [tab], activeTabId: tab.id }] } } });

const region = (name: string) => document.querySelector<HTMLElement>(`[data-region="${name}"]`)!;
const grid = () => region('main').parentElement!;
const offs: (() => void)[] = [];
const chromeTabs = () => screen.getByRole('banner').querySelector<HTMLElement>('[data-chrome-tabs]')!;
const renderShell = () => render(<QueryClientProvider client={queryClient}><Shell /></QueryClientProvider>);
// Geometry and maximize checks need a selected surface; an empty panel reserves no space.
function openSurface(toolId = 'terminal') {
  offs.push(registerPanelTool(probeTool(toolId).tool));
  registerSlot('panelHost', PanelHost);
  useSessions.setState({ records: new Map([[A, record('app-a')]]) });
  useLayout.setState({ main: withActive(sessionTab(A)), panelBySession: new Map([[A, { tabs: [ref(`${toolId}:aaaaaaaa`)], activeTabId: `${toolId}:aaaaaaaa` }]]) });
}

// happy-dom's window, resized as a person resizes the app's (it dispatches `resize`).
const setWindowWidth = (width: number) => (window as unknown as { happyDOM: { setWindowSize(size: { width: number }): void } }).happyDOM.setWindowSize({ width });

beforeEach(() => {
  useNotices.setState({ notices: [] });
  setWindowWidth(1440); // the app window's default size
  resetPanelStores();
  resetShellStores();
});
afterEach(() => {
  cleanup();
  resetSlots();
  offs.splice(0).forEach((off) => off());
});

describe('shell frame', () => {
  it('renders one chrome row and only the sidebar resizer until a surface opens', () => {
    renderShell();
    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(['sidebar', 'main', 'panel'].map((name) => region(name).dataset.region)).toEqual(['sidebar', 'main', 'panel']);
    expect(region('panel').inert).toBe(true);
    expect(screen.getAllByRole('separator').map((s) => [s.getAttribute('aria-controls'), s.getAttribute('aria-valuenow')])).toEqual([[region('sidebar').id, '240']]);
    expect(within(chromeTabs()).getByRole('tablist', { name: 'Open tabs' })).toBeTruthy();
    expect(within(region('main')).queryByRole('tablist')).toBeNull();
  });

  it('keeps destinations compact and title-bar navigation reachable when the sidebar is collapsed', () => {
    fillStores(scenarioFile('empty'));
    renderShell();
    const toolbar = screen.getByRole('banner');
    expect(within(toolbar).queryByText('MAWS')).toBeNull();
    expect(within(region('sidebar')).queryByText('MAWS')).toBeNull();
    const destinations = within(region('sidebar')).getByRole('navigation', { name: 'App destinations' });
    expect(within(destinations).getByRole('searchbox')).toBeTruthy();
    expect(within(destinations).getAllByRole('button').map((button) => button.textContent?.replace('⌘N', '').trim())).toEqual(['New chat', 'Projects', 'Artifacts', 'Customize']);
    act(() => useLayout.getState().setSidebar({ collapsed: true }));
    expect(region('sidebar').inert).toBe(true);
    for (const name of ['Toggle sidebar', 'Overview']) {
      const control = within(toolbar).getByRole('button', { name });
      expect(control.closest('[inert]')).toBeNull();
      expect(control.className).toContain('[-webkit-app-region:no-drag]');
    }
  });

  it('puts the Overview toggle beside the sidebar toggle in the title-bar toolbar', async () => {
    const user = userEvent.setup();
    renderShell();
    const toolbar = screen.getByRole('banner');
    const toggle = within(toolbar).getByRole('button', { name: 'Overview' });
    const sidebar = within(toolbar).getByRole('button', { name: 'Toggle sidebar' });
    expect(sidebar.nextElementSibling).toBe(toggle);
    expect(toggle.className).toContain('[-webkit-app-region:no-drag]');
    expect(toggle.getAttribute('title')).toBe('Overview · ⌘0');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('dialog', { name: 'Overview' })).toBeNull();
    await user.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(within(region('main')).getByRole('dialog', { name: 'Overview' })).toBeTruthy();
    await user.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('dialog', { name: 'Overview' })).toBeNull();
  });

  it('the toolbar Overview toggle restores main from a maximized panel and still closes on a second click', async () => {
    const user = userEvent.setup();
    offs.push(registerShellActions(fakeBridge()));
    openSurface('review');
    useLayout.getState().setPanel({ width: 444 });
    renderShell();
    await user.click(screen.getByRole('button', { name: 'Expand surface' }));
    expect(region('main').inert).toBe(true);
    expect(grid().style.gridTemplateColumns).toBe('240px 0px minmax(0, 1fr)');
    const toggle = within(screen.getByRole('banner')).getByRole('button', { name: 'Overview' });
    expect((toggle as HTMLButtonElement).disabled).toBe(false);
    await user.click(toggle);
    expect(region('main').inert).toBe(false);
    expect(grid().style.gridTemplateColumns).toBe('240px minmax(0, 1fr) 444px');
    const dialog = within(region('main')).getByRole('dialog', { name: 'Overview' });
    expect(document.activeElement).toBe(dialog);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(useLayout.getState().regions.panel).toEqual({ width: 444, collapsed: false, maximized: false, floating: false });
    await user.click(toggle);
    expect(screen.queryByRole('dialog', { name: 'Overview' })).toBeNull();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(region('main').inert).toBe(false);
  });

  it('mounts the usage slot in the sidebar footer, not in the chrome row', () => {
    registerSlot('topBarEnd', () => <button type="button">Usage</button>);
    renderShell();
    const toolbar = screen.getByRole('banner');
    expect(within(toolbar).queryByRole('button', { name: 'Usage' })).toBeNull();
    const usage = within(region('sidebar')).getByRole('button', { name: 'Usage' });
    expect(usage.closest('footer')).toBeTruthy();
    expect(usage.closest('[data-sidebar-usage]')!.nextElementSibling).toBe(within(region('sidebar')).getByRole('button', { name: 'Workspace settings' }));
    expect(within(toolbar).getByRole('toolbar', { name: 'Session surfaces' })).toBeTruthy();
  });

  it('uses remembered widths only for open regions, leaving no empty panel column', () => {
    renderShell();
    expect(grid().style.gridTemplateColumns).toBe('240px minmax(0, 1fr) 0px');
    act(() => useLayout.getState().setSidebar({ width: 280 }));
    act(() => useLayout.getState().setPanel({ width: 320 }));
    expect(grid().style.gridTemplateColumns).toBe('280px minmax(0, 1fr) 0px');
    act(() => openSurface());
    expect(grid().style.gridTemplateColumns).toBe('280px minmax(0, 1fr) 320px');
  });

  it('a collapsed region gets a zero column, goes inert and loses its resizer', () => {
    openSurface();
    renderShell();
    act(() => useLayout.getState().setSidebar({ collapsed: true }));
    expect(grid().style.gridTemplateColumns).toBe('0px minmax(0, 1fr) 420px');
    expect(region('sidebar').inert).toBe(true);
    act(() => useLayout.getState().setPanel({ collapsed: true }));
    expect(grid().style.gridTemplateColumns).toBe('0px minmax(0, 1fr) 0px');
    expect(region('panel').inert).toBe(true);
    expect(screen.queryAllByRole('separator')).toHaveLength(0);
  });

  it('a maximized panel takes the main column and the main region stays mounted', () => {
    openSurface();
    renderShell();
    act(() => useLayout.getState().setPanel({ maximized: true }));
    expect(grid().style.gridTemplateColumns).toBe('240px 0px minmax(0, 1fr)');
    expect(region('main').inert).toBe(true);
    expect(within(region('main')).getByRole('tabpanel')).toBeTruthy();
    expect(within(chromeTabs()).getByRole('tablist', { name: 'Open tabs' })).toBeTruthy();
    expect(screen.getAllByRole('separator').map((s) => s.getAttribute('aria-controls'))).toEqual([region('sidebar').id]);
  });

  it('a resizer writes its width to the layout store', async () => {
    const user = userEvent.setup();
    openSurface();
    renderShell();
    screen.getAllByRole('separator')[1].focus();
    await user.keyboard('{ArrowLeft}');
    expect(useLayout.getState().regions.panel.width).toBe(428);
    screen.getAllByRole('separator')[0].focus();
    await user.keyboard('{Home}');
    expect(useLayout.getState().regions.sidebar.width).toBe(200);
  });

  it('a persisted width outside the bounds renders clamped', () => {
    useLayout.setState({ regions: { ...LAYOUT_DEFAULTS.regions, sidebar: { ...LAYOUT_DEFAULTS.regions.sidebar, width: 900 } } });
    renderShell();
    expect(grid().style.gridTemplateColumns).toBe('480px minmax(0, 1fr) 0px');
  });

  it('temporarily sets the sidebar aside below 1100 while a surface is open and uses a sheet below 700', () => {
    openSurface('review');
    const regions = LAYOUT_DEFAULTS.regions;
    useLayout.setState({ regions: { ...regions, sidebar: { ...regions.sidebar, width: 480 }, panel: { ...regions.panel, width: 640 } } });
    renderShell();
    expect(grid().style.gridTemplateColumns).toBe('480px minmax(0, 1fr) 600px');
    act(() => setWindowWidth(960));
    expect(grid().style.gridTemplateColumns).toBe('0px minmax(0, 1fr) 600px');
    expect(region('sidebar').inert).toBe(true);
    expect(screen.getAllByRole('separator').map((s) => [s.getAttribute('aria-valuenow'), s.getAttribute('aria-valuemax')])).toEqual([['600', '600']]);
    act(() => useLayout.getState().setPanel({ collapsed: true }));
    expect(grid().style.gridTemplateColumns).toBe('480px minmax(0, 1fr) 0px');
    act(() => useLayout.getState().setPanel({ collapsed: false }));
    act(() => setWindowWidth(680));
    expect(grid().style.gridTemplateColumns).toBe('0px minmax(0, 1fr) 0px');
    expect(region('panel').style.width).toBe('656px');
    expect(region('panel').inert).toBe(false);
    expect(screen.queryAllByRole('separator')).toHaveLength(0);
    act(() => setWindowWidth(1440));
    expect(grid().style.gridTemplateColumns).toBe('480px minmax(0, 1fr) 600px');
    expect([useLayout.getState().regions.sidebar.width, useLayout.getState().regions.panel.width]).toEqual([480, 640]);
  });

  it('a drag-collapse of a clamped region keeps its remembered width for reopening', () => {
    openSurface('review');
    const regions = LAYOUT_DEFAULTS.regions;
    useLayout.setState({ regions: { ...regions, sidebar: { ...regions.sidebar, width: 900 }, panel: { ...regions.panel, width: 1000 } } });
    renderShell();
    const dragBy = (handle: HTMLElement, dx: number) => {
      act(() => void fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 500 }));
      act(() => void fireEvent.pointerMove(handle, { pointerId: 1, clientX: 500 + dx }));
    };
    dragBy(screen.getByRole('separator', { name: 'Resize sidebar' }), -330);
    expect(useLayout.getState().regions.sidebar).toMatchObject({ collapsed: true, width: 900 });
    dragBy(screen.getByRole('separator', { name: 'Resize right panel' }), 850);
    expect(useLayout.getState().regions.panel).toMatchObject({ collapsed: true, width: 1000 });
    act(() => useLayout.getState().setPanel({ collapsed: false }));
    expect(grid().style.gridTemplateColumns).toBe('0px minmax(0, 1fr) 1000px');
  });
});

describe('toolbar', () => {
  it('titles the active tab: nothing for an empty pane, a session with its branch, a file by basename', () => {
    const records = new Map([[A, record('app-a', { title: { text: 'Fix sidebar drag', source: 'user' }, branch: 'feat/sidebar' })]]);
    expect(toolbarTitle(null, records)).toEqual({ title: '', branch: null });
    expect(toolbarTitle(sessionTab('app-a'), records)).toEqual({ title: 'Fix sidebar drag', branch: 'feat/sidebar' });
    expect(toolbarTitle({ id: 'file:/r/src/app.ts', kind: 'file', path: '/r/src/app.ts', line: null, appSessionId: null, pinned: false }, records)).toEqual({ title: 'app.ts', branch: null });
    expect(toolbarTitle({ id: 'diagnostics', kind: 'diagnostics', pinned: false }, records).title).toBe('Diagnostics');
    // E4a: a browser tab by its page's title (else host), else "Browser" until the browser store lists the tab
    const browser = { id: 'browser:app-a:b_000000000001', kind: 'browser', appSessionId: A, browserTabId: 'b_000000000001', pinned: false } as const;
    expect(toolbarTitle(browser, records, 'Page A')).toEqual({ title: 'Page A', branch: null });
    expect(toolbarTitle(browser, records)).toEqual({ title: 'Browser', branch: null });
    // W9 (H2): the engine's HEAD (a folder that is no repository) is no branch, so no chip
    expect(toolbarTitle(sessionTab('app-a'), new Map([[A, record('app-a', { branch: 'HEAD' })]])).branch).toBeNull();
  });

  it('shows the focused pane’s tabs in the chrome without duplicating a title row', () => {
    useSessions.setState({ records: new Map([[A, record('app-a', { title: { text: 'Fix sidebar drag', source: 'user' }, branch: 'feat/sidebar' })]]) });
    renderShell();
    expect(within(chromeTabs()).queryByRole('tab')).toBeNull();
    act(() => useLayout.setState({ main: withActive(sessionTab('app-a')) }));
    expect(within(chromeTabs()).getByRole('tab', { name: 'Fix sidebar drag' }).getAttribute('aria-selected')).toBe('true');
    expect(within(screen.getByRole('banner')).getAllByText('Fix sidebar drag')).toHaveLength(1);
    expect(within(region('main')).queryByRole('tablist')).toBeNull();
  });

  it('the sidebar toggle runs its action, while Session cards toggles the cards and shows its chord', async () => {
    const user = userEvent.setup();
    const sidebar = vi.fn();
    offs.push(registerAction('sidebar.toggle', sidebar));
    useSessions.setState({ records: new Map([[A, record('app-a')]]) });
    useLayout.setState({ main: withActive(sessionTab(A)) });
    renderShell();
    const cards = within(screen.getByRole('banner')).getByRole('button', { name: 'Session cards' });
    expect(cards.getAttribute('aria-pressed')).toBe('true');
    expect(cards.getAttribute('title')).toBe('Session cards · ⌘⇧B');
    const floatingCards = screen.getByRole('complementary', { name: 'Session cards' });
    expect(region('main').contains(floatingCards)).toBe(true);
    expect(region('panel').contains(floatingCards)).toBe(false);
    expect(['Environment', 'Context', 'Connectors', 'Artifacts'].map((name) => within(within(floatingCards).getByRole('region', { name })).getByRole('button').getAttribute('aria-expanded'))).toEqual(['false', 'false', 'false', 'false']);
    await user.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
    expect(sidebar).toHaveBeenCalledOnce();
    await user.click(cards);
    expect(cards.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('complementary', { name: 'Session cards' })).toBeNull();
    expect(useLayout.getState().regions.panel.collapsed).toBe(true);
    await user.click(cards);
    expect(screen.getByRole('complementary', { name: 'Session cards' })).toBeTruthy();
    expect(grid().style.gridTemplateColumns).toBe('240px minmax(0, 1fr) 0px');
  });

  it('shows a rebound chord in the tooltip', () => {
    useSettings.setState({ state: { settings: { ...SETTINGS_DEFAULTS_V19, keymap: { 'sidebar.toggle': 'Cmd+Alt+S' } }, resolvedTheme: 'light' } });
    renderShell();
    expect(screen.getByRole('button', { name: 'Toggle sidebar' }).getAttribute('title')).toBe('Toggle sidebar · ⌘⌥S');
    useSettings.setState({ state: null });
  });

  it('More omits session actions with no tab open and lists the §5.1 submenu for a session, unregistered ones disabled', async () => {
    const user = userEvent.setup();
    useSessions.setState({ records: new Map([[A, record('app-a')]]) });
    renderShell();
    await user.click(screen.getByRole('button', { name: 'More surfaces' }));
    expect(screen.queryByRole('menuitem', { name: 'Session actions' })).toBeNull();
    await user.keyboard('{Escape}');
    const split = vi.fn();
    offs.push(registerShellActions(fakeBridge()), (await import('./session-actions')).registerSessionAction('openInSplit', split));
    act(() => useLayout.setState({ main: withActive(sessionTab('app-a')) }));
    await user.click(screen.getByRole('button', { name: 'More surfaces' }));
    const actions = await screen.findByRole('menuitem', { name: 'Session actions' });
    act(() => actions.focus());
    await user.keyboard('{ArrowRight}');
    const menu = (await screen.findByRole('menuitem', { name: 'Pin' })).closest<HTMLElement>('[role="menu"]')!;
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => [i.textContent, i.getAttribute('aria-disabled') === 'true'])).toEqual([
      ['Open in split', false],
      ['Pin', false],
      ['Rename…', true],
      ['Fork', true],
      ['Fork to a new worktree…', true], // C10
      ['Archive', true],
      ['Delete conversation…', true],
    ]); // no worktree, so no "Remove worktree…", as in the sidebar's menu
    await user.click(within(menu).getByRole('menuitem', { name: 'Open in split' }));
    expect(split).toHaveBeenCalledWith(A);
  });

  it('offers a foreign-live session no actions, as the sidebar does (D-12): the scenario’s terminal-held session', async () => {
    const user = userEvent.setup();
    const nine = scenarioFile('nine-sessions');
    const held = nine.sessions.find((r) => r.holder.kind === 'terminal')!;
    useSessions.setState({ records: new Map(nine.sessions.map((r) => [r.appId, r])) });
    offs.push(registerShellActions(fakeBridge()));
    renderShell();
    act(() => useLayout.setState({ main: withActive(sessionTab(held.appId)) }));
    expect(within(chromeTabs()).getByRole('tab', { name: held.title.text })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'More surfaces' }));
    expect((await screen.findByRole('menuitem', { name: 'Session actions' })).getAttribute('aria-disabled')).toBe('true');
  });
});

describe('shell actions', () => {
  it('toggle the sidebar and panel, maximize and restore the panel', () => {
    openSurface();
    offs.push(registerShellActions(fakeBridge()));
    runAction('sidebar.toggle');
    expect(useLayout.getState().regions.sidebar.collapsed).toBe(true);
    runAction('sidebar.toggle');
    expect(useLayout.getState().regions.sidebar.collapsed).toBe(false);
    runAction('panel.maximize');
    expect(useLayout.getState().regions.panel).toMatchObject({ maximized: true, collapsed: false });
    runAction('panel.toggle'); // the cards action replaces a surface with session cards
    expect(useLayout.getState().regions.panel).toMatchObject({ maximized: false, collapsed: false });
    runAction('panel.toggle'); // and toggles the cards closed
    expect(useLayout.getState().regions.panel.collapsed).toBe(true);
    runAction('surface.terminal'); // select a real surface again: cards themselves never maximize
    useLayout.getState().setPanel({ collapsed: true });
    runAction('panel.maximize'); // maximizing a hidden selected surface shows it
    expect(useLayout.getState().regions.panel).toMatchObject({ maximized: true, collapsed: false });
    runAction('panel.maximize');
    expect(useLayout.getState().regions.panel).toMatchObject({ maximized: false, collapsed: false });
  });

  it.each([false, true])('the Overview action restores main and focuses the dialog when already open=%s', async (alreadyOpen) => {
    const user = userEvent.setup();
    offs.push(registerShellActions(fakeBridge()));
    openSurface();
    renderShell();
    if (alreadyOpen) act(() => runAction('tab.overview'));
    const previousDialog = screen.queryByRole('dialog', { name: 'Overview' });
    await user.click(screen.getByRole('button', { name: 'Expand surface' }));
    expect(region('main').inert).toBe(true);
    act(() => runAction('tab.overview'));
    expect(region('main').inert).toBe(false);
    expect(grid().style.gridTemplateColumns).toBe('240px minmax(0, 1fr) 420px');
    const dialog = within(region('main')).getByRole('dialog', { name: 'Overview' });
    if (alreadyOpen) expect(dialog).toBe(previousDialog);
    await vi.waitFor(() => expect(document.activeElement).toBe(dialog));
    act(() => screen.getByRole('button', { name: 'Expand surface' }).focus());
    act(() => runAction('tab.overview'));
    expect(document.activeElement).toBe(dialog); // an ordinary bring-focus remains open, never toggles closed
    expect(useLayout.getState().overviewOpen).toBe(true);
  });

  it('switch the appearance through the settings store', () => {
    const original = useSettings.getState().setTheme;
    const setTheme = vi.fn(async () => {});
    useSettings.setState({ setTheme });
    offs.push(registerShellActions(fakeBridge()));
    runAction('theme.dark');
    runAction('theme.system');
    expect(setTheme.mock.calls).toEqual([['dark'], ['system']]);
    useSettings.setState({ setTheme: original });
  });

  it('pin flips the record’s pinned flag through session.update', async () => {
    const bridge = fakeBridge();
    useSessions.setState({ records: new Map([[A, record('app-a', { pinned: false })]]) });
    offs.push(registerShellActions(bridge));
    (await import('./session-actions')).runSessionAction('pin', A);
    await vi.waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('session.update', { appSessionId: A, patch: { pinned: true } }));
  });
});

describe('right panel', () => {
  it('keeps an empty panel inert and renders a selected surface’s own header controls', () => {
    renderShell();
    expect(region('panel').inert).toBe(true);
    expect(within(region('panel')).queryByRole('button', { name: 'Expand surface' })).toBeNull();
    act(() => openSurface());
    expect(region('panel').inert).toBe(false);
    expect(within(region('panel')).getByRole('button', { name: 'Expand surface' })).toBeTruthy();
    expect(within(region('panel')).getByRole('button', { name: 'Close surface' })).toBeTruthy();
  });

  it('hands a registered host the session’s effective tabs and splits its changes back by pin', async () => {
    let props: PanelHostProps | null = null;
    registerSlot('panelHost', (p) => {
      props = p;
      return <div>host</div>;
    });
    useSessions.setState({ records: new Map([[A, record('app-a')]]) });
    useLayout.setState({
      main: withActive(sessionTab('app-a')),
      panelPinned: [{ id: 'p', toolId: 'terminal', pinned: true }],
      panelBySession: new Map([[A, { tabs: [{ id: 'o', toolId: 'files', pinned: false }], activeTabId: 'o' }]]),
    });
    offs.push(registerShellActions(fakeBridge()));
    renderShell();
    expect(within(region('panel')).getByText('host')).toBeTruthy();
    expect(props!).toMatchObject({ appSessionId: A, activeTabId: 'o', maximized: false });
    expect(props!.tabs.map((t) => t.id)).toEqual(['p', 'o']);
    act(() => props!.onTogglePinned('o'));
    expect(useLayout.getState().panelPinned.map((t) => t.id)).toEqual(['p', 'o']);
    act(() => props!.onChange({ tabs: [{ id: 'p', toolId: 'terminal', pinned: false }], activeTabId: 'p' }));
    expect(useLayout.getState().panelPinned).toEqual([]);
    expect(useLayout.getState().panelBySession.get(A)).toEqual({ tabs: [{ id: 'p', toolId: 'terminal', pinned: false }], activeTabId: 'p' });
    act(() => props!.onToggleMaximize());
    expect(useLayout.getState().regions.panel.maximized).toBe(true);
  });

  it('with no tab open, round-trips the selection between two pins and falls back when the selected pin goes', () => {
    let props: PanelHostProps | null = null;
    registerSlot('panelHost', (p) => {
      props = p;
      return null;
    });
    const p1 = { id: 'p1', toolId: 'terminal', pinned: true };
    const p2 = { id: 'p2', toolId: 'files', pinned: true };
    useLayout.setState({ panelPinned: [p1, p2] });
    renderShell();
    expect(props!).toMatchObject({ appSessionId: null, activeTabId: null });
    act(() => props!.onChange({ tabs: [p1, p2], activeTabId: 'p2' }));
    expect(props!.activeTabId).toBe('p2');
    act(() => props!.onChange({ tabs: [p1, p2], activeTabId: 'p1' }));
    expect(props!.activeTabId).toBe('p1');
    act(() => props!.onChange({ tabs: [p1, p2], activeTabId: 'p2' }));
    // The host removes the selected pin without choosing another: the neighbour that took its place is selected.
    act(() => props!.onChange({ tabs: [p1], activeTabId: 'p2' }));
    expect(props!.tabs.map((t) => t.id)).toEqual(['p1']);
    expect(props!.activeTabId).toBe('p1');
    act(() => props!.onChange({ tabs: [], activeTabId: 'p1' }));
    expect(props!.activeTabId).toBeNull();
  });

  it('shows no session when the focused pane is empty', () => {
    let props: PanelHostProps | null = null;
    registerSlot('panelHost', (p) => {
      props = p;
      return null;
    });
    renderShell();
    expect(props!).toMatchObject({ appSessionId: null, tabs: [], activeTabId: null });
  });
});

// P3-G (§D5, acceptance 12): the sidebar's Artifacts destination opens the Artifacts main tab, a
// singleton that a second open activates, showing P3-L's library as App.tsx registers it (the slot's fallback where no
// host registers it).
describe('the Artifacts entry', () => {
  const artifactsTabs = () => useLayout.getState().main.sets[NO_PROJECT]!.panes.flatMap((pane) => pane.tabs.filter((tab) => tab.kind === 'artifacts'));

  it('the sidebar row opens the Artifacts tab once, titled and showing the library; a second click activates it', async () => {
    const user = userEvent.setup();
    const previousBridge = window.maws;
    const counts = { document: 0, presentation: 0, design: 0, design_system: 0, dashboard: 0, html: 0, file: 0 };
    window.maws = fakeClient({ 'library.list': { rows: [], counts }, 'library.spaces': { spaces: [] } }).client;
    offs.push(() => {
      window.maws = previousBridge;
      resetLibrary();
    });
    registerSlot('artifactsLibrary', Library);
    renderShell();
    const sidebar = region('sidebar');
    const row = within(sidebar).getByRole('button', { name: 'Artifacts' });
    expect(within(sidebar).getByRole('button', { name: 'Projects' }).nextElementSibling).toBe(row);
    expect(row.getAttribute('aria-current')).toBeNull();

    await user.click(row);
    expect(artifactsTabs()).toEqual([{ id: 'artifacts', kind: 'artifacts', pinned: false }]);
    expect(within(chromeTabs()).getByRole('tab', { name: 'Artifacts' }).getAttribute('aria-selected')).toBe('true');
    expect(within(screen.getByRole('banner')).getByText('Artifacts')).toBeTruthy();
    const panel = within(region('main')).getByRole('tabpanel');
    expect(within(panel).getByRole('heading', { level: 1, name: 'Artifacts' })).toBeTruthy();
    expect(within(panel).getByRole('radiogroup', { name: 'View' })).toBeTruthy();
    expect(within(panel).getByRole('searchbox', { name: 'Search artifacts' })).toBeTruthy();
    expect(row.getAttribute('aria-current')).toBe('page');

    act(() => useLayout.getState().openTab({ kind: 'diagnostics' }));
    expect(row.getAttribute('aria-current')).toBeNull();
    await user.click(row);
    expect(artifactsTabs()).toHaveLength(1);
    expect(within(chromeTabs()).getAllByRole('tab').map((tab) => [tab.getAttribute('aria-label'), tab.getAttribute('aria-selected')])).toEqual([
      ['Artifacts', 'true'],
      ['Diagnostics', 'false'],
    ]);
    expect(row.getAttribute('aria-current')).toBe('page');
  });

  // M5's review: the tab lives in the main area, so opening it from a maximized or floating panel docks the panel first;
  // otherwise it would be selected behind an inert, zero-width main region while the card kept its session.
  describe.each([
    ['floating', { floating: true }],
    ['maximized', { maximized: true }],
  ] as const)('from a %s panel', (_, patch) => {
    const placeholder = 'Artifacts unavailable';
    const startHidden = () => {
      openSurface();
      useLayout.getState().setPanel(patch);
      renderShell();
      expect(region('main').inert).toBe(true);
    };
    const expectShown = () => {
      expect(useLayout.getState().regions.panel).toMatchObject({ floating: false, maximized: false, collapsed: false });
      expect(region('main').inert).toBe(false);
      expect(grid().style.gridTemplateColumns).toBe('240px minmax(0, 1fr) 420px');
      expect(screen.queryByRole('region', { name: 'Session card' })).toBeNull();
      expect(within(within(region('main')).getByRole('tabpanel')).getByText(placeholder)).toBeTruthy();
    };

    it('the sidebar row docks the panel and shows the Artifacts tab', async () => {
      const user = userEvent.setup();
      startHidden();
      if ('floating' in patch) expect(screen.getByRole('region', { name: 'Session card' })).toBeTruthy();
      await user.click(within(region('sidebar')).getByRole('button', { name: 'Artifacts' }));
      expectShown();
    });

    it('the artifacts.open action docks the panel and shows the Artifacts tab', () => {
      offs.push(registerShellActions(fakeBridge()));
      startHidden();
      act(() => runAction('artifacts.open'));
      expectShown();
    });
  });

  it('draws the library a later child registers into the slot', () => {
    registerSlot('artifactsLibrary', () => <section aria-label="Library">library</section>);
    useLayout.setState({ main: withActive({ id: 'artifacts', kind: 'artifacts', pinned: false }) });
    renderShell();
    expect(within(region('main')).getByRole('region', { name: 'Library' })).toBeTruthy();
    expect(screen.queryByText('Artifacts unavailable')).toBeNull();
  });

  it('the artifacts.open action opens or activates the same tab', () => {
    offs.push(registerShellActions(fakeBridge()));
    runAction('artifacts.open');
    useLayout.getState().openTab({ kind: 'diagnostics' });
    runAction('artifacts.open');
    expect(artifactsTabs()).toHaveLength(1);
    expect(toolbarTitle(useLayout.getState().main.sets[NO_PROJECT]!.panes[0].tabs.find((tab) => tab.id === 'artifacts')!, new Map()).title).toBe('Artifacts');
    expect(useLayout.getState().main.sets[NO_PROJECT]!.panes[0].activeTabId).toBe('artifacts');
  });
});

function fakeBridge() {
  return {
    invoke: vi.fn(async () => ({ ok: true, value: undefined })),
    on: vi.fn(() => () => {}),
  } as unknown as MawsBridge & { invoke: ReturnType<typeof vi.fn> };
}


it('keeps fallback notifications and quit-wait actions outside the hidden main region', async () => {
  const user = userEvent.setup();
  const fake = fakeClient({ 'layout.quitWait': { waiting: null }, 'layout.quitWaitAnswer': undefined, 'attention.pendingNavigate': { navigate: null } });
  offs.push(connectQuitWait(fake.client), connectAttention(fake.client));
  openSurface();
  useLayout.getState().setPanel({ maximized: true, collapsed: false });
  renderShell();
  act(() => {
    fake.event('layout.quitWait', { waiting: { midTurn: 1, backgroundWork: 0, busyTerminals: 0, terminalsUnknown: false, unsavedFiles: [] /* E5 */ } });
    fake.event('attention.notified', { appSessionId: A, attentionId: 'att-a', delivery: 'fallback', at: '2026-10-02T10:00:00Z' });
  });
  const quit = screen.getByRole('button', { name: 'Quit now' });
  const cancel = screen.getByRole('button', { name: 'Cancel' });
  const notification = screen.getByRole('region', { name: /Notifications/ });
  for (const node of [quit, cancel, notification]) {
    expect(node.closest('[inert]')).toBeNull();
    expect(region('main').contains(node)).toBe(false);
  }
  await user.click(cancel);
  await user.click(quit);
  expect(fake.invoked('layout.quitWaitAnswer')).toEqual([{ action: 'cancel' }, { action: 'quitNow' }]);
  expect(document.querySelectorAll('[data-banner-host]')).toHaveLength(1);
});

it.each(['tab', 'content'] as const)('Cmd+W from focused %s restores the active tab and pane-scoped cycling', async (from) => {
  const user = userEvent.setup();
  offs.push(registerShellActions(fakeBridge()), connectKeys());
  registerSlot('fileTab', () => <input aria-label="File content" />);
  useLayout.getState().openTab({ kind: 'file', path: '/one.ts', line: null, appSessionId: null });
  useLayout.getState().openTab({ kind: 'file', path: '/two.ts', line: null, appSessionId: null });
  useLayout.getState().openTab({ kind: 'file', path: '/three.ts', line: null, appSessionId: null });
  renderShell();
  act(() => (from === 'tab' ? screen.getByRole('tab', { name: /three.ts/ }) : screen.getByRole('textbox', { name: 'File content' })).focus());
  act(() => runAction('tab.close'));
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tab', { name: /two.ts/ })));
  await user.keyboard('{Control>}{Tab}{/Control}');
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tab', { name: /one.ts/ })));
});

it('closing the last split tab restores focus in the surviving pane; closing its last tab focuses empty-pane controls', async () => {
  offs.push(registerShellActions(fakeBridge()));
  useLayout.getState().openTab({ kind: 'file', path: '/left.ts', line: null, appSessionId: null });
  useLayout.getState().openTab({ kind: 'file', path: '/right.ts', line: null, appSessionId: null }, { pane: 'other' });
  renderShell();
  act(() => screen.getByRole('tab', { name: /right.ts/ }).focus());
  act(() => runAction('tab.close'));
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tab', { name: /left.ts/ })));
  act(() => runAction('tab.close'));
  await vi.waitFor(() => expect(document.activeElement).toBe(within(screen.getByRole('tabpanel')).getByRole('button', { name: /Overview/ })));
});

it('a refused Cmd+W keeps the tab and its focus', async () => {
  offs.push(registerShellActions(fakeBridge()), registerCloseGuard('file', async () => false));
  useLayout.getState().openTab({ kind: 'file', path: '/keep.ts', line: null, appSessionId: null });
  renderShell();
  const tab = screen.getByRole('tab', { name: /keep.ts/ });
  act(() => tab.focus());
  await act(async () => runAction('tab.close'));
  expect(document.activeElement).toBe(tab);
});

it.each([false, true])('Escape dismisses a triggerless sheet back to its opener (child autofocus: %s)', async (autofocus) => {
  function Example() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Open sheet</button>{open && <Sheet title="Confirmation" onClose={() => setOpen(false)}><input aria-label="Name" autoFocus={autofocus} /></Sheet>}</>;
  }
  const user = userEvent.setup();
  render(<Example />);
  const opener = screen.getByRole('button', { name: 'Open sheet' });
  await user.click(opener);
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' }));
  await user.keyboard('{Escape}');
  await vi.waitFor(() => expect(document.activeElement).toBe(opener));
});

it('Delete on an arrow-focused inactive draft tab restores focus after the real discard guard', async () => {
  const user = userEvent.setup();
  resetSetupStore();
  const previousBridge = window.maws;
  const fake = fakeClient({ 'session.intent.discard': { leftover: null } });
  window.maws = fake.client;
  offs.push(() => { window.maws = previousBridge; closeDialog(); resetSetupStore(); });
  offs.push(registerCloseGuard('session', async (ref) => ref.kind === 'session' && await beforeCloseUnstarted(ref.appSessionId) === 'closed'));
  putIntent(intent({ draft: { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'keep my draft' }] }] }, attachments: [], updatedAt: '2026-09-29T10:00:00.000Z' } }));
  useLayout.getState().openTab({ kind: 'session', appSessionId: ID });
  useLayout.getState().openTab({ kind: 'file', path: '/survivor.ts', line: null, appSessionId: null });
  render(<QueryClientProvider client={queryClient}><Shell /><SessionDialogs /></QueryClientProvider>);
  const survivor = screen.getByRole('tab', { name: /survivor.ts/ });
  act(() => survivor.focus());
  await user.keyboard('{ArrowLeft}');
  const draft = screen.getByRole('tab', { name: 'New chat' });
  expect(document.activeElement).toBe(draft);
  expect(draft.getAttribute('aria-selected')).toBe('false');
  await user.keyboard('{Delete}');
  await user.click(await screen.findByRole('button', { name: 'Discard' }));
  await vi.waitFor(() => expect(screen.queryByRole('tab', { name: 'New chat' })).toBeNull());
  expect(fake.invoked('session.intent.discard')).toEqual([{ appSessionId: ID }]);
  await vi.waitFor(() => expect(document.activeElement).toBe(survivor));
});

it('middle-closing the active left tab preserves the surviving right editor focus', async () => {
  registerSlot('fileTab', () => <input aria-label="File content" />);
  useLayout.getState().openTab({ kind: 'file', path: '/left-survivor.ts', line: null, appSessionId: null });
  useLayout.getState().openTab({ kind: 'file', path: '/left-close.ts', line: null, appSessionId: null });
  useLayout.getState().openTab({ kind: 'file', path: '/right.ts', line: null, appSessionId: null }, { pane: 'other' });
  renderShell();
  const editor = within(screen.getByRole('region', { name: 'Right pane' })).getByRole('textbox');
  act(() => editor.focus());
  fireEvent(screen.getByRole('tab', { name: /left-close.ts/ }), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
  await vi.waitFor(() => expect(screen.queryByRole('tab', { name: /left-close.ts/ })).toBeNull());
  // Drain the close handoff frame before checking that it did not move focus.
  await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
  expect(screen.getByRole('tab', { name: /left-survivor.ts/ }).getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(editor);
});

it.each([true, false])('context-menu Close restores pane focus when the closing tab is active=%s', async (active) => {
  useLayout.getState().openTab({ kind: 'file', path: '/menu-close.ts', line: null, appSessionId: null });
  useLayout.getState().openTab({ kind: 'file', path: '/menu-survivor.ts', line: null, appSessionId: null });
  if (active) useLayout.getState().activateTab('file:/menu-close.ts');
  renderShell();
  const tab = screen.getByRole('tab', { name: 'menu-close.ts' });
  act(() => tab.focus());
  fireEvent.contextMenu(tab);
  const close = await screen.findByRole('menuitem', { name: 'Close tab' });
  act(() => close.focus());
  fireEvent.click(close);
  await vi.waitFor(() => expect(screen.queryByRole('tab', { name: 'menu-close.ts' })).toBeNull());
  // Drain Radix's trigger-restoration timeout and the close handoff frame.
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'menu-survivor.ts' }));
});
