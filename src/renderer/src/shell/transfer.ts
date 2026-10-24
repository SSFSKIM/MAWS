// Cross-surface transfer (P4-B3, M4; parent §4.5 *Cross-surface tab transfer*, X38; its Decision Log 16 to 21; the prior
// art's §4.3): an artifact moves between a main tab and the panel's Artifacts tool, by a drag, a menu item or a keymap
// action, every path through the two operations here and the one refusal they share. A move never adds a view and never
// leaves the artifact nowhere (INV-1, INV-2): there is no copy by drag (the owner's ruling, parent Decision Log 6), and the
// source lets go only once the target can take the artifact.
//
// The editor's state travels with the artifact (the registry's hand-off, Decision Log 19): the source's hold is staged,
// the source lets go without its close guard (nothing can be lost: the replica with every typed edit moves), and the
// target adopts the hold, all in one synchronous run after the last await. Only a guard of something else the move
// displaces is asked, before that run: the panel's other record (T3, T4), or the source itself when the target already
// shows the artifact and that view is activated instead (T5, T8; a cancelled dialog is a refusal, C4). That view keeps
// its own editor, so the source's guard is asked as a move's (`moving`: its unsent comment travels); once the re-checks
// after it pass, the comment is handed to that view and the source closes in one synchronous run (Decision Log 39), so
// a refusal at the guard or the re-checks has changed nothing.
//
// The drag state (`dragging` in the layout store) is set at `dragstart` and cleared at `drop` and `dragend`, both heard on
// `window` too, and by a source that unmounts mid-drag (INV-5). Targets decide acceptance from it (a `dragover` cannot
// read the payload) and act on the payload at `drop`. While it is set, the browser cover is held (Decision Log 39), so
// no page's native view covers a target.
import { useSyncExternalStore, type DragEvent } from 'react';
import { library, libraryRow } from '../library/store';
import type { AppSessionId } from '@shared/graph/ids';
import { tabId as mainTabIdOf, type PanelTabRef, type TabRef } from '@shared/ipc/schema/layout';
import { ARTIFACTS_TOOL_ID } from '@shared/maws/panes';
import { adoptStagedArtifactEditorState, handArtifactViewOver, heldArtifactEditorState, stageArtifactEditorState } from '../artifacts/registry';
import { askEditorHostClose, type CloseAsk, type EditorHostScope } from '../panel/editor-host';
import { instanceOf, panelHost, usePanelHost } from '../panel/host';
import { surfaceSession } from '../panel/surface-model';
import { useLayout, type LayoutState } from '../stores/layout';
import { toast } from '../stores/notices';
import { activeTab, allTabs, currentSet, locateTab } from '../stores/layout-model';
import type { ArtifactsHandle } from '../tools/artifacts/ArtifactsTool';
import { TRANSFER_COPY } from '../tools/artifacts/copy';
import { withdrawVersionRequest } from '../tools/artifacts/viewers/requests'; // P4-B4: a stale main ask goes with a move
import { holdCover } from '../tools/browser/covering'; // Decision Log 39
import { markTranscriptCarry } from '../transcript/view/scroll-carry'; // P4-B3 M5 (S6)

export const TAB_DRAG_TYPE = 'application/x-maws-tab'; // a main tab's id
export const PANEL_TAB_DRAG_TYPE = 'application/x-maws-panel-tab'; // a panel tab's `{toolId, tabId}`, as JSON

export type Dragging = NonNullable<LayoutState['dragging']>;
type Pane = 0 | 1;

// Where a move to a main tab lands: a pane and an index in its strip as the drop saw it (the tab not in it); no pane is
// the focused one, no index appends (a menu appends, INV-6).
export interface TabPlace {
  pane?: Pane;
  index?: number;
}
export type TransferRequest = { to: 'panel'; mainTabId: string } | ({ to: 'tab'; panelTabId: string } & TabPlace);

const layout = () => useLayout.getState();

// ---- the panel side ------------------------------------------------------------------------------------------------------

