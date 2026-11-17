// The Files tool (C8c execution document, Interfaces *Tools, slots and the open-file seam*; M2's decisions): the
// session's roots as a tree, one root per directory the session may read, listed lazily as directories expand and kept
// current by `files.changed` for the expanded ones; `.git` hidden as a root's child, dotfiles shown, symlinks named and
// not followed. A click on a directory toggles it, on a file opens it (`openFile`). X5: `id: 'files'`, pinnable, no
// summary. Its state is a store handle (C8a's React Compiler rule): the expansion, selection and scroll per session.
//
// UX wave U6b-1 (docs/doperpowers/plans/2026-11-14-ux-wave-U6b-1-file-beside-chat.md, Decisions 1, 8 and 21): a file opens
// beside the chat as a tab of this tool, so Files is multi-instance and a tab of it either holds a file (its params,
// `files/tabs.ts`) and draws the file viewer, or holds none and draws the tree. What a tab holds is read from the layout
// store, for a tab restored and for one opened now alike; an add of a tab with a file writes its params before the tab
// is listed, so no reader meets a file's tab without its file. An add with no file shows the tree-only tab the scope has
// (`reuse`), and adds one only when it has none. The reveal of `params.path`, which nothing in the window asked for,
// is gone with its two waiting states. M2: a tab that holds a file closes as a main file tab closes, asking about unsaved
// edits (`beforeClose`), and its viewer is where ⌘S and Comment on this line act while it holds the keyboard.
// M3 (Interfaces §C): every Files tab draws the tree in a column at the left of its file, where `treePlace` says (the
// owner's answer on card R8: in a tab too narrow for both, the button shows the tree in the file's place), and the tree's
// state is the session's (`tree-state.ts`), so the tool's instance keeps nothing. A row's click opens the file in the
// preview tab, a double-click keeps it, ⌘-click opens a main tab; the row of the file in view is marked.
// UX wave U6e (docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, §D; "Reported" 1, K6, K7, K9): the
// tree's context menu (a right-click in it, or ⇧F10 with the keyboard in it) holds the one row "Open File…", the menus'
// component as the Files icon's menu draws it, with no chord; for a session on another machine the row is disabled and
// names the machine (until U6f). A tab's agent's mark is handed to its file's viewer (decision 19).
// UX wave U6b-3a (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3a-what-changed.md, M2): the drawn tree holds the git
// store's watch of the working folder; a Changed group of what git lists as changed stands as the list's first rows, the
// tree's rows carry the same letters and a dot above each change, and the entries git ignores are muted. A status whose
// set of entries changed lists the drawn directories of its repository again (decision 14 (b)).
import { useVirtualizer } from '@tanstack/react-virtual';
import { ContextMenu } from 'radix-ui';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { workingFolder } from '@shared/sessions/working-folder';
import { Resizer } from '../../../app/Resizer';
import { panelHost } from '../../../panel/host';
import type { PanelTool, PanelToolContext, PanelToolInit } from '../../../panel/tool';
import { ipc } from '../../../ipc/client';
import { checkoutKey, machineFor } from '../../../ipc/machine';
import { useGit } from '../../../stores/git';
import { useMachines } from '../../../stores/machines';
import { machineName } from '../../../stores/org-projects';
import { useLayout } from '../../../stores/layout';
import { paramsHoldFile } from '../../../stores/layout-model';
import { FILES_COPY, OPEN_FILE_COPY, REFUSAL, REVIEW_COPY } from '../copy';
import { closeGuardOf, registerSideFile } from '../editor/register';
import { openFile, type Opened } from '../open-file';
import { FileViewer } from '../viewer/FileViewer';
import { moveFileToMain, useTransferRefusal } from '../../../shell/transfer'; // M4
import { TRANSFER_COPY } from '../../artifacts/copy'; // M4: the words an artifact's move has
import { changedRows, labelOf, LETTER_TONE, marksOf, pathUnder, shownPath, statusSet, type ChangedRow, type ChangeLetter, type Marks } from './changed';
import { openChosen } from './open-chosen';
import { folderFromEnd, measureIn } from './path-cut';
import { listingKey, useFiles } from './store';
import { closeAnswered, fileKey, fileOfTab, FILES_TOOL_ID, keep, sideFileOf, type FilesTabParams } from './tabs';
import { expandTo, firstRoot, roleOf, rootsFor, rowsOf, sameFile, workingRoot, type ListedRow, type RootRole, type TreeRow } from './tree';
import { FILE_WIDTH_MIN, treeOf, treePlace, TREE_WIDTH_DEFAULT, TREE_WIDTH_MIN, useTreeState } from './tree-state';
import { useSetup } from '../../../sessions/store'; // E11
import type { SetupIntent } from '@shared/sessions/intent'; // E11

export { FILES_TOOL_ID };
export const FILES_ROW_HEIGHT = 24;

// What an add of Files is given: a file to show (`openFile`'s), or nothing for the tree. A restored tab's params are
// whatever the layout holds for it (X5), read through `fileOfTab`.
export type FilesParams = FilesTabParams | undefined;

// M3: the tree's state is the session's (`tree-state.ts`), the same in each of its Files tabs: the instance keeps only
// its id.
export interface FilesState {
  readonly tabId: string;
}

// A tab opened now with a file stores it first, before the host lists the tab; a restored tab's are in the layout already.
function createState({ instanceId, params, restored }: PanelToolInit<FilesParams>): FilesState {
  if (!restored && paramsHoldFile(params)) useLayout.getState().setPanelParams(instanceId, params);
  return { tabId: instanceId };
}

