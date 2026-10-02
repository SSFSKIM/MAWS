import { describe, expect, it } from 'vitest';
import type { AgentId, AppSessionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS, LayoutMainSchema, type LayoutMain, type TabRef } from '@shared/ipc/schema/layout';
import {
  activateTab, activeTab, closeTab, cycleTab, dropSession, focusPane, moveTab, openSession, openTab, reopenClosed, repairMain, replaceActive, replaceWithSession, selectTab,
  sessionOfTab, setSplitRatio, splitWithActive, togglePinned,
} from './layout-model';

const S = (id: string) => ({ kind: 'session' as const, appSessionId: id as AppSessionId });
const ids = (main: LayoutMain) => main.panes.map((p) => p.tabs.map((t) => t.id));
const active = (main: LayoutMain) => main.panes.map((p) => p.activeTabId);
const base = LAYOUT_DEFAULTS.main;
const A_ID = 'a' as AppSessionId;
// a, b, c in pane 0 with c active (the default is one empty pane: W5's Overview is no tab).
const abc = () => [S('a'), S('b'), S('c')].reduce((m, t) => openTab(m, t), base);
const split = () => openSession(abc(), 'd' as AppSessionId, { split: true }); // pane 1: [d]

describe('layout store transitions', () => {
  it('openTab, not open: inserts after the target pane’s active tab, activates it and focuses that pane', () => {
    const m = openTab(activateTab(abc(), 'session:a'), S('x'));
    expect(ids(m)).toEqual([['session:a', 'session:x', 'session:b', 'session:c']]);
    expect(active(m)).toEqual(['session:x']);
    expect(m.focusedPane).toBe(0);
    const pinned = openTab(['session:p', 'session:o'].reduce(togglePinned, openTab(openTab(base, S('p')), S('o'))), S('q')); // [p, o] pinned, q
    const afterPinned = openTab(activateTab(pinned, 'session:p'), S('r'));
    expect(ids(afterPinned)).toEqual([['session:p', 'session:o', 'session:r', 'session:q']]); // pinned tabs stay ahead
    expect(openTab(base, S('x')).panes).toEqual([{ tabs: [{ id: 'session:x', ...S('x'), pinned: false }], activeTabId: 'session:x' }]); // the empty pane takes it
  });

  it('openTab, open in pane P: activates it there and focuses P, never opening a second copy', () => {
    const m = openTab(focusPane(split(), 0), S('d'));
    expect(ids(m)).toEqual([['session:a', 'session:b', 'session:c'], ['session:d']]);
    expect(m.focusedPane).toBe(1);
    expect(active(openTab(abc(), S('a')))).toEqual(['session:a']);
  });

  it('openSession with split and no split: opens it in a new pane 1 at ratio 0.5 and focuses it', () => {
    const m = split();
    expect(ids(m)).toEqual([['session:a', 'session:b', 'session:c'], ['session:d']]);
    expect(m).toMatchObject({ focusedPane: 1, splitRatio: 0.5 });
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
    expect(m.focusedPane).toBe(0);
  });

  it('closeTab: an emptied pane 0 hands its place to pane 1', () => {
    const emptied = ['session:a', 'session:b', 'session:c'].reduce(closeTab, focusPane(split(), 0));
    expect(ids(emptied)).toEqual([['session:d']]);
    expect(emptied.focusedPane).toBe(0);
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
    expect(all).toMatchObject({ panes: [{ tabs: [], activeTabId: '' }], focusedPane: 0 });
    const back = reopenClosed(m, 0);
    expect(ids(back)).toEqual([['session:a']]);
    expect(active(back)).toEqual(['session:a']);
  });

  it('moveTab: moves it to the index in the other pane, activates and focuses there; an emptied source collapses without a closed-tab entry', () => {
    const m = moveTab(split(), 'session:a', 1, 0);
    expect(ids(m)).toEqual([['session:b', 'session:c'], ['session:a', 'session:d']]);
    expect(active(m)).toEqual(['session:c', 'session:a']);
    expect(m.focusedPane).toBe(1);
    const collapsed = moveTab(split(), 'session:d', 0, 1);
    expect(ids(collapsed)).toEqual([['session:a', 'session:d', 'session:b', 'session:c']]);
    expect(collapsed).toMatchObject({ focusedPane: 0, closedTabs: [] });
  });

  it('splitWithActive, no split: moves the active tab into a new pane 1, the source keeping its neighbour active', () => {
    const m = splitWithActive(activateTab(abc(), 'session:b'));
    expect(ids(m)).toEqual([['session:a', 'session:c'], ['session:b']]);
    expect(active(m)).toEqual(['session:c', 'session:b']);
    expect(m.focusedPane).toBe(1);
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
    expect(m.focusedPane).toBe(1);
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
    expect((togglePinned(m, 'session:c').panes[0].tabs[0] as TabRef).pinned).toBe(false);
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
    expect(m).toMatchObject({ focusedPane: 1, splitRatio: 0.5 });
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
    expect(setSplitRatio(split(), 0.9).splitRatio).toBe(0.75);
    expect(setSplitRatio(split(), 0.1).splitRatio).toBe(0.25);
  });

  // W5: hydration no longer re-inserts an Overview; a layout left with nothing falls back to the default's empty pane.
  it('hydrating drops a tab whose session is unknown and falls back to one empty pane when nothing is left', () => {
    const known = (id: AppSessionId) => id === 'a';
    const session = (id: string, pinned = false): TabRef => ({ id: `session:${id}`, ...S(id), pinned });
    expect(ids(repairMain(split(), known))).toEqual([['session:a']]);
    const onlyUnknown: LayoutMain = { ...base, panes: [{ tabs: [session('zz')], activeTabId: 'session:zz' }, { tabs: [session('yy')], activeTabId: 'session:yy' }], focusedPane: 1 };
    expect(repairMain(onlyUnknown, known)).toEqual(base);
    const onlyA: LayoutMain = { ...base, panes: [{ tabs: [session('a')], activeTabId: 'session:a' }] };
    expect(repairMain(onlyA, known)).toEqual(onlyA); // nothing is added
    const unordered: LayoutMain = { ...base, panes: [{ tabs: [session('a'), { id: 'diagnostics', kind: 'diagnostics', pinned: true }], activeTabId: 'session:zz' }] };
    expect(repairMain(unordered, known).panes).toEqual([{ tabs: [unordered.panes[0].tabs[1], session('a')], activeTabId: 'diagnostics' }]); // pinned first; a lost active tab is the first
  });
});

