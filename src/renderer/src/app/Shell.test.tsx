import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../ipc/query';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge, PreloadBridge } from '@shared/ipc/schema';
import { LAYOUT_DEFAULTS, type Strip, type TabRef } from '@shared/ipc/schema/layout';
import { record, remoteRow } from '../../../../test/support/builders';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { addressOf } from '@shared/machine/address';
import { LANE_A_WORDS } from '../session/controls/lane-a';
import { resetLaneAStore } from '../stores/lane-a';
import { registerCloseGuard, registerAction, runAction } from '../keymap/actions-runtime';
import type { PanelHostProps } from '../panel/host-slot';
import { persistLayout, useLayout } from '../stores/layout';
import { cardColumnNow, useCardColumnShown } from './shell-view';
import { useSessions } from '../stores/sessions';
import { useMachines } from '../stores/machines';
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
import { fillStores, pageScenario, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { probeTool, ref, resetPanelStores } from '../test-support/panel';
import { registerPanelTool } from '../panel/host';
import { surfaceTabs } from '../panel/surface-model';
import { PanelHost } from '../panel/PanelHost';
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { preloadOf } from '../test-support/preload-of';

vi.mock('./Diagnostics', () => ({ Diagnostics: () => <section aria-label="Diagnostics">diagnostics</section> }));

const A = at('app-a' as AppSessionId); // P5 O6 M2: the page's id
const sessionTab = (id: string): TabRef => ({ id: `session:${id}`, kind: 'session', appSessionId: id as AppSessionId, pinned: false });
const withActive = (tab: TabRef): Strip => ({ ...LAYOUT_DEFAULTS.main, panes: [{ tabs: [tab], activeTabId: tab.id }] });

const region = (name: string) => document.querySelector<HTMLElement>(`[data-region="${name}"]`)!;
const grid = () => region('main').parentElement!;
const offs: (() => void)[] = [];
const chromeTabs = () => screen.getByRole('banner').querySelector<HTMLElement>('[data-chrome-tabs]')!;
const renderShell = () => render(<QueryClientProvider client={queryClient}><Shell /></QueryClientProvider>);
// Geometry and maximize checks need a selected surface; an empty panel reserves no space.
// A narrow tool by default (UX wave U8b, Addendum 6: a terminal opens wide, so Background tasks stands for "any other tool").
function openSurface(toolId = 'background') {
  offs.push(registerPanelTool(probeTool(toolId).tool));
  registerSlot('panelHost', PanelHost);
  useSessions.setState({ records: new Map([[A, record(A)]]) });
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
    useLayout.getState().setPanelWidth(444); // UX wave U8b: the wide width, Review being in view
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

  // UX wave U7b (O-47; its execution document, M7 decision 1): the ring at the title bar's own right end, after the surface
  // icons and outside their overflow; on a page, where the surface icons are not drawn, still at the end; the sidebar's
  // foot holds the gear alone.
  it('mounts the usage slot at the title bar’s right end, after the surface icons, with a page open too; the sidebar’s foot holds the gear alone', () => {
    registerSlot('topBarEnd', () => <button type="button">Usage</button>);
    renderShell();
    const toolbar = screen.getByRole('banner');
    const usage = within(toolbar).getByRole('button', { name: 'Usage' });
    const surfaces = within(toolbar).getByRole('toolbar', { name: 'Session surfaces' });
    expect(surfaces.compareDocumentPosition(usage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(surfaces.contains(usage)).toBe(false);
    const last = (el: Element): Element => (el.lastElementChild ? last(el.lastElementChild) : el);
    expect(last(toolbar)).toBe(usage);
    const foot = region('sidebar').querySelector('footer')!;
    expect(within(foot).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Workspace settings']);
    expect(within(region('sidebar')).queryByRole('button', { name: 'Usage' })).toBeNull();

    act(() => useLayout.getState().openDestination({ kind: 'library' }));
    expect(within(toolbar).queryByRole('toolbar', { name: 'Session surfaces' })).toBeNull();
    expect(last(toolbar)).toBe(within(toolbar).getByRole('button', { name: 'Usage' }));
    expect(within(toolbar).getByRole('button', { name: 'Usage' }).closest('[inert]')).toBeNull();
  });

  it('uses remembered widths only for open regions, leaving no empty panel column', () => {
    renderShell();
    expect(grid().style.gridTemplateColumns).toBe('240px minmax(0, 1fr) 0px');
    act(() => useLayout.getState().setSidebar({ width: 280 }));
    act(() => useLayout.getState().setPanelWidth(320)); // UX wave U8b: the narrow width, nothing in view
    expect(grid().style.gridTemplateColumns).toBe('280px minmax(0, 1fr) 0px');
    act(() => openSurface());
    expect(grid().style.gridTemplateColumns).toBe('280px minmax(0, 1fr) 320px');
  });

  it('a collapsed region gets a zero column, goes inert and loses its resizer', () => {
    openSurface();
    renderShell();
    act(() => useLayout.getState().setSidebar({ collapsed: true }));
    expect(grid().style.gridTemplateColumns).toBe('0px minmax(0, 1fr) 360px');
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
    // UX wave U8b: from the narrow automatic 360, written as the narrow width and as build F's one width
    expect(useLayout.getState().panelWidths).toMatchObject({ wide: null, narrow: 368 });
    expect(useLayout.getState().regions.panel.width).toBe(368);
    await user.keyboard('{Enter}'); // a reset is automatic again, which F reads as 380
    expect(useLayout.getState().panelWidths).toMatchObject({ wide: null, narrow: null });
    expect(useLayout.getState().regions.panel.width).toBe(380);
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
    useLayout.setState({ regions: { ...regions, sidebar: { ...regions.sidebar, width: 480 }, panel: { ...regions.panel, width: 640 } }, panelWidths: { version: 1, wide: 640, narrow: null } });
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
    useLayout.setState({ regions: { ...regions, sidebar: { ...regions.sidebar, width: 900 }, panel: { ...regions.panel, width: 1000 } }, panelWidths: { version: 1, wide: 1000, narrow: null } });
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
    const records = new Map([[A, record(A, { title: { text: 'Fix sidebar drag', source: 'user' }, branch: 'feat/sidebar' })]]);
    expect(toolbarTitle(null, records)).toEqual({ title: '', branch: null });
    expect(toolbarTitle(sessionTab(A), records)).toEqual({ title: 'Fix sidebar drag', branch: 'feat/sidebar' });
    expect(toolbarTitle({ id: `file:${TEST_MACHINE}:/r/src/app.ts`, kind: 'file', path: '/r/src/app.ts', line: null, appSessionId: null, machine: TEST_MACHINE, pinned: false }, records)).toEqual({ title: 'app.ts', branch: null });
    expect(toolbarTitle({ id: 'diagnostics', kind: 'diagnostics', pinned: false }, records).title).toBe('Diagnostics');
    // E4a: a browser tab by its page's title (else host), else "Browser" until the browser store lists the tab
    const browser = { id: `browser:${A}:b_000000000001`, kind: 'browser', appSessionId: A, browserTabId: 'b_000000000001', pinned: false } as const;
    expect(toolbarTitle(browser, records, 'Page A')).toEqual({ title: 'Page A', branch: null });
    expect(toolbarTitle(browser, records)).toEqual({ title: 'Browser', branch: null });
    const channel = { id: 'channel:p1', kind: 'channel', project: 'p1', pinned: false } as const; // P5 O8 M7a
    expect(toolbarTitle(channel, records, null, null, new Map(), 'MAWS').title).toBe('MAWS · channel');
    expect(toolbarTitle(channel, records).title).toBe('Channel');
    // W9 (H2): the engine's HEAD (a folder that is no repository) is no branch, so no chip
    expect(toolbarTitle(sessionTab(A), new Map([[A, record(A, { branch: 'HEAD' })]])).branch).toBeNull();
    // UX wave U8c-2 (M4 decision 10): the branch recorded for the working folder, where the agent is
    const moved = record(A, { branch: 'main', agentFolder: { checkout: '/work/wt', cwd: '/work/wt', branch: 'w1', linked: true } });
    expect(toolbarTitle(sessionTab(A), new Map([[A, moved]])).branch).toBe('w1');
  });

  it('shows the focused pane’s tabs in the chrome without duplicating a title row', () => {
    useSessions.setState({ records: new Map([[A, record(A, { title: { text: 'Fix sidebar drag', source: 'user' }, branch: 'feat/sidebar' })]]) });
    renderShell();
    expect(within(chromeTabs()).queryByRole('tab')).toBeNull();
    act(() => useLayout.setState({ main: withActive(sessionTab(A)) }));
    expect(within(chromeTabs()).getByRole('tab', { name: 'Fix sidebar drag' }).getAttribute('aria-selected')).toBe('true');
    expect(within(screen.getByRole('banner')).getAllByText('Fix sidebar drag')).toHaveLength(1);
    expect(within(region('main')).queryByRole('tablist')).toBeNull();
  });

  it('the sidebar toggle runs its action, while Session cards toggles the cards and shows its chord', async () => {
    const user = userEvent.setup();
    const sidebar = vi.fn();
    offs.push(registerAction('sidebar.toggle', sidebar));
    useSessions.setState({ records: new Map([[A, record(A)]]) });
    useLayout.setState({ main: withActive(sessionTab(A)) });
    renderShell();
    const cards = within(screen.getByRole('banner')).getByRole('button', { name: 'Session cards' });
    expect(cards.getAttribute('aria-pressed')).toBe('true');
    expect(cards.getAttribute('title')).toBe('Session cards · ⌘⇧B');
    const floatingCards = screen.getByRole('complementary', { name: 'Session cards' });
    expect(region('main').contains(floatingCards)).toBe(true);
    expect(region('panel').contains(floatingCards)).toBe(false);
    expect(['Environment', 'Context', 'Connectors'].map((name) => within(within(floatingCards).getByRole('region', { name })).getAllByRole('button')[0].getAttribute('aria-expanded'))).toEqual(['true', 'false', 'false']);
    expect(within(floatingCards).queryByRole('region', { name: 'Artifacts' })).toBeNull();
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

  // UX wave U8b (UC-9, §C.2): the column, the icon and useCardColumnShown read one source, so a page that hides the
  // column turns all three off in one render. UX wave U7b (M5, decision 4): the page is the layout store's, and the
  // column keeps its place while it is not drawn: the same node, invisible and inert.
  it('a page open in the one source turns the cards off for the icon and useCardColumnShown in one render', () => {
    useSessions.setState({ records: new Map([[A, record(A)]]) });
    useLayout.setState({ main: withActive(sessionTab(A)) });
    const seen: boolean[] = [];
    function Reader() {
      const shown = useCardColumnShown();
      seen.push(shown);
      return null;
    }
    render(<QueryClientProvider client={queryClient}><Shell /><Reader /></QueryClientProvider>);
    const cards = within(screen.getByRole('banner')).getByRole('button', { name: 'Session cards' });
    const column = region('cards');
    expect([cards.getAttribute('aria-pressed'), seen.at(-1), cardColumnNow(useLayout.getState(), window.innerWidth).shown]).toEqual(['true', true, true]);
    act(() => useLayout.getState().openDestination({ kind: 'projects' }));
    expect([seen.at(-1), cardColumnNow(useLayout.getState(), window.innerWidth)]).toEqual([false, expect.objectContaining({ placed: true, shown: false })]);
    expect(region('cards')).toBe(column);
    expect([column.classList.contains('invisible'), column.hasAttribute('inert')]).toEqual([true, true]);
    act(() => useLayout.getState().closeDestination());
    expect([within(screen.getByRole('banner')).getByRole('button', { name: 'Session cards' }).getAttribute('aria-pressed'), seen.at(-1)]).toEqual(['true', true]);
    expect([region('cards'), column.classList.contains('invisible'), column.hasAttribute('inert')]).toEqual([column, false, false]);
  });

  it('shows a rebound chord in the tooltip', () => {
    useSettings.setState({ state: { settings: { ...SETTINGS_DEFAULTS_V21, keymap: { 'sidebar.toggle': 'Cmd+Alt+S' } }, resolvedTheme: 'light' } });
    renderShell();
    expect(screen.getByRole('button', { name: 'Toggle sidebar' }).getAttribute('title')).toBe('Toggle sidebar · ⌘⌥S');
    useSettings.setState({ state: null });
  });

  it('More omits session actions with no tab open and lists the §5.1 submenu for a session, unregistered ones disabled', async () => {
    const user = userEvent.setup();
    useSessions.setState({ records: new Map([[A, record(A)]]) });
    renderShell();
    await user.click(screen.getByRole('button', { name: 'More surfaces' }));
    expect(screen.queryByRole('menuitem', { name: 'Session actions' })).toBeNull();
    await user.keyboard('{Escape}');
    const split = vi.fn();
    offs.push(registerShellActions(fakeBridge()), (await import('./session-actions')).registerSessionAction('openInSplit', split));
    act(() => useLayout.setState({ main: withActive(sessionTab(A)) }));
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
    const nine = pageScenario(scenarioFile('nine-sessions')); // P5 O6 M2: the store holds the page's records
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

// P5 O9 M9 (fix wave 1): another machine's terminal session (a listed lane A row, no record here) offers Take over in its
// menu, disabled in place with the reason its port gives, and is titled by its row, not "New chat".
describe('another machine’s terminal session in the toolbar', () => {
  const REMOTE = addressOf(OTHER_MACHINE, 'eng-r' as AppSessionId);
  beforeEach(() => {
    useSessions.setState({ listed: new Map([[REMOTE, { ...remoteRow(OTHER_MACHINE, 'eng-r', { lane: 'A', availability: 'foreign_held', title: 'Ship the relay' }), appId: REMOTE }]]) });
  });
  afterEach(() => resetLaneAStore());

  it('its session actions hold Take over in MAWS, disabled with the remote reason', async () => {
    const user = userEvent.setup();
    offs.push(registerShellActions(fakeBridge()));
    renderShell();
    act(() => useLayout.setState({ main: withActive(sessionTab(REMOTE)) }));
    await user.click(screen.getByRole('button', { name: 'More surfaces' }));
    const actions = await screen.findByRole('menuitem', { name: 'Session actions' });
    expect(actions.getAttribute('aria-disabled')).toBeNull();
    act(() => actions.focus());
    await user.keyboard('{ArrowRight}');
    const takeOver = await screen.findByRole('menuitem', { name: 'Take over in MAWS' });
    expect(takeOver.getAttribute('aria-disabled')).toBe('true');
    expect(takeOver.getAttribute('title')).toBe(LANE_A_WORDS.remoteTakeOver);
  });

  // UX wave U8b (UC-9): only listed, it has no record here, so the column holds no record card.
  it('has the card column with no record card, and Session cards toggles it', async () => {
    const user = userEvent.setup();
    renderShell();
    act(() => useLayout.setState({ main: withActive(sessionTab(REMOTE)) }));
    const icon = within(screen.getByRole('banner')).getByRole('button', { name: 'Session cards' });
    expect([icon.getAttribute('aria-pressed'), (icon as HTMLButtonElement).disabled]).toEqual(['true', false]);
    const cards = screen.getByRole('complementary', { name: 'Session cards' });
    expect(within(cards).queryAllByRole('region')).toEqual([]);
    await user.click(icon);
    expect(screen.queryByRole('complementary', { name: 'Session cards' })).toBeNull();
    expect(icon.getAttribute('aria-pressed')).toBe('false');
  });

  it('is titled by its listed row', () => {
    expect(toolbarTitle(sessionTab(REMOTE), new Map(), null, null, useSessions.getState().listed)).toEqual({ title: 'Ship the relay', branch: null });
    expect(toolbarTitle(sessionTab(A), new Map(), null, null, useSessions.getState().listed).title).toBe('New chat'); // no record, no row
  });
});

// The UX wave, U9 (S-02, O-48; Interfaces §6): the title bar's session menu of another machine's lane B session offers its
// acts over the link as its row's menu does (Rename… and Archive when its listing says it is yours), each disabled with
// the helper's sentence in the gap its item draws: on a machine whose build doesn't list `rl2.session-acts`, the update
// sentence (A14).
describe('another machine’s lane B session in the toolbar', () => {
  const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
  beforeEach(() => {
    useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: '2026-11-13T10:00:00Z', generation: 1, capabilities: ['rl2.project-acts'], owner: true }]);
    useSessions.setState({
      records: new Map([[REMOTE, record(REMOTE, { title: { text: 'Studio build', source: 'user' } })]]),
      listed: new Map([[REMOTE, { ...remoteRow(OTHER_MACHINE, 'app-r', { title: 'Studio build' }), appId: REMOTE }]]),
      listedMachines: new Set([OTHER_MACHINE]),
    });
  });
  afterEach(() => useMachines.setState({ roster: 'unread', machines: new Map() }));

  it('holds Rename…, Fork and Archive, each disabled with the update sentence on a machine that doesn’t serve them', async () => {
    const user = userEvent.setup();
    offs.push(registerShellActions(fakeBridge()));
    for (const id of ['rename', 'fork', 'archive'] as const) offs.push((await import('./session-actions')).registerSessionAction(id, vi.fn()));
    renderShell();
    act(() => useLayout.setState({ main: withActive(sessionTab(REMOTE)) }));
    await user.click(screen.getByRole('button', { name: 'More surfaces' }));
    const actions = await screen.findByRole('menuitem', { name: 'Session actions' });
    act(() => actions.focus());
    await user.keyboard('{ArrowRight}');
    const menu = (await screen.findByRole('menuitem', { name: 'Rename…' })).closest<HTMLElement>('[role="menu"]')!;
    const items = within(menu).getAllByRole('menuitem').filter((i) => ['Rename…', 'Fork', 'Archive'].includes(i.textContent ?? ''));
    expect(items.map((i) => [i.textContent, i.getAttribute('aria-disabled'), i.getAttribute('title')])).toEqual([
      ['Rename…', 'true', 'Can’t rename on Studio yet. Update MAWS on Studio and try again.'],
      ['Fork', 'true', 'Can’t fork on Studio yet. Update MAWS on Studio and try again.'],
      ['Archive', 'true', 'Can’t archive on Studio yet. Update MAWS on Studio and try again.'],
    ]);
  });
});

describe('shell actions', () => {
  it('toggle the sidebar and panel, maximize and restore the panel', () => {
    openSurface('terminal'); // `surface.terminal` below selects it again
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
    expect(grid().style.gridTemplateColumns).toBe('240px minmax(0, 1fr) 360px'); // UX wave U8b: a narrow tool's automatic width
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
    useSessions.setState({ records: new Map([[A, record(A, { pinned: false })]]) });
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
    expect(within(region('panel')).getByRole('button', { name: 'Hide side column' })).toBeTruthy();
  });

  it('hands a registered host the session’s effective tabs and splits its changes back by pin', async () => {
    let props: PanelHostProps | null = null;
    registerSlot('panelHost', (p) => {
      props = p;
      return <div>host</div>;
    });
    useSessions.setState({ records: new Map([[A, record(A)]]) });
    useLayout.setState({
      main: withActive(sessionTab(A)),
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

  // UX wave U8b (M2): the host's writes maintain the pins; what is in view with no session is chosen by showSurfaceTab
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
    expect(props!.activeTabId).toBeNull(); // a write of the list chooses nothing
    act(() => useLayout.getState().showSurfaceTab(null, 'p2'));
    expect(props!.activeTabId).toBe('p2');
    act(() => useLayout.getState().showSurfaceTab(null, 'p1'));
    expect(props!.activeTabId).toBe('p1');
    act(() => useLayout.getState().showSurfaceTab(null, 'p2'));
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
// UX wave U7b (O-40): the library is a page beside the sidebar, opened by the row, the action and "Open library"; it adds
// no tab, and a maximized or floating side column is left as it is (a page covers it, and Back finds it as it was).
describe('the Artifacts entry', () => {
  it('the sidebar row opens the library’s page, named in the title bar, and adds no tab; a second click keeps it', async () => {
    const user = userEvent.setup();
    const previousBridge = window.maws;
    const counts = { document: 0, presentation: 0, design: 0, design_system: 0, dashboard: 0, html: 0, file: 0 };
    window.maws = fakeClient({ 'library.list': { rows: [], counts }, 'library.spaces': { spaces: [] } }).client as unknown as PreloadBridge; // P5 O6 M2: main's side
    offs.push(() => {
      window.maws = previousBridge;
      resetLibrary();
    });
    registerSlot('artifactsLibrary', Library);
    renderShell();
    const strip = useLayout.getState().main;
    const sidebar = region('sidebar');
    const row = within(sidebar).getByRole('button', { name: 'Artifacts' });
    expect(within(sidebar).getByRole('button', { name: 'Projects' }).nextElementSibling).toBe(row);
    expect(row.getAttribute('aria-current')).toBeNull();

    await user.click(row);
    expect(useLayout.getState().destination).toEqual({ kind: 'library' });
    expect(useLayout.getState().main).toBe(strip);
    const header = document.querySelector<HTMLElement>('[data-toolbar]')!;
    expect(within(header).getByRole('heading', { level: 1, name: 'Artifacts' })).toBeTruthy();
    const page = document.getElementById('region-page')!;
    expect(within(page).getByRole('radiogroup', { name: 'View' })).toBeTruthy();
    expect(within(page).getByRole('searchbox', { name: 'Search artifacts' })).toBeTruthy();
    expect(row.getAttribute('aria-current')).toBe('page');

    await user.click(row);
    expect(useLayout.getState().destination).toEqual({ kind: 'library' });
    expect(useLayout.getState().main).toBe(strip);
    expect(row.getAttribute('aria-current')).toBe('page');
  });

  describe.each([
    ['floating', { floating: true }],
    ['maximized', { maximized: true }],
  ] as const)('from a %s panel', (how, patch) => {
    const startHidden = () => {
      openSurface();
      useLayout.getState().setPanel(patch);
      renderShell();
      expect(region('main').inert).toBe(true);
    };
    const expectPage = () => {
      expect(useLayout.getState().destination).toEqual({ kind: 'library' });
      expect(useLayout.getState().regions.panel[how], 'the side column is left as it was').toBe(true);
      expect(document.getElementById('region-page')).not.toBeNull();
    };

    it('the sidebar row opens the library’s page and leaves the panel as it was', async () => {
      const user = userEvent.setup();
      startHidden();
      await user.click(within(region('sidebar')).getByRole('button', { name: 'Artifacts' }));
      expectPage();
    });

    it('the artifacts.open action opens the library’s page and leaves the panel as it was', () => {
      offs.push(registerShellActions(fakeBridge()));
      startHidden();
      act(() => runAction('artifacts.open'));
      expectPage();
    });
  });

  it('draws the library a later child registers into the slot, on its page', () => {
    registerSlot('artifactsLibrary', () => <section aria-label="Library">library</section>);
    useLayout.setState({ destination: { kind: 'library' } });
    renderShell();
    expect(within(document.getElementById('region-page')!).getByRole('region', { name: 'Library' })).toBeTruthy();
    expect(screen.queryByText('Artifacts unavailable')).toBeNull();
  });

  it('the artifacts.open action opens the library’s page over the tabs, which it leaves as they were', () => {
    offs.push(registerShellActions(fakeBridge()));
    useLayout.getState().openTab({ kind: 'diagnostics' });
    const strip = useLayout.getState().main;
    runAction('artifacts.open');
    expect(useLayout.getState().destination).toEqual({ kind: 'library' });
    runAction('artifacts.open');
    expect(useLayout.getState().destination).toEqual({ kind: 'library' });
    expect(useLayout.getState().main).toBe(strip);
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
    fake.event('attention.notified', { appSessionId: A, attentionId: at('att-a'), delivery: 'fallback', at: '2026-10-02T10:00:00Z' });
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
  useLayout.getState().openTab({ kind: 'file', path: '/one.ts', line: null, appSessionId: null, machine: TEST_MACHINE });
  useLayout.getState().openTab({ kind: 'file', path: '/two.ts', line: null, appSessionId: null, machine: TEST_MACHINE });
  useLayout.getState().openTab({ kind: 'file', path: '/three.ts', line: null, appSessionId: null, machine: TEST_MACHINE });
  renderShell();
  act(() => (from === 'tab' ? screen.getByRole('tab', { name: /three.ts/ }) : screen.getByRole('textbox', { name: 'File content' })).focus());
  act(() => runAction('tab.close'));
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tab', { name: /two.ts/ })));
  await user.keyboard('{Control>}{Tab}{/Control}');
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tab', { name: /one.ts/ })));
});

it('closing the last split tab restores focus in the surviving pane; closing its last tab focuses empty-pane controls', async () => {
  offs.push(registerShellActions(fakeBridge()));
  useLayout.getState().openTab({ kind: 'file', path: '/left.ts', line: null, appSessionId: null, machine: TEST_MACHINE });
  useLayout.getState().openTab({ kind: 'file', path: '/right.ts', line: null, appSessionId: null, machine: TEST_MACHINE }, { pane: 'other' });
  renderShell();
  act(() => screen.getByRole('tab', { name: /right.ts/ }).focus());
  act(() => runAction('tab.close'));
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tab', { name: /left.ts/ })));
  act(() => runAction('tab.close'));
  await vi.waitFor(() => expect(document.activeElement).toBe(within(screen.getByRole('tabpanel')).getByRole('button', { name: /Overview/ })));
});

it('a refused Cmd+W keeps the tab and its focus', async () => {
  offs.push(registerShellActions(fakeBridge()), registerCloseGuard('file', async () => false));
  useLayout.getState().openTab({ kind: 'file', path: '/keep.ts', line: null, appSessionId: null, machine: TEST_MACHINE });
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
  window.maws = preloadOf(fake); // P5 O6 M2: main's side, asked with the bare id
  offs.push(() => { window.maws = previousBridge; closeDialog(); resetSetupStore(); });
  offs.push(registerCloseGuard('session', async (ref) => ref.kind === 'session' && await beforeCloseUnstarted(ref.appSessionId) === 'closed'));
  putIntent(intent({ appSessionId: at(ID), draft: { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'keep my draft' }] }] }, attachments: [], updatedAt: '2026-09-29T10:00:00.000Z' } }));
  useLayout.getState().openTab({ kind: 'session', appSessionId: at(ID) });
  useLayout.getState().openTab({ kind: 'file', path: '/survivor.ts', line: null, appSessionId: null, machine: TEST_MACHINE });
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
  useLayout.getState().openTab({ kind: 'file', path: '/left-survivor.ts', line: null, appSessionId: null, machine: TEST_MACHINE });
  useLayout.getState().openTab({ kind: 'file', path: '/left-close.ts', line: null, appSessionId: null, machine: TEST_MACHINE });
  useLayout.getState().openTab({ kind: 'file', path: '/right.ts', line: null, appSessionId: null, machine: TEST_MACHINE }, { pane: 'other' });
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
  useLayout.getState().openTab({ kind: 'file', path: '/menu-close.ts', line: null, appSessionId: null, machine: TEST_MACHINE });
  useLayout.getState().openTab({ kind: 'file', path: '/menu-survivor.ts', line: null, appSessionId: null, machine: TEST_MACHINE });
  if (active) useLayout.getState().activateTab(`file:${TEST_MACHINE}:/menu-close.ts`);
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

// UX wave U7b (docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md, M5 decisions 2, 3 and 5):
// a page takes everything right of the sidebar. What it covers stays mounted at its box, invisible and inert, and nothing
// of the side column is written; Back shows it all again without a remount.
describe('a page beside the sidebar', () => {
  const PAGE = { kind: 'projects' } as const;
  // The shell's wrapper around the main area's content; the title bar by its mark (a page may hold a banner of its own).
  const mainArea = () => document.querySelector<HTMLElement>('[data-behind-page]')!;
  const hiddenNow = (element: HTMLElement) => [element.classList.contains('invisible'), element.hasAttribute('inert')];
  const header = () => document.querySelector<HTMLElement>('[data-toolbar]')!;
  const strips = () => header().querySelector<HTMLElement>('[data-chrome-tabs]')!;

  it('with the card column drawn: the main area and the column keep their nodes, the grid and the padding, hidden; Back shows them', () => {
    useSessions.setState({ records: new Map([[A, record(A)]]) });
    useLayout.setState({ main: withActive(sessionTab(A)) });
    renderShell();
    const [area, cards, columns] = [mainArea(), region('cards'), grid().style.gridTemplateColumns];
    const padding = area.parentElement!.style.paddingRight;
    expect(padding).toBe('304px');
    act(() => useLayout.getState().openDestination(PAGE));
    expect([mainArea(), region('cards')]).toEqual([area, cards]);
    expect([hiddenNow(area), hiddenNow(cards)]).toEqual([[true, true], [true, true]]);
    expect([grid().style.gridTemplateColumns, area.parentElement!.style.paddingRight]).toEqual([columns, padding]);
    expect(region('main').hasAttribute('inert'), 'the main region stays as it is: only its content is hidden').toBe(false);
    expect(header().className).toContain('col-span-3');
    act(() => useLayout.getState().closeDestination());
    expect([mainArea(), region('cards')]).toEqual([area, cards]);
    expect([hiddenNow(area), hiddenNow(cards)]).toEqual([[false, false], [false, false]]);
    expect(header().className).toContain('col-span-2');
  });

  it('with a side surface open: the side column is not drawn and nothing of it is written; Back restores it as it was', () => {
    openSurface();
    renderShell();
    const fake = fakeClient({ 'layout.set': undefined });
    offs.push(persistLayout(fake.client, useLayout)); // from here, what the visit writes
    const panel = region('panel');
    const columns = grid().style.gridTemplateColumns;
    const before = { regions: useLayout.getState().regions, surfaces: useLayout.getState().panelSurfaces, tabs: useLayout.getState().panelBySession.get(A)!.tabs };
    act(() => useLayout.getState().openDestination(PAGE));
    expect(region('panel')).toBe(panel);
    expect(hiddenNow(panel)).toEqual([true, true]);
    expect(grid().style.gridTemplateColumns).toBe(columns);
    expect(header().className, 'the title bar spans to the window’s right edge').toContain('col-span-3');
    act(() => useLayout.getState().closeDestination());
    window.dispatchEvent(new Event('beforeunload'));
    const after = { regions: useLayout.getState().regions, surfaces: useLayout.getState().panelSurfaces, tabs: useLayout.getState().panelBySession.get(A)!.tabs };
    expect([after.regions === before.regions, after.surfaces === before.surfaces, after.tabs === before.tabs]).toEqual([true, true, true]);
    expect((fake.invoked('layout.set') as { key: string }[]).map((write) => write.key).filter((key) => key !== 'destination')).toEqual([]);
    expect(region('panel')).toBe(panel);
    expect(hiddenNow(panel)).toEqual([false, false]);
  });

  // The first Mac run (the wave architect's ruling): the side column holds column 3 of rows 1 to 3 whether it is drawn or
  // not, so a span of three with no start of its own is placed past it, in columns the grid adds after the third, which
  // take the main track's width and leave the page narrower than the window. Each spanning row starts at the first column.
  it('the title bar and the banner row start at the first column under a page, beside the side column’s three rows', () => {
    openSurface();
    renderShell();
    const banner = () => document.querySelector<HTMLElement>('[data-banner-host]')!;
    const classes = (element: HTMLElement) => element.className.split(/\s+/);
    expect(classes(region('panel')), 'the side column keeps column 3 of rows 1 to 3').toEqual(expect.arrayContaining(['col-start-3', 'row-span-3', 'row-start-1']));
    act(() => useLayout.getState().openDestination(PAGE));
    expect(classes(header())).toEqual(expect.arrayContaining(['col-start-1', 'col-span-3', 'row-start-1']));
    expect(classes(banner())).toEqual(expect.arrayContaining(['col-start-1', 'col-span-3', 'row-start-2']));
    act(() => useLayout.getState().closeDestination());
    expect(classes(header())).toEqual(expect.arrayContaining(['col-span-2', 'row-start-1']));
    expect(classes(banner())).toEqual(expect.arrayContaining(['col-span-2', 'row-start-2']));
  });

  it('draws the page over the second and third columns of the third row, named by the title bar’s Back and heading', async () => {
    const user = userEvent.setup();
    useSessions.setState({ records: new Map([[A, record(A)]]) });
    useLayout.setState({ main: withActive(sessionTab(A)) });
    renderShell();
    act(() => useLayout.getState().openDestination(PAGE));
    const page = document.getElementById('region-page')!;
    expect(page.getAttribute('aria-labelledby')).toBe(within(header()).getByRole('heading', { level: 1 }).id);
    expect(page.className).toContain('col-[2/-1]');
    expect(page.className).toContain('row-start-3');
    expect(within(header()).getByRole('heading', { level: 1, name: 'Projects' })).toBeTruthy();
    expect(within(header()).queryByRole('button', { name: 'Session cards' }), 'the surface icons are not drawn').toBeNull();
    expect(within(header()).queryByRole('button', { name: /in sidebar$/ }), 'nor the project chip').toBeNull();
    expect(hiddenNow(strips()), 'the strips stay mounted, hidden').toEqual([true, true]);
    expect(within(header()).getByRole('button', { name: 'Back' }).getAttribute('title')).toBe('Back · Esc');
    await user.click(within(header()).getByRole('button', { name: 'Back' }));
    expect(useLayout.getState().destination).toBeNull();
    expect(hiddenNow(strips())).toEqual([false, false]);
  });

  it('the Overview opened over a page is inside no inert element, and the page stays', () => {
    useSessions.setState({ records: new Map([[A, record(A)]]) });
    useLayout.setState({ main: withActive(sessionTab(A)) });
    renderShell();
    act(() => useLayout.getState().openDestination(PAGE));
    act(() => useLayout.getState().setOverviewOpen(true));
    const overview = document.querySelector<HTMLElement>('[data-overview-panel]')!;
    expect(overview).not.toBeNull();
    expect(overview.closest('[inert]')).toBeNull();
    expect(useLayout.getState().destination).toEqual(PAGE);
  });

  // The M5 review: a maximized or floating side column leaves the main track 0 px wide, so over a page the Overview's one
  // host is placed over the page's box (fixed, at the page region's rect); it stays in the main region and is never
  // remounted, and the main area keeps its node, its box and the grid.
  const PAGE_BOX = { left: 240, top: 40, width: 1200, height: 860 };
  const measured = () => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const { left, top, width, height } = this.id === 'region-page' ? PAGE_BOX : { left: 0, top: 0, width: 0, height: 0 };
    return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
  });
  const host = () => document.querySelector<HTMLElement>('[data-overview-host]')!;
  const overviewPanel = () => document.querySelector<HTMLElement>('[data-overview-panel]');

  it.each(['maximized', 'floating'] as const)('with the side surface %s, the Overview over a page is placed over the page’s box, not the main track', (how) => {
    const rect = measured();
    openSurface();
    useLayout.getState().setPanel({ collapsed: false, [how]: true });
    renderShell();
    const [area, columns] = [mainArea(), grid().style.gridTemplateColumns];
    const padding = area.parentElement!.style.paddingRight;
    expect(host().className.split(' ')).toEqual(expect.arrayContaining(['absolute', 'inset-0']));
    act(() => useLayout.getState().openDestination(PAGE));
    act(() => useLayout.getState().setOverviewOpen(true));
    expect(useLayout.getState().regions.panel[how], 'the Overview over a page docks nothing').toBe(true);
    const overview = overviewPanel()!;
    expect(overview.closest('[data-overview-host]')).toBe(host());
    expect(host().className.split(' ')).toEqual(expect.arrayContaining(['fixed', 'z-30']));
    expect([host().style.left, host().style.top, host().style.width, host().style.height]).toEqual(['240px', '40px', '1200px', '860px']);
    expect(region('main').contains(overview), 'still in the main region').toBe(true);
    expect(overview.closest('[inert]')).toBeNull();
    expect([mainArea(), grid().style.gridTemplateColumns, area.parentElement!.style.paddingRight]).toEqual([area, columns, padding]);
    act(() => useLayout.getState().setOverviewOpen(false));
    act(() => useLayout.getState().closeDestination());
    expect(useLayout.getState().regions.panel[how], 'Back shows the column as it was').toBe(true);
    expect(host().className.split(' ')).toEqual(expect.arrayContaining(['absolute', 'inset-0']));
    expect(host().getAttribute('style')).toBeNull();
    rect.mockRestore();
  });

  it('a page opened with the Overview open from a focused sidebar row leaves the keyboard on the row and the Overview the same node; Back does not pull the keyboard into it', () => {
    useSessions.setState({ records: new Map([[A, record(A)]]) });
    useLayout.setState({ main: withActive(sessionTab(A)) });
    renderShell();
    act(() => useLayout.getState().setOverviewOpen(true));
    const overview = overviewPanel()!;
    const row = within(region('sidebar')).getByRole('button', { name: 'Projects' });
    act(() => row.focus());
    act(() => useLayout.getState().openDestination(PAGE));
    expect(document.activeElement).toBe(row);
    expect(overviewPanel()).toBe(overview);
    act(() => useLayout.getState().closeDestination());
    expect(document.activeElement).toBe(row);
    expect(overviewPanel()).toBe(overview);
    expect(useLayout.getState().overviewOpen).toBe(true);
  });

  // The branch review: the Overview opened from what a page then covers cannot give the keyboard back there; it goes to
  // the page.
  it('the Overview closed while a page covers the element it opened from gives the keyboard to the page', () => {
    useSessions.setState({ records: new Map([[A, record(A)]]) });
    useLayout.setState({ main: withActive(sessionTab(A)) });
    renderShell();
    const tab = within(chromeTabs()).getByRole('tab', { selected: true });
    act(() => tab.focus());
    act(() => useLayout.getState().setOverviewOpen(true));
    expect(document.activeElement).toBe(overviewPanel());
    act(() => useLayout.getState().openDestination(PAGE));
    expect(tab.closest('[inert]'), 'the opener is under the page').not.toBeNull();
    act(() => useLayout.getState().setOverviewOpen(false));
    expect(overviewPanel()).toBeNull();
    expect(document.activeElement).toBe(document.getElementById('region-page'));
  });

  it('⌘W closes the Settings dialog, then the page, and only then the tab in front', () => {
    offs.push(registerShellActions(fakeClient({}).client));
    useSessions.setState({ records: new Map([[A, record(A)]]) });
    useLayout.setState({ main: withActive(sessionTab(A)) });
    renderShell();
    act(() => useLayout.getState().openDestination(PAGE));
    act(() => useLayout.getState().openSettings());
    act(() => runAction('tab.close'));
    expect([useLayout.getState().settings, useLayout.getState().destination]).toEqual([null, PAGE]);
    act(() => runAction('tab.close'));
    expect(useLayout.getState().destination).toBeNull();
    expect(useLayout.getState().main.panes[0].tabs.map((tab) => tab.id)).toEqual([`session:${A}`]);
  });

  // §N, the second table: an act of the person's that shows nothing finds no tab in front behind a page.
  it('⌥⌘U marks nothing unread behind a page, and marks the session once the page is left', () => {
    const fake = fakeClient({ 'session.update': undefined });
    offs.push(registerShellActions(fake.client));
    useSessions.setState({ records: new Map([[A, record(A)]]) });
    useLayout.setState({ main: withActive(sessionTab(A)) });
    useLayout.getState().openDestination(PAGE);
    runAction('session.markUnread');
    expect(fake.invoked('session.update')).toEqual([]);
    useLayout.getState().closeDestination();
    runAction('session.markUnread');
    expect(fake.invoked('session.update')).toEqual([{ appSessionId: A, patch: { unread: true } }]);
  });

  // M6, decision 6 (the owner's answer to question 4): with a page open the acts on the side column only show. The page
  // is left and what was asked for ends in view; under the Settings dialog they run as today.
  describe('the side column’s acts with a page open', () => {
    const inView = (toolId: string) => !useLayout.getState().regions.panel.collapsed && surfaceTabs(useLayout.getState(), A).some((tab) => tab.toolId === toolId);
    beforeEach(() => offs.push(registerShellActions(fakeClient({}).client)));

    it('a surface’s key for a tool in view behind the page leaves the page, and the tool stays in view', () => {
      openSurface('terminal');
      renderShell();
      expect(inView('terminal')).toBe(true);
      act(() => useLayout.getState().openDestination(PAGE));
      act(() => runAction('surface.terminal'));
      expect(useLayout.getState().destination).toBeNull();
      expect(inView('terminal')).toBe(true);
    });

    it('a surface’s key for a tool not in view leaves the page and shows the tool', () => {
      offs.push(registerPanelTool(probeTool('files').tool));
      openSurface('terminal');
      renderShell();
      act(() => useLayout.getState().openDestination(PAGE));
      act(() => runAction('surface.files'));
      expect(useLayout.getState().destination).toBeNull();
      expect(inView('files')).toBe(true);
    });

    it('Session cards with the card column placed behind the page leaves the page, and the column is still shown', () => {
      useSessions.setState({ records: new Map([[A, record(A)]]) });
      useLayout.setState({ main: withActive(sessionTab(A)) });
      renderShell();
      expect(cardColumnNow(useLayout.getState(), window.innerWidth).shown).toBe(true);
      act(() => useLayout.getState().openDestination(PAGE));
      expect(cardColumnNow(useLayout.getState(), window.innerWidth)).toMatchObject({ placed: true, shown: false });
      act(() => runAction('panel.toggle'));
      expect(useLayout.getState().destination).toBeNull();
      expect(cardColumnNow(useLayout.getState(), window.innerWidth).shown).toBe(true);
    });

    it('Maximize leaves the page, then maximizes the side column', () => {
      openSurface();
      renderShell();
      act(() => useLayout.getState().openDestination(PAGE));
      act(() => runAction('panel.maximize'));
      expect(useLayout.getState().destination).toBeNull();
      expect(useLayout.getState().regions.panel).toMatchObject({ maximized: true, collapsed: false });
    });

    it('under the Settings dialog, with no page, a surface’s key hides a tool in view, as today', () => {
      openSurface('terminal');
      renderShell();
      act(() => useLayout.getState().openSettings());
      act(() => runAction('surface.terminal'));
      expect(inView('terminal')).toBe(false);
      expect(useLayout.getState().settings).toEqual({ section: null });
    });
  });
});
