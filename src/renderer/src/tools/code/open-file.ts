// The open-file seam (C8c execution document, Interfaces *Tools, slots and the open-file seam*; K4): every surface opens
// a file through `openFile`, and the file's viewer is the only reader of its bytes. The session comes first because the
// allowlist is per session; `codeTranscriptActions.openFile` is the transcript's form, filling the session from the
// focused pane (C5's Pane focuses on pointerdown, so at click time it is the transcript's). UX wave U6c (decision 15):
// opening a file that is already open reads it again when its last read failed or no watch keeps it current (`revisit`).
//
// UX wave U6b-1 (docs/doperpowers/plans/2026-11-14-ux-wave-U6b-1-file-beside-chat.md, Interfaces §B; Decisions 5, 9, 10):
// a file opens beside the chat, as a tab of Files in the session's side column, where `placeOpen` says; in the main
// area with no session, on ⌘-click (`main`), and when a main tab already shows it. A tab opened or reused is the
// session's preview tab unless the opener keeps it (`keep`). A person's open leaves an open page first; an agent's
// (`asked`) leaves it and the Settings dialog open. An open made before the layout is read is kept, once, and made when
// it is read, in call order, so it meets the restored tabs; `openFileWhenRead` answers when it is made (`show_pane`).
import type { AppSessionId } from '@shared/graph/ids';
import { normalizeLexically } from '@shared/files/named';
import { machineFor } from '../../ipc/machine';
import { panelHost, shownSession } from '../../panel/host';
import { surfaceSession } from '../../panel/surface-model';
import { quietly, useLayout } from '../../stores/layout';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore, type TranscriptActions, type TurnId } from '../../transcript';
import { dropSideViews, holdSideViews } from '../../shell/transfer'; // M4: ⌘-click on a file beside the chat is a move to main
import { fileKey, fileOfTab, FILES_TOOL_ID, placeOpen, type FilesTabParams } from './files/tabs';
import { useViewer } from './viewer/viewer-store';

// `normalizeLexically` lives in the rule of a file the transcript names (UX wave U6c, `src/shared/files/named.ts`), so the
// daemon's check reads a path as the click does; exported here as before.
export { normalizeLexically };

export interface OpenFileOptions {
  main?: boolean; // ⌘-click: a main tab, every side tab of the file dropped (rule 3)
  keep?: boolean; // the tab is kept, not the preview
  asked?: 'agent'; // not the person's act (UX wave U7b): no page closes, and what comes to the front comes behind it
}
export type Opened = { surface: 'main' | 'side'; tabId: string };
// The two ends of an open kept for the layout that open no tab: its session is not one the read keeps, or the layout was
// not read within the wait.
export type NotOpened = 'unknown-session' | 'not-ready';

// How long `show_pane` waits for the layout before it answers that the window is still loading (Decision 10): under the
// host's own PANE_ANSWER_MS, so the window's answer reaches the host before it gives up.
export const PANE_LAYOUT_WAIT_MS = 5_000;

interface Request {
  appSessionId: AppSessionId | null;
  path: string;
  line: number | null;
  options: OpenFileOptions;
}

interface KeptOpen extends Request {
  settle?(result: Opened | NotOpened): void;
  timer?: ReturnType<typeof setTimeout>;
}

let kept: KeptOpen[] = [];
let watching = false;

// null: the layout is not read yet; the open is kept and made when it is.
export function openFile(appSessionId: AppSessionId | null, path: string, line?: number | null, options: OpenFileOptions = {}): Opened | null {
  const request: Request = { appSessionId, path: normalizeLexically(path), line: line ?? null, options };
  if (waiting()) {
    keepForLayout(request);
    return null;
  }
  return decide(request);
}

// The same open, answered once it is made: at once after the layout is read; before it, when it is read, or with
// `not-ready` when it is not within PANE_LAYOUT_WAIT_MS (the open withdrawn, so it never opens later unannounced), or
// with `unknown-session` when the read keeps no list for the session.
export function openFileWhenRead(appSessionId: AppSessionId, path: string, line: number | null, options: OpenFileOptions = {}): Promise<Opened | NotOpened> {
  const request: Request = { appSessionId, path: normalizeLexically(path), line, options };
  if (!waiting()) return Promise.resolve(decide(request));
  return new Promise((resolve) => {
    const open: KeptOpen = { ...request, settle: resolve };
    open.timer = setTimeout(() => {
      kept = kept.filter((entry) => entry !== open);
      resolve('not-ready');
    }, PANE_LAYOUT_WAIT_MS);
    keepForLayout(open);
  });
}

// An open waits while the layout is unread, and while opens kept before it are not yet made (call order).
const waiting = () => !useLayout.getState().hydrated || kept.length > 0;

