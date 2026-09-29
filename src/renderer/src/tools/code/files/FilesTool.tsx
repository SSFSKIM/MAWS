// The Files tool (C8c execution document, Interfaces *Tools, slots and the open-file seam*; M2's decisions): the
// session's roots as a tree, one root per directory the session may read, listed lazily as directories expand and kept
// current by `files.changed` for the expanded ones; `.git` hidden as a root's child, dotfiles shown, symlinks named and
// not followed. A click on a directory toggles it, on a file opens the viewer in the main area. X5: `id: 'files'`,
// pinnable, single-instance, `params { path?, line? }`, no summary. Its state is a store handle (C8a's React Compiler
// rule): the expansion, selection and scroll per session, and a reveal `open` asked for.
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { IconButton } from '../../../app/IconButton';
import type { PanelTool, PanelToolContext, PanelToolInit } from '../../../panel/tool';
import { FILES_COPY, REFUSAL } from '../copy';
import { normalizeLexically, openFile } from '../open-file';
import { listingKey, useFiles } from './store';
import { dirname, expandTo, roleOf, rootsFor, rowsOf, type RootRole, type TreeRow } from './tree';

export const FILES_TOOL_ID = 'files';
export const FILES_ROW_HEIGHT = 24;

export interface FilesParams {
  path?: string;
  line?: number;
}

export interface FilesView {
  expanded: ReadonlySet<string>;
  selected: string | null;
  scrollTop: number;
}

export interface FilesUi {
  views: Readonly<Record<string, FilesView>>; // by session: a pinned tool keeps each session's tree as it left it
  reveal: { path: string; line: number | null } | null; // asked by `open`, resolved against the shown session's roots
  pendingOpen: { path: string; line: number | null } | null; // revealed; opened once its directory's listing says it is a file
}

export interface FilesState {
  readonly ui: StoreApi<FilesUi>;
}

const EMPTY_VIEW: FilesView = { expanded: new Set(), selected: null, scrollTop: 0 };
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

// `params` is undefined for a tab restored from layout.json (X5).
function createState({ params }: PanelToolInit<FilesParams>): FilesState {
  const ui = createStore<FilesUi>()(() => ({ views: {}, reveal: null, pendingOpen: null }));
  if (params?.path) ui.setState({ reveal: { path: normalizeLexically(params.path), line: params.line ?? null } });
  return { ui };
}

