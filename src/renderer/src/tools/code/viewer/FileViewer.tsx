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
//
// UX wave U6b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, M5): a PDF, an HTML page, a video or a
// sound is drawn by `FrameBody`, with Open externally in the bar unless its body is a row (which holds its own, or none);
// `data-frame` on the viewer says what the frame shows. `host` says where the tab is drawn (`'side'` beside the chat,
// `'main'` in the main area), and only the PDF's fragment reads it. `inView` false: the tab's body is kept mounted while it
// is not in view (Files' tree in its place, the panel collapsed), and a framed file draws no element (Decision Log 29). A tab
// of the main area is in view while the main area is on screen (the shell's `useMainAreaOnScreen`, Decision Log 35).
//
// UX wave U6b-3b (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3b-go-to-file.md, decision 10, M2 decision 5; S3): a file
// tab's body takes the keyboard under the tab's key (`takesKeyboard`): it is focusable, and when the request for the
// keyboard names its key (Go to file's Enter, `files/finder.ts`) and it is in view, it takes the keyboard on itself and
// hands it to the file's editor at once when one is drawn, or as soon as one is drawn while the body itself still has it.
// A read on its way, a read that failed and a kind with no editor leave it on the body, inside the element ⌘S and the
// comment key look in. Wherever the tab is drawn, beside the chat or in the main area, never on a tab's button.
//
// UX wave U6b-4b (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md, M3; Interfaces §C, decisions 8, 11 and 20, "The
// look"): a file that cannot be read shows the notice of its cause (`notice.ts`) where "Refused: " and the command's words
// stood: the sentences, the path (with Copy path where the path is outside the folders), Retry where reading again can
// help, and the command's own words last, small. A folder macOS protects on another machine keeps U6f's sentence and
// button inside the same block, the classifier not asked.
import { Popover } from 'radix-ui';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { TabRef } from '@shared/ipc/schema/layout';
import { opensExternally } from '@shared/ipc/schema/files';
import { ChevronDownIcon } from '../../../app/IconButton';
import { useMainAreaOnScreen } from '../../../app/shell-view'; // UX wave U6b-2 (Decision Log 35)
import { NOTICE_COPY, OPEN_FILE_COPY, VIEWER_COPY } from '../copy';
import '../code.css';
import { EditorControls, SaveFailure } from '../editor/EditorControls';
import { useRemoteStanding } from '../../../lane-b/remote-standing';
import { useTakesRemoteRoute } from '../files/elsewhere';
import { takeKeyboard, useKeyboardRequest } from '../files/finder';
import { openChosenFor } from '../files/open-chosen';
import { ExternalRow, OpenExternally, rowButton } from './ExternalRow';
import { FrameBody } from './FrameBody';
import { ImageView } from './ImageView';
import { CODE_CAP } from './kinds';
import { MarkdownView } from './MarkdownView';
import { useMediaZoom, ZoomControls, type MediaZoom } from './MediaZoom';
import { classifyFailure } from './notice'; // UX wave U6b-4b
import { useNoticePlace } from './notice-place'; // UX wave U6b-4b
import { readOnlyReason, readOnlyWords, useViewer, type ArtifactRead, type ReadOnlyReason, type ViewerEntry } from './viewer-store';

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
// and its accessible description (UX wave U6b-2: only where the body is text Save writes); `outside` marks how the file
// stands outside the folders.
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

// UX wave U6f (§E): and `elsewhere`, an outside file of a session on another machine its standing does not let this
// person save there, with the window's helper's sentence and no Open File…
type LabelledReason = 'maws' | 'elsewhere' | 'added' | 'result' | 'outside';
const labelled = (reason: ReadOnlyReason | null): reason is LabelledReason => reason === 'maws' || reason === 'elsewhere' || reason === 'added' || reason === 'result' || reason === 'outside';

