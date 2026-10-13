import { describe, expect, it } from 'vitest';
import type { AgentId, AppSessionId, ProjectId } from '@shared/graph/ids';
import { EMPTY_TAB_SET, LAYOUT_DEFAULTS, LayoutMainSchema, NO_PROJECT, type LayoutMain, type LayoutMainV1, type TabRef, type TabSet, type TabSetKey, type TabTarget } from '@shared/ipc/schema/layout';
import {
  activateTab, activeTab, closeTab, currentSet, cycleTab, dropSession, focusPane, fromV1, moveTab, openSession, openTab, refile, reopenClosed, repairMain,
  replaceActive, retargetTab, selectTab, sessionOfTab, setSplitRatio, splitWithActive, switchSet, togglePinned, type SetOfTab,
} from './layout-model';

const S = (id: string) => ({ kind: 'session' as const, appSessionId: id as AppSessionId });
const ids = (main: LayoutMain) => currentSet(main).panes.map((p) => p.tabs.map((t) => t.id));
const active = (main: LayoutMain) => currentSet(main).panes.map((p) => p.activeTabId);
const cur = currentSet;
const base = LAYOUT_DEFAULTS.main;
// A layout whose only set is the no-project one, holding `set`.
const one = (set: TabSet): LayoutMain => ({ ...base, sets: { [NO_PROJECT]: set } });
const A_ID = 'a' as AppSessionId;
// a, b, c in pane 0 with c active (the default is one empty pane: W5's Overview is no tab).
const abc = () => [S('a'), S('b'), S('c')].reduce((m, t) => openTab(m, t), base);
const split = () => openSession(abc(), 'd' as AppSessionId, { split: true }); // pane 1: [d]

