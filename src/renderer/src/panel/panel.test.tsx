import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { useLayout } from '../stores/layout';
import { A, B, mainShowing, panelOf, pinIds, probeTool, ref, resetPanelStores, TestHost, type ProbeState } from '../test-support/panel';
import { panelHost, registerPanelTool } from './host';
import { SurfaceRow } from './SurfaceRow';
import type { PanelTool } from './tool';

const offs: (() => void)[] = [];
const register = (...tools: PanelTool<ProbeState, unknown>[]) => tools.forEach((t) => offs.push(registerPanelTool(t)));
const menuItems = async () => within(await screen.findByRole('menu')).getAllByRole('menuitem');
const tabs = () => screen.queryAllByRole('tab').map((t) => [t.textContent, t.getAttribute('aria-selected') === 'true']);
const surfaces = () => [...document.querySelectorAll<HTMLElement>('[data-surface]')].map((element) => element.dataset.surface);
const surfaceRow = () => screen.getByRole('toolbar', { name: 'Session surfaces' });
const icon = (name: string) => within(surfaceRow()).getByRole('button', { name });
const renderHost = () => render(<><SurfaceRow /><TestHost /></>);

beforeEach(() => {
  (window as unknown as { happyDOM: { setWindowSize(size: { width: number }): void } }).happyDOM.setWindowSize({ width: 1440 });
  resetPanelStores();
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
});

