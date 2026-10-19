// The floating session card's state (P3-G execution document, §D1; X30). `regions.panel.floating` (persisted) puts the
// panel in the main column's place and the shown session in the card; what is transient lives here: whether the card is
// closed to its pill (a moment's choice, never restored: a launch with `floating` shows the card open; reset whenever
// `floating` changes), the browser pane's column reservation, the column's width while its edge is dragged, and whether
// a browser chrome hosts the pill (§D3, M2). The transitions the action table, the header's Float button, the divider and
// the card run are here too, so every path marks focus the same way (§D1.2).
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { FloatingCardSize, LayoutRegions } from '@shared/ipc/schema/layout';
import { markFocusOnMount } from '../stores/composer';
import { SUMMARY_CARD_KEY, useLayout, type LayoutState } from '../stores/layout';
import { activeTab, sessionOfTab } from '../stores/layout-model';
import { toast } from '../stores/notices'; // P3-F wave S (F6)

// The element a pane reserves as the card's column (the browser pane's spacer, §D3).
export interface ColumnReservation {
  element: HTMLElement;
}

// One drag of the column's right edge: its widths reach the store only while it is the current drag, and its end clears
// only itself, so an abandoned gesture can never clear or overwrite its successor's.
export interface ColumnDrag {
  width(width: number): void;
  end(): void;
}

export interface FloatingCardState {
  closed: boolean; // the card closed to its pill
  // Close unmounted the focused Close button with the card: the pill that mounts next takes the keyboard, once (P3-F)
  pillTakesFocus: boolean;
  column: ColumnReservation | null;
  // The column's width while the card's right edge is dragged (the pane's spacer follows it, so the page moves with the
  // drag); null otherwise. `regions` is written once, on release.
  columnDrag: number | null;
  pillHost: object | null; // a browser chrome drawing the pill in its row (the layer then draws none)
  setClosed(closed: boolean): void;
  // The latest reservation, drag or host wins; each one's release clears only itself.
  reserveColumn(element: HTMLElement): () => void;
  startColumnDrag(): ColumnDrag;
  hostPill(): () => void;
}

export const useFloatingCard = create<FloatingCardState>()((set, get) => {
  let drag: object | null = null; // the current column drag's token
  return {
    closed: false,
    pillTakesFocus: false,
    column: null,
    columnDrag: null,
    pillHost: null,
    setClosed: (closed) => set({ closed, pillTakesFocus: false }),
    reserveColumn(element) {
      const reservation: ColumnReservation = { element };
      set({ column: reservation });
      return () => {
        if (get().column === reservation) set({ column: null });
      };
    },
    startColumnDrag() {
      const token = {};
      drag = token;
      return {
        width: (width) => {
          if (drag === token) set({ columnDrag: width });
        },
        end: () => {
          if (drag !== token) return;
          drag = null;
          set({ columnDrag: null });
        },
      };
    },
    hostPill() {
      const host = {};
      set({ pillHost: host });
      return () => {
        if (get().pillHost === host) set({ pillHost: null });
      };
    },
  };
});

useLayout.subscribe((state, before) => {
  if (state.regions.panel.floating !== before.regions.panel.floating && useFloatingCard.getState().closed) useFloatingCard.setState({ closed: false, pillTakesFocus: false });
});

type Layout = Pick<LayoutState, 'main' | 'regions'>;
const isFloating = (regions: LayoutRegions) => regions.panel.floating && !regions.panel.collapsed;

// P3-F wave S (F6, candidate 58): the card draws the shown session, so with none (an artifact, Settings or an empty pane
// in front) a floating panel took main's place with nothing over it: main at 0 px, its tab strip gone until Dock. Float
// therefore refuses with no shown session (the header's button disabled, the action and the divider saying why), and a
// float that meets none docks: one restored over such a tab, or one such a tab came in front of (⌘, opens Settings over
// the card). Refused, not kept docked while `floating` stays stored: every reader of the panel's place reads `regions`
// alone (`panelInMain`), and a stored float would come back unasked the next time a session's tab is in front.
export const FLOAT_COPY = { noSession: 'Select a session’s tab to float it' };