// The loaded Library row owns the artifact's project; an unprojected artifact uses its containing tab set. Show
// beside that project's most recently used chat, not the Library/document its close would activate. A remembered
// context is eligible only while that project's set still holds its actual session tab.
function panelSessionForArtifact(mainTabId: string): AppSessionId | null {
  const state = layout();
  const at = locateTab(state.main, mainTabId);
  if (!at) return null;
  const tab = state.main.sets[at.set]?.panes[at.pane]?.tabs[at.index];
  if (tab?.kind !== 'artifact') return null;
  const project = libraryRow(library.getState(), tab.artifactId).value?.project?.id ?? at.set;
  const main = { ...state.main, current: project };
  const sessions = currentSet(main).panes.flatMap((pane) => pane.tabs.flatMap((tab) => tab.kind === 'session' ? [tab.appSessionId] : []));
  return surfaceSession({ ...state, main, knownSession: (session) => state.knownSession(session) && sessions.includes(session) });
}

// The Artifacts tab `openArtifactInPanel` lands in for a session (the pins first; no session: a pinned one).
const artifactsTabOf = (appSessionId: AppSessionId | null): PanelTabRef | undefined =>
  (appSessionId === null ? layout().panelPinned : layout().panelTabsOf(appSessionId)).find((t) => t.toolId === ARTIFACTS_TOOL_ID);

const artifactsHandleOf = (panelTabId: string): ArtifactsHandle | null => {
  const instance = instanceOf(panelTabId);
  return instance?.tool.id === ARTIFACTS_TOOL_ID ? (instance.state as ArtifactsHandle) : null;
};

// The artifact a panel tab's Artifacts instance shows as a record; null for the list, any other tool or no instance.
export function panelRecordOf(panelTabId: string): string | null {
  const view = artifactsHandleOf(panelTabId)?.snapshot().view;
  return view?.kind === 'record' ? view.artifactId : null;
}

// Whether `openArtifactInPanel` has a panel to show the artifact in (P3-F wave S, F16): a session's panel, or with none
// a pinned Artifacts tab, while a build registers the tool.
export const canShowArtifactInPanel = (
  appSessionId: AppSessionId | null,
  pinned: PanelTabRef[] = layout().panelPinned,
  registered = usePanelHost.getState().tools.has(ARTIFACTS_TOOL_ID),
): boolean => registered && (appSessionId !== null || pinned.some((t) => t.toolId === ARTIFACTS_TOOL_ID));

// P3-F wave S (F16 review): before an artifact moves in from elsewhere, the Artifacts tab it would land in lets go of
// another artifact it shows, through that record's guard, so a guard keeping it refuses the move before the source lets
// go. True when the tab is free (or there is none yet).
export function freePanelFor(appSessionId: AppSessionId | null, artifactId: string): Promise<boolean> {
  const ref = artifactsTabOf(appSessionId);
  const handle = ref ? artifactsHandleOf(ref.id) : null;
  const shown = ref ? panelRecordOf(ref.id) : null;
  if (!handle || shown === null || shown === artifactId) return Promise.resolve(true);
  return handle.backAsked();
}

// ---- the one refusal ------------------------------------------------------------------------------------------------------

// Why the move cannot happen now, or null: read by the drop targets (a refused target never accepts the drag), the menu
// items (disabled, the reason their title) and the keymap actions (a toast), so all of them refuse alike (M5).
export function transferRefusal(request: TransferRequest): string | null {
  const closing = usePanelHost.getState().closing;
  if (request.to === 'panel') {
    const tab = allTabs(layout().main).find((t) => t.id === request.mainTabId);
    if (tab?.kind !== 'artifact') return TRANSFER_COPY.notArtifact;
    if (libraryRow(library.getState(), tab.artifactId).value == null) return TRANSFER_COPY.loading;
    const session = panelSessionForArtifact(request.mainTabId);
    if (session === null) return TRANSFER_COPY.noProjectSession;
    if (!canShowArtifactInPanel(session)) return TRANSFER_COPY.noPanel;
    const dest = artifactsTabOf(session);
    return dest && closing.has(dest.id) ? TRANSFER_COPY.closing : null;
  }
  if (panelRecordOf(request.panelTabId) === null) return TRANSFER_COPY.noRecord;
  return closing.has(request.panelTabId) ? TRANSFER_COPY.closing : null;
}

