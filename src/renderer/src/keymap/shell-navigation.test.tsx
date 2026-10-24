import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { ACTIONS, ACTION_IDS, effectiveChord, type KeymapOverrides } from '@shared/keymap/actions';
import { matchesChord, parseChord } from '@shared/keymap/chord';
import { registerShellActions } from '../app/shell-actions';
import { runAction } from './actions-runtime';
import { currentSet } from '../stores/layout-model';
import { useLayout } from '../stores/layout';
import { resetShellStores } from '../test-support/shell-stores';
import { TabStrip } from '../main/TabStrip';
import { connectKeys } from './dispatcher';

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
  layout.openTab({ kind: 'session', appSessionId: 'chat-a' as AppSessionId });
  layout.openTab({ kind: 'diagnostics' });
  layout.openTab({ kind: 'session', appSessionId: 'chat-b' as AppSessionId });
  layout.activateTab('session:chat-a');
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
    expect(active()).toBe('session:chat-b');
    pressMenu({ key: ']', code: 'BracketRight', metaKey: true, altKey: true });
    expect(active()).toBe('session:chat-a');
    pressMenu({ key: '[', code: 'BracketLeft', metaKey: true, altKey: true });
    expect(active()).toBe('session:chat-b');
  });

  it('keeps session navigation separate and honors a rebound or unbound strip accelerator', () => {
    openTabs();
    expect(pressMenu({ key: ']', code: 'BracketRight', metaKey: true, shiftKey: true })).toBe('session.next');
    expect(active()).toBe('session:chat-a'); // no sidebar sessions, so session navigation has no target
    const next = { 'tab.stripNext': 'Cmd+Alt+Right' } as KeymapOverrides;
    expect(pressMenu({ key: ']', code: 'BracketRight', metaKey: true, altKey: true }, next)).toBeUndefined();
    expect(pressMenu({ key: 'ArrowRight', code: 'ArrowRight', metaKey: true, altKey: true }, next)).toBe('tab.stripNext');
    expect(active()).toBe('diagnostics');
    expect(pressMenu({ key: ']', code: 'BracketRight', metaKey: true, altKey: true }, { 'tab.stripNext': null } as KeymapOverrides)).toBeUndefined();
    act(() => runAction('tab.next'));
    expect(active()).toBe('session:chat-b'); // Ctrl+Tab's existing action still cycles
  });

  it('steps the pane owning DOM focus instead of moving a different pane', () => {
    openTabs();
    useLayout.getState().splitWithActive();
    useLayout.getState().openTab({ kind: 'settings', section: 'keyboard' });
    render(<Regions />);
    screen.getByLabelText('Pane 1 content').focus();
    // A store focus is not a substitute for the keyboard's actual owner.
    useLayout.getState().focusPane(0);
    pressMenu({ key: ']', code: 'BracketRight', metaKey: true, altKey: true });
    const set = currentSet(useLayout.getState().main);
    expect(set.focusedPane).toBe(1);
    expect(set.panes[0].activeTabId).toBe('diagnostics');
    expect(set.panes[1]?.activeTabId).toBe('session:chat-a');
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


it('visits Session cards and surface content without stopping on resize controls', () => {
  render(<>
    <section id="region-sidebar"><button>Sidebar destination</button></section>
    <section id="region-main"><div data-pane="0"><div role="tabpanel"><textarea aria-label="Conversation" /></div></div>
      <aside data-region="cards"><button>Environment card</button></aside>
    </section>
    <section id="region-panel"><button role="separator">Resize surface</button><div data-panel-content><section data-surface="terminal"><button>Close surface</button><div role="tabpanel"><input aria-label="Terminal input" /></div></section></div></section>
  </>);
  screen.getByLabelText('Conversation').focus();
  pressMenu({ key: 'F6', code: 'F6' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Environment card' }));
  pressMenu({ key: 'F6', code: 'F6' });
  expect(document.activeElement).toBe(screen.getByLabelText('Terminal input'));
  pressMenu({ key: 'F6', code: 'F6', shiftKey: true });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Environment card' }));
});
