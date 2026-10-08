// The `fileTab` slot (C8c execution document, Interfaces *Viewer kinds and caps*; K4, the only reader of file bytes in
// the renderer): a thin static shell over the viewer store that draws a file by its kind, read-only. CodeMirror loads
// on first use behind React.lazy (ruled 2026-09-29, O2), under the `Loading` notice. A tab with no session (or one main
// does not know) can only say so, since the allowlist is per session.
//
// E5: a code view of an editable entry edits; the bar carries the editor's controls (`editor/EditorControls.tsx`), and
// the viewer says what it holds as data attributes (`data-editable`, `data-dirty`, `data-theirs`, and `data-loads` with
// `data-pending`, the entry's completed and in-flight loads: an e2e's barrier for the re-reads after an own save).
//
// E2 (E2 execution document, Design §3): the body is `FileBody` (the mount, the notices, the Wrap and Source controls and
// the content), which the deliverables viewer mounts read-only under its own header; the file tab adds the path at the
// bar's start and E5's editor controls beside the notices.
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { TabRef } from '@shared/ipc/schema/layout';
import { opensExternally } from '@shared/ipc/schema/files';
import { VIEWER_COPY } from '../copy';
import '../code.css';
import { EditorControls } from '../editor/EditorControls';
import { ExternalRow, OpenExternally } from './ExternalRow';
import { ImageView } from './ImageView';
import { CODE_CAP } from './kinds';
import { MarkdownView } from './MarkdownView';
import { useViewer, type ViewerEntry } from './viewer-store';

const CodeView = lazy(() => import('./CodeView'));

type FileTab = Extract<TabRef, { kind: 'file' }>;

const bar = 'flex h-8 shrink-0 items-center gap-2 border-b border-border bg-bg px-3 text-ui-sm';
const toggle = 'rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg-muted hover:bg-bg-hover hover:text-fg aria-pressed:bg-bg-active aria-pressed:text-fg';

// The path at the bar's start: its directory truncates first and the basename stays whole, so the controls, which keep
// their size, take the directory's width and never the file's name (E11 W-D: the merge bar at a ~600 px viewer). The
// lead's least width is the basename's, in the mono font's character widths (a name wider than the lead, past 40
// characters, is cut by its own box, at most the lead's width, so it ends in an ellipsis; the title carries the whole
// path).
const NAME_MIN_CH = 40;

function PathLead({ path }: { path: string }) {
  const cut = path.lastIndexOf('/') + 1;
  const name = path.slice(cut);
  return (
    <span data-path-lead className="flex flex-1 overflow-hidden font-mono text-fg-muted" style={{ minWidth: `${Math.min(name.length, NAME_MIN_CH)}ch` }} title={path}>
      {cut > 0 ? <span className="min-w-0 truncate">{path.slice(0, cut)}</span> : null}
      <span data-path-name className="min-w-0 max-w-full shrink-0 truncate">
        {name}
      </span>
    </span>
  );
}

export function FileViewer({ tab }: { tab: FileTab }) {
  if (tab.appSessionId === null) return <NoSession path={tab.path} />;
  const lead = <PathLead path={tab.path} />;
  return <FileBody tabId={tab.id} appSessionId={tab.appSessionId} path={tab.path} line={tab.line} lead={lead} controls={(entry) => <EditorControls entry={entry} />} />;
}

function NoSession({ path }: { path: string }) {
  return (
    <div data-file-viewer data-path={path} className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
      <p className="font-mono text-ui-sm text-fg-muted break-all">{path}</p>
      <p className="text-ui text-fg">{VIEWER_COPY.noSession}</p>
    </div>
  );
}

function Refused({ path, message }: { path: string; message: string }) {
  return (
    <div role="alert" data-refusal className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
      <p className="text-ui text-fg">{VIEWER_COPY.refused(message)}</p>
      <p className="font-mono text-ui-sm text-fg-muted break-all">{path}</p>
    </div>
  );
}

const Loading = () => <p className="p-4 text-ui text-fg-muted">{VIEWER_COPY.loading}</p>;

interface FileBodyProps {
  tabId: string; // the viewer store's key: a file tab's id, or the deliverables viewer's `deliverable:<id>:v<n>`
  appSessionId: AppSessionId;
  path: string;
  line?: number | null;
  readOnly?: boolean; // E2: never editable (the viewer store's mount option)
  lead?: ReactNode; // the bar's start (the file tab's path); without one the notices lead and the controls keep right
  controls?: (entry: ViewerEntry) => ReactNode; // beside the notices (the file tab's editor controls)
}

