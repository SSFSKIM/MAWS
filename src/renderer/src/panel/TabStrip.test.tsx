// The side column's strip (UX wave U8b, M2; its execution document's decisions 1, 5 and 9): a tab is chosen by id and
// the strip never submits its tabs as a list; "+" offers a single-instance tool only while it has no tab, and a tab made
// from it comes into view; a strip too narrow for its tabs gives the tabs not in view up to their icons, the rightmost
// first, then cuts the tab in view down to 72 px, and only then scrolls.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_MACHINE } from '../../../../test/support/machine';
import { useLayout } from '../stores/layout';
import { useViewer, type ViewerEntry } from '../tools/code/viewer/viewer-store';
import { accessibleDescription } from '../test-support/accessible-text';
import { A, probeTool, ref, resetPanelStores, type ProbeState } from '../test-support/panel';
import type { PanelTool } from './tool';
import { installResizeObserver } from '../test-support/resize';
import { panelHost, registerPanelTool } from './host';
import { sideGroups, surfaceTabs } from './surface-model';
import { fitTabs, ICON_TAB_PX, MIN_TAB_PX, TabStrip } from './TabStrip';

const offs: (() => void)[] = [];
beforeEach(() => resetPanelStores());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  offs.splice(0).forEach((off) => off());
});

const register = (...tools: PanelTool<ProbeState, unknown>[]) => tools.forEach((tool) => offs.push(registerPanelTool(tool)));
// A strip over one group's tabs, as the column draws it from the store.
function Strip({ group = 'upper' }: { group?: 'upper' | 'lower' }) {
  const groups = sideGroups(useLayout(), A);
  const shown = group === 'upper' ? groups.upper : groups.lower;
  return shown && <TabStrip appSessionId={A} group={group} tabs={shown.tabs} activeTabId={shown.shown?.id ?? null} bodyId={`body-${group}`} />;
}
const tabNames = (root: HTMLElement = document.body) => within(root).queryAllByRole('tab').map((tab) => [tab.getAttribute('aria-label') ?? tab.textContent, tab.getAttribute('aria-selected') === 'true']);

describe('choosing and adding', () => {
  it('a tab chosen in either group’s strip comes into view there and leaves every ref, pin and instance in place (decision 1)', async () => {
    const user = userEvent.setup();
    register(probeTool('review', { multiInstance: false }).tool, probeTool('files').tool, probeTool('terminal').tool);
    const review = ref('review:aaaa0001');
    const files = ref('files:aaaa0002');
    const terminal = ref('terminal:aaaa0003');
    const pin = ref('terminal:pin00000', true);
    useLayout.setState({
      panelPinned: [pin],
      panelBySession: new Map([[A, { tabs: [review, files, terminal], activeTabId: review.id }]]),
      panelSurfaces: { version: 2, stacks: { [A]: [review.id, files.id] }, pinnedTools: [], contexts: {} },
      panelGroups: { version: 1, lower: { [A]: { tabs: [files.id, pin.id, terminal.id], share: 0.5 } } },
    });
    const refs = () => useLayout.getState().effectivePanelTabs(A);
    const before = refs();
    render(<><section data-testid="upper"><Strip /></section><section data-testid="lower"><Strip group="lower" /></section></>);
    expect(tabNames(screen.getByTestId('upper'))).toEqual([['review', true]]);
    expect(tabNames(screen.getByTestId('lower'))).toEqual([['terminal', false], ['files', true], ['terminal', false]]);
    await user.click(within(screen.getByTestId('lower')).getAllByRole('tab')[0]); // the pin, below
    expect(surfaceTabs(useLayout.getState(), A).map((tab) => tab.id)).toEqual([review.id, pin.id]);
    await user.click(within(screen.getByTestId('lower')).getAllByRole('tab')[2]);
    expect(surfaceTabs(useLayout.getState(), A).map((tab) => tab.id)).toEqual([review.id, terminal.id]);
    await user.click(within(screen.getByTestId('upper')).getAllByRole('tab')[0]);
    expect(refs()).toEqual(before);
    expect(useLayout.getState().panelPinned).toEqual([pin]);
  });

  it('“+” offers a single-instance tool only while it has no tab, never a menu-hidden one, and its tab comes into view (decision 9)', async () => {
    const user = userEvent.setup();
    register(probeTool('review', { title: 'Review', multiInstance: false }).tool, probeTool('terminal', { title: 'Terminal' }).tool, probeTool('log', { menu: false }).tool);
    let first = '';
    act(() => void (first = panelHost.addTool('terminal', { appSessionId: A })));
    render(<Strip />);
    const offered = async () => {
      await user.click(screen.getByRole('button', { name: 'Add a tool' }));
      return within(await screen.findByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent);
    };
    expect(await offered()).toEqual(['Review', 'Terminal']);
    await user.click(screen.getByRole('menuitem', { name: 'Review' }));
    const review = useLayout.getState().effectivePanelTabs(A).find((tab) => tab.toolId === 'review')!;
    expect(surfaceTabs(useLayout.getState(), A)).toEqual([review]);
    expect(tabNames()).toEqual([['Terminal', false], ['Review', true]]);
    expect(await offered()).toEqual(['Terminal']);
    await user.click(screen.getByRole('menuitem', { name: 'Terminal' }));
    expect(useLayout.getState().effectivePanelTabs(A).map((tab) => tab.toolId)).toEqual(['terminal', 'review', 'terminal']);
    expect(surfaceTabs(useLayout.getState(), A).map((tab) => tab.toolId)).toEqual(['terminal']);
    expect(surfaceTabs(useLayout.getState(), A).map((tab) => tab.id)).not.toContain(first);
  });
});

