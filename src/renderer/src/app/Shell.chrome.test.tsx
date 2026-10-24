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

vi.mock('./Diagnostics', () => ({ Diagnostics: () => <section aria-label="Diagnostics">diagnostics</section> }));

const offs: (() => void)[] = [];
const setWidth = (width: number) => (window as unknown as { happyDOM: { setWindowSize(size: { width: number }): void } }).happyDOM.setWindowSize({ width });
const chrome = () => screen.getByRole('banner');
const strips = () => chrome().querySelector<HTMLElement>('[data-chrome-tabs]')!;
const renderShell = () => render(<QueryClientProvider client={queryClient}><Shell /></QueryClientProvider>);

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
  it('uses the header width left by a wide surface, not the window width, and keeps overflow keyboard accessible', async () => {
    const user = userEvent.setup();
    setWidth(900);
    useLayout.setState({ panelBySession: new Map([[A, { tabs: [ref('review:aaaaaaaa')], activeTabId: 'review:aaaaaaaa' }]]) });
    renderShell();
    expect(document.querySelector('[data-shell]')!.getAttribute('style')).toContain('540px');
    const row = within(chrome()).getByRole('toolbar', { name: 'Session surfaces' });
    expect(within(row).queryByRole('button', { name: 'terminal' })).toBeNull();
    expect(within(chrome()).queryByRole('button', { name: 'Session actions' })).toBeNull();
    expect(within(chrome()).queryByRole('button', { name: 'Overview' })).toBeNull();
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
    setWidth(900);
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
