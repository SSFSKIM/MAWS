import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS, type LayoutMain, type TabRef } from '@shared/ipc/schema/layout';
import {
  activateTab, closeTab, cycleTab, dropSession, focusPane, moveTab, openSession, openTab, reopenClosed, repairMain, selectTab,
  setSplitRatio, splitWithActive, togglePinned,
} from './layout-model';

const S = (id: string) => ({ kind: 'session' as const, appSessionId: id as AppSessionId });
const ids = (main: LayoutMain) => main.panes.map((p) => p.tabs.map((t) => t.id));
const active = (main: LayoutMain) => main.panes.map((p) => p.activeTabId);
const base = LAYOUT_DEFAULTS.main;
// Overview, a, b, c in pane 0 with c active.
const abc = () => [S('a'), S('b'), S('c')].reduce((m, t) => openTab(m, t), base);
const split = () => openSession(abc(), 'd' as AppSessionId, { split: true }); // pane 1: [d]

describe('layout store transitions', () => {
  it('openTab, not open: inserts after the target pane’s active tab, activates it and focuses that pane', () => {
    const m = openTab(activateTab(abc(), 'session:a'), S('x'));
    expect(ids(m)).toEqual([['overview', 'session:a', 'session:x', 'session:b', 'session:c']]);
    expect(active(m)).toEqual(['session:x']);
    expect(m.focusedPane).toBe(0);
    const pinned = openTab(togglePinned(openTab(base, S('p')), 'session:p'), S('q'));
    const afterOverview = openTab(activateTab(pinned, 'overview'), S('r'));
    expect(ids(afterOverview)).toEqual([['overview', 'session:p', 'session:r', 'session:q']]); // pinned tabs stay ahead
  });

  it('openTab, open in pane P: activates it there and focuses P, never opening a second copy', () => {
    const m = openTab(focusPane(split(), 0), S('d'));
    expect(ids(m)).toEqual([['overview', 'session:a', 'session:b', 'session:c'], ['session:d']]);
    expect(m.focusedPane).toBe(1);
    expect(active(openTab(abc(), S('a')))).toEqual(['session:a']);
  });

  it('openSession with split and no split: opens it in a new pane 1 at ratio 0.5 and focuses it', () => {
    const m = split();
    expect(ids(m)).toEqual([['overview', 'session:a', 'session:b', 'session:c'], ['session:d']]);
    expect(m).toMatchObject({ focusedPane: 1, splitRatio: 0.5 });
    const moved = openSession(abc(), 'b' as AppSessionId, { split: true });
    expect(ids(moved)).toEqual([['overview', 'session:a', 'session:c'], ['session:b']]); // an open session moves across
  });

  it('closeTab: removes it, remembers it, and activates the right neighbour, else the left', () => {
    const m = closeTab(activateTab(abc(), 'session:b'), 'session:b');
    expect(ids(m)).toEqual([['overview', 'session:a', 'session:c']]);
    expect(active(m)).toEqual(['session:c']);
    expect(m.closedTabs.map((t) => t.id)).toEqual(['session:b']);
    expect(active(closeTab(abc(), 'session:c'))).toEqual(['session:b']);
    expect(active(closeTab(abc(), 'session:a'))).toEqual(['session:c']); // an inactive tab leaves the active one alone
  });

  it('closeTab: an emptied pane 1 collapses the split and focuses pane 0', () => {
    const m = closeTab(split(), 'session:d');
    expect(ids(m)).toEqual([['overview', 'session:a', 'session:b', 'session:c']]);
    expect(m.focusedPane).toBe(0);
  });

  it('closeTab: an emptied pane 0 hands its place to pane 1', () => {
    const m = moveTab(split(), 'overview', 1, 0);
    const emptied = ['session:a', 'session:b', 'session:c'].reduce(closeTab, m);
    expect(ids(emptied)).toEqual([['overview', 'session:d']]);
    expect(emptied.focusedPane).toBe(0);
  });

  it('closeTab keeps at most ten closed tabs, newest last', () => {
    let m = base;
    for (let i = 0; i < 12; i += 1) m = closeTab(openTab(m, S(`s${i}`)), `session:s${i}`);
    expect(m.closedTabs.map((t) => t.id)).toEqual(Array.from({ length: 10 }, (_, i) => `session:s${i + 2}`));
  });

  it('closeTab(overview) is a no-op: the Overview tab is permanent', () => {
    expect(closeTab(abc(), 'overview')).toEqual(abc());
  });

  it('moveTab: moves it to the index in the other pane, activates and focuses there; an emptied source collapses without a closed-tab entry', () => {
    const m = moveTab(split(), 'session:a', 1, 0);
    expect(ids(m)).toEqual([['overview', 'session:b', 'session:c'], ['session:a', 'session:d']]);
    expect(active(m)).toEqual(['session:c', 'session:a']);
    expect(m.focusedPane).toBe(1);
    const collapsed = moveTab(split(), 'session:d', 0, 1);
    expect(ids(collapsed)).toEqual([['overview', 'session:d', 'session:a', 'session:b', 'session:c']]);
    expect(collapsed).toMatchObject({ focusedPane: 0, closedTabs: [] });
  });

  it('splitWithActive, no split: moves the active tab into a new pane 1, the source keeping its neighbour active', () => {
    const m = splitWithActive(activateTab(abc(), 'session:b'));
    expect(ids(m)).toEqual([['overview', 'session:a', 'session:c'], ['session:b']]);
    expect(active(m)).toEqual(['session:c', 'session:b']);
    expect(m.focusedPane).toBe(1);
    expect(splitWithActive(base)).toEqual(base); // a pane's only tab has nowhere to split from
  });

  it('splitWithActive, split: moves the focused pane’s active tab to the other pane', () => {
    const m = splitWithActive(focusPane(split(), 0));
    expect(ids(m)).toEqual([['overview', 'session:a', 'session:b'], ['session:d', 'session:c']]);
    expect(m.focusedPane).toBe(1);
  });

  it('selectTab: activates the n-th tab of the focused pane; out of range is a no-op', () => {
    expect(active(selectTab(abc(), 2))).toEqual(['session:a']);
    expect(active(selectTab(abc(), 1))).toEqual(['overview']);
    expect(selectTab(abc(), 9)).toEqual(abc());
    expect(active(selectTab(split(), 1))).toEqual(['session:c', 'session:d']);
  });

  it('cycleTab: next or previous tab of the focused pane, wrapping', () => {
    expect(active(cycleTab(abc(), 1))).toEqual(['overview']);
    expect(active(cycleTab(abc(), -1))).toEqual(['session:b']);
  });

  it('reopenClosed: brings the last closed tab back where it was, in the focused pane', () => {
    const closed = closeTab(activateTab(abc(), 'session:b'), 'session:b');
    const m = reopenClosed(closed, 2);
    expect(ids(m)).toEqual([['overview', 'session:a', 'session:b', 'session:c']]);
    expect(active(m)).toEqual(['session:b']);
    expect(m.closedTabs).toEqual([]);
    expect(ids(reopenClosed(closed, null))).toEqual([['overview', 'session:a', 'session:c', 'session:b']]); // no memory: openTab
    expect(reopenClosed(base, null)).toEqual(base);
  });

  it('togglePinned: flips pinned and keeps pinned tabs ahead; never unpins Overview', () => {
    const m = togglePinned(abc(), 'session:c');
    expect(ids(m)).toEqual([['overview', 'session:c', 'session:a', 'session:b']]);
    expect(ids(togglePinned(m, 'session:c'))).toEqual([['overview', 'session:c', 'session:a', 'session:b']]);
    expect((togglePinned(m, 'session:c').panes[0].tabs[1] as TabRef).pinned).toBe(false);
    expect(togglePinned(abc(), 'overview')).toEqual(abc());
  });

  it('session.removed: closes the session’s session and agent tabs without a closed-tab entry', () => {
    const withAgent = openTab(split(), { kind: 'agent', appSessionId: 'd' as AppSessionId, agentId: 'g1' as never });
    const m = dropSession(closeTab(withAgent, 'session:a'), 'd' as AppSessionId);
    expect(ids(m)).toEqual([['overview', 'session:b', 'session:c']]);
    expect(m.closedTabs.map((t) => t.id)).toEqual(['session:a']);
  });

  it('drag to the right edge, no split: moveTab(id, 1, 0) creates pane 1 like a split open', () => {
    const m = moveTab(abc(), 'session:b', 1, 0);
    expect(ids(m)).toEqual([['overview', 'session:a', 'session:c'], ['session:b']]);
    expect(m).toMatchObject({ focusedPane: 1, splitRatio: 0.5 });
  });

  it('clamps the split ratio to 0.25–0.75', () => {
    expect(setSplitRatio(split(), 0.9).splitRatio).toBe(0.75);
    expect(setSplitRatio(split(), 0.1).splitRatio).toBe(0.25);
  });

  it('hydrating drops a tab whose session is unknown and falls back to Overview when nothing is left', () => {
    const known = (id: AppSessionId) => id === 'a';
    expect(ids(repairMain(split(), known))).toEqual([['overview', 'session:a']]);
    const onlyUnknown = openSession(base, 'zz' as AppSessionId, { split: true });
    expect(repairMain(moveTab(onlyUnknown, 'overview', 1, 0), known)).toEqual(base);
    const noOverview: LayoutMain = { ...base, panes: [{ tabs: [{ id: 'session:zz', kind: 'session', appSessionId: 'zz' as AppSessionId, pinned: false }], activeTabId: 'session:zz' }] };
    expect(repairMain(noOverview, known)).toEqual(base);
    const lostOverview: LayoutMain = { ...base, panes: [{ tabs: [{ id: 'session:a', kind: 'session', appSessionId: 'a' as AppSessionId, pinned: false }], activeTabId: 'session:a' }] };
    expect(ids(repairMain(lostOverview, known))).toEqual([['overview', 'session:a']]);
  });
});
