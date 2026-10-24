import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../ipc/query';
import { registerPanelTool } from '../panel/host';
import { PanelHost } from '../panel/PanelHost';
import { currentSet } from '../stores/layout-model';
import { useLayout } from '../stores/layout';
import { A, mainShowing, probeTool, ref, resetPanelStores } from '../test-support/panel';
import { Shell } from './Shell';
import { useShellView } from './shell-view';
import { registerSlot, resetSlots } from './slots';
import { registerSessionAction } from './session-actions';

vi.mock('./Diagnostics', () => ({ Diagnostics: () => <section aria-label="Diagnostics">diagnostics</section> }));

const offs: (() => void)[] = [];
const setWidth = (width: number) => (window as unknown as { happyDOM: { setWindowSize(size: { width: number }): void } }).happyDOM.setWindowSize({ width });
const chrome = () => screen.getByRole('banner');
const strips = () => chrome().querySelector<HTMLElement>('[data-chrome-tabs]')!;
const renderShell = () => render(<QueryClientProvider client={queryClient}><Shell /></QueryClientProvider>);
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

beforeEach(() => {
  setWidth(1440);
  resetPanelStores();
  useShellView.setState({ sidebarOverlay: false, cardsOverlay: false });
  for (const id of ['terminal', 'review', 'browser', 'files', 'scm']) offs.push(registerPanelTool(probeTool(id, { title: id }).tool));
  registerSlot('panelHost', PanelHost);
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
  resetSlots();
});

