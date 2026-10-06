// The Side pane's state per parent session (E3 execution document, Design §6 and Interfaces "Renderer"): which view
// the pane shows (set by whoever opens it: the composer, a summary row's Open, a chip), and which child the pane is
// showing right now, so the unread rule counts that child as on screen (`session/visibility.ts`). Outside React and
// keyed by the parent, so a pane opened before its tab exists, or restored from layout.json, reads the same view.
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';

export type SideView = { kind: 'thread'; childAppSessionId: AppSessionId };

interface SidePane {
  view: SideView | null;
  shownChild: AppSessionId | null; // the child whose transcript the pane draws while the pane is on screen
}

const EMPTY: SidePane = { view: null, shownChild: null };

export const useSidePane = create<{ panes: ReadonlyMap<AppSessionId, SidePane> }>()(() => ({ panes: new Map() }));

export const sidePaneOf = (state: { panes: ReadonlyMap<AppSessionId, SidePane> }, parent: AppSessionId): SidePane => state.panes.get(parent) ?? EMPTY;

function patch(parent: AppSessionId, change: Partial<SidePane>): void {
  useSidePane.setState(({ panes }) => {
    const before = panes.get(parent) ?? EMPTY;
    const next = { ...before, ...change };
    if (next.view === before.view && next.shownChild === before.shownChild) return { panes };
    return { panes: new Map(panes).set(parent, next) };
  });
}

export const setSideView = (parent: AppSessionId, view: SideView): void => patch(parent, { view });

// Published by the thread view while it draws `child` on screen; withdrawn (only if it is still the one shown) when it
// stops.
export const showSideChild = (parent: AppSessionId, child: AppSessionId): void => patch(parent, { shownChild: child });
export function hideSideChild(parent: AppSessionId, child: AppSessionId): void {
  if (sidePaneOf(useSidePane.getState(), parent).shownChild === child) patch(parent, { shownChild: null });
}

// Every parent whose pane shows a child now, with that child.
export function sideChildrenShown(state = useSidePane.getState()): ReadonlyMap<AppSessionId, AppSessionId> {
  const shown = new Map<AppSessionId, AppSessionId>();
  for (const [parent, pane] of state.panes) if (pane.shownChild !== null) shown.set(parent, pane.shownChild);
  return shown;
}