// The refusal for a render, re-read whenever the layout or the panel host changes (a record shown or left changes the
// tool's persisted params, so the layout store hears it too).
const subscribeTransfer = (listener: () => void) => {
  const offLayout = useLayout.subscribe(listener);
  const offHost = usePanelHost.subscribe(listener);
  const offLibrary = library.subscribe(listener);
  return () => {
    offLayout();
    offHost();
    offLibrary();
  };
};
export const useTransferRefusal = (request: TransferRequest | null): string | null =>
  useSyncExternalStore(subscribeTransfer, () => (request === null ? null : transferRefusal(request)));
export const usePanelRecord = (panelTabId: string): string | null => useSyncExternalStore(subscribeTransfer, () => panelRecordOf(panelTabId));

// The panel tabs that move to main: the Artifacts tool's (Decision Log 17; no other tool has a main tab kind).
export const panelTabMoves = (tab: PanelTabRef): boolean => tab.toolId === ARTIFACTS_TOOL_ID;

// ---- the moves -----------------------------------------------------------------------------------------------------------

// The guard of a source an activate-existing move closes (T5, T8; X32's editor closeGuard; an artifact tab has no kind
// guard), asked as a move's: what its editor hands over goes to the view kept. True when it may close.
const MOVING: CloseAsk = { moving: true };
async function movingGuardAllows(source: EditorHostScope): Promise<boolean> {
  const asked = askEditorHostClose(source, MOVING);
  return asked === null || (await asked);
}

// Main → panel (T1 to T5, T16 to T20; "Show in panel", `artifact.moveToPanel`, a drop on the panel). True when the
// artifact moved or the panel's view of it was activated; false when refused or cancelled, everything as it was.
export async function moveArtifactToPanel(mainTabId: string): Promise<boolean> {
  if (transferRefusal({ to: 'panel', mainTabId }) !== null) return false;
  const tab = allTabs(layout().main).find((t) => t.id === mainTabId) as Extract<TabRef, { kind: 'artifact' }>;
  const { artifactId } = tab;
  const session = panelSessionForArtifact(mainTabId);
  const dest = artifactsTabOf(session);
  if (dest && panelRecordOf(dest.id) === artifactId) {
    // T5: the panel shows it already. That view is activated, unmounted nothing, and the tab closes through its guard,
    // its unsent comment handed to the panel's view as it closes.
    const source: EditorHostScope = { surface: 'main', tabId: mainTabId };
    const held = heldArtifactEditorState(source);
    if (!(await movingGuardAllows(source))) return false;
    if (transferRefusal({ to: 'panel', mainTabId }) !== null || panelSessionForArtifact(mainTabId) !== session || panelRecordOf(dest.id) !== artifactId || heldArtifactEditorState(source) !== held) return false;
    handArtifactViewOver(source, { surface: 'panel', tabId: dest.id }); // synchronous from here to the close
    layout().closeTab(mainTabId, { remember: false }); // a move is not a close (Decision Log 32): no ⌘⇧T entry
    layout().activateTab(mainTabIdOf({ kind: 'session', appSessionId: session! }));
    panelHost.selectTab(dest.id);
    return true;
  }
  if (!(await freePanelFor(session, artifactId))) return false;
  // After the guard: the panel the tab would land in is the one shown now (it may have changed while the guard asked).
  if (transferRefusal({ to: 'panel', mainTabId }) !== null) return false;
  const now = panelSessionForArtifact(mainTabId);
  if (now === null) return false;
  const there = artifactsTabOf(now);
  const shown = there ? panelRecordOf(there.id) : null;
  if (shown === artifactId) return moveArtifactToPanel(mainTabId); // it came to show the artifact meanwhile: T5
  if (shown !== null) return false; // it came to show another one: nothing moved
  // The hand-off, synchronous from here to the adoption.
  stageArtifactEditorState({ surface: 'main', tabId: mainTabId });
  layout().closeTab(mainTabId, { remember: false });
  layout().activateTab(mainTabIdOf({ kind: 'session', appSessionId: now }));
  // `carried`: the editor's state comes with it, so the record asks its viewer for no version (it keeps the one it shows).
  const panelTabId = panelHost.addTool(ARTIFACTS_TOOL_ID, { appSessionId: now, params: { target: artifactId, carried: true }, activate: true });
  // A tab reserved before the layout is read has no instance yet (its id may change at the barrier): the staged state
  // is then left to the sweep, and the record makes its own.
  if (instanceOf(panelTabId)) adoptStagedArtifactEditorState(artifactId, { surface: 'panel', tabId: panelTabId });
  return true;
}

