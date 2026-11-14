import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { ACTIONS, ACTION_IDS, effectiveChord, type KeymapOverrides } from '@shared/keymap/actions';
import { matchesChord, parseChord } from '@shared/keymap/chord';
import { registerShellActions } from '../app/shell-actions';
import { runAction } from './actions-runtime';
import { currentSet } from '../stores/layout-model';
import { pageOpen, useLayout } from '../stores/layout';
import { resetShellStores } from '../test-support/shell-stores';
import { at, TEST_MACHINE } from '../../../../test/support/machine';
import { TabStrip } from '../main/TabStrip';
import { connectKeys } from './dispatcher';
import { A, probeTool, resetPanelStores, TestHost } from '../test-support/panel';
import { panelHost, registerPanelTool } from '../panel/host';

let off: () => void;
beforeEach(() => {
  resetShellStores();
  off = registerShellActions();
});
afterEach(() => {
  off();
  cleanup();
  vi.unstubAllGlobals();
});

// The region and pane DOM contracts, without mounting tools or the shell's unrelated subscriptions.
function Regions() {
  const set = useLayout((s) => currentSet(s.main));
  return <>
    <section id="region-sidebar"><button>Sidebar destination</button></section>
    <section id="region-main">
      {set.panes.map((pane, index) => <section id={`pane-${index}`} data-pane={index} key={index} onFocusCapture={() => useLayout.getState().focusPane(index as 0 | 1)}>
        <div data-pane-strip><div role="tablist" aria-label={`Tabs ${index}`}>
          {pane.tabs.map((tab) => <button role="tab" data-tab-id={tab.id} aria-selected={tab.id === pane.activeTabId} tabIndex={tab.id === pane.activeTabId ? 0 : -1} key={tab.id}>{tab.id}</button>)}
        </div></div>
        <div role="tabpanel"><textarea aria-label={`Pane ${index} content`} /></div>
      </section>)}
    </section>
    <section id="region-panel"><button>Surface overflow</button><button>Terminal surface</button></section>
  </>;
}

function openTabs() {
  const layout = useLayout.getState();
  layout.openTab({ kind: 'session', appSessionId: at('chat-a' as AppSessionId) });
  layout.openTab({ kind: 'diagnostics' });
  layout.openTab({ kind: 'session', appSessionId: at('chat-b' as AppSessionId) });
  layout.activateTab(`session:${at('chat-a')}`);
}

// Menu-sink actions receive their effective accelerator from the table, then arrive as layout.action.
function pressMenu(init: KeyboardEventInit, overrides: KeymapOverrides = {}) {
  const event = new KeyboardEvent('keydown', init);
  const id = ACTION_IDS.find((id) => {
    const chord = effectiveChord(id, overrides);
    return ACTIONS[id].sink === 'menu' && chord !== null && matchesChord(event, parseChord(chord));
  });
  if (id) act(() => runAction(id));
  return id;
}

const active = () => currentSet(useLayout.getState().main).panes[currentSet(useLayout.getState().main).focusedPane]?.activeTabId ?? null;

function ChromeRegions() {
  const set = useLayout((s) => currentSet(s.main));
  return <>
    <div>{set.panes.map((_, index) => <div key={index} data-chrome-pane={index}><TabStrip pane={index as 0 | 1} split={set.panes.length > 1} idPrefix={`chrome-${index}`} /></div>)}</div>
    <section id="region-sidebar"><button>Sidebar destination</button></section>
    <section id="region-main">{set.panes.map((_, index) => <section id={`pane-${index}`} data-pane={index} key={index}>
      <div role="tabpanel"><textarea aria-label={`Pane ${index} content`} /></div>
    </section>)}</section>
    <section id="region-panel"><button>Surface overflow</button></section>
  </>;
}

it('Focus sidebar reveals a collapsed region before placing focus, rather than forcing focus through inert', () => {
  useLayout.getState().setSidebar({ collapsed: true });
  function CollapsedSidebar() {
    const collapsed = useLayout((s) => s.regions.sidebar.collapsed);
    return <section id="region-sidebar" inert={collapsed}><button>Sidebar destination</button></section>;
  }
  render(<><CollapsedSidebar /><input aria-label="Outside" /></>);
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => frames.push(fn));
  screen.getByLabelText('Outside').focus();
  act(() => runAction('sidebar.focus'));
  expect(useLayout.getState().regions.sidebar.collapsed).toBe(false);
  act(() => frames.splice(0).forEach((fn) => fn(0)));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sidebar destination' }));
});

