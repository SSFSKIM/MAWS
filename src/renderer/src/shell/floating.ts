// The floating session card's state (P3-G execution document, §D1; X30). `regions.panel.floating` (persisted) puts the
// panel in the main column's place and the shown session in the card; what is transient lives here: whether the card is
// closed to its pill (a moment's choice, never restored: a launch with a float shows the card open; reset whenever the
// float changes), the browser pane's column reservation, the column's width while its edge is dragged, whether a browser
// chrome hosts the pill (§D3, M2), and the open card's rect (P4-B3, X37). The transitions the action table, the header's
// Float button, the divider and the card run are here too, so every path marks focus the same way (§D1.2).
//
// P4-B3 M2 (X37; its Decision Log 7 to 15): a second card, the main split's. A split floats when its session pane ("S")
// yields (`floating` on the set: the divider's release or Expand); the card then draws S's session at the bottom right of
// the main area, over the other pane ("A"). One card at a time: `cardHost` answers which one is up, `cardSession` what it
// draws. Both cards share the pill, the raise on a new request, the transcript's scroll carry and the rect.
import { create } from 'zustand';
import type { AttentionKind } from '@shared/graph/enums';
import type { AppSessionId } from '@shared/graph/ids';
import type { FloatingCardSize, LayoutMain, LayoutRegions } from '@shared/ipc/schema/layout';
import { panelInMain } from '../app/regions';
import { surfaceSession, surfaceTabs } from '../panel/surface-model';
import { selectPendingOf, useAttention } from '../stores/attention';
import { markFocusOnMount, useComposerStore } from '../stores/composer';
import { mainCardKey, SUMMARY_CARD_KEY, useLayout, type LayoutState } from '../stores/layout';
import { activeTab, currentSet, floatingPane, floatSplit as floatedMain, paneShowsSession, sessionOfTab } from '../stores/layout-model';
import { toast } from '../stores/notices'; // P3-F wave S (F6)
import { markTranscriptCarry } from '../transcript/view/scroll-carry'; // P4-B3 M2

// The element a pane reserves as the card's column (the browser pane's spacer, §D3).
export interface ColumnReservation {
  element: HTMLElement;
}

// One drag of the column's edge: its widths reach the store only while it is the current drag, and its end clears only
// itself, so an abandoned gesture can never clear or overwrite its successor's.
export interface ColumnDrag {
  width(width: number): void;
  end(): void;
}

