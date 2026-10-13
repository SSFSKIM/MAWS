// P3-G (§D1.1, §D1.2, §D1.5): the floating state's transitions, row by row of the table, through the action table's
// handlers as the menu and the header run them; the card's transient closed state; the size key.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS, type LayoutRegions } from '@shared/ipc/schema/layout';
import { fakeClient } from '../../../../test/support/fake-client';
import { registerShellActions } from '../app/shell-actions';
import { runAction } from '../keymap/actions-runtime';
import { useComposerStore } from '../stores/composer';
import { useLayout } from '../stores/layout';
import { mainShowing } from '../test-support/panel';
import { resetShellStores } from '../test-support/shell-stores';
import { cardSession, cardSizeKey, closeCard, dockPanel, floatPanel, openCard, placeCard, useFloatingCard } from './floating';

const A = 'app-a' as AppSessionId;
type Panel = LayoutRegions['panel'];
type Name = 'docked' | 'maximized' | 'collapsed' | 'floating, card open' | 'floating, pill';

const PANELS: Record<Name, Partial<Panel>> = {
  docked: {},
  maximized: { maximized: true },
  collapsed: { collapsed: true },
  'floating, card open': { floating: true },
  'floating, pill': { floating: true },
};

function enter(name: Name): void {
  useLayout.setState({ regions: { ...LAYOUT_DEFAULTS.regions, panel: { ...LAYOUT_DEFAULTS.regions.panel, width: 444, ...PANELS[name] } } });
  useFloatingCard.setState({ closed: name === 'floating, pill' });
}

function state(): Name {
  const { panel } = useLayout.getState().regions;
  if (panel.floating) return useFloatingCard.getState().closed ? 'floating, pill' : 'floating, card open';
  if (panel.maximized) return 'maximized';
  return panel.collapsed ? 'collapsed' : 'docked';
}

let off: () => void;
beforeEach(() => {
  resetShellStores();
  useLayout.setState({ main: mainShowing(A) });
  useFloatingCard.setState({ closed: false, column: null });
  useComposerStore.setState({ focusOnMount: new Set() });
  off = registerShellActions(fakeClient({}).client);
});
afterEach(() => off());

describe('the transition table', () => {
  const NAMES: Name[] = ['docked', 'maximized', 'collapsed', 'floating, card open', 'floating, pill'];
  const rows: [string, () => void, (Name | null)[]][] = [
    ['panel.float', () => runAction('panel.float'), ['floating, card open', 'floating, card open', 'floating, card open', 'docked', 'floating, card open']],
    ['panel.maximize', () => runAction('panel.maximize'), ['maximized', 'docked', 'maximized', 'maximized', 'maximized']],
    ['panel.toggle', () => runAction('panel.toggle'), ['collapsed', 'collapsed', 'docked', 'collapsed', 'collapsed']],
    ['the card’s Dock', dockPanel, [null, null, null, 'docked', null]],
    ['the card’s Close / the pill', () => (useFloatingCard.getState().closed ? openCard() : closeCard()), [null, null, null, 'floating, pill', 'floating, card open']],
    ['revealMain (the Overview, attention navigation)', () => useLayout.getState().revealMain(), [null, 'docked', null, 'docked', 'docked']],
  ];
  for (const [event, run, after] of rows) {
    describe(event, () => {
      NAMES.forEach((from, i) => {
        if (after[i] === null) return;
        it(`${from} → ${after[i]}`, () => {
          enter(from);
          run();
          expect(state()).toBe(after[i]);
          // Floating and docking never write the width: the column comes back as it was
          expect(useLayout.getState().regions.panel.width).toBe(444);
        });
      });
    });
  }

  it('the divider dragged past the maximum floats a docked panel with the drag’s start as its width', () => {
    enter('docked');
    floatPanel({ width: 520 });
    expect(state()).toBe('floating, card open');
    expect(useLayout.getState().regions.panel.width).toBe(520);
  });

  it('with no shown session, ⌥⌘B docks a floating panel, whether or not the card was closed', () => {
    useLayout.setState({ main: LAYOUT_DEFAULTS.main });
    enter('floating, pill');
    runAction('panel.float');
    expect(state()).toBe('docked');
  });
});

