// The `fileTab` slot (C8c execution document, Interfaces *Viewer kinds and caps*; K4, the only reader of file bytes in
// the renderer): a thin static shell over the viewer store that draws a file by its kind, read-only. CodeMirror loads
// on first use behind React.lazy (ruled 2026-09-29, O2), under the `Loading` notice. A tab with no session (or one main
// does not know) can only say so, since the allowlist is per session.
import { lazy, Suspense, useEffect } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { TabRef } from '@shared/ipc/schema/layout';
import { opensExternally } from '@shared/ipc/schema/files';
import { VIEWER_COPY } from '../copy';
import '../code.css';
import { ExternalRow, OpenExternally } from './ExternalRow';
import { ImageView } from './ImageView';
import { CODE_CAP } from './kinds';
import { MarkdownView } from './MarkdownView';
import { useViewer, type ViewerEntry } from './viewer-store';

const CodeView = lazy(() => import('./CodeView'));

type FileTab = Extract<TabRef, { kind: 'file' }>;

const bar = 'flex h-8 shrink-0 items-center gap-2 border-b border-border bg-bg px-3 text-ui-sm';
const toggle = 'rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg-muted hover:bg-bg-hover hover:text-fg aria-pressed:bg-bg-active aria-pressed:text-fg';

export function FileViewer({ tab }: { tab: FileTab }) {
  if (tab.appSessionId === null) return <NoSession path={tab.path} />;
  return <SessionFile tabId={tab.id} appSessionId={tab.appSessionId} path={tab.path} line={tab.line} />;
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

function SessionFile({ tabId, appSessionId, path, line }: { tabId: string; appSessionId: AppSessionId; path: string; line: number | null }) {
  const found = useViewer((s) => s.entries.get(tabId));
  const wrap = useViewer((s) => s.wrap);
  useEffect(() => useViewer.getState().mount(tabId, { appSessionId, path, line }), [tabId, appSessionId, path, line]);
  const entry = found && found.appSessionId === appSessionId && found.path === path ? found : null;

  if (entry?.status === 'error' && entry.error?.startsWith('unknown app session')) return <NoSession path={path} />;
  return (
    <div data-file-viewer data-path={path} data-kind={entry?.kind ?? ''} className="flex h-full min-h-0 flex-col bg-bg">
      <div className={bar}>
        <span className="min-w-0 flex-1 truncate font-mono text-fg-muted" title={path}>
          {path}
        </span>
        {entry ? <Notices entry={entry} /> : null}
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