// Panel → main (T7 to T10; "Move to tab", "Move to main area", `artifact.moveToTab`, a drop on a strip, a pane's body
// or the right edge). The same answer as `moveArtifactToPanel`.
export async function moveArtifactToTab(panelTabId: string, at: TabPlace = {}): Promise<boolean> {
  const request: TransferRequest = { to: 'tab', panelTabId, ...at };
  if (transferRefusal(request) !== null) return false;
  const handle = artifactsHandleOf(panelTabId)!;
  const artifactId = panelRecordOf(panelTabId)!;
  const mainTabId = mainTabIdOf({ kind: 'artifact', artifactId });
  if (locateTab(layout().main, mainTabId)) {
    // T8: main shows it already. That tab is placed and activated; the record goes Back through its guard, its unsent
    // comment handed to main's view as it goes.
    const source: EditorHostScope = { surface: 'panel', tabId: panelTabId };
    const held = heldArtifactEditorState(source);
    if (!(await movingGuardAllows(source))) return false;
    if (transferRefusal(request) !== null || panelRecordOf(panelTabId) !== artifactId || heldArtifactEditorState(source) !== held) return false;
    if (locateTab(layout().main, mainTabId)) {
      handArtifactViewOver(source, { surface: 'main', tabId: mainTabId }); // synchronous from here to the Back
      handle.handOff(); // the guard was asked: the record's state is given back
      placeInMain(artifactId, at);
      return true;
    }
    // Main lost its tab while the guard asked: the record moves after all, its comment with its state.
  }
  // The hand-off, synchronous from here to the adoption.
  stageArtifactEditorState({ surface: 'panel', tabId: panelTabId });
  if (!handle.handOff()) {
    adoptStagedArtifactEditorState(artifactId, { surface: 'panel', tabId: panelTabId });
    return false;
  }
  placeInMain(artifactId, at);
  adoptStagedArtifactEditorState(artifactId, { surface: 'main', tabId: mainTabId });
  return true;
}

// Shows the artifact's main tab at `at`, opening it if main has none (the main area brought back if a maximized or
// floating panel stood in it). With no pane, an open tab is activated where it is; a new one appends to the focused pane.
// P4-B4 (the B3 merge's review): the move carries the viewer's state, so an ask left for that artifact's main viewer (a
// link's open whose tab went before its editor took it) goes, as the carried panel open withdraws the panel's.
function placeInMain(artifactId: string, at: TabPlace): void {
  withdrawVersionRequest(artifactId, 'main');
  const id = mainTabIdOf({ kind: 'artifact', artifactId });
  const before = currentSet(layout().main).panes.findIndex((p) => p.tabs.some((t) => t.id === id));
  layout().revealMain();
  layout().openTab({ kind: 'artifact', artifactId }, { pane: at.pane ?? 'focused' });
  if (at.pane === undefined && before !== -1) return;
  const set = currentSet(layout().main);
  // The pane asked for (pane 1 made if absent, as the right edge asks), else the one the open placed it in.
  const pane = at.pane ?? (set.panes.findIndex((p) => p.tabs.some((t) => t.id === id)) as Pane);
  moveMainTab(id, pane, at.index ?? set.panes[pane]?.tabs.length ?? 0, before === pane);
}