// The WAI-ARIA tabs pattern with manual activation (U6's strip, as M2 rewrote it; fix round 1): the arrows move focus
// along the tabs and wrap without choosing one, only the tab in view is a Tab stop and names the body it controls, and
// Enter or Space chooses the focused tab through the host.
describe('the keyboard', () => {
  const seed = () => {
    register(probeTool('review', { multiInstance: false }).tool, probeTool('files').tool, probeTool('terminal').tool);
    const tabs = [ref('review:aaaa0001'), ref('files:aaaa0002'), ref('terminal:aaaa0003')];
    useLayout.setState({
      panelBySession: new Map([[A, { tabs, activeTabId: tabs[1].id }]]),
      panelSurfaces: { version: 2, stacks: { [A]: [tabs[1].id] }, pinnedTools: [], contexts: {} },
    });
    render(<Strip />);
    return tabs;
  };
  const inView = () => surfaceTabs(useLayout.getState(), A).map((tab) => tab.id);

  it('ArrowRight and ArrowLeft move focus along the tabs, wrapping at both ends, and choose none', async () => {
    const user = userEvent.setup();
    const [, files] = seed();
    const tabs = screen.getAllByRole('tab');
    act(() => tabs[1].focus());
    const walk = async (key: string) => { await user.keyboard(key); return tabs.indexOf(document.activeElement as HTMLElement); };
    expect([await walk('{ArrowRight}'), await walk('{ArrowRight}'), await walk('{ArrowRight}')]).toEqual([2, 0, 1]);
    expect([await walk('{ArrowLeft}'), await walk('{ArrowLeft}'), await walk('{ArrowLeft}')]).toEqual([0, 2, 1]);
    await walk('{ArrowLeft}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'review' }));
    expect(inView()).toEqual([files.id]);
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('files');
  });

  it('only the tab in view is a Tab stop and has aria-controls', () => {
    seed();
    expect(screen.getAllByRole('tab').map((tab) => [tab.textContent, tab.tabIndex, tab.getAttribute('aria-controls')])).toEqual([
      ['review', -1, null],
      ['files', 0, 'body-upper'],
      ['terminal', -1, null],
    ]);
  });

  it.each(['{Enter}', ' '])('%s on a focused tab chooses it through panelHost.selectTab', async (key) => {
    const user = userEvent.setup();
    const [, , terminal] = seed();
    const select = vi.spyOn(panelHost, 'selectTab');
    act(() => screen.getByRole('tab', { name: 'files' }).focus());
    await user.keyboard('{ArrowRight}');
    expect(select).not.toHaveBeenCalled();
    await user.keyboard(key);
    expect(select).toHaveBeenCalledExactlyOnceWith(terminal.id);
    expect(inView()).toEqual([terminal.id]);
    expect(screen.getByRole('tab', { name: 'terminal' }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('a strip too narrow for its tabs (decision 5)', () => {
  // Six whole tabs of 100 px and five gaps of 2 px take 610 px.
  const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, whole: 100 }));
  it('is whole while it fits', () => {
    expect(fitTabs(610, six, 'b')).toEqual({ icons: new Set(), shownMax: null });
  });
  it('gives the tabs not in view up to their icons, the rightmost first, the tab in view whole', () => {
    expect(fitTabs(600, six, 'b')).toEqual({ icons: new Set(['f']), shownMax: null });
    expect(fitTabs(600, six, 'f')).toEqual({ icons: new Set(['e']), shownMax: null });
    const fiveIconsAndOneWhole = 5 * ICON_TAB_PX + 100 + 5 * 2; // 250
    expect(fitTabs(fiveIconsAndOneWhole, six, 'b')).toEqual({ icons: new Set(['a', 'c', 'd', 'e', 'f']), shownMax: null });
  });
  it('then cuts the tab in view to what is left, down to 72 px, and no further', () => {
    expect(fitTabs(230, six, 'b')).toEqual({ icons: new Set(['a', 'c', 'd', 'e', 'f']), shownMax: 80 });
    expect(fitTabs(150, six, 'b')).toEqual({ icons: new Set(['a', 'c', 'd', 'e', 'f']), shownMax: MIN_TAB_PX });
  });

  // The strip in the DOM: the tablist's room and each tab's width as the layout would give them.
  function laidOut(width: number) {
    let room = width;
    const { resize } = installResizeObserver();
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'tablist' ? room : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.tabId === undefined) return 0;
      if (this.dataset.tabShape === 'icon') return ICON_TAB_PX;
      return this.style.maxWidth ? parseFloat(this.style.maxWidth) : 100;
    });
    return (next: number) => {
      room = next;
      resize(screen.getByRole('tablist'), { width: next, height: 28 });
    };
  }
  const shapes = () => [...document.querySelectorAll<HTMLElement>('[data-tab-id]')].map((tab) => [tab.dataset.tabShape, tab.style.maxWidth || null]);
  const whole = ['whole', null];
  const icon = ['icon', null];

  it('draws each shape in turn as the room narrows, every tab inside the edge until the tab in view is at 72 px', () => {
    register(probeTool('t', { title: 'Tee' }).tool);
    const ids = ['t:aaaa0001', 't:aaaa0002', 't:aaaa0003', 't:aaaa0004', 't:aaaa0005', 't:aaaa0006'];
    useLayout.setState({
      panelBySession: new Map([[A, { tabs: ids.map((id) => ref(id)), activeTabId: ids[1] }]]),
      panelSurfaces: { version: 2, stacks: { [A]: [ids[1]] }, pinnedTools: [], contexts: {} },
    });
    const narrowTo = laidOut(610);
    render(<Strip />);
    expect(shapes()).toEqual([whole, whole, whole, whole, whole, whole]);
    narrowTo(600); // all but one title fit
    expect(shapes()).toEqual([whole, whole, whole, whole, whole, icon]);
    const last = within(screen.getByRole('tablist')).getAllByRole('tab')[5];
    expect([last.getAttribute('aria-label'), last.hasAttribute('title')]).toEqual(['Tee', false]); // its name, and no system tooltip
    act(() => last.focus());
    expect(screen.getByRole('tooltip').textContent, 'its name its tooltip, which focus opens').toBe('Tee');
    act(() => last.blur());
    narrowTo(250); // the tab in view whole beside five icons
    expect(shapes()).toEqual([icon, whole, icon, icon, icon, icon]);
    narrowTo(230); // five icons and 72 px still fit: the tab in view is cut to what is left
    expect(shapes()).toEqual([icon, ['cut', '80px'], icon, icon, icon, icon]);
    narrowTo(150); // narrower: 72 px, and the row scrolls
    expect(shapes()).toEqual([icon, ['cut', '72px'], icon, icon, icon, icon]);
    narrowTo(610);
    expect(shapes()).toEqual([whole, whole, whole, whole, whole, whole]);
  });

  // The branch review's finding 5: a tab folding to its icon takes its Unpin and Close glyphs away; the keyboard on one of
  // them goes to the tab's own button, and a glyph of a tab that does not fold keeps it.
  it.each([
    ['Unpin', 0, 250],
    ['Close', 5, 600],
  ] as const)('a tab folding to its icon while its %s glyph holds the keyboard hands it to the tab', (glyph, at, room) => {
    register(probeTool('t', { title: 'Tee' }).tool);
    const ids = ['t:aaaa0001', 't:aaaa0002', 't:aaaa0003', 't:aaaa0004', 't:aaaa0005', 't:aaaa0006'];
    useLayout.setState({
      panelPinned: [ref(ids[0], true)],
      panelBySession: new Map([[A, { tabs: ids.slice(1).map((id) => ref(id)), activeTabId: ids[1] }]]),
      panelSurfaces: { version: 2, stacks: { [A]: [ids[1]] }, pinnedTools: [], contexts: {} },
    });
    const narrowTo = laidOut(610);
    render(<Strip />);
    const tabOf = (id: string) => document.querySelector<HTMLElement>(`[data-tab-id="${id}"]`)!;
    const shownClose = within(tabOf(ids[1])).getByRole('button', { name: 'Close Tee' });
    act(() => within(tabOf(ids[at])).getByRole('button', { name: `${glyph} Tee` }).focus());
    narrowTo(room);
    expect(tabOf(ids[at]).dataset.tabShape).toBe('icon');
    expect(document.activeElement).toBe(within(tabOf(ids[at])).getByRole('tab'));
    act(() => shownClose.focus()); // the tab in view never folds: its glyph keeps the keyboard
    narrowTo(150);
    expect(document.activeElement).toBe(shownClose);
  });
});

// The word cut (P11): a tab's glyphs show their verb alone as a tooltip the keyboard reaches, and keep the tab's title in
// their names, which the tooltip does not repeat as a description.
describe('the tab glyphs', () => {
  it('reads Pin, Unpin and Close as tooltips on focus, the tab’s title in their names, and no system tooltip', () => {
    register(probeTool('t', { title: 'Tee' }).tool);
    useLayout.setState({
      panelPinned: [ref('t:aaaa0001', true)],
      panelBySession: new Map([[A, { tabs: [ref('t:aaaa0002')], activeTabId: 't:aaaa0002' }]]),
      panelSurfaces: { version: 2, stacks: { [A]: ['t:aaaa0002'] }, pinnedTools: [], contexts: {} },
    });
    render(<Strip />);
    const tooltip = () => screen.queryByRole('tooltip')?.textContent ?? null;
    for (const [name, tip] of [['Unpin Tee', 'Unpin'], ['Pin Tee', 'Pin']] as const) {
      const glyph = screen.getByRole('button', { name });
      expect(glyph.hasAttribute('title')).toBe(false);
      act(() => glyph.focus());
      expect(tooltip()).toBe(tip);
      expect(glyph.getAttribute('aria-describedby')).toBeNull();
    }
    const close = screen.getAllByRole('button', { name: 'Close Tee' })[0]!;
    act(() => close.focus());
    expect(tooltip()).toBe('Close');
  });
});

// UX wave U6b-1 (M2): a file's side tab carries the unsaved mark a main file tab carries, read from the viewer's entry
// under the file's key.
describe('a file’s unsaved mark', () => {
  afterEach(() => useViewer.getState().reset());

  it('shows the dot and data-dirty on a side tab whose file has unsaved edits, and on no other tab', () => {
    register(probeTool('files').tool, probeTool('review', { multiInstance: false }).tool);
    const app = ref('files:aaaa0001');
    const lib = ref('files:aaaa0002');
    const review = ref('review:aaaa0003');
    useLayout.setState({
      panelBySession: new Map([[A, { tabs: [app, lib, review], activeTabId: app.id }]]),
      panelParams: { [app.id]: { file: '/r/app.ts', line: null }, [lib.id]: { file: '/r/lib.ts', line: null, preview: true } },
      panelSurfaces: { version: 2, stacks: { [A]: [app.id] }, pinnedTools: [], contexts: {} },
    });
    const entries = (dirty: boolean) => new Map([
      [`file:${TEST_MACHINE}:/r/app.ts`, { dirty } as ViewerEntry],
      [`file:${TEST_MACHINE}:/r/lib.ts`, { dirty: false } as ViewerEntry],
    ]);
    useViewer.setState({ entries: entries(true) });
    render(<Strip />);
    const tabOf = (id: string) => document.querySelector(`[data-tab-id="${id}"]`) as HTMLElement;
    expect(tabOf(app.id).getAttribute('data-dirty')).toBe('true');
    expect(within(tabOf(app.id)).getByRole('img', { name: 'Unsaved changes' }).textContent).toBe('•');
    for (const other of [lib.id, review.id]) {
      expect(tabOf(other).hasAttribute('data-dirty')).toBe(false);
      expect(within(tabOf(other)).queryByRole('img', { name: 'Unsaved changes' })).toBeNull();
    }
    act(() => useViewer.setState({ entries: entries(false) })); // saved
    expect(tabOf(app.id).hasAttribute('data-dirty')).toBe(false);
    expect(within(tabOf(app.id)).queryByRole('img', { name: 'Unsaved changes' })).toBeNull();
  });
});

// UX wave U6b-1 (M4; U8b's §C.3, "What U6b's reveal must cover"): the selected tab of a strip that scrolls is brought into
// view, the nearest way, whether the host selected it, a click did, or an opener added it; the strip itself scrolls, and
// nothing else (`keymap/shell-navigation.test.tsx` holds the F6 stop).
describe('the selected tab kept in view', () => {
  // Tabs of 100 px in a row 150 px wide that scrolls: tab i spans i × 100 − scroll to i × 100 + 100 − scroll.
  function scrolling(room = 150) {
    let scroll = 0;
    const rect = (left: number, width: number) => ({ left, right: left + width, width, top: 0, bottom: 28, height: 28, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('role') === 'tablist') return rect(0, room);
      if (this.dataset.tabId === undefined) return rect(0, 0);
      return rect([...this.parentElement!.children].indexOf(this) * 100 - scroll, 100);
    });
    return {
      install: () => Object.defineProperty(screen.getByRole('tablist'), 'scrollLeft', { configurable: true, get: () => scroll, set: (value: number) => void (scroll = value) }),
      get scroll() {
        return scroll;
      },
      set scroll(value: number) {
        scroll = value;
      },
    };
  }
  const ids = ['t:aaaa0001', 't:aaaa0002', 't:aaaa0003', 't:aaaa0004', 't:aaaa0005', 't:aaaa0006'];
  const seed = () => {
    register(probeTool('t', { title: 'Tee' }).tool);
    useLayout.setState({
      panelBySession: new Map([[A, { tabs: ids.map((id) => ref(id)), activeTabId: ids[0] }]]),
      panelSurfaces: { version: 2, stacks: { [A]: [ids[0]] }, pinnedTools: [], contexts: {} },
    });
  };

  it('a tab the host selects is scrolled into view, rightwards and leftwards, the nearest way', () => {
    seed();
    const strip = scrolling();
    render(<Strip />);
    strip.install();
    expect(strip.scroll).toBe(0);
    act(() => panelHost.selectTab(ids[5]));
    expect(strip.scroll).toBe(450); // its right edge at the strip's
    act(() => panelHost.selectTab(ids[1]));
    expect(strip.scroll).toBe(100); // its left edge at the strip's
    act(() => panelHost.selectTab(ids[2]));
    expect(strip.scroll).toBe(150);
    act(() => panelHost.selectTab(ids[2]));
    expect(strip.scroll).toBe(150); // in view already: nothing moves
  });

  it('a tab chosen by a click is scrolled into view', async () => {
    const user = userEvent.setup();
    seed();
    const strip = scrolling();
    render(<Strip />);
    strip.install();
    await user.click(within(screen.getByRole('tablist')).getAllByRole('tab')[1]); // cut by the strip's right edge
    expect(surfaceTabs(useLayout.getState(), A).map((tab) => tab.id)).toEqual([ids[1]]);
    expect(strip.scroll).toBe(50);
  });

  it('a tab an opener adds is in view as it is drawn', () => {
    seed();
    const strip = scrolling();
    render(<Strip />);
    strip.install();
    act(() => void panelHost.addTool('t', { appSessionId: A }));
    expect(strip.scroll).toBe(550); // the seventh tab
  });
});

