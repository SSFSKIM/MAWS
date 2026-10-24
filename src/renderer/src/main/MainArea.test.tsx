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
import { registerSlot, resetSlots } from '../app/slots';
import { createSession, registerCloseGuard, registerSessionCreator, registerUnstartedTitle, runAction } from '../keymap/actions-runtime';
import { connectKeys } from '../keymap/dispatcher';
import { useLayout } from '../stores/layout';
import { activeTab, currentSet } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import { installResizeObserver } from '../test-support/resize';
import { fileTabsByProject, fillStores, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { PINNED_HINT } from './Tab';
import { TAB_DRAG_TYPE } from './TabStrip';

vi.mock('../app/Diagnostics', () => ({ Diagnostics: () => <section aria-label="Diagnostics">diagnostics</section> }));

const nine = scenarioFile('nine-sessions');
const idOf = (title: string) => nine.sessions.find((r) => r.title.text === title)!.appId;
const offs: (() => void)[] = [];

const main = () => document.querySelector<HTMLElement>('[data-region="main"]')!;
// The panes still own their tab state, but their strips now portal into the single chrome row.
const chrome = () => document.querySelector<HTMLElement>('[data-chrome-tabs]')!;
const strips = () => within(chrome()).getAllByRole('tablist');
const tabNames = (strip = strips()[0]) => within(strip).queryAllByRole('tab').map((t) => t.getAttribute('aria-label'));
const tab = (name: string) => within(chrome()).getByRole('tab', { name });
const selected = (strip = strips()[0]) => within(strip).getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')?.getAttribute('aria-label');
// A session's row, in its project expanded in place (W11).
const sidebarRow = (title: string) => {
  const projectId = nine.sessions.find((r) => r.title.text === title)!.projectId ?? 'other';
  act(() => useLayout.getState().setSidebar({ expandedProjects: [projectId as ProjectId] }));
  return within(document.querySelector<HTMLElement>('[data-region="sidebar"]')!).getByRole('treeitem', { name: title });
};

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
    useLayout.getState().openSession(idOf('Charter + research'), { how: 'tab' });
    useLayout.getState().openSession(idOf('Fix sidebar drag'), { how: 'tab' });
    useLayout.getState().openSession(idOf('Quota reset recovery'), { how: 'tab' });
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  resetShellStores();
  fillStores(nine);
  offs.push(registerShellActions(fakeBridge()));
  window.maws = fakeClient({ 'attention.request': { event: null } }).client;
});
async function cleanupShell() {
  cleanup();
  // Repeated hover events can overwrite Radix's timer handle; unmount cancels only the latest.
  // Exhaust the remaining callbacks while happy-dom's window still exists, rather than discarding them.
  await act(async () => { await vi.runAllTimersAsync(); });
}
afterEach(async () => {
  try {
    await cleanupShell();
  } finally {
    vi.useRealTimers();
    delete (window as { maws?: MawsBridge }).maws;
    resetSlots();
    offs.splice(0).forEach((off) => off());
  }
});

it('exhausts superseded sidebar hover timers during teardown', async () => {
  render(<Shell />);
  const row = sidebarRow('Charter + research');
  fireEvent.pointerEnter(row, { pointerType: 'mouse' });
  fireEvent.pointerEnter(row, { pointerType: 'mouse' });
  expect(vi.getTimerCount()).toBeGreaterThanOrEqual(2);
  await cleanupShell();
  expect(vi.getTimerCount()).toBe(0);
});