describe('layout store transitions', () => {
  it('openTab, not open: inserts after the target pane’s active tab, activates it and focuses that pane', () => {
    const m = openTab(activateTab(abc(), 'session:a'), S('x'));
    expect(ids(m)).toEqual([['session:a', 'session:x', 'session:b', 'session:c']]);
    expect(active(m)).toEqual(['session:x']);
    expect(cur(m).focusedPane).toBe(0);
    const pinned = openTab(['session:p', 'session:o'].reduce(togglePinned, openTab(openTab(base, S('p')), S('o'))), S('q')); // [p, o] pinned, q
    const afterPinned = openTab(activateTab(pinned, 'session:p'), S('r'));
    expect(ids(afterPinned)).toEqual([['session:p', 'session:o', 'session:r', 'session:q']]); // pinned tabs stay ahead
    expect(cur(openTab(base, S('x'))).panes).toEqual([{ tabs: [{ id: 'session:x', ...S('x'), pinned: false }], activeTabId: 'session:x' }]); // the empty pane takes it
  });

  it('openTab, open in pane P: activates it there and focuses P, never opening a second copy', () => {
    const m = openTab(focusPane(split(), 0), S('d'));
    expect(ids(m)).toEqual([['session:a', 'session:b', 'session:c'], ['session:d']]);
    expect(cur(m).focusedPane).toBe(1);
    expect(active(openTab(abc(), S('a')))).toEqual(['session:a']);
  });

  it('openSession with split and no split: opens it in a new pane 1 at ratio 0.5 and focuses it', () => {
    const m = split();
    expect(ids(m)).toEqual([['session:a', 'session:b', 'session:c'], ['session:d']]);
    expect(cur(m)).toMatchObject({ focusedPane: 1, splitRatio: 0.5 });
    const moved = openSession(abc(), 'b' as AppSessionId, { split: true });
    expect(ids(moved)).toEqual([['session:a', 'session:c'], ['session:b']]); // an open session moves across
  });

  it('closeTab: removes it, remembers it, and activates the right neighbour, else the left', () => {
    const m = closeTab(activateTab(abc(), 'session:b'), 'session:b');
    expect(ids(m)).toEqual([['session:a', 'session:c']]);
    expect(active(m)).toEqual(['session:c']);
    expect(m.closedTabs.map((t) => t.id)).toEqual(['session:b']);
    expect(active(closeTab(abc(), 'session:c'))).toEqual(['session:b']);
    expect(active(closeTab(abc(), 'session:a'))).toEqual(['session:c']); // an inactive tab leaves the active one alone
  });

  it('closeTab: an emptied pane 1 collapses the split and focuses pane 0', () => {
    const m = closeTab(split(), 'session:d');
    expect(ids(m)).toEqual([['session:a', 'session:b', 'session:c']]);
    expect(cur(m).focusedPane).toBe(0);
  });

  it('closeTab: an emptied pane 0 hands its place to pane 1', () => {
    const emptied = ['session:a', 'session:b', 'session:c'].reduce(closeTab, focusPane(split(), 0));
    expect(ids(emptied)).toEqual([['session:d']]);
    expect(cur(emptied).focusedPane).toBe(0);
  });

  it('closeTab keeps at most ten closed tabs, newest last', () => {
    let m = base;
    for (let i = 0; i < 12; i += 1) m = closeTab(openTab(m, S(`s${i}`)), `session:s${i}`);
    expect(m.closedTabs.map((t) => t.id)).toEqual(Array.from({ length: 10 }, (_, i) => `session:s${i + 2}`));
  });

  // W5: with the Overview out of the strip nothing is permanent; the last tab closes to one empty pane, which ⌘⇧T refills.
  it('closeTab: the last tab leaves the only pane empty, and reopenClosed brings it back there', () => {
    const m = closeTab(openTab(base, S('a')), 'session:a');
    expect(m).toEqual({ ...base, closedTabs: [{ id: 'session:a', ...S('a'), pinned: false }] });
    expect(LayoutMainSchema.safeParse(m).success).toBe(true);
    const all = ['session:d', 'session:a', 'session:b', 'session:c'].reduce(closeTab, split());
    expect(cur(all)).toMatchObject({ panes: [{ tabs: [], activeTabId: '' }], focusedPane: 0 });
    const back = reopenClosed(m, 0);
    expect(ids(back)).toEqual([['session:a']]);
    expect(active(back)).toEqual(['session:a']);
  });

  it('moveTab: moves it to the index in the other pane, activates and focuses there; an emptied source collapses without a closed-tab entry', () => {
    const m = moveTab(split(), 'session:a', 1, 0);
    expect(ids(m)).toEqual([['session:b', 'session:c'], ['session:a', 'session:d']]);
    expect(active(m)).toEqual(['session:c', 'session:a']);
    expect(cur(m).focusedPane).toBe(1);
    const collapsed = moveTab(split(), 'session:d', 0, 1);
    expect(ids(collapsed)).toEqual([['session:a', 'session:d', 'session:b', 'session:c']]);
    expect(cur(collapsed).focusedPane).toBe(0);
    expect(collapsed.closedTabs).toEqual([]);
  });

  it('splitWithActive, no split: moves the active tab into a new pane 1, the source keeping its neighbour active', () => {
    const m = splitWithActive(activateTab(abc(), 'session:b'));
    expect(ids(m)).toEqual([['session:a', 'session:c'], ['session:b']]);
    expect(active(m)).toEqual(['session:c', 'session:b']);
    expect(cur(m).focusedPane).toBe(1);
    const one = openTab(base, S('a'));
    expect(splitWithActive(one)).toEqual(one); // a pane's only tab has nowhere to split from
    expect(splitWithActive(base)).toEqual(base); // nor has an empty pane anything to split
    // "Open in split" (or ⌘Enter on a card) with nothing open fills the empty pane rather than opening a second one
    expect(ids(openSession(base, 'x' as AppSessionId, { split: true }))).toEqual([['session:x']]);
    expect(ids(openTab(base, { kind: 'diagnostics' }, { pane: 'other' }))).toEqual([['diagnostics']]);
  });

  it('splitWithActive, split: moves the focused pane’s active tab to the other pane', () => {
    const m = splitWithActive(focusPane(split(), 0));
    expect(ids(m)).toEqual([['session:a', 'session:b'], ['session:d', 'session:c']]);
    expect(cur(m).focusedPane).toBe(1);
  });

  it('selectTab: activates the n-th tab of the focused pane; out of range is a no-op', () => {
    expect(active(selectTab(abc(), 2))).toEqual(['session:b']);
    expect(active(selectTab(abc(), 1))).toEqual(['session:a']);
    expect(selectTab(abc(), 9)).toEqual(abc());
    expect(selectTab(base, 1)).toEqual(base);
    expect(active(selectTab(split(), 1))).toEqual(['session:c', 'session:d']);
  });

  it('cycleTab: next or previous tab of the focused pane, wrapping; an empty pane has nothing to cycle', () => {
    expect(active(cycleTab(abc(), 1))).toEqual(['session:a']);
    expect(active(cycleTab(abc(), -1))).toEqual(['session:b']);
    expect(cycleTab(base, 1)).toBe(base);
  });

  it('reopenClosed: brings the last closed tab back where it was, in the focused pane', () => {
    const closed = closeTab(activateTab(abc(), 'session:b'), 'session:b');
    const m = reopenClosed(closed, 1);
    expect(ids(m)).toEqual([['session:a', 'session:b', 'session:c']]);
    expect(active(m)).toEqual(['session:b']);
    expect(m.closedTabs).toEqual([]);
    expect(ids(reopenClosed(closed, null))).toEqual([['session:a', 'session:c', 'session:b']]); // no memory: openTab
    expect(reopenClosed(base, null)).toEqual(base);
  });

  it('togglePinned: flips pinned and keeps pinned tabs ahead', () => {
    const m = togglePinned(abc(), 'session:c');
    expect(ids(m)).toEqual([['session:c', 'session:a', 'session:b']]);
    expect(ids(togglePinned(m, 'session:c'))).toEqual([['session:c', 'session:a', 'session:b']]);
    expect((cur(togglePinned(m, 'session:c')).panes[0].tabs[0] as TabRef).pinned).toBe(false);
  });

  it('session.removed: closes the session’s session and agent tabs without a closed-tab entry', () => {
    const withAgent = openTab(split(), { kind: 'agent', appSessionId: 'd' as AppSessionId, agentId: 'g1' as never });
    const m = dropSession(closeTab(withAgent, 'session:a'), 'd' as AppSessionId);
    expect(ids(m)).toEqual([['session:b', 'session:c']]);
    expect(m.closedTabs.map((t) => t.id)).toEqual(['session:a']);
  });

  it('drag to the right edge, no split: moveTab(id, 1, 0) creates pane 1 like a split open', () => {
    const m = moveTab(abc(), 'session:b', 1, 0);
    expect(ids(m)).toEqual([['session:a', 'session:c'], ['session:b']]);
    expect(cur(m)).toMatchObject({ focusedPane: 1, splitRatio: 0.5 });
  });

  it('keeps pinned tabs ahead when reordering: an unpinned tab moved before a pinned one lands after it, and back', () => {
    const pinnedA = togglePinned(abc(), 'session:a'); // [pinned a, b, c]
    expect(ids(moveTab(pinnedA, 'session:c', 0, 0))).toEqual([['session:a', 'session:c', 'session:b']]);
    expect(ids(moveTab(pinnedA, 'session:a', 0, 3))).toEqual([['session:a', 'session:b', 'session:c']]);
  });

  it('keeps pinned tabs ahead when a pinned tab crosses into the other pane', () => {
    const pinnedB = togglePinned(split(), 'session:b'); // pane 0: [pinned b, a, c], pane 1: [d]
    const crossed = moveTab(pinnedB, 'session:b', 1, 1);
    expect(ids(crossed)).toEqual([['session:a', 'session:c'], ['session:b', 'session:d']]);
  });

  it('clamps the split ratio to 0.25–0.75', () => {
    expect(cur(setSplitRatio(split(), 0.9)).splitRatio).toBe(0.75);
    expect(cur(setSplitRatio(split(), 0.1)).splitRatio).toBe(0.25);
  });

  // W5: hydration no longer re-inserts an Overview; a layout left with nothing falls back to the default's empty pane.
  it('hydrating drops a tab whose session is unknown and falls back to one empty pane when nothing is left', () => {
    const known = (id: AppSessionId) => id === 'a';
    const session = (id: string, pinned = false): TabRef => ({ id: `session:${id}`, ...S(id), pinned });
    expect(ids(repairMain(split(), known))).toEqual([['session:a']]);
    const onlyUnknown = one({ panes: [{ tabs: [session('zz')], activeTabId: 'session:zz' }, { tabs: [session('yy')], activeTabId: 'session:yy' }], focusedPane: 1, splitRatio: 0.5 });
    expect(repairMain(onlyUnknown, known)).toEqual(base);
    const onlyA = one({ ...EMPTY_TAB_SET, panes: [{ tabs: [session('a')], activeTabId: 'session:a' }] });
    expect(repairMain(onlyA, known)).toEqual(onlyA); // nothing is added
    const unordered = one({ ...EMPTY_TAB_SET, panes: [{ tabs: [session('a'), { id: 'diagnostics', kind: 'diagnostics', pinned: true }], activeTabId: 'session:zz' }] });
    expect(cur(repairMain(unordered, known)).panes).toEqual([{ tabs: [cur(unordered).panes[0].tabs[1], session('a')], activeTabId: 'diagnostics' }]); // pinned first; a lost active tab is the first
  });
});

