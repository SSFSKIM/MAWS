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
// shows the artifact and that view is activated instead (T5, T8; a cancelled dialog is a refusal, C4).
//
// The drag state (`dragging` in the layout store) is set at `dragstart` and cleared at `drop` and `dragend`, both heard on
// `window` too, and by a source that unmounts mid-drag (INV-5). Targets decide acceptance from it (a `dragover` cannot
// read the payload) and act on the payload at `drop`.
import { useSyncExternalStore, type DragEvent } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { tabId as mainTabIdOf, type PanelTabRef, type TabRef } from '@shared/ipc/schema/layout';
import { ARTIFACTS_TOOL_ID } from '@shared/maws/panes';
import { adoptStagedArtifactEditorState, stageArtifactEditorState } from '../artifacts/registry';
import { askEditorHostClose } from '../panel/editor-host';
import { instanceOf, panelHost, usePanelHost } from '../panel/host';
import { useLayout, type LayoutState } from '../stores/layout';
import { toast } from '../stores/notices';
import { activeTab, allTabs, closeTab, currentSet, locateTab, sessionOfTab } from '../stores/layout-model';
import type { ArtifactsHandle } from '../tools/artifacts/ArtifactsTool';
import { TRANSFER_COPY } from '../tools/artifacts/copy';

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

// The session whose panel shows once the main tab is gone (`closeTab`'s rule, T18): the one the focused pane shows next.
const panelSessionWithout = (mainTabId: string): AppSessionId | null => sessionOfTab(activeTab(closeTab(layout().main, mainTabId)));

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
    const session = panelSessionWithout(request.mainTabId);
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
  return () => {
    offLayout();
    offHost();
  };
};
export const useTransferRefusal = (request: TransferRequest | null): string | null =>
  useSyncExternalStore(subscribeTransfer, () => (request === null ? null : transferRefusal(request)));
export const usePanelRecord = (panelTabId: string): string | null => useSyncExternalStore(subscribeTransfer, () => panelRecordOf(panelTabId));

// The panel tabs that move to main: the Artifacts tool's (Decision Log 17; no other tool has a main tab kind).
export const panelTabMoves = (tab: PanelTabRef): boolean => tab.toolId === ARTIFACTS_TOOL_ID;

// ---- the moves -----------------------------------------------------------------------------------------------------------

// A main tab's own guard (X32's editor closeGuard; an artifact tab has no kind guard): true when it may close.
async function mainGuardAllows(mainTabId: string): Promise<boolean> {
  const asked = askEditorHostClose({ surface: 'main', tabId: mainTabId });
  return asked === null || (await asked);
}

// Main → panel (T1 to T5, T16 to T20; "Show in panel", `artifact.moveToPanel`, a drop on the panel). True when the
// artifact moved or the panel's view of it was activated; false when refused or cancelled, everything as it was.
export async function moveArtifactToPanel(mainTabId: string): Promise<boolean> {
  if (transferRefusal({ to: 'panel', mainTabId }) !== null) return false;
  const tab = allTabs(layout().main).find((t) => t.id === mainTabId) as Extract<TabRef, { kind: 'artifact' }>;
  const { artifactId } = tab;
  const session = panelSessionWithout(mainTabId);
  const dest = artifactsTabOf(session);
  if (dest && panelRecordOf(dest.id) === artifactId) {
    // T5: the panel shows it already. That view is activated, unmounted nothing, and the tab closes through its guard.
    if (!(await mainGuardAllows(mainTabId))) return false;
    if (transferRefusal({ to: 'panel', mainTabId }) !== null || panelRecordOf(dest.id) !== artifactId) return false;
    layout().closeTab(mainTabId);
    panelHost.selectTab(dest.id);
    return true;
  }
  if (!(await freePanelFor(session, artifactId))) return false;
  // After the guard: the panel the tab would land in is the one shown now (it may have changed while the guard asked).
  if (transferRefusal({ to: 'panel', mainTabId }) !== null) return false;
  const now = panelSessionWithout(mainTabId);
  const there = artifactsTabOf(now);
  const shown = there ? panelRecordOf(there.id) : null;
  if (shown === artifactId) return moveArtifactToPanel(mainTabId); // it came to show the artifact meanwhile: T5
  if (shown !== null) return false; // it came to show another one: nothing moved
  // The hand-off, synchronous from here to the adoption.
  stageArtifactEditorState({ surface: 'main', tabId: mainTabId });
  layout().closeTab(mainTabId);
  const panelTabId = panelHost.addTool(ARTIFACTS_TOOL_ID, { appSessionId: now, pin: now === null, params: { target: artifactId }, activate: true });
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
    // T8: main shows it already. That tab is placed and activated; the record goes Back through its guard.
    const asked = askEditorHostClose({ surface: 'panel', tabId: panelTabId });
    if (asked !== null && !(await asked)) return false;
    if (transferRefusal(request) !== null || panelRecordOf(panelTabId) !== artifactId) return false;
    if (locateTab(layout().main, mainTabId)) {
      handle.handOff(); // the guard was asked: the record's state is given back
      placeInMain(artifactId, at);
      return true;
    }
    // Main lost its tab while the guard asked: the record moves after all.
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
function placeInMain(artifactId: string, at: TabPlace): void {
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

// The keymap actions (M4; no default chords): the focused main tab into the panel, and the shown panel's Artifacts record
// into a main tab (its selected tab when that is one, else the first the panel lists). A refusal says why in a toast.
export function moveFocusedArtifactToPanel(): void {
  const tab = activeTab(layout().main);
  const refusal = tab ? transferRefusal({ to: 'panel', mainTabId: tab.id }) : TRANSFER_COPY.notArtifact;
  if (refusal !== null || !tab) return refused(refusal ?? TRANSFER_COPY.notArtifact);
  void moveArtifactToPanel(tab.id);
}

export function moveShownRecordToTab(): void {
  const shown = sessionOfTab(activeTab(layout().main));
  const selected = shown === null ? layout().panelActiveNoSession : (layout().panelBySession.get(shown)?.activeTabId ?? null);
  const tabs = layout().effectivePanelTabs(shown).filter(panelTabMoves);
  const tab = tabs.find((t) => t.id === selected) ?? tabs[0];
  const refusal = tab ? transferRefusal({ to: 'tab', panelTabId: tab.id }) : TRANSFER_COPY.noRecord;
  if (refusal !== null || !tab) return refused(refusal ?? TRANSFER_COPY.noRecord);
  void moveArtifactToTab(tab.id);
}

const refused = (text: string) => void toast({ id: 'transfer-refused', level: 'info', text, actions: [], dismissible: true });

// ---- the drag ------------------------------------------------------------------------------------------------------------

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
// pane with either, a main tab only when its pane keeps another (T16: never the only tab of the only pane).
export type DropTargetKind = 'panel' | 'main' | 'edge';
export function dragAccepted(where: DropTargetKind, dragging: Dragging | null = layout().dragging): boolean {
  if (dragging === null) return false;
  if (dragging.source === 'panel') return where !== 'panel' && transferRefusal({ to: 'tab', panelTabId: dragging.tabId }) === null;
  if (where === 'panel') return transferRefusal({ to: 'panel', mainTabId: dragging.tabId }) === null;
  return where === 'edge' && (currentSet(layout().main).panes[dragging.fromPane]?.tabs.length ?? 0) > 1;
}
export const useDragAccepted = (where: DropTargetKind): boolean => useSyncExternalStore(subscribeTransfer, () => dragAccepted(where));
