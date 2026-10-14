// The `html` and `file` editors (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M5b; Decision Log 4, 7, 10, 11, 14,
// 15, 23, 26h): the artifact store's byte kinds viewed on `maws-artifact:`, doing what the Deliverables viewer does
// (`../../deliverables/Viewer.tsx`), registered into the editor mount registry for the panel's record view and the
// `artifact` main tab alike.
//
// What is shown: the artifact's versions (`artifacts.versions`, in the order of the revision each captured, `v1 … vN`,
// the last marked latest) and one of them, the latest unless the picker or a card's row chose another, so a new version
// is followed as it lands. The shown revision's stored file is named by main (`library.content`) and framed at
// `maws-artifact://<id>/<revision>/<name>`; the body is chosen by the MIME the name types (an `html` artifact is always
// its page): the HTML frame (sandboxed, carrying the scheme's pick bridge), the PDF frame, native media, else the file
// viewer read-only under the session that made the file (the files service admits a delivered file by its session).
// `onShown` is called once the content is ready (the frame loaded, the media's metadata, the file read) and the body is
// visible, so content that loaded hidden counts when it shows. Export and Save a copy are disabled until the shown
// version and its file are resolved.
//
// The header (X32): the title, read-only, the actions (Comment on an HTML page, Reload, Open externally for a kind the
// OS opens as a document, Reveal in Finder, Open as file for a drawn file inside its session's directories) and the
// Export menu (the kind's formats main's exporters serve, a File artifact's Save a copy…). The body's own bar holds the
// version picker and the frame's console chip, when there is either. The tab owns what the actions read (the version
// chosen, the Reload count, picking), the state the registry holds for it (X32's lifetime rule).
//
// Comment (P2's, unchanged in behaviour): the frame is told to pick, the hint floats over the body, and a pick opens the
// comment card beside the element in this viewer's own `artifact-page` host, its anchor the `artifact-element` of the
// shown revision's page URL, about the session that made the page. Picking belongs to one frame (a version switch or a
// Reload ends it, as do Escape and a pick); the host re-pins the card through the frame's locate handle; an unclaimed
// card (the Side pane's re-dock) is claimed by a viewer of its artifact in its mode.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { artifactUrl } from '@shared/artifacts/scheme';
import type { ArtifactVersion } from '@shared/artifacts/version';
import type { AppSessionId } from '@shared/graph/ids';
import { opensExternally } from '@shared/ipc/schema/files';
import type { LibraryContent, LibraryRow } from '@shared/ipc/schema/library';
import type { ArtifactEditor, ArtifactEditorProps } from '../../../artifacts/registry';
import { ipc } from '../../../ipc/client';
import { toastFailure } from '../../../library/dialogs';
import { exportArtifact, saveArtifactCopy, useExportFormats } from '../../../library/export';
import { useLibraryRow } from '../../../library/store';
import { useRegionMarkupSurface } from '../../../markup/surface';
import { useEditorHost, type EditorHostAction, type EditorHostExport } from '../../../panel/editor-host';
import { CommentCardHost, type CardFrame } from '../../../side/card/CardHost';
import type { OpenCard } from '../../../side/card/store';
import { useSessions } from '../../../stores/sessions';
import { openCommentComposer } from '../../code/anchor/anchor';
import { openFile } from '../../code/open-file';
import { FileBody } from '../../code/viewer/FileViewer';
import { useViewer } from '../../code/viewer/viewer-store';
import { clearArtifactConsole, useArtifactConsole } from './console';
import { ConsoleEntriesChip } from './ConsoleChip';
import { VIEWERS_COPY } from './copy';
import { HtmlFrame, type FrameHandle } from './frames/HtmlFrame';
import { Media } from './frames/Media';
import { PdfFrame } from './frames/PdfFrame';
import { CommentIcon, OpenAsFileIcon, OpenExternallyIcon, ReloadIcon, RevealIcon } from './icons';
import { bodyOf, shownVersion, underSession, versionLabel, versionsInOrder, versionToShow, type BodyKind } from './model';
import { pageElementAnchor, type PickMessage } from './pick';

