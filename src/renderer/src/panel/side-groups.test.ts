// UX wave U8b, M1 (docs/doperpowers/plans/2026-11-12-ux-wave-U8b-column-and-tabs.md, Interfaces §A and §B): the reading
// rule over a scope's stored values, the repair every change of refs runs, and the acts that change what is in view.
// Each act's case reads its result back through `sideGroups` and holds every value it stores against build F's reader.
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { NO_SESSION_SCOPE, type LowerGroup, type PanelTabRef } from '@shared/ipc/schema/layout';
import { buildFSchemaOf } from '../../../../test/support/layout-build-f';
import { createLayoutStore, panelWidthClass, storedLayout, type LayoutState } from '../stores/layout';
import { shellGeometryOf } from '../app/shell-view';
import { A, B, mainShowing, ref } from '../test-support/panel';
import { groupForOpen, readGroups, sideGroups, type ScopeValues, type SideGroups } from './surface-model';

const review = ref('review:aaaa0001');
const files = ref('files:aaaa0002');
const t1 = ref('terminal:aaaa0003');
const t2 = ref('terminal:aaaa0004');
const info = ref('session-info:aaaa0005');
const bg = ref('background:aaaa0008');
const P = ref('terminal:aaaa0006', true);
const Q = ref('browser:aaaa0007', true);

// A group's tabs and the one in view, as ids.
const view = (g: SideGroups) => ({
  upper: g.upper.tabs.map((t) => t.id),
  upperShown: g.upper.shown?.id ?? null,
  lower: g.lower && g.lower.tabs.map((t) => t.id),
  lowerShown: g.lower?.shown?.id ?? null,
  hidden: g.hidden,
});
const values = (stack: string[] | undefined, activeTabId: string | null = null, lower?: LowerGroup): ScopeValues => ({ stack, activeTabId, lower });

describe('§A’s reading rule', () => {
  const refs = [review, files, t1, t2, info];
  it('1–2: a stack less stale and repeated ids, cut to two, is two groups; the lower holds the second and its stored tabs', () => {
    expect(view(readGroups(refs, values(['gone', files.id, files.id, review.id, t1.id])))).toEqual({
      upper: [files.id, t1.id, t2.id, info.id], upperShown: files.id, lower: [review.id], lowerShown: review.id, hidden: false,
    });
    const g = readGroups(refs, values([review.id, files.id], review.id, { tabs: [t1.id, review.id, 'gone'], share: 0.3 }));
    expect(view(g)).toEqual({ upper: [review.id, t2.id, info.id], upperShown: review.id, lower: [files.id, t1.id], lowerShown: files.id, hidden: false });
    expect(g.lower?.share).toBe(0.3);
  });
  it('2: a lower entry naming the upper tab in view, or only tabs that are gone, leaves the lower group the second id', () => {
    expect(view(readGroups(refs, values([files.id, review.id], null, { tabs: [files.id], share: 0.5 }))).lower).toEqual([review.id]);
    expect(view(readGroups(refs, values([files.id, review.id], null, { tabs: ['gone'], share: 0.5 }))).lower).toEqual([review.id]);
  });
  it('2: two tabs of one tool may both be in view, and a share is read inside 0.2..0.8 (0.5 without an entry)', () => {
    const g = readGroups(refs, values([t1.id, t2.id]));
    expect(view(g)).toMatchObject({ upperShown: t1.id, lower: [t2.id], lowerShown: t2.id });
    expect(g.lower?.share).toBe(0.5);
    expect(readGroups(refs, values([t1.id, t2.id], null, { tabs: [t2.id], share: 0.95 })).lower?.share).toBe(0.8);
  });
  it('3: one id is one group with every tab; a stored lower entry is dropped', () => {
    expect(view(readGroups(refs, values([files.id], files.id, { tabs: [t1.id], share: 0.5 })))).toEqual({ upper: refs.map((t) => t.id), upperShown: files.id, lower: null, lowerShown: null, hidden: false });
  });
  it('4: a scope with no stack stored shows its selection, as before stacks were stored', () => {
    expect(view(readGroups(refs, values(undefined, t1.id)))).toMatchObject({ upperShown: t1.id, lower: null, hidden: false });
    expect(view(readGroups(refs, values(undefined, 'gone')))).toMatchObject({ upperShown: null, hidden: true });
  });
  it('5: an empty stack is a hidden column, which remembers both groups while the lower entry names a tab and one is outside it', () => {
    expect(view(readGroups(refs, values([], t1.id, { tabs: ['gone', files.id, info.id], share: 0.4 })))).toEqual({
      upper: [review.id, t1.id, t2.id], upperShown: t1.id, lower: [files.id, info.id], lowerShown: files.id, hidden: true,
    });
    // the selection is a lower tab: the first upper tab
    expect(view(readGroups(refs, values([], files.id, { tabs: [files.id], share: 0.4 })))).toMatchObject({ upperShown: review.id, lowerShown: files.id, hidden: true });
    // every lower tab gone, or every tab below: one group with the selection
    expect(view(readGroups(refs, values([], t1.id, { tabs: ['gone'], share: 0.4 })))).toMatchObject({ upperShown: t1.id, lower: null, hidden: true });
    expect(view(readGroups([files], values([], files.id, { tabs: [files.id], share: 0.4 })))).toMatchObject({ upperShown: files.id, lower: null, hidden: true });
  });
  it('5: a stack whose only id is gone reads as hidden, which is why every change of refs repairs (M1, decision 5)', () => {
    expect(view(readGroups(refs, values(['gone'], review.id)))).toMatchObject({ upperShown: review.id, hidden: true });
  });
});