// Decision 21: an add with no file re-targets the scope's first tab that holds no file (the pinned tree, else the
// session's own); an add with a file always makes its own tab.
function reuse(refs: readonly { id: string }[], params: FilesParams): string | null {
  if (paramsHoldFile(params)) return null;
  const held = useLayout.getState().panelParams;
  return refs.find((ref) => !paramsHoldFile(held[ref.id]))?.id ?? null;
}

// M2 (sequence 2): a tab that holds a file asks what a main file tab's close asks, of the file's key, and its answer acts
// only while this tab still holds that file; a merge view's veto brings the tab into view. A close let through is
// marked as answered, so the side tabs' subscriber does not keep the file as a main tab when the tab leaves.
async function beforeClose(state: FilesState): Promise<boolean> {
  const at = sideFileOf(state.tabId);
  if (!at) return true;
  const allowed = await closeGuardOf(at.key, { reveal: () => panelHost.selectTab(state.tabId), holds: () => sideFileOf(state.tabId)?.key === at.key });
  if (allowed) closeAnswered(state.tabId);
  return allowed;
}

export function FilesIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round">
      <path d="M1.5 4a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.5h5.5A1.5 1.5 0 0 1 14.5 5.5V12a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 12z" />
    </svg>
  );
}

function TreeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M6 2.5v11" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" />
    </svg>
  );
}

// E11: an unstarted session's directories as its intent names them, for re-listing when they change: a new worktree's
// path too, which replaces its repository in main's listing once the setup makes it (F2a review 4).
const unstartedRootsKey = (intent: SetupIntent | undefined): string =>
  intent ? JSON.stringify([intent.location, intent.additionalDirectories, intent.progress.worktree?.path ?? null]) : '';

function FilesBody({ state, ctx }: { state: FilesState; ctx: PanelToolContext }) {
  const held = fileOfTab(useLayout((s) => s.panelParams[state.tabId]));
  if (ctx.appSessionId === null) return <p className="flex h-full items-center justify-center p-4 text-center text-ui text-fg-muted">{FILES_COPY.noSession}</p>;
  return <FilesTab tabId={state.tabId} appSessionId={ctx.appSessionId} session={ctx.session} held={held} visible={ctx.visible} />;
}