type ByteKind = 'html' | 'file';
const OPENS_AS_FILE = new Set(['code', 'markdown', 'image', 'head']); // the viewer kinds a file tab draws the same way

// ---- the tab's state ---------------------------------------------------------------------------------------------------

interface ViewState {
  chosen: number | null; // the version's place shown; null: the latest
  reloads: number; // a serial shared by every view, so a Reload's reads and frame are this view's own
  pickingIn: string | null; // the frame asked to pick (its key), if any
}
export interface ByteViewerState {
  view: StoreApi<ViewState>;
}

let reloadSerial = 0;
const nextReload = () => ++reloadSerial;

// ---- reads -------------------------------------------------------------------------------------------------------------

type Read<T> = { status: 'reading' } | { status: 'ready'; value: T } | { status: 'error'; error: string };

// One read per key (none while the key is null); an answer for a key no longer asked is dropped.
function useRead<T>(key: string | null, read: () => Promise<{ ok: true; value: T } | { ok: false; error: { message: string } }>): Read<T> {
  const [answer, setAnswer] = useState<{ key: string; read: Read<T> } | null>(null);
  const latest = useRef(read);
  useEffect(() => {
    latest.current = read;
  });
  useEffect(() => {
    if (key === null) return;
    let live = true;
    void latest.current().then((result) => {
      if (live) setAnswer({ key, read: result.ok ? { status: 'ready', value: result.value } : { status: 'error', error: result.error.message } });
    });
    return () => {
      live = false;
    };
  }, [key]);
  return answer?.key === key ? answer.read : { status: 'reading' };
}

// The session a page or a file belongs to: the one that made it, else the latest to touch it.
const homeSession = (row: LibraryRow | null | undefined): AppSessionId | null =>
  (row?.sessions.find((session) => session.roles.includes('created')) ?? row?.sessions[0])?.appSessionId ?? null;

// ---- the editor --------------------------------------------------------------------------------------------------------