// Moves a main tab to `index` of `pane`'s strip; `counted` when the index was counted with the tab in that strip (a
// reorder, which TabStrip's drop does), so a move rightwards lands where the pointer was.
export function moveMainTab(id: string, pane: Pane, index: number, counted: boolean): void {
  const from = currentSet(layout().main).panes[pane]?.tabs.findIndex((t) => t.id === id) ?? -1;
  layout().moveTab(id, pane, counted && from !== -1 && from < index ? index - 1 : index);
}

// P4-B3 M5 (S6; X38's carry for a session tab): a session tab moved between panes (a drag, ⌘\, the right edge) is the
// same session, its process untouched, but its transcript remounts in the other pane, so the move marks the transcript's
// next mount to come back where the reader was (Decision Log 14's carry, which only the cards' transitions mark
// otherwise); the draft is the session's and comes back by itself. Only a tab shown before and after: one that was not
// shown left no place of its own, and a tab switch keeps opening at the end.
useLayout.subscribe((state, before) => {
  if (state.main === before.main || state.main.current !== before.main.current) return;
  const was = currentSet(before.main).panes;
  currentSet(state.main).panes.forEach((pane, index) => {
    const tab = pane.tabs.find((t) => t.id === pane.activeTabId);
    if (tab?.kind !== 'session') return;
    const from = was.findIndex((p) => p.activeTabId === tab.id);
    if (from !== -1 && from !== index) markTranscriptCarry(tab.appSessionId);
  });
});

// The keymap actions (M4; no default chords): the focused main tab into the panel, and the shown panel's Artifacts record
// into a main tab (its selected tab when that is one, else the first the panel lists). A refusal says why in a toast.
export function moveFocusedArtifactToPanel(): void {
  const tab = activeTab(layout().main);
  const refusal = tab ? transferRefusal({ to: 'panel', mainTabId: tab.id }) : TRANSFER_COPY.notArtifact;
  if (refusal !== null || !tab) return refused(refusal ?? TRANSFER_COPY.notArtifact);
  void moveArtifactToPanel(tab.id);
}

export function moveShownRecordToTab(): void {
  const shown = surfaceSession(layout());
  const selected = shown === null ? layout().panelActiveNoSession : (layout().panelBySession.get(shown)?.activeTabId ?? null);
  const tabs = layout().effectivePanelTabs(shown).filter(panelTabMoves);
  const tab = tabs.find((t) => t.id === selected) ?? tabs[0];
  const refusal = tab ? transferRefusal({ to: 'tab', panelTabId: tab.id }) : TRANSFER_COPY.noRecord;
  if (refusal !== null || !tab) return refused(refusal ?? TRANSFER_COPY.noRecord);
  void moveArtifactToTab(tab.id);
}

const refused = (text: string) => void toast({ id: 'transfer-refused', level: 'info', text, actions: [], dismissible: true });

// ---- the drag ------------------------------------------------------------------------------------------------------------

// Decision Log 39 (3): a Browser page is a native view drawn above the whole renderer, so a drop target over a pane or
// the panel showing one (a body, the right edge) would lie under it, out of the pointer's reach. While a drag is on, the
// window's browser cover is held (the pages show their pictures, as under the Overview); it is released as the drag
// state clears, by whichever path the drag ends (a drop, `dragend`, Escape, the source unmounting).
let releaseCover: (() => void) | null = null;
useLayout.subscribe(({ dragging }) => {
  if ((dragging !== null) === (releaseCover !== null)) return;
  if (dragging !== null) releaseCover = holdCover();
  else {
    const release = releaseCover;
    releaseCover = null;
    release?.();
  }
});