describe('tab strip reorders, closes, reopens', () => {
  // W5: the Overview floats over the main area rather than leading the strip, so the app opens on one empty pane, which
  // offers the two ways in: the Overview and a new session.
  it('opens on an empty pane that says so and offers the Overview and a new session', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    expect(tabNames()).toEqual([]);
    const panel = within(main()).getByRole('tabpanel');
    expect(within(panel).getByText('No open tabs')).toBeTruthy();
    expect((within(panel).getByRole('button', { name: 'New chat' }) as HTMLButtonElement).disabled).toBe(true); // no creator registered
    expect(within(main()).queryByRole('dialog', { name: 'Overview' })).toBeNull();
    await user.click(within(panel).getByRole('button', { name: /^Overview/ }));
    expect(within(main()).getByRole('dialog', { name: 'Overview' })).toBeTruthy();
  });

  // I2: a click shows the session in place of the focused pane's (⌘⇧T brings the replaced one back); ⌘-click and a
  // middle-click open a tab of its own; a session open anywhere is activated.
  it('a sidebar click replaces the active session tab, ⌘-click and a middle-click open a new one, an open session is activated', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    await user.click(sidebarRow('Charter + research'));
    expect(tabNames()).toEqual(['Charter + research · MAWS']);
    await user.click(sidebarRow('Fix sidebar drag'));
    expect(tabNames()).toEqual(['Fix sidebar drag · MAWS']);
    expect(selected()).toBe('Fix sidebar drag · MAWS');
    await act(async () => runAction('tab.reopen'));
    expect(tabNames()).toEqual(['Fix sidebar drag · MAWS', 'Charter + research · MAWS']);
    await user.click(sidebarRow('Fix sidebar drag'));
    expect(tabNames()).toEqual(['Fix sidebar drag · MAWS', 'Charter + research · MAWS']);
    expect(selected()).toBe('Fix sidebar drag · MAWS');
    await user.keyboard('{Meta>}');
    await user.click(sidebarRow('Sidebar interaction pass'));
    await user.keyboard('{/Meta}');
    expect(tabNames()).toEqual(['Fix sidebar drag · MAWS', 'Sidebar interaction pass · MAWS', 'Charter + research · MAWS']);
    fireEvent(sidebarRow('Workstation north star'), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(tabNames()).toEqual(['Fix sidebar drag · MAWS', 'Sidebar interaction pass · MAWS', 'Workstation north star · MAWS', 'Charter + research · MAWS']);
    expect(selected()).toBe('Workstation north star · MAWS');
  });

  // E11 F2b (plan 2.5; owner decision 2): whatever the main tab shows, a click puts the session in its place; a pin, which
  // the tab shows as a pin saying what it does, keeps it.
  it('a sidebar click replaces Settings too; a pinned tab shows its pin with its meaning and stays', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    act(() => useLayout.getState().openTab({ kind: 'settings', section: null }));
    expect(tabNames()).toEqual(['Settings']);
    await user.click(sidebarRow('Fix sidebar drag'));
    expect(tabNames()).toEqual(['Fix sidebar drag · MAWS']);
    act(() => useLayout.getState().togglePinned('session:' + idOf('Fix sidebar drag')));
    const pin = within(tab('Fix sidebar drag · MAWS')).getByRole('img', { name: 'Pinned' });
    expect(pin.getAttribute('title')).toBe(PINNED_HINT);
    expect(pin.querySelector('svg')).not.toBeNull();
    await user.click(sidebarRow('Charter + research'));
    expect(tabNames()).toEqual(['Fix sidebar drag · MAWS', 'Charter + research · MAWS']);
  });

  it('shows the session glyph on its tab and the project as its secondary text', () => {
    render(<Shell />);
    openThree();
    const fix = tab('Fix sidebar drag · MAWS');
    expect(within(fix).getByRole('img', { name: 'Needs approval' }).textContent).toBe('◐');
    expect(within(fix).getByText('MAWS').tagName).toBe('SMALL');
  });

  // W5: no tab is permanent any more; closing the last one leaves the empty pane, where ⌘W has nothing to close.
  it('⌘W on the last tab leaves the pane empty, saying "No open tabs", and then does nothing', async () => {
    render(<Shell />);
    act(() => useLayout.getState().openSession(idOf('Charter + research')));
    await act(async () => runAction('tab.close'));
    expect(tabNames()).toEqual([]);
    expect(within(within(main()).getByRole('tabpanel')).getByText('No open tabs')).toBeTruthy();
    const before = useLayout.getState().main;
    await act(async () => runAction('tab.close'));
    expect(useLayout.getState().main).toBe(before);
  });

  it('⌘W closes the active tab and ⌘⇧T brings it back where it was', async () => {
    render(<Shell />);
    openThree();
    act(() => useLayout.getState().activateTab(`session:${idOf('Charter + research')}`));
    await act(async () => runAction('tab.close'));
    expect(tabNames()).toEqual(['Fix sidebar drag · MAWS', 'Quota reset recovery · codex_somersault']);
    act(() => runAction('tab.reopen'));
    expect(tabNames()).toEqual(['Charter + research · MAWS', 'Fix sidebar drag · MAWS', 'Quota reset recovery · codex_somersault']);
    expect(selected()).toBe('Charter + research · MAWS');
  });

  it('the close control and a middle-click close a tab', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    openThree();
    await user.click(within(tab('Fix sidebar drag · MAWS')).getByRole('button', { name: 'Close Fix sidebar drag' }));
    expect(tabNames()).not.toContain('Fix sidebar drag · MAWS');
    await act(async () => void fireEvent(tab('Charter + research · MAWS'), new MouseEvent('auxclick', { bubbles: true, button: 1 })));
    expect(tabNames()).toEqual(['Quota reset recovery · codex_somersault']);
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
    expect(document.activeElement).toBe(tab('Charter + research · MAWS')); // wraps
    await user.keyboard('{ArrowLeft}{Delete}');
    expect(tabNames()).toEqual(['Charter + research · MAWS', 'Fix sidebar drag · MAWS']);
  });

  it('Delete keeps focus on a guarded tab until its close succeeds', async () => {
    const user = userEvent.setup();
    let answer = false;
    offs.push(registerCloseGuard('session', async () => answer));
    render(<Shell />);
    openThree();
    tab('Fix sidebar drag · MAWS').focus();
    await user.keyboard('{Delete}');
    expect(tabNames()).toContain('Fix sidebar drag · MAWS');
    expect(document.activeElement).toBe(tab('Fix sidebar drag · MAWS'));
    answer = true;
    await user.keyboard('{Delete}');
    expect(tabNames()).not.toContain('Fix sidebar drag · MAWS');
    expect(document.activeElement).toBe(tab('Quota reset recovery · codex_somersault')); // the neighbour that took its place
  });

  // With no neighbour to take the closed tab's place, focus would fall to the page and the pane's chords with it.
  it('Delete on the only tab leaves focus on the empty pane’s Overview button', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    act(() => useLayout.getState().openSession(idOf('Charter + research')));
    tab('Charter + research · MAWS').focus();
    await user.keyboard('{Delete}');
    expect(tabNames()).toEqual([]);
    expect(document.activeElement).toBe(within(within(main()).getByRole('tabpanel')).getByRole('button', { name: /^Overview/ }));
  });

  // P3-F (tracker rows 200 and 264): a close puts focus back in its pane a frame later, once React has replaced the tab;
  // a surface that took focus within that frame (the Overview, opened at once) keeps it, and a close nobody followed
  // still lands focus on the pane's selected tab.
  describe('a closed tab’s focus, restored a frame later', () => {
    const frames: FrameRequestCallback[] = [];
    const nextFrame = () => act(() => frames.splice(0).forEach((frame) => frame(performance.now())));
    beforeEach(() => {
      frames.length = 0;
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((frame) => frames.push(frame));
    });
    afterEach(() => vi.restoreAllMocks());
    const middleClose = (name: string) => act(async () => void fireEvent(tab(name), new MouseEvent('auxclick', { bubbles: true, button: 1 })));

    it('lands on the pane’s selected tab when nothing took focus meanwhile', async () => {
      render(<Shell />);
      openThree();
      tab('Fix sidebar drag · MAWS').focus();
      await middleClose('Fix sidebar drag · MAWS');
      expect(tabNames()).not.toContain('Fix sidebar drag · MAWS');
      nextFrame();
      expect(document.activeElement).toBe(tab('Quota reset recovery · codex_somersault'));
    });

    it('leaves focus with the Overview opened before the frame came', async () => {
      render(<Shell />);
      openThree();
      tab('Fix sidebar drag · MAWS').focus();
      await middleClose('Fix sidebar drag · MAWS');
      act(() => runAction('tab.overview'));
      const dialog = within(main()).getByRole('dialog', { name: 'Overview' });
      expect(document.activeElement).toBe(dialog);
      nextFrame();
      expect(document.activeElement).toBe(dialog);
    });
  });

  it('the strip’s "+" is disabled with "Not available here" while no session creator is registered', () => {
    render(<Shell />);
    const plus = within(strips()[0].parentElement!).getByRole('button', { name: 'New chat' }) as HTMLButtonElement;
    expect(plus.disabled).toBe(true);
    expect(plus.title).toBe('Not available here');
  });

  it('⌘1…9 select tabs of the focused pane, ⌃Tab and ⌃⇧Tab cycle them', () => {
    render(<Shell />);
    openThree();
    act(() => runAction('tab.select', 2));
    expect(selected()).toBe('Fix sidebar drag · MAWS');
    act(() => runAction('tab.select', 1));
    expect(selected()).toBe('Charter + research · MAWS');
    act(() => runAction('tab.select', 9));
    expect(selected()).toBe('Charter + research · MAWS');
    act(() => runAction('tab.next'));
    expect(selected()).toBe('Fix sidebar drag · MAWS');
    act(() => runAction('tab.previous'));
    act(() => runAction('tab.previous'));
    expect(selected()).toBe('Quota reset recovery · codex_somersault');
  });

  // W5: ⌘0 (and the View menu and the palette, which run the same action) opens the board floating over the active tab,
  // which stays selected and live beneath it; asked again while it is open, it brings focus back to the panel.
  it('⌘0 opens the floating Overview over the active tab, the board inside it, and refocuses it when open', () => {
    render(<Shell />);
    openThree();
    act(() => runAction('tab.overview'));
    const dialog = within(main()).getByRole('dialog', { name: 'Overview' });
    expect(within(dialog).getByRole('list', { name: 'Overview' })).toBeTruthy();
    expect(within(dialog).getAllByRole('article').length).toBeGreaterThan(0);
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(tabNames()).toEqual(['Charter + research · MAWS', 'Fix sidebar drag · MAWS', 'Quota reset recovery · codex_somersault']);
    expect(selected()).toBe('Quota reset recovery · codex_somersault');
    act(() => tab('Fix sidebar drag · MAWS').focus());
    act(() => runAction('tab.overview'));
    expect(within(main()).getByRole('dialog', { name: 'Overview' })).toBe(dialog);
    expect(dialog.contains(document.activeElement)).toBe(true);
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
    expect(tabNames()).toEqual(['Charter + research · MAWS', 'Quota reset recovery · codex_somersault', 'Fix sidebar drag · MAWS']);
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
    expect(tabNames()).toEqual(['Quota reset recovery · codex_somersault', 'Charter + research · MAWS', 'Fix sidebar drag · MAWS']);
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
    expect(currentSet(useLayout.getState().main).focusedPane).toBe(1);
    expect(within(main()).getByRole('separator', { name: 'Resize panes' })).toBeTruthy();

    await act(async () => runAction('tab.close'));
    expect(strips()).toHaveLength(1);
    expect(currentSet(useLayout.getState().main).focusedPane).toBe(0);
    expect(within(main()).queryByRole('separator', { name: 'Resize panes' })).toBeNull();
  });

  it('shows no drop edge while a split exists', () => {
    render(<Shell />);
    openThree();
    act(() => runAction('pane.split'));
    fireEvent.dragStart(tab('Charter + research · MAWS'), { dataTransfer: transfer() });
    expect(screen.queryByTestId('drop-edge')).toBeNull();
  });

  it('⌘\\ moves the active tab to the other pane, ⌘⇧\\ focuses the other pane', () => {
    render(<Shell />);
    openThree();
    act(() => runAction('pane.split'));
    expect(tabNames(strips()[1])).toEqual(['Quota reset recovery · codex_somersault']);
    act(() => runAction('pane.focusOther'));
    expect(currentSet(useLayout.getState().main).focusedPane).toBe(0);
    act(() => runAction('pane.split'));
    expect(tabNames(strips()[1])).toEqual(['Quota reset recovery · codex_somersault', 'Fix sidebar drag · MAWS']);
  });

  it('⌘⇧\\ moves DOM focus into the other pane, onto its active tab', () => {
    render(<Shell />);
    openThree();
    act(() => runAction('pane.split')); // Quota goes right; Fix stays active on the left
    act(() => tab('Quota reset recovery · codex_somersault').focus());
    expect(currentSet(useLayout.getState().main).focusedPane).toBe(1);
    act(() => runAction('pane.focusOther'));
    expect(currentSet(useLayout.getState().main).focusedPane).toBe(0);
    expect(document.activeElement).toBe(tab('Fix sidebar drag · MAWS'));
    act(() => runAction('pane.focusOther'));
    expect(document.activeElement).toBe(tab('Quota reset recovery · codex_somersault'));
    expect(currentSet(useLayout.getState().main).focusedPane).toBe(1);
  });

  it('⌘⇧\\ without a split leaves focus where it is', () => {
    render(<Shell />);
    openThree();
    act(() => tab('Charter + research · MAWS').focus());
    act(() => runAction('pane.focusOther'));
    expect(document.activeElement).toBe(tab('Charter + research · MAWS'));
    expect(currentSet(useLayout.getState().main).focusedPane).toBe(0);
  });

  it('a pointer or focus inside a pane focuses it, and only a split marks the focused strip', () => {
    render(<Shell />);
    openThree();
    expect(strips()[0].dataset.focused).toBeUndefined();
    act(() => runAction('pane.split'));
    expect(strips()[1].dataset.focused).toBe('true');
    fireEvent.pointerDown(within(main()).getAllByRole('tabpanel')[0]);
    expect(currentSet(useLayout.getState().main).focusedPane).toBe(0);
    expect(strips()[0].dataset.focused).toBe('true');
    fireEvent.focus(tab('Quota reset recovery · codex_somersault'));
    expect(currentSet(useLayout.getState().main).focusedPane).toBe(1);
  });

  // P4-B3 M1: pixel floors replace 25–75 % (before the region is measured, a nominal 1000 px stands in).
  it('the split divider’s Home and End stop at the panes’ 320 px floors', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    openThree();
    act(() => runAction('pane.split'));
    const sep = within(main()).getByRole('separator', { name: 'Resize panes' });
    sep.focus();
    await user.keyboard('{End}');
    expect(currentSet(useLayout.getState().main).splitRatio).toBe(0.68);
    await user.keyboard('{Home}');
    expect(currentSet(useLayout.getState().main).splitRatio).toBe(0.32);
  });
});

