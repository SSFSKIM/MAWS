// The side column's second group (UX wave U8b, M3; docs/doperpowers/plans/2026-11-12-ux-wave-U8b-column-and-tabs.md,
// M3 and Interfaces §B): "Move below" and "Move above" in a tab's menu, the bar that shares the height, where a tab that
// is opened goes while there are two groups, and the two groups across a hide, a relaunch and build F's reading.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelTabRef } from '@shared/ipc/schema/layout';
import { fakeClient } from '../../../../test/support/fake-client';
import { buildFSchemaOf, F_surfaceTabIds } from '../../../../test/support/layout-build-f';
import { storedLayout, useLayout } from '../stores/layout';
import { installResizeObserver } from '../test-support/resize';
import { A, probeTool, resetPanelStores, TestHost, type ProbeState } from '../test-support/panel';
import { panelHost, registerPanelTool } from './host';
import { sideGroups, surfaceTabs } from './surface-model';
import { SurfaceRow } from './SurfaceRow';
import type { PanelTool } from './tool';

const offs: (() => void)[] = [];
const register = (...tools: PanelTool<ProbeState, unknown>[]) => tools.forEach((t) => offs.push(registerPanelTool(t)));
const renderHost = () => render(<><SurfaceRow /><TestHost /></>);
const group = (name: 'upper' | 'lower') => document.querySelector<HTMLElement>(`section[data-side-group="${name}"]`);
const stripOf = (name: 'upper' | 'lower') => within(group(name)!).getAllByRole('tab').map((tab) => [tab.textContent, tab.getAttribute('aria-selected') === 'true']);
const tabIn = (name: 'upper' | 'lower', title: string) => within(group(name)!).getByRole('tab', { name: title });
const menuItems = async () => within(await screen.findByRole('menu')).queryAllByRole('menuitem').map((item) => item.textContent);
const inView = () => surfaceTabs(useLayout.getState(), A).map((tab) => tab.id);
const icon = (name: string) => within(screen.getByRole('toolbar', { name: 'Session surfaces' })).getByRole('button', { name });

beforeEach(() => {
  (window as unknown as { happyDOM: { setWindowSize(size: { width: number }): void } }).happyDOM.setWindowSize({ width: 1440 });
  resetPanelStores();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  offs.splice(0).forEach((off) => off());
});

// Review (single-instance), Files and Terminal, opened in that order: three tabs, Terminal in view.
function threeTabs(): { review: string; files: string; terminal: string } {
  register(
    probeTool('review', { title: 'Review', multiInstance: false }).tool,
    probeTool('files', { title: 'Files' }).tool,
    probeTool('terminal', { title: 'Terminal' }).tool,
    probeTool('session-info', { title: 'Session info', multiInstance: false }).tool,
  );
  renderHost();
  const ids = { review: '', files: '', terminal: '' };
  act(() => void (ids.review = panelHost.addTool('review', { appSessionId: A })));
  act(() => void (ids.files = panelHost.addTool('files', { appSessionId: A })));
  act(() => void (ids.terminal = panelHost.addTool('terminal', { appSessionId: A })));
  return ids;
}

async function moveFromMenu(name: 'upper' | 'lower', title: string, item: 'Move below' | 'Move above') {
  fireEvent.contextMenu(tabIn(name, title));
  await userEvent.setup().click(await screen.findByRole('menuitem', { name: item }));
}