// The dock runs in a microtask, still before a paint: written inside this listener, it would reach the later listeners
// before the change that caused it, and persistence would take a restored float's dock for the hydrated baseline and
// never write it. Before hydration nothing docks, since a dock queued then replays over the stored regions.
const floatsWithNoSession = (state: Pick<LayoutState, 'main' | 'regions' | 'hydrated'>) => state.hydrated && isFloating(state.regions) && sessionOfTab(activeTab(state.main)) === null;
let docking = false;
useLayout.subscribe((state) => {
  if (docking || !floatsWithNoSession(state)) return;
  docking = true;
  queueMicrotask(() => {
    docking = false;
    if (floatsWithNoSession(useLayout.getState())) useLayout.getState().setPanel({ floating: false });
  });
});

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

// ---- the room a native-view pane leaves the card (§D3) -----------------------------------------------------------------

// A page in the panel is a native view, drawn over the DOM: the card cannot float over it. The pane showing one leaves
// the card a column at its left instead (the page live beside it); the pill moves into the browser's chrome row (the
// coordinator's ruling on M2: the page keeps its full height).
export const COLUMN_PAGE_MIN = 280; // the page keeps at least this much beside the column

// The column the open card asks of the panel's pane under it (null while no card is open): the live drag's width, else
// the stored width of the panel tab under the card, else the card's default; never under the card's minimum (a width
// stored while the page's floor held the column narrower comes back to it once there is room).
export function useColumnWidth(): number | null {
  const up = useLayout((s) => cardSession(s) !== null);
  const stored = useLayout((s) => s.regions.floatingCard[cardSizeKey(s)]?.w);
  const closed = useFloatingCard((s) => s.closed);
  const drag = useFloatingCard((s) => s.columnDrag);
  return up && !closed ? Math.max(CARD_MIN.w, drag ?? stored ?? CARD_DEFAULT.w) : null;
}

// ---- transitions (§D1.2) ----------------------------------------------------------------------------------------------

const layout = () => useLayout.getState();
const shown = () => sessionOfTab(activeTab(layout().main));

// Floats the panel from any state; the card's composer takes the keyboard when it mounts. `width` is the divider drag's
// restore value (§D1.6); nothing else writes the width, so docking brings the column back as it was. With no shown
// session it floats nothing and says why (P3-F wave S, F6): the action and the divider have no button to disable. A
// refused drag still puts its start back: the divider wrote its maximum on the way past it.
export function floatPanel(patch: { width?: number } = {}): void {
  const session = shown();
  if (session === null) {
    if (patch.width !== undefined) layout().setPanel({ width: patch.width });
    toast({ id: 'panel-float-no-session', level: 'info', text: FLOAT_COPY.noSession, actions: [], dismissible: true });
    return;
  }
  markFocusOnMount(session);
  layout().setPanel({ ...patch, floating: true });
}

// Docks a floating panel; the main pane's remounted composer takes the keyboard (when the focused tab is the session's
// own: a file tab of it mounts no composer, and an unconsumed mark would steal focus later).
export function dockPanel(): void {
  const tab = activeTab(layout().main);
  if (tab?.kind === 'session') markFocusOnMount(tab.appSessionId);
  layout().setPanel({ floating: false });
}

// The card's Close: its pill (the layer's, or a browser chrome's row's) takes the keyboard the Close button held.
export function closeCard(): void {
  useFloatingCard.setState({ closed: true, pillTakesFocus: true });
}

export function openCard(): void {
  const session = shown();
  if (session !== null) markFocusOnMount(session);
  useFloatingCard.getState().setClosed(false);
}

// `panel.float` (⌥⌘B, the header's Float): floats a panel that is not floating (refused with no session to show); on a
// floating one, brings a closed card back, else docks (and docks when there is no session to show).
export function togglePanelFloat(): void {
  if (!isFloating(layout().regions)) floatPanel();
  else if (useFloatingCard.getState().closed && shown() !== null) openCard();
  else dockPanel();
}