// I2 (§5.2 as amended 2026-10-01): a session opened from the sidebar, the Overview or the palette replaces the focused
// pane's session.
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
    expect(m.focusedPane).toBe(0);
    expect(m.closedTabs).toEqual([]);
  });

  it('a pinned tab, a tab of another kind or an empty pane is left alone: the session opens after the active tab', () => {
    const pinned = togglePinned(abc(), 'session:c');
    expect(ids(replaceActive(pinned, 'x' as AppSessionId))).toEqual([['session:c', 'session:x', 'session:a', 'session:b']]);
    const settings = openTab(abc(), { kind: 'settings', section: null });
    expect(ids(replaceActive(settings, 'x' as AppSessionId))).toEqual([['session:a', 'session:b', 'session:c', 'settings', 'session:x']]);
    const file = openTab(abc(), { kind: 'file', path: '/r/a.ts', line: null, appSessionId: 'a' as AppSessionId });
    expect(ids(replaceActive(file, 'x' as AppSessionId))[0]).toContain('file:/r/a.ts');
    expect(ids(replaceActive(base, 'x' as AppSessionId))).toEqual([['session:x']]);
    expect(replaceActive(pinned, 'x' as AppSessionId).closedTabs).toEqual([]);
  });

  it('replaces in the focused pane of a split, leaving the other pane alone', () => {
    const m = replaceActive(split(), 'x' as AppSessionId); // pane 1 focused, d active
    expect(ids(m)).toEqual([['session:a', 'session:b', 'session:c'], ['session:x']]);
    expect(m.focusedPane).toBe(1);
  });

  it('openSession with how: tab opens a tab of its own, as before', () => {
    expect(ids(openSession(abc(), 'x' as AppSessionId, { how: 'tab' }))).toEqual([['session:a', 'session:b', 'session:c', 'session:x']]);
  });

  it('replaceWithSession without remembering: an unstarted tab whose guard passed leaves no ⌘⇧T entry', () => {
    const m = replaceWithSession(abc(), 'session:b', 'x' as AppSessionId, { remember: false });
    expect(ids(m)).toEqual([['session:a', 'session:x', 'session:c']]);
    expect(active(m)).toEqual(['session:x']);
    expect(m.closedTabs).toEqual([]);
    // the session opened meanwhile: the old tab just goes; the old tab gone: the session opens like any tab
    expect(ids(replaceWithSession(abc(), 'session:b', 'c' as AppSessionId, { remember: false }))).toEqual([['session:a', 'session:c']]);
    expect(ids(replaceWithSession(abc(), 'session:zz', 'x' as AppSessionId, { remember: false }))).toEqual([['session:a', 'session:b', 'session:c', 'session:x']]);
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
    expect(m.panes[0].tabs.find((t) => t.id === 'settings')).toEqual({ id: 'settings', kind: 'settings', section: 'keyboard', pinned: false });
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
    return m.panes[0].tabs.find((t) => t.id === FILE_ID);
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
  });
});