describe('where a tab that is opened goes', () => {
  const one = readGroups([review, t1], values([review.id]));
  const two = readGroups([review, t1, files], values([review.id, files.id]));
  it('with one group, above; with two, the opener’s group, else its tool’s, else the focused one, else above', () => {
    expect(groupForOpen(one, 'files', 'lower', 'lower')).toBe('upper');
    expect(groupForOpen(two, 'terminal', 'lower', null)).toBe('lower');
    expect(groupForOpen(two, 'files', null, 'upper')).toBe('lower');
    expect(groupForOpen(two, 'terminal', null, 'lower')).toBe('upper');
    expect(groupForOpen(two, 'browser', null, 'lower')).toBe('lower');
    expect(groupForOpen(two, 'browser', null, null)).toBe('upper');
  });
});

// A store with A on screen, its scopes as given.
function storeWith(state: Partial<LayoutState>) {
  const store = createLayoutStore();
  store.setState({ main: mainShowing(A), hydrated: true, ...state });
  return store;
}
const lists = (entries: [AppSessionId, PanelTabRef[], string | null][]) => new Map(entries.map(([id, tabs, activeTabId]) => [id, { tabs, activeTabId }]));
const stacked = (stacks: Record<string, string[]>) => ({ version: 2 as const, stacks, pinnedTools: [], contexts: {} });
const lowered = (lower: Record<string, LowerGroup>) => ({ version: 1 as const, lower });
// Every value the store would write under a key build F reads parses with F's frozen reader.
function expectFReads(state: LayoutState) {
  for (const [key, value] of storedLayout(state)) {
    const schema = buildFSchemaOf(key);
    if (schema) expect(schema.safeParse(value).success, `${key}: ${JSON.stringify(value)}`).toBe(true);
  }
}

