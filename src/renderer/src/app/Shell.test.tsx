import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
import { Shell } from './Shell';
import { registerSlot, resetSlots } from './slots';
import { toolbarTitle } from './Toolbar';
import { fillStores, scenarioFile } from '../test-support/shell-stores';
import { SETTINGS_DEFAULTS_V13 } from '@shared/settings/defaults';

vi.mock('./Diagnostics', () => ({ Diagnostics: () => <section aria-label="Diagnostics">diagnostics</section> }));

const A = 'app-a' as AppSessionId;
const sessionTab = (id: string): TabRef => ({ id: `session:${id}`, kind: 'session', appSessionId: id as AppSessionId, pinned: false });
const withActive = (tab: TabRef): LayoutMain => ({ ...LAYOUT_DEFAULTS.main, sets: { [NO_PROJECT]: { ...EMPTY_TAB_SET, panes: [{ tabs: [tab], activeTabId: tab.id }] } } });

const region = (name: string) => document.querySelector<HTMLElement>(`[data-region="${name}"]`)!;
const grid = () => region('main').parentElement!;
const offs: (() => void)[] = [];
// happy-dom's window, resized as a person resizes the app's (it dispatches `resize`).
const setWindowWidth = (width: number) => (window as unknown as { happyDOM: { setWindowSize(size: { width: number }): void } }).happyDOM.setWindowSize({ width });

beforeEach(() => {
  useNotices.setState({ notices: [] });
  setWindowWidth(1440); // the app window's default size
  useLayout.setState({ regions: LAYOUT_DEFAULTS.regions, main: LAYOUT_DEFAULTS.main, panelPinned: [], panelBySession: new Map(), panelActiveNoSession: null, hydrated: true, overviewOpen: false });
  useSessions.setState({ records: new Map() });
});
afterEach(() => {
  cleanup();
  resetSlots();
  offs.splice(0).forEach((off) => off());
});