describe('a tab’s menu makes and changes the two groups (decision 1)', () => {
  it('“Move below” on the second of three tabs keeps the third in view above and shows the second below, each with its strip', async () => {
    const ids = threeTabs();
    expect(group('lower')).toBeNull();
    await moveFromMenu('upper', 'Files', 'Move below');
    expect(stripOf('upper')).toEqual([['Review', false], ['Terminal', true]]);
    expect(stripOf('lower')).toEqual([['Files', true]]);
    expect(inView()).toEqual([ids.terminal, ids.files]);
    expect(within(group('upper')!).getByRole('tabpanel', { name: 'Terminal' })).toBeTruthy();
    expect(within(group('lower')!).getByRole('tabpanel', { name: 'Files' })).toBeTruthy();
    // the region's controls stay on the first strip (decision 4)
    expect(within(group('upper')!).getByRole('button', { name: 'Hide side column' })).toBeTruthy();
    expect(within(group('lower')!).queryByRole('button', { name: 'Hide side column' })).toBeNull();
  });

  it('“Move above” and “Move below” move a tab between the groups, and a group that loses its last tab closes', async () => {
    const ids = threeTabs();
    await moveFromMenu('upper', 'Files', 'Move below');
    await moveFromMenu('upper', 'Review', 'Move below');
    expect(stripOf('upper')).toEqual([['Terminal', true]]);
    expect(stripOf('lower')).toEqual([['Review', true], ['Files', false]]);
    await moveFromMenu('lower', 'Files', 'Move above');
    expect(stripOf('upper')).toEqual([['Files', true], ['Terminal', false]]);
    expect(stripOf('lower')).toEqual([['Review', true]]);
    await moveFromMenu('lower', 'Review', 'Move above');
    expect(group('lower')).toBeNull();
    expect(stripOf('upper')).toEqual([['Review', true], ['Files', false], ['Terminal', false]]);
    expect(inView()).toEqual([ids.review]);
  });

  it('offers “Move below” on a tab above only while it can split or move, “Move above” on a tab below, and opens on Shift+F10', async () => {
    const user = userEvent.setup();
    register(probeTool('review', { title: 'Review', multiInstance: false }).tool, probeTool('files', { title: 'Files' }).tool);
    renderHost();
    act(() => void panelHost.addTool('review', { appSessionId: A }));
    fireEvent.contextMenu(tabIn('upper', 'Review'));
    expect(screen.queryByRole('menu')).toBeNull(); // the only tab of a single group: nothing to offer, no menu
    act(() => void panelHost.addTool('files', { appSessionId: A }));
    act(() => tabIn('upper', 'Files').focus());
    await user.keyboard('{Shift>}{F10}{/Shift}');
    expect(await menuItems()).toEqual(['Move below']);
    await user.click(screen.getByRole('menuitem', { name: 'Move below' }));
    fireEvent.contextMenu(tabIn('lower', 'Files'));
    expect(await menuItems()).toEqual(['Move above']);
    await user.keyboard('{Escape}');
    fireEvent.contextMenu(tabIn('upper', 'Review')); // the upper group's only tab, with two groups: it can move below
    expect(await menuItems()).toEqual(['Move below']);
    await user.keyboard('{Escape}');
  });
});