// I2 (§5.2 as amended 2026-10-01): a session opened from the sidebar, the Overview or the palette replaces the focused
// pane's session.
// cua #90: an options tab main replaced with a page (`browser.extensions.reveal`'s replacement)
describe('retargeting a tab', () => {
  const W = (browserTabId: string) => ({ kind: 'browser' as const, appSessionId: A_ID, browserTabId });

  it('the tab takes the new target in place: its position, its pin and its being active; nothing joins ⌘⇧T', () => {
    const m = openTab(openTab(abc(), W('opt')), S('d')); // a, b, c, opt, d with d active
    const r = retargetTab(m, 'browser:a:opt', W('page'));
    expect(ids(r)).toEqual([['session:a', 'session:b', 'session:c', 'browser:a:page', 'session:d']]);
    expect(active(r)).toEqual(['session:d']);
    expect(r.closedTabs).toEqual([]);
    const shown = retargetTab(activateTab(m, 'browser:a:opt'), 'browser:a:opt', W('page'));
    expect(active(shown)).toEqual(['browser:a:page']);
    expect(currentSet(shown).panes[0].tabs[3]).toEqual({ id: 'browser:a:page', ...W('page'), pinned: false });
    const pinned = retargetTab(togglePinned(m, 'browser:a:opt'), 'browser:a:opt', W('page'));
    expect(currentSet(pinned).panes[0].tabs[0]).toMatchObject({ id: 'browser:a:page', pinned: true });
  });

  it('in whichever pane and set holds it, the strip and the focus staying where they are', () => {
    const m = focusPane(openTab(split(), W('opt'), { pane: 1 }), 0); // pane 1: d, opt
    const r = retargetTab(m, 'browser:a:opt', W('page'));
    expect(ids(r)).toEqual([['session:a', 'session:b', 'session:c'], ['session:d', 'browser:a:page']]);
    expect(currentSet(r).focusedPane).toBe(0);
    const other = { ...m, current: 'proj-z' as TabSetKey, sets: { ...m.sets, ['proj-z' as TabSetKey]: EMPTY_TAB_SET } };
    expect(retargetTab(other, 'browser:a:opt', W('page')).current).toBe('proj-z');
  });

  it('a tab not open anywhere, or a target already open, leaves the layout as it was', () => {
    const m = openTab(abc(), W('opt'));
    expect(retargetTab(m, 'browser:a:gone', W('page'))).toBe(m);
    expect(retargetTab(m, 'browser:a:opt', S('a'))).toBe(m);
  });
});