// P4-B3 M1 (parent §4.5 and §2 item 5's drag half; the prior art's §3.3 rows and worked numbers; Decision Log 2 to 5): a
// session beside another tab, in a 1500 px main region.
describe('the split’s float: the divider', () => {
  const SESSION = 'Charter + research · MAWS';
  const W = 1500;
  let resize: ReturnType<typeof installResizeObserver>['resize'];
  const region = () => main().querySelector<HTMLElement>('[data-main-area]')!;
  const columns = () => region().style.gridTemplateColumns;
  const set = () => currentSet(useLayout.getState().main);
  const divider = () => within(main()).getByRole('separator', { name: 'Resize panes' });
  const down = (x: number) => act(() => void fireEvent.pointerDown(divider(), { pointerId: 1, button: 0, clientX: x }));
  const move = (x: number) => act(() => void fireEvent.pointerMove(divider(), { pointerId: 1, clientX: x }));
  const up = (x: number) => act(() => void fireEvent.pointerUp(divider(), { pointerId: 1, clientX: x }));
  // The session's tab and its content, hidden or not.
  const sessionTab = () => chrome().querySelector(`[data-tab-id="session:${idOf('Charter + research')}"]`);
  const sessionBody = () => main().querySelector('[data-pane="0"] [role="tabpanel"]')?.firstElementChild;

  // S on the left (the session), A on the right (Diagnostics), at the ratio 0.5: the divider at 750 px.
  function sessionBesideDiagnostics() {
    render(<Shell />);
    act(() => {
      useLayout.getState().openSession(idOf('Charter + research'), { how: 'tab' });
      useLayout.getState().openTab({ kind: 'diagnostics' }, { pane: 1 });
    });
    resize(region(), { width: W, height: 800 });
    expect(columns()).toBe('750px 1px minmax(0, 1fr)');
  }

  beforeEach(() => {
    ({ resize } = installResizeObserver());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('follows the pointer, holds S at 320, collapses it live below 160 and restores it, writing nothing until release', () => {
    sessionBesideDiagnostics();
    const before = useLayout.getState().main;
    const panelA = within(main()).getByRole('region', { name: 'Diagnostics' });
    const tabS = sessionTab()!;
    const bodyS = sessionBody()!;
    down(750);
    move(400);
    expect(columns()).toBe('400px 1px minmax(0, 1fr)');
    move(200);
    expect(columns()).toBe('320px 1px minmax(0, 1fr)'); // the dead zone holds S at S_min
    move(159);
    expect(columns()).toBe('0px 1px minmax(0, 1fr)'); // armed: A spans the region
    expect(within(chrome()).queryByRole('tab', { name: SESSION })).toBeNull(); // S's column hidden...
    expect(sessionTab()).toBe(tabS); // ...and still mounted, so a disarm is lossless
    expect(sessionBody()).toBe(bodyS);
    move(161);
    expect(columns()).toBe('320px 1px minmax(0, 1fr)'); // disarmed, held at 320
    expect(within(chrome()).getByRole('tab', { name: SESSION })).toBe(tabS);
    expect(sessionBody()).toBe(bodyS);
    expect(useLayout.getState().main).toBe(before); // nothing reached main.tabs, so nothing is persisted
    move(150);
    up(150);
    expect(set().floating).toEqual({ sessionTabId: `session:${idOf('Charter + research')}` });
    expect(set().splitRatio).toBe(0.5); // r0: a float never writes the ratio
    expect(columns()).toBe('minmax(0, 1fr)');
    expect(sessionTab()).toBeNull(); // S is not rendered in the main area (M2's card draws it)
    expect(within(main()).queryByRole('separator', { name: 'Resize panes' })).toBeNull();
    expect(within(main()).getByRole('region', { name: 'Diagnostics' })).toBe(panelA); // A never remounted
  });

  it('mirrored: a session on the right arms past W − 160, collapses to 0 px on the right, and floats leaving A in place', () => {
    render(<Shell />);
    act(() => {
      useLayout.getState().openTab({ kind: 'diagnostics' });
      useLayout.getState().openSession(idOf('Charter + research'), { split: true });
    });
    resize(region(), { width: W, height: 800 });
    const body = (pane: 0 | 1) => main().querySelector(`[data-pane="${pane}"] [role="tabpanel"]`)?.firstElementChild;
    const bodyA = body(0)!;
    const tabS = sessionTab()!;
    down(750);
    move(1300);
    expect(columns()).toBe('1180px 1px minmax(0, 1fr)'); // S held at 320 on the right
    move(1341);
    expect(columns()).toBe('minmax(0, 1fr) 1px 0px'); // armed: A spans, S's column at 0 on the right
    expect(within(chrome()).queryByRole('tab', { name: SESSION })).toBeNull();
    expect(sessionTab()).toBe(tabS);
    move(1339);
    expect(columns()).toBe('1180px 1px minmax(0, 1fr)'); // disarmed
    move(1400);
    up(1400);
    expect(set().floating).toEqual({ sessionTabId: `session:${idOf('Charter + research')}` });
    expect(set().splitRatio).toBe(0.5);
    expect(columns()).toBe('minmax(0, 1fr)');
    expect(sessionTab()).toBeNull();
    expect(body(0)).toBe(bodyA); // A never remounted
  });

  // M6 (the e2e's round trip, Chromium layout): collapsed into a 0 px column, S's content reflowed at no width, so its
  // transcript's rows were re-measured and the carry its float records named another row; it now keeps the width it was
  // last laid out at, hidden and overflowing its column over A (left: from its start; right: from its end).
  it('armed, S keeps the width it was last laid out at, hidden, so its content never reflows at 0 px', () => {
    sessionBesideDiagnostics();
    const bodyOf = (pane: 0 | 1) => main().querySelector<HTMLElement>(`[data-pane="${pane}"] > [role="tabpanel"]`)!;
    down(750);
    move(400);
    resize(bodyOf(0), { width: 400, height: 700 });
    move(159);
    expect(columns()).toBe('0px 1px minmax(0, 1fr)');
    expect(bodyOf(0).style).toMatchObject({ visibility: 'hidden', width: '400px', justifySelf: 'start' });
    move(161);
    expect(bodyOf(0).style.visibility).toBe('');
    expect(bodyOf(0).style.width).toBe('');
  });

  it('armed on the right, S keeps its last width from its column’s end', () => {
    render(<Shell />);
    act(() => {
      useLayout.getState().openTab({ kind: 'diagnostics' });
      useLayout.getState().openSession(idOf('Charter + research'), { split: true });
    });
    resize(region(), { width: W, height: 800 });
    const bodyS = main().querySelector<HTMLElement>('[data-pane="1"] > [role="tabpanel"]')!;
    resize(bodyS, { width: 749, height: 700 });
    down(750);
    move(1400);
    expect(columns()).toBe('minmax(0, 1fr) 1px 0px');
    expect(bodyS.style).toMatchObject({ visibility: 'hidden', width: '749px', justifySelf: 'end' });
  });

  it('with two sessions the squeezed one floats and the other keeps its slot without remounting', () => {
    render(<Shell />);
    act(() => {
      useLayout.getState().openSession(idOf('Charter + research'), { how: 'tab' });
      useLayout.getState().openSession(idOf('Fix sidebar drag'), { split: true });
    });
    resize(region(), { width: W, height: 800 });
    const body = (pane: 0 | 1) => main().querySelector(`[data-pane="${pane}"] [role="tabpanel"]`)?.firstElementChild;
    const bodyRight = body(1)!;
    const tabRight = within(chrome()).getByRole('tab', { name: 'Fix sidebar drag · MAWS' });
    down(750);
    move(100);
    expect(columns()).toBe('0px 1px minmax(0, 1fr)'); // the left session is squeezed: it arms
    expect(body(1)).toBe(bodyRight);
    up(100);
    expect(set().floating).toEqual({ sessionTabId: `session:${idOf('Charter + research')}` });
    expect(sessionTab()).toBeNull();
    expect(body(1)).toBe(bodyRight); // the right session's pane kept its slot
    expect(within(chrome()).getByRole('tab', { name: 'Fix sidebar drag · MAWS' })).toBe(tabRight);
  });

  it('a release that is not armed persists the ratio; A clamps at its floor and never collapses', () => {
    sessionBesideDiagnostics();
    down(750);
    move(400);
    up(400);
    expect(set().splitRatio).toBe(400 / W);
    expect(set().floating).toBeUndefined();
    down(400);
    move(1450);
    expect(columns()).toBe('1180px 1px minmax(0, 1fr)');
    up(1450);
    expect(set().splitRatio).toBe(1180 / W);
  });

  it('a pointer-cancel or a lost capture leaves the split docked at r0', () => {
    sessionBesideDiagnostics();
    const before = useLayout.getState().main;
    down(750);
    move(100);
    act(() => void fireEvent.pointerCancel(divider(), { pointerId: 1 }));
    expect(useLayout.getState().main).toBe(before);
    expect(columns()).toBe('750px 1px minmax(0, 1fr)');
    down(750);
    move(500);
    act(() => void fireEvent.lostPointerCapture(divider(), { pointerId: 1 }));
    up(500); // the drag is over: the release writes nothing
    expect(useLayout.getState().main).toBe(before);
    expect(columns()).toBe('750px 1px minmax(0, 1fr)');
  });

  it('a drag whose split goes from under it is dropped with it', () => {
    sessionBesideDiagnostics();
    down(750);
    move(400);
    act(() => useLayout.getState().closeTab('diagnostics'));
    expect(columns()).toBe('minmax(0, 1fr)');
    act(() => useLayout.getState().openTab({ kind: 'diagnostics' }, { pane: 1 }));
    expect(columns()).toBe('750px 1px minmax(0, 1fr)'); // the stored ratio, not the abandoned drag's 400
    expect(set().splitRatio).toBe(0.5);
  });

  it('the keyboard moves within the floors and never floats; Enter and a double-click restore 0.5', async () => {
    const user = userEvent.setup();
    sessionBesideDiagnostics();
    act(() => divider().focus());
    await user.keyboard('{Home}');
    expect(set().splitRatio).toBe(320 / W);
    await user.keyboard('{ArrowLeft}{Shift>}{ArrowLeft}{/Shift}');
    expect(set().splitRatio).toBe(320 / W);
    expect(set().floating).toBeUndefined();
    await user.keyboard('{End}{ArrowLeft}');
    expect(set().splitRatio).toBe((1180 - 8) / W);
    await user.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    expect(set().splitRatio).toBe((1180 - 40) / W);
    await user.keyboard('{Enter}');
    expect(set().splitRatio).toBe(0.5);
    act(() => useLayout.getState().setSplitRatio(0.3));
    act(() => void fireEvent.doubleClick(divider()));
    expect(set().splitRatio).toBe(0.5);
    expect(set().floating).toBeUndefined();
  });

  it('a window resize only clamps: docked it never floats, floating it never docks', () => {
    sessionBesideDiagnostics();
    act(() => useLayout.getState().setSplitRatio(0.25));
    expect(columns()).toBe('375px 1px minmax(0, 1fr)');
    resize(region(), { width: 1000, height: 800 });
    expect(columns()).toBe('320px 1px minmax(0, 1fr)'); // held at S_min, not floated
    resize(region(), { width: 600, height: 800 });
    expect(columns()).toBe('300px 1px minmax(0, 1fr)'); // narrower than both floors: even
    expect(set()).toMatchObject({ splitRatio: 0.25 });
    expect(set().floating).toBeUndefined();
    act(() => useLayout.getState().floatSplit(`session:${idOf('Charter + research')}`));
    resize(region(), { width: W, height: 800 });
    expect(set().floating).toBeDefined();
    expect(columns()).toBe('minmax(0, 1fr)');
  });

  it('with no session in the split, both sides clamp at their floors', () => {
    render(<Shell />);
    act(() => {
      useLayout.getState().openTab({ kind: 'diagnostics' });
      useLayout.getState().openTab({ kind: 'settings', section: null }, { pane: 1 });
    });
    resize(region(), { width: W, height: 800 });
    down(750);
    move(40);
    expect(columns()).toBe('320px 1px minmax(0, 1fr)');
    up(40);
    expect(set().floating).toBeUndefined();
    expect(set().splitRatio).toBe(320 / W);
  });
});

describe('unstarted sessions', () => {
  const MAWS = 'proj-maws' as ProjectId;
  const NEW = 'app-new-1' as AppSessionId;

  beforeEach(() => {
    offs.push(registerSessionCreator(async () => NEW));
  });

  it('createSession opens a "New chat" tab under the project with no glyph, the composer frame and no transcript; the sidebar does not list it', async () => {
    render(<Shell />);
    await act(() => createSession(MAWS));
    const t = tab('New chat');
    expect(t.getAttribute('aria-selected')).toBe('true');
    expect(within(t).queryByRole('img')).toBeNull();
    const panel = within(main()).getByRole('tabpanel');
    expect(within(panel).getByText('Composer unavailable')).toBeTruthy();
    expect(within(panel).queryByText('Transcript unavailable')).toBeNull();
    expect(within(panel).queryByRole('group', { name: 'Session status' })).toBeNull();
    expect(document.querySelector(`[data-region="sidebar"] [data-menu="session:${NEW}"]`)).toBeNull(); // no row (the sidebar's New chat control is no session)
    expect(within(screen.getByRole('banner')).getByText('New chat')).toBeTruthy();
  });

  it('the strip’s "+" opens an unstarted tab in its pane, in the project whose tab set the strip shows', async () => {
    fileTabsByProject();
    const asked: (ProjectId | null)[] = [];
    offs.push(registerSessionCreator(async (projectId) => (asked.push(projectId), NEW)));
    const user = userEvent.setup();
    render(<Shell />);
    await user.click(within(strips()[0].parentElement!).getByRole('button', { name: 'New chat' }));
    expect(asked).toEqual([null]); // an empty pane has no session to take a project from
    expect(selected()).toBe('New chat');
    await act(async () => runAction('tab.close'));
    act(() => useLayout.getState().openSession(idOf('Quota reset recovery')));
    await user.click(within(strips()[0].parentElement!).getByRole('button', { name: 'New chat' }));
    expect(asked).toEqual([null, 'proj-codex-somersault']);
    expect(selected()).toBe('New chat');
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
    expect(within(main()).getByRole('tabpanel').textContent).toContain('Transcript unavailable');
    expect(useSessions.getState().unstarted.has(NEW)).toBe(false);
  });

  it('takes its title from a registered unstarted title', async () => {
    offs.push(registerUnstartedTitle((id) => (id === NEW ? { title: 'Set up a session', project: 'MAWS', projectId: MAWS } : null)));
    render(<Shell />);
    await act(() => createSession(MAWS));
    expect(tab('Set up a session')).toBeTruthy();
  });

  it('closes at once with no guard, and drops the unstarted entry without a reopen entry', async () => {
    render(<Shell />);
    await act(() => createSession(MAWS));
    await act(async () => runAction('tab.close'));
    expect(tabNames()).toEqual([]);
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
    expect(tabNames()).toEqual(['New chat']);
    expect(screen.queryByRole('alertdialog')).toBeNull(); // the guard asks, not the shell
    answer = true;
    await act(async () => runAction('tab.close'));
    expect(tabNames()).toEqual([]);
    expect(useSessions.getState().unstarted.has(NEW)).toBe(false);
  });

  // I2: a sidebar click while an unstarted tab is shown passes that tab's guard first, as a close would.
  it('a sidebar click on a shown unstarted tab opens the session beside it, then asks its guard: true drops the tab without a reopen entry, false keeps it', async () => {
    let answer = false;
    const guard = vi.fn<(ref: TabRef) => Promise<boolean>>(async () => answer);
    offs.push(registerCloseGuard('session', guard));
    const user = userEvent.setup();
    render(<Shell />);
    await act(() => createSession(MAWS));
    await user.click(sidebarRow('Charter + research'));
    expect(tabNames()).toEqual(['New chat', 'Charter + research · MAWS']); // shown at once, the draft beside it
    expect(selected()).toBe('Charter + research · MAWS');
    expect(guard).toHaveBeenCalledWith(expect.objectContaining({ kind: 'session', appSessionId: NEW }));
    await act(async () => {});
    expect(tabNames()).toEqual(['New chat', 'Charter + research · MAWS']); // declined: the draft stays
    act(() => useLayout.getState().activateTab(`session:${NEW}`));
    answer = true;
    await user.click(sidebarRow('Fix sidebar drag'));
    expect(selected()).toBe('Fix sidebar drag · MAWS');
    await waitFor(() => expect(tabNames()).toEqual(['Fix sidebar drag · MAWS', 'Charter + research · MAWS']));
    expect(useSessions.getState().unstarted.has(NEW)).toBe(false);
    expect(useLayout.getState().main.closedTabs).toEqual([]);
  });

  it('a guard for one kind leaves the other kinds closing at once', async () => {
    offs.push(registerCloseGuard('file', async () => false));
    render(<Shell />);
    openThree();
    await act(async () => runAction('tab.close'));
    expect(activeTab(useLayout.getState().main)?.id).toBe(`session:${idOf('Fix sidebar drag')}`);
  });
});

describe('before the layout has hydrated', () => {
  // A relaunch drew "No open tabs" for a moment before the saved tabs arrived: the pane draws no empty state until the
  // snapshot has applied, and then only when no tab came back.
  it('draws no empty state until hydration, then the empty state when no tab came back', async () => {
    const layoutMain = fakeClient({ 'layout.list': { keys: [] } });
    useLayout.setState({ hydrated: false });
    render(<Shell />);
    const hydrating = useLayout.getState().hydrate(layoutMain.client, (id) => useSessions.getState().records.has(id));
    await act(async () => {});
    expect(layoutMain.pending('layout.get')).toBe(3); // the snapshot is still outstanding
    expect(within(main()).queryByText('No open tabs')).toBeNull();
    expect(within(main()).queryByRole('tabpanel', { name: 'No open tabs' })).toBeNull();
    await act(async () => {
      for (let i = 0; i < 3; i++) await layoutMain.reply('layout.get', { value: null });
      await hydrating;
    });
    expect(within(main()).getByText('No open tabs')).toBeTruthy();
    expect(within(main()).getByRole('tabpanel', { name: 'No open tabs' })).toBeTruthy();
  });

  it('a session opened from the sidebar while layout.get is outstanding survives hydration', async () => {
    const user = userEvent.setup();
    // Saved before W5, so it still holds the Overview's tab, which hydration drops.
    const persisted = {
      version: 1,
      panes: [{ tabs: [{ id: 'overview', kind: 'overview', pinned: true }, { id: 'diagnostics', kind: 'diagnostics', pinned: false }], activeTabId: 'diagnostics' }],
      focusedPane: 0,
      splitRatio: 0.5,
      closedTabs: [],
    };
    const layoutMain = fakeClient({ 'layout.list': { keys: ['main.tabs'] } });
    useLayout.setState({ hydrated: false });
    render(<Shell />);
    const hydrating = useLayout.getState().hydrate(layoutMain.client, (id) => useSessions.getState().records.has(id));
    await user.click(sidebarRow('Charter + research'));
    expect(selected()).toBe('Charter + research · MAWS');
    expect(layoutMain.pending('layout.get')).toBe(3); // the snapshot is still outstanding
    await act(async () => {
      for (const key of ['regions', 'main.tabs', 'panel.pinned']) await layoutMain.reply('layout.get', { value: key === 'main.tabs' ? persisted : null });
      await hydrating;
    });
    expect(tabNames()).toEqual(['Diagnostics', 'Charter + research · MAWS']);
    expect(selected()).toBe('Charter + research · MAWS');
  });
});

// ⌃Tab is a renderer-sink, pane-scoped chord: it cycles the pane that owns the focused element, and only from an element
// that may take it (a tab, a card), never from text entry, a key sink, a button or under an open menu.
describe('⌃Tab follows DOM focus', () => {
  const activeOf = (pane: 0 | 1) => currentSet(useLayout.getState().main).panes[pane]?.activeTabId;
  function splitOpen() {
    act(() => {
      useLayout.getState().openSession(idOf('Charter + research'), { how: 'tab' });
      useLayout.getState().openSession(idOf('Fix sidebar drag'), { how: 'tab' });
      useLayout.getState().openSession(idOf('Quota reset recovery'), { split: true });
      useLayout.getState().openSession(idOf('Sidebar interaction pass'), { how: 'tab' }); // into the focused pane, the new right one
    });
  }

  beforeEach(() => {
    offs.push(connectKeys());
  });

  it('with focus on a tab of pane P cycles pane P once, forward and back, the other pane untouched', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    splitOpen();
    act(() => useLayout.getState().focusPane(0));
    const before0 = activeOf(0);
    act(() => within(strips()[1]).getByRole('tab', { name: 'Sidebar interaction pass · MAWS' }).focus());
    await user.keyboard('{Control>}{Tab}{/Control}');
    expect(activeOf(1)).toBe(`session:${idOf('Quota reset recovery')}`);
    expect(activeOf(0)).toBe(before0);
    await user.keyboard('{Control>}{Shift>}{Tab}{/Shift}{/Control}');
    expect(activeOf(1)).toBe(`session:${idOf('Sidebar interaction pass')}`);
  });

  it('cycles nothing from text entry in the pane, from a key sink, from a button, or under an open menu', async () => {
    const user = userEvent.setup();
    registerSlotForTest();
    render(<Shell />);
    act(() => {
      useLayout.getState().openSession(idOf('Charter + research'), { how: 'tab' });
      useLayout.getState().openSession(idOf('Fix sidebar drag'), { how: 'tab' });
    });
    const start = activeOf(0);
    for (const label of ['pane scratch', 'terminal input', 'composer input']) {
      act(() => screen.getByLabelText(label).focus());
      await user.keyboard('{Control>}{Tab}{/Control}');
      expect(activeOf(0), label).toBe(start);
    }
    act(() => within(tab('Fix sidebar drag · MAWS')).getByRole('button', { hidden: true }).focus());
    await user.keyboard('{Control>}{Tab}{/Control}');
    expect(activeOf(0)).toBe(start);

    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.dataset.state = 'open';
    document.body.append(menu);
    act(() => tab('Fix sidebar drag · MAWS').focus());
    await user.keyboard('{Control>}{Tab}{/Control}');
    menu.remove();
    expect(activeOf(0)).toBe(start);
  });

  it('runAction(tab.next) from inside a terminal key sink (C9’s forwarding) cycles the focused pane once', () => {
    registerSlotForTest();
    render(<Shell />);
    act(() => {
      useLayout.getState().openSession(idOf('Charter + research'), { how: 'tab' });
      useLayout.getState().openSession(idOf('Fix sidebar drag'), { how: 'tab' });
    });
    act(() => screen.getByLabelText('terminal input').focus());
    act(() => runAction('tab.next'));
    expect(activeOf(0)).toBe(`session:${idOf('Charter + research')}`); // wraps from the last tab, once
  });
});

// W12 (I3, §5.2 as amended 2026-10-01): each project has its own tab set; the strip shows the current one. P3-F wave S
// (F17, the owner's obs 8): its project is named by the title bar's chip, and the strip carries no project item.
describe('tab sets per project', () => {
  beforeEach(() => fileTabsByProject());
  const label = () => document.querySelector<HTMLElement>('[data-toolbar] [data-toolbar-project]');
  // W11: a project row's line, which a click activates (the row toggles and the strip shows the project's set)
  const projectRow = (name: string) =>
    within(document.querySelector<HTMLElement>('[data-region="sidebar"]')!).getByRole('treeitem', { name }).querySelector<HTMLElement>('[data-project-line]')!;

  it('a session of another project shows that project’s set, a project click shows its set again, and ⌘1–9 count in the set', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    expect(label()).toBeNull(); // nothing open: the no-project set, unlabelled
    act(() => {
      useLayout.getState().openSession(idOf('Charter + research'), { how: 'tab' });
      useLayout.getState().openSession(idOf('Fix sidebar drag'), { how: 'tab' });
    });
    expect(tabNames()).toEqual(['Charter + research', 'Fix sidebar drag']);
    expect(label()?.textContent).toBe('MAWS');
    await user.click(sidebarRow('Quota reset recovery'));
    expect(tabNames()).toEqual(['Quota reset recovery']);
    expect(label()?.textContent).toBe('codex_somersault');
    await act(async () => runAction('tab.select', 2));
    expect(selected()).toBe('Quota reset recovery'); // MAWS's tabs are not counted
    await user.click(projectRow('MAWS'));
    expect(tabNames()).toEqual(['Charter + research', 'Fix sidebar drag']);
    expect(selected()).toBe('Fix sidebar drag');
    await act(async () => runAction('tab.select', 1));
    expect(selected()).toBe('Charter + research');
    expect(chrome().querySelector('[data-strip-project]')).toBeNull(); // the strip names no project
    // the chip's context menu reveals its project in the sidebar
    act(() => useLayout.getState().setSidebar({ expandedProjects: [] }));
    fireEvent.contextMenu(label()!);
    await user.click(await screen.findByRole('menuitem', { name: 'Reveal in sidebar' }));
    expect(useLayout.getState().regions.sidebar.expandedProjects).toEqual(['proj-maws']);
  });

  it('a project with nothing open shows the empty pane under its name; Other sessions shows the unlabelled no-project set', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    await user.click(projectRow('claude-usage-menubar'));
    expect(tabNames()).toEqual([]);
    expect(within(within(main()).getByRole('tabpanel')).getByText('No open tabs')).toBeTruthy();
    expect(label()?.textContent).toBe('claude-usage-menubar');
    await user.click(projectRow('Other sessions'));
    expect(useLayout.getState().main.current).toBe('none');
    expect(label()).toBeNull();
  });

  it('Settings opened from another project’s set moves to the current one', async () => {
    render(<Shell />);
    act(() => useLayout.getState().openSession(idOf('Charter + research')));
    act(() => useLayout.getState().openTab({ kind: 'settings', section: null }));
    expect(tabNames()).toEqual(['Charter + research', 'Settings']);
    act(() => useLayout.getState().openSession(idOf('Quota reset recovery')));
    act(() => useLayout.getState().openTab({ kind: 'settings', section: null }));
    expect(tabNames()).toEqual(['Quota reset recovery', 'Settings']);
    act(() => useLayout.getState().setCurrentProject('proj-maws' as ProjectId));
    expect(tabNames()).toEqual(['Charter + research']);
  });
});

