import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { LAYOUT_DEFAULTS, type LayoutMain, type TabRef } from '@shared/ipc/schema/layout';
import { record } from '../../../../test/support/builders';
import { registerAction, runAction } from '../keymap/actions-runtime';
import type { PanelHostProps } from '../panel/host-slot';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { useSettings } from '../stores/settings';
import { registerShellActions } from './shell-actions';
import { Shell } from './Shell';
import { registerSlot, resetSlots } from './slots';
import { toolbarTitle } from './Toolbar';

vi.mock('./Diagnostics', () => ({ Diagnostics: () => <section aria-label="Diagnostics">diagnostics</section> }));

const A = 'app-a' as AppSessionId;
const sessionTab = (id: string): TabRef => ({ id: `session:${id}`, kind: 'session', appSessionId: id as AppSessionId, pinned: false });
const withActive = (tab: TabRef): LayoutMain => ({ ...LAYOUT_DEFAULTS.main, panes: [{ tabs: [LAYOUT_DEFAULTS.main.panes[0].tabs[0], tab], activeTabId: tab.id }] });

const region = (name: string) => document.querySelector<HTMLElement>(`[data-region="${name}"]`)!;
const grid = () => region('main').parentElement!;
const offs: (() => void)[] = [];

beforeEach(() => {
  useLayout.setState({ regions: LAYOUT_DEFAULTS.regions, main: LAYOUT_DEFAULTS.main, panelPinned: [], panelBySession: new Map(), panelActiveNoSession: null, hydrated: true });
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
    expect(within(region('main')).getByLabelText('Diagnostics')).toBeTruthy();
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
});

describe('toolbar', () => {
  it('titles the active tab: Overview, a session with its branch, a file by basename', () => {
    const records = new Map([[A, record('app-a', { title: { text: 'Fix sidebar drag', source: 'user' }, branch: 'feat/sidebar' })]]);
    expect(toolbarTitle({ id: 'overview', kind: 'overview', pinned: true }, records)).toEqual({ title: 'Overview', branch: null });
    expect(toolbarTitle(sessionTab('app-a'), records)).toEqual({ title: 'Fix sidebar drag', branch: 'feat/sidebar' });
    expect(toolbarTitle({ id: 'file:/r/src/app.ts', kind: 'file', path: '/r/src/app.ts', line: null, appSessionId: null, pinned: false }, records)).toEqual({ title: 'app.ts', branch: null });
    expect(toolbarTitle({ id: 'diagnostics', kind: 'diagnostics', pinned: false }, records).title).toBe('Diagnostics');
  });

  it('shows the focused pane’s active tab title and branch chip', () => {
    useSessions.setState({ records: new Map([[A, record('app-a', { title: { text: 'Fix sidebar drag', source: 'user' }, branch: 'feat/sidebar' })]]) });
    render(<Shell />);
    const toolbar = screen.getByRole('banner');
    expect(within(toolbar).getByText('Overview')).toBeTruthy();
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
    useSettings.setState({ state: { settings: { version: 2, theme: 'light', keymap: { 'sidebar.toggle': 'Cmd+Alt+S' }, notifications: { enabled: true, sound: false } }, resolvedTheme: 'light' } });
    render(<Shell />);
    expect(screen.getByRole('button', { name: 'Toggle sidebar' }).getAttribute('title')).toBe('Toggle sidebar · ⌘⌥S');
    useSettings.setState({ state: null });
  });

  it('the session menu is disabled on the Overview and lists the §5.1 actions for a session, unregistered ones disabled', async () => {
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
      ['Archive', true],
      ['Delete conversation…', true],
      ['Remove worktree…', true],
    ]);
    await user.click(within(menu).getByRole('menuitem', { name: 'Open in split' }));
    expect(split).toHaveBeenCalledWith(A);
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
    expect(within(region('panel')).getByText('No tools open · Tools arrive with C8')).toBeTruthy();
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

  it('with the Overview focused, round-trips the selection between two pins and falls back when the selected pin goes', () => {
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

  it('shows no session when the focused pane is on the Overview', () => {
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
