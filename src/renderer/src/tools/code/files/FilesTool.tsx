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
// is gone with its two waiting states.
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { workingFolder } from '@shared/sessions/working-folder';
import type { PanelTool, PanelToolContext, PanelToolInit } from '../../../panel/tool';
import { machineFor } from '../../../ipc/machine';
import { useLayout } from '../../../stores/layout';
import { paramsHoldFile } from '../../../stores/layout-model';
import { FILES_COPY, REFUSAL } from '../copy';
import { openFile } from '../open-file';
import { FileViewer } from '../viewer/FileViewer';
import { listingKey, useFiles } from './store';
import { fileKey, fileOfTab, FILES_TOOL_ID, type FilesTabParams } from './tabs';
import { firstRoot, roleOf, rootsFor, rowsOf, workingRoot, type RootRole, type TreeRow } from './tree';
import { useSetup } from '../../../sessions/store'; // E11
import type { SetupIntent } from '@shared/sessions/intent'; // E11

export { FILES_TOOL_ID };
export const FILES_ROW_HEIGHT = 24;

// What an add of Files is given: a file to show (`openFile`'s), or nothing for the tree. A restored tab's params are
// whatever the layout holds for it (X5), read through `fileOfTab`.
export type FilesParams = FilesTabParams | undefined;

export interface FilesView {
  expanded: ReadonlySet<string>;
  selected: string | null;
  scrollTop: number;
  defaultRoot: string | null;
}

export interface FilesUi {
  views: Readonly<Record<string, FilesView>>; // by session: a pinned tool keeps each session's tree as it left it
}

export interface FilesState {
  readonly tabId: string;
  readonly ui: StoreApi<FilesUi>;
}

const EMPTY_VIEW: FilesView = { expanded: new Set(), selected: null, scrollTop: 0, defaultRoot: null };
const viewOf = (ui: FilesUi, appSessionId: AppSessionId): FilesView => ui.views[appSessionId] ?? EMPTY_VIEW;

function patchView(ui: StoreApi<FilesUi>, appSessionId: AppSessionId, next: (view: FilesView) => Partial<FilesView>): void {
  ui.setState((s) => {
    const view = viewOf(s, appSessionId);
    return { views: { ...s.views, [appSessionId]: { ...view, ...next(view) } } };
  });
}

const toggled = (set: ReadonlySet<string>, path: string): ReadonlySet<string> => {
  const next = new Set(set);
  if (!next.delete(path)) next.add(path);
  return next;
};

// A tab opened now with a file stores it first, before the host lists the tab; a restored tab's are in the layout already.
function createState({ instanceId, params, restored }: PanelToolInit<FilesParams>): FilesState {
  if (!restored && paramsHoldFile(params)) useLayout.getState().setPanelParams(instanceId, params);
  return { tabId: instanceId, ui: createStore<FilesUi>()(() => ({ views: {} })) };
}

// Decision 21: an add with no file re-targets the scope's first tab that holds no file (the pinned tree, else the
// session's own); an add with a file always makes its own tab.
function reuse(refs: readonly { id: string }[], params: FilesParams): string | null {
  if (paramsHoldFile(params)) return null;
  const held = useLayout.getState().panelParams;
  return refs.find((ref) => !paramsHoldFile(held[ref.id]))?.id ?? null;
}

export function FilesIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round">
      <path d="M1.5 4a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.5h5.5A1.5 1.5 0 0 1 14.5 5.5V12a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 12z" />
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
  if (held) return <div data-files-tab data-file={held.file} className="h-full min-h-0"><SideFile appSessionId={ctx.appSessionId} held={held} /></div>;
  return <div data-files-tab data-file="" className="h-full min-h-0"><SessionTree key={ctx.appSessionId} ui={state.ui} appSessionId={ctx.appSessionId} session={ctx.session} /></div>;
}

// The file a side tab holds, drawn as a main file tab draws it (law 3): the same viewer and its bar, under the key the
// file's main tab would have.
function SideFile({ appSessionId, held }: { appSessionId: AppSessionId; held: FilesTabParams }) {
  const machine = machineFor(appSessionId);
  return <FileViewer tab={{ id: fileKey(machine, held.file), kind: 'file', path: held.file, line: held.line, appSessionId, machine, pinned: false }} />;
}