// The tab's own width, measured as it draws and followed as it changes (happy-dom measures 0: a tab too narrow for both).
function useWidth(): [number, (element: HTMLDivElement | null) => (() => void) | undefined] {
  const [width, setWidth] = useState(0);
  const measure = useCallback((element: HTMLDivElement | null) => {
    if (element === null) return;
    setWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [width, measure];
}

const treeBar = 'flex min-h-8 shrink-0 items-center gap-x-2 border-b border-border bg-bg px-3 py-1 text-ui-sm';

// A Files tab: the tree alone when it holds no file; with a file, the tree in a column at the file's left, folded away,
// or in the file's place (`treePlace`). The file is drawn as a main file tab draws it (law 3): the same viewer and its bar,
// under the key the file's main tab would have, with the tree's button at the bar's start. While the tab is visible the
// file's own column is where the keyboard can hold the file (R4); the tree beside it is not. While the tree stands in the
// file's place the viewer stays mounted, hidden and inert, so the file keeps its editor's state and its viewer entry
// stays mounted (the cap never takes it), and it is not where the keyboard is.
// UX wave U6b-2 (Decision Log 29): while the tree stands in the file's place or the panel is not on screen, the file is
// not in view, and a framed file's element is not in the document.
function FilesTab({ tabId, appSessionId, session, held, visible }: { tabId: string; appSessionId: AppSessionId; session: SessionRecord | null; held: FilesTabParams | null; visible: boolean }) {
  const machine = machineFor(appSessionId);
  const key = held ? fileKey(machine, held.file) : null;
  const [tabWidth, measure] = useWidth();
  const [fileColumn, setFileColumn] = useState<HTMLDivElement | null>(null);
  useEffect(() => void useTreeState.getState().load(), []);
  const loaded = useTreeState((s) => s.loaded);
  const tree = useTreeState((s) => treeOf(s, appSessionId));
  // The button pressed in this tab while it is too narrow for both (not stored), for the file it was pressed over: any
  // change of the file the tab holds ends it (a file chosen, a reuse of the tab from a link), so a file that comes back
  // later is shown, not the tree.
  const file = held?.file ?? null;
  const [shown, setShown] = useState<{ file: string | null; on: boolean }>({ file, on: false });
  if (shown.file !== file) setShown({ file, on: false });
  const treeWidth = Math.max(TREE_WIDTH_MIN, tree.width ?? TREE_WIDTH_DEFAULT);
  const roomy = tabWidth >= treeWidth + FILE_WIDTH_MIN;
  const place = treePlace({ holdsFile: held !== null, tabWidth, treeWidth, folded: tree.folded, shown: shown.file === file && shown.on });
  useEffect(() => (visible && key !== null && fileColumn && place !== 'instead' ? registerSideFile(fileColumn, key) : undefined), [visible, key, fileColumn, place]);
  const inView = visible && place !== 'instead'; // UX wave U6b-2 (Decision Log 29)
  // The button: with room for both it folds the tree for the session (stored); too narrow, it shows the tree in the file's
  // place in this tab, until a file is chosen or it is pressed again.
  const toggleTree = () => {
    if (held === null) return;
    if (roomy) useTreeState.getState().setFolded(appSessionId, !tree.folded);
    else setShown({ file, on: place !== 'instead' });
  };
  const button = <TreeToggle drawn={place === 'beside' || place === 'instead'} onToggle={toggleTree} />;
  const treeId = `files-tree-${tabId}`;
  const sessionTree = loaded ? <SessionTree key={appSessionId} appSessionId={appSessionId} session={session} marked={file} chosen={() => setShown({ file, on: false })} /> : null;
  return (
    <div ref={measure} data-files-tab data-file={file ?? ''} onDoubleClick={(event) => keepChosen(tabId, event.target)} className="flex h-full min-h-0 min-w-0">
      {place === 'alone' ? (
        <div id={treeId} data-files-tree data-place={place} className="h-full min-h-0 min-w-0 flex-1">
          {sessionTree}
        </div>
      ) : null}
      {place === 'beside' ? (
        <>
          <div id={treeId} data-files-tree data-place={place} className="h-full min-h-0 shrink-0 border-r border-border" style={{ width: treeWidth }}>
            {sessionTree}
          </div>
          <Resizer
            label={FILES_COPY.resizeTree}
            controls={treeId}
            value={treeWidth}
            min={TREE_WIDTH_MIN}
            max={Math.floor(tabWidth) - FILE_WIDTH_MIN}
            defaultValue={TREE_WIDTH_DEFAULT}
            onChange={(width) => useTreeState.getState().setWidth(appSessionId, width)}
            onReset={() => useTreeState.getState().setWidth(appSessionId, null)}
            className="-ml-1.5 shrink-0"
          />
        </>
      ) : null}
      {place === 'instead' ? (
        <div id={treeId} data-files-tree data-place={place} className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
          <div className={treeBar}>
            {button}
            <span className="truncate text-fg-muted">{FILES_COPY.title}</span>
          </div>
          <div className="min-h-0 flex-1">{sessionTree}</div>
        </div>
      ) : null}
      {held ? (
        <div ref={setFileColumn} hidden={place === 'instead'} inert={place === 'instead'} className="h-full min-h-0 min-w-0 flex-1">
          <FileViewer tab={{ id: fileKey(machine, held.file), kind: 'file', path: held.file, line: held.line, appSessionId, machine, pinned: false }} start={button} end={<MoveToMain tabId={tabId} />} host="side" inView={inView} agent={held.agent === true} />
        </div>
      ) : null}
    </div>
  );
}

// A double-click on a tree row keeps the tab its first click opened (L1). Where the tree stood in the file's place, the
// first click ends it and the second lands on the file now drawn there, so the row's own double-click never fires. So a
// row's click that opened its file beside the chat records the file and the tab it is in, and the record holds for the
// very next click in the window only: when that click is the pair's second (`detail`, the system's click count, two or
// more), the double-click that follows it keeps the file, if it lands in that same tab, on no control of its own (a
// button, the divider, a row), and the tab still holds the file. Any other click, any key, and that double-click end the
// record. A single click is not delayed. One record for the window: the second click is heard wherever it lands.
let chosenByClick: { tabId: string; path: string; second: boolean } | null = null;
let listening = false;
function listenForThePair(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  // Capture, so the record is judged before any handler of the click (the row's own sets the next record after it).
  window.addEventListener('click', (event) => void (chosenByClick = chosenByClick && !chosenByClick.second && event.detail >= 2 ? { ...chosenByClick, second: true } : null), true);
  window.addEventListener('keydown', () => void (chosenByClick = null), true);
  window.addEventListener('dblclick', () => void (chosenByClick = null)); // after the page's handlers
}
function chosenFile(path: string, opened: Opened | null): void {
  listenForThePair();
  chosenByClick = opened?.surface === 'side' ? { tabId: opened.tabId, path, second: false } : null;
}
const OWN_DOUBLE_CLICK = 'button, a, input, textarea, select, [role="button"], [role="separator"], [role="treeitem"]';
function keepChosen(tabId: string, target: EventTarget): void {
  const chosen = chosenByClick;
  chosenByClick = null;
  if (chosen === null || !chosen.second || chosen.tabId !== tabId || sideFileOf(tabId)?.held.file !== chosen.path) return;
  if (target instanceof Element && target.closest(OWN_DOUBLE_CLICK)) return; // a control's own double-click
  keep(tabId);
}

// M4: the file into the main area from its bar, as from its tab's menu; disabled with the reason while it cannot move.
function MoveToMain({ tabId }: { tabId: string }) {
  const refusal = useTransferRefusal({ to: 'tab', panelTabId: tabId });
  return (
    <button type="button" data-move-to-main aria-label={TRANSFER_COPY.moveToMain} title={refusal ?? TRANSFER_COPY.moveToMain} disabled={refusal !== null} onClick={() => void moveFileToMain(tabId)} className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:text-fg-faint">
      <MoveToMainIcon className="size-3.5" />
    </button>
  );
}

// A box with an arrow leaving it towards the main area, at the left.
function MoveToMainIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 2.5h5A1.5 1.5 0 0 1 13.5 4v8a1.5 1.5 0 0 1-1.5 1.5H7M2.5 8h7M5 5.5 2.5 8 5 10.5" />
    </svg>
  );
}

function TreeToggle({ drawn, onToggle }: { drawn: boolean; onToggle(): void }) {
  const label = drawn ? FILES_COPY.hideTree : FILES_COPY.showTree;
  return (
    <button type="button" data-files-tree-toggle aria-label={label} title={label} onClick={onToggle} className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2">
      <TreeIcon className="size-3.5" />
    </button>
  );
}