describe('shell frame', () => {
  it('renders the toolbar, the three regions and two keyboard-operable resizers', () => {
    render(<Shell />);
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(['sidebar', 'main', 'panel'].map((name) => region(name).dataset.region)).toEqual(['sidebar', 'main', 'panel']);
    const separators = screen.getAllByRole('separator');
    expect(separators.map((s) => [s.getAttribute('aria-controls'), s.getAttribute('aria-valuenow')])).toEqual([
      [region('sidebar').id, '300'],
      [region('panel').id, '380'],
    ]);
  });

  it('keeps the wordmark in the sidebar body and leaves title-bar navigation reachable when collapsed', () => {
    fillStores(scenarioFile('empty'));
    render(<Shell />);
    const toolbar = screen.getByRole('banner');
    expect(within(toolbar).queryByText('MAWS')).toBeNull();
    const wordmark = within(region('sidebar')).getByText('MAWS');
    const newChat = within(region('sidebar')).getByRole('button', { name: 'New chat' });
    expect(wordmark.nextElementSibling).toBe(newChat);
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
    render(<Shell />);
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
    useLayout.getState().setPanel({ width: 444 });
    render(<Shell />);
    await user.click(screen.getByRole('button', { name: 'Maximize right panel' }));
    expect(region('main').inert).toBe(true);
    expect(grid().style.gridTemplateColumns).toBe('300px 0px minmax(0, 1fr)');
    const toggle = within(screen.getByRole('banner')).getByRole('button', { name: 'Overview' });
    expect((toggle as HTMLButtonElement).disabled).toBe(false);
    await user.click(toggle);
    expect(region('main').inert).toBe(false);
    expect(grid().style.gridTemplateColumns).toBe('300px minmax(0, 1fr) 444px');
    const dialog = within(region('main')).getByRole('dialog', { name: 'Overview' });
    expect(document.activeElement).toBe(dialog);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(useLayout.getState().regions.panel).toEqual({ width: 444, collapsed: false, maximized: false, floating: false });
    await user.click(toggle);
    expect(screen.queryByRole('dialog', { name: 'Overview' })).toBeNull();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(region('main').inert).toBe(false);
  });

  it('mounts the usage slot before the session actions and panel toggle in the title-bar toolbar', () => {
    registerSlot('topBarEnd', () => <button type="button">Usage</button>);
    render(<Shell />);
    const toolbar = screen.getByRole('banner');
    const usage = within(toolbar).getByRole('button', { name: 'Usage' });
    const end = usage.parentElement!;
    expect(end.className).toContain('[-webkit-app-region:no-drag]');
    expect(end.nextElementSibling).toBe(within(toolbar).getByRole('button', { name: 'Session actions' }));
    expect(within(toolbar).getByRole('button', { name: 'Toggle right panel' })).toBeTruthy();
  });

  it('lays the regions on a grid whose columns are the layout store’s widths', () => {
    render(<Shell />);
    expect(grid().style.gridTemplateColumns).toBe('300px minmax(0, 1fr) 380px');
    act(() => useLayout.getState().setSidebar({ width: 240 }));
    act(() => useLayout.getState().setPanel({ width: 320 }));
    expect(grid().style.gridTemplateColumns).toBe('240px minmax(0, 1fr) 320px');
  });

  it('a collapsed region gets a zero column, goes inert and loses its resizer', () => {
    render(<Shell />);
    act(() => useLayout.getState().setSidebar({ collapsed: true }));
    expect(grid().style.gridTemplateColumns).toBe('0px minmax(0, 1fr) 380px');
    expect(region('sidebar').inert).toBe(true);
    act(() => useLayout.getState().setPanel({ collapsed: true }));
    expect(grid().style.gridTemplateColumns).toBe('0px minmax(0, 1fr) 0px');
    expect(region('panel').inert).toBe(true);
    expect(screen.queryAllByRole('separator')).toHaveLength(0);
  });

  it('a maximized panel takes the main column and the main region stays mounted', () => {
    render(<Shell />);
    act(() => useLayout.getState().setPanel({ maximized: true }));
    expect(grid().style.gridTemplateColumns).toBe('300px 0px minmax(0, 1fr)');
    expect(region('main').inert).toBe(true);
    expect(within(region('main')).getByRole('tablist', { name: 'Open tabs' })).toBeTruthy();
    expect(screen.getAllByRole('separator').map((s) => s.getAttribute('aria-controls'))).toEqual([region('sidebar').id]);
  });

  it('a resizer writes its width to the layout store', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    screen.getAllByRole('separator')[1].focus();
    await user.keyboard('{ArrowLeft}');
    expect(useLayout.getState().regions.panel.width).toBe(388);
    screen.getAllByRole('separator')[0].focus();
    await user.keyboard('{Home}');
    expect(useLayout.getState().regions.sidebar.width).toBe(200);
  });

  it('a persisted width outside the bounds renders clamped', () => {
    useLayout.setState({ regions: { ...LAYOUT_DEFAULTS.regions, sidebar: { ...LAYOUT_DEFAULTS.regions.sidebar, width: 900 } } });
    render(<Shell />);
    expect(grid().style.gridTemplateColumns).toBe('480px minmax(0, 1fr) 380px');
  });

  it('keeps the main column at least 480 px wide at the 960 px minimum window, the panel yielding first', () => {
    const regions = LAYOUT_DEFAULTS.regions;
    useLayout.setState({ regions: { ...regions, sidebar: { ...regions.sidebar, width: 480 }, panel: { ...regions.panel, width: 640 } } });
    render(<Shell />);
    expect(grid().style.gridTemplateColumns).toBe('480px minmax(0, 1fr) 480px'); // 1440 wide: main keeps 480
    act(() => setWindowWidth(960));
    expect(grid().style.gridTemplateColumns).toBe('200px minmax(0, 1fr) 280px'); // 960 - 200 - 280 = 480
    const bounds = () => screen.getAllByRole('separator').map((s) => [s.getAttribute('aria-valuenow'), s.getAttribute('aria-valuemax')]);
    expect(bounds()).toEqual([['200', '200'], ['280', '280']]);
    act(() => useLayout.getState().setPanel({ collapsed: true })); // the sidebar may take the panel's room
    expect(grid().style.gridTemplateColumns).toBe('480px minmax(0, 1fr) 0px');
    act(() => useLayout.getState().setPanel({ collapsed: false }));
    act(() => setWindowWidth(1100)); // 620 px of room: the sidebar keeps 340 beside the panel's 280
    expect(grid().style.gridTemplateColumns).toBe('340px minmax(0, 1fr) 280px');
    act(() => useLayout.getState().setPanel({ maximized: true })); // the maximized panel is the main column
    expect(grid().style.gridTemplateColumns).toBe('480px 0px minmax(0, 1fr)');
    act(() => useLayout.getState().setPanel({ maximized: false }));
    act(() => setWindowWidth(1440)); // the persisted widths were never touched
    expect(grid().style.gridTemplateColumns).toBe('480px minmax(0, 1fr) 480px');
    expect([useLayout.getState().regions.sidebar.width, useLayout.getState().regions.panel.width]).toEqual([480, 640]);
  });

  it('a drag-collapse of a clamped region keeps its persisted width, so it reopens at that size', () => {
    const regions = LAYOUT_DEFAULTS.regions;
    useLayout.setState({ regions: { ...regions, sidebar: { ...regions.sidebar, width: 480 }, panel: { ...regions.panel, width: 640 } } });
    setWindowWidth(960);
    render(<Shell />);
    const sidebarHandle = screen.getByRole('separator', { name: 'Resize sidebar' });
    const panelHandle = () => screen.getByRole('separator', { name: 'Resize right panel' });
    const dragBy = (handle: HTMLElement, dx: number) => {
      act(() => void fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 500 }));
      act(() => void fireEvent.pointerMove(handle, { pointerId: 1, clientX: 500 + dx }));
    };
    dragBy(sidebarHandle, -50); // shown at 200 (persisted 480): 50 px leftwards is past the collapse threshold
    expect(useLayout.getState().regions.sidebar).toMatchObject({ collapsed: true, width: 480 });
    dragBy(panelHandle(), 250); // shown at 480 beside the collapsed sidebar (persisted 640): collapsed
    expect(useLayout.getState().regions.panel).toMatchObject({ collapsed: true, width: 640 });
  });
});

