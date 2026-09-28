import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { fakeClient } from '../../../../test/support/fake-client';
import type { TabRef } from '@shared/ipc/schema/layout';
import { record } from '../../../../test/support/builders';
import { registerShellActions } from '../app/shell-actions';
import { Shell } from '../app/Shell';
import { resetSlots } from '../app/slots';
import { createSession, registerCloseGuard, registerSessionCreator, registerUnstartedTitle, runAction } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
import { activeTab } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import { fillStores, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { TAB_DRAG_TYPE } from './TabStrip';

vi.mock('../app/Diagnostics', () => ({ Diagnostics: () => <section aria-label="Diagnostics">diagnostics</section> }));

const nine = scenarioFile('nine-sessions');
const idOf = (title: string) => nine.sessions.find((r) => r.title.text === title)!.appId;
const offs: (() => void)[] = [];

const main = () => document.querySelector<HTMLElement>('[data-region="main"]')!;
const strips = () => within(main()).getAllByRole('tablist');
const tabNames = (strip = strips()[0]) => within(strip).getAllByRole('tab').map((t) => t.getAttribute('aria-label'));
const tab = (name: string) => within(main()).getByRole('tab', { name });
const selected = (strip = strips()[0]) => within(strip).getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')?.getAttribute('aria-label');
const sidebarRow = (title: string) => within(document.querySelector<HTMLElement>('[data-region="sidebar"]')!).getByRole('treeitem', { name: title });

// A DataTransfer as a drag carries it; happy-dom's own cannot be filled from a test.
function transfer() {
  const data = new Map<string, string>();
  const types: string[] = [];
  return {
    types,
    effectAllowed: 'all',
    dropEffect: 'none',
    setData: (type: string, value: string) => {
      data.set(type, value);
      if (!types.includes(type)) types.push(type);
    },
    getData: (type: string) => data.get(type) ?? '',
    setDragImage: () => {},
  };
}

// happy-dom's DragEvent carries no pointer position, so the drop's x is set on the event itself.
function dragAt(kind: 'dragOver' | 'drop', target: HTMLElement, dataTransfer: ReturnType<typeof transfer>, clientX: number) {
  const event = createEvent[kind](target, { dataTransfer });
  Object.defineProperty(event, 'clientX', { value: clientX });
  fireEvent(target, event);
}

// Tabs laid 100 px apart from x = 0, so a drop position is a pointer x.
function layOut(strip: HTMLElement) {
  within(strip)
    .getAllByRole('tab')
    .forEach((t, i) => {
      t.getBoundingClientRect = () => ({ left: i * 100, right: i * 100 + 100, width: 100, top: 0, bottom: 30, height: 30, x: i * 100, y: 0, toJSON: () => ({}) });
    });
}

function openThree() {
  act(() => {
    useLayout.getState().openSession(idOf('Charter + research'));
    useLayout.getState().openSession(idOf('Fix sidebar drag'));
    useLayout.getState().openSession(idOf('Quota reset recovery'));
  });
}

beforeEach(() => {
  resetShellStores();
  fillStores(nine);
  offs.push(registerShellActions(fakeBridge()));
  window.maws = fakeClient({ 'attention.request': { event: null } }).client;
});
afterEach(() => {
  cleanup();
  delete (window as { maws?: MawsBridge }).maws;
  resetSlots();
  offs.splice(0).forEach((off) => off());
});

describe('tab strip reorders, closes, reopens', () => {
  it('opens on the Overview, first and without a close control', () => {
    render(<Shell />);
    expect(tabNames()).toEqual(['Overview']);
    expect(selected()).toBe('Overview');
    expect(within(tab('Overview')).queryByRole('button')).toBeNull();
    expect(within(main()).getByRole('tabpanel')).toBeTruthy();
  });

  it('opening a session from the sidebar activates its tab in the focused pane; a second open activates the existing tab', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    await user.click(sidebarRow('Charter + research'));
    expect(tabNames()).toEqual(['Overview', 'Charter + research · MAWS']);
    expect(selected()).toBe('Charter + research · MAWS');
    await user.click(tab('Overview'));
    expect(selected()).toBe('Overview');
    await user.click(sidebarRow('Charter + research'));
    expect(tabNames()).toEqual(['Overview', 'Charter + research · MAWS']);
    expect(selected()).toBe('Charter + research · MAWS');
  });

  it('shows the session glyph on its tab and the project as its secondary text', () => {
    render(<Shell />);
    openThree();
    const fix = tab('Fix sidebar drag · MAWS');
    expect(within(fix).getByRole('img', { name: 'Needs approval' }).textContent).toBe('◐');
    expect(within(fix).getByText('MAWS').tagName).toBe('SMALL');
  });

  it('⌘W on the Overview does nothing', () => {
    render(<Shell />);
    openThree();
    act(() => useLayout.getState().activateTab('overview'));
    const before = useLayout.getState().main;
    act(() => runAction('tab.close'));
    expect(useLayout.getState().main).toBe(before);
  });

  it('⌘W closes the active tab and ⌘⇧T brings it back where it was', async () => {
    render(<Shell />);
    openThree();
    act(() => useLayout.getState().activateTab(`session:${idOf('Charter + research')}`));
    await act(async () => runAction('tab.close'));
    expect(tabNames()).toEqual(['Overview', 'Fix sidebar drag · MAWS', 'Quota reset recovery · codex_somersault']);
    act(() => runAction('tab.reopen'));
    expect(tabNames()).toEqual(['Overview', 'Charter + research · MAWS', 'Fix sidebar drag · MAWS', 'Quota reset recovery · codex_somersault']);
    expect(selected()).toBe('Charter + research · MAWS');
  });

  it('the close control and a middle-click close a tab', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    openThree();
    await user.click(within(tab('Fix sidebar drag · MAWS')).getByRole('button', { name: 'Close Fix sidebar drag' }));
    expect(tabNames()).not.toContain('Fix sidebar drag · MAWS');
    await act(async () => void fireEvent(tab('Charter + research · MAWS'), new MouseEvent('auxclick', { bubbles: true, button: 1 })));
    expect(tabNames()).toEqual(['Overview', 'Quota reset recovery · codex_somersault']);
  });

  it('ArrowLeft and ArrowRight move focus along the strip, Enter activates, Delete closes', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    openThree();
    tab('Quota reset recovery · codex_somersault').focus();
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(tab('Fix sidebar drag · MAWS'));
    expect(selected()).toBe('Quota reset recovery · codex_somersault');
    await user.keyboard('{Enter}');
    expect(selected()).toBe('Fix sidebar drag · MAWS');
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(document.activeElement).toBe(tab('Overview')); // wraps
    await user.keyboard('{ArrowLeft}{Delete}');
    expect(tabNames()).toEqual(['Overview', 'Charter + research · MAWS', 'Fix sidebar drag · MAWS']);
  });

  it('⌘1…9 select tabs of the focused pane, ⌘0 the Overview', () => {
    render(<Shell />);
    openThree();
    act(() => runAction('tab.select', 2));
    expect(selected()).toBe('Charter + research · MAWS');
    act(() => runAction('tab.select', 9));
    expect(selected()).toBe('Charter + research · MAWS');
    act(() => runAction('tab.overview'));
    expect(selected()).toBe('Overview');
    act(() => runAction('tab.next'));
    expect(selected()).toBe('Charter + research · MAWS');
    act(() => runAction('tab.previous'));
    act(() => runAction('tab.previous'));
    expect(selected()).toBe('Quota reset recovery · codex_somersault');
  });

  it('dragging a tab onto another position reorders it', () => {
    render(<Shell />);
    openThree();
    const strip = strips()[0];
    layOut(strip);
    const dt = transfer();
    fireEvent.dragStart(tab('Quota reset recovery · codex_somersault'), { dataTransfer: dt });
    expect(dt.getData(TAB_DRAG_TYPE)).toBe(`session:${idOf('Quota reset recovery')}`);
    dragAt('dragOver', strip, dt, 120);
    dragAt('drop', strip, dt, 120);
    fireEvent.dragEnd(tab('Quota reset recovery · codex_somersault'), { dataTransfer: dt });
    expect(tabNames()).toEqual(['Overview', 'Quota reset recovery · codex_somersault', 'Charter + research · MAWS', 'Fix sidebar drag · MAWS']);
    expect(useLayout.getState().dragging).toBeNull();
  });

  it('dropping a sidebar row onto the strip opens that session there', () => {
    render(<Shell />);
    openThree();
    const strip = strips()[0];
    layOut(strip);
    const dt = transfer();
    fireEvent.dragStart(sidebarRow('Settings idle probe'), { dataTransfer: dt });
    dragAt('dragOver', strip, dt, 180);
    dragAt('drop', strip, dt, 180);
    expect(tabNames()[2]).toBe('Settings idle probe · claude-usage-menubar');
    expect(selected()).toBe('Settings idle probe · claude-usage-menubar');
  });

  it('pins a tab from its context menu, and pinned tabs lead the strip', async () => {
    render(<Shell />);
    openThree();
    fireEvent.contextMenu(tab('Quota reset recovery · codex_somersault'));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Pin tab' }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull()); // the menu closes and hands focus back
    expect(tabNames()).toEqual(['Overview', 'Quota reset recovery · codex_somersault', 'Charter + research · MAWS', 'Fix sidebar drag · MAWS']);
  });

  it('the Diagnostics tab opens from Help › Diagnostics and renders the strip', () => {
    render(<Shell />);
    act(() => runAction('diagnostics.open'));
    expect(selected()).toBe('Diagnostics');
    expect(within(main()).getByRole('region', { name: 'Diagnostics' })).toBeTruthy();
  });
});