// The session's tree. `marked`: the file the tab holds, whose row is marked when it is listed (Decision 8: the tree marks
// and does not follow); a tab with no file marks the row last activated. `chosen`: a file was chosen from it.
function SessionTree({ appSessionId, session, marked, chosen }: { appSessionId: AppSessionId; session: SessionRecord | null; marked: string | null; chosen(): void }) {
  const view = useTreeState((s) => treeOf(s, appSessionId));
  const listings = useFiles((s) => s.listings);
  const roots = listings.get(listingKey(appSessionId, null));

  const folder = session ? workingFolder(session) : null;
  // UX wave U8c-2 (M4 decision 4): while the session is moved, the working folder's root is listed first; the order of the
  // roots is the only thing that changes, and a root the listing does not hold is never put first.
  const rootEntries = useMemo(() => {
    const listed = roots?.status === 'ok' ? roots.value.entries : [];
    const working = session ? workingFolder(session) : null;
    if (!working?.moved) return listed;
    const first = workingRoot(listed.map((root) => root.path), working.path);
    return first === null ? listed : [...listed.filter((root) => root.path === first), ...listed.filter((root) => root.path !== first)];
  }, [roots, session]);
  const roles = useMemo(() => {
    const candidates = session ? rootsFor(session) : [];
    return new Map(rootEntries.flatMap((root): [string, RootRole][] => {
      const role = roleOf(root.path, candidates);
      return role ? [[root.path, role]] : [];
    }));
  }, [rootEntries, session]);
  const rows = useMemo(
    () => rowsOf({ roots: rootEntries, listing: (path) => listings.get(listingKey(appSessionId, path)), expanded: view.expanded, roles }),
    [rootEntries, listings, appSessionId, view.expanded, roles],
  );

  // Open the working root once so Files starts with useful content. A deliberate collapse survives refresh/remount;
  // a newly created worktree gets its own first expansion when it replaces the original directory, and so does the
  // working folder an agent moved into (UX wave U8c-2), nothing else being collapsed.
  const defaultRoot = firstRoot(rootEntries.map((root) => root.path), roles, folder);
  // UX wave U6b-1 (M3): the session's tree, so after a relaunch the stored folders stand (`firstRoot`).
  useEffect(() => {
    if (defaultRoot !== null) useTreeState.getState().firstRoot(appSessionId, defaultRoot);
  }, [defaultRoot, appSessionId]);

  // The roots, again whenever the record changes the directories the session may read; before the session starts, its
  // setup intent's location, which main lists until the record exists (E11), so a project chosen after the pane opened
  // is listed then.
  const unstarted = useSetup((s) => (session ? '' : unstartedRootsKey(s.intents.get(appSessionId))));
  const declared = session ? [...rootsFor(session).map((c) => c.path), folder?.launch, folder?.path].join('\0') : unstarted; // U8c-2: and when the launch or the working folder changes
  useEffect(() => useFiles.getState().list(appSessionId, null), [appSessionId, declared]);
  // Watches follow the expanded directories that are shown: one under a collapsed parent keeps its expansion in memory
  // but is not watched (nor listed) while hidden. Declared before the listing effect, so a first listing waits for its
  // watch.
  const shown = rows.flatMap((row) => (row.kind !== 'notice' && row.expanded ? [row.path] : [])).join('\0'); // NUL: the one byte no path holds
  useEffect(() => {
    const holds = shown === '' ? [] : shown.split('\0').map((path) => useFiles.getState().watch(appSessionId, path));
    return () => holds.forEach((hold) => hold.release());
  }, [appSessionId, shown]);
  useEffect(() => {
    if (shown === '') return;
    for (const path of shown.split('\0')) if (!useFiles.getState().listing(appSessionId, path)) useFiles.getState().list(appSessionId, path);
  }, [appSessionId, shown]);

  // UX wave U6b-3a (M2 decision 1): the git store's watch of the working folder, the drawn tree's while it is drawn, and
  // the status it holds; none: no Changed group and no mark (decision 3).
  const machine = machineFor(appSessionId);
  const working = folder?.path ?? null;
  useEffect(() => (working === null ? undefined : useGit.getState().watch(machine, working, appSessionId)), [machine, working, appSessionId]);
  const gitKey = working === null ? null : checkoutKey(machine, working);
  const status = useGit((s) => (gitKey === null ? null : (s.entries.get(gitKey)?.status ?? null)));
  const changes = useMemo(() => (status === null ? [] : changedRows(status)), [status]);
  const marks = useMemo(() => marksOf(changes), [changes]);
  // The Changed group, as the list's first rows once the roots' listing has answered (decision 6); folded to its heading.
  const listed = roots?.status === 'ok';
  const section = useMemo((): TreeRow[] => {
    if (!listed || changes.length === 0) return [];
    const heading: TreeRow = { kind: 'changed-heading', key: 'changed\n', count: changes.length, folded: view.changedFolded };
    return view.changedFolded ? [heading] : [heading, ...changes.map((row): TreeRow => ({ kind: 'changed', key: `changed\n${row.rel}`, row }))];
  }, [listed, changes, view.changedFolded]);
  const listRows = useMemo(() => [...section, ...rows], [section, rows]);

  // Decision 14 (b): a status whose set of entries differs from the last one this tree drew from lists again every drawn
  // directory in its repository; the first status, and one of another folder, list nothing (S3, S5).
  const seen = useRef<{ key: string; set: string } | null>(null);
  useEffect(() => {
    if (status === null || gitKey === null) return;
    const set = statusSet(status);
    const last = seen.current;
    seen.current = { key: gitKey, set };
    if (last === null || last.key !== gitKey || last.set === set || shown === '') return;
    for (const path of shown.split('\0')) if (pathUnder(status.repoRoot, path) !== null) useFiles.getState().list(appSessionId, path);
  }, [status, gitKey, shown, appSessionId]);

  // A Changed row's click (decision 6): a file on disk opens as a tree row's does; a folder opens in the tree; a row with
  // nothing on disk, and one outside every listed root (R6), opens Review on Uncommitted at its entry.
  const rootPaths = rootEntries.map((root) => root.path);
  const activateChanged = (row: ChangedRow, main: boolean) => {
    const inside = expandTo(rootPaths, row.path);
    if (inside === null || !row.onDisk) {
      const entry = row.folder && row.letter === 'U' ? `${row.rel}/` : row.rel; // as the status lists it
      panelHost.addTool('review', { appSessionId, params: { scope: 'uncommitted', path: entry } });
      return;
    }
    if (row.folder) return useTreeState.getState().revealIn(appSessionId, inside.path, inside.ancestors);
    useTreeState.getState().select(appSessionId, inside.path);
    chosen();
    if (main) return void openFile(appSessionId, row.path, null, { main: true });
    chosenFile(row.path, openFile(appSessionId, row.path, null));
  };
  const keepChanged = (row: ChangedRow) => {
    if (row.onDisk && !row.folder && expandTo(rootPaths, row.path) !== null) openFile(appSessionId, row.path, null, { keep: true });
  };
  const changed: ChangedProps = {
    marks,
    working,
    rootPaths,
    activate: activateChanged,
    keep: keepChanged,
    fold: (folded) => useTreeState.getState().foldChanged(appSessionId, folded),
  };

  // A click: a folder opens or closes; a file opens in the preview tab, or with ⌘ as a main tab (L3).
  const activate = (row: TreeRow, main: boolean) => {
    if (row.kind !== 'root' && row.kind !== 'entry') return;
    const directory = row.kind === 'root' || row.entry.kind === 'dir';
    // Expanding a directory whose listing failed asks again (a refused root stays expandable for a retry).
    if (directory && !row.expanded && useFiles.getState().listing(appSessionId, row.path)?.status === 'error') useFiles.getState().list(appSessionId, row.path);
    useTreeState.getState().select(appSessionId, row.path);
    if (directory) useTreeState.getState().toggle(appSessionId, row.path);
    if (row.kind !== 'entry' || row.entry.kind !== 'file') return;
    chosen();
    if (main) return void openFile(appSessionId, row.path, null, { main: true });
    chosenFile(row.path, openFile(appSessionId, row.path, null));
  };
  // A double-click on a file keeps the tab its first click opened (L1).
  const keepRow = (row: TreeRow) => {
    if (row.kind === 'entry' && row.entry.kind === 'file') openFile(appSessionId, row.path, null, { keep: true });
  };
  const refresh = () => {
    useFiles.getState().list(appSessionId, null);
    for (const path of view.expanded) useFiles.getState().list(appSessionId, path);
  };

  return (
    <FilesMenu appSessionId={appSessionId}>
      <div data-tool="files" className="flex h-full min-h-0 flex-col">
        {roots?.status === 'error' ? <div className="flex items-center justify-between pr-1"><RootsFailure message={roots.message} /><RefreshButton refresh={refresh} /></div> : null}
        <TreeList rows={listRows} selected={marked ?? view.selected} activate={activate} keepRow={keepRow} appSessionId={appSessionId} refresh={refresh} changed={changed} />
      </div>
    </FilesMenu>
  );
}

