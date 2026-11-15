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
// the content), which the File artifact viewer mounts read-only under its own header; the file tab adds the path at the
// bar's start and E5's editor controls beside the notices.
//
// P2-F W-V (L95, §2 item 6): an image's zoom lives here, beside the bar that draws its controls and the view it sizes.
//
// UX wave U6e (docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, §D, "The look"; K1 to K15): a file
// that cannot be saved reads "Read-only" after what the tab puts at the bar's start and before the path, a button whose
// panel gives the reason; a savable outside file carries no label, and its path's tooltip and description say where Save
// writes. Save, Rendered/Source and Wrap are one group; a save's failure takes a line of its own below the path.
import { Popover } from 'radix-ui';
import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { TabRef } from '@shared/ipc/schema/layout';
import { opensExternally } from '@shared/ipc/schema/files';
import { ChevronDownIcon } from '../../../app/IconButton';
import { EDITOR_COPY, OPEN_FILE_COPY, VIEWER_COPY } from '../copy';
import '../code.css';
import { EditorControls, SaveFailure } from '../editor/EditorControls';
import { openChosen } from '../files/open-chosen';
import { ExternalRow, OpenExternally } from './ExternalRow';
import { ImageView } from './ImageView';
import { CODE_CAP } from './kinds';
import { MarkdownView } from './MarkdownView';
import { useMediaZoom, ZoomControls, type MediaZoom } from './MediaZoom';
import { readOnlyReason, useViewer, type ArtifactRead, type ViewerEntry } from './viewer-store';

const CodeView = lazy(() => import('./CodeView'));

type FileTab = Extract<TabRef, { kind: 'file' }>;

// The bar is one line while its parts fit, and wraps rather than clipping them (a pane clips its overflow): the lead
// keeps the basename's width, so in a narrow pane the controls move to a second line (scale review D scalpel-4#1).
const bar = 'flex min-h-8 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-bg px-3 py-1 text-ui-sm';
const toggle = 'rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg-muted hover:bg-bg-hover hover:text-fg aria-pressed:bg-bg-active aria-pressed:text-fg';

// The path at the bar's start: its directory truncates first and the basename stays whole, so the controls, which keep
// their size, take the directory's width and never the file's name (E11 W-D: the merge bar at a ~600 px viewer). The
// lead's least width is the basename's, in the mono font's character widths (a name wider than the lead, past 40
// characters, is cut by its own box, at most the lead's width, so it ends in an ellipsis; the title carries the whole
// path). UX wave U6e (K11; decision 11): the path is cut in its middle with both ends drawn: the folder part keeps two
// characters (its first and the ellipsis, where one character left a stray glyph), the slash before the name stays, and
// the lead's least width counts them, within the 40. A savable outside file's path says where Save writes, as its tooltip
// and its accessible description; `outside` marks how the file stands outside the folders.
const NAME_MIN_CH = 40;
const FOLDER_MIN_CH = 2;

function PathLead({ path, savesTo, outside }: { path: string; savesTo: string | null; outside: string | null }) {
  const cut = path.lastIndexOf('/');
  const name = path.slice(cut + 1);
  const folder = cut > 0 ? path.slice(0, cut) : '';
  const reserve = (cut >= 0 ? 1 : 0) + (folder ? FOLDER_MIN_CH : 0);
  const nameMax = reserve === 0 ? 'max-w-full' : reserve === 1 ? 'max-w-[calc(100%_-_1ch)]' : 'max-w-[calc(100%_-_3ch)]';
  return (
    <span
      data-path-lead
      data-outside={outside ?? undefined}
      className="flex flex-1 overflow-hidden font-mono text-fg-muted"
      style={{ minWidth: `${Math.min(name.length + reserve, NAME_MIN_CH)}ch` }}
      title={savesTo ?? path}
      aria-description={savesTo ?? undefined}
    >
      {folder ? <span className="min-w-[2ch] truncate">{folder}</span> : null}
      {cut >= 0 ? <span className="shrink-0">/</span> : null}
      <span data-path-name className={`min-w-0 ${nameMax} shrink-0 truncate`}>
        {name}
      </span>
    </span>
  );
}