describe('the repair every change of refs runs, in every scope it reaches (M1, decision 5)', () => {
  it('a pin in view in A, unpinned into B, gives way to A’s Review, and A’s column is not hidden', () => {
    const store = storeWith({ panelPinned: [P], panelBySession: lists([[A, [review], P.id], [B, [], null]]), panelSurfaces: stacked({ [A]: [P.id] }) });
    store.getState().setPanelTabPinned(B, P.id, false);
    expect(view(sideGroups(store.getState(), A))).toEqual({ upper: [review.id], upperShown: review.id, lower: null, lowerShown: null, hidden: false });
    expect(store.getState().panelSurfaces.stacks[A]).toEqual([review.id]);
    expectFReads(store.getState());
  });

  it('a pin in view in A’s lower group, closed from B, gives way to the other lower tab and A keeps two groups', () => {
    const store = storeWith({
      panelPinned: [P],
      panelBySession: lists([[A, [files, t1], files.id], [B, [review], review.id]]),
      panelSurfaces: stacked({ [A]: [files.id, P.id], [B]: [review.id] }),
      panelGroups: lowered({ [A]: { tabs: [P.id, t1.id], share: 0.4 } }),
    });
    store.getState().setPanelTabs(B, { tabs: [review], activeTabId: review.id });
    expect(view(sideGroups(store.getState(), A))).toEqual({ upper: [files.id], upperShown: files.id, lower: [t1.id], lowerShown: t1.id, hidden: false });
    expect(store.getState().panelGroups.lower[A]).toEqual({ tabs: [t1.id], share: 0.4 });
    expectFReads(store.getState());
  });

  it('with no session shown, the pin in view unpinned into a session gives way to the next pin, or to nothing', () => {
    const store = storeWith({ main: mainShowing(), panelPinned: [P, Q], panelActiveNoSession: P.id, panelBySession: lists([[A, [], null]]), panelSurfaces: stacked({ [NO_SESSION_SCOPE]: [P.id] }) });
    store.getState().setPanelTabPinned(A, P.id, false);
    expect(view(sideGroups(store.getState(), null))).toMatchObject({ upperShown: Q.id, hidden: false });
    expect(store.getState().panelActiveNoSession).toBe(Q.id);
    store.getState().setPanelTabPinned(A, Q.id, false);
    expect(view(sideGroups(store.getState(), null))).toMatchObject({ upper: [], upperShown: null });
    expect(store.getState().panelActiveNoSession).toBeNull();
    expect(storedLayout(store.getState()).get('panelTools.activeNoSession')).toEqual({ version: 1, activeTabId: null });
    expectFReads(store.getState());
  });

  it('a restored tab whose id the host replaces in place keeps its place in view', () => {
    const P2 = ref('terminal:aaaa0099', true);
    const store = storeWith({
      panelPinned: [P],
      panelBySession: lists([[A, [files], files.id], [B, [review], review.id]]),
      panelSurfaces: stacked({ [A]: [files.id, P.id], [B]: [review.id] }),
      panelGroups: lowered({ [A]: { tabs: [P.id], share: 0.5 } }),
    });
    store.getState().setPanelTabs(B, { tabs: [P2, review], activeTabId: review.id });
    expect(view(sideGroups(store.getState(), A))).toMatchObject({ upperShown: files.id, lower: [P2.id], lowerShown: P2.id });
    expect(store.getState().panelSurfaces.stacks[A]).toEqual([files.id, P2.id]);
  });

  // The rename rule reads one write that closes a tab and opens another of its tool at that position as a replacement
  // (Interfaces §B): in every scope where the new tab is a tab, it takes the old one's place in its group and in view;
  // nothing else carries over (whether it is a pin is the writer's ref; its params are its own).
  it('a tab closed and another of its tool opened at its position in one write takes its place where it is a tab', () => {
    const P3 = ref('terminal:aaaa0098', true);
    const lowerPin = () => storeWith({
      panelPinned: [P],
      panelBySession: lists([[A, [files, t1], files.id], [B, [review], review.id]]),
      panelSurfaces: stacked({ [A]: [files.id, P.id], [B]: [review.id] }),
      panelGroups: lowered({ [A]: { tabs: [P.id, t1.id], share: 0.5 } }),
    });
    const pinned = lowerPin();
    pinned.getState().setPanelTabs(B, { tabs: [P3, review], activeTabId: review.id });
    expect(view(sideGroups(pinned.getState(), A))).toMatchObject({ lower: [P3.id, t1.id], lowerShown: P3.id });
    // the new tab is B's own: not a tab of A, so A's lower group shows the neighbour
    const own = lowerPin();
    own.getState().setPanelTabs(B, { tabs: [{ ...P3, pinned: false }, review], activeTabId: review.id });
    expect(view(sideGroups(own.getState(), A))).toMatchObject({ lower: [t1.id], lowerShown: t1.id });
    // another tool at that position is no replacement
    const other = lowerPin();
    other.getState().setPanelTabs(B, { tabs: [{ ...Q }, review], activeTabId: review.id });
    expect(view(sideGroups(other.getState(), A))).toMatchObject({ lower: [t1.id], lowerShown: t1.id });
  });

  it('a session dropped takes its lower entry with it', () => {
    const store = storeWith({ panelBySession: lists([[A, [t1, t2], t1.id], [B, [review, files], review.id]]), panelGroups: lowered({ [B]: { tabs: [files.id], share: 0.5 }, [A]: { tabs: [t2.id], share: 0.5 } }) });
    store.getState().dropSession(B);
    expect(store.getState().panelGroups.lower).toEqual({ [A]: { tabs: [t2.id], share: 0.5 } });
  });
});