describe('replacing the active session', () => {
  it('an unpinned session tab active in the focused pane gives its place to the session, remembered for ⌘⇧T', () => {
    const m = replaceActive(activateTab(abc(), 'session:b'), 'x' as AppSessionId);
    expect(ids(m)).toEqual([['session:a', 'session:x', 'session:c']]);
    expect(active(m)).toEqual(['session:x']);
    expect(m.closedTabs.map((t) => t.id)).toEqual(['session:b']);
    expect(ids(reopenClosed(m, null))).toEqual([['session:a', 'session:x', 'session:b', 'session:c']]);
    expect(openSession(abc(), 'x' as AppSessionId)).toEqual(replaceActive(abc(), 'x' as AppSessionId)); // openSession's default
  });

  it('a session open anywhere is activated, in its pane, and nothing is replaced', () => {
    const m = replaceActive(focusPane(split(), 1), 'b' as AppSessionId);
    expect(ids(m)).toEqual(ids(split()));
    expect(active(m)).toEqual(['session:b', 'session:d']);
    expect(cur(m).focusedPane).toBe(0);
    expect(m.closedTabs).toEqual([]);
  });

  it('a pinned tab or an empty pane is left alone: the session opens after the active tab', () => {
    const pinned = togglePinned(abc(), 'session:c');
    expect(ids(replaceActive(pinned, 'x' as AppSessionId))).toEqual([['session:c', 'session:x', 'session:a', 'session:b']]);
    expect(ids(replaceActive(base, 'x' as AppSessionId))).toEqual([['session:x']]);
    expect(replaceActive(pinned, 'x' as AppSessionId).closedTabs).toEqual([]);
    const pinnedFile = togglePinned(openTab(abc(), { kind: 'file', path: '/r/a.ts', line: null, appSessionId: 'a' as AppSessionId }), 'file:/r/a.ts');
    expect(ids(replaceActive(pinnedFile, 'x' as AppSessionId))[0]).toEqual(expect.arrayContaining(['file:/r/a.ts', 'session:x']));
  });

  // E11 F2b (plan 2.5; owner decision 2): opening a session replaces the main tab whatever it shows; what must not be
  // lost (an unsaved file, a launch in flight) is the store's to keep out of this (`layout.ts` openSession)
  it('an unpinned tab of any kind gives its place to the session, remembered for ⌘⇧T', () => {
    const kinds: TabTarget[] = [
      { kind: 'settings', section: null },
      { kind: 'diagnostics' },
      { kind: 'file', path: '/r/a.ts', line: null, appSessionId: 'a' as AppSessionId },
      { kind: 'diff', appSessionId: 'a' as AppSessionId, ref: 'HEAD' },
      { kind: 'agent', appSessionId: 'a' as AppSessionId, agentId: 'ag-1' as AgentId },
    ];
    for (const target of kinds) {
      const shown = openTab(abc(), target);
      const old = active(shown)[0]!;
      const m = replaceActive(shown, 'x' as AppSessionId);
      expect(ids(m), target.kind).toEqual([['session:a', 'session:b', 'session:c', 'session:x']]);
      expect(active(m)).toEqual(['session:x']);
      expect(m.closedTabs.map((t) => t.id)).toEqual([old]);
    }
  });

  it('replaces in the focused pane of a split, leaving the other pane alone', () => {
    const m = replaceActive(split(), 'x' as AppSessionId); // pane 1 focused, d active
    expect(ids(m)).toEqual([['session:a', 'session:b', 'session:c'], ['session:x']]);
    expect(cur(m).focusedPane).toBe(1);
  });

  it('openSession with how: tab opens a tab of its own, as before', () => {
    expect(ids(openSession(abc(), 'x' as AppSessionId, { how: 'tab' }))).toEqual([['session:a', 'session:b', 'session:c', 'session:x']]);
  });

});