function SessionTree({ ui, appSessionId, session }: { ui: StoreApi<FilesUi>; appSessionId: AppSessionId; session: SessionRecord | null }) {
  const view = useStore(ui, (s) => viewOf(s, appSessionId));
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
  useEffect(() => {
    if (defaultRoot === null || view.defaultRoot === defaultRoot) return;
    patchView(ui, appSessionId, (current) => ({ defaultRoot, expanded: new Set([...current.expanded, defaultRoot]) }));
  }, [defaultRoot, view.defaultRoot, ui, appSessionId]);

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

  const activate = (row: TreeRow) => {
    if (row.kind === 'notice') return;
    const directory = row.kind === 'root' || row.entry.kind === 'dir';
    // Expanding a directory whose listing failed asks again (a refused root stays expandable for a retry).
    if (directory && !row.expanded && useFiles.getState().listing(appSessionId, row.path)?.status === 'error') useFiles.getState().list(appSessionId, row.path);
    patchView(ui, appSessionId, (v) => ({ selected: row.path, ...(directory ? { expanded: toggled(v.expanded, row.path) } : {}) }));
    if (row.kind === 'entry' && row.entry.kind === 'file') openFile(appSessionId, row.path, null);
  };
  const refresh = () => {
    useFiles.getState().list(appSessionId, null);
    for (const path of view.expanded) useFiles.getState().list(appSessionId, path);
  };

  return (
    <div data-tool="files" className="flex h-full min-h-0 flex-col">
      {roots?.status === 'error' ? <div className="flex items-center justify-between pr-1"><RootsFailure message={roots.message} /><RefreshButton refresh={refresh} /></div> : null}
      <TreeList rows={rows} selected={view.selected} activate={activate} ui={ui} appSessionId={appSessionId} refresh={refresh} />
    </div>
  );
}

// The rows as one virtual list. Its own component because the React Compiler skips any component that calls
// `useVirtualizer` (its API returns functions it cannot memoise); the tree above stays compiled.
function TreeList({
  rows,
  selected,
  activate,
  ui,
  appSessionId,
  refresh,
}: {
  rows: TreeRow[];
  selected: string | null;
  activate: (row: TreeRow) => void;
  ui: StoreApi<FilesUi>;
  appSessionId: AppSessionId;
  refresh(): void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const getItemKey = useCallback((index: number) => rows[index].key, [rows]);
  // eslint-disable-next-line react-hooks/incompatible-library -- see above
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => FILES_ROW_HEIGHT,
    getItemKey,
    overscan: 12,
  });
  // The scroll offset lives in the tool's state across unmounts (the host mounts only the selected tab): restored once
  // per mount, written back on unmount. A tab hidden past the watch grace comes back with its directories unlisted, so
  // the scroller clamps the offset to the rows there are; the offset is then pending, re-applied as the rows arrive
  // until the content reaches it once, and dropped if the owner scrolls first. Unmounted while pending, it keeps it.
  const pending = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current!;
    const saved = viewOf(ui.getState(), appSessionId).scrollTop;
    el.scrollTop = saved;
    pending.current = el.scrollTop < saved ? saved : null;
    return () => {
      const kept = pending.current ?? el.scrollTop;
      patchView(ui, appSessionId, () => ({ scrollTop: kept }));
    };
  }, [ui, appSessionId]);
  const total = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    const want = pending.current;
    if (want === null) return;
    const el = scroller.current!;
    el.scrollTop = want;
    if (el.scrollTop >= want) pending.current = null;
  }, [total]);
  const scrolledByOwner = () => void (pending.current = null);
  return (
    <div ref={scroller} data-files-scroller onWheel={scrolledByOwner} onPointerDown={scrolledByOwner} onKeyDown={scrolledByOwner} className="min-h-0 flex-1 overflow-auto">
      <div className="relative w-full">
        <div role="tree" aria-label={FILES_COPY.title} style={{ height: total }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            return (
              <div key={item.key} className={`absolute inset-x-0 flex items-center ${item.index === 0 && row.kind === 'root' ? 'pr-8' : 'pr-1'}`} style={{ top: item.start, height: FILES_ROW_HEIGHT }}>
                <Row row={row} selected={selected === row.path && row.kind !== 'notice'} activate={activate} />
              </div>
            );
          })}
        </div>
        {rows[0]?.kind === 'root' && <div className="absolute top-0 right-1"><RefreshButton refresh={refresh} /></div>}
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

function Row({ row, selected, activate }: { row: TreeRow; selected: boolean; activate: (row: TreeRow) => void }) {
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
  return (
    <button
      type="button"
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={directory ? row.expanded : undefined}
      aria-selected={selected}
      data-path={row.path}
      data-kind={row.kind === 'root' ? 'root' : row.entry.kind}
      title={row.path}
      onClick={() => activate(row)}
      className={`flex h-full min-w-0 flex-1 items-center gap-1.5 truncate pr-2 text-left text-ui hover:bg-bg-hover ${selected ? 'bg-bg-active text-fg' : inert ? 'text-fg-muted' : 'text-fg'}`}
      style={indent(row.depth)}
    >
      {directory ? <Chevron open={row.expanded} /> : <span className="size-3 shrink-0" />}
      <span className={`truncate ${row.kind === 'root' ? 'font-medium' : ''}`}>{name}</span>
      {secondary ? <span className="truncate text-ui-sm text-fg-faint">{secondary}</span> : null}
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
  beforeClose: async () => true, // read-only: nothing to lose
  dispose: () => {}, // the watches are the mounted tree's, released when it unmounts (after the grace)
  render: FilesBody,
};
