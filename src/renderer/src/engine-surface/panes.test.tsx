// R2: a plugin's panes as `plugin-pane` panel tabs (panes.ts, PaneTool.tsx): the roster read when a session attaches and
// followed through `plugin.panes`, tabs opened and closed with it, the pane's drawing or Desktop's placeholder, the
// engine told which pane shows and when the person closes one, and the panel's "+" listing them under "Plugin panes".
// The pane's tree is the one 2.1.287 answered in pass3/mods-surface-render-sites.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaneRoster } from '@shared/engine/surface';
import type { SessionEvent } from '@shared/graph/events';
import type { CommandName } from '@shared/ipc/schema';
import { status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { loadJournal } from '../../../../test/support/fixtures';
import { panelHost, usePanelHost } from '../panel/host';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { registerFocusTarget } from '../stores/composer';
import { banner, toast, useNotices } from '../stores/notices';
import { BannerHost } from '../app/BannerHost';
import { ToastHost } from '../app/ToastHost';
import { A, panelOf, resetPanelStores, TestHost } from '../test-support/panel';
import { connectPluginPanes, resetPaneRosters } from './panes';
import { resetSurfaceRegistry } from './registry';
import { usePaneRosters } from './pane-roster';

// The Pane answer of the fixture (seq 58).
const PANE_ANSWER = (() => {
  const rows = loadJournal('pass3', 'mods-surface-render-sites');
  const asked = rows.find((r) => r.direction === 'out' && (r.frame as { request?: { component?: string } }).request?.component === 'Pane')!;
  const id = (asked.frame as { request_id: string }).request_id;
  return (rows.find((r) => r.direction === 'in' && (r.frame as { response?: { request_id?: string } }).response?.request_id === id)!.frame as { response: { response: Record<string, unknown> } }).response.response;
})();

const pane = (id: string, title: string) => ({ id, title, plugin: 'mods-probe', closeOnEscape: false, holdToasts: false, rows: null, columns: null });
const roster = (panes: ReturnType<typeof pane>[], shownId: string | null = panes[0]?.id ?? null, over: Partial<PaneRoster> = {}): PaneRoster => ({ panes, shownId, focusedId: null, focusRequestedId: null, ...over });
const push = (fake: FakeClient, value: PaneRoster, seq = 1) =>
  act(() => fake.event('session.eventBatch', { appSessionId: A, events: [{ id: `${A}:L:${seq}:0`, sessionId: 's', at: '2026-10-02T00:00:00.000Z', seq, agentId: null, parentToolUseId: null, kind: 'plugin.panes', ...value } as SessionEvent] }));
const attach = () => act(() => useSessions.getState().applyStatus({ appSessionId: A, status: { ...status(A), uiSurface: { clientId: 'maws-main' } } }));
const tabs = () => screen.queryAllByRole('tab').map((t) => [t.textContent, t.getAttribute('aria-selected') === 'true']);
const paneTabs = () => (panelOf(A)?.tabs ?? []).filter((t) => t.toolId === 'plugin-pane');

let fake: FakeClient;
let disconnect: () => void;
function connect(answers: Partial<Record<CommandName, unknown>>) {
  fake = fakeClient({ 'session.ui.paneShow': { shownId: null }, 'session.ui.paneFocus': { focusedId: null }, ...answers });
  disconnect = connectPluginPanes(fake.client);
}
beforeEach(() => {
  resetPanelStores();
  resetSurfaceRegistry();
  resetPaneRosters();
  useNotices.setState({ notices: [] });
});
afterEach(() => {
  disconnect();
  cleanup();
  vi.useRealTimers();
});

describe('plugin panes as panel tabs (R2)', () => {
  it('reads the roster when the session attaches, opens the shown pane’s tab with its title, draws its tree, and closes the tab when the pane leaves', async () => {
    connect({ 'session.ui.panes': roster([pane('mods-probe-pane', 'Probe pane')]), 'session.ui.render': PANE_ANSWER });
    render(<TestHost />);
    attach();
    await waitFor(() => expect(tabs()).toEqual([['Plugin pane · Probe pane', true]]));
    expect(fake.invoked('session.ui.panes')).toEqual([{ appSessionId: A }]);
    expect(await screen.findByText('MODS_PROBE_PANE picked=one focused=false placement=dock')).toBeTruthy();
    expect(fake.invoked('session.ui.render')[0]).toMatchObject({ appSessionId: A, component: 'Pane', instanceId: 'mods-probe-pane', props: { title: 'Probe pane', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } });
    expect(fake.invoked('session.ui.paneShow')).toEqual([]); // the engine already shows it
    push(fake, roster([], null));
    await waitFor(() => expect(paneTabs()).toEqual([]));
    expect(fake.invoked('session.ui.close')).toEqual([]); // closed engine-side: the engine is not asked
  });

  it('shows Desktop’s placeholder until the plugin draws', async () => {
    connect({ 'session.ui.panes': roster([pane('mods-probe-pane', 'Probe pane')]) });
    render(<TestHost />);
    attach();
    const status = await screen.findByRole('status');
    expect(within(status).getByText('Nothing to show yet')).toBeTruthy();
    expect(within(status).getByText('mods-probe has not drawn in this pane')).toBeTruthy();
  });

  it('a pushed pane the engine does not show gets a tab left unselected; showing it tells the engine', async () => {
    connect({ 'session.ui.panes': roster([pane('one', 'One')]), 'session.ui.render': PANE_ANSWER });
    render(<TestHost />);
    attach();
    await waitFor(() => expect(tabs()).toEqual([['Plugin pane · One', true]]));
    push(fake, roster([pane('one', 'One'), pane('two', 'Two')], 'one'));
    await waitFor(() => expect(tabs()).toEqual([['Plugin pane · One', true], ['Plugin pane · Two', false]]));
    await userEvent.click(screen.getByRole('tab', { name: /Two/ }));
    await waitFor(() => expect(fake.invoked('session.ui.paneShow')).toEqual([{ appSessionId: A, id: 'two' }]));
  });

  it('"+" lists the session’s panes under "Plugin panes"; choosing a pane whose tab was closed opens it again', async () => {
    const user = userEvent.setup();
    connect({ 'session.ui.panes': roster([pane('one', 'One'), pane('two', 'Two')], 'one'), 'session.ui.render': PANE_ANSWER });
    render(<TestHost />);
    attach();
    await waitFor(() => expect(paneTabs()).toHaveLength(2));
    // the tab of `two` goes (as a restored tab would, or one closed while the plugin kept the pane)
    const two = paneTabs()[1]!.id;
    act(() => useLayout.getState().updatePanelTabs(A, (refs) => refs.filter((r) => r.id !== two)));
    await user.click(screen.getByRole('button', { name: 'Add a tool' }));
    const group = await screen.findByRole('group', { name: 'Plugin panes' });
    expect(within(group).getByText('Plugin panes')).toBeTruthy();
    expect(within(group).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Onemods-probe', 'Twomods-probe']);
    await user.click(within(group).getByRole('menuitem', { name: /Two/ }));
    await waitFor(() => expect(tabs()).toEqual([['Plugin pane · One', false], ['Plugin pane · Two', true]]));
    await waitFor(() => expect(fake.invoked('session.ui.paneShow')).toEqual([{ appSessionId: A, id: 'two' }]));
  });

  it('the person’s close asks the engine, and a plugin that keeps the pane keeps the tab', async () => {
    connect({ 'session.ui.panes': roster([pane('mods-probe-pane', 'Probe pane')]), 'session.ui.render': PANE_ANSWER });
    render(<TestHost />);
    attach();
    await waitFor(() => expect(paneTabs()).toHaveLength(1));
    const id = paneTabs()[0]!.id;
    let closing!: Promise<boolean>;
    act(() => void (closing = panelHost.closeTab(id)));
    await act(() => fake.reply('session.ui.close', { closed: false }));
    expect(await closing).toBe(false);
    expect(paneTabs().map((t) => t.id)).toEqual([id]);
    act(() => void (closing = panelHost.closeTab(id)));
    await act(() => fake.reply('session.ui.close', { closed: true }));
    expect(await closing).toBe(true);
    expect(fake.invoked('session.ui.close')).toEqual([{ appSessionId: A, id: 'mods-probe-pane' }, { appSessionId: A, id: 'mods-probe-pane' }]);
    expect(paneTabs()).toEqual([]);
  });

  it('a standing focus request selects its pane’s tab and answers the engine; one for a session not on screen is refused', async () => {
    connect({ 'session.ui.panes': roster([pane('one', 'One'), pane('two', 'Two')], 'one'), 'session.ui.render': PANE_ANSWER });
    render(<TestHost />);
    attach();
    await waitFor(() => expect(paneTabs()).toHaveLength(2));
    push(fake, roster([pane('one', 'One'), pane('two', 'Two')], 'one', { focusRequestedId: 'two' }));
    await waitFor(() => expect(tabs()).toEqual([['Plugin pane · One', false], ['Plugin pane · Two', true]]));
    expect(fake.invoked('session.ui.paneFocus')).toContainEqual({ appSessionId: A, id: 'two' });
  });

  it('a change of the engine’s shown pane selects its existing tab; an unchanged roster leaves the person’s choice', async () => {
    connect({ 'session.ui.panes': roster([pane('one', 'One'), pane('two', 'Two')], 'one'), 'session.ui.render': PANE_ANSWER });
    render(<TestHost />);
    attach();
    await waitFor(() => expect(tabs()).toEqual([['Plugin pane · One', true], ['Plugin pane · Two', false]]));
    push(fake, roster([pane('one', 'One'), pane('two', 'Two')], 'two'), 2);
    await waitFor(() => expect(tabs()).toEqual([['Plugin pane · One', false], ['Plugin pane · Two', true]]));
    act(() => panelHost.selectTab(paneTabs()[0]!.id)); // the person goes back to One
    push(fake, roster([pane('one', 'One'), pane('two', 'Two')], 'two'), 3); // the same roster again (another field moved)
    await waitFor(() => expect(tabs()).toEqual([['Plugin pane · One', true], ['Plugin pane · Two', false]]));
  });

  it('a passive change of the shown pane selects its tab and leaves the keyboard where it is', async () => {
    connect({ 'session.ui.panes': roster([pane('one', 'One'), pane('two', 'Two')], 'one'), 'session.ui.render': PANE_ANSWER });
    render(<TestHost />);
    attach();
    await waitFor(() => expect(paneTabs()).toHaveLength(2));
    const composer = document.body.appendChild(document.createElement('textarea'));
    composer.focus();
    const two = paneTabs()[1]!.id;
    const asked = usePanelHost.getState().focus[two] ?? 0;
    push(fake, roster([pane('one', 'One'), pane('two', 'Two')], 'two'), 2);
    await waitFor(() => expect(tabs()).toEqual([['Plugin pane · One', false], ['Plugin pane · Two', true]]));
    expect(await screen.findByText('MODS_PROBE_PANE picked=one focused=false placement=dock')).toBeTruthy();
    expect(usePanelHost.getState().focus[two] ?? 0).toBe(asked);
    expect(document.activeElement).toBe(composer);
    composer.remove();
  });

  it.each([false, true])('a newly shown pane selects without taking the composer keyboard or revealing the panel (collapsed=%s)', async (collapsed) => {
    connect({ 'session.ui.panes': roster([pane('one', 'One')]), 'session.ui.render': PANE_ANSWER });
    render(<><textarea aria-label="Composer" /><TestHost /></>);
    attach();
    await waitFor(() => expect(paneTabs()).toHaveLength(1));
    act(() => useLayout.getState().setPanel({ collapsed }));
    const composer = screen.getByRole('textbox', { name: 'Composer' });
    act(() => composer.focus());

    push(fake, roster([pane('one', 'One'), pane('two', 'Two')], 'two'), 2);

    await waitFor(() => expect(tabs()).toEqual([['Plugin pane · One', false], ['Plugin pane · Two', true]]));
    expect(document.activeElement).toBe(composer);
    expect(useLayout.getState().regions.panel.collapsed).toBe(collapsed);
    expect(fake.invoked('session.ui.paneFocus')).toEqual([]);
  });

  it('an initial shown pane leaves the composer keyboard until the roster requests focus', async () => {
    connect({ 'session.ui.panes': roster([pane('one', 'One')]), 'session.ui.render': PANE_ANSWER });
    render(<><textarea aria-label="Composer" /><TestHost /></>);
    const composer = screen.getByRole('textbox', { name: 'Composer' });
    act(() => composer.focus());
    attach();
    await waitFor(() => expect(tabs()).toEqual([['Plugin pane · One', true]]));
    expect(document.activeElement).toBe(composer);
    expect(fake.invoked('session.ui.paneFocus')).toEqual([]);

    push(fake, roster([pane('one', 'One'), pane('two', 'Two')], 'two', { focusRequestedId: 'two' }), 2);
    await waitFor(() => expect(document.activeElement?.getAttribute('data-plugin-pane')).toBe('two'));
    expect(fake.invoked('session.ui.paneFocus')).toContainEqual({ appSessionId: A, id: 'two' });
  });

  it('a roster read still out when the connection goes never applies', async () => {
    connect({ 'session.ui.render': PANE_ANSWER }); // `session.ui.panes` stays unanswered until the test replies
    render(<TestHost />);
    attach();
    await waitFor(() => expect(fake.pending('session.ui.panes')).toBe(1));
    disconnect();
    await act(() => fake.reply('session.ui.panes', roster([pane('stale', 'Stale')])));
    expect(paneTabs()).toEqual([]);
    disconnect = () => {};
  });

  it('forgets the roster and closes the tabs when the session’s surface goes', async () => {
    connect({ 'session.ui.panes': roster([pane('mods-probe-pane', 'Probe pane')]), 'session.ui.render': PANE_ANSWER });
    render(<TestHost />);
    attach();
    await waitFor(() => expect(paneTabs()).toHaveLength(1));
    act(() => useSessions.getState().applyStatus({ appSessionId: A, status: status(A, { process: 'exited' }) }));
    await waitFor(() => expect(paneTabs()).toEqual([]));
    expect(fake.invoked('session.ui.close')).toEqual([]);
  });

  it.each(['exiting', 'exited'] as const)('clears a roster received during initialization when the session becomes %s', async (process) => {
    connect({ 'session.ui.render': PANE_ANSWER });
    render(<TestHost />);
    act(() => useSessions.getState().applyStatus({ appSessionId: A, status: status(A, { process: 'initializing' }) }));
    push(fake, roster([pane('early', 'Early')]));
    await waitFor(() => expect(paneTabs()).toHaveLength(1));
    // Status can advance while attach's roster read is still awaited, before ready is ever reached.
    act(() => useSessions.getState().applyStatus({ appSessionId: A, status: { ...status(A, { process: 'initializing' }), uiSurface: { clientId: 'maws-main' } } }));
    expect(usePaneRosters.getState().rosters.has(A)).toBe(true);
    expect(fake.invoked('session.ui.panes')).toEqual([]);

    act(() => useSessions.getState().applyStatus({ appSessionId: A, status: status(A, { process }) }));
    await waitFor(() => expect(paneTabs()).toEqual([]));
    expect(usePaneRosters.getState().rosters.has(A)).toBe(false);
    expect(fake.invoked('session.ui.close')).toEqual([]);
  });

  it('forgets a pre-ready roster before hydration can create its tabs, including a late batch after exit', async () => {
    resetPanelStores({ hydrated: false });
    connect({ 'session.ui.render': PANE_ANSWER });
    act(() => useSessions.getState().applyStatus({ appSessionId: A, status: status(A, { process: 'initializing' }) }));
    push(fake, roster([pane('early', 'Early')]));
    expect(usePaneRosters.getState().rosters.has(A)).toBe(true);
    act(() => useSessions.getState().applyStatus({ appSessionId: A, status: status(A, { process: 'exited' }) }));
    expect(usePaneRosters.getState().rosters.has(A)).toBe(false);
    push(fake, roster([pane('early', 'Early')]), 2);
    act(() => useLayout.setState({ hydrated: true }));
    render(<TestHost />);
    expect(usePaneRosters.getState().rosters.has(A)).toBe(false);
    expect(paneTabs()).toEqual([]);
  });

  it('Escape asks to close a closeOnEscape pane through the vetoable close path, never deleting a refused pane', async () => {
    connect({ 'session.ui.panes': roster([{ ...pane('dialog', 'Dialog'), closeOnEscape: true }]), 'session.ui.render': PANE_ANSWER });
    render(<TestHost />);
    attach();
    await waitFor(() => expect(paneTabs()).toHaveLength(1));
    const body = document.querySelector<HTMLElement>('[data-plugin-pane="dialog"]')!;
    act(() => body.focus());
    fireEvent.keyDown(body, { key: 'Escape' });
    expect(fake.invoked('session.ui.close')).toEqual([{ appSessionId: A, id: 'dialog' }]);
    await act(() => fake.reply('session.ui.close', { closed: false }));
    expect(paneTabs()).toHaveLength(1);
    fireEvent.keyDown(body, { key: 'Escape' });
    await act(() => fake.reply('session.ui.close', { closed: true }));
    expect(paneTabs()).toEqual([]);
  });

  it('Escape without closeOnEscape returns keys to the composer and leaves the pane open', async () => {
    connect({ 'session.ui.panes': roster([pane('one', 'One')]), 'session.ui.render': PANE_ANSWER });
    const focusFrame = vi.fn();
    const unregister = registerFocusTarget(A, { focusEditor: vi.fn(), focusFrame, insertText: vi.fn() });
    render(<TestHost />);
    attach();
    await waitFor(() => expect(paneTabs()).toHaveLength(1));
    const body = document.querySelector<HTMLElement>('[data-plugin-pane="one"]')!;
    fireEvent.keyDown(body, { key: 'Escape' });
    expect(focusFrame).toHaveBeenCalledOnce();
    expect(fake.invoked('session.ui.close')).toEqual([]);
    expect(paneTabs()).toHaveLength(1);
    unregister();
  });

  it('leaves Escape to a child control that already handled it or an active IME', async () => {
    connect({ 'session.ui.panes': roster([{ ...pane('dialog', 'Dialog'), closeOnEscape: true }]), 'session.ui.render': PANE_ANSWER });
    render(<TestHost />);
    attach();
    await waitFor(() => expect(paneTabs()).toHaveLength(1));
    const body = document.querySelector<HTMLElement>('[data-plugin-pane="dialog"]')!;
    const child = body.appendChild(document.createElement('input'));
    child.addEventListener('keydown', (event) => event.preventDefault());
    fireEvent.keyDown(child, { key: 'Escape' });
    fireEvent.keyDown(body, { key: 'Escape', isComposing: true });
    expect(fake.invoked('session.ui.close')).toEqual([]);
    expect(paneTabs()).toHaveLength(1);
  });

  it('holds transient toasts only while a holding pane is shown, preserves their duration, and leaves banners visible', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    connect({ 'session.ui.panes': roster([{ ...pane('dialog', 'Dialog'), holdToasts: true }, pane('other', 'Other')]), 'session.ui.render': PANE_ANSWER });
    render(<><TestHost /><ToastHost /><BannerHost /></>);
    attach();
    await waitFor(() => expect(paneTabs()).toHaveLength(2));
    act(() => {
      toast({ id: 'held', level: 'info', text: 'Waiting until the pane yields', actions: [], dismissible: true, durationMs: 1000 });
      banner({ id: 'warning', level: 'warning', text: 'Pinned warning', actions: [], dismissible: false });
    });
    expect(screen.queryByText('Waiting until the pane yields')).toBeNull();
    expect(screen.getByText('Pinned warning')).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(5000));
    expect(useNotices.getState().notices.map((notice) => notice.id)).toEqual(['held', 'warning']);
    act(() => panelHost.selectTab(paneTabs()[1]!.id));
    expect(screen.getByText('Waiting until the pane yields')).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(1200));
    expect(useNotices.getState().notices.map((notice) => notice.id)).toEqual(['warning']);
  });

  it('releases held toasts when the pane closes or loses its holdToasts flag', async () => {
    connect({ 'session.ui.panes': roster([{ ...pane('dialog', 'Dialog'), holdToasts: true }]), 'session.ui.render': PANE_ANSWER });
    render(<><TestHost /><ToastHost /></>);
    attach();
    await waitFor(() => expect(paneTabs()).toHaveLength(1));
    act(() => void toast({ id: 'held', level: 'info', text: 'A held toast', actions: [], dismissible: true }));
    expect(screen.queryByText('A held toast')).toBeNull();
    push(fake, roster([pane('dialog', 'Dialog')]), 2);
    expect(screen.getByText('A held toast')).toBeTruthy();
    push(fake, roster([{ ...pane('dialog', 'Dialog'), holdToasts: true }]), 3);
    expect(screen.queryByText('A held toast')).toBeNull();
    push(fake, roster([], null), 4);
    await waitFor(() => expect(paneTabs()).toEqual([]));
    expect(screen.getByText('A held toast')).toBeTruthy();
  });

});
