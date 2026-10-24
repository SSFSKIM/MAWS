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
import { cardHost, cardSession, cardSizeKey, closeCard, dockPanel, dockSplit, EXPAND_COPY, FLOAT_COPY, floatPanel, floatSplit, openCard, placeCard, splitFloat, useFloatingCard } from './floating';
import type { ProjectId } from '@shared/graph/ids'; // P4-B3 M2
import { item as attention, T0 } from '../../../../test/support/builders'; // P4-B3 M2
import { useAttention } from '../stores/attention'; // P4-B3 M2
import { activeTab } from '../stores/layout-model'; // P4-B3 M2
import { recordTranscriptScroll, takeTranscriptCarry } from '../transcript/view/scroll-carry'; // P4-B3 M2

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
  // Panel floats now require a real tool surface, never the session cards alone.
  useLayout.setState({ main: mainShowing(A), panelBySession: new Map([[A, { tabs: [{ id: 'terminal-1', toolId: 'terminal', pinned: false }], activeTabId: 'terminal-1' }]]) });
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
    ['surface visibility', () => useLayout.getState().setPanel({ collapsed: !useLayout.getState().regions.panel.collapsed }), ['collapsed', 'collapsed', 'docked', 'collapsed', 'collapsed']],
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
    const values: Record<string, unknown> = { regions: stored, 'main.tabs': mainShowing(A), 'panel.pinned': null, [`panel.${A}`]: { tabs: [{ id: 'terminal-1', toolId: 'terminal', pinned: false }], activeTabId: 'terminal-1' } };
    const { client } = fakeClient({ 'layout.list': { keys: Object.keys(values) }, 'layout.get': (input: unknown) => ({ value: values[(input as { key: string }).key] ?? null }) });
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

  // LC-3 (2026-10-21): the main split's card defaults to Codex's floating chat, 560 × 640, inside the body less its
  // margins; the panel's keeps P3-G's 420 × 60 %.
  it('over the main area defaults to 560 × min(640, the body less its margins); a stored size and the minimum rule as before', () => {
    expect(placeCard(undefined, { width: 1500, height: 800 }, 'split')).toEqual({ w: 560, h: 640 });
    expect(placeCard(undefined, { width: 1000, height: 600 }, 'split')).toEqual({ w: 560, h: 568 });
    expect(placeCard(undefined, { width: 500, height: 200 }, 'split')).toEqual({ w: 468, h: 168 });
    expect(placeCard({ w: 470, h: 280 }, { width: 1500, height: 800 }, 'split')).toEqual({ w: 470, h: 280 });
    expect(placeCard(undefined, { width: 1000, height: 600 }, 'panel')).toEqual({ w: 420, h: 360 });
  });
});

describe('the card’s size key', () => {
  it('is the shown session’s selected panel tab, or the summary', () => {
    useLayout.setState({ panelBySession: new Map() });
    expect(cardSizeKey(useLayout.getState())).toBe('summary');
    useLayout.setState({ panelBySession: new Map([[A, { tabs: [{ id: 'browser-1', toolId: 'browser', pinned: false }], activeTabId: 'browser-1' }]]) });
    expect(cardSizeKey(useLayout.getState())).toBe('browser-1');
    useLayout.setState({ panelBySession: new Map([[A, { tabs: [{ id: 'browser-1', toolId: 'browser', pinned: false }], activeTabId: null }]]) });
    expect(cardSizeKey(useLayout.getState())).toBe('summary');
  });
});