describe('the settings tab (C11; W6: the Accounts tab retired into the usage popover)', () => {
  it('renders its fallback until C11 registers, titled Settings, closable', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    act(() => useLayout.getState().openTab({ kind: 'diagnostics' }));
    act(() => useLayout.getState().openTab({ kind: 'settings', section: null }));
    expect(tabNames()).toEqual(['Diagnostics', 'Settings']);
    expect(within(main()).getByText('Settings unavailable')).toBeTruthy();
    await user.click(within(tab('Settings')).getByRole('button', { name: 'Close Settings', hidden: true }));
    expect(tabNames()).toEqual(['Diagnostics']);
  });

  it('pass the settings section to the registered slot, following a second open', () => {
    registerSlot('settingsTab', ({ section }) => <p>section {String(section)}</p>);
    render(<Shell />);
    act(() => useLayout.getState().openTab({ kind: 'settings', section: 'keyboard' }));
    expect(within(main()).getByText('section keyboard')).toBeTruthy();
    act(() => useLayout.getState().openTab({ kind: 'settings', section: 'notifications' }));
    expect(within(main()).getByText('section notifications')).toBeTruthy();
    expect(tabNames()).toEqual(['Settings']);
  });
});

// A transcript slot holding the elements a real pane may contain: a plain textarea, a terminal and a composer.
function registerSlotForTest() {
  registerSlot('transcript', () => (
    <div>
      <textarea aria-label="pane scratch" />
      <div data-key-sink="terminal">
        <textarea aria-label="terminal input" />
      </div>
      <div data-key-sink="composer">
        <textarea aria-label="composer input" />
      </div>
    </div>
  ));
}

function fakeBridge() {
  return { invoke: vi.fn(async () => ({ ok: true, value: undefined })), on: vi.fn(() => () => {}) } as unknown as MawsBridge;
}