const clearOnWindow = () => endDrag();

// A drag starts: its payload, `effectAllowed = 'move'` (move only), and the drag state, cleared when it ends anywhere.
export function beginDrag(event: DragEvent, dragging: Dragging): void {
  if (dragging.source === 'main') event.dataTransfer.setData(TAB_DRAG_TYPE, dragging.tabId);
  else event.dataTransfer.setData(PANEL_TAB_DRAG_TYPE, JSON.stringify({ toolId: dragging.toolId, tabId: dragging.tabId }));
  event.dataTransfer.effectAllowed = 'move';
  layout().setDragging(dragging);
  window.addEventListener('drop', clearOnWindow);
  window.addEventListener('dragend', clearOnWindow);
}

export function endDrag(): void {
  window.removeEventListener('drop', clearOnWindow);
  window.removeEventListener('dragend', clearOnWindow);
  if (layout().dragging !== null) layout().setDragging(null);
}

// A drag source unmounting mid-drag (its `dragend` then reaches no listener): the drag it started ends with it.
export function endDragFrom(source: Dragging['source'], tabId: string): void {
  const dragging = layout().dragging;
  if (dragging?.source === source && dragging.tabId === tabId) endDrag();
}

// The panel tab a drop carries, read at `drop`.
export function panelTabOfDrop(event: DragEvent): { toolId: string; tabId: string } | null {
  try {
    const value: unknown = JSON.parse(event.dataTransfer.getData(PANEL_TAB_DRAG_TYPE));
    const { toolId, tabId } = (value ?? {}) as { toolId?: unknown; tabId?: unknown };
    return typeof toolId === 'string' && typeof tabId === 'string' ? { toolId, tabId } : null;
  } catch {
    return null;
  }
}

// A panel record dropped on a main target (a strip, a pane's body, the right edge) moves to `at`.
export function dropPanelRecord(event: DragEvent, at: TabPlace): void {
  const payload = panelTabOfDrop(event);
  if (payload) void moveArtifactToTab(payload.tabId, at);
}

// Whether the drag under way is one a kind of target takes (a refused drag finds no target there). The panel takes an
// artifact main tab its refusal allows; main's strips and panes' bodies a panel record; the right edge opens a second
// pane beside a tab: a panel record when main shows one (an empty main has nothing to split beside), a main tab when
// its pane keeps another (T16: never the only tab of the only pane).
export type DropTargetKind = 'panel' | 'main' | 'edge';
export function dragAccepted(where: DropTargetKind, dragging: Dragging | null = layout().dragging): boolean {
  if (dragging === null) return false;
  const panes = currentSet(layout().main).panes;
  if (dragging.source === 'panel') {
    if (where === 'panel' || transferRefusal({ to: 'tab', panelTabId: dragging.tabId }) !== null) return false;
    return where === 'main' || panes.some((p) => p.tabs.length > 0);
  }
  if (where === 'panel') return transferRefusal({ to: 'panel', mainTabId: dragging.tabId }) === null;
  return where === 'edge' && (panes[dragging.fromPane]?.tabs.length ?? 0) > 1;
}
export const useDragAccepted = (where: DropTargetKind): boolean => useSyncExternalStore(subscribeTransfer, () => dragAccepted(where));

// A layer over a surface's content (the panel; a main pane's body) during every drag from the other surface: 'accepted'
// when the transfer takes it there, 'refused' otherwise, null with no such drag. The layer covers the content for a
// refused drag too, so content that takes every drag (an editable document) never shows it a drop cursor (Z2, M5).
export type CoverState = 'accepted' | 'refused' | null;
export function coverState(where: 'panel' | 'main', dragging: Dragging | null = layout().dragging): CoverState {
  if (dragging === null || dragging.source === where) return null;
  return dragAccepted(where, dragging) ? 'accepted' : 'refused';
}
export const useCoverState = (where: 'panel' | 'main'): CoverState => useSyncExternalStore(subscribeTransfer, () => coverState(where));