describe('the acts that change what is in view (Interfaces §B)', () => {
  const withTabs = (tabs: PanelTabRef[], stack: string[], over: Partial<LayoutState> = {}) =>
    storeWith({ panelBySession: lists([[A, tabs, stack[0] ?? null]]), panelSurfaces: stacked({ [A]: stack }), ...over });

  it('moving a tab below makes a second group with it alone, at half the height; a group’s only tab is not moved', () => {
    const store = withTabs([review, files, t1], [review.id]);
    store.getState().moveSurfaceTab(A, files.id, 'lower');
    const g = sideGroups(store.getState(), A);
    expect(view(g)).toEqual({ upper: [review.id, t1.id], upperShown: review.id, lower: [files.id], lowerShown: files.id, hidden: false });
    expect(g.lower?.share).toBe(0.5);
    expect(store.getState().panelSurfaces.stacks[A]).toEqual([review.id, files.id]);
    expectFReads(store.getState());
    const alone = withTabs([review], [review.id]);
    alone.getState().moveSurfaceTab(A, review.id, 'lower');
    expect(sideGroups(alone.getState(), A).lower).toBeNull();
  });

  it('a tab moved between groups comes into view there, the group it left shows its neighbour, and an emptied group closes', () => {
    const store = withTabs([review, files, t1, t2], [review.id, files.id], { panelGroups: lowered({ [A]: { tabs: [files.id, t2.id], share: 0.3 } }) });
    store.getState().moveSurfaceTab(A, review.id, 'lower');
    expect(view(sideGroups(store.getState(), A))).toEqual({ upper: [t1.id], upperShown: t1.id, lower: [review.id, files.id, t2.id], lowerShown: review.id, hidden: false });
    expect(store.getState().panelGroups.lower[A]).toEqual({ tabs: [review.id, files.id, t2.id], share: 0.3 });
    store.getState().moveSurfaceTab(A, t1.id, 'lower');
    expect(view(sideGroups(store.getState(), A))).toEqual({ upper: [review.id, files.id, t1.id, t2.id], upperShown: t1.id, lower: null, lowerShown: null, hidden: false });
    expect(store.getState().panelGroups.lower[A]).toBeUndefined();
    expectFReads(store.getState());
  });

  it('two terminals in view, one in each group', () => {
    const store = withTabs([t1, t2], [t1.id]);
    store.getState().moveSurfaceTab(A, t2.id, 'lower');
    expect(store.getState().panelSurfaces.stacks[A]).toEqual([t1.id, t2.id]);
    expectFReads(store.getState());
  });

  it('hiding keeps what each group shows, and showing a tab shows the column with the other group’s tab as it was', () => {
    const store = withTabs([review, files, t1], [review.id, files.id]);
    store.getState().hideSurfaces(A);
    expect(store.getState().panelSurfaces.stacks[A]).toEqual([]);
    expect(store.getState().panelBySession.get(A)?.activeTabId).toBe(review.id);
    expect(store.getState().panelGroups.lower[A]).toEqual({ tabs: [files.id], share: 0.5 });
    expect(view(sideGroups(store.getState(), A))).toMatchObject({ upperShown: review.id, lowerShown: files.id, hidden: true });
    expectFReads(store.getState());
    store.getState().showSurfaceTab(A, t1.id);
    expect(view(sideGroups(store.getState(), A))).toEqual({ upper: [review.id, t1.id], upperShown: t1.id, lower: [files.id], lowerShown: files.id, hidden: false });
    expect(store.getState().panelSurfaces.stacks[A]).toEqual([t1.id, files.id]);
    store.getState().showSurfaceTab(A, 'gone');
    expect(store.getState().panelSurfaces.stacks[A]).toEqual([t1.id, files.id]);
  });

  it('a close, a pin and an unpin leave values F reads', () => {
    const store = withTabs([review, files, t1], [review.id]);
    store.getState().moveSurfaceTab(A, files.id, 'lower');
    store.getState().setPanelTabs(A, { tabs: [review, t1], activeTabId: review.id });
    expect(sideGroups(store.getState(), A).lower).toBeNull();
    expect(store.getState().panelGroups.lower[A]).toBeUndefined();
    expectFReads(store.getState());
    store.getState().setPanelTabPinned(A, t1.id, true);
    expectFReads(store.getState());
    store.getState().setPanelTabPinned(A, t1.id, false);
    expectFReads(store.getState());
  });

  it('a ref written for the lower group joins it, and is in view there only when the same call activates it (M3)', () => {
    const notes = ref('notes:aaaa0008');
    const store = withTabs([review, files, t1], [review.id, files.id]);
    store.getState().updatePanelTabs(A, (refs) => [...refs, t2], { group: 'lower' });
    expect(view(sideGroups(store.getState(), A))).toEqual({ upper: [review.id, t1.id], upperShown: review.id, lower: [files.id, t2.id], lowerShown: files.id, hidden: false });
    store.getState().updatePanelTabs(A, (refs) => [...refs, info], { group: 'lower', activate: info.id });
    expect(view(sideGroups(store.getState(), A))).toEqual({ upper: [review.id, t1.id], upperShown: review.id, lower: [files.id, t2.id, info.id], lowerShown: info.id, hidden: false });
    expectFReads(store.getState());
    store.getState().hideSurfaces(A);
    store.getState().updatePanelTabs(A, (refs) => [...refs, notes], { group: 'lower' });
    expect(view(sideGroups(store.getState(), A))).toEqual({ upper: [review.id, t1.id], upperShown: review.id, lower: [files.id, t2.id, info.id, notes.id], lowerShown: info.id, hidden: true });
    expectFReads(store.getState());
    const one = withTabs([review], [review.id]); // one group: there is no lower group to join
    one.getState().updatePanelTabs(A, (refs) => [...refs, files], { group: 'lower' });
    expect(view(sideGroups(one.getState(), A))).toEqual({ upper: [review.id, files.id], upperShown: review.id, lower: null, lowerShown: null, hidden: false });
  });

  it('a share is set inside 0.2..0.8, and only with a lower group', () => {
    const store = withTabs([review, files], [review.id, files.id]);
    store.getState().setGroupShare(A, 0.95);
    expect(sideGroups(store.getState(), A).lower?.share).toBe(0.8);
    expect(store.getState().panelGroups.lower[A]?.share).toBe(0.8);
    const one = withTabs([review], [review.id]);
    one.getState().setGroupShare(A, 0.3);
    expect(one.getState().panelGroups.lower).toEqual({});
  });

  it('a card folds and unfolds in the cards’ order', () => {
    const store = storeWith({});
    expect(store.getState().cardsOpen).toEqual(['environment']);
    store.getState().setCardOpen('connectors', true);
    store.getState().setCardOpen('context', true);
    store.getState().setCardOpen('environment', false);
    expect(store.getState().cardsOpen).toEqual(['context', 'connectors']);
    expect(storedLayout(store.getState()).get('cards.open')).toEqual({ version: 1, open: ['context', 'connectors'] });
  });
});