describe('split', () => {
  it('dragging a tab onto the right edge opens a second pane with it; closing it collapses the split with pane 0 focused', async () => {
    render(<Shell />);
    openThree();
    expect(screen.queryByTestId('drop-edge')).toBeNull();
    const dt = transfer();
    fireEvent.dragStart(tab('Fix sidebar drag · MAWS'), { dataTransfer: dt });
    const edge = screen.getByTestId('drop-edge');
    fireEvent.dragOver(edge, { dataTransfer: dt });
    fireEvent.drop(edge, { dataTransfer: dt });
    expect(strips()).toHaveLength(2);
    expect(tabNames(strips()[1])).toEqual(['Fix sidebar drag · MAWS']);
    expect(useLayout.getState().main.focusedPane).toBe(1);
    expect(within(main()).getByRole('separator', { name: 'Resize panes' })).toBeTruthy();

    await act(async () => runAction('tab.close'));
    expect(strips()).toHaveLength(1);
    expect(useLayout.getState().main.focusedPane).toBe(0);
    expect(within(main()).queryByRole('separator', { name: 'Resize panes' })).toBeNull();
  });

  it('shows no drop edge while a split exists', () => {
    render(<Shell />);
    openThree();
    act(() => runAction('pane.split'));
    fireEvent.dragStart(tab('Overview'), { dataTransfer: transfer() });
    expect(screen.queryByTestId('drop-edge')).toBeNull();
  });

  it('⌘\\ moves the active tab to the other pane, ⌘⇧\\ focuses the other pane', () => {
    render(<Shell />);
    openThree();
    act(() => runAction('pane.split'));
    expect(tabNames(strips()[1])).toEqual(['Quota reset recovery · codex_somersault']);
    act(() => runAction('pane.focusOther'));
    expect(useLayout.getState().main.focusedPane).toBe(0);
    act(() => runAction('pane.split'));
    expect(tabNames(strips()[1])).toEqual(['Quota reset recovery · codex_somersault', 'Fix sidebar drag · MAWS']);
  });

  it('a pointer or focus inside a pane focuses it, and only a split marks the focused strip', () => {
    render(<Shell />);
    openThree();
    expect(strips()[0].dataset.focused).toBeUndefined();
    act(() => runAction('pane.split'));
    expect(strips()[1].dataset.focused).toBe('true');
    fireEvent.pointerDown(within(main()).getAllByRole('tabpanel')[0]);
    expect(useLayout.getState().main.focusedPane).toBe(0);
    expect(strips()[0].dataset.focused).toBe('true');
    fireEvent.focus(tab('Quota reset recovery · codex_somersault'));
    expect(useLayout.getState().main.focusedPane).toBe(1);
  });

  it('the split divider resizes the panes within 25–75 %', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    openThree();
    act(() => runAction('pane.split'));
    const sep = within(main()).getByRole('separator', { name: 'Resize panes' });
    sep.focus();
    await user.keyboard('{End}');
    expect(useLayout.getState().main.splitRatio).toBe(0.75);
    await user.keyboard('{Home}');
    expect(useLayout.getState().main.splitRatio).toBe(0.25);
  });
});