describe('the floating card’s closed state and focus', () => {
  it('resets to open whenever floating changes', () => {
    enter('floating, pill');
    useLayout.getState().setPanel({ floating: false });
    expect(useFloatingCard.getState().closed).toBe(false);
    closeCard();
    expect(useFloatingCard.getState().closed).toBe(true);
    useLayout.getState().setPanel({ floating: true });
    expect(useFloatingCard.getState().closed).toBe(false);
  });

  it('floating and docking hand the session’s next composer the keyboard; docking a file tab of it does not', () => {
    enter('docked');
    runAction('panel.float');
    expect(useComposerStore.getState().focusOnMount.has(A)).toBe(true);
    useComposerStore.setState({ focusOnMount: new Set() });
    runAction('panel.float');
    expect(useComposerStore.getState().focusOnMount.has(A)).toBe(true);
    useComposerStore.setState({ focusOnMount: new Set() });
    useLayout.setState({ main: { ...LAYOUT_DEFAULTS.main, sets: { none: { panes: [{ tabs: [{ id: 'file:/x', kind: 'file', path: '/x', line: null, appSessionId: A, pinned: false }], activeTabId: 'file:/x' }], focusedPane: 0, splitRatio: 0.5 } } } });
    floatPanel();
    useComposerStore.setState({ focusOnMount: new Set() });
    dockPanel();
    expect(useComposerStore.getState().focusOnMount.size).toBe(0);
  });

  it('the card draws the shown session while floating, and nothing otherwise', () => {
    enter('docked');
    expect(cardSession(useLayout.getState())).toBeNull();
    enter('floating, pill');
    expect(cardSession(useLayout.getState())).toBe(A);
    useLayout.setState({ main: LAYOUT_DEFAULTS.main });
    expect(cardSession(useLayout.getState())).toBeNull();
  });

  it('a column reservation is the latest element’s, and releasing an earlier one leaves it', () => {
    const one = document.createElement('div');
    const two = document.createElement('div');
    const releaseOne = useFloatingCard.getState().reserveColumn(one);
    const releaseTwo = useFloatingCard.getState().reserveColumn(two);
    releaseOne();
    expect(useFloatingCard.getState().column?.element).toBe(two);
    releaseTwo();
    expect(useFloatingCard.getState().column).toBeNull();
  });
});

// §D1.4: 420 × min(60 % of the body, 640) by default, at least 360 × 240, inside the body less 16 px on each side.
describe('the card’s size', () => {
  it('defaults to 420 wide and 60 % of the panel body high, at most 640', () => {
    expect(placeCard(undefined, { width: 1000, height: 600 })).toEqual({ w: 420, h: 360 });
    expect(placeCard(undefined, { width: 1000, height: 1400 })).toEqual({ w: 420, h: 640 });
  });

  it('keeps a stored size inside the body less its margins and never under the minimum the body allows', () => {
    expect(placeCard({ w: 900, h: 900 }, { width: 800, height: 700 })).toEqual({ w: 768, h: 668 });
    expect(placeCard({ w: 100, h: 100 }, { width: 800, height: 700 })).toEqual({ w: 360, h: 240 });
    expect(placeCard({ w: 400, h: 300 }, { width: 300, height: 200 })).toEqual({ w: 268, h: 168 }); // a body smaller than the minimum
  });
});

describe('the card’s size key', () => {
  it('is the shown session’s selected panel tab, or the summary', () => {
    expect(cardSizeKey(useLayout.getState())).toBe('summary');
    useLayout.setState({ panelBySession: new Map([[A, { tabs: [{ id: 'browser-1', toolId: 'browser', pinned: false }], activeTabId: 'browser-1' }]]) });
    expect(cardSizeKey(useLayout.getState())).toBe('browser-1');
    useLayout.setState({ panelBySession: new Map([[A, { tabs: [{ id: 'browser-1', toolId: 'browser', pinned: false }], activeTabId: null }]]) });
    expect(cardSizeKey(useLayout.getState())).toBe('summary');
  });
});