// UX wave U6e (decision 11; Decision Log 14 (b)): a side tab that holds a file has the file's full path as its tooltip,
// drawn whole or as its icon alone; a tab of another tool keeps today's (its name, as an icon only).
describe('a file’s tooltip (U6e)', () => {
  it('is the full path on a Files tab that holds a file, whole and as its icon; another tab keeps today’s', () => {
    register(probeTool('files').tool, probeTool('t', { title: 'Tee' }).tool);
    const app = ref('files:aaaa0001');
    const ids = ['t:aaaa0002', 't:aaaa0003', 't:aaaa0004', 't:aaaa0005', 't:aaaa0006'];
    useLayout.setState({
      panelBySession: new Map([[A, { tabs: [...ids.map((id) => ref(id)), app], activeTabId: ids[0] }]]),
      panelParams: { [app.id]: { file: '/elsewhere/notes/plans/todo.txt', line: null } },
      panelSurfaces: { version: 2, stacks: { [A]: [ids[0]] }, pinnedTools: [], contexts: {} },
    });
    let room = 2000;
    const { resize } = installResizeObserver();
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'tablist' ? room : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.tabId === undefined) return 0;
      return this.dataset.tabShape === 'icon' ? ICON_TAB_PX : 100;
    });
    render(<Strip />);
    const button = (id: string) => within(document.querySelector<HTMLElement>(`[data-tab-id="${id}"]`)!).getByRole('tab');
    expect(document.querySelector<HTMLElement>(`[data-tab-id="${app.id}"]`)!.dataset.tabShape).toBe('whole');
    expect(accessibleDescription(button(app.id)), 'the full path its description').toBe('/elsewhere/notes/plans/todo.txt');
    expect(button(app.id).hasAttribute('title')).toBe(false);
    expect(accessibleDescription(button(ids[1]))).toBe('');
    room = 590;
    act(() => resize(screen.getByRole('tablist'), { width: room, height: 28 }));
    expect(document.querySelector<HTMLElement>(`[data-tab-id="${app.id}"]`)!.dataset.tabShape).toBe('icon');
    expect(accessibleDescription(button(app.id))).toBe('/elsewhere/notes/plans/todo.txt');
    expect(button(app.id).getAttribute('aria-label')).toBe('todo.txt');
    act(() => button(app.id).focus());
    expect(screen.getByRole('tooltip').textContent, 'the full path its tooltip, which focus opens').toBe('/elsewhere/notes/plans/todo.txt');
  });
});
