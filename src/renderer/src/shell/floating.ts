// The floating session card's state (P3-G execution document, §D1; X30). `regions.panel.floating` (persisted) puts the
// panel in the main column's place and the shown session in the card; what is transient lives here: whether the card is
// closed to its pill (a moment's choice, never restored: a launch with `floating` shows the card open; reset whenever
// `floating` changes) and the browser pane's column reservation (§D3, M2). The transitions the action table, the
// header's Float button, the divider and the card run are here too, so every path marks focus the same way (§D1.2).
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { FloatingCardSize, LayoutRegions } from '@shared/ipc/schema/layout';
import { markFocusOnMount } from '../stores/composer';
import { SUMMARY_CARD_KEY, useLayout, type LayoutState } from '../stores/layout';
import { activeTab, sessionOfTab } from '../stores/layout-model';

// The element a pane reserves as the card's column (the browser pane's spacer, §D3).
export interface ColumnReservation {
  element: HTMLElement;
}

export interface FloatingCardState {
  closed: boolean; // the card closed to its pill
  column: ColumnReservation | null;
  setClosed(closed: boolean): void;
  // The latest reservation wins; its release clears only itself.
  reserveColumn(element: HTMLElement): () => void;
}

export const useFloatingCard = create<FloatingCardState>()((set, get) => ({
  closed: false,
  column: null,
  setClosed: (closed) => set({ closed }),
  reserveColumn(element) {
    const reservation: ColumnReservation = { element };
    set({ column: reservation });
    return () => {
      if (get().column === reservation) set({ column: null });
    };
  },
}));

useLayout.subscribe((state, before) => {
  if (state.regions.panel.floating !== before.regions.panel.floating && useFloatingCard.getState().closed) useFloatingCard.setState({ closed: false });
});

type Layout = Pick<LayoutState, 'main' | 'regions'>;
const isFloating = (regions: LayoutRegions) => regions.panel.floating && !regions.panel.collapsed;

// The session the card (or its pill) draws: the shown session (the focused pane's active tab's, as the panel follows)
// while the panel floats; null otherwise, and with no shown session (no card and no pill then, §D1.4).
export const cardSession = ({ main, regions }: Layout): AppSessionId | null => (isFloating(regions) ? sessionOfTab(activeTab(main)) : null);

// The session the open card draws on screen (null while it is a pill).
export const openCardSession = (layout: Layout, closed: boolean = useFloatingCard.getState().closed): AppSessionId | null => (closed ? null : cardSession(layout));

// §D1.5: the key of the card's size in `regions.floatingCard`: the panel tab the card sits over (the shown session's
// selected one), or the resting summary's.
export function cardSizeKey(state: Pick<LayoutState, 'main' | 'panelBySession'>): string {
  const shown = sessionOfTab(activeTab(state.main));
  return (shown === null ? null : state.panelBySession.get(shown)?.activeTabId) ?? SUMMARY_CARD_KEY;
}

// ---- the card's size (§D1.4) -------------------------------------------------------------------------------------------

export const CARD_MARGIN = 16; // from the panel body's left and bottom edges, and the least room kept on every side
export const CARD_MIN = { w: 360, h: 240 };
const CARD_DEFAULT = { w: 420, h: 640, heightShare: 0.6 };

// The card's size in a panel body of `bounds` (the region under the header): the stored size, else 420 × min(60 % of
// the body, 640); no smaller than the minimum unless the body is, no larger than the body less the margins.
export function placeCard(stored: FloatingCardSize | undefined, bounds: { width: number; height: number }): FloatingCardSize {
  const fit = (value: number, min: number, max: number) => Math.round(Math.max(Math.min(min, max), Math.min(value, max)));
  const base = stored ?? { w: CARD_DEFAULT.w, h: Math.min(bounds.height * CARD_DEFAULT.heightShare, CARD_DEFAULT.h) };
  return { w: fit(base.w, CARD_MIN.w, bounds.width - 2 * CARD_MARGIN), h: fit(base.h, CARD_MIN.h, bounds.height - 2 * CARD_MARGIN) };
}

// ---- transitions (§D1.2) ----------------------------------------------------------------------------------------------

const layout = () => useLayout.getState();
const shown = () => sessionOfTab(activeTab(layout().main));

// Floats the panel from any state; the card's composer takes the keyboard when it mounts. `width` is the divider drag's
// restore value (§D1.6); nothing else writes the width, so docking brings the column back as it was.
export function floatPanel(patch: { width?: number } = {}): void {
  const session = shown();
  if (session !== null) markFocusOnMount(session);
  layout().setPanel({ ...patch, floating: true });
}

// Docks a floating panel; the main pane's remounted composer takes the keyboard (when the focused tab is the session's
// own: a file tab of it mounts no composer, and an unconsumed mark would steal focus later).
export function dockPanel(): void {
  const tab = activeTab(layout().main);
  if (tab?.kind === 'session') markFocusOnMount(tab.appSessionId);
  layout().setPanel({ floating: false });
}

export function closeCard(): void {
  useFloatingCard.getState().setClosed(true);
}

export function openCard(): void {
  const session = shown();
  if (session !== null) markFocusOnMount(session);
  useFloatingCard.getState().setClosed(false);
}

// `panel.float` (⌥⌘B, the header's Float): floats a panel that is not floating; on a floating one, brings a closed card
// back, else docks (and docks when there is no session to show).
export function togglePanelFloat(): void {
  if (!isFloating(layout().regions)) floatPanel();
  else if (useFloatingCard.getState().closed && shown() !== null) openCard();
  else dockPanel();
}
