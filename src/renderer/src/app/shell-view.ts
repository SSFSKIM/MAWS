import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import { pageOpen, useLayout, type LayoutState } from '../stores/layout';
import { activeTab, sessionOfTab } from '../stores/layout-model';
import { useSessions, type SessionsState } from '../stores/sessions';
import { surfaceSession, surfaceTabs } from '../panel/surface-model';
import { cardColumnShown, isWideColumn, shellGeometry } from './shell-geometry';
import { useWindowWidth } from './regions';

export const useShellView = create<{ sidebarOverlay: boolean; cardsOverlay: boolean }>(() => ({ sidebarOverlay: false, cardsOverlay: false }));
export { WIDE_SURFACES } from './shell-geometry';
// A column is wide while a tool of `WIDE_SURFACES` is among the tabs in view; its width is the one remembered for that class.
export function shellGeometryOf(state: LayoutState, width: number) {
  const tabs = surfaceTabs(state, surfaceSession(state));
  return shellGeometry(state.regions, width, tabs.length > 0, isWideColumn(tabs), state.panelWidths);
}
export function useShellGeometry() {
  const width = useWindowWidth();
  const state = useLayout();
  return shellGeometryOf(state, width);
}

// UX wave U8b (UC-9, §C.2): the card column now, from the one place its predicate's inputs are gathered. The shell's
// column, the Session cards icon, `toggleSessionCards` and `useCardColumnShown` read this and nothing else, so none of
// them can say the column is drawn while another says it is not. `session`: the session of the tab in front. UX wave U7b
// (M5, decision 4): `placed`, whether the column keeps its place (the shell mounts it and pads the main area by it), is
// the predicate's answer as if no page were open; `shown`, whether it is drawn and counts as shown, is `placed` while no
// page is open. A page hides a placed column without taking its place (decision 2).
export interface CardColumn { session: AppSessionId | null; sessionTab: boolean; room: number; placed: boolean; shown: boolean }
// The column speaks of a session that has a record in this window, or of another machine's terminal session that is
// only listed (it has the column's slots and its running work, and none of the cards a record feeds).
export const cardsSpeakOf = (sessions: Pick<SessionsState, 'records' | 'listed'>, session: AppSessionId | null): boolean =>
  session !== null && (sessions.records.has(session) || sessions.listed.get(session)?.lane === 'A');
type CardFacts = { known: boolean; opened: boolean; pageOpen: boolean };
function cardFactsNow(state: LayoutState): CardFacts {
  const view = useShellView.getState();
  return { known: cardsSpeakOf(useSessions.getState(), sessionOfTab(activeTab(state.main))), opened: view.cardsOverlay, pageOpen: pageOpen(state) };
}
export function cardColumnNow(state: LayoutState, width: number, facts: CardFacts = cardFactsNow(state)): CardColumn {
  const session = sessionOfTab(activeTab(state.main));
  const sessionTab = session !== null && facts.known;
  const room = width - shellGeometryOf(state, width).sidebar;
  const tabsInView = surfaceTabs(state, surfaceSession(state)).length;
  const input = { sessionTab, tabsInView, collapsed: state.regions.panel.collapsed, room, opened: facts.opened };
  const placed = cardColumnShown({ ...input, pageOpen: false });
  const shown = cardColumnShown({ ...input, pageOpen: facts.pageOpen });
  return { session, sessionTab, room, placed, shown };
}
// The hook: subscribed to every fact `cardColumnNow` reads, and handing them to it.
export function useCardColumn(): CardColumn {
  const width = useWindowWidth();
  const state = useLayout();
  const session = sessionOfTab(activeTab(state.main));
  const known = useSessions((s) => cardsSpeakOf(s, session));
  const opened = useShellView((s) => s.cardsOverlay);
  return cardColumnNow(state, width, { known, opened, pageOpen: pageOpen(state) });
}
// For U4: whether the card column is drawn now, so its card can place itself when it is not (§C.1).
export const useCardColumnShown = (): boolean => useCardColumn().shown;

export function showSidebar() {
  useLayout.getState().setSidebar({ collapsed: false });
  useShellView.setState({ sidebarOverlay: true });
}
export function toggleSidebar() {
  const state = useLayout.getState();
  const geometry = shellGeometryOf(state, window.innerWidth);
  if (geometry.sidebarAside) useShellView.setState((s) => ({ sidebarOverlay: !s.sidebarOverlay }));
  else state.setSidebar({ collapsed: !state.regions.sidebar.collapsed });
}