describe('toolbar', () => {
  it('titles the active tab: nothing for an empty pane, a session with its branch, a file by basename', () => {
    const records = new Map([[A, record('app-a', { title: { text: 'Fix sidebar drag', source: 'user' }, branch: 'feat/sidebar' })]]);
    expect(toolbarTitle(null, records)).toEqual({ title: '', branch: null });
    expect(toolbarTitle(sessionTab('app-a'), records)).toEqual({ title: 'Fix sidebar drag', branch: 'feat/sidebar' });
    expect(toolbarTitle({ id: 'file:/r/src/app.ts', kind: 'file', path: '/r/src/app.ts', line: null, appSessionId: null, pinned: false }, records)).toEqual({ title: 'app.ts', branch: null });
    expect(toolbarTitle({ id: 'diagnostics', kind: 'diagnostics', pinned: false }, records).title).toBe('Diagnostics');
    // E2: a deliverable tab by its record's title, else "Deliverable" until the store holds the record
    const deliverable = { id: 'deliverable:app-a:d1', kind: 'deliverable', appSessionId: A, deliverableId: 'd1', pinned: false } as const;
    expect(toolbarTitle(deliverable, records, 'Dashboard')).toEqual({ title: 'Dashboard', branch: null });
    expect(toolbarTitle(deliverable, records)).toEqual({ title: 'Deliverable', branch: null });
    // E4a: a browser tab by its page's title (else host), else "Browser" until the browser store lists the tab
    const browser = { id: 'browser:app-a:b_000000000001', kind: 'browser', appSessionId: A, browserTabId: 'b_000000000001', pinned: false } as const;
    expect(toolbarTitle(browser, records, null, 'Page A')).toEqual({ title: 'Page A', branch: null });
    expect(toolbarTitle(browser, records)).toEqual({ title: 'Browser', branch: null });
    // W9 (H2): the engine's HEAD (a folder that is no repository) is no branch, so no chip
    expect(toolbarTitle(sessionTab('app-a'), new Map([[A, record('app-a', { branch: 'HEAD' })]])).branch).toBeNull();
  });

  it('shows the focused pane’s active tab title and branch chip', () => {
    useSessions.setState({ records: new Map([[A, record('app-a', { title: { text: 'Fix sidebar drag', source: 'user' }, branch: 'feat/sidebar' })]]) });
    render(<Shell />);
    const toolbar = screen.getByRole('banner');
    expect(within(toolbar).queryByText('Overview')).toBeNull(); // an empty pane leaves the title blank and no branch chip
    expect(within(toolbar).queryByText(/⎇/)).toBeNull();
    act(() => useLayout.setState({ main: withActive(sessionTab('app-a')) }));
    expect(within(toolbar).getByText('Fix sidebar drag')).toBeTruthy();
    expect(within(toolbar).getByText('⎇ feat/sidebar')).toBeTruthy();
  });

  it('the sidebar and panel toggles run their actions and show their state and chords', async () => {
    const user = userEvent.setup();
    const sidebar = vi.fn();
    const panel = vi.fn();
    offs.push(registerAction('sidebar.toggle', sidebar), registerAction('panel.toggle', panel));
    render(<Shell />);
    const panelToggle = screen.getByRole('button', { name: 'Toggle right panel' });
    expect(panelToggle.getAttribute('aria-pressed')).toBe('true');
    expect(panelToggle.getAttribute('title')).toBe('Toggle right panel · ⌘⇧B');
    await user.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
    await user.click(panelToggle);
    expect(sidebar).toHaveBeenCalledOnce();
    expect(panel).toHaveBeenCalledOnce();
  });

  it('shows a rebound chord in the tooltip', () => {
    useSettings.setState({ state: { settings: { ...SETTINGS_DEFAULTS_V13, keymap: { 'sidebar.toggle': 'Cmd+Alt+S' } }, resolvedTheme: 'light' } });
    render(<Shell />);
    expect(screen.getByRole('button', { name: 'Toggle sidebar' }).getAttribute('title')).toBe('Toggle sidebar · ⌘⌥S');
    useSettings.setState({ state: null });
  });

  it('the session menu is disabled with no tab open and lists the §5.1 actions for a session, unregistered ones disabled', async () => {
    const user = userEvent.setup();
    useSessions.setState({ records: new Map([[A, record('app-a')]]) });
    render(<Shell />);
    expect((screen.getByRole('button', { name: 'Session actions' }) as HTMLButtonElement).disabled).toBe(true);
    const split = vi.fn();
    offs.push(registerShellActions(fakeBridge()), (await import('./session-actions')).registerSessionAction('openInSplit', split));
    act(() => useLayout.setState({ main: withActive(sessionTab('app-a')) }));
    await user.click(screen.getByRole('button', { name: 'Session actions' }));
    const menu = await screen.findByRole('menu');
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
    const nine = scenarioFile('nine-sessions');
    const held = nine.sessions.find((r) => r.holder.kind === 'terminal')!;
    useSessions.setState({ records: new Map(nine.sessions.map((r) => [r.appId, r])) });
    offs.push(registerShellActions(fakeBridge()));
    render(<Shell />);
    act(() => useLayout.setState({ main: withActive(sessionTab(held.appId)) }));
    expect(within(screen.getByRole('banner')).getByText(held.title.text)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Session actions' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('shell actions', () => {
  it('toggle the sidebar and panel, maximize and restore the panel', () => {
    offs.push(registerShellActions(fakeBridge()));
    runAction('sidebar.toggle');
    expect(useLayout.getState().regions.sidebar.collapsed).toBe(true);
    runAction('sidebar.toggle');
    expect(useLayout.getState().regions.sidebar.collapsed).toBe(false);
    runAction('panel.maximize');
    expect(useLayout.getState().regions.panel).toMatchObject({ maximized: true, collapsed: false });
    runAction('panel.toggle'); // hiding a maximized panel un-maximizes it
    expect(useLayout.getState().regions.panel).toMatchObject({ maximized: false, collapsed: true });
    runAction('panel.maximize'); // maximizing a hidden panel shows it
    expect(useLayout.getState().regions.panel).toMatchObject({ maximized: true, collapsed: false });
    runAction('panel.maximize');
    expect(useLayout.getState().regions.panel).toMatchObject({ maximized: false, collapsed: false });
  });

  it.each([false, true])('the Overview action restores main and focuses the dialog when already open=%s', async (alreadyOpen) => {
    const user = userEvent.setup();
    offs.push(registerShellActions(fakeBridge()));
    render(<Shell />);
    if (alreadyOpen) act(() => runAction('tab.overview'));
    const previousDialog = screen.queryByRole('dialog', { name: 'Overview' });
    await user.click(screen.getByRole('button', { name: 'Maximize right panel' }));
    expect(region('main').inert).toBe(true);
    act(() => runAction('tab.overview'));
    expect(region('main').inert).toBe(false);
    expect(grid().style.gridTemplateColumns).toBe('300px minmax(0, 1fr) 380px');
    const dialog = within(region('main')).getByRole('dialog', { name: 'Overview' });
    if (alreadyOpen) expect(dialog).toBe(previousDialog);
    await vi.waitFor(() => expect(document.activeElement).toBe(dialog));
    act(() => screen.getByRole('button', { name: 'Maximize right panel' }).focus());
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
  it('renders the panel host fallback and its header controls', () => {
    render(<Shell />);
    expect(within(region('panel')).getByText('No tools open')).toBeTruthy();
    expect(within(region('panel')).getByRole('button', { name: 'Maximize right panel' })).toBeTruthy();
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
    render(<Shell />);
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
    render(<Shell />);
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
    render(<Shell />);
    expect(props!).toMatchObject({ appSessionId: null, tabs: [], activeTabId: null });
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
  useLayout.getState().setPanel({ maximized: true, collapsed: false });
  render(<Shell />);
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
  render(<Shell />);
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
  render(<Shell />);
  act(() => screen.getByRole('tab', { name: /right.ts/ }).focus());
  act(() => runAction('tab.close'));
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tab', { name: /left.ts/ })));
  act(() => runAction('tab.close'));
  await vi.waitFor(() => expect(document.activeElement).toBe(within(screen.getByRole('tabpanel')).getByRole('button', { name: /Overview/ })));
});

it('a refused Cmd+W keeps the tab and its focus', async () => {
  offs.push(registerShellActions(fakeBridge()), registerCloseGuard('file', async () => false));
  useLayout.getState().openTab({ kind: 'file', path: '/keep.ts', line: null, appSessionId: null });
  render(<Shell />);
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
  render(<><Shell /><SessionDialogs /></>);
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
  render(<Shell />);
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
  render(<Shell />);
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