// UX wave U6e (§D, K2, K5, K8, K10, K11, K13): "Read-only", in the normal text colour, a button whose accessible
// description is the reason's sentence; a press (Enter or Space with the keyboard on it) opens the panel under it with the
// sentence and, under it at the left, where choosing the file makes it editable (only added, named only by a tool's
// result), "Open File…". Decision Log 18: a small chevron after the words, in the muted colour, inside the same button
// and hidden from assistive technology, so the button keeps one target and one accessible name.
// The panel is never wider than the file's column: min(24rem, the column's width less 1rem), the column measured as it
// opens and its edges the panel's boundary.
// UX wave U6f: the sentence is the entry's (`readOnlyWords`), and Open File… opens the chooser the session's files call for.
function ReadOnlyLabel({ reason, sentence, appSessionId }: { reason: LabelledReason; sentence: string; appSessionId: AppSessionId }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [column, setColumn] = useState<Element | null>(null);
  const [width, setWidth] = useState(0);
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
              <button type="button" className="self-start rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg hover:bg-bg-hover" onClick={() => void openChosenFor(appSessionId)}>
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
// UX wave U6b-2 (M5, decision 11): `host`, where the tab is drawn; the main area when absent. (Decision Log 29) `inView`,
// whether the mounted body is in view; in view when absent.
export function FileViewer({ tab, start, end, host, inView = true, agent = false }: { tab: FileTab; start?: ReactNode; end?: ReactNode; host?: 'side' | 'main'; inView?: boolean; agent?: boolean }) {
  const mainOnScreen = useMainAreaOnScreen();
  // UX wave U6f (§E): a session that takes the remote route, and its machine's standing as it moves (W1, R9)
  const remote = useTakesRemoteRoute(tab.appSessionId ?? ('' as AppSessionId));
  const standing = useRemoteStanding(tab.appSessionId ?? ('' as AppSessionId));
  if (tab.appSessionId === null) return <NoSession path={tab.path} />;
  const { appSessionId } = tab;
  const lead = (entry: ViewerEntry | null) => {
    const reason = entry === null ? null : readOnlyReason(entry, standing);
    // UX wave U6b-2 at the chain merge (the architect's ruling): only a body that can be saved (the code view's text) says
    // where Save writes; a framed file, an image or a row shows its plain path, its outside mark as it is. UX wave U6f:
    // on another machine, it names the machine.
    const savable = entry !== null && (entry.kind === 'code' || entry.kind === 'markdown') && reason !== 'elsewhere';
    const savesTo = savable && entry.pin !== null && entry.locked === null ? (remote && standing !== null ? VIEWER_COPY.savesToOn(entry.pin, standing.machine) : VIEWER_COPY.savesTo(entry.pin)) : null;
    return (
      <>
        {start}
        {labelled(reason) ? <ReadOnlyLabel reason={reason} sentence={readOnlyWords(entry!, standing)!} appSessionId={appSessionId} /> : null}
        <PathLead path={tab.path} savesTo={savesTo} outside={outsideOf(entry)} />
      </>
    );
  };
  return (
    <FileBody
      tabId={tab.id}
      takesKeyboard={tab.id}
      appSessionId={appSessionId}
      path={tab.path}
      line={tab.line}
      agent={agent}
      lead={lead}
      controls={(entry) => <EditorControls entry={entry} />}
      below={(entry) => <SaveFailure entry={entry} />}
      end={end}
      host={host}
      inView={inView && (host === 'side' || mainOnScreen)}
    />
  );
}

const NO_SESSION = 'flex h-full flex-col items-center justify-center gap-1 p-6 text-center';

function NoSession({ path }: { path: string }) {
  return (
    <div data-file-viewer data-path={path} className={NO_SESSION}>
      <NoSessionNotice path={path} />
    </div>
  );
}

function NoSessionNotice({ path }: { path: string }) {
  return (
    <>
      <p className="font-mono text-ui-sm text-fg-muted break-all">{path}</p>
      <p className="text-ui text-fg">{VIEWER_COPY.noSession}</p>
    </>
  );
}

// UX wave U6f (§E; decision 18, Decision Log 20): a file in a folder macOS protects there offers Open it, and one behind a
// link into another such folder Open File…, each in the shape of the failed frame's body (`rowButton`), under U6f's own
// sentence. UX wave U6b-4b: every other failure reads the notice of its cause; the block keeps `role="alert"` and
// `data-refusal`, and its first paragraph is the headline in every case.
function Refused({ entry }: { entry: ViewerEntry }) {
  const { path, tabId, appSessionId } = entry;
  const place = useNoticePlace(appSessionId);
  const canRetry = useViewer.getState().canRetry(entry); // of the entry drawn, which every change of it draws again
  const block = 'flex h-full flex-col items-center justify-center gap-1 p-6 text-center';
  if (entry.needsOpen || entry.offersOpenFile) {
    return (
      <div role="alert" data-refusal data-notice-cause="protected" className={block}>
        <p className="text-ui text-fg">{entry.error ?? ''}</p>
        <p className="font-mono text-ui-sm text-fg-muted break-all">{path}</p>
        {entry.needsOpen ? (
          <button type="button" data-open-protected="" className={`${rowButton} mt-1`} onClick={() => useViewer.getState().openProtected(tabId)}>
            {VIEWER_COPY.openIt}
          </button>
        ) : appSessionId !== null ? (
          <button type="button" className={`${rowButton} mt-1`} onClick={() => void openChosenFor(appSessionId)}>
            {OPEN_FILE_COPY.row}
          </button>
        ) : null}
      </div>
    );
  }
  const failure = entry.failure ?? { code: 'internal' as const, message: entry.error ?? '', refusal: null };
  const notice = classifyFailure(failure, { ...place, subject: 'file' });
  const [headline, ...further] = notice.lines;
  return (
    <div role="alert" data-refusal data-notice-cause={notice.cause} className={block}>
      <p className="text-ui text-fg">{headline}</p>
      {further.map((line) => (
        <p key={line} className="text-ui text-fg-muted">
          {line}
        </p>
      ))}
      <div className="mt-1 flex max-w-full items-center justify-center gap-2">
        <p className="font-mono text-ui-sm text-fg-muted break-all">{path}</p>
        {notice.copyPath ? <CopyPath path={path} /> : null}
      </div>
      {notice.retry ? (
        <button type="button" data-notice-retry="" className={`${rowButton} mt-1 disabled:text-fg-faint`} disabled={!canRetry} onClick={() => useViewer.getState().retry(tabId)}>
          {NOTICE_COPY.retry}
        </button>
      ) : null}
      {notice.detail !== '' ? (
        <p data-notice-detail="" className="mt-2 text-ui-sm text-fg-muted break-all">
          {notice.detail}
        </p>
      ) : null}
    </div>
  );
}

// The notice's Copy path: a small quiet button after the path (UX wave U6b-4b, "The look"; row 1 only).
function CopyPath({ path }: { path: string }) {
  return (
    <button type="button" data-notice-copy="" className="shrink-0 rounded-sm px-1 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2" onClick={() => void navigator.clipboard?.writeText(path).catch(() => undefined)}>
      {NOTICE_COPY.copyPath}
    </button>
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
  host?: 'side' | 'main'; // UX wave U6b-2: where the tab is drawn; the main area when absent
  inView?: boolean; // UX wave U6b-2 (Decision Log 29): false while the mounted body is not in view
  agent?: boolean; // UX wave U6e (decision 19): the tab holds the agent's mark, and its reads say so
  artifactView?: boolean; // UX wave U6b-4b (decision 4): an artifact's view, whose Markdown resolves no relative link
  takesKeyboard?: string; // UX wave U6b-3b: the key the body takes the keyboard under (a file tab's id); the File artifact's view gives none
}

// The app's own focus outline, inside the body's box.
const TAKES_KEYBOARD = 'outline-accent focus-visible:outline-2 -outline-offset-2';

export function FileBody({ tabId, appSessionId, path, line = null, readOnly = false, artifact, lead, controls, below, end, host = 'main', inView = true, agent = false, artifactView = false, takesKeyboard }: FileBodyProps) {
  // UX wave U6b-3b: the request for the keyboard by this body's key, taken while it is in view; the editor, when one is
  // drawn in it, is told through `editorFocus`.
  const body = useRef<HTMLDivElement>(null);
  const editorFocus = useRef<(() => void) | null>(null);
  const asked = useKeyboardRequest(takesKeyboard === undefined ? null : { into: 'file', key: takesKeyboard });
  useEffect(() => {
    const element = body.current;
    if (asked === 0 || !inView || takesKeyboard === undefined || element === null || !takeKeyboard({ into: 'file', key: takesKeyboard })) return;
    element.focus({ preventScroll: true });
    editorFocus.current?.();
  }, [asked, inView, takesKeyboard]);
  const onEditor = useCallback((focus: (() => void) | null) => {
    editorFocus.current = focus;
    if (focus !== null && body.current !== null && document.activeElement === body.current) focus(); // the body still has it
  }, []);
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

  // The keyboard's place is the same element whatever the body draws, a failed read's notice among them, so a request
  // taken while the read is on its way stays on the view when it fails, and one made after is taken (S3; B5).
  const place = {
    ref: body,
    tabIndex: takesKeyboard === undefined ? undefined : -1,
    'data-file-keyboard': takesKeyboard === undefined ? undefined : '',
    'data-key': takesKeyboard,
    'data-file-viewer': true,
    'data-path': path,
  };
  const outline = takesKeyboard === undefined ? '' : TAKES_KEYBOARD;
  if (entry?.status === 'error' && entry.error?.startsWith('unknown app session')) {
    return (
      <div {...place} className={`${NO_SESSION} ${outline}`}>
        <NoSessionNotice path={path} />
      </div>
    );
  }
  return (
    <div
      {...place}
      data-kind={entry?.kind ?? ''}
      data-frame={entry ? frameMarker(entry) : ''}
      data-editable={String(entry !== null && entry.editable && showsCode(entry))}
      data-dirty={String(entry?.dirty ?? false)}
      data-theirs={entry?.theirs?.view ?? ''}
      data-loads={entry?.loads ?? 0}
      data-pending={entry?.pending ?? 0}
      className={`flex h-full min-h-0 flex-col bg-bg ${outline}`}
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
      <div className="relative min-h-0 flex-1">{entry ? <Body entry={entry} wrap={wrap} zoom={zoom} host={host} inView={inView} artifactView={artifactView} onEditor={takesKeyboard === undefined ? undefined : onEditor} /> : <Loading />}</div>
    </div>
  );
}

const showsCode = (entry: ViewerEntry) => entry.kind === 'code' || entry.kind === 'head' || (entry.sourceView && (entry.kind === 'markdown' || entry.kind === 'image'));
// UX wave U6b-2, card 1's one place ("The page alone"): a framed file (an HTML page among them) has no Source view.
const hasSource = (entry: ViewerEntry) => entry.kind === 'markdown' || (entry.kind === 'image' && entry.encoding === 'utf8');

// UX wave U6b-2 (M5, decision 8): what a framed file's body shows, for scenes; empty for another kind.
function frameMarker(entry: ViewerEntry): string {
  if (entry.kind !== 'frame' || entry.status !== 'ready') return '';
  const { frame } = entry;
  if (frame === null || frame.status === 'row') return 'row';
  if (frame.status === 'failed') return 'failed';
  const shown = frame.status === 'asking' ? frame.shown : frame;
  return shown === null ? 'loading' : shown.framed;
}
// A framed file's bar holds Open externally unless its body is a row, which holds its own (or none: L4).
const barOpens = (entry: ViewerEntry) => entry.kind === 'frame' && entry.frame !== null && entry.frame.status !== 'row';

const showsImage = (entry: ViewerEntry) => entry.kind === 'image' && !showsCode(entry);

function Body({ entry, wrap, zoom, host, inView, artifactView, onEditor }: { entry: ViewerEntry; wrap: boolean; zoom: MediaZoom; host: 'side' | 'main'; inView: boolean; artifactView: boolean; onEditor?(focus: (() => void) | null): void }) {
  if (entry.status === 'loading') return <Loading />;
  if (entry.status === 'error') return <Refused entry={entry} />;
  if (entry.kind === 'frame') return <FrameBody entry={entry} host={host} inView={inView} />;
  if (showsCode(entry)) {
    return (
      <Suspense fallback={<Loading />}>
        <CodeView entry={entry} wrap={wrap} onEditor={onEditor} />
      </Suspense>
    );
  }
  if (entry.kind === 'markdown') return <MarkdownView entry={entry} artifactView={artifactView} />;
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
      {(entry.kind === 'head' || barOpens(entry)) && opensExternally(entry.path) && entry.appSessionId !== null ? <OpenExternally appSessionId={entry.appSessionId} path={entry.path} agent={entry.agent} /> : null}
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