function ByteViewer({ kind, artifactId, state, scope, visible, onShown }: ArtifactEditorProps<ByteViewerState> & { kind: ByteKind }) {
  const { chosen, reloads } = useStore(state.view);
  const row = useLibraryRow(artifactId).value;
  const title = row?.title ?? VIEWERS_COPY.fallbackTitle;
  const versionsRead = useRead(`${artifactId}@${row?.revision ?? '?'}#${reloads}`, () => ipc.invoke('artifacts.versions', { artifactId }));
  const ordered = versionsRead.status === 'ready' ? versionsInOrder(versionsRead.value.versions) : null;
  const shown = ordered ? shownVersion(ordered, chosen) : null;
  const revision = shown?.version.seq;
  const contentRead = useRead<LibraryContent>(ordered === null ? null : `${artifactId}@${revision ?? 'latest'}#${reloads}`, () =>
    ipc.invoke('library.content', { artifactId, ...(revision !== undefined && { revision }) }),
  );
  const content = contentRead.status === 'ready' ? contentRead.value : null;
  const body: BodyKind | null = content === null ? null : kind === 'html' ? 'html' : bodyOf(content.name);
  const session = homeSession(row);
  const reload = () => {
    if (content) clearArtifactConsole(artifactId, content.revision);
    state.view.setState({ reloads: nextReload(), pickingIn: null });
  };
  const choose = (n: number | null) => state.view.setState({ chosen: versionToShow(n, ordered?.length ?? 0) });

  // the frame picking is asked of, by what keys it: another version or a Reload is another frame
  const frameKey = content ? `${artifactId}/${content.revision}#${reloads}` : null;
  const commentable = kind === 'html' && body === 'html' && session !== null && frameKey !== null;
  const picking = useStore(state.view, (s) => commentable && s.pickingIn === frameKey);
  // Fix wave 1: picking belongs to one mounted frame. When the frame is replaced (a version switch, a Reload) or the
  // body unmounts (Back, the tab going inactive), its picking ends, so a version round trip or a remount, which can
  // mount a frame under the same key again, never resumes a pick the owner left. Fix wave 2: so does its readiness,
  // so a frame mounted again under the same key is ready only after its own load.
  const [readyKey, setReadyKey] = useState<string | null>(null);
  useEffect(() => {
    if (frameKey === null) return;
    return () => {
      if (state.view.getState().pickingIn === frameKey) state.view.setState({ pickingIn: null });
      setReadyKey((ready) => (ready === frameKey ? null : ready));
    };
  }, [frameKey, state.view]);
  useEffect(() => {
    if (!picking) return;
    // an Escape something else already answered (a sheet, a menu) or one that ends an input method's composition is not ours
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) state.view.setState({ pickingIn: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picking, state.view]);

  // Fix wave 1 (Decision Log 15, 23): the owner's view is recorded once the frame's content is ready and on screen; a
  // body that loaded while hidden (the panel collapsed, a maximized panel over the main tab) says so when it shows.
  const ready = useCallback(() => setReadyKey(frameKey), [frameKey]);
  useEffect(() => {
    if (visible && frameKey !== null && readyKey === frameKey) onShown();
  }, [visible, frameKey, readyKey, onShown]);

  const hostId = useId();
  const bodyBox = useRef<HTMLDivElement>(null);
  const [frameHandle, setFrameHandle] = useState<FrameHandle | null>(null);
  const onPick = (message: PickMessage) => {
    state.view.setState({ pickingIn: null });
    if (message.type !== 'maws:picked' || !content || !shown || session === null) return;
    const { x, y, width, height } = message.rect;
    const url = artifactUrl(artifactId, content.revision, content.name);
    openCommentComposer(pageElementAnchor({ title, version: shown.n, url }, message), { appSessionId: session, placement: { kind: 'card', host: 'artifact-page', hostId, rect: { x, y, width, height } } });
  };
  const accepts = (card: OpenCard) => card.target?.kind === 'artifact-page' && card.target.artifactId === artifactId;
  const cardFrame: CardFrame = { scale: 1, offset: { x: 0, y: 0 }, key: frameKey ?? '', locate: frameHandle?.locate, showVersion: choose };
  const restoreFocus = () => bodyBox.current?.querySelector('iframe')?.focus({ preventScroll: true });

  // Fix wave 1: what an export or a copy takes, only once the shown version and its file are resolved (null during a
  // read, a Reload or a remount), so a historical selection is never exported as the live revision
  const selection = ordered !== null && content !== null ? { revision: content.revision, versionId: shown && !shown.latest ? shown.version.id : undefined } : null;
  useViewerHeader({ kind, artifactId, title, state, scope, content, body, session, selection, commentable, picking, frameKey, reloads, onReload: reload });
  useRegionMarkupSurface(bodyBox, title, body !== null); // P3-G (§D4.1): Mark-up over the drawn body

  const failed = versionsRead.status === 'error' ? versionsRead.error : contentRead.status === 'error' ? contentRead.error : null;
  return (
    <div data-artifact-viewer={artifactId} data-kind={kind} data-version={shown?.n ?? ''} data-body={body ?? ''} className="flex h-full min-h-0 flex-col bg-bg">
      {content && <Bar artifactId={artifactId} ordered={ordered ?? []} shown={shown?.n ?? null} revision={content.revision} html={body === 'html'} onChoose={choose} />}
      <div ref={bodyBox} className="relative min-h-0 flex-1">
        {failed !== null ? (
          <ReadError message={failed} onRetry={reload} />
        ) : content === null || body === null || frameKey === null ? (
          <p className="p-4 text-ui text-fg-muted">{VIEWERS_COPY.loading}</p>
        ) : (
          <Body
            key={frameKey}
            artifactId={artifactId}
            content={content}
            body={body}
            title={title}
            session={session}
            reloads={reloads}
            picking={picking}
            onPick={onPick}
            onFrame={setFrameHandle}
            onReady={ready}
          />
        )}
        {picking && (
          <p
            role="status"
            data-picking=""
            className="pointer-events-none absolute top-2 left-1/2 z-20 m-0 max-w-[calc(100%-16px)] -translate-x-1/2 truncate rounded-full border border-border-strong bg-bg-raised px-2.5 py-0.5 text-ui-sm text-accent shadow-float"
          >
            {VIEWERS_COPY.picking}
          </p>
        )}
        {kind === 'html' && (
          <CommentCardHost hostId={hostId} host="artifact-page" mode={scope.surface === 'panel' ? 'panel' : 'tab'} layout="anchored" accepts={accepts} frame={cardFrame} visible={visible} restoreFocus={restoreFocus} />
        )}
      </div>
    </div>
  );
}

// The body's bar: the version picker (an artifact of several versions) and the HTML frame's console chip; nothing when
// it would hold neither.
function Bar({ artifactId, ordered, shown, revision, html, onChoose }: { artifactId: string; ordered: readonly ArtifactVersion[]; shown: number | null; revision: number; html: boolean; onChoose(n: number): void }) {
  const entries = useArtifactConsole(artifactId, revision);
  const picker = ordered.length >= 2;
  if (!picker && (!html || entries.length === 0)) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
      {picker && (
        <select
          aria-label={VIEWERS_COPY.versionLabel}
          value={shown ?? ordered.length}
          onChange={(event) => onChoose(Number(event.currentTarget.value))}
          className="h-6 shrink-0 rounded-sm border border-border bg-bg px-1 text-ui-sm text-fg outline-accent focus-visible:outline-2"
        >
          {ordered.map((version, index) => (
            <option key={version.id} value={index + 1}>
              {versionLabel(index + 1, index + 1 === ordered.length)}
            </option>
          ))}
        </select>
      )}
      <span className="flex-1" />
      {html && <ConsoleEntriesChip entries={entries} />}
    </div>
  );
}