describe('where a tab that is opened goes with two groups (decision 3)', () => {
  it('a tab of a tool opened next joins the group that holds that tool’s tab, and comes into view there', async () => {
    const ids = threeTabs();
    await moveFromMenu('upper', 'Files', 'Move below');
    let second = '';
    act(() => void (second = panelHost.addTool('files', { appSessionId: A })));
    expect(stripOf('lower')).toEqual([['Files', false], ['Files', true]]);
    expect(inView()).toEqual([ids.terminal, second]);
    act(() => void panelHost.addTool('review', { appSessionId: A })); // a single-instance tool's tab is shown where it is
    expect(inView()).toEqual([ids.review, second]);
  });

  it('a new tool chosen from the lower group’s “+” goes below, with the pointer', async () => {
    const user = userEvent.setup();
    const ids = threeTabs();
    await moveFromMenu('upper', 'Files', 'Move below');
    await user.click(within(group('lower')!).getByRole('button', { name: 'Add a tool' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Session info' }));
    expect(stripOf('lower')).toEqual([['Files', false], ['Session info', true]]);
    expect(stripOf('upper')).toEqual([['Review', false], ['Terminal', true]]);
    expect(inView()[0]).toBe(ids.terminal);
  });

  it('a new tool chosen from the lower group’s “+” goes below, with the keyboard alone', async () => {
    const user = userEvent.setup();
    threeTabs();
    await moveFromMenu('upper', 'Files', 'Move below');
    act(() => within(group('lower')!).getByRole('button', { name: 'Add a tool' }).focus());
    await user.keyboard('{Enter}');
    const item = await screen.findByRole('menuitem', { name: 'Session info' });
    act(() => item.focus());
    expect(group('lower')!.contains(document.activeElement)).toBe(false); // the menu's portal holds the keyboard
    await user.keyboard('{Enter}');
    expect(stripOf('lower')).toEqual([['Files', false], ['Session info', true]]);
  });

  it('an opener with no origin of its own goes to the group that holds the keyboard, and above when the keyboard is outside the column', async () => {
    const user = userEvent.setup();
    threeTabs();
    await moveFromMenu('upper', 'Files', 'Move below');
    act(() => icon('Review').focus());
    act(() => void panelHost.addTool('session-info', { appSessionId: A }));
    expect(stripOf('upper')).toEqual([['Review', false], ['Terminal', false], ['Session info', true]]);
    await act(() => panelHost.closeTab(useLayout.getState().effectivePanelTabs(A).find((tab) => tab.toolId === 'session-info')!.id));
    act(() => tabIn('lower', 'Files').focus());
    act(() => void panelHost.addTool('session-info', { appSessionId: A }));
    expect(stripOf('lower')).toEqual([['Files', false], ['Session info', true]]);
    // a menu opened from the lower strip (its portal holds the keyboard) counts as the lower group: a plugin pane's item
    // opens through an opener that names no group
    register(probeTool('notes', { title: 'Notes' }).tool); // a tool neither group holds
    await user.click(within(group('lower')!).getByRole('button', { name: 'Add a tool' }));
    act(() => screen.getAllByRole('menuitem')[0].focus());
    act(() => void panelHost.addTool('notes', { appSessionId: A }));
    expect(stripOf('lower')).toEqual([['Files', false], ['Session info', false], ['Notes', true]]);
  });

  it('an open chosen in the lower strip’s “+” menu goes below though the upper group holds its tool, its opener naming no group', async () => {
    // a plugin pane's item: `openPaneTab` adds every pane under the one pane tool and passes no group
    const user = userEvent.setup();
    register(probeTool('files', { title: 'Files' }).tool, probeTool('pane', { title: 'Pane' }).tool, probeTool('terminal', { title: 'Terminal' }).tool);
    renderHost();
    act(() => void panelHost.addTool('pane', { appSessionId: A }));
    act(() => void panelHost.addTool('files', { appSessionId: A }));
    act(() => void panelHost.addTool('terminal', { appSessionId: A }));
    await moveFromMenu('upper', 'Terminal', 'Move below');
    await user.click(within(group('lower')!).getByRole('button', { name: 'Add a tool' }));
    act(() => screen.getAllByRole('menuitem')[0].focus());
    act(() => void panelHost.addTool('pane', { appSessionId: A }));
    expect(stripOf('upper')).toEqual([['Pane', false], ['Files', true]]);
    expect(stripOf('lower')).toEqual([['Terminal', false], ['Pane', true]]);
    await user.keyboard('{Escape}');
  });

  it('an icon’s tool opened with the keyboard outside the column goes above', async () => {
    const user = userEvent.setup();
    register(probeTool('review', { title: 'Review', multiInstance: false }).tool, probeTool('files', { title: 'Files' }).tool, probeTool('terminal', { title: 'Terminal' }).tool);
    renderHost();
    act(() => void panelHost.addTool('files', { appSessionId: A }));
    act(() => void panelHost.addTool('terminal', { appSessionId: A }));
    await moveFromMenu('upper', 'Terminal', 'Move below');
    await user.click(icon('Review'));
    expect(stripOf('upper')).toEqual([['Files', false], ['Review', true]]);
    expect(stripOf('lower')).toEqual([['Terminal', true]]);
  });

  it('closing the lower group’s last tab leaves one group', async () => {
    const user = userEvent.setup();
    const ids = threeTabs();
    await moveFromMenu('upper', 'Files', 'Move below');
    await user.click(within(group('lower')!).getByRole('button', { name: 'Close Files' }));
    expect(group('lower')).toBeNull();
    expect(stripOf('upper')).toEqual([['Review', false], ['Terminal', true]]);
    expect(inView()).toEqual([ids.terminal]);
    expect(useLayout.getState().panelGroups.lower[A]).toBeUndefined();
  });
});

describe('the bar between the groups (decision 2)', () => {
  // A column 806 px tall: 800 px for the groups beside the 6 px bar, so 8 px is 1 % of the share.
  async function splitColumn(height = 806) {
    const observer = installResizeObserver();
    threeTabs();
    await moveFromMenu('upper', 'Files', 'Move below');
    observer.resize(document.querySelector('[data-surface-stack]')!, { width: 360, height });
    return screen.getByRole('separator', { name: 'Resize groups' });
  }
  const share = () => sideGroups(useLayout.getState(), A).lower?.share;

  it('is a horizontal separator whose value is the lower group’s share in percent', async () => {
    const bar = await splitColumn();
    expect(bar.getAttribute('aria-orientation')).toBe('horizontal');
    expect([bar.getAttribute('aria-valuenow'), bar.getAttribute('aria-valuemin'), bar.getAttribute('aria-valuemax')]).toEqual(['50', '20', '80']);
    expect(bar.getAttribute('aria-controls')).toBe(group('lower')!.id);
    expect(group('lower')!.style.height).toBe('400px');
  });

  // Addendum 1 of the branch review's fix wave: the bar follows a pointer drag, as the two-build scene drags it.
  it('a pointer drag moves the share: 48 px up gives the lower group 6 % more', async () => {
    const bar = await splitColumn();
    act(() => void fireEvent.pointerDown(bar, { pointerId: 1, button: 0, clientY: 400 }));
    for (const y of [388, 376, 364, 352]) act(() => void fireEvent.pointerMove(bar, { pointerId: 1, clientY: y }));
    act(() => void fireEvent.pointerUp(bar, { pointerId: 1, clientY: 352 }));
    expect(share()).toBeCloseTo(0.56);
    expect(bar.getAttribute('aria-valuenow')).toBe('56');
  });

  it('its keys move the share, 8 px a step and 32 with Shift, and it stops at the bounds', async () => {
    const user = userEvent.setup();
    const bar = await splitColumn();
    act(() => bar.focus());
    await user.keyboard('{ArrowUp}');
    expect(share()).toBeCloseTo(0.51);
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    expect(share()).toBeCloseTo(0.47);
    expect(bar.getAttribute('aria-valuenow')).toBe('47');
    await user.keyboard('{End}{ArrowUp}');
    expect(share()).toBe(0.8);
    await user.keyboard('{Home}{ArrowDown}');
    expect(share()).toBe(0.2);
    await user.keyboard('{Enter}');
    expect(share()).toBe(0.5);
  });

  it('keeps each group 120 px, and in a column too short for both the lower group gives way down to its strip', async () => {
    const observer = installResizeObserver();
    threeTabs();
    await moveFromMenu('upper', 'Files', 'Move below');
    const stack = document.querySelector('[data-surface-stack]')!;
    act(() => useLayout.getState().setGroupShare(A, 0.2));
    observer.resize(stack, { width: 360, height: 406 }); // 400 px: a fifth is 80, under the floor
    expect(group('lower')!.style.height).toBe('120px');
    act(() => useLayout.getState().setGroupShare(A, 0.8));
    expect(group('lower')!.style.height).toBe('280px'); // the upper keeps 120
    observer.resize(stack, { width: 360, height: 206 });
    expect(group('lower')!.style.height).toBe('80px');
    observer.resize(stack, { width: 360, height: 106 });
    expect(group('lower')!.style.height).toBe('36px'); // its strip
  });

  it('a reset gives the share back 0.5 in a column too short for the bar to move', async () => {
    const user = userEvent.setup();
    const bar = await splitColumn(206); // 200 px: both bounds and the drawn lower group are 80 px
    act(() => useLayout.getState().setGroupShare(A, 0.8));
    act(() => bar.focus());
    await user.keyboard('{Enter}');
    expect(share()).toBe(0.5);
    act(() => useLayout.getState().setGroupShare(A, 0.8));
    await user.dblClick(bar);
    expect(share()).toBe(0.5);
  });
});

describe('the two groups are kept', () => {
  it('hiding the column and showing it again brings back both groups and both tabs in view', async () => {
    const user = userEvent.setup();
    const ids = threeTabs();
    await moveFromMenu('upper', 'Files', 'Move below');
    await user.click(screen.getByRole('button', { name: 'Hide side column' }));
    expect(group('upper')).toBeNull();
    await user.click(icon('Terminal'));
    expect(inView()).toEqual([ids.terminal, ids.files]);
    expect(stripOf('lower')).toEqual([['Files', true]]);
  });

  it('a relaunch restores them, and build F reads the written values as its two stacked surfaces', async () => {
    const ids = threeTabs();
    await moveFromMenu('upper', 'Files', 'Move below');
    act(() => useLayout.getState().setGroupShare(A, 0.35));
    const before = sideGroups(useLayout.getState(), A);
    const values = Object.fromEntries(storedLayout(useLayout.getState()));
    for (const [key, value] of Object.entries(values)) expect(buildFSchemaOf(key)?.safeParse(value).success ?? true, key).toBe(true);
    const own = values[`panel.${A}`] as { tabs: PanelTabRef[]; activeTabId: string | null };
    const stacks = (values['panelTools.surfaces'] as { stacks: Record<string, string[]> }).stacks;
    expect(F_surfaceTabIds([...(values['panel.pinned'] as PanelTabRef[]), ...own.tabs], stacks[A], own.activeTabId)).toEqual([ids.terminal, ids.files]);
    // a relaunch: the store hydrates from what it wrote, over a column that holds nothing
    act(() => useLayout.setState({ panelBySession: new Map(), panelSurfaces: { version: 2, stacks: {}, pinnedTools: [], contexts: {} }, panelGroups: { version: 1, lower: {} } }));
    expect(sideGroups(useLayout.getState(), A)).not.toEqual(before);
    const fake = fakeClient({ 'layout.list': { keys: Object.keys(values) }, 'layout.get': ({ key }: { key: string }) => ({ value: values[key] ?? null }), 'layout.set': undefined });
    await act(() => useLayout.getState().hydrate(fake.client, () => true));
    expect(sideGroups(useLayout.getState(), A)).toEqual(before);
  });
});