// P4-B3 (X37): which region's card is up: the panel's (the panel floats) or the main split's (a pane floats).
export type CardHost = 'panel' | 'split';
// The open card's rect in client px.
export interface CardRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FloatingCardState {
  closed: boolean; // the card closed to its pill
  // Close unmounted the focused Close button with the card: the pill that mounts next takes the keyboard, once (P3-F)
  pillTakesFocus: boolean;
  column: ColumnReservation | null;
  // The column's width while the card's edge is dragged (the pane's spacer follows it, so the page moves with the drag);
  // null otherwise. `regions` is written once, on release.
  columnDrag: number | null;
  pillHost: object | null; // a browser chrome drawing the pill in its row (the layer then draws none)
  // P4-B3 (X37, its Decision Log 15): the open card's rect in client px and its region, published by the card from a
  // layout effect and its resize observer; null for a pill or no card. Editors may keep their controls out from under it.
  rect: CardRect | null;
  host: CardHost | null;
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
    rect: null,
    host: null,
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

type Layout = Pick<LayoutState, 'main' | 'regions' | 'panelPinned' | 'panelBySession' | 'panelActiveNoSession' | 'panelSurfaces' | 'knownSession'>;
const hasPanelSurface = (state: Layout) => surfaceTabs(state, surfaceSession(state)).length > 0;
const isFloating = (regions: LayoutRegions) => regions.panel.floating && !regions.panel.collapsed;
const otherPane = (pane: 0 | 1): 0 | 1 => (pane === 0 ? 1 : 0);

// P4-B3: the current set's float: the pane that yielded and the session its card draws; null while docked.
export function splitFloat(main: LayoutMain): { pane: 0 | 1; appSessionId: AppSessionId } | null {
  const set = currentSet(main);
  const pane = floatingPane(set);
  const tab = pane === null ? undefined : set.panes[pane]?.tabs.find((t) => t.id === set.floating?.sessionTabId);
  return pane !== null && tab?.kind === 'session' ? { pane, appSessionId: tab.appSessionId } : null;
}

// P4-B3 (its Decision Log 8): the card that is up. The panel's while the panel floats with a session to show; else the
// split's while the current set floats a pane and the main area is on screen (under a maximized panel it is at 0 px, so
// the split's card hides with it, its float kept); else none.
export function cardHost(state: Layout): CardHost | null {
  const { main, regions } = state;
  if (isFloating(regions) && hasPanelSurface(state)) return sessionOfTab(activeTab(main)) === null ? null : 'panel';
  if (panelInMain(regions) && hasPanelSurface(state)) return null;
  return splitFloat(main) === null ? null : 'split';
}

// The session the card (or its pill) draws: the panel's shown session (the focused pane's active tab's, as the panel
// follows) while the panel floats; the floating pane's session while the split floats (the pane's, not the focused tab's:
// focus may be in A); null otherwise, and with no shown session (no card and no pill then, §D1.4).
export function cardSession(layout: Layout): AppSessionId | null {
  const host = cardHost(layout);
  if (host === 'panel') return sessionOfTab(activeTab(layout.main));
  return host === 'split' ? (splitFloat(layout.main)?.appSessionId ?? null) : null;
}

// The session the open card draws on screen (null while it is a pill).
export const openCardSession = (layout: Layout, closed: boolean = useFloatingCard.getState().closed): AppSessionId | null => (closed ? null : cardSession(layout));

// §D1.5: the key of the card's size in `regions.floatingCard`: what the card sits over. The panel's card: the panel tab
// (the shown session's selected one), or the resting summary's. P4-B3 (its Decision Log 10): the split's card, the
// active tab of the pane beside it (`main:<tab id>`).
export function cardSizeKey(state: Layout): string {
  const split = cardHost(state) === 'split' ? splitFloat(state.main) : null;
  if (split !== null) return mainCardKey(currentSet(state.main).panes[otherPane(split.pane)]?.activeTabId ?? '');
  const shown = sessionOfTab(activeTab(state.main));
  return (shown === null ? null : state.panelBySession.get(shown)?.activeTabId) ?? SUMMARY_CARD_KEY;
}

// ---- the pill's state, the raise, focus into a split card -------------------------------------------------------------

// What the card is: the panel's float, or the split's floating session tab; the pill resets with it (a float, a dock, a
// tab set coming back). The panel's card following focus from session to session is the same card.
const floatIdentity = (state: Layout): string | null => {
  if (state.regions.panel.floating) return 'panel';
  return splitFloat(state.main) === null ? null : (currentSet(state.main).floating?.sessionTabId ?? null);
};
useLayout.subscribe((state, before) => {
  // Removing the last surface docks in the layout store, without a Dock button's handoff. Carry the same session
  // back to its ordinary pane before React remounts its transcript and composer.
  if (before.regions.panel.floating && !state.regions.panel.floating && !hasPanelSurface(state)) {
    const tab = activeTab(state.main);
    if (tab?.kind === 'session' && cardSession(before) === tab.appSessionId) {
      markTranscriptCarry(tab.appSessionId);
      markFocusOnMount(tab.appSessionId);
    }
  }
  if (floatIdentity(state) !== floatIdentity(before) && useFloatingCard.getState().closed) useFloatingCard.setState({ closed: false, pillTakesFocus: false });
});

// A compact composer still stands for S for keyboard actions, but typing in it is not a request to expand. Only its
// synchronous pane-focus update skips the raise; sidebar/tab selection and attention navigation keep their behavior.
let focusingCompact = false;
export function focusCompactCard(): void {
  const split = cardHost(useLayout.getState()) === 'split' ? splitFloat(useLayout.getState().main) : null;
  if (split === null) return;
  focusingCompact = true;
  try {
    useLayout.getState().focusPane(split.pane);
  } finally {
    focusingCompact = false;
  }
}

// P4-B3 (its Decision Log 7): the split's card stands for S. While it is a pill, the focused pane moving to S (a sidebar
// click on S's session, attention navigation, ⌘⇧\) opens it, and its composer takes the keyboard.
useLayout.subscribe((state, before) => {
  if (focusingCompact || !useFloatingCard.getState().closed || cardHost(state) !== 'split' || state.main.current !== before.main.current) return;
  const split = splitFloat(state.main);
  if (split !== null && currentSet(state.main).focusedPane === split.pane && currentSet(before.main).focusedPane !== split.pane) openCard();
});

// P4-B3 (its Decision Log 13; Codex: elicitations force its card open (source); a command approval did not (LC-3, live)):
// a pill opens when its session gains an open request that asks for an answer (the kinds the composer docks), one no
// pending list held before. A pill closed while that request is still pending stays closed for it; the next new one
// raises it again. It hands over the keyboard only when the departing compact surface owned it.
const RAISING: ReadonlySet<AttentionKind> = new Set<AttentionKind>(['permission', 'question', 'plan', 'elicitation', 'dialog']);
let raised: { session: AppSessionId | null; ids: ReadonlySet<string> } = { session: null, ids: new Set() };
function raiseOnRequest(): void {
  const session = cardSession(useLayout.getState());
  const items = session === null ? [] : selectPendingOf(useAttention.getState(), session);
  const ids = new Set(items.filter((item) => RAISING.has(item.kind)).map((item) => item.id as string));
  const fresh = session !== null && session === raised.session && [...ids].some((id) => !raised.ids.has(id));
  raised = { session, ids };
  if (fresh && useFloatingCard.getState().closed) {
    const compact = document.activeElement?.closest<HTMLElement>('[data-compact-session]');
    if (session !== null && compact?.dataset.compactSession === session) markFocusOnMount(session);
    useFloatingCard.getState().setClosed(false);
  }
}
useAttention.subscribe(raiseOnRequest);
useLayout.subscribe(raiseOnRequest);

// P3-F wave S (F6, candidate 58): the card draws the shown session, so with none (an artifact, Settings or an empty pane
// in front) a floating panel took main's place with nothing over it: main at 0 px, its tab strip gone until Dock. Float
// therefore refuses with no shown session (the header's button disabled, the action and the divider saying why), and a
// float that meets none docks: one restored over such a tab, or one such a tab came in front of (⌘, opens Settings over
// the card). Refused, not kept docked while `floating` stays stored: every reader of the panel's place reads `regions`
// alone (`panelInMain`), and a stored float would come back unasked the next time a session's tab is in front.
export const FLOAT_COPY = { noSession: 'Select a session’s tab to float it', noSurface: 'Open a tool surface to float the chat over it' };

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

// ---- the card's size (§D1.4) -------------------------------------------------------------------------------------------

export const CARD_MARGIN = 16; // from the region body's right and bottom edges, and the least room kept on every side
export const CARD_MIN = { w: 360, h: 240 };
// The default per region. The panel's card: 420 × min(60 % of its body, 640) (P3-G §D1.4). The main split's: 560 × 640,
// Codex's floating chat (LC-3, 2026-10-21: seen 560 wide, and as tall as its window allowed), the main area being wide.
const CARD_DEFAULT: Record<CardHost, { w: number; h: number; heightShare: number }> = {
  panel: { w: 420, h: 640, heightShare: 0.6 },
  split: { w: 560, h: 640, heightShare: 1 },
};

// The card's size in a body of `bounds` (the panel region under its header, or the main area's content row): the stored
// size, else the region's default; no smaller than the minimum unless the body is, no larger than the body less the
// margins.
export function placeCard(stored: FloatingCardSize | undefined, bounds: { width: number; height: number }, host: CardHost = 'panel'): FloatingCardSize {
  const fit = (value: number, min: number, max: number) => Math.round(Math.max(Math.min(min, max), Math.min(value, max)));
  const d = CARD_DEFAULT[host];
  const base = stored ?? { w: d.w, h: Math.min(bounds.height * d.heightShare, d.h) };
  return { w: fit(base.w, CARD_MIN.w, bounds.width - 2 * CARD_MARGIN), h: fit(base.h, CARD_MIN.h, bounds.height - 2 * CARD_MARGIN) };
}

// ---- the room a native-view pane leaves the card (§D3) -----------------------------------------------------------------

// A page is a native view, drawn over the DOM: the card cannot float over it. The pane showing one under the card leaves
// the card a column at its right instead (the page live beside it; P4-B3, its Decision Log 9 and 26: the column follows
// the card to the right); the pill moves into the browser's chrome row (the coordinator's ruling on P3-G M2: the page
// keeps its full height). The panel's pane does this under the panel's card, a main tab's pane under the split's.
export const COLUMN_PAGE_MIN = 280; // the page keeps at least this much beside the column
// The column's default width over either surface: P3-G's 420 (LC-3 kept it: Codex's 560 is a chat card's width, and a
// page should not lose more of itself to the column).
const COLUMN_DEFAULT_W = 420;

// The region a pane of `surface` lies in has a card up: the panel's pane under the panel's card, a main pane under the
// split's.
const hostOf = (surface: 'panel' | 'main'): CardHost => (surface === 'panel' ? 'panel' : 'split');
export const cardOver = (state: Layout, surface: 'panel' | 'main'): boolean => cardHost(state) === hostOf(surface);

// The column the open card asks of a `surface` pane under it (null while no card is open over that surface): the live
// drag's width, else the stored width of what the card sits over, else the column's default; never under the card's
// minimum (a width stored while the page's floor held the column narrower comes back to it once there is room).
export function useColumnWidth(surface: 'panel' | 'main'): number | null {
  const up = useLayout((s) => cardOver(s, surface));
  const stored = useLayout((s) => s.regions.floatingCard[cardSizeKey(s)]?.w);
  const closed = useFloatingCard((s) => s.closed);
  const drag = useFloatingCard((s) => s.columnDrag);
  return up && !closed ? Math.max(CARD_MIN.w, drag ?? stored ?? COLUMN_DEFAULT_W) : null;
}

// ---- transitions (§D1.2) ----------------------------------------------------------------------------------------------

const layout = () => useLayout.getState();
const shown = () => sessionOfTab(activeTab(layout().main));


// Floats the panel from any state; the card's composer takes the keyboard when it mounts. `width` is the divider drag's
// restore value (§D1.6); nothing else writes the width, so docking brings the column back as it was. With no shown
// session it floats nothing and says why (P3-F wave S, F6): the action and the divider have no button to disable. A
// refused drag still puts its start back: the divider wrote its maximum on the way past it. P4-B3 (its Decision Log 8):
// one card at a time, so a floating split docks first.
export function floatPanel(patch: { width?: number } = {}): void {
  const session = shown();
  if (session === null || !hasPanelSurface(layout())) {
    if (patch.width !== undefined) layout().setPanel({ width: patch.width });
    toast({ id: 'panel-float-no-session', level: 'info', text: session === null ? FLOAT_COPY.noSession : FLOAT_COPY.noSurface, actions: [], dismissible: true });
    return;
  }
  // The split's card goes back into its pane with focus left where it is (the panel's card shows the focused pane's
  // session): S's transcript remounts there, so it carries its scroll.
  const split = splitFloat(layout().main);
  if (split !== null) {
    markTranscriptCarry(split.appSessionId);
    layout().dockSplit();
  }
  markFocusOnMount(session);
  // The carry only from the session's own tab: a file tab of it has no transcript of it mounted to come back from, and
  // the mark would wait for whatever mount of it came next (as `dockPanel` marks).
  if (activeTab(layout().main)?.kind === 'session') markTranscriptCarry(session);
  layout().setPanel({ ...patch, floating: true });
}

// Docks a floating panel; the main pane's remounted composer takes the keyboard (when the focused tab is the session's
// own: a file tab of it mounts no composer, and an unconsumed mark would steal focus later) and its transcript comes back
// where the card's was.
export function dockPanel(): void {
  const tab = activeTab(layout().main);
  if (tab?.kind === 'session') {
    markFocusOnMount(tab.appSessionId);
    markTranscriptCarry(tab.appSessionId);
  }
  layout().setPanel({ floating: false });
}

// P4-B3 (X37; its Decision Log 4, 7, 8): the split's pane showing session tab `sessionTabId` yields into the card, the
// ratio untouched (Dock returns it). The card stands for S: S's pane is focused (the panel shows S's session, ⌘W closes
// it) and its composer takes the keyboard. A panel standing in main docks first, so the card is seen. False, and nothing
// changed, when that tab is not the active session of a pane in a two-pane set (or floating it would move the float to
// the other pane, which docks: its Decision Log 28). P4-B3x: `foldPanel` (Expand's) also folds an open right panel, so
// the widened pane has the width a document's margin cards need; the float's end opens it again (the store's
// `reconcileFold`).
export function floatSplit(sessionTabId: string, opts: { foldPanel?: boolean } = {}): boolean {
  const split = splitFloat(floatedMain(layout().main, sessionTabId));
  if (split === null) return false;
  if (panelInMain(layout().regions)) layout().revealMain();
  markFocusOnMount(split.appSessionId);
  markTranscriptCarry(split.appSessionId);
  layout().floatSplit(sessionTabId, opts);
  layout().focusPane(split.pane);
  return true;
}

// The card's Dock for the split: S comes back beside A at the ratio of the drag's start, focused, its composer taking
// the keyboard and its transcript where the card's was.
export function dockSplit(): void {
  const split = splitFloat(layout().main);
  if (split === null) return;
  markFocusOnMount(split.appSessionId);
  markTranscriptCarry(split.appSessionId);
  layout().dockSplit();
  layout().focusPane(split.pane);
}

// The card's Dock, whichever card it is.
export function dockCard(): void {
  if (cardHost(layout()) === 'split') dockSplit();
  else dockPanel();
}

// The card's Close: its pill (the layer's, or a browser chrome's row's) takes the keyboard the Close button held. The
// split's card no longer stands for S once it is a pill: the focused pane goes to A, which is what is on screen.
export function closeCard(): void {
  useFloatingCard.setState({ closed: true, pillTakesFocus: true });
  const split = cardHost(layout()) === 'split' ? splitFloat(layout().main) : null;
  if (split !== null) layout().focusPane(otherPane(split.pane));
}

// The pill: the card comes back, its composer taking the keyboard; the split's card stands for S again.
export function openCard(): void {
  const session = cardSession(layout());
  if (session !== null) markFocusOnMount(session);
  useFloatingCard.getState().setClosed(false);
  const split = cardHost(layout()) === 'split' ? splitFloat(layout().main) : null;
  if (split !== null) layout().focusPane(split.pane);
}

// `panel.float` (⌥⌘B, the header's Float): floats a panel that is not floating (refused with no session to show); on a
// floating one, brings a closed card back, else docks (and docks when there is no session to show). P4-B3 (its Decision
// Log 8): with the split's card up it docks that card and does nothing else; a second press floats the panel.
export function togglePanelFloat(): void {
  if (cardHost(layout()) === 'split') dockSplit();
  else if (!isFloating(layout().regions)) floatPanel();
  else if (useFloatingCard.getState().closed && shown() !== null) openCard();
  else dockPanel();
}

// P4-B3 (X32 amendment; its Decision Log 12): `main.expandArtifactPane` and the pane header's Expand. On a pane beside a
// session, folds that session into its compressed composer; on a floating split, docks it ("Restore split"); else
// says why, as the panel's Float does. P4-B3x (P4 Decision Log 40): Expand also folds an open right panel, which
// Restore split (or any end of the float) opens again unless the owner opened it meanwhile. The divider's drag to
// float folds nothing: it moves the split's own edge, not the panel's.
export const EXPAND_COPY = { noSession: 'Open a session in the other pane to expand this one' };
export function expandPane(pane: 0 | 1 = currentSet(layout().main).focusedPane): void {
  if (splitFloat(layout().main) !== null) return dockSplit();
  const set = currentSet(layout().main);
  const other = otherPane(pane);
  const beside = set.panes.length === 2 && paneShowsSession(set, other) ? set.panes[other]?.activeTabId : null;
  if (beside && floatSplit(beside, { foldPanel: true })) {
    // Expand gives the document the main area, not another full conversation column.
    // Keep floatSplit's composer focus handoff; Close would instead focus the title.
    useFloatingCard.getState().setClosed(true);
    return;
  }
  toast({ id: 'expand-pane-refused', level: 'info', text: EXPAND_COPY.noSession, actions: [], dismissible: true });
}

// ⌘⇧\ into the split's card: S's pane is focused (which opens a pill, above) and the card's composer takes the keyboard.
export function focusSplitCard(): void {
  const split = splitFloat(layout().main);
  if (split === null) return;
  // A compact composer is still registered until React swaps it for the expanded pane.
  // Let openCard's mount handoff focus the replacement, not the departing composer.
  if (useFloatingCard.getState().closed) return openCard();
  layout().focusPane(split.pane);
  useComposerStore.getState().focusTargets.get(split.appSessionId)?.focusFrame();
}
