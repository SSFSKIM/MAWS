// P3-G (§D1.1, §D1.2, §D1.5): the floating state's transitions, row by row of the table, through the action table's
// handlers as the menu and the header run them; the card's transient closed state; the size key.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { EMPTY_TAB_SET, LAYOUT_DEFAULTS, NO_PROJECT, tabId, type LayoutMain, type LayoutRegions, type TabRef } from '@shared/ipc/schema/layout';
import { fakeClient } from '../../../../test/support/fake-client';
import { registerShellActions } from '../app/shell-actions';
import { runAction } from '../keymap/actions-runtime';
import { useComposerStore } from '../stores/composer';
import { persistLayout, useLayout } from '../stores/layout';
import { useNotices } from '../stores/notices'; // P3-F wave S (F6)
import { mainShowing } from '../test-support/panel';
import { resetShellStores } from '../test-support/shell-stores';
import { cardSession, cardSizeKey, closeCard, dockPanel, FLOAT_COPY, floatPanel, openCard, placeCard, useFloatingCard } from './floating';

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
  useFloatingCard.setState({ closed: false, column: null, columnDrag: null, pillHost: null });
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

// P3-F wave S (F6, candidate 58; the owner: "a defect, not taste"): the card draws the focused tab's session, so a float
// with none (an artifact, Settings, an empty pane in front) put the panel in main's place with no card: main at 0 px, its
// tab strip gone until Dock. Float is refused there, and a float that meets no session docks.
describe('a float with no session to draw', () => {
  const ARTIFACT: TabRef = { id: tabId({ kind: 'artifact', artifactId: 'deck-1' }), kind: 'artifact', artifactId: 'deck-1', pinned: false };
  const showing = (...tabs: TabRef[]): LayoutMain => ({ ...LAYOUT_DEFAULTS.main, sets: { [NO_PROJECT]: { ...EMPTY_TAB_SET, panes: [{ tabs, activeTabId: tabs.at(-1)!.id }] } } });
  const notices = () => useNotices.getState().notices.map((n) => n.text);
  const microtasks = () => new Promise<void>((resolve) => queueMicrotask(resolve));
  beforeEach(() => useNotices.setState({ notices: [] }));

  it.each([
    ['⌥⌘B', () => runAction('panel.float')],
    // The divider's Resizer has written its maximum by the time the drag passes it; the expand hands the drag's start
    [
      'the divider',
      () => {
        useLayout.getState().setPanel({ width: 640 });
        floatPanel({ width: 444 });
      },
    ],
  ])('with an artifact tab in front, %s leaves the panel docked at its width and says why', (_, run) => {
    useLayout.setState({ main: showing(ARTIFACT) });
    enter('docked');
    run();
    expect(state()).toBe('docked');
    expect(useLayout.getState().regions.panel.width).toBe(444);
    expect(notices()).toEqual([FLOAT_COPY.noSession]);
  });

  it('from a session tab the float is unchanged: no notice', () => {
    enter('docked');
    runAction('panel.float');
    expect(state()).toBe('floating, card open');
    expect(notices()).toEqual([]);
  });

  it('a tab with no session coming to the front of a floating panel docks it', async () => {
    const session: TabRef = { id: tabId({ kind: 'session', appSessionId: A }), kind: 'session', appSessionId: A, pinned: false };
    useLayout.setState({ main: showing(ARTIFACT, session) });
    enter('floating, card open');
    useLayout.getState().openTab({ kind: 'settings', section: null }); // ⌘, while the card is up
    await microtasks();
    expect(state()).toBe('docked');
    expect(useLayout.getState().regions.panel.width).toBe(444);
  });

  it('a float stored with an artifact tab in front comes back docked once the layout is read', async () => {
    const stored = { ...LAYOUT_DEFAULTS.regions, panel: { ...LAYOUT_DEFAULTS.regions.panel, width: 444, floating: true } };
    const values: Record<string, unknown> = { regions: stored, 'main.tabs': showing(ARTIFACT), 'panel.pinned': null };
    const { client } = fakeClient({ 'layout.list': { keys: ['regions', 'main.tabs'] }, 'layout.get': (input: unknown) => ({ value: values[(input as { key: string }).key] ?? null }) });
    useLayout.setState({ hydrated: false, main: LAYOUT_DEFAULTS.main, regions: LAYOUT_DEFAULTS.regions });
    await useLayout.getState().hydrate(client, () => true);
    await microtasks();
    expect(state()).toBe('docked');
    expect(useLayout.getState().regions.panel.width).toBe(444);
  });

  // P3-F wave S (F6 review): the dock reaches layout.json. Written inside the hydration's own notification, persistence
  // would take the docked state for its baseline and never write it, and the float would come back at a later launch.
  it('the dock of a float stored with an artifact tab in front is written to layout.json', async () => {
    const stored = { ...LAYOUT_DEFAULTS.regions, panel: { ...LAYOUT_DEFAULTS.regions.panel, width: 444, floating: true } };
    const values: Record<string, unknown> = { regions: stored, 'main.tabs': showing(ARTIFACT), 'panel.pinned': null };
    const fake = fakeClient({ 'layout.list': { keys: ['regions', 'main.tabs'] }, 'layout.get': (input: unknown) => ({ value: values[(input as { key: string }).key] ?? null }), 'layout.set': undefined });
    useLayout.setState({ hydrated: false, main: LAYOUT_DEFAULTS.main, regions: LAYOUT_DEFAULTS.regions });
    const stop = persistLayout(fake.client); // subscribed before hydration, as App.tsx does
    await useLayout.getState().hydrate(fake.client, () => true);
    await microtasks();
    stop(); // writes what is pending at once
    const written = fake.invoked('layout.set').filter((input) => (input as { key: string }).key === 'regions');
    expect(written.at(-1)).toMatchObject({ value: { panel: { floating: false, width: 444 } } });
  });

  it('a float stored with a session tab in front comes back floating', async () => {
    const stored = { ...LAYOUT_DEFAULTS.regions, panel: { ...LAYOUT_DEFAULTS.regions.panel, floating: true } };
    const values: Record<string, unknown> = { regions: stored, 'main.tabs': mainShowing(A), 'panel.pinned': null };
    const { client } = fakeClient({ 'layout.list': { keys: ['regions', 'main.tabs'] }, 'layout.get': (input: unknown) => ({ value: values[(input as { key: string }).key] ?? null }) });
    useLayout.setState({ hydrated: false, main: LAYOUT_DEFAULTS.main, regions: LAYOUT_DEFAULTS.regions });
    await useLayout.getState().hydrate(client, () => true);
    await microtasks();
    expect(state()).toBe('floating, card open');
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

  // M2 review: an abandoned column drag can neither write its width over its successor's nor clear it
  it('a column drag reaches the store only while it is the current one, and its end clears only itself', () => {
    const first = useFloatingCard.getState().startColumnDrag();
    first.width(400);
    expect(useFloatingCard.getState().columnDrag).toBe(400);
    const second = useFloatingCard.getState().startColumnDrag();
    second.width(500);
    first.width(410);
    first.end();
    expect(useFloatingCard.getState().columnDrag).toBe(500);
    second.end();
    expect(useFloatingCard.getState().columnDrag).toBeNull();
  });

  it('the pill’s host is the latest chrome’s, and releasing an earlier one leaves it', () => {
    const releaseOne = useFloatingCard.getState().hostPill();
    const releaseTwo = useFloatingCard.getState().hostPill();
    releaseOne();
    expect(useFloatingCard.getState().pillHost).not.toBeNull();
    releaseTwo();
    expect(useFloatingCard.getState().pillHost).toBeNull();
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