describe('surface icons and same-tool tabs', () => {
  it('reserves no panel body or tab strip at rest; summary cards belong to main, not PanelHost', () => {
    renderHost();
    expect(icon('Session cards').getAttribute('aria-pressed')).toBe('true');
    expect(tabs()).toEqual([]);
    expect(surfaces()).toEqual([]);
    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Session overview' })).toBeNull();
  });

  it('More surfaces says there are no other surfaces when none is registered', async () => {
    const user = userEvent.setup();
    renderHost();
    expect(screen.queryByRole('button', { name: 'Add a tool' })).toBeNull();
    await user.click(icon('More surfaces'));
    const [only] = await menuItems();
    expect(only.textContent).toBe('No other surfaces');
    expect(only.getAttribute('aria-disabled')).toBe('true');
  });

  it('primary tools have icons and More lists other menu tools; opening a singleton makes it an open icon, not another tab', async () => {
    const user = userEvent.setup();
    register(
      probeTool('extra', { title: 'Extra' }).tool,
      probeTool('session-info', { title: 'Session info', multiInstance: false }).tool,
      probeTool('log', { title: 'Log', menu: false, pinnable: false }).tool,
      probeTool('terminal', { title: 'Terminal' }).tool,
      probeTool('review', { title: 'Review', multiInstance: false }).tool,
    );
    renderHost();
    expect(['Terminal', 'Review'].map((title) => icon(title).getAttribute('aria-pressed'))).toEqual(['false', 'false']);
    await user.click(icon('More surfaces'));
    expect((await menuItems()).map((i) => i.textContent)).toEqual(['Extra', 'Session info']);
    await user.click(screen.getByRole('menuitem', { name: 'Session info' }));
    const [added] = panelOf(A)!.tabs;
    expect(added).toEqual({ id: expect.stringMatching(/^session-info:[0-9a-z]{8}$/), toolId: 'session-info', pinned: false });
    expect(panelOf(A)!.activeTabId).toBe(added.id);
    expect(icon('Session info').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'Session info' })).toBeTruthy();
    expect(tabs()).toEqual([]); // no single-instance strip, and no tabs between unlike tools
    await user.click(icon('More surfaces'));
    expect((await menuItems()).map((i) => i.textContent)).toEqual(['Extra']);
    await user.keyboard('{Escape}');
    await user.click(icon('Session info'));
    expect(panelOf(A)!.tabs).toEqual([added]); // hiding a surface keeps its tool instance
    expect(screen.queryByRole('tabpanel')).toBeNull();
  });

  it('with no session shown new surfaces are disabled, but an existing pin remains selectable and a sessionless pin still lands', async () => {
    const user = userEvent.setup();
    register(probeTool('terminal', { title: 'Terminal' }).tool, probeTool('session-info', { title: 'Session info', multiInstance: false }).tool);
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, panelPinned: [ref('terminal:pin00000', true)] });
    renderHost();
    expect((icon('Session cards') as HTMLButtonElement).disabled).toBe(true);
    await user.click(icon('More surfaces'));
    expect(screen.getByRole('menuitem', { name: 'Session info' }).getAttribute('aria-disabled')).toBe('true');
    await user.keyboard('{Escape}');
    await user.click(icon('Terminal'));
    expect(useLayout.getState().panelActiveNoSession).toBe('terminal:pin00000');
    expect((screen.getByRole('button', { name: 'New terminal tab' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('body:terminal:pin00000').textContent).toContain('no session · pinned');
    let id = '';
    act(() => void (id = panelHost.addTool('terminal', { appSessionId: null, pin: true })));
    expect(pinIds()).toEqual(['terminal:pin00000', id]);
    expect(tabs()).toEqual([['Terminal', false], ['Terminal', true]]);
  });

  it('on the Overview, clicking an open pinned surface clears its selection without removing the pin', async () => {
    const user = userEvent.setup();
    register(probeTool('terminal', { title: 'Terminal' }).tool);
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, panelPinned: [ref('terminal:pin00000', true)] });
    renderHost();
    await user.click(icon('Terminal'));
    expect(useLayout.getState().panelActiveNoSession).toBe('terminal:pin00000');
    await user.click(icon('Terminal'));
    expect(useLayout.getState().panelActiveNoSession).toBeNull();
    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(pinIds()).toEqual(['terminal:pin00000']);
  });

  it('a same-tool tab click selects it; closing the surface preserves every tab for reopening', async () => {
    const user = userEvent.setup();
    register(probeTool('terminal', { title: 'Terminal' }).tool);
    renderHost();
    let first = '';
    act(() => void (first = panelHost.addTool('terminal', { appSessionId: A })));
    act(() => void panelHost.addTool('terminal', { appSessionId: A }));
    const inventory = panelOf(A)!.tabs;
    await user.click(screen.getAllByRole('tab')[0]);
    expect(panelOf(A)!.activeTabId).toBe(first);
    expect(screen.getByTestId(`body:${first}`).textContent).toMatch(/focus 2$/);
    await user.click(icon('Terminal'));
    expect(panelOf(A)!.activeTabId).toBeNull();
    expect(panelOf(A)!.tabs).toEqual(inventory);
    expect(tabs()).toEqual([]);
    expect(screen.queryByRole('tabpanel')).toBeNull();
    await user.click(icon('Terminal'));
    expect(tabs()).toEqual([['Terminal', true], ['Terminal', false]]);
  });

  it('plain icon clicks stack two surfaces, a third replaces only the lower slot, and closing an icon leaves the other open', async () => {
    const user = userEvent.setup();
    const terminal = probeTool('terminal', { title: 'Terminal' });
    const review = probeTool('review', { title: 'Review', multiInstance: false });
    const files = probeTool('files', { title: 'Files' });
    register(terminal.tool, review.tool, files.tool);
    renderHost();
    await user.click(icon('Terminal'));
    await user.click(icon('Review'));
    expect(surfaces()).toEqual(['terminal', 'review']);
    const reviewId = panelOf(A)!.activeTabId;
    await user.click(icon('Files'));
    expect(surfaces()).toEqual(['terminal', 'files']);
    expect(icon('Review').getAttribute('aria-pressed')).toBe('false');
    expect(panelOf(A)!.tabs.some((tab) => tab.id === reviewId)).toBe(true);
    expect(review.probe.disposed).toEqual([]); // replacement hides; it does not close the tool’s ref
    expect(screen.getAllByRole('tablist').map((list) => list.getAttribute('aria-label'))).toEqual(['terminal tabs', 'files tabs']);
    await user.click(icon('Terminal'));
    expect(surfaces()).toEqual(['files']);
    expect(icon('Files').getAttribute('aria-pressed')).toBe('true');
    await user.click(icon('Files'));
    expect(surfaces()).toEqual([]);
    expect(panelOf(A)!.activeTabId).toBeNull();
    expect(panelOf(A)!.tabs).toHaveLength(3);
    expect(terminal.probe.beforeClose).toEqual([]);
  });

  it('the close-tab glyph asks the tool; a veto keeps the tab and a pass removes and disposes it', async () => {
    const user = userEvent.setup();
    const { tool, probe } = probeTool('t', { title: 'Tee' });
    register(tool);
    renderHost();
    let id = '';
    act(() => void (id = panelHost.addTool('t', { appSessionId: A })));
    probe.veto = () => true;
    await user.click(screen.getByRole('button', { name: 'Close Tee' }));
    expect(tabs()).toEqual([['Tee', true]]);
    expect(probe.disposed).toEqual([]);
    probe.veto = () => false;
    await user.click(screen.getByRole('button', { name: 'Close Tee' }));
    expect(tabs()).toEqual([]);
    expect(panelOf(A)!.tabs).toEqual([]);
    expect(probe.beforeClose).toEqual([id, id]);
    expect(probe.disposed).toEqual([id]);
  });

  it('the pin glyph keeps a ref across sessions and unpins into the shown one; an unpinnable tool has no glyph', async () => {
    const user = userEvent.setup();
    register(probeTool('t', { title: 'Tee' }).tool, probeTool('log', { title: 'Log', pinnable: false, menu: false }).tool);
    useLayout.setState({ panelBySession: new Map([[A, { tabs: [ref('files:aaaaaaaa')], activeTabId: null }]]) });
    renderHost();
    let id = '';
    act(() => void (id = panelHost.addTool('t', { appSessionId: A })));
    act(() => void panelHost.addTool('log', { appSessionId: A }));
    expect(screen.queryByRole('button', { name: 'Pin Log' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Pin Tee' }));
    expect(pinIds()).toEqual([id]);
    expect(useLayout.getState().effectivePanelTabs(A).map((tab) => tab.toolId)).toEqual(['t', 'files', 'log']);
    act(() => useLayout.setState({ main: mainShowing(B) }));
    expect(useLayout.getState().effectivePanelTabs(B).map((tab) => tab.id)).toEqual([id]);
    await user.click(icon('More surfaces'));
    await user.click(screen.getByRole('menuitem', { name: 'Tee' }));
    expect(tabs()).toEqual([['Tee', true]]);
    await user.click(screen.getByRole('button', { name: 'Unpin Tee' }));
    expect(pinIds()).toEqual([]);
    expect(panelOf(B)!.tabs.map((r) => r.id)).toEqual([id]);
  });

  it('the surface context menu pins a less-used icon to the toolbar independently of keeping its ref across sessions', async () => {
    const user = userEvent.setup();
    register(probeTool('subagents', { title: 'Subagents', multiInstance: false }).tool);
    renderHost();
    await user.click(icon('More surfaces'));
    await user.click(screen.getByRole('menuitem', { name: 'Subagents' }));
    const id = panelOf(A)!.activeTabId!;
    fireEvent.contextMenu(icon('Subagents'));
    await user.click(await screen.findByRole('menuitem', { name: 'Pin to toolbar' }));
    expect(useLayout.getState().panelSurfaces.pinnedTools).toEqual(['subagents']);
    expect(pinIds()).toEqual([]);
    fireEvent.contextMenu(icon('Subagents'));
    await user.click(await screen.findByRole('menuitem', { name: 'Keep open for every session' }));
    expect(pinIds()).toEqual([id]);
    await user.click(icon('Subagents'));
    expect(icon('Subagents').getAttribute('aria-pressed')).toBe('false');
    fireEvent.contextMenu(icon('Subagents'));
    await user.click(await screen.findByRole('menuitem', { name: 'Unpin from toolbar' }));
    expect(useLayout.getState().panelSurfaces.pinnedTools).toEqual([]);
    expect(within(surfaceRow()).queryByRole('button', { name: 'Subagents' })).toBeNull();
    expect(pinIds()).toEqual([id]);
  });

  it('the More surfaces keyboard submenu can show, pin, unpin and close a saved unavailable tool without deleting its ref on hide', async () => {
    const user = userEvent.setup();
    const saved = ref('files:aaaaaaaa');
    useLayout.setState({ panelBySession: new Map([[A, { tabs: [saved], activeTabId: null }]]) });
    renderHost();
    const chooseSaved = async (name: string) => {
      await user.click(icon('More surfaces'));
      const trigger = await screen.findByRole('menuitem', { name: 'files (unavailable)' });
      act(() => trigger.focus());
      await user.keyboard('{ArrowRight}');
      const action = await screen.findByRole('menuitem', { name });
      act(() => action.focus());
      await user.keyboard('{Enter}');
    };
    await chooseSaved('Show saved surface');
    expect(panelOf(A)!.activeTabId).toBe(saved.id);
    expect(screen.getByRole('tabpanel', { name: 'files' }).textContent).toBe('files is not available');
    await chooseSaved('Keep open for every session');
    expect(pinIds()).toEqual([saved.id]);
    expect(panelOf(A)!).toEqual({ tabs: [], activeTabId: saved.id });
    await user.click(screen.getByRole('button', { name: 'Close surface' }));
    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(pinIds()).toEqual([saved.id]);
    await chooseSaved('Keep with this session only');
    expect(pinIds()).toEqual([]);
    expect(panelOf(A)!.tabs).toEqual([saved]);
    await chooseSaved('Close saved tab');
    await waitFor(() => expect(panelOf(A)!.tabs).toEqual([]));
    expect(panelOf(A)!.activeTabId).toBeNull();
    await user.click(icon('More surfaces'));
    expect(screen.queryByRole('menuitem', { name: 'files (unavailable)' })).toBeNull();
  });

  it('an unavailable tool keeps its placeholder, and a registered tool’s title suffix follows its own tab', () => {
    const { tool } = probeTool('t', {
      title: 'Tee',
      render: function Suffixed({ ctx }) {
        return <button onClick={() => ctx.setTitle('zsh')}>suffix</button>;
      },
    });
    register(tool);
    useLayout.setState({ panelBySession: new Map([[A, { tabs: [ref('review:aaaaaaaa'), ref('subagents:aaaaaaaa')], activeTabId: 'review:aaaaaaaa' }]]) });
    renderHost();
    expect(screen.getByRole('tabpanel', { name: 'review' }).textContent).toBe('review is not available');
    act(() => panelHost.selectTab('subagents:aaaaaaaa'));
    expect(screen.getByRole('tabpanel', { name: 'subagents' }).textContent).toBe('subagents is not available');
    act(() => void panelHost.addTool('t', { appSessionId: A }));
    act(() => screen.getByRole('button', { name: 'suffix' }).click());
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Tee · zsh');
  });
});
