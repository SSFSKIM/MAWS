import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { fakeClient } from '../../../../test/support/fake-client';
import { storedLayout, useLayout } from '../stores/layout';
import { A, B, mainShowing, panelOf, pinIds, probeTool, ref, resetPanelStores, TestHost, type ProbeState } from '../test-support/panel';
import { connectPanelHost, panelHost, registerPanelTool } from './host';
import { sideGroups, surfaceTabs } from './surface-model';
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

  it('primary tools have icons and More lists other menu tools; opening a singleton shows it as the strip’s one tab', async () => {
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
    expect(tabs()).toEqual([['Session info', true]]); // one strip, its one tab in view
    await user.click(icon('More surfaces'));
    expect((await menuItems()).map((i) => i.textContent)).toEqual(['Extra']);
    await user.keyboard('{Escape}');
    await user.click(icon('Session info'));
    expect(panelOf(A)!.tabs).toEqual([added]); // hiding the column keeps the tool's tab
    expect(screen.queryByRole('tabpanel')).toBeNull();
  });

  // UX wave U8b (A3, O-05): Artifacts is no card any more; More lists it as any other tool.
  it('More lists Artifacts: chosen, it is a tab in view; pinned to the toolbar, it is an icon', async () => {
    const user = userEvent.setup();
    register(probeTool('artifacts', { title: 'Artifacts', multiInstance: false, createState: (init) => ({ id: init.instanceId, init, snapshot: () => ({ view: { kind: 'list' } }) }) }).tool);
    renderHost();
    expect(within(surfaceRow()).queryByRole('button', { name: 'Artifacts' })).toBeNull();
    await user.click(icon('More surfaces'));
    expect((await menuItems()).map((i) => i.textContent)).toEqual(['Artifacts']);
    await user.click(screen.getByRole('menuitem', { name: 'Artifacts' }));
    expect(panelOf(A)!.tabs.map((tab) => tab.toolId)).toEqual(['artifacts']);
    expect(surfaces()).toEqual(['artifacts']);
    await user.click(icon('Artifacts')); // hides the column: the tool keeps its tab and leaves the icon row
    expect(within(surfaceRow()).queryByRole('button', { name: 'Artifacts' })).toBeNull();
    await user.click(icon('More surfaces'));
    const item = await screen.findByRole('menuitem', { name: 'Artifacts' });
    act(() => item.focus());
    await user.keyboard('{Shift>}{F10}{/Shift}');
    await user.click(await screen.findByRole('menuitem', { name: 'Pin to toolbar' }));
    expect(useLayout.getState().panelSurfaces.pinnedTools).toEqual(['artifacts']);
    expect(icon('Artifacts').getAttribute('aria-pressed')).toBe('false');
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
    expect((screen.getByRole('button', { name: 'Open a session to add a tool' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('body:terminal:pin00000').textContent).toContain('no session · pinned');
    let id = '';
    act(() => void (id = panelHost.addTool('terminal', { appSessionId: null, pin: true })));
    expect(pinIds()).toEqual(['terminal:pin00000', id]);
    expect(tabs()).toEqual([['Terminal', false], ['Terminal', true]]);
  });

  it('on the Overview, clicking an open pinned surface hides the column, keeping the pin and what it showed', async () => {
    const user = userEvent.setup();
    register(probeTool('terminal', { title: 'Terminal' }).tool);
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, panelPinned: [ref('terminal:pin00000', true)] });
    renderHost();
    await user.click(icon('Terminal'));
    expect(useLayout.getState().panelActiveNoSession).toBe('terminal:pin00000');
    await user.click(icon('Terminal'));
    expect(surfaceTabs(useLayout.getState(), null)).toEqual([]);
    expect(useLayout.getState().panelActiveNoSession).toBe('terminal:pin00000'); // shown again on the next click
    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(pinIds()).toEqual(['terminal:pin00000']);
  });

  it('two terminals are two tabs of the one strip; a tab click shows it, and hiding the column keeps every tab for showing again', async () => {
    const user = userEvent.setup();
    register(probeTool('terminal', { title: 'Terminal' }).tool);
    renderHost();
    let first = '';
    act(() => void (first = panelHost.addTool('terminal', { appSessionId: A })));
    act(() => void panelHost.addTool('terminal', { appSessionId: A }));
    const inventory = panelOf(A)!.tabs;
    expect(screen.getAllByRole('tablist').map((list) => list.getAttribute('aria-label'))).toEqual(['Panel tools']);
    expect(document.querySelector('[data-editor-header]')).toBeNull(); // no strip, and no row, drawn inside a header
    await user.click(screen.getAllByRole('tab')[0]);
    expect(panelOf(A)!.activeTabId).toBe(first);
    expect(screen.getByTestId(`body:${first}`).textContent).toMatch(/focus 2$/);
    await user.click(icon('Terminal'));
    expect(panelOf(A)!.tabs).toEqual(inventory);
    expect(tabs()).toEqual([]);
    expect(screen.queryByRole('tabpanel')).toBeNull();
    await user.click(icon('Terminal'));
    expect(tabs()).toEqual([['Terminal', true], ['Terminal', false]]);
  });

  it('an icon shows its tool in place of the one in view; the icon of the tool in view hides the column and closes nothing', async () => {
    const user = userEvent.setup();
    const terminal = probeTool('terminal', { title: 'Terminal' });
    const review = probeTool('review', { title: 'Review', multiInstance: false });
    const files = probeTool('files', { title: 'Files' });
    register(terminal.tool, review.tool, files.tool);
    renderHost();
    await user.click(icon('Terminal'));
    await user.click(icon('Review'));
    expect(surfaces()).toEqual(['review']);
    expect(tabs()).toEqual([['Terminal', false], ['Review', true]]);
    expect(icon('Terminal').getAttribute('aria-pressed')).toBe('false');
    const reviewId = panelOf(A)!.activeTabId;
    await user.click(icon('Files'));
    expect(surfaces()).toEqual(['files']);
    expect(panelOf(A)!.tabs.some((tab) => tab.id === reviewId)).toBe(true);
    expect(review.probe.disposed).toEqual([]); // a tab out of view keeps its tool's state
    await user.click(icon('Files'));
    expect(surfaces()).toEqual([]);
    expect(icon('Session cards').getAttribute('aria-pressed')).toBe('true'); // the cards show where the column was
    expect(panelOf(A)!.tabs).toHaveLength(3);
    expect(terminal.probe.beforeClose).toEqual([]);
    await user.click(icon('Files'));
    expect(surfaces()).toEqual(['files']); // the tab that was in view
    await user.click(icon('Review'));
    expect(surfaces()).toEqual(['review']);
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
    await user.click(screen.getByRole('button', { name: 'Hide side column' }));
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

// UX wave U8b, M2 (its execution document's "What it proves"): one strip, one tab in view, whoever opens a tool; a tab
// added without being asked for replaces nothing; the icons' rule.
describe('one strip, one tab in view', () => {
  const inView = () => surfaceTabs(useLayout.getState(), A).map((tab) => tab.id);

  it.each(['an icon', 'addTool', 'selectTab'] as const)('opening a second tool by %s shows it in place of the first, whose state stays', async (how) => {
    const user = userEvent.setup();
    const terminal = probeTool('terminal', { title: 'Terminal' });
    register(terminal.tool, probeTool('review', { title: 'Review', multiInstance: false }).tool);
    renderHost();
    let first = '';
    act(() => void (first = panelHost.addTool('terminal', { appSessionId: A })));
    const state = terminal.probe.rendered.at(-1);
    if (how === 'an icon') await user.click(icon('Review'));
    else if (how === 'addTool') act(() => void panelHost.addTool('review', { appSessionId: A }));
    else {
      let review = '';
      act(() => void (review = panelHost.addTool('review', { appSessionId: A, activate: false })));
      expect(surfaces()).toEqual(['terminal']); // joined the strip, replaced nothing
      act(() => panelHost.selectTab(review));
    }
    expect(surfaces()).toEqual(['review']);
    expect(document.querySelectorAll('[data-surface]')).toHaveLength(1);
    expect(tabs()).toEqual([['Terminal', false], ['Review', true]]);
    expect(terminal.probe.created).toHaveLength(1);
    expect(terminal.probe.disposed).toEqual([]);
    await user.click(screen.getAllByRole('tab')[0]);
    expect(terminal.probe.rendered.at(-1)).toBe(state); // the same state object, mounted again
    expect(inView()).toEqual([first]);
  });

  it('closing the tab in view asks the tool, and on a pass shows its right-hand neighbour', async () => {
    const user = userEvent.setup();
    const { tool, probe } = probeTool('t', { title: 'Tee' });
    register(tool);
    renderHost();
    const ids: string[] = [];
    act(() => void ['a', 'b', 'c'].forEach(() => ids.push(panelHost.addTool('t', { appSessionId: A }))));
    act(() => panelHost.selectTab(ids[1]));
    const closeShown = () => within(screen.getByRole('tab', { selected: true }).parentElement!).getByRole('button', { name: 'Close Tee' });
    probe.veto = () => true;
    await user.click(closeShown());
    expect(inView()).toEqual([ids[1]]);
    probe.veto = () => false;
    await user.click(closeShown());
    expect(probe.beforeClose).toEqual([ids[1], ids[1]]);
    expect(inView()).toEqual([ids[2]]);
  });

  it('a ref added without activation, or removed elsewhere, leaves what is in view, and a hidden column hidden (decision 2)', () => {
    register(probeTool('review', { title: 'Review', multiInstance: false }).tool, probeTool('t', { title: 'Tee' }).tool);
    renderHost();
    let review = '';
    act(() => void (review = panelHost.addTool('review', { appSessionId: A })));
    let other = '';
    act(() => void (other = panelHost.addTool('t', { appSessionId: A, activate: false })));
    expect(inView()).toEqual([review]);
    act(() => useLayout.getState().updatePanelTabs(A, (refs) => refs.filter((tab) => tab.id !== other)));
    expect(inView()).toEqual([review]);
    act(() => panelHost.showSummary());
    act(() => void (other = panelHost.addTool('t', { appSessionId: A, activate: false })));
    act(() => useLayout.getState().updatePanelTabs(A, (refs) => refs.filter((tab) => tab.id !== other)));
    expect(inView()).toEqual([]);
    expect(sideGroups(useLayout.getState(), A)).toMatchObject({ hidden: true, upper: { shown: { id: review } } });
  });

  it('the Terminal icon brings back the terminal that was in view, after a relaunch too; a gone one is passed over (decision 3)', async () => {
    const user = userEvent.setup();
    register(probeTool('terminal', { title: 'Terminal' }).tool, probeTool('review', { title: 'Review', multiInstance: false }).tool);
    renderHost();
    const t: string[] = [];
    act(() => void [1, 2, 3].forEach(() => t.push(panelHost.addTool('terminal', { appSessionId: A }))));
    act(() => panelHost.selectTab(t[0]));
    await user.click(icon('Terminal')); // hides
    // a relaunch: the store hydrates from what it would write, and the run's memory is empty
    const values = Object.fromEntries(storedLayout(useLayout.getState()));
    const fake = fakeClient({ 'layout.list': { keys: Object.keys(values) }, 'layout.get': ({ key }: { key: string }) => ({ value: values[key] ?? null }), 'layout.set': undefined });
    await act(() => useLayout.getState().hydrate(fake.client, () => true));
    await user.click(icon('Terminal'));
    expect(inView()).toEqual([t[0]]); // not the last in the strip

    const off = connectPanelHost(); // the run's memory of what each tool last showed
    offs.push(off);
    act(() => panelHost.selectTab(t[1]));
    await user.click(icon('Review'));
    await user.click(icon('Terminal'));
    expect(inView()).toEqual([t[1]]);
    await user.click(icon('Review'));
    await act(() => panelHost.closeTab(t[1]));
    await user.click(icon('Terminal'));
    expect(inView()).toEqual([t[2]]); // the gone one passed over: the last terminal in the strip
  });
});


// UX wave U8b, the branch review's finding 4: a tab moved by its menu remounts in the other group's strip, and the keyboard
// goes with it to its button there, the Tab stop of that strip. The probe tools consume no focus request, so where the
// keyboard lands is the strip's doing, not a tool's.
describe('the keyboard after a tab moves between groups', () => {
  const group = (name: 'upper' | 'lower') => document.querySelector<HTMLElement>(`section[data-side-group="${name}"]`);
  const tabIn = (name: 'upper' | 'lower', title: string) => within(group(name)!).getByRole('tab', { name: title });

  // The tab's menu opened from the keyboard (Shift+F10 on the focused tab) and the item chosen with Enter; then the turn
  // a closing menu takes to hand focus back has passed.
  async function moveByKeyboard(user: ReturnType<typeof userEvent.setup>, from: 'upper' | 'lower', title: string, item: 'Move below' | 'Move above') {
    act(() => tabIn(from, title).focus());
    await user.keyboard('{Shift>}{F10}{/Shift}');
    const choice = await screen.findByRole('menuitem', { name: item });
    act(() => choice.focus());
    await user.keyboard('{Enter}');
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  }

  it('Move below, Move above, and a move that empties its group each leave the keyboard on the moved tab in its new strip', async () => {
    const user = userEvent.setup();
    register(probeTool('review', { title: 'Review', multiInstance: false }).tool, probeTool('files', { title: 'Files' }).tool, probeTool('terminal', { title: 'Terminal' }).tool);
    renderHost();
    act(() => void panelHost.addTool('review', { appSessionId: A }));
    act(() => void panelHost.addTool('files', { appSessionId: A }));
    act(() => void panelHost.addTool('terminal', { appSessionId: A }));
    await moveByKeyboard(user, 'upper', 'Files', 'Move below'); // makes the lower group
    expect(document.activeElement).toBe(tabIn('lower', 'Files'));
    await moveByKeyboard(user, 'upper', 'Review', 'Move below'); // joins it
    expect(document.activeElement).toBe(tabIn('lower', 'Review'));
    await moveByKeyboard(user, 'lower', 'Files', 'Move above'); // the lower group keeps Review
    expect(document.activeElement).toBe(tabIn('upper', 'Files'));
    await moveByKeyboard(user, 'lower', 'Review', 'Move above'); // the lower group's last tab: the group closes
    expect(group('lower')).toBeNull();
    expect(document.activeElement).toBe(tabIn('upper', 'Review'));
  });

  // The wave's task review: moving the upper group's last tab below joins both groups into the upper one, so the tab
  // stays in the strip it was moved from, and the keyboard stays on it there.
  it('a move that empties the upper group leaves the keyboard on the moved tab in the one strip left', async () => {
    const user = userEvent.setup();
    register(probeTool('review', { title: 'Review', multiInstance: false }).tool, probeTool('files', { title: 'Files' }).tool, probeTool('terminal', { title: 'Terminal' }).tool);
    renderHost();
    act(() => void panelHost.addTool('review', { appSessionId: A }));
    act(() => void panelHost.addTool('files', { appSessionId: A }));
    act(() => void panelHost.addTool('terminal', { appSessionId: A }));
    await moveByKeyboard(user, 'upper', 'Files', 'Move below');
    await moveByKeyboard(user, 'upper', 'Review', 'Move below'); // the upper group keeps Terminal alone
    await moveByKeyboard(user, 'upper', 'Terminal', 'Move below');
    expect(group('lower')).toBeNull();
    expect(document.activeElement).toBe(tabIn('upper', 'Terminal'));

    // the tab is the same instance, so its menu opened again and dismissed gives the keyboard back to it as usual
    await user.keyboard('{Shift>}{F10}{/Shift}');
    act(() => screen.getByRole('menuitem', { name: 'Move below' }).focus());
    await user.keyboard('{Escape}');
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(tabIn('upper', 'Terminal'));
  });
});