// C11's eighth ask: a singleton tab kind, opened like any tab, closable, never pinned (W6: the Accounts tab, the other
// singleton, retired into the top bar's usage popover).
describe('the settings tab', () => {
  const settings = (section: 'engine' | 'keyboard' | null) => ({ kind: 'settings' as const, section });

  it('opens as a singleton: a second open activates the existing tab and updates its section', () => {
    let m = openTab(abc(), settings('engine'));
    expect(ids(m)).toEqual([['session:a', 'session:b', 'session:c', 'settings']]);
    m = openTab(activateTab(m, 'session:a'), settings('keyboard'));
    expect(ids(m)).toEqual([['session:a', 'session:b', 'session:c', 'settings']]);
    expect(active(m)).toEqual(['settings']);
    expect(cur(m).panes[0].tabs.find((t) => t.id === 'settings')).toEqual({ id: 'settings', kind: 'settings', section: 'keyboard', pinned: false });
  });

  it('is closable and never pinned', () => {
    const m = openTab(base, settings(null));
    expect(togglePinned(m, 'settings')).toBe(m);
    expect(ids(closeTab(m, 'settings'))).toEqual([[]]);
    expect(LayoutMainSchema.safeParse(m).success).toBe(true);
  });
});

describe('file tabs and the panel’s session (C8’s tenth ask)', () => {
  const file = (line: number | null, appSessionId: AppSessionId | null = A_ID) => ({ kind: 'file' as const, path: '/repo/src/app.ts', line, appSessionId });
  const FILE_ID = 'file:/repo/src/app.ts';

  // Reopening an open file tab (after its pin, with another tab active) must leave one tab, active, pinned, carrying
  // exactly what the latest open asked for.
  const reopen = (first: ReturnType<typeof file>, again: ReturnType<typeof file>) => {
    const m = openTab(activateTab(togglePinned(openTab(abc(), first), FILE_ID), 'session:a'), again);
    expect(ids(m)[0].filter((id) => id === FILE_ID)).toHaveLength(1);
    expect(active(m)).toEqual([FILE_ID]);
    expect(LayoutMainSchema.safeParse(m).success).toBe(true);
    return cur(m).panes[0].tabs.find((t) => t.id === FILE_ID);
  };

  it('openTab on an open file tab at another line takes the new line and activates it, keeping its pin', () => {
    expect(reopen(file(3), file(42))).toEqual({ id: FILE_ID, ...file(42), pinned: true });
  });

  it('openTab on an open file tab from another session takes that session, even at the same line', () => {
    const B = 'b' as AppSessionId;
    const tab = reopen(file(3, A_ID), file(3, B));
    expect(tab).toEqual({ id: FILE_ID, ...file(3, B), pinned: true });
    expect(sessionOfTab(tab ?? null)).toBe('b'); // the panel follows the file's new session
  });

  it('openTab on an open file tab with no session drops the old session', () => {
    const tab = reopen(file(3, A_ID), file(7, null));
    expect(tab).toEqual({ id: FILE_ID, ...file(7, null), pinned: true });
    expect(sessionOfTab(tab ?? null)).toBeNull();
  });

  it('the panel follows the session of the focused pane’s active session, agent, diff and file tab', () => {
    const B = 'b' as AppSessionId;
    expect(sessionOfTab(activeTab(abc()))).toBe('c');
    expect(sessionOfTab(activeTab(openTab(abc(), { kind: 'agent', appSessionId: B, agentId: 'agent-1' as AgentId })))).toBe('b');
    expect(sessionOfTab(activeTab(openTab(abc(), { kind: 'diff', appSessionId: B, ref: 'HEAD' })))).toBe('b');
    expect(sessionOfTab(activeTab(openTab(abc(), file(1))))).toBe('a');
    expect(sessionOfTab(activeTab(openTab(abc(), file(1, null))))).toBeNull();
    expect(sessionOfTab(activeTab(base))).toBeNull(); // an empty pane
    expect(sessionOfTab(activeTab(openTab(abc(), { kind: 'diagnostics' })))).toBeNull();
    // E4a (X14): a browser main tab belongs to its tab's session (P-21), so the panel shows that session
    expect(sessionOfTab(activeTab(openTab(abc(), { kind: 'browser', appSessionId: B, browserTabId: 'b_0123456789ab' })))).toBe('b');
  });
});