// Re-targeting (X5): reveal the path in the shown session's tree and, for a file, open the viewer at the line.
function open(state: FilesState, params: FilesParams): void {
  if (params?.path) state.ui.setState({ reveal: { path: normalizeLexically(params.path), line: params.line ?? null } });
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

function FilesBody({ state, ctx }: { state: FilesState; ctx: PanelToolContext }) {
  if (ctx.appSessionId === null) return <p className="flex h-full items-center justify-center p-4 text-center text-ui text-fg-muted">{FILES_COPY.noSession}</p>;
  return <SessionTree key={ctx.appSessionId} ui={state.ui} appSessionId={ctx.appSessionId} session={ctx.session} />;
}

function SessionTree({ ui, appSessionId, session }: { ui: StoreApi<FilesUi>; appSessionId: AppSessionId; session: SessionRecord | null }) {
  const view = useStore(ui, (s) => viewOf(s, appSessionId));
  const reveal = useStore(ui, (s) => s.reveal);
  const pendingOpen = useStore(ui, (s) => s.pendingOpen);
  const listings = useFiles((s) => s.listings);
  const roots = listings.get(listingKey(appSessionId, null));

  const rootEntries = useMemo(() => (roots?.status === 'ok' ? roots.value.entries : []), [roots]);
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

  useEffect(() => useFiles.getState().list(appSessionId, null), [appSessionId]);
  // Watches follow the expansion set (declared before the listing effect, so a first listing waits for its watch).
  useEffect(() => {
    const holds = [...view.expanded].map((path) => useFiles.getState().watch(appSessionId, path));
    return () => holds.forEach((hold) => hold.release());
  }, [appSessionId, view.expanded]);
  useEffect(() => {
    for (const path of view.expanded) if (!useFiles.getState().listing(appSessionId, path)) useFiles.getState().list(appSessionId, path);
  }, [appSessionId, view.expanded]);

  // A reveal: expand the path's ancestors under its root and select it; a path under no root opens its tab anyway,
  // where the viewer says why it cannot be read.
  useEffect(() => {
    if (!reveal || !roots || roots.status === 'loading') return;
    const target = roots.status === 'ok' ? expandTo(rootEntries.map((root) => root.path), reveal.path) : null;
    if (!target) {
      ui.setState({ reveal: null });
      openFile(appSessionId, reveal.path, reveal.line);
      return;
    }
    const opens = target.ancestors.length === 0 ? [target.path] : target.ancestors;
    ui.setState({ reveal: null, pendingOpen: target.ancestors.length === 0 ? null : { path: target.path, line: reveal.line } });
    patchView(ui, appSessionId, (v) => ({ expanded: new Set([...v.expanded, ...opens]), selected: target.path }));
  }, [reveal, roots, rootEntries, ui, appSessionId]);
  useEffect(() => {
    if (!pendingOpen) return;
    const parent = listings.get(listingKey(appSessionId, dirname(pendingOpen.path)));
    if (!parent || parent.status === 'loading') return;
    const entry = parent.status === 'ok' ? parent.value.entries.find((e) => e.path === pendingOpen.path) : undefined;
    ui.setState({ pendingOpen: null });
    if (entry?.kind === 'dir') patchView(ui, appSessionId, (v) => ({ expanded: new Set([...v.expanded, entry.path]) }));
    else if (!entry || entry.kind === 'file') openFile(appSessionId, pendingOpen.path, pendingOpen.line);
  }, [pendingOpen, listings, ui, appSessionId]);

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
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border pr-1 pl-3 text-ui-sm text-fg-muted">
        <span>{FILES_COPY.title}</span>
        <IconButton label={FILES_COPY.refresh} onClick={refresh}>
          <RefreshIcon className="size-3.5" />
        </IconButton>
      </div>
      {roots?.status === 'error' ? <RootsFailure message={roots.message} /> : null}
      <TreeList rows={rows} selected={view.selected} activate={activate} ui={ui} appSessionId={appSessionId} />
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
}: {
  rows: TreeRow[];
  selected: string | null;
  activate: (row: TreeRow) => void;
  ui: StoreApi<FilesUi>;
  appSessionId: AppSessionId;
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
  // per mount, written back on unmount.
  useLayoutEffect(() => {
    const el = scroller.current!;
    el.scrollTop = viewOf(ui.getState(), appSessionId).scrollTop;
    return () => patchView(ui, appSessionId, () => ({ scrollTop: el.scrollTop }));
  }, [ui, appSessionId]);
  return (
    <div ref={scroller} data-files-scroller className="min-h-0 flex-1 overflow-auto">
      <div role="tree" aria-label={FILES_COPY.title} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          return (
            <div key={item.key} className="absolute inset-x-0" style={{ top: item.start, height: FILES_ROW_HEIGHT }}>
              <Row row={row} selected={selected === row.path && row.kind !== 'notice'} activate={activate} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RootsFailure({ message }: { message: string }) {
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
      className={`flex h-full w-full items-center gap-1.5 truncate pr-2 text-left text-ui hover:bg-bg-hover ${selected ? 'bg-bg-active text-fg' : inert ? 'text-fg-muted' : 'text-fg'}`}
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
  pinnable: true,
  multiInstance: false,
  createState,
  open,
  beforeClose: async () => true, // read-only: nothing to lose
  dispose: () => {}, // the watches are the mounted tree's, released when it unmounts (after the grace)
  render: FilesBody,
};