function keepForLayout(open: KeptOpen): void {
  kept.push(open);
  if (watching) return;
  watching = true;
  // Made in the microtask after the read's notification, so the panel host's barrier has placed the adds it held.
  const off = useLayout.subscribe((state) => {
    if (!state.hydrated) return;
    off();
    queueMicrotask(makeKept);
  });
}

function makeKept(): void {
  watching = false;
  while (kept.length > 0) {
    const open = kept.shift()!;
    if (open.timer !== undefined) clearTimeout(open.timer);
    if (open.appSessionId !== null && !useLayout.getState().knownSession(open.appSessionId)) {
      open.settle?.('unknown-session');
      continue;
    }
    const made = decide(open); // made before the answer: an optional call evaluates no argument when there is no `settle`
    open.settle?.(made);
  }
}

function decide(request: Request): Opened {
  return request.options.asked === 'agent' ? quietly(() => place(request)) : place(request);
}

function place({ appSessionId, path, line, options }: Request): Opened {
  const layout = useLayout.getState();
  const machine = machineFor(appSessionId);
  const key = fileKey(machine, path);
  const placement = placeOpen(layout, { appSessionId, path, main: options.main ?? false, keep: options.keep ?? false });
  if (placement.to === 'main') {
    holdSideViews(key);
    layout.openTab({ kind: 'file', path, line, appSessionId, machine });
    dropSideViews(key);
    useViewer.getState().revisit(key, appSessionId);
    return { surface: 'main', tabId: key };
  }
  const session = appSessionId!;
  if (options.asked !== 'agent') layout.closeDestination();
  const params = (preview: boolean): FilesTabParams => ({ file: path, line, ...(preview ? { preview: true as const } : {}) });
  let tabId: string;
  if (placement.tabId === null) {
    tabId = panelHost.addTool(FILES_TOOL_ID, { appSessionId: session, params: params(!options.keep), asked: options.asked });
  } else {
    // a reused tab is the preview unless kept; a selected one stays what it was, unless the opener keeps it
    const preview = placement.how === 'reuse' ? !options.keep : fileOfTab(layout.panelParams[placement.tabId])?.preview === true && !options.keep;
    layout.setPanelParams(placement.tabId, params(preview));
    tabId = placement.tabId;
    showTab(session, tabId, options.asked);
  }
  useViewer.getState().revisit(key, appSessionId);
  return { surface: 'side', tabId };
}

// A tab already in the session's list brought into view, the session brought to the front first when it is not the one
// the column shows (as the host's own activation does for an add).
function showTab(appSessionId: AppSessionId, tabId: string, asked: 'agent' | undefined): void {
  const layout = useLayout.getState();
  if (surfaceSession(layout) !== appSessionId) {
    if (asked === 'agent') quietly(() => layout.openSession(appSessionId));
    else layout.openSession(appSessionId);
  }
  panelHost.selectTab(tabId);
}

// Tests: forget the opens kept for the layout, and their waits.
export function resetKeptOpens(): void {
  for (const open of kept) if (open.timer !== undefined) clearTimeout(open.timer);
  kept = [];
}

// The session a turn belongs to, for a call outside a click: the transcript store key whose state holds the turn, the
// session's own (`<appSessionId>`) or a child agent's (`<appSessionId>:<agentId>`), when the session is known.
export function sessionOfTurn(turnId: TurnId): AppSessionId | null {
  const { entries } = useTranscriptStore.getState();
  const { records } = useSessions.getState();
  for (const key of Object.keys(entries)) {
    if (!entries[key].state.turns.has(turnId)) continue;
    const candidates = (key.includes(':') ? [key, key.slice(0, key.indexOf(':'))] : [key]) as AppSessionId[];
    const found = candidates.find((id) => records.has(id));
    if (found) return found;
  }
  return null;
}

// The transcript's callbacks C8c supplies (K3), registered through C6's `registerTranscriptActions` from App.tsx's C8c
// block: a receipt's "Review changes" (and a file row of it) opens Review on the turn, a path chip opens the viewer (a
// path link's ⌘-click in the main area: UX wave U6b-1).
export const codeTranscriptActions: Pick<TranscriptActions, 'reviewChanges' | 'openFile'> = {
  reviewChanges(turnId, path) {
    const appSessionId = shownSession() ?? sessionOfTurn(turnId);
    if (appSessionId === null) return;
    panelHost.addTool('review', { appSessionId, params: { scope: 'turn', turnId, ...(path ? { path } : {}) } });
  },
  openFile: (path, line, appSessionId, options) => void openFile(appSessionId ?? shownSession(), path, line, { main: options?.main === true }),
};