// W12 (I3, §5.2 as amended 2026-10-01): a tab set per project; the strip shows the current one.
describe('tab sets per project', () => {
  const X = 'proj-x' as ProjectId;
  const Y = 'proj-y' as ProjectId;
  const project: Record<string, ProjectId | null> = { a: X, b: X, c: X, y1: Y, y2: Y, n1: null, new: Y };
  const keyOf = (id: AppSessionId): TabSetKey => project[id] ?? NO_PROJECT;
  const setOf: SetOfTab = (tab) => {
    const id = sessionOfTab(tab);
    return id === null ? null : keyOf(id);
  };
  // the store's opens: a session's tab in its project's set
  const open = (m: LayoutMain, id: string, how: 'replace' | 'tab' = 'tab') => openSession(m, id as AppSessionId, { how, set: keyOf(id as AppSessionId) });
  const setIds = (m: LayoutMain, key: TabSetKey) => m.sets[key]?.panes.map((p) => p.tabs.map((t) => t.id));
  // X's set holds a, b; Y's holds y1, y2 and is current.
  const two = () => ['a', 'b', 'y1', 'y2'].reduce((m, id) => open(m, id), base);

  it('a session of another project opens in its project’s set, which the strip then shows; the emptied set it left goes', () => {
    const m = open(base, 'a');
    expect(m.current).toBe(X);
    expect(Object.keys(m.sets)).toEqual([X]); // the empty 'none' set went
    const both = two();
    expect(both.current).toBe(Y);
    expect(setIds(both, X)).toEqual([['session:a', 'session:b']]);
    expect(ids(both)).toEqual([['session:y1', 'session:y2']]);
    expect(LayoutMainSchema.safeParse(both).success).toBe(true);
  });

  it('a session open in another set is activated there, the strip moving to it', () => {
    const m = open(two(), 'a', 'replace');
    expect(m.current).toBe(X);
    expect(active(m)).toEqual(['session:a']);
    expect(m.sets[Y]).toEqual(two().sets[Y]); // nothing replaced
    expect(activateTab(two(), 'session:b').current).toBe(X);
  });

  it('a replace works in the session’s set: it switches first, then swaps that set’s active session tab', () => {
    const m = replaceActive(two(), 'c' as AppSessionId, X); // X's active tab is b
    expect(m.current).toBe(X);
    expect(ids(m)).toEqual([['session:a', 'session:c']]);
    expect(setIds(m, Y)).toEqual([['session:y1', 'session:y2']]);
    expect(m.closedTabs.map((t) => t.id)).toEqual(['session:b']);
  });

  it('setCurrentProject switches the strip; an emptied set stays current and shows the empty pane', () => {
    const m = switchSet(two(), X);
    expect(ids(m)).toEqual([['session:a', 'session:b']]);
    const emptied = ['session:a', 'session:b'].reduce(closeTab, m);
    expect(emptied.current).toBe(X);
    expect(ids(emptied)).toEqual([[]]);
    expect(Object.keys(emptied.sets).sort()).toEqual([X, Y].sort());
    expect(Object.keys(switchSet(emptied, Y).sets)).toEqual([Y]); // leaving it, it goes
    const fresh = switchSet(two(), 'proj-z' as ProjectId);
    expect(ids(fresh)).toEqual([[]]);
    expect(switchSet(fresh, fresh.current)).toBe(fresh);
  });

  it('⌘1–9, ⌃Tab, split and the split ratio work on the current set alone', () => {
    const m = two();
    expect(active(selectTab(m, 1))).toEqual(['session:y1']);
    expect(selectTab(m, 3)).toBe(m); // X's tabs do not count
    expect(active(cycleTab(m, 1))).toEqual(['session:y1']);
    const splitY = splitWithActive(m);
    expect(ids(splitY)).toEqual([['session:y1'], ['session:y2']]);
    expect(splitY.sets[X]).toBe(m.sets[X]);
    expect(cur(setSplitRatio(splitY, 0.3)).splitRatio).toBe(0.3);
    expect(setSplitRatio(splitY, 0.3).sets[X]?.splitRatio).toBe(0.5);
  });

  it('a tab id lives in one set: Settings opened from another set moves to the current one, a file tab too', () => {
    let m = openTab(switchSet(two(), X), { kind: 'settings', section: null });
    expect(setIds(m, X)).toEqual([['session:a', 'session:b', 'settings']]);
    m = openTab(switchSet(m, Y), { kind: 'settings', section: 'keyboard' });
    expect(setIds(m, X)).toEqual([['session:a', 'session:b']]);
    expect(ids(m)).toEqual([['session:y1', 'session:y2', 'settings']]);
    expect(activeTab(m)).toMatchObject({ id: 'settings', section: 'keyboard' });
    const file = (appSessionId: AppSessionId | null) => ({ kind: 'file' as const, path: '/r/f.ts', line: null, appSessionId });
    const filed = openTab(switchSet(two(), X), file('a' as AppSessionId), { set: X });
    const moved = openTab(switchSet(filed, Y), file('y1' as AppSessionId), { set: Y });
    expect(setIds(moved, X)).toEqual([['session:a', 'session:b']]);
    expect(ids(moved)).toEqual([['session:y1', 'session:y2', 'file:/r/f.ts']]);
  });

  // P3-L (M3): an artifact's tab is the workspace's, not a session's: it follows the strip as Settings does, keeps its
  // pin, and one artifact has one tab, opened again only activated.
  it('an artifact tab follows the current set, keeps its pin, and opening it again activates its one tab', () => {
    const artifact = { kind: 'artifact' as const, artifactId: '00000000-0000-4000-8000-000000000001' };
    const id = `artifact:${artifact.artifactId}`;
    expect(sessionOfTab(artifact)).toBeNull();
    let m = togglePinned(openTab(switchSet(two(), X), artifact), id);
    expect(setIds(m, X)).toEqual([[id, 'session:a', 'session:b']]);
    m = openTab(m, { kind: 'diagnostics' });
    m = openTab(m, artifact);
    expect(activeTab(m)).toEqual({ id, ...artifact, pinned: true });
    m = openTab(switchSet(m, Y), artifact);
    expect(setIds(m, X)).toEqual([['diagnostics', 'session:a', 'session:b']]);
    expect(ids(m), 'pinned first').toEqual([[id, 'session:y1', 'session:y2']]);
    expect(activeTab(m)).toMatchObject({ id, pinned: true });
    expect(LayoutMainSchema.safeParse(m).success).toBe(true);
  });

  it('closing, ⌘⇧T and session.removed find a tab in whichever set holds it', () => {
    const closed = closeTab(two(), 'session:a');
    expect(setIds(closed, X)).toEqual([['session:b']]);
    expect(closed.current).toBe(Y);
    const back = reopenClosed(closed, 0, X);
    expect(back.current).toBe(X);
    expect(ids(back)).toEqual([['session:a', 'session:b']]);
    const dropped = dropSession(dropSession(two(), 'a' as AppSessionId), 'b' as AppSessionId);
    expect(Object.keys(dropped.sets)).toEqual([Y]); // X's set emptied and went
    expect(togglePinned(two(), 'session:a').sets[X]?.panes[0].tabs[0]).toMatchObject({ id: 'session:a', pinned: true });
  });

  it('refile: a tab whose session’s project changed moves to its set, and the strip follows the one it shows', () => {
    let m = open(base, 'new'); // an unstarted chat, filed under Y
    project.new = null; // … whose project is unchosen again
    try {
      m = refile(m, setOf);
      expect(m.current).toBe(NO_PROJECT);
      expect(ids(m)).toEqual([['session:new']]);
      expect(Object.keys(m.sets)).toEqual([NO_PROJECT]);
    } finally {
      project.new = Y;
    }
    const chosen = refile(m, setOf);
    expect(chosen.current).toBe(Y);
    expect(ids(chosen)).toEqual([['session:new']]);
    expect(refile(chosen, setOf)).toBe(chosen); // nothing moves, nothing changes
    // a tab in the background moves without moving the strip
    const withC: LayoutMain = { ...two(), sets: { ...two().sets, [Y]: { ...EMPTY_TAB_SET, panes: [{ tabs: [...cur(two()).panes[0].tabs, { id: 'session:c', ...S('c'), pinned: false }], activeTabId: 'session:y2' }] } } };
    const background = refile(withC, setOf);
    expect(background.current).toBe(Y);
    expect(setIds(background, X)).toEqual([['session:a', 'session:b', 'session:c']]);
    expect(ids(background)).toEqual([['session:y1', 'session:y2']]);
  });

  it('repairMain keeps a tab id once across every set, the current set’s copy first', () => {
    const dup: LayoutMain = { ...two(), sets: { ...two().sets, [X]: { ...EMPTY_TAB_SET, panes: [{ tabs: [{ id: 'session:y1', ...S('y1'), pinned: false }, { id: 'session:a', ...S('a'), pinned: false }], activeTabId: 'session:y1' }] } } };
    const repaired = repairMain(dup, () => true);
    expect(setIds(repaired, X)).toEqual([['session:a']]);
    expect(active(switchSet(repaired, X))).toEqual(['session:a']);
    expect(ids(repaired)).toEqual([['session:y1', 'session:y2']]);
    const gone = repairMain(two(), (id) => project[id] === Y);
    expect(Object.keys(gone.sets)).toEqual([Y]);
  });

  // The v1 → v2 transform at hydration (`fromV1`): each tab filed by its session's project.
  it('fromV1 files tabs by project, keeping panes, order, active tabs and the focused pane; the shown tab’s set is current', () => {
    const tab = (id: string): TabRef => ({ id: `session:${id}`, ...S(id), pinned: false });
    const settings: TabRef = { id: 'settings', kind: 'settings', section: null, pinned: false };
    const v1: LayoutMainV1 = {
      version: 1,
      panes: [
        { tabs: [tab('a'), tab('y1'), settings, tab('n1'), tab('zz')], activeTabId: 'session:y1' },
        { tabs: [tab('y2'), tab('b')], activeTabId: 'session:b' },
      ],
      focusedPane: 0,
      splitRatio: 0.4,
      closedTabs: [tab('c')],
    };
    const m = fromV1(v1, setOf); // zz: an unknown session, filed under none (hydration's repair drops it)
    expect(m.current).toBe(Y);
    expect(m.sets[Y]).toEqual({ panes: [{ tabs: [tab('y1'), settings], activeTabId: 'session:y1' }, { tabs: [tab('y2')], activeTabId: 'session:y2' }], focusedPane: 0, splitRatio: 0.4 });
    expect(m.sets[X]).toEqual({ panes: [{ tabs: [tab('a')], activeTabId: 'session:a' }, { tabs: [tab('b')], activeTabId: 'session:b' }], focusedPane: 0, splitRatio: 0.4 });
    expect(m.sets[NO_PROJECT]).toEqual({ panes: [{ tabs: [tab('n1'), tab('zz')], activeTabId: 'session:n1' }], focusedPane: 0, splitRatio: 0.4 });
    expect(m.closedTabs).toEqual([tab('c')]);
    expect(LayoutMainSchema.safeParse(m).success).toBe(true);
    expect(Object.keys(repairMain(m, (id) => id !== 'zz' && id !== 'n1').sets).sort()).toEqual([X, Y].sort());
    // nothing open: the no-project set, one empty pane
    expect(fromV1({ version: 1, ...EMPTY_TAB_SET, closedTabs: [] }, setOf)).toEqual(base);
  });
});