describe('unstarted sessions', () => {
  const MAWS = 'proj-maws' as ProjectId;
  const NEW = 'app-new-1' as AppSessionId;

  beforeEach(() => {
    offs.push(registerSessionCreator(async () => NEW));
  });

  it('createSession opens a "New session" tab under the project with no glyph, the composer frame and no transcript; the sidebar does not list it', async () => {
    render(<Shell />);
    await act(() => createSession(MAWS));
    const t = tab('New session · MAWS');
    expect(t.getAttribute('aria-selected')).toBe('true');
    expect(within(t).queryByRole('img')).toBeNull();
    const panel = within(main()).getByRole('tabpanel');
    expect(within(panel).getByText('Composer arrives with C7')).toBeTruthy();
    expect(within(panel).queryByText('Transcript arrives with C6')).toBeNull();
    expect(within(panel).queryByRole('group', { name: 'Session status' })).toBeNull();
    expect(within(document.querySelector<HTMLElement>('[data-region="sidebar"]')!).queryByText('New session')).toBeNull();
    expect(within(screen.getByRole('banner')).getByText('New session')).toBeTruthy();
  });

  it('a record arriving for the id turns the tab into the session’s ordinary tab', async () => {
    render(<Shell />);
    await act(() => createSession(MAWS));
    act(() => {
      useSessions.getState().applyChanged({ record: record(NEW, { projectId: MAWS, title: { text: 'Rename the tab strip', source: 'generated' } }), cause: 'live', revision: 99 } as never);
    });
    const t = tab('Rename the tab strip · MAWS');
    expect(t.getAttribute('aria-selected')).toBe('true');
    expect(within(t).getByRole('img')).toBeTruthy();
    expect(within(main()).getByRole('tabpanel').textContent).toContain('Transcript arrives with C6');
    expect(useSessions.getState().unstarted.has(NEW)).toBe(false);
  });

  it('takes its title from a registered unstarted title', async () => {
    offs.push(registerUnstartedTitle((id) => (id === NEW ? { title: 'Set up a session', project: 'MAWS' } : null)));
    render(<Shell />);
    await act(() => createSession(MAWS));
    expect(tab('Set up a session · MAWS')).toBeTruthy();
  });

  it('closes at once with no guard, and drops the unstarted entry without a reopen entry', async () => {
    render(<Shell />);
    await act(() => createSession(MAWS));
    await act(async () => runAction('tab.close'));
    expect(tabNames()).toEqual(['Overview']);
    expect(useSessions.getState().unstarted.has(NEW)).toBe(false);
    expect(useLayout.getState().main.closedTabs).toEqual([]);
  });

  it('awaits the session guard: false keeps the tab, true closes it', async () => {
    let answer = false;
    const guard = vi.fn<(ref: TabRef) => Promise<boolean>>(async () => answer);
    offs.push(registerCloseGuard('session', guard));
    render(<Shell />);
    await act(() => createSession(MAWS));
    await act(async () => runAction('tab.close'));
    expect(guard).toHaveBeenCalledWith(expect.objectContaining({ kind: 'session', appSessionId: NEW }));
    expect(tabNames()).toEqual(['Overview', 'New session · MAWS']);
    expect(screen.queryByRole('alertdialog')).toBeNull(); // the guard asks, not the shell
    answer = true;
    await act(async () => runAction('tab.close'));
    expect(tabNames()).toEqual(['Overview']);
    expect(useSessions.getState().unstarted.has(NEW)).toBe(false);
  });

  it('a guard for one kind leaves the other kinds closing at once', async () => {
    offs.push(registerCloseGuard('file', async () => false));
    render(<Shell />);
    openThree();
    await act(async () => runAction('tab.close'));
    expect(activeTab(useLayout.getState().main)?.id).toBe(`session:${idOf('Fix sidebar drag')}`);
  });
});

function fakeBridge() {
  return { invoke: vi.fn(async () => ({ ok: true, value: undefined })), on: vi.fn(() => () => {}) } as unknown as MawsBridge;
}