// P4-B3 M2 (X37; its Decision Log 7, 8, 12, 13, 14): the split's card. S (session A) on the left beside Diagnostics on
// the right, at the ratio 0.4, the right pane focused.
describe('the split’s card', () => {
  const B = 'app-b' as AppSessionId;
  const sessionTab = (id: AppSessionId): TabRef => ({ id: tabId({ kind: 'session', appSessionId: id }), kind: 'session', appSessionId: id, pinned: false });
  const DIAGNOSTICS: TabRef = { id: 'diagnostics', kind: 'diagnostics', pinned: false };
  const SETTINGS: TabRef = { id: 'settings', kind: 'settings', section: null, pinned: false };
  const S = sessionTab(A);
  const splitOf = (left: TabRef = S, right: TabRef = DIAGNOSTICS): LayoutMain => ({
    ...LAYOUT_DEFAULTS.main,
    sets: { [NO_PROJECT]: { panes: [{ tabs: [left], activeTabId: left.id }, { tabs: [right], activeTabId: right.id }], focusedPane: 1, splitRatio: 0.4 } },
  });
  const set = () => useLayout.getState().main.sets[NO_PROJECT]!;
  const layout = () => useLayout.getState();
  const closed = () => useFloatingCard.getState().closed;
  const marked = () => [...useComposerStore.getState().focusOnMount];
  const unmark = () => useComposerStore.setState({ focusOnMount: new Set() });
  const notices = () => useNotices.getState().notices.map((n) => n.text);
  const pending = (...items: ReturnType<typeof attention>[]) => useAttention.setState({ bySession: new Map([[items[0].appSessionId, items]]) });
  beforeEach(() => {
    useLayout.setState({ main: splitOf() });
    useNotices.setState({ notices: [] });
    useAttention.setState({ bySession: new Map() });
  });

  it('cardSession and cardHost: the floating pane’s session in the split, the panel’s shown session when the panel floats, none otherwise', () => {
    expect([cardHost(layout()), cardSession(layout())]).toEqual([null, null]);
    useLayout.getState().floatSplit(S.id);
    expect([cardHost(layout()), cardSession(layout())], 'Diagnostics is focused: no matter').toEqual(['split', A]);
    useLayout.getState().setPanel({ maximized: true });
    expect([cardHost(layout()), cardSession(layout())], 'the main area is at 0 px under a maximized panel').toEqual([null, null]);
    useLayout.getState().setPanel({ maximized: false });
    useLayout.getState().setCurrentProject('elsewhere' as ProjectId);
    expect([cardHost(layout()), cardSession(layout())], 'another tab set: the float stays with its own').toEqual([null, null]);
  });

  it('a float (the divider’s release, Expand) floats S with the ratio untouched, focuses S’s pane and marks its composer', () => {
    expect(floatSplit(S.id)).toBe(true);
    expect(set()).toMatchObject({ floating: { sessionTabId: S.id }, splitRatio: 0.4, focusedPane: 0 });
    expect(marked()).toEqual([A]);
    expect(activeTab(layout().main), 'the card stands for S: the panel shows it, ⌘W closes it').toEqual(S);
  });

  it('a float asked of a tab that is no pane’s active session is refused, and marks nothing', () => {
    expect(floatSplit(DIAGNOSTICS.id)).toBe(false);
    expect(set().floating).toBeUndefined();
    expect(marked()).toEqual([]);
  });

  it('a float asked while the panel stands in main docks the panel first', () => {
    useLayout.getState().setPanel({ maximized: true });
    floatSplit(S.id);
    expect(layout().regions.panel).toMatchObject({ maximized: false, floating: false });
    expect(cardHost(layout())).toBe('split');
  });

  it('Dock returns the split at its ratio with S focused and its composer marked', () => {
    floatSplit(S.id);
    useLayout.getState().focusPane(1);
    unmark();
    dockSplit();
    expect(set().floating).toBeUndefined();
    expect(set()).toMatchObject({ splitRatio: 0.4, focusedPane: 0 });
    expect(marked()).toEqual([A]);
  });

  it('one card at a time: ⌥⌘B with the split card up docks it and nothing else; a second press floats the panel', () => {
    floatSplit(S.id);
    runAction('panel.float');
    expect(set().floating).toBeUndefined();
    expect(layout().regions.panel.floating).toBe(false);
    runAction('panel.float');
    expect(layout().regions.panel.floating).toBe(true);
    expect([cardHost(layout()), cardSession(layout())]).toEqual(['panel', A]);
  });

  it('one card at a time: the panel’s float (its divider past the maximum) docks a floating split first', () => {
    floatSplit(S.id);
    floatPanel({ width: 444 });
    expect(set().floating).toBeUndefined();
    expect(layout().regions.panel).toMatchObject({ floating: true, width: 444 });
    expect([cardHost(layout()), cardSession(layout())]).toEqual(['panel', A]);
  });

  it('Close leaves the pill and puts the focused pane on A; the pill brings the card back with S focused and its composer marked', () => {
    floatSplit(S.id);
    closeCard();
    expect(closed()).toBe(true);
    expect(set().focusedPane).toBe(1);
    unmark();
    openCard();
    expect(closed()).toBe(false);
    expect(set().focusedPane).toBe(0);
    expect(marked()).toEqual([A]);
  });

  it('the focused pane moving to S while the card is a pill (a sidebar click, ⌘⇧\\) opens the card and marks its composer', () => {
    floatSplit(S.id);
    closeCard();
    unmark();
    useLayout.getState().openSession(A); // the sidebar's row: S's tab is open, so its pane is focused
    expect(closed()).toBe(false);
    expect(marked()).toEqual([A]);
    closeCard();
    runAction('pane.focusOther');
    expect(closed()).toBe(false);
    expect(set().focusedPane).toBe(0);
  });

  it('the pill state resets whenever the split floats or docks, and on a tab set’s return', () => {
    floatSplit(S.id);
    closeCard();
    dockSplit();
    expect(closed()).toBe(false);
    floatSplit(S.id);
    closeCard();
    useLayout.getState().setCurrentProject('elsewhere' as ProjectId);
    useLayout.getState().setCurrentProject(null);
    expect(closed()).toBe(false);
    expect(cardHost(layout())).toBe('split');
  });

  // Decision Log 13 (LC-3: Codex keys its exception by the pending input's id)
  it('a new permission request or question raises the pill without the keyboard; one closed while pending stays closed until the next', () => {
    floatSplit(S.id);
    closeCard();
    unmark();
    const permission = attention(A, 'permission', T0);
    pending(attention(A, 'error', T0));
    expect(closed(), 'an error is no request').toBe(true);
    pending(permission);
    expect(closed()).toBe(false);
    expect(marked(), 'the raise never takes the keyboard').toEqual([]);
    closeCard();
    pending({ ...permission, state: 'delivered' });
    expect(closed(), 'the same request, still pending').toBe(true);
    pending(permission, attention(A, 'question', '2026-09-28T10:01:00.000Z'));
    expect(closed()).toBe(false);
  });

  it('the panel’s card is raised the same way; a request of another session raises nothing', () => {
    useLayout.setState({ main: mainShowing(A) });
    floatPanel();
    closeCard();
    pending(attention(B, 'permission', T0));
    expect(closed()).toBe(true);
    pending(attention(A, 'plan', T0));
    expect(closed()).toBe(false);
  });

  it('Expand folds the conversation to its composer; Restore split docks it; otherwise it says why', () => {
    runAction('main.expandArtifactPane'); // Diagnostics is focused, the session beside it
    expect(set()).toMatchObject({ floating: { sessionTabId: S.id }, splitRatio: 0.4, focusedPane: 0 });
    expect(closed(), 'Expand releases the full conversation column').toBe(true);
    expect(marked(), 'the compressed composer receives the keyboard').toEqual([A]);
    openCard();
    expect(closed(), 'the title reopens the full conversation without restoring the split').toBe(false);
    expect(set().floating?.sessionTabId).toBe(S.id);
    useLayout.getState().focusPane(1);
    runAction('main.expandArtifactPane'); // Restore split
    expect(set().floating).toBeUndefined();
    expect(set().focusedPane).toBe(0);
    expect(notices()).toEqual([]);
    useLayout.setState({ main: splitOf(DIAGNOSTICS, SETTINGS) });
    runAction('main.expandArtifactPane');
    expect(set().floating).toBeUndefined();
    expect(notices()).toEqual([EXPAND_COPY.noSession]);
    useNotices.setState({ notices: [] });
    useLayout.setState({ main: mainShowing(A) });
    runAction('main.expandArtifactPane');
    expect(notices()).toEqual([EXPAND_COPY.noSession]);
  });

  // P4-B3x (P4 Decision Log 40): Expand also folds the right panel, so an expanded document has the width its margin's
  // cards need; leaving Expand brings back what Expand changed and nothing the owner changed meanwhile.
  describe('Expand folds the right panel', () => {
    const panel = () => layout().regions.panel;
    const OPEN = { width: 444, collapsed: false, maximized: false, floating: false };
    const expand = () => runAction('main.expandArtifactPane'); // Diagnostics is focused, the session beside it
    beforeEach(() => useLayout.setState({ regions: { ...LAYOUT_DEFAULTS.regions, panel: OPEN } }));

    it('Expand folds an open panel with its float, the fold marked on it; Restore split opens the panel as it was', () => {
      expand();
      expect(set().floating).toEqual({ sessionTabId: S.id, foldedPanel: true });
      expect(panel()).toEqual({ ...OPEN, collapsed: true });
      expand(); // Restore split
      expect(set().floating).toBeUndefined();
      expect(panel(), 'the same panel, its width kept').toEqual(OPEN);
    });

    it('the card’s Dock and ⌥⌘B docking the split card leave Expand too, the panel opening; a second ⌥⌘B floats it', () => {
      expand();
      expect(panel().collapsed).toBe(true);
      dockSplit();
      expect(panel()).toEqual(OPEN);
      useLayout.getState().focusPane(1);
      expand();
      expect(panel().collapsed).toBe(true);
      runAction('panel.float');
      expect([set().floating, panel()]).toEqual([undefined, OPEN]);
      runAction('panel.float');
      expect(panel()).toEqual({ ...OPEN, floating: true });
    });

    it('a float the divider makes folds nothing', () => {
      floatSplit(S.id);
      expect(set().floating).toEqual({ sessionTabId: S.id });
      expect(panel()).toEqual(OPEN);
    });

    it('a fold asked with a float the model docks instead (the other pane’s session while one floats) folds nothing', () => {
      useLayout.setState({ main: splitOf(S, sessionTab(B)) });
      layout().floatSplit(S.id);
      layout().floatSplit(sessionTab(B).id, { foldPanel: true }); // its Decision Log 28: a float never changes pane
      expect(set().floating).toBeUndefined();
      expect(panel()).toEqual(OPEN);
    });

    it('over a hidden panel Expand folds nothing, and leaving it leaves the panel hidden', () => {
      useLayout.getState().setPanel({ collapsed: true });
      expand();
      expect(set().floating).toEqual({ sessionTabId: S.id });
      expand();
      expect(panel()).toEqual({ ...OPEN, collapsed: true });
    });

    it('over a maximized or floating panel Expand folds it too; leaving Expand opens it docked beside the split', () => {
      for (const patch of [{ maximized: true }, { floating: true }]) {
        useLayout.setState({ main: splitOf(), regions: { ...LAYOUT_DEFAULTS.regions, panel: { ...OPEN, ...patch } } });
        expand();
        expect([cardHost(layout()), set().floating, panel()]).toEqual(['split', { sessionTabId: S.id, foldedPanel: true }, { ...OPEN, collapsed: true }]);
        expand();
        expect(panel()).toEqual(OPEN);
      }
    });

    it('the owner reopening the panel while expanded drops the fold: Restore split leaves the panel open', () => {
      expand();
      useLayout.getState().setPanel({ collapsed: !useLayout.getState().regions.panel.collapsed });
      expect(set().floating, 'the float stands, the fold gone').toEqual({ sessionTabId: S.id });
      expect(panel()).toEqual(OPEN);
      expand();
      expect(panel()).toEqual(OPEN);
    });

    it('the owner reopening and closing the panel again while expanded: Restore split leaves it closed', () => {
      expand();
      useLayout.getState().setPanel({ collapsed: !useLayout.getState().regions.panel.collapsed });
      useLayout.getState().setPanel({ collapsed: !useLayout.getState().regions.panel.collapsed });
      expect(set().floating).toEqual({ sessionTabId: S.id });
      expand();
      expect(panel()).toEqual({ ...OPEN, collapsed: true });
    });

    it('the owner maximizing the panel while expanded: leaving Expand leaves it maximized', () => {
      expand();
      runAction('panel.maximize');
      expect(set().floating).toEqual({ sessionTabId: S.id });
      dockSplit();
      expect(panel()).toEqual({ ...OPEN, maximized: true });
    });

    it('the owner opening and floating the panel while expanded: it floats and stays floating', () => {
      expand();
      useLayout.getState().setPanel({ collapsed: !useLayout.getState().regions.panel.collapsed });
      floatPanel(); // the panel's divider past its maximum: docks the split first (one card at a time)
      expect(set().floating).toBeUndefined();
      expect(panel()).toEqual({ ...OPEN, floating: true });
    });

    it('a tool revealing the panel while expanded counts as opening it: Restore split leaves it open', () => {
      expand();
      useLayout.getState().setPanel({ collapsed: false }); // what `panel/host.ts`'s reveal and C10's attach write
      expand();
      expect(panel()).toEqual(OPEN);
    });

    it('the fold rides its float through A’s own changes and a tab set’s switch, and ends with the float', () => {
      expand();
      useLayout.getState().openTab({ kind: 'settings', section: null }, { pane: 1 });
      expect(set().floating, 'a tab opened beside the card').toEqual({ sessionTabId: S.id, foldedPanel: true });
      useLayout.getState().setCurrentProject('elsewhere' as ProjectId);
      expect(panel(), 'another set: the panel stays folded').toEqual({ ...OPEN, collapsed: true });
      useLayout.getState().setCurrentProject(null);
      expect(set().floating).toEqual({ sessionTabId: S.id, foldedPanel: true });
      expand();
      expect(panel()).toEqual(OPEN);
    });

    it('the float ending any other way opens the panel it folded: A’s last tab closing, S’s tab closing, the session removed', () => {
      const ends: [string, () => void][] = [
        ['A’s last tab closes', () => useLayout.getState().closeTab(DIAGNOSTICS.id)],
        ['S’s tab closes', () => useLayout.getState().closeTab(S.id)],
        ['S’s session is removed', () => useLayout.getState().dropSession(A)],
        ['S’s tab moves to the other pane', () => useLayout.getState().moveTab(S.id, 1, 0)],
      ];
      for (const [name, end] of ends) {
        useLayout.setState({ main: splitOf(), regions: { ...LAYOUT_DEFAULTS.regions, panel: OPEN } });
        expand();
        expect([name, panel().collapsed]).toEqual([name, true]);
        end();
        expect([name, splitFloat(layout().main), panel()]).toEqual([name, null, OPEN]);
      }
    });
  });

  it('the split card’s size key is the tab of the pane it sits over', () => {
    floatSplit(S.id);
    expect(cardSizeKey(layout())).toBe(`main:${DIAGNOSTICS.id}`);
  });

  // Decision Log 14: the card transitions (either card) mark the session's next transcript mount to carry its scroll
  it('floating and docking mark the session’s transcript to carry its scroll; an ordinary tab switch does not', () => {
    const scroll = { following: false, offset: 900, signature: '3:r3', anchor: 'r2' };
    takeTranscriptCarry(A); // a mark an earlier test's transition left (no transcript mounts here to take it)
    recordTranscriptScroll(A, scroll);
    useLayout.getState().activateTab(DIAGNOSTICS.id);
    expect(takeTranscriptCarry(A)).toBeNull();
    floatSplit(S.id);
    expect(takeTranscriptCarry(A)).toEqual(scroll);
    expect(takeTranscriptCarry(A), 'one-shot').toBeNull();
    dockSplit();
    expect(takeTranscriptCarry(A)).toEqual(scroll);
    useLayout.setState({ main: mainShowing(A) });
    floatPanel();
    expect(takeTranscriptCarry(A)).toEqual(scroll);
    dockPanel();
    expect(takeTranscriptCarry(A)).toEqual(scroll);
  });

  // M2 review (P3): a file tab of the session has no transcript of it mounted, so neither the panel's float nor its dock
  // over that tab marks a carry (the mark would wait for whatever mount of the session came next)
  it('the panel’s float and dock over a file tab of the session mark no carry', () => {
    const file: TabRef = { id: 'file:/x', kind: 'file', path: '/x', line: null, appSessionId: A, pinned: false };
    takeTranscriptCarry(A);
    recordTranscriptScroll(A, { following: false, offset: 900, signature: '3:r3', anchor: 'r2' });
    useLayout.setState({ main: { ...LAYOUT_DEFAULTS.main, sets: { [NO_PROJECT]: { panes: [{ tabs: [file], activeTabId: file.id }], focusedPane: 0, splitRatio: 0.5 } } } });
    floatPanel();
    expect(layout().regions.panel.floating).toBe(true);
    expect(takeTranscriptCarry(A)).toBeNull();
    dockPanel();
    expect(takeTranscriptCarry(A)).toBeNull();
  });
});