describe('the two widths (A5, X-165)', () => {
  it('a drag writes the width in use and regions.panel.width; a reset makes it automatic and writes F’s 380', () => {
    const store = storeWith({ panelBySession: lists([[A, [review, info], review.id]]), panelSurfaces: stacked({ [A]: [review.id] }) });
    store.getState().setPanelWidth(512.4);
    expect(store.getState().panelWidths).toEqual({ version: 1, wide: 512, narrow: null });
    expect(store.getState().regions.panel.width).toBe(512);
    expectFReads(store.getState());
    store.getState().setPanelWidth(null);
    expect(store.getState().panelWidths).toEqual({ version: 1, wide: null, narrow: null });
    expect(store.getState().regions.panel.width).toBe(380);
    expectFReads(store.getState());
    store.getState().showSurfaceTab(A, info.id);
    store.getState().setPanelWidth(380);
    expect(store.getState().panelWidths).toEqual({ version: 1, wide: null, narrow: 380 });
    expect(store.getState().regions.panel.width).toBe(380);
    expectFReads(store.getState());
  });

  // UX wave U8b, Addendum 6 (the owner's answer, Decision Log 23): a terminal opens wide, like Review
  it('a column whose tab in view is a terminal is wide: 60 % of the room, its width remembered as the wide one', () => {
    const store = storeWith({ panelBySession: lists([[A, [t1, bg], t1.id]]), panelSurfaces: stacked({ [A]: [t1.id] }) });
    expect(panelWidthClass(store.getState())).toBe('wide');
    expect(shellGeometryOf(store.getState(), 1440).panel).toBe(720); // 60 % of the 1200 px right of the sidebar
    store.getState().setPanelWidth(600);
    expect(store.getState().panelWidths).toEqual({ version: 1, wide: 600, narrow: null });
  });

  it('a terminal dragged to a width leaves the width Background tasks opens at, and the reverse', () => {
    const store = storeWith({ panelBySession: lists([[A, [t1, bg], t1.id]]), panelSurfaces: stacked({ [A]: [t1.id] }) });
    store.getState().setPanelWidth(600);
    store.getState().showSurfaceTab(A, bg.id);
    expect(panelWidthClass(store.getState())).toBe('narrow');
    expect(shellGeometryOf(store.getState(), 1440).panel).toBe(360);
    store.getState().setPanelWidth(400);
    store.getState().showSurfaceTab(A, t1.id);
    expect(shellGeometryOf(store.getState(), 1440).panel).toBe(600);
    store.getState().showSurfaceTab(A, bg.id);
    expect(shellGeometryOf(store.getState(), 1440).panel).toBe(400);
    expect(store.getState().panelWidths).toEqual({ version: 1, wide: 600, narrow: 400 });
  });

  it('a terminal in one group and Background tasks in the other make a wide column (any tab in view)', () => {
    for (const [upper, lower] of [[t1, bg], [bg, t1]]) {
      const store = storeWith({
        panelBySession: lists([[A, [t1, bg], upper.id]]),
        panelSurfaces: stacked({ [A]: [upper.id, lower.id] }),
        panelGroups: lowered({ [A]: { tabs: [lower.id], share: 0.5 } }),
      });
      expect(view(sideGroups(store.getState(), A))).toMatchObject({ upperShown: upper.id, lowerShown: lower.id });
      expect(panelWidthClass(store.getState())).toBe('wide');
      expect(shellGeometryOf(store.getState(), 1440).panel).toBe(720);
    }
  });
});