describe('the chrome yields to the tab strip', () => {
  it.each([1440, 900])('keeps collapsed-sidebar navigation clear of the native traffic lights at %ipx', (width) => {
    setWidth(width);
    useLayout.getState().setSidebar({ collapsed: true });
    if (width === 900) useLayout.getState().setPanelTabs(A, { tabs: [ref('review:aaaaaaaa')], activeTabId: 'review:aaaaaaaa' });
    renderShell();
    const navigation = within(chrome()).getByRole('button', { name: 'Toggle sidebar' }).parentElement!;
    const leading = navigation.parentElement!;
    // Layout arithmetic at the renderer boundary: 28px icon buttons, 4px inter-button gap, 12px right inset.
    // happy-dom has no box layout; the Mac acceptance test checks the actual button bounds.
    const count = within(navigation).getAllByRole('button').length;
    const firstControlX = Number.parseFloat(leading.style.width) - 12 - count * 28 - (count - 1) * 4;
    expect(firstControlX).toBeGreaterThanOrEqual(78);
  });

  it('keeps one More control at full width and routes session actions through its keyboard submenu', async () => {
    const user = userEvent.setup();
    const pin = vi.fn();
    offs.push(registerSessionAction('pin', pin));
    renderShell();
    expect(within(chrome()).queryByRole('button', { name: 'Session actions' })).toBeNull();
    const more = within(chrome()).getByRole('button', { name: 'More surfaces' });
    act(() => more.focus());
    await user.keyboard('{ArrowDown}');
    const actions = await screen.findByRole('menuitem', { name: 'Session actions' });
    act(() => actions.focus());
    await user.keyboard('{ArrowRight}');
    const pinItem = await screen.findByRole('menuitem', { name: 'Pin' });
    expect(document.activeElement).toBe(pinItem);
    await user.keyboard('{Enter}');
    expect(pin).toHaveBeenCalledWith(A);
  });

  it('uses the header width left by a wide surface, not the window width, and keeps overflow keyboard accessible', async () => {
    const user = userEvent.setup();
    setWidth(900);
    useLayout.setState({ panelBySession: new Map([[A, { tabs: [ref('review:aaaaaaaa')], activeTabId: 'review:aaaaaaaa' }]]) });
    renderShell();
    expect(document.querySelector('[data-shell]')!.getAttribute('style')).toContain('540px');
    const row = within(chrome()).getByRole('toolbar', { name: 'Session surfaces' });
    expect(within(row).queryByRole('button', { name: 'terminal' })).toBeNull();
    expect(within(chrome()).queryByRole('button', { name: 'Session actions' })).toBeNull();
    expect(within(chrome()).getByRole('button', { name: 'Overview' })).toBeTruthy();
    expect(within(strips()).getByRole('tablist', { name: 'Open tabs' })).toBeTruthy();
    const more = within(row).getByRole('button', { name: 'More surfaces' });
    act(() => more.focus());
    await user.keyboard('{ArrowDown}');
    const terminal = await screen.findByRole('menuitem', { name: 'terminal' });
    act(() => terminal.focus());
    await user.keyboard('{Enter}');
    expect(useLayout.getState().effectivePanelTabs(A).some((tab) => tab.toolId === 'terminal')).toBe(true);

    act(() => setWidth(1440));
    expect(['terminal', 'review', 'browser', 'files'].map((name) => within(row).getByRole('button', { name }).getAttribute('aria-label'))).toEqual(['terminal', 'review', 'browser', 'files']);
  });

  it('keeps a folded saved surface’s context actions reachable from the keyboard', async () => {
    const user = userEvent.setup();
    offs.push(registerPanelTool(probeTool('artifacts', { multiInstance: false }).tool));
    setWidth(700);
    useLayout.setState({ panelBySession: new Map([[A, { tabs: [ref('artifacts:aaaaaaaa')], activeTabId: 'artifacts:aaaaaaaa' }]]) });
    renderShell();
    expect(within(chrome()).queryByRole('button', { name: 'artifacts' })).toBeNull();
    const more = within(chrome()).getByRole('button', { name: 'More surfaces' });
    act(() => more.focus());
    await user.keyboard('{ArrowDown}');
    const item = await screen.findByRole('menuitem', { name: 'artifacts' });
    act(() => item.focus());
    await user.keyboard('{Shift>}{F10}{/Shift}');
    const keep = await screen.findByRole('menuitem', { name: 'Keep open for every session' });
    await user.click(keep);
    expect(useLayout.getState().panelPinned.map((tab) => tab.id)).toContain('artifacts:aaaaaaaa');
  });

  it('reopens a held global non-primary pin from More without a session tab', async () => {
    const user = userEvent.setup();
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, panelPinned: [ref('scm:pinned00', true)], panelActiveNoSession: null });
    renderShell();
    await user.click(within(chrome()).getByRole('button', { name: 'More surfaces' }));
    const item = await screen.findByRole('menuitem', { name: 'scm' });
    expect(item.getAttribute('aria-disabled')).not.toBe('true');
    await user.click(item);
    expect(useLayout.getState().panelActiveNoSession).toBe('scm:pinned00');
    expect(document.querySelector<HTMLElement>('[data-region="panel"]')!.inert).toBe(false);
  });

  it.each(['maximized', 'floating'] as const)('keeps controls above the surface body while %s, without changing docked full-height surfaces', (mode) => {
    useLayout.setState({ panelBySession: new Map([[A, { tabs: [ref('review:aaaaaaaa')], activeTabId: 'review:aaaaaaaa' }]]) });
    renderShell();
    const panel = document.querySelector<HTMLElement>('[data-region="panel"]')!;
    expect(panel.className).toContain('row-start-1');
    act(() => useLayout.getState().setPanel({ [mode]: true }));
    expect(chrome().className).toContain('col-span-3');
    expect(panel.className).toContain('row-start-3');
    expect(within(chrome()).getByRole('button', { name: 'browser' }).closest('[inert]')).toBeNull();
  });
});

it('dismisses a narrow sheet with Escape or its backdrop without forgetting its tools', async () => {
  setWidth(620);
  useLayout.getState().setPanelTabs(A, { tabs: [ref('review:aaaaaaaa')], activeTabId: 'review:aaaaaaaa' });
  renderShell();
  await userEvent.keyboard('{Escape}');
  await act(nextFrame);
  expect(document.getElementById('region-main')!.hasAttribute('inert')).toBe(false);
  expect(document.activeElement).toBe(within(strips()).getByRole('tab', { selected: true }));
  expect(useLayout.getState().effectivePanelTabs(A)).toHaveLength(1);
  act(() => useLayout.getState().setPanel({ collapsed: false }));
  await userEvent.click(screen.getByRole('button', { name: 'Close surface sheet' }));
  await act(nextFrame);
  expect(document.getElementById('region-main')!.hasAttribute('inert')).toBe(false);
  expect(document.activeElement).toBe(within(strips()).getByRole('tab', { selected: true }));
});

