// R2: a plugin's panes as `plugin-pane` panel tabs (panes.ts, PaneTool.tsx): the roster read when a session attaches and
// followed through `plugin.panes`, tabs opened and closed with it, the pane's drawing or Desktop's placeholder, the
// engine told which pane shows and when the person closes one, and the panel's "+" listing them under "Plugin panes".
// The pane's tree is the one 2.1.287 answered in pass3/mods-surface-render-sites.
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PaneRoster } from '@shared/engine/surface';
import type { SessionEvent } from '@shared/graph/events';
import type { CommandName } from '@shared/ipc/schema';
import { status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { loadJournal } from '../../../../test/support/fixtures';
import { panelHost } from '../panel/host';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { A, panelOf, resetPanelStores, TestHost } from '../test-support/panel';
import { connectPluginPanes, resetPaneRosters } from './panes';
import { resetSurfaceRegistry } from './registry';

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
});
afterEach(() => {
  disconnect();
  cleanup();
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
});