function ReadError({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <div className="flex flex-col items-start gap-2 p-4">
      <p role="alert" className="m-0 text-ui text-fg">
        {VIEWERS_COPY.couldNotRead(message)}
      </p>
      <button type="button" onClick={onRetry} className="rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2">
        {VIEWERS_COPY.retry}
      </button>
    </div>
  );
}

interface BodyProps {
  artifactId: string;
  content: LibraryContent;
  body: BodyKind;
  title: string;
  session: AppSessionId | null;
  reloads: number;
  picking: boolean;
  onPick(message: PickMessage): void;
  onFrame(handle: FrameHandle | null): void;
  onReady(): void; // the content is loaded (whether or not it is on screen)
}

function Body({ artifactId, content, body, title, session, reloads, picking, onPick, onFrame, onReady }: BodyProps) {
  const url = artifactUrl(artifactId, content.revision, content.name);
  const frameTitle = VIEWERS_COPY.frameTitle(title);
  switch (body) {
    case 'html':
      return (
        <HtmlFrame
          url={url}
          title={frameTitle}
          owner="artifact"
          onMount={() => clearArtifactConsole(artifactId, content.revision)}
          onLoad={onReady}
          picking={picking}
          onPick={onPick}
          onFrame={onFrame}
        />
      );
    case 'pdf':
      return <PdfFrame url={url} title={frameTitle} owner="artifact" onLoad={onReady} />;
    case 'video':
    case 'audio':
      return <Media kind={body} url={url} owner="artifact" onLoad={onReady} />;
    case 'file':
      if (session === null) {
        return (
          <p data-no-session="" className="m-0 p-4 text-ui text-fg-muted">
            {VIEWERS_COPY.noSession(content.name)}
          </p>
        );
      }
      return <DrawnFile tabId={fileTabId(artifactId, content.revision, reloads)} session={session} path={content.path} onReady={onReady} />;
  }
}

// The file viewer's entry for a drawn revision: one per artifact revision and Reload (`reloads` is a serial shared by
// every view, so a Reload reads afresh even while another view holds the revision's entry).
const fileTabId = (artifactId: string, revision: number, reloads: number) => `artifact:${artifactId}:${revision}${reloads > 0 ? `:r${reloads}` : ''}`;

function DrawnFile({ tabId, session, path, onReady }: { tabId: string; session: AppSessionId; path: string; onReady(): void }) {
  const read = useViewer((s) => s.entries.get(tabId)?.status === 'ready');
  useEffect(() => {
    if (read) onReady();
  }, [read, onReady]);
  return <FileBody tabId={tabId} appSessionId={session} path={path} readOnly />;
}