export function FileBody({ tabId, appSessionId, path, line = null, readOnly = false, lead, controls }: FileBodyProps) {
  const found = useViewer((s) => s.entries.get(tabId));
  const wrap = useViewer((s) => s.wrap);
  useEffect(() => useViewer.getState().mount(tabId, { appSessionId, path, line, readOnly }), [tabId, appSessionId, path, line, readOnly]);
  const entry = found && found.appSessionId === appSessionId && found.path === path ? found : null;

  if (entry?.status === 'error' && entry.error?.startsWith('unknown app session')) return <NoSession path={path} />;
  return (
    <div
      data-file-viewer
      data-path={path}
      data-kind={entry?.kind ?? ''}
      data-editable={String(entry !== null && entry.editable && showsCode(entry))}
      data-dirty={String(entry?.dirty ?? false)}
      data-theirs={entry?.theirs?.view ?? ''}
      data-loads={entry?.loads ?? 0}
      data-pending={entry?.pending ?? 0}
      className="flex h-full min-h-0 flex-col bg-bg"
    >
      <div className={bar}>
        {lead ?? <span className="flex-1" />}
        {entry ? <Notices entry={entry} /> : null}
        {entry ? controls?.(entry) : null}
        {entry ? <Controls entry={entry} wrap={wrap} /> : null}
      </div>
      <div className="relative min-h-0 flex-1">{entry ? <Body entry={entry} wrap={wrap} /> : <Loading />}</div>
    </div>
  );
}

const showsCode = (entry: ViewerEntry) => entry.kind === 'code' || entry.kind === 'head' || (entry.sourceView && (entry.kind === 'markdown' || entry.kind === 'image'));
const hasSource = (entry: ViewerEntry) => entry.kind === 'markdown' || (entry.kind === 'image' && entry.encoding === 'utf8');

function Body({ entry, wrap }: { entry: ViewerEntry; wrap: boolean }) {
  if (entry.status === 'loading') return <Loading />;
  if (entry.status === 'error') return <Refused path={entry.path} message={entry.error ?? ''} />;
  if (showsCode(entry)) {
    return (
      <Suspense fallback={<Loading />}>
        <CodeView entry={entry} wrap={wrap} />
      </Suspense>
    );
  }
  if (entry.kind === 'markdown') return <MarkdownView entry={entry} />;
  if (entry.kind === 'image') return <ImageView entry={entry} />;
  return <ExternalRow entry={entry} />;
}

// The one notice a file carries: removed, a bounded head, or a load still completing.
const noticeOf = (entry: ViewerEntry): string | null =>
  entry.removed ? VIEWER_COPY.removed : entry.kind === 'head' ? VIEWER_COPY.head(entry.loaded, entry.bytes) : entry.complete ? null : VIEWER_COPY.continuing(entry.loaded, entry.bytes);

function Notices({ entry }: { entry: ViewerEntry }) {
  if (entry.status !== 'ready') return null;
  const notice = noticeOf(entry);
  return (
    <>
      {notice ? (
        <span role="status" data-notice={notice} className={`shrink-0 ${entry.removed ? 'text-warning' : 'text-fg-muted'}`}>
          {notice}
        </span>
      ) : null}
      {entry.updated > 0 && !entry.removed ? (
        <span key={entry.updated} data-updated className="code-updated shrink-0 text-fg-faint">
          {VIEWER_COPY.updated}
        </span>
      ) : null}
    </>
  );
}

function Controls({ entry, wrap }: { entry: ViewerEntry; wrap: boolean }) {
  if (entry.status !== 'ready') return null;
  const { tabId } = entry;
  const more = entry.kind === 'head' && entry.loaded < Math.min(CODE_CAP, entry.bytes);
  return (
    <span className="flex shrink-0 items-center gap-1">
      {more ? (
        <button type="button" className={toggle} disabled={entry.loadingMore} onClick={() => useViewer.getState().loadMore(tabId)}>
          {VIEWER_COPY.loadMore}
        </button>
      ) : null}
      {entry.kind === 'head' && opensExternally(entry.path) ? <OpenExternally appSessionId={entry.appSessionId} path={entry.path} /> : null}
      {hasSource(entry) ? (
        <button type="button" className={toggle} aria-pressed={entry.sourceView} onClick={() => useViewer.getState().toggleSource(tabId)}>
          {entry.sourceView ? VIEWER_COPY.rendered : VIEWER_COPY.source}
        </button>
      ) : null}
      {showsCode(entry) ? (
        <button type="button" className={toggle} aria-pressed={wrap} onClick={() => useViewer.getState().setWrap(!wrap)}>
          {VIEWER_COPY.wrap}
        </button>
      ) : null}
    </span>
  );
}
