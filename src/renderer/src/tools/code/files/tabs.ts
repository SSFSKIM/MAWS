// A file beside the chat (UX wave U6b-1, docs/doperpowers/plans/2026-11-14-ux-wave-U6b-1-file-beside-chat.md, Interfaces
// §A and §B): a file opens as a tab of the Files tool in the session's side column, its path among the tab's params
// (`panelTools.params`, under `file`, a key build F's Files tool does not read), and a tab of Files that holds no file is
// the tree alone. The params are the one source of what a tab holds: the strip, the body and the viewer's prune read them
// from the layout store. One document per file in the window (Decision 3): a side tab's viewer key is the id the file's
// main tab would have (`fileKey`), and an open selects the main tab when there is one (`placeOpen`). A file's tab is its
// session's and never pinned (Decision 16; the store's gate reads `paramsHoldFile`). Pure but for `keep`, `showFiles`
// and `connectSideFiles`, which write through the layout store and the panel host.
import type { AppSessionId } from '@shared/graph/ids';
import { normalizeLexically } from '@shared/files/named';
import { tabId, type PanelTabRef } from '@shared/ipc/schema/layout';
import { machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { lastInViewOf, panelHost } from '../../../panel/host';
import { groupForOpen, sideGroups } from '../../../panel/surface-model';
import { useLayout, type LayoutState } from '../../../stores/layout';
import { allTabs, paramsHoldFile, repairFileTabs } from '../../../stores/layout-model';

export const FILES_TOOL_ID = 'files';

export interface FilesTabParams {
  file: string; // absolute, lexically normal
  line: number | null;
  preview?: true;
}

// What a tab of Files holds, read from its stored params: null for the tree alone (no params, or params this build cannot
// read: a `file` that is not an absolute path, a value of another shape).
export function fileOfTab(params: unknown): FilesTabParams | null {
  if (!paramsHoldFile(params)) return null;
  const { file, line, preview } = params as { file: string; line?: unknown; preview?: unknown };
  if (!file.startsWith('/')) return null;
  const at = typeof line === 'number' && Number.isInteger(line) && line >= 1 ? line : null;
  return { file: normalizeLexically(file), line: at, ...(preview === true ? { preview: true as const } : {}) };
}

// The id a main tab of the file has (`file:<machine>:<path>`), which is also the viewer's key for the file beside the chat.
export const fileKey = (machine: MachineRef, path: string): string => tabId({ kind: 'file', path, line: null, appSessionId: null, machine });

// The strip's pin glyph: never on a tab that holds a file (Decision 16).
export const pinnableTab = (params: unknown): boolean => !paramsHoldFile(params);

// The keys of every file a side tab holds, in every session's list (a pinned tab never holds one): the viewer's prune
// keeps their entries, in view or not (Decision 20a).
export function sideFileKeys(state: Pick<LayoutState, 'panelBySession' | 'panelParams'>): Set<string> {
  const keys = new Set<string>();
  for (const [appSessionId, own] of state.panelBySession) {
    for (const ref of own.tabs) {
      const held = ref.toolId === FILES_TOOL_ID ? fileOfTab(state.panelParams[ref.id]) : null;
      if (held) keys.add(fileKey(machineOf(appSessionId), held.file));
    }
  }
  return keys;
}

// The session's own Files tabs that hold this file (one at most, by rule 1, but read as a list for rule 3's drop).
const filesTabs = (state: Pick<LayoutState, 'panelBySession'>, appSessionId: AppSessionId): PanelTabRef[] =>
  (state.panelBySession.get(appSessionId)?.tabs ?? []).filter((ref) => ref.toolId === FILES_TOOL_ID);

export interface OpenRequest {
  appSessionId: AppSessionId | null;
  path: string; // absolute, lexically normal
  main: boolean; // ⌘-click: the main area
  keep: boolean; // the opener keeps the tab (no preview)
}

export type Placement =
  | { to: 'main' }
  | { to: 'side'; tabId: string; how: 'select' | 'reuse' }
  | { to: 'side'; tabId: null; group: 'upper' | 'lower' };

// Where an open goes (Interfaces §B, "placeOpen, in order"). (1) No session, or ⌘: the main area. (2) A main tab shows the
// file: the main area. (3) The session's own list holds a tab of the file: that tab. (4) Its preview tab: reused.
// (5) Its tree-only tab: reused (a pinned Files tab is among the pins, never the session's own list, so it is never
// taken). (6) A new tab, in the group `groupForOpen` names for Files. `request.keep` decides what the tab is after the
// placement, not where it goes.
export function placeOpen(state: LayoutState, request: OpenRequest): Placement {
  const { appSessionId, path } = request;
  if (appSessionId === null || request.main) return { to: 'main' };
  const key = fileKey(machineOf(appSessionId), path);
  if (allTabs(state.main).some((tab) => tab.id === key)) return { to: 'main' };
  const files = filesTabs(state, appSessionId).map((ref) => ({ ref, held: fileOfTab(state.panelParams[ref.id]) }));
  const holding = files.find(({ held }) => held?.file === path);
  if (holding) return { to: 'side', tabId: holding.ref.id, how: 'select' };
  const preview = files.find(({ held }) => held?.preview === true);
  if (preview) return { to: 'side', tabId: preview.ref.id, how: 'reuse' };
  const tree = files.find(({ held }) => held === null);
  if (tree) return { to: 'side', tabId: tree.ref.id, how: 'reuse' };
  return { to: 'side', tabId: null, group: groupForOpen(sideGroups(state, appSessionId), FILES_TOOL_ID, null, null) };
}

// The preview tab becomes a kept tab (a double-click on it, the first edit, a move); nothing for any other tab.
export function keep(tabId: string): void {
  const held = fileOfTab(useLayout.getState().panelParams[tabId]);
  if (!held?.preview) return;
  useLayout.getState().setPanelParams(tabId, { file: held.file, line: held.line });
}

// Rule 3's drop (⌘-click here; a move to the main area and the reopen in M4): every side tab of the file goes from every
// session's list, written through the store, so the panel host disposes each without its close question.
export function dropSideTabs(key: string): void {
  const layout = useLayout.getState();
  for (const [appSessionId, own] of layout.panelBySession) {
    const machine = machineOf(appSessionId);
    const ids = new Set(own.tabs.flatMap((ref) => {
      const held = ref.toolId === FILES_TOOL_ID ? fileOfTab(layout.panelParams[ref.id]) : null;
      return held && fileKey(machine, held.file) === key ? [ref.id] : [];
    }));
    if (ids.size > 0) useLayout.getState().updatePanelTabs(appSessionId, (refs) => refs.filter((ref) => !ids.has(ref.id)));
  }
}

// Files in view for the session: its Files tab last in view, else the tree-only tab it has (its own or the pinned one),
// else a tree-only tab added (the tool's `reuse` makes the last two one call). Its id.
export function showFiles(appSessionId: AppSessionId): string {
  const last = lastInViewOf(appSessionId, FILES_TOOL_ID);
  if (last) {
    panelHost.selectTab(last.id);
    return last.id;
  }
  return panelHost.addTool(FILES_TOOL_ID, { appSessionId });
}

// The one subscriber on the side tabs (Interfaces §B; sequence 6): when a list, the pins or the params change, the live
// layout is held to the read's rules (`repairFileTabs`: within a list the tree-only Files tab before those that hold a
// file, Decision 17; no pin and no second preview), and then the viewer's prune runs, which counts the side files'
// keys. Connected once with the code tools; `prune` is the viewer store's, handed in so this module imports no viewer.
export function connectSideFiles(prune: () => void): () => void {
  let holding = false; // the repair's own writes notify again: the outer run has the whole repair in hand
  return useLayout.subscribe((state, prev) => {
    if (holding || !state.hydrated) return;
    if (state.panelBySession === prev.panelBySession && state.panelPinned === prev.panelPinned && state.panelParams === prev.panelParams) return;
    holding = true;
    try {
      holdToRules(state);
    } finally {
      holding = false;
    }
    prune();
  });
}

function holdToRules(state: LayoutState): void {
  const repaired = repairFileTabs({ main: state.main, panelPinned: state.panelPinned, panelBySession: state.panelBySession, panelParams: state.panelParams });
  if (repaired.panelBySession === state.panelBySession && repaired.panelParams === state.panelParams) return;
  const layout = useLayout.getState();
  for (const [appSessionId, own] of repaired.panelBySession) {
    if (state.panelBySession.get(appSessionId)?.tabs === own.tabs) continue;
    layout.updatePanelTabs(appSessionId, (refs) => [...refs.filter((ref) => ref.pinned), ...own.tabs]);
  }
  for (const [id, params] of Object.entries(state.panelParams)) {
    if (repaired.panelParams[id] !== params) layout.setPanelParams(id, id in repaired.panelParams ? repaired.panelParams[id] : null);
  }
}