// ---- the header (X32) --------------------------------------------------------------------------------------------------

interface HeaderInput {
  kind: ByteKind;
  artifactId: string;
  title: string;
  state: ByteViewerState;
  scope: ArtifactEditorProps['scope'];
  content: LibraryContent | null;
  body: BodyKind | null;
  session: AppSessionId | null;
  // the shown revision, and the shown version's id when it is not the latest (an export of what is shown); null while
  // either is unresolved, when Export and Save a copy are disabled
  selection: { revision: number; versionId: number | undefined } | null;
  commentable: boolean;
  picking: boolean;
  frameKey: string | null;
  reloads: number;
  onReload(): void;
}

const answered = async (pending: Promise<{ ok: true; value: { opened?: boolean; revealed?: boolean; message: string | null } } | { ok: false; error: { message: string } }>) => {
  const result = await pending;
  if (!result.ok) toastFailure(result.error.message);
  else if (result.value.message !== null) toastFailure(result.value.message);
};

function useViewerHeader({ kind, artifactId, title, state, scope, content, body, session, selection, commentable, picking, frameKey, reloads, onReload }: HeaderInput): void {
  const revision = selection?.revision;
  const formats = useExportFormats(kind);
  const sessionRecord = useSessions((s) => (session === null ? undefined : s.records.get(session)));
  const drawnKind = useViewer((s) => (content && body === 'file' ? (s.entries.get(fileTabId(artifactId, content.revision, reloads))?.kind ?? null) : null));
  const at = revision === undefined ? {} : { revision };
  const actions: EditorHostAction[] = [];
  if (commentable) {
    actions.push({ id: 'comment', label: VIEWERS_COPY.comment, icon: CommentIcon, pressed: picking, onSelect: () => state.view.setState({ pickingIn: picking ? null : frameKey }) });
  }
  actions.push({ id: 'reload', label: VIEWERS_COPY.reload, icon: ReloadIcon, onSelect: onReload });
  if (content && opensExternally(content.name)) {
    actions.push({ id: 'external', label: VIEWERS_COPY.openExternally, icon: OpenExternallyIcon, onSelect: () => void answered(ipc.invoke('library.openExternally', { artifactId, ...at })) });
  }
  if (content) actions.push({ id: 'reveal', label: VIEWERS_COPY.reveal, icon: RevealIcon, onSelect: () => void answered(ipc.invoke('library.reveal', { artifactId, ...at })) });
  if (content && session !== null && drawnKind !== null && OPENS_AS_FILE.has(drawnKind) && underSession(content.path, sessionRecord)) {
    actions.push({ id: 'file', label: VIEWERS_COPY.openAsFile, icon: OpenAsFileIcon, onSelect: () => openFile(session, content.path) });
  }
  const exports: EditorHostExport[] = formats.map((format) => ({
    id: format,
    label: VIEWERS_COPY.exportFormats[format],
    disabled: selection === null,
    onSelect: () => {
      if (selection) void exportArtifact(artifactId, format, selection.versionId);
    },
  }));
  if (kind === 'file') {
    exports.push({
      id: 'copy',
      label: VIEWERS_COPY.saveCopy,
      disabled: selection === null,
      onSelect: () => {
        if (selection) void saveArtifactCopy(artifactId, selection.revision);
      },
    });
  }
  useEditorHost(scope, { title, saved: 'readonly', actions, exports });
}

// ---- registration ------------------------------------------------------------------------------------------------------

const createState = (): ByteViewerState => ({ view: createStore<ViewState>()(() => ({ chosen: null, reloads: 0, pickingIn: null })) });

const viewers: Record<ByteKind, ArtifactEditor<ByteViewerState>> = {
  html: { Panel: (props) => <ByteViewer kind="html" {...props} />, createState },
  file: { Panel: (props) => <ByteViewer kind="file" {...props} />, createState },
};

// The kind's editor, for the registry (`register.ts`); the panel's record view and a main tab mount the same viewer.
export const byteViewer = (kind: ByteKind): ArtifactEditor<ByteViewerState> => viewers[kind];