it.each([
  ['Escape', true], ['Escape', false], ['backdrop', true], ['backdrop', false],
] as const)('restores usable focus after %s sheet dismissal and layout commit (opener available: %s)', async (dismissal, available) => {
  const user = userEvent.setup();
  setWidth(620);
  useLayout.getState().setPanel({ collapsed: true });
  offs.push(registerPanelTool(probeTool('focus', { render: () => <input aria-label="Sheet editor" autoFocus /> }).tool));
  render(<>
    <button onClick={() => {
      useLayout.getState().setPanelTabs(A, { tabs: [ref('focus:aaaaaaaa')], activeTabId: 'focus:aaaaaaaa' });
      useLayout.getState().setPanel({ collapsed: false });
    }}>Open test sheet</button>
    <QueryClientProvider client={queryClient}><Shell /></QueryClientProvider>
  </>);
  const opener = screen.getByRole('button', { name: 'Open test sheet' });
  await user.click(opener);
  const field = screen.getByRole('textbox', { name: 'Sheet editor' });
  field.focus();
  expect(document.activeElement).toBe(field);
  if (!available) opener.setAttribute('disabled', '');
  const target = available ? opener : within(strips()).getByRole('tab', { selected: true });
  const inertAtFocus: boolean[] = [];
  const focus = target.focus.bind(target);
  vi.spyOn(target, 'focus').mockImplementation((options) => {
    inertAtFocus.push(document.getElementById('region-main')!.hasAttribute('inert'));
    focus(options);
  });
  if (dismissal === 'Escape') await user.keyboard('{Escape}');
  else await user.click(screen.getByRole('button', { name: 'Close surface sheet' }));
  await act(nextFrame);
  expect(screen.queryByRole('button', { name: 'Close surface sheet' })).toBeNull();
  expect(inertAtFocus).toEqual([false]);
  expect(document.activeElement).toBe(target);
  expect(target.closest('[inert]')).toBeNull();
});

it('leaves composing Escape and keyboard focus in a narrow sheet field', async () => {
  setWidth(620);
  offs.push(registerPanelTool(probeTool('ime', { render: () => <input aria-label="Korean sheet field" defaultValue="한" /> }).tool));
  useLayout.getState().setPanelTabs(A, { tabs: [ref('ime:aaaaaaaa')], activeTabId: 'ime:aaaaaaaa' });
  renderShell();
  const field = screen.getByRole('textbox', { name: 'Korean sheet field' });
  field.focus();
  const composing = new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true });
  act(() => field.dispatchEvent(composing));
  expect(useLayout.getState().regions.panel.collapsed).toBe(false);
  expect(screen.getByRole('button', { name: 'Close surface sheet' })).toBeTruthy();
  expect(composing.defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(field);
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('button', { name: 'Close surface sheet' })).toBeNull();
});

it('does not show Session cards as pressed for an unstarted New chat', () => {
  useLayout.getState().openTab({ kind: 'session', appSessionId: 'unstarted-chat' as typeof A });
  renderShell();
  const cards = within(chrome()).getByRole('button', { name: 'Session cards' });
  expect(cards.getAttribute('aria-pressed')).toBe('false');
  expect(cards.hasAttribute('disabled')).toBe(true);
  expect(screen.queryByRole('complementary', { name: 'Session cards' })).toBeNull();
});

it('keeps Overview reachable at 900 with a surface', async () => {
  setWidth(900);
  useLayout.getState().setPanelTabs(A, { tabs: [ref('review:aaaaaaaa')], activeTabId: 'review:aaaaaaaa' });
  renderShell();
  await userEvent.click(within(chrome()).getByRole('button', { name: 'Overview' }));
  expect(useLayout.getState().overviewOpen).toBe(true);
});

describe('the portaled pane strip order', () => {
  it('restores left before right in DOM and keyboard order after the left session floats and docks', async () => {
    const user = userEvent.setup();
    useLayout.setState({ main: mainShowing(A) });
    useLayout.getState().openTab({ kind: 'settings', section: null }, { pane: 'other' });
    renderShell();
    const order = () => [...strips().querySelectorAll<HTMLElement>('[data-chrome-pane]')].map((node) => node.dataset.chromePane);
    expect(order()).toEqual(['0', '1']);
    act(() => useLayout.getState().floatSplit(`session:${A}`));
    expect(order()).toEqual(['1']);
    act(() => useLayout.getState().dockSplit());
    expect(currentSet(useLayout.getState().main).panes).toHaveLength(2);
    expect(order()).toEqual(['0', '1']);
    const left = within(strips()).getByRole('tablist', { name: 'Left pane tabs' });
    const right = within(strips()).getByRole('tablist', { name: 'Right pane tabs' });
    act(() => within(left).getByRole('tab').focus());
    // The disabled New chat buttons are skipped; Tab should reach the right active tab next.
    await user.tab();
    expect(document.activeElement).toBe(within(right).getByRole('tab'));
  });
});