it('keeps portaled chrome strips in the focus ring and Ctrl+Tab reaches their own pane', () => {
  openTabs();
  render(<ChromeRegions />);
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => frames.push(fn));
  const offKeys = connectKeys();
  try {
    screen.getByRole('button', { name: 'Sidebar destination' }).focus();
    pressMenu({ key: 'F6', code: 'F6' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { selected: true }));
    const event = new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', ctrlKey: true, bubbles: true, cancelable: true });
    document.activeElement!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(active()).toBe('diagnostics');
    act(() => frames.splice(0).forEach((fn) => fn(0)));
    expect(document.activeElement).toBe(screen.getByRole('tab', { selected: true }));
    pressMenu({ key: 'F6', code: 'F6' });
    expect(document.activeElement).toBe(screen.getByLabelText('Pane 0 content'));
  } finally { offKeys(); }
});

it('uses only the shell strip as a region stop when a legacy pane contains nested tool tabs', () => {
  render(<>
    <section id="region-sidebar"><button>Sidebar destination</button></section>
    <section id="region-main"><section id="pane-0" data-pane="0">
      <div role="tabpanel"><div role="tablist"><button role="tab" aria-selected="true">Tool tab</button></div></div>
      <div data-pane-strip><div role="tablist"><button role="tab" aria-selected="true">Shell tab</button></div></div>
    </section></section>
  </>);
  screen.getByRole('button', { name: 'Sidebar destination' }).focus();
  pressMenu({ key: 'F6', code: 'F6' });
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Shell tab' }));
});

describe('strip-order navigation', () => {
  it('steps through mixed tab kinds in strip order, wraps, and returns focus to the selected tab', () => {
    openTabs();
    render(<Regions />);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => frames.push(fn));
    screen.getByLabelText('Pane 0 content').focus();
    expect(pressMenu({ key: ']', code: 'BracketRight', metaKey: true, altKey: true })).toBe('tab.stripNext');
    expect(active()).toBe('diagnostics');
    act(() => frames.splice(0).forEach((fn) => fn(0)));
    expect(document.activeElement).toBe(screen.getByRole('tab', { selected: true }));
    pressMenu({ key: ']', code: 'BracketRight', metaKey: true, altKey: true });
    expect(active()).toBe(`session:${at('chat-b')}`);
    pressMenu({ key: ']', code: 'BracketRight', metaKey: true, altKey: true });
    expect(active()).toBe(`session:${at('chat-a')}`);
    pressMenu({ key: '[', code: 'BracketLeft', metaKey: true, altKey: true });
    expect(active()).toBe(`session:${at('chat-b')}`);
  });

  it('keeps session navigation separate and honors a rebound or unbound strip accelerator', () => {
    openTabs();
    expect(pressMenu({ key: ']', code: 'BracketRight', metaKey: true, shiftKey: true })).toBe('session.next');
    expect(active()).toBe(`session:${at('chat-a')}`); // no sidebar sessions, so session navigation has no target
    const next = { 'tab.stripNext': 'Cmd+Alt+Right' } as KeymapOverrides;
    expect(pressMenu({ key: ']', code: 'BracketRight', metaKey: true, altKey: true }, next)).toBeUndefined();
    expect(pressMenu({ key: 'ArrowRight', code: 'ArrowRight', metaKey: true, altKey: true }, next)).toBe('tab.stripNext');
    expect(active()).toBe('diagnostics');
    expect(pressMenu({ key: ']', code: 'BracketRight', metaKey: true, altKey: true }, { 'tab.stripNext': null } as KeymapOverrides)).toBeUndefined();
    act(() => runAction('tab.next'));
    expect(active()).toBe(`session:${at('chat-b')}`); // Ctrl+Tab's existing action still cycles
  });

  it('steps the pane owning DOM focus instead of moving a different pane', () => {
    openTabs();
    useLayout.getState().splitWithActive();
    useLayout.getState().openTab({ kind: 'file', path: '/invented/notes.md', line: null, appSessionId: null, machine: TEST_MACHINE }); // a tab of no session
    render(<Regions />);
    screen.getByLabelText('Pane 1 content').focus();
    // A store focus is not a substitute for the keyboard's actual owner.
    useLayout.getState().focusPane(0);
    pressMenu({ key: ']', code: 'BracketRight', metaKey: true, altKey: true });
    const set = currentSet(useLayout.getState().main);
    expect(set.focusedPane).toBe(1);
    expect(set.panes[0].activeTabId).toBe('diagnostics');
    expect(set.panes[1]?.activeTabId).toBe(`session:${at('chat-a')}`);
  });
});