// UX wave U6e: the Files list's menu, in the classes of the Files icon's (`panel/SurfaceRow.tsx`, K9), at most 24rem wide
// (K6), its least and its most width never wider than its column less 1rem (the tree can be 160 px), the column (the
// list's own box) measured as the menu opens and its edges the menu's collision boundary (K12). ⇧F10 opens it at the
// element that holds the keyboard, as it opens an icon's. Its one row draws no chord: no in-page menu of the app draws
// one, and the File menu shows ⌘O (K7).
const MENU = 'z-50 min-w-[min(12rem,calc(var(--files-menu-column,25rem)_-_1rem))] max-w-[min(24rem,calc(var(--files-menu-column,25rem)_-_1rem))] rounded-md border border-border-strong bg-bg-overlay p-1 text-fg shadow-float';
const MENU_ROW = 'block h-8 cursor-default truncate rounded-sm px-2 text-ui leading-8 outline-none data-highlighted:bg-bg-hover data-disabled:text-fg-faint';

function FilesMenu({ appSessionId, children }: { appSessionId: AppSessionId; children: ReactNode }) {
  const list = useRef<HTMLElement>(null);
  const [column, setColumn] = useState<{ box: Element; width: number } | null>(null);
  // A menu that closes hands the keyboard back to where it was a task later (Radix's focus scope, in a timer). Opened
  // again before that task runs, the menu holds the keyboard, and the late hand-back would land outside it and close it
  // (a menu that is not modal closes when the keyboard leaves it): so while the menu is open again, nothing is handed back.
  // The menu opened again so (a second right-click while it is open closes and opens it in one gesture) has recorded the
  // page as where the keyboard was: so the element that held the keyboard when the menu first opened is kept, and a
  // close with no reopen hands the keyboard back to it while it is in the page. A close by a press elsewhere leaves the
  // keyboard where that press put it, as Radix does.
  const open = useRef(false);
  const owed = useRef(false); // a close whose hand-back has not run yet
  const opener = useRef<HTMLElement | null>(null);
  const outside = useRef(false);
  const opened = (now: boolean) => {
    if (now && !owed.current) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!now) owed.current = true;
    open.current = now;
    const box = list.current;
    if (now && box) setColumn({ box, width: box.getBoundingClientRect().width });
  };
  const handBack = (event: Event) => {
    const pressedElsewhere = outside.current;
    owed.current = false;
    outside.current = false;
    if (open.current) event.preventDefault();
    else if (!pressedElsewhere && opener.current?.isConnected) {
      event.preventDefault();
      opener.current.focus({ preventScroll: true });
    }
  };
  const machine = machineFor(appSessionId);
  const elsewhere = useMachines((s) => (machine === ipc.localMachine ? null : machineName(s.machines, machine, ipc.localMachine)));
  const atKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (!event.shiftKey || event.key !== 'F10') return;
    event.preventDefault();
    const box = (event.target as Element).getBoundingClientRect();
    event.target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.left, clientY: box.bottom }));
  };
  // Another machine (Decision Log 6: until U6f): the row disabled, its parenthesis in the muted colour, a long name cut
  // with the whole row as its title.
  const whole = elsewhere === null ? null : OPEN_FILE_COPY.elsewhere(elsewhere);
  return (
    <ContextMenu.Root modal={false} onOpenChange={opened}>
      <ContextMenu.Trigger ref={list} asChild onKeyDown={atKeyboard}>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          data-files-menu=""
          className={MENU}
          collisionBoundary={column?.box}
          collisionPadding={8}
          onCloseAutoFocus={handBack}
          onInteractOutside={() => void (outside.current = true)}
          style={column && column.width > 0 ? ({ '--files-menu-column': `${column.width}px` } as CSSProperties) : undefined}
        >
          {whole === null ? (
            <ContextMenu.Item data-open-file="" className={MENU_ROW} onSelect={() => void openChosen(appSessionId)}>
              {OPEN_FILE_COPY.row}
            </ContextMenu.Item>
          ) : (
            <ContextMenu.Item data-open-file="" disabled title={whole} className={MENU_ROW}>
              {OPEN_FILE_COPY.row}
              <span className="text-fg-muted">{whole.slice(OPEN_FILE_COPY.row.length)}</span>
            </ContextMenu.Item>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

// UX wave U6b-3a: what the list needs to draw the Changed group and the marks.
interface ChangedProps {
  marks: Marks;
  working: string | null; // the working folder's path, from which a row under it names its folder
  rootPaths: readonly string[]; // the roots the files service listed: a row under none is outside the session's folders
  activate(row: ChangedRow, main: boolean): void;
  keep(row: ChangedRow): void;
  fold(folded: boolean): void;
}

// The fonts a Changed row's name and folder are measured in (M2 decision 9), read from the page's tokens once per list.
function rowFonts(): { name: string; folder: string } {
  const style = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => style?.getPropertyValue(name).trim() || fallback;
  const family = token('--font-ui', 'system-ui, sans-serif');
  return { name: `${token('--text-ui', '13px')} ${family}`, folder: `${token('--text-ui-sm', '12px')} ${family}` };
}

// The rows as one virtual list. Its own component because the React Compiler skips any component that calls
// `useVirtualizer` (its API returns functions it cannot memoise); the tree above stays compiled.
function TreeList({
  rows,
  selected,
  activate,
  keepRow,
  appSessionId,
  refresh,
  changed,
}: {
  rows: TreeRow[];
  selected: string | null;
  activate: (row: TreeRow, main: boolean) => void;
  keepRow: (row: TreeRow) => void;
  appSessionId: AppSessionId;
  refresh(): void;
  changed: ChangedProps;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // UX wave U6b-3a (M2 decision 8; Decision Log 6, note 1): Refresh and its room are the first root's row's, wherever in
  // the list it stands, with or without a Changed group above it.
  const rootAt = rows.findIndex((row) => row.kind === 'root');
  const [width, measureWidth] = useWidth(); // the rows' width, from which a Changed row's folder gets its room
  const fonts = useMemo(rowFonts, []);
  const getItemKey = useCallback((index: number) => rows[index].key, [rows]);
  // eslint-disable-next-line react-hooks/incompatible-library -- see above
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => FILES_ROW_HEIGHT,
    getItemKey,
    overscan: 12,
  });
  // The scroll offset lives in the session's tree state across unmounts (the host mounts only the selected tab): restored once
  // per mount, written back on unmount. A tab hidden past the watch grace comes back with its directories unlisted, so
  // the scroller clamps the offset to the rows there are; the offset is then pending, re-applied as the rows arrive
  // until the content reaches it once, and dropped if the owner scrolls first. Unmounted while pending, it keeps it.
  const pending = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current!;
    const saved = treeOf(useTreeState.getState(), appSessionId).scrollTop;
    el.scrollTop = saved;
    pending.current = el.scrollTop < saved ? saved : null;
    return () => {
      const kept = pending.current ?? el.scrollTop;
      useTreeState.getState().scrolled(appSessionId, kept);
    };
  }, [appSessionId]);
  const total = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    const want = pending.current;
    if (want === null) return;
    const el = scroller.current!;
    el.scrollTop = want;
    if (el.scrollTop >= want) pending.current = null;
  }, [total]);
  // UX wave U6b-3a (S4): a folder opened from its Changed row is scrolled into view in the first render in which its row
  // exists, and the note is dropped; the person's own scroll or another selection drops it first.
  const reveal = useTreeState((s) => treeOf(s, appSessionId).reveal);
  const revealAt = reveal === null ? -1 : rows.findIndex((row) => (row.kind === 'root' || row.kind === 'entry') && sameFile(row.path, reveal));
  useLayoutEffect(() => {
    if (revealAt < 0) return;
    const el = scroller.current!;
    const top = revealAt * FILES_ROW_HEIGHT;
    const height = el.clientHeight || el.offsetHeight; // happy-dom lays nothing out: its offsetHeight is the tests' viewport
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + FILES_ROW_HEIGHT > el.scrollTop + height) el.scrollTop = top + FILES_ROW_HEIGHT - height;
    useTreeState.getState().revealed(appSessionId);
  }, [revealAt, appSessionId]);
  // UX wave U6b-3a (S2; M2 decision 4): when the Changed group gains or loses rows while a tree row is the first row in
  // view, the offset moves by the same height, so the tree does not move under the person's eyes as the agent writes. A
  // press on the heading moves nothing, nor does a group that changes while the list is at its top (it grows in view) or
  // while an offset is being restored.
  const treeAt = rows.findIndex((row) => row.kind !== 'changed-heading' && row.kind !== 'changed');
  const sectionLength = treeAt < 0 ? rows.length : treeAt;
  const sectionFolded = rows[0]?.kind === 'changed-heading' && rows[0].folded;
  const drawnSection = useRef({ length: sectionLength, folded: sectionFolded });
  useLayoutEffect(() => {
    const last = drawnSection.current;
    drawnSection.current = { length: sectionLength, folded: sectionFolded };
    if (last.length === sectionLength || last.folded !== sectionFolded || pending.current !== null) return;
    const el = scroller.current!;
    if (el.scrollTop <= 0 || Math.floor(el.scrollTop / FILES_ROW_HEIGHT) < last.length) return;
    el.scrollTop = Math.max(0, el.scrollTop + (sectionLength - last.length) * FILES_ROW_HEIGHT);
  }, [sectionLength, sectionFolded]);
  const scrolledByOwner = () => {
    pending.current = null;
    useTreeState.getState().revealed(appSessionId);
  };
  return (
    <div ref={scroller} data-files-scroller onWheel={scrolledByOwner} onPointerDown={scrolledByOwner} onKeyDown={scrolledByOwner} className="min-h-0 flex-1 overflow-auto">
      <div ref={measureWidth} className="relative w-full">
        <div role="tree" aria-label={FILES_COPY.title} style={{ height: total }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            return (
              <div key={item.key} className={`absolute inset-x-0 flex items-center ${item.index === rootAt ? 'pr-8' : 'pr-1'}`} style={{ top: item.start, height: FILES_ROW_HEIGHT }}>
                {row.kind === 'changed-heading' ? (
                  <ChangedHeading count={row.count} folded={row.folded} fold={changed.fold} />
                ) : row.kind === 'changed' ? (
                  <ChangedItem row={row.row} changed={changed} width={width} fonts={fonts} />
                ) : (
                  <Row row={row} marks={changed.marks} selected={selected !== null && row.kind !== 'notice' && sameFile(row.path, selected)} activate={activate} keepRow={keepRow} />
                )}
              </div>
            );
          })}
        </div>
        {rootAt >= 0 && (
          <div className="absolute right-1" style={{ top: rootAt * FILES_ROW_HEIGHT }}>
            <RefreshButton refresh={refresh} />
          </div>
        )}
      </div>
    </div>
  );
}

