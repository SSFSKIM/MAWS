import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { useLayout } from '../stores/layout';
import { A, B, mainShowing, panelOf, pinIds, probeTool, ref, resetPanelStores, TestHost, type ProbeState } from '../test-support/panel';
import { panelHost, registerPanelTool } from './host';
import type { PanelTool } from './tool';

const offs: (() => void)[] = [];
const register = (...tools: PanelTool<ProbeState, unknown>[]) => tools.forEach((t) => offs.push(registerPanelTool(t)));
const menuItems = async () => within(await screen.findByRole('menu')).getAllByRole('menuitem');
const tabs = () => screen.queryAllByRole('tab').map((t) => [t.textContent, t.getAttribute('aria-selected') === 'true']);

beforeEach(() => resetPanelStores());
afterEach(() => {
  cleanup();
  offs.splice(0);
});

describe('panel tab strip and plus menu', () => {
  it('rests on the summary with the home glyph pressed and an empty strip', () => {
    render(<TestHost />);
    expect(screen.getByRole('button', { name: 'Session overview' }).getAttribute('aria-pressed')).toBe('true');
    expect(tabs()).toEqual([]);
    expect(screen.getByRole('tabpanel').textContent).toBe('Tools stay with this session. Pin a tab to keep it with you as you switch.');
  });

  it('"+" reads "No tools registered yet" when nothing is registered', async () => {
    const user = userEvent.setup();
    render(<TestHost />);
    await user.click(screen.getByRole('button', { name: 'Add a tool' }));
    const [only] = await menuItems();
    expect(only.textContent).toBe('No tools registered yet');
    expect(only.getAttribute('aria-disabled')).toBe('true');
  });

  it('"+" lists the menu tools in the §5.6 order, then registration order, less an open single-instance tool, and opens a tab', async () => {
    const user = userEvent.setup();
    register(
      probeTool('extra', { title: 'Extra' }).tool,
      probeTool('session-info', { title: 'Session info', multiInstance: false }).tool,
      probeTool('log', { title: 'Log', menu: false, pinnable: false }).tool,
      probeTool('terminal', { title: 'Terminal' }).tool,
      probeTool('review', { title: 'Review', multiInstance: false }).tool,
    );
    render(<TestHost />);
    await user.click(screen.getByRole('button', { name: 'Add a tool' }));
    expect((await menuItems()).map((i) => i.textContent)).toEqual(['Review', 'Terminal', 'Session info', 'Extra']);
    await user.click(screen.getByRole('menuitem', { name: 'Session info' }));
    const [added] = panelOf(A)!.tabs;
    expect(added).toEqual({ id: expect.stringMatching(/^session-info:[0-9a-z]{8}$/), toolId: 'session-info', pinned: false });
    expect(panelOf(A)!.activeTabId).toBe(added.id);
    expect(tabs()).toEqual([['Session info', true]]);
    await user.click(screen.getByRole('button', { name: 'Add a tool' }));
    expect((await menuItems()).map((i) => i.textContent)).toEqual(['Review', 'Terminal', 'Extra']);
  });

  it('with no session shown "+" is disabled and says why, the pins stay selectable, and a sessionless pin still lands', async () => {
    const user = userEvent.setup();
    register(probeTool('terminal', { title: 'Terminal' }).tool);
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, panelPinned: [ref('terminal:pin00000', true)] });
    render(<TestHost />);
    const add = screen.getByRole('button', { name: 'Open a session to add a tool' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    await user.click(screen.getByRole('tab', { name: 'Terminal' }));
    expect(useLayout.getState().panelActiveNoSession).toBe('terminal:pin00000');
    expect(screen.getByTestId('body:terminal:pin00000').textContent).toContain('no session · pinned');
    let id = '';
    act(() => void (id = panelHost.addTool('terminal', { appSessionId: null, pin: true })));
    expect(pinIds()).toEqual(['terminal:pin00000', id]);
  });

  it('on the Overview, the home glyph clears the pin selection and shows the summary', async () => {
    const user = userEvent.setup();
    register(probeTool('terminal', { title: 'Terminal' }).tool);
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, panelPinned: [ref('terminal:pin00000', true)] });
    render(<TestHost />);
    await user.click(screen.getByRole('tab', { name: 'Terminal' }));
    expect(useLayout.getState().panelActiveNoSession).toBe('terminal:pin00000');
    await user.click(screen.getByRole('button', { name: 'Session overview' }));
    expect(useLayout.getState().panelActiveNoSession).toBeNull();
    expect(screen.getByRole('tabpanel').textContent).toContain('Tools stay with this session.');
    expect(pinIds()).toEqual(['terminal:pin00000']);
  });

  it('a tab click selects it and the home glyph shows the summary without closing tabs', async () => {
    const user = userEvent.setup();
    register(probeTool('t', { title: 'Tee' }).tool);
    render(<TestHost />);
    let first = '';
    act(() => void (first = panelHost.addTool('t', { appSessionId: A })));
    act(() => void panelHost.addTool('t', { appSessionId: A }));
    await user.click(screen.getAllByRole('tab')[0]);
    expect(panelOf(A)!.activeTabId).toBe(first);
    expect(screen.getByTestId(`body:${first}`).textContent).toMatch(/focus 2$/);
    await user.click(screen.getByRole('button', { name: 'Session overview' }));
    expect(panelOf(A)!.activeTabId).toBeNull();
    expect(tabs()).toEqual([
      ['Tee', false],
      ['Tee', false],
    ]);
    expect(screen.getByRole('tabpanel').textContent).toContain('Tools stay with this session.');
  });

  it('the close glyph asks the tool; a veto keeps the tab and a pass removes it', async () => {
    const user = userEvent.setup();
    const { tool, probe } = probeTool('t', { title: 'Tee' });
    register(tool);
    render(<TestHost />);
    act(() => void panelHost.addTool('t', { appSessionId: A }));
    probe.veto = () => true;
    await user.click(screen.getByRole('button', { name: 'Close Tee' }));
    expect(tabs()).toEqual([['Tee', true]]);
    probe.veto = () => false;
    await user.click(screen.getByRole('button', { name: 'Close Tee' }));
    expect(tabs()).toEqual([]);
  });

  it('the pin glyph pins into every session and unpins into the shown one; an unpinnable tool has none, a placeholder has one', async () => {
    const user = userEvent.setup();
    register(probeTool('t', { title: 'Tee' }).tool, probeTool('log', { title: 'Log', pinnable: false, menu: false }).tool);
    useLayout.setState({ panelBySession: new Map([[A, { tabs: [ref('files:aaaaaaaa')], activeTabId: null }]]) });
    render(<TestHost />);
    let id = '';
    act(() => void (id = panelHost.addTool('t', { appSessionId: A })));
    act(() => void panelHost.addTool('log', { appSessionId: A }));
    expect(screen.queryByRole('button', { name: 'Pin Log' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pin files' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Pin Tee' }));
    expect(pinIds()).toEqual([id]);
    expect(tabs().map(([title]) => title)).toEqual(['Tee', 'files', 'Log']); // pins first
    act(() => useLayout.setState({ main: mainShowing(B) }));
    expect(tabs().map(([title]) => title)).toEqual(['Tee']);
    await user.click(screen.getByRole('button', { name: 'Unpin Tee' }));
    expect(pinIds()).toEqual([]);
    expect(panelOf(B)!.tabs.map((r) => r.id)).toEqual([id]);
  });

  it('a placeholder tab reads "Arrives with <child>" and a tool’s title suffix follows its tab', () => {
    const { tool } = probeTool('t', {
      title: 'Tee',
      render: function Suffixed({ ctx }) {
        return <button onClick={() => ctx.setTitle('zsh')}>suffix</button>;
      },
    });
    register(tool);
    useLayout.setState({ panelBySession: new Map([[A, { tabs: [ref('review:aaaaaaaa'), ref('subagents:aaaaaaaa')], activeTabId: 'review:aaaaaaaa' }]]) });
    render(<TestHost />);
    expect(screen.getByRole('tabpanel').textContent).toBe('Arrives with C8c');
    act(() => panelHost.selectTab('subagents:aaaaaaaa'));
    expect(screen.getByRole('tabpanel').textContent).toBe('Arrives with C8b');
    act(() => void panelHost.addTool('t', { appSessionId: A }));
    act(() => screen.getByRole('button', { name: 'suffix' }).click());
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Tee · zsh');
  });
});