describe('visible region focus', () => {
  beforeEach(() => { openTabs(); render(<Regions />); });

  it('walks sidebar, main tab strip, main content and panel, wrapping both ways', () => {
    screen.getByRole('button', { name: 'Sidebar destination' }).focus();
    expect(pressMenu({ key: 'F6', code: 'F6' })).toBe('region.focusNext');
    expect(document.activeElement).toBe(screen.getByRole('tab', { selected: true }));
    pressMenu({ key: 'F6', code: 'F6' });
    expect(document.activeElement).toBe(screen.getByLabelText('Pane 0 content'));
    pressMenu({ key: 'F6', code: 'F6' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Surface overflow' }));
    pressMenu({ key: 'F6', code: 'F6' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sidebar destination' }));
    pressMenu({ key: 'F6', code: 'F6', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Surface overflow' }));
  });

  it.each(['inert', 'hidden', 'aria-hidden', 'display', 'visibility'])('excludes mounted regions hidden by %s', (hidden) => {
    const sidebar = document.getElementById('region-sidebar')!;
    const main = document.getElementById('region-main')!;
    if (hidden === 'display') sidebar.style.display = main.style.display = 'none';
    else if (hidden === 'visibility') sidebar.style.visibility = main.style.visibility = 'hidden';
    else { sidebar.setAttribute(hidden, hidden === 'aria-hidden' ? 'true' : ''); main.setAttribute(hidden, hidden === 'aria-hidden' ? 'true' : ''); }
    screen.getByRole('button', { name: 'Terminal surface', hidden: true }).focus();
    pressMenu({ key: 'F6', code: 'F6' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Surface overflow' }));
    pressMenu({ key: 'F6', code: 'F6', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Surface overflow' }));
  });

  it('skips hidden controls inside an otherwise visible region', () => {
    const overflow = screen.getByRole('button', { name: 'Surface overflow' });
    overflow.setAttribute('inert', '');
    screen.getByLabelText('Pane 0 content').focus();
    pressMenu({ key: 'F6', code: 'F6' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Terminal surface' }));
  });

  it('does not move focus out of a modal dialog', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.dataset.state = 'open';
    dialog.innerHTML = '<input aria-label="Modal input" />';
    document.body.append(dialog);
    const input = dialog.querySelector('input')!;
    input.focus();
    pressMenu({ key: 'F6', code: 'F6' });
    expect(document.activeElement).toBe(input);
    dialog.remove();
  });

  it('exposes a bindable Focus sidebar action without bypassing inert state', () => {
    screen.getByLabelText('Pane 0 content').focus();
    const map = { 'sidebar.focus': 'Cmd+Alt+S' } as KeymapOverrides;
    expect(pressMenu({ key: 's', code: 'KeyS', metaKey: true, altKey: true }, map)).toBe('sidebar.focus');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sidebar destination' }));
    document.getElementById('region-sidebar')!.setAttribute('inert', '');
    screen.getByLabelText('Pane 0 content').focus();
    pressMenu({ key: 's', code: 'KeyS', metaKey: true, altKey: true }, map);
    expect(document.activeElement).toBe(screen.getByLabelText('Pane 0 content'));
  });
});


// UX wave U7b (M5, decision 8): an open page is a stop of F6 after the sidebar; what it covers is inert and invisible, as
// the shell leaves it (a wrapper around the main area's panes, the side column's region), so F6 passes over it.
describe('F6 with a page open', () => {
  function WithPage() {
    const page = useLayout(pageOpen);
    const set = useLayout((s) => currentSet(s.main));
    return <>
      <section id="region-sidebar"><button>Sidebar destination</button></section>
      <section id="region-main">
        <div data-behind-page inert={page} className={page ? 'invisible' : ''}>
          {set.panes.map((pane, index) => <section id={`pane-${index}`} data-pane={index} key={index}>
            <div data-pane-strip><div role="tablist" aria-label={`Tabs ${index}`}>
              {pane.tabs.map((tab) => <button role="tab" aria-selected={tab.id === pane.activeTabId} tabIndex={tab.id === pane.activeTabId ? 0 : -1} key={tab.id}>{tab.id}</button>)}
            </div></div>
            <div role="tabpanel"><textarea aria-label={`Pane ${index} content`} /></div>
          </section>)}
        </div>
      </section>
      {page && <section id="region-page" tabIndex={-1}><button>Page control</button></section>}
      <section id="region-panel" inert={page}><button>Surface overflow</button></section>
    </>;
  }
  beforeEach(() => {
    openTabs();
    render(<WithPage />);
    act(() => useLayout.getState().openDestination({ kind: 'library' }));
  });

  it('from the sidebar lands on the page, and the next F6 on the sidebar, never in a pane or the side column', () => {
    screen.getByRole('button', { name: 'Sidebar destination' }).focus();
    pressMenu({ key: 'F6', code: 'F6' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Page control' }));
    pressMenu({ key: 'F6', code: 'F6' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sidebar destination' }));
    pressMenu({ key: 'F6', code: 'F6', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Page control' }));
  });

  it('after Back the stops are the sidebar, the strip, the pane and the side column again', () => {
    act(() => useLayout.getState().closeDestination());
    screen.getByRole('button', { name: 'Sidebar destination' }).focus();
    pressMenu({ key: 'F6', code: 'F6' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { selected: true }));
  });
});

// UX wave U8b (M2, decision 7): each group of the side column is its strip (its selected tab) and then its content.
it('visits Session cards, each group’s strip and its content, without stopping on resize controls', () => {
  const group = (name: string, tool: string, field: string) => (
    <section data-side-group={name}>
      <div><div role="tablist"><button role="tab" aria-selected="false" tabIndex={-1}>Other</button><button role="tab" aria-selected="true">{tool}</button></div><button>Hide side column</button></div>
      <div data-surface={tool}><div role="tabpanel"><input aria-label={field} /></div></div>
    </section>
  );
  render(<>
    <section id="region-sidebar"><button>Sidebar destination</button></section>
    <section id="region-main"><div data-pane="0"><div role="tabpanel"><textarea aria-label="Conversation" /></div></div>
      <aside data-region="cards"><button>Environment card</button></aside>
    </section>
    <section id="region-panel"><button role="separator">Resize surface</button><div data-panel-content><div data-surface-stack>
      {group('upper', 'terminal', 'Terminal input')}
      {group('lower', 'review', 'Review input')}
    </div></div></section>
  </>);
  screen.getByLabelText('Conversation').focus();
  const visits = [...Array(6)].map(() => {
    pressMenu({ key: 'F6', code: 'F6' });
    return document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent;
  });
  expect(visits).toEqual(['Environment card', 'terminal', 'Terminal input', 'review', 'Review input', 'Sidebar destination']);
  pressMenu({ key: 'F6', code: 'F6', shiftKey: true });
  expect(document.activeElement).toBe(screen.getByLabelText('Review input'));
});


// UX wave U8b (M2, fix round 1): a strip's controls past its tabs ("+", Float, Expand, Hide) are part of the strip's
// stop, so F6 from one of them goes on to the group's content and Shift+F6 back to what precedes the strip.
describe('F6 from a control at the end of a side group\'s strip', () => {
  let offTools: (() => void)[] = [];
  beforeEach(() => {
    resetPanelStores();
    offTools = ['terminal', 'review'].map((id) => registerPanelTool(probeTool(id, { title: id === 'terminal' ? 'Terminal' : 'Review' }).tool));
  });
  afterEach(() => offTools.splice(0).forEach((off) => off()));

  const mount = (groups: 1 | 2) => {
    render(<>
      <section id="region-sidebar"><button>Sidebar destination</button></section>
      <section id="region-panel"><TestHost /></section>
    </>);
    act(() => void panelHost.addTool('terminal', { appSessionId: A }));
    if (groups === 2) {
      let review = '';
      act(() => void (review = panelHost.addTool('review', { appSessionId: A })));
      act(() => useLayout.getState().moveSurfaceTab(A, review, 'lower'));
    }
    const sections = [...document.querySelectorAll<HTMLElement>('section[data-side-group]')];
    expect(sections).toHaveLength(groups);
    return sections;
  };
  const named = (element: Element | null) => element?.closest('[role="tab"]')?.textContent ?? element?.closest('[role="tabpanel"]')?.id ?? element?.textContent;
  const control = (section: HTMLElement, name: string) => within(section).getByRole('button', { name });

  it.each(['Float conversation over surface', 'Expand surface', 'Hide side column', 'Add a tool'])('the upper group: F6 from %s goes to its content, Shift+F6 to the sidebar', (name) => {
    const [upper] = mount(1);
    control(upper, name).focus();
    pressMenu({ key: 'F6', code: 'F6' });
    expect(named(document.activeElement)).toBe('panel-host-body-upper');
    control(upper, name).focus();
    pressMenu({ key: 'F6', code: 'F6', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sidebar destination' }));
  });

  it('two groups: from the upper strip\'s Hide and the lower strip\'s "+", F6 goes on to that group\'s content and Shift+F6 back past its strip', () => {
    const [upper, lower] = mount(2);
    control(upper, 'Hide side column').focus();
    pressMenu({ key: 'F6', code: 'F6' });
    expect(named(document.activeElement)).toBe('panel-host-body-upper');
    pressMenu({ key: 'F6', code: 'F6' });
    expect(named(document.activeElement)).toBe('Review'); // the lower strip's stop is its selected tab
    control(lower, 'Add a tool').focus();
    pressMenu({ key: 'F6', code: 'F6' });
    expect(named(document.activeElement)).toBe('panel-host-body-lower');
    control(lower, 'Add a tool').focus();
    pressMenu({ key: 'F6', code: 'F6', shiftKey: true });
    expect(named(document.activeElement)).toBe('panel-host-body-upper');
  });
});