// E11: what main says of a session it cannot place (a New chat with no project yet): the pane's no-session sentence,
// not an error.
const UNKNOWN_SESSION = 'unknown app session';

function RefreshButton({ refresh }: { refresh(): void }) {
  return <button type="button" aria-label={FILES_COPY.refresh} title={FILES_COPY.refresh} onClick={refresh} className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2"><RefreshIcon className="size-3.5" /></button>;
}

function RootsFailure({ message }: { message: string }) {
  if (message.startsWith(UNKNOWN_SESSION)) return <p className="px-3 py-2 text-ui-sm text-fg-muted">{FILES_COPY.noSession}</p>;
  return (
    <p role="alert" className="px-3 py-2 text-ui-sm text-danger">
      {message === REFUSAL ? FILES_COPY.refused(message) : FILES_COPY.couldNotList(message)}
    </p>
  );
}

const indent = (depth: number) => ({ paddingLeft: 8 + depth * 12 });

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={`size-3 shrink-0 text-fg-faint transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

// A letter's words, Review's (`REVIEW_COPY.kinds`): after a name for a screen reader, and as the letter's title.
const KIND: Record<ChangeLetter, string> = {
  M: REVIEW_COPY.kinds.modified,
  A: REVIEW_COPY.kinds.added,
  U: REVIEW_COPY.kinds.untracked,
  D: REVIEW_COPY.kinds.deleted,
  R: REVIEW_COPY.kinds.renamed,
  '!': REVIEW_COPY.kinds.conflict,
};

// UX wave U6b-3a (decision 9): the mark's slot at the row's end, 16 px after the row's gap, only on a row that carries a
// letter or a dot; hidden from a screen reader, which hears the state after the name. `plain`: the selected row, whose
// letter takes the row's own colour.
function Mark({ letter, dot, plain }: { letter: ChangeLetter | null; dot: ChangeLetter | null; plain: boolean }) {
  if (letter !== null) {
    return (
      <span data-mark aria-hidden="true" title={KIND[letter]} className={`ml-auto inline-flex w-4 shrink-0 justify-center text-ui-sm font-semibold ${plain ? '' : LETTER_TONE[letter]}`}>
        {letter}
      </span>
    );
  }
  if (dot === null) return null;
  return (
    <span data-mark aria-hidden="true" className={`ml-auto inline-flex w-4 shrink-0 items-center justify-center ${LETTER_TONE[dot]}`}>
      <span className="size-1.5 rounded-full bg-current" />
    </span>
  );
}

// UX wave U6b-3a (decision 11; the owner's answer on the card): the Changed group's heading, a button that folds the
// group to its one line; its chevron at the tree's root indent, as a root's row has one.
function ChangedHeading({ count, folded, fold }: { count: number; folded: boolean; fold(folded: boolean): void }) {
  return (
    <button
      type="button"
      role="treeitem"
      aria-level={1}
      aria-expanded={!folded}
      aria-selected={false}
      data-files-changed=""
      data-count={count}
      onClick={() => fold(!folded)}
      className="flex h-full min-w-0 flex-1 items-center gap-1.5 truncate pr-2 text-left text-ui-sm text-fg-muted hover:bg-bg-hover"
      style={indent(0)}
    >
      <Chevron open={!folded} />
      <span className="truncate">{FILES_COPY.changed(count)}</span>
    </button>
  );
}

// What a Changed row leaves of its width for the folder, besides its name: the list row's end (pr-1), the button's end
// (pr-2), one level's indent, the gap between the name and the folder, and the gap and slot of its letter.
export const CHANGED_ROW_FIXED = 4 + 8 + 20 + 6 + 6 + 16;

// UX wave U6b-3a (decisions 6 and 8): a Changed row, one level in: its name, then its folder in the muted colour, cut at
// its start where it does not fit and gone below two characters of room, then its letter.
function ChangedItem({ row, changed, width, fonts }: { row: ChangedRow; changed: ChangedProps; width: number; fonts: { name: string; folder: string } }) {
  const label = labelOf(row, changed.working);
  const outside = expandTo(changed.rootPaths, row.path) === null;
  const oldPath = row.oldRel === null ? null : row.path.slice(0, row.path.length - row.rel.length) + row.oldRel;
  const title = outside
    ? FILES_COPY.outside(`${row.rel}${row.folder ? '/' : ''}`)
    : row.letter === 'R' && oldPath !== null && row.oldRel !== null
      ? REVIEW_COPY.renamedFrom(shownPath(oldPath, row.oldRel, changed.working))
      : label.shown;
  // The folder gives way first; until the list has a width (its first layout) it is drawn whole.
  const folder = label.folder === '' || width <= 0 ? label.folder : folderFromEnd(label.folder, width - CHANGED_ROW_FIXED - measureIn(fonts.name)(label.name), measureIn(fonts.folder));
  return (
    <button
      type="button"
      role="treeitem"
      aria-level={2}
      aria-selected={false}
      data-changed-row=""
      data-path={row.path}
      data-letter={row.letter}
      data-folder={row.folder ? '' : undefined}
      data-outside={outside ? '' : undefined}
      title={title}
      onClick={(event) => changed.activate(row, event.metaKey)}
      onDoubleClick={() => changed.keep(row)}
      className="flex h-full min-w-0 flex-1 items-center gap-1.5 overflow-hidden pr-2 text-left text-ui text-fg hover:bg-bg-hover"
      style={indent(1)}
    >
      <span data-name className="truncate">
        {label.name}
      </span>
      {folder ? <span className="shrink-0 whitespace-nowrap text-ui-sm text-fg-muted">{folder}</span> : null}
      <span className="sr-only"> {KIND[row.letter]}</span>
      <Mark letter={row.letter} dot={null} plain={false} />
    </button>
  );
}

function Row({ row, marks, selected, activate, keepRow }: { row: ListedRow; marks: Marks; selected: boolean; activate: (row: TreeRow, main: boolean) => void; keepRow: (row: TreeRow) => void }) {
  if (row.kind === 'notice') {
    const text =
      row.notice === 'empty'
        ? FILES_COPY.empty
        : row.notice === 'truncated'
          ? FILES_COPY.truncated
          : row.notice === 'refused'
            ? FILES_COPY.refused(row.message ?? REFUSAL)
            : FILES_COPY.couldNotList(row.message ?? '');
    return (
      <div data-notice={row.notice} className="flex h-full items-center gap-2 truncate text-ui-sm text-fg-muted" style={indent(row.depth + 1)}>
        <span className={row.notice === 'refused' || row.notice === 'error' ? 'text-danger' : ''}>{text}</span>
        {row.notice === 'refused' ? <span className="truncate font-mono text-fg-faint">{row.path}</span> : null}
      </div>
    );
  }
  const directory = row.kind === 'root' || row.entry.kind === 'dir';
  const name = row.kind === 'root' ? row.name : row.entry.name;
  const secondary =
    row.kind === 'root' ? row.role : row.entry.kind === 'symlink' ? FILES_COPY.symlink(row.entry.target) : null;
  const inert = row.kind === 'entry' && (row.entry.kind === 'symlink' || row.entry.kind === 'other');
  // UX wave U6b-3a (decisions 9 and 15): a changed entry's letter, a dot on a folder with a change beneath it and no letter
  // of its own, and an entry git ignores muted (the selected row keeps its own colour)
  const letter = marks.letter(row.path);
  const dot = directory && letter === null ? marks.dot(row.path) : null;
  const ignored = row.kind === 'entry' && row.entry.ignored === true;
  const state = letter !== null ? KIND[letter] : dot !== null ? FILES_COPY.containsChanges : null;
  return (
    <button
      type="button"
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={directory ? row.expanded : undefined}
      aria-selected={selected}
      data-path={row.path}
      data-kind={row.kind === 'root' ? 'root' : row.entry.kind}
      data-letter={letter ?? undefined}
      data-dot={dot ?? undefined}
      data-ignored={ignored ? '' : undefined}
      title={row.path}
      onClick={(event) => activate(row, event.metaKey)}
      onDoubleClick={() => keepRow(row)}
      className={`flex h-full min-w-0 flex-1 items-center gap-1.5 truncate pr-2 text-left text-ui hover:bg-bg-hover ${selected ? 'bg-bg-active text-fg' : inert ? 'text-fg-muted' : 'text-fg'}`}
      style={indent(row.depth)}
    >
      {directory ? <Chevron open={row.expanded} /> : <span className="size-3 shrink-0" />}
      <span data-name className={`truncate ${row.kind === 'root' ? 'font-medium' : ''} ${ignored && !selected ? 'text-fg-muted' : ''}`}>
        {name}
      </span>
      {secondary ? <span className="truncate text-ui-sm text-fg-faint">{secondary}</span> : null}
      {ignored ? <span className="sr-only"> {FILES_COPY.ignored}</span> : null}
      {state !== null ? <span className="sr-only"> {state}</span> : null}
      <Mark letter={letter} dot={dot} plain={selected} />
    </button>
  );
}

export const filesTool: PanelTool<FilesState, FilesParams> = {
  id: FILES_TOOL_ID,
  title: 'Files',
  icon: FilesIcon,
  pinnable: true, // the tree-only tab; a tab that holds a file never (the layout store's gate)
  multiInstance: true,
  createState,
  reuse,
  beforeClose, // the tree alone: nothing to lose; a file: the question a main file tab asks
  dispose: () => {}, // the watches are the mounted tree's, released when it unmounts (after the grace)
  render: FilesBody,
};