// UX wave U6e (§D): how the file stands outside the folders, for the path's mark: savable, or what keeps it from a save.
function outsideOf(entry: ViewerEntry | null): string | null {
  if (entry === null || !entry.named) return null;
  return entry.locked ?? (entry.pin !== null ? 'writable' : 'outside');
}

type LabelledReason = 'maws' | 'added' | 'result' | 'outside';
const labelled = (reason: ReturnType<typeof readOnlyReason>): reason is LabelledReason => reason === 'maws' || reason === 'added' || reason === 'result' || reason === 'outside';

// UX wave U6e (§D, K2, K5, K8, K10, K11, K13): "Read-only", in the normal text colour, a button whose accessible
// description is the reason's sentence; a press (Enter or Space with the keyboard on it) opens the panel under it with the
// sentence and, under it at the left, where choosing the file makes it editable (only added, named only by a tool's
// result), "Open File…". Decision Log 18: a small chevron after the words, in the muted colour, inside the same button
// and hidden from assistive technology, so the button keeps one target and one accessible name.
// The panel is never wider than the file's column: min(24rem, the column's width less 1rem), the column measured as it
// opens and its edges the panel's boundary.
function ReadOnlyLabel({ reason, appSessionId }: { reason: LabelledReason; appSessionId: AppSessionId }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [column, setColumn] = useState<Element | null>(null);
  const [width, setWidth] = useState(0);
  const sentence = EDITOR_COPY.readOnly[reason];
  const offersOpenFile = reason === 'added' || reason === 'result';
  const opened = (open: boolean) => {
    if (!open) return;
    const at = trigger.current?.closest('[data-file-viewer]') ?? null;
    setColumn(at);
    setWidth(at?.getBoundingClientRect().width ?? 0);
  };
  return (
    <Popover.Root onOpenChange={opened}>
      <Popover.Trigger asChild>
        <button ref={trigger} type="button" data-read-only={reason} aria-description={sentence} className="flex shrink-0 items-center gap-0.5 rounded-sm px-1 py-0.5 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2">
          {VIEWER_COPY.readOnly}
          <span data-read-only-chevron="" aria-hidden="true" className="text-fg-muted">
            <ChevronDownIcon className="size-3" />
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          data-read-only-panel=""
          align="start"
          sideOffset={4}
          collisionPadding={8}
          collisionBoundary={column ?? undefined}
          style={width > 0 ? ({ '--read-only-column': `${width}px` } as CSSProperties) : undefined}
          className="z-50 flex w-[min(24rem,calc(var(--read-only-column,25rem)_-_1rem))] flex-col gap-2 rounded-md border border-border-strong bg-bg-overlay p-3 text-ui-sm text-fg shadow-float"
        >
          <p>{sentence}</p>
          {offersOpenFile ? (
            <Popover.Close asChild>
              <button type="button" className="self-start rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg hover:bg-bg-hover" onClick={() => void openChosen(appSessionId)}>
                {OPEN_FILE_COPY.row}
              </button>
            </Popover.Close>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// UX wave U6b-1 (M3): `start`, what a side tab puts at the bar's start before the path (Files' tree button); (M4) `end`,
// what it puts at the bar's end (Move to main area). UX wave U6e: "Read-only" between the two (K2), drawn from the entry
// as it is drawn (K11); `agent`, the tab holds the mark of an open the agent asked for (decision 19).
export function FileViewer({ tab, start, end, agent = false }: { tab: FileTab; start?: ReactNode; end?: ReactNode; agent?: boolean }) {
  if (tab.appSessionId === null) return <NoSession path={tab.path} />;
  const { appSessionId } = tab;
  const lead = (entry: ViewerEntry | null) => {
    const reason = entry === null ? null : readOnlyReason(entry);
    const savesTo = entry !== null && entry.pin !== null && entry.locked === null ? VIEWER_COPY.savesTo(entry.pin) : null;
    return (
      <>
        {start}
        {labelled(reason) ? <ReadOnlyLabel reason={reason} appSessionId={appSessionId} /> : null}
        <PathLead path={tab.path} savesTo={savesTo} outside={outsideOf(entry)} />
      </>
    );
  };
  return (
    <FileBody
      tabId={tab.id}
      appSessionId={appSessionId}
      path={tab.path}
      line={tab.line}
      agent={agent}
      lead={lead}
      controls={(entry) => (entry.locked === null ? <EditorControls entry={entry} /> : null)}
      below={(entry) => <SaveFailure entry={entry} />}
      end={end}
    />
  );
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
  tabId: string; // the viewer store's key: a file tab's id, or the File artifact viewer's `artifact:<id>:<revision>`
  appSessionId: AppSessionId | null; // P3-L (M6b fix wave 2): null with `artifact`, a file no session made
  path: string;
  line?: number | null;
  readOnly?: boolean; // E2: never editable (the viewer store's mount option)
  artifact?: ArtifactRead; // P3-L (M6b fix wave 2): the file read by its artifact alone (`library.read`)
  // the bar's start (the file tab's path; UX wave U6e: drawn from the entry, null until it exists); without one the
  // notices lead and the controls keep right
  lead?: (entry: ViewerEntry | null) => ReactNode;
  controls?: (entry: ViewerEntry) => ReactNode; // beside the notices (the file tab's editor controls), in the controls' group
  below?: (entry: ViewerEntry) => ReactNode; // UX wave U6e (K1, K14): a line of its own below the path (a save's failure)
  end?: ReactNode; // UX wave U6b-1: the bar's last control (a side tab's Move to main area)
  agent?: boolean; // UX wave U6e (decision 19): the tab holds the agent's mark, and its reads say so
}

export function FileBody({ tabId, appSessionId, path, line = null, readOnly = false, artifact, lead, controls, below, end, agent = false }: FileBodyProps) {
  const found = useViewer((s) => s.entries.get(tabId));
  const wrap = useViewer((s) => s.wrap);
  const zoom = useMediaZoom(`${tabId}\n${path}`);
  const artifactId = artifact?.artifactId;
  const revision = artifact?.revision;
  useEffect(
    () => useViewer.getState().mount(tabId, { appSessionId, path, line, readOnly, agent, ...(artifactId !== undefined && revision !== undefined && { artifact: { artifactId, revision } }) }),
    [tabId, appSessionId, path, line, readOnly, agent, artifactId, revision],
  );
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
        {lead ? lead(entry) : <span className="flex-1" />}
        {entry ? <Notices entry={entry} /> : null}
        {/* UX wave U6e (K3): Save, Rendered/Source and Wrap wrap as one group, at the line's end when it stands alone */}
        {entry ? (
          <span data-bar-controls className="ml-auto flex min-w-0 items-center gap-x-2">
            {controls?.(entry)}
            <Controls entry={entry} wrap={wrap} zoom={zoom} />
          </span>
        ) : null}
        {end}
        {entry ? below?.(entry) : null}
      </div>
      <div className="relative min-h-0 flex-1">{entry ? <Body entry={entry} wrap={wrap} zoom={zoom} /> : <Loading />}</div>
    </div>
  );
}

const showsCode = (entry: ViewerEntry) => entry.kind === 'code' || entry.kind === 'head' || (entry.sourceView && (entry.kind === 'markdown' || entry.kind === 'image'));
const hasSource = (entry: ViewerEntry) => entry.kind === 'markdown' || (entry.kind === 'image' && entry.encoding === 'utf8');

const showsImage = (entry: ViewerEntry) => entry.kind === 'image' && !showsCode(entry);

function Body({ entry, wrap, zoom }: { entry: ViewerEntry; wrap: boolean; zoom: MediaZoom }) {
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
  if (showsImage(entry)) return <ImageView entry={entry} zoom={zoom} />;
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

function Controls({ entry, wrap, zoom }: { entry: ViewerEntry; wrap: boolean; zoom: MediaZoom }) {
  if (entry.status !== 'ready') return null;
  const { tabId } = entry;
  const more = entry.kind === 'head' && entry.loaded < Math.min(CODE_CAP, entry.bytes);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {showsImage(entry) ? <ZoomControls zoom={zoom} /> : null}
      {more ? (
        <button type="button" className={toggle} disabled={entry.loadingMore} onClick={() => useViewer.getState().loadMore(tabId)}>
          {VIEWER_COPY.loadMore}
        </button>
      ) : null}
      {entry.kind === 'head' && opensExternally(entry.path) && entry.appSessionId !== null ? <OpenExternally appSessionId={entry.appSessionId} path={entry.path} agent={entry.agent} /> : null}
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
