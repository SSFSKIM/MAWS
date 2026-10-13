// E2 (M4): the deliverable viewer (Design §4 "The viewer"), the Deliverables tool's record view and the body of the
// `deliverable` main tab. Before it draws a body it reads the record from main (`deliverables.get`): a record that is
// gone hands control back (`onGone`: the list with the notice), a version whose file is gone draws the missing state.
// The header: Back (panel), the title, the version switcher (an artifact of several versions), the console chip (an HTML
// body), and the actions: Open in tab (panel), Open externally (a kind main hands to the OS), Reveal in Finder, Open as
// file (a drawn file under the record's session directories, Decision Log 18), Reload and, on an artifact, Comment. The
// body by the shown version's type: the HTML frame, the PDF frame, native media, else the file viewer read-only.
//
// Comment (M6, Design §10) picks an element in the artifact's frame: the frame is told to pick, the hint shows, and a
// pick opens the comment composer (E3's, through E5's seam) with the `artifact-element` anchor. Picking belongs to one
// frame: a version switch or a Reload (a new frame) ends it, as do Escape in the app (where the keyboard stays while the
// pointer is over the frame) and Escape in the frame, and a pick ends it (one pick per Comment). Since P2-E1 a pick
// opens the comment card beside the element, in the card host the HTML body's container holds (P2-E1 document, D9),
// rather than the sheet; the host is a sibling of the body, so a Reload's new frame keeps the card, and the host re-pins
// it through the frame's locate handle (D8).
//
// A frame is never re-pointed: its URL is fixed at creation and the frame is keyed by it and by Reload's count, so a
// version switch and a Reload mount a new frame on a scheme URL and an unmount removes it, never routing a deliverable
// frame through `about:blank` or anywhere main's frame policies would block.
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { opensExternally } from '@shared/ipc/schema/files';
import { deliverableUrl, type DeliverableRecord } from '@shared/maws/deliverable';
import { useRegionMarkupSurface } from '../../markup/surface'; // P3-G
import { CommentCardHost, type CardFrame } from '../../side/card/CardHost';
import type { OpenCard } from '../../side/card/store';
import { useLayout } from '../../stores/layout';
import { useSessions } from '../../stores/sessions';
import { openCommentComposer } from '../code/anchor/anchor';
import { openFile } from '../code/open-file';
import { FileBody } from '../code/viewer/FileViewer';
import { useViewer } from '../code/viewer/viewer-store';
import { mawsTranscriptActions } from '../maws/actions';
import { artifactElementAnchor, type PickMessage } from './comment/pick';
import { ConsoleChip } from './ConsoleChip';
import { DELIVERABLES_COPY } from './copy';
import { HtmlFrame, type FrameHandle } from './frames/HtmlFrame';
import { Media } from './frames/Media';
import { PdfFrame } from './frames/PdfFrame';
import { basename, bodyOf, latestVersion, titleOf, underSession, versionPath, type BodyKind } from './model';
import { clearConsole, lookup, lookupKey, useDeliverables } from './store';
import { Versions } from './Versions';

const REFUSAL_SHOWN_MS = 4_000; // the delivery row's
const OPENS_AS_FILE = new Set(['code', 'markdown', 'image', 'head']); // the viewer kinds a file tab draws the same way

const action = 'shrink-0 rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent';

// The viewer store's key for a drawn version: one entry per record version, never a layout tab's. Scale-review D
// scalpel-2#1: after a Reload the view draws under a key of its own (`reloads`, from one serial for every view), whose
// entry starts with a fresh read even while another view (the panel and a main tab) still holds the version's entry;
// the store re-reads a remounted key only once no view holds it, and a file outside the session's roots, which is not
// watched, is re-read only by a Reload.
export const viewerTabId = (id: string, version: number, reloads = 0) => `deliverable:${id}:v${version}${reloads > 0 ? `:r${reloads}` : ''}`;
let reloadSerial = 0;
const nextReload = () => ++reloadSerial;

interface Props {
  appSessionId: AppSessionId; // the record's session (in the All scope, not necessarily the shown one)
  id: string;
  version: number | null; // null: the latest
  mode: 'panel' | 'tab';
  visible?: boolean; // P2-E1: on screen (the panel tool's `ctx.visible`; a main tab is mounted while active)
  onBack?(): void;
  onVersion(version: number | null): void; // null: the latest (P2-E1: the comment card's row Open)
  onGone(id: string): void;
}

export function DeliverableViewer({ appSessionId, id, version, mode, visible = true, onBack, onVersion, onGone }: Props) {
  const found = useDeliverables((s) => s.lookups.get(lookupKey(appSessionId, id)));
  const [reloads, setReloads] = useState(0);
  // The read this mount (or this Reload) made; until it answers, the body waits rather than trusting an older answer.
  const check = `${lookupKey(appSessionId, id)}#${reloads}`;
  const [checked, setChecked] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void lookup(appSessionId, id).then(() => {
      if (live) setChecked(check);
    });
    return () => {
      live = false;
    };
  }, [appSessionId, id, check]);
  const fresh = checked === check && found?.status === 'ready';
  const gone = fresh && found.record === null;
  useEffect(() => {
    if (gone) onGone(id);
  }, [gone, id, onGone]);

  if (found?.status === 'error') return <ReadError message={found.error} onBack={onBack} onRetry={() => setReloads(nextReload())} />;
  if (found?.status !== 'ready' || found.record === null) return <Waiting onBack={onBack} />;
  const record = found.record;
  const latest = latestVersion(record);
  const shown = version !== null && version >= 1 && version <= latest ? version : latest;
  const reload = () => {
    clearConsole(record.appSessionId, record.id, shown);
    setReloads(nextReload());
  };
  return (
    <Shown
      record={record}
      shown={shown}
      present={found.present[shown - 1] ?? false}
      checked={fresh}
      reloads={reloads}
      mode={mode}
      visible={visible}
      onBack={onBack}
      onVersion={onVersion}
      onReload={reload}
    />
  );
}

function Waiting({ onBack }: { onBack?: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {onBack && <BackButton onBack={onBack} />}
      <p className="p-4 text-ui text-fg-muted">{DELIVERABLES_COPY.loading}</p>
    </div>
  );
}

// A refused read, with Retry (the tab has no Back to leave by), which reads the record again.
function ReadError({ message, onBack, onRetry }: { message: string; onBack?: () => void; onRetry(): void }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {onBack && <BackButton onBack={onBack} />}
      <div className="flex flex-col items-start gap-2 p-4">
        <p role="alert" className="text-ui text-fg">
          {DELIVERABLES_COPY.couldNotRead(message)}
        </p>
        <button type="button" onClick={onRetry} className={action}>
          {DELIVERABLES_COPY.retry}
        </button>
      </div>
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} className="h-7 shrink-0 self-start rounded-sm px-2 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2">
      {DELIVERABLES_COPY.back}
    </button>
  );
}

interface ShownProps {
  record: DeliverableRecord;
  shown: number;
  present: boolean;
  checked: boolean; // this mount's read answered: the body may draw
  reloads: number;
  mode: 'panel' | 'tab';
  visible: boolean;
  onBack?(): void;
  onVersion(version: number | null): void;
  onReload(): void;
}

function Shown({ record, shown, present, checked, reloads, mode, visible, onBack, onVersion, onReload }: ShownProps) {
  const path = versionPath(record, shown);
  const body = bodyOf(path);
  const title = titleOf(record);
  // the frame picking is asked of, by what keys it: another version or a Reload is another frame, which is not picking
  const frame = `${record.appSessionId}/${record.id}/${shown}#${reloads}`;
  const [pickingIn, setPickingIn] = useState<string | null>(null);
  const commentable = record.kind === 'artifact' && body === 'html' && checked && present;
  const picking = commentable && pickingIn === frame; // a version whose file went missing has no frame to pick in
  useEffect(() => {
    if (!picking) return;
    // an Escape something else already answered (a sheet, a menu) or one that ends an input method's composition is not ours
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) setPickingIn(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picking]);
  // P2-E1 start (2026-10-09): the pick opens the comment card in this viewer's host, beside the element (D2, D9)
  const hostId = useId();
  const commentButton = useRef<HTMLButtonElement>(null);
  const bodyBox = useRef<HTMLDivElement>(null);
  const onPick = (message: PickMessage) => {
    setPickingIn(null);
    if (message.type !== 'maws:picked') return;
    const { x, y, width, height } = message.rect;
    openCommentComposer(artifactElementAnchor(record, shown, message), { appSessionId: record.appSessionId, placement: { kind: 'card', host: 'deliverable', hostId, rect: { x, y, width, height } } });
  };
  const hostsCard = record.kind === 'artifact' && body === 'html';
  const accepts = (card: OpenCard) => card.target?.kind === 'deliverable' && card.target.appSessionId === record.appSessionId && card.target.deliverableId === record.id;
  // the HTML frame's locate handle (M3, D8): one per mounted frame, so the host re-pins when a new frame's arrives
  const [frameHandle, setFrameHandle] = useState<FrameHandle | null>(null);
  const cardFrame: CardFrame = { scale: 1, offset: { x: 0, y: 0 }, key: frame, locate: frameHandle?.locate, showVersion: onVersion }; // the frame fills the body
  // a dismissed card gives focus back to Comment, or to the frame when Comment is gone
  const restoreFocus = () => (commentButton.current ?? bodyBox.current?.querySelector('iframe'))?.focus({ preventScroll: true });
  // P2-E1 end
  const comment = commentable ? { picking, toggle: () => setPickingIn(picking ? null : frame) } : null;
  // P3-G (§D4.1): Mark-up over the drawn body (an artifact's frame, a PDF, media, a file), captured from the window
  useRegionMarkupSurface(bodyBox, title, checked && present);
  return (
    <div data-deliverable-viewer="" data-deliverable-id={record.id} data-version={shown} data-body={body} className="flex h-full min-h-0 flex-col bg-bg">
      <header className="flex shrink-0 flex-col gap-1.5 border-b border-border px-2 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {mode === 'panel' && onBack && <BackButton onBack={onBack} />}
          <h2 className="min-w-0 flex-1 truncate px-1 text-ui font-semibold text-fg" title={path}>
            {title}
          </h2>
          {record.kind === 'artifact' && <Versions record={record} shown={shown} onChange={onVersion} />}
          {body === 'html' && <ConsoleChip appSessionId={record.appSessionId} deliverableId={record.id} version={shown} />}
        </div>
        <Actions record={record} shown={shown} reloads={reloads} path={path} body={body} present={present} mode={mode} comment={comment} commentRef={commentButton} onReload={onReload} />
      </header>
      <div ref={bodyBox} className="relative min-h-0 flex-1">
        {!checked ? (
          <p className="p-4 text-ui text-fg-muted">{DELIVERABLES_COPY.loading}</p>
        ) : !present ? (
          <p data-missing="" className="p-4 font-mono text-ui-sm break-all text-fg-muted">
            {DELIVERABLES_COPY.missing(path)}
          </p>
        ) : (
          <Body key={reloads} record={record} shown={shown} reloads={reloads} path={path} body={body} title={title} picking={picking} onPick={onPick} onFrame={setFrameHandle} />
        )}
        {/* P2-E1 start (2026-10-09): the picking hint floats over the body rather than taking a header line, so ending a
            pick never resizes the frame under the rect it just reported (a card pinned to an element at the frame's
            bottom would otherwise sit off by the line's height); and the comment card's host, a sibling of the body so
            a new frame keeps the card */}
        {picking && (
          <p
            role="status"
            data-picking=""
            className="pointer-events-none absolute top-2 left-1/2 z-20 m-0 max-w-[calc(100%-16px)] -translate-x-1/2 truncate rounded-full border border-border-strong bg-bg-raised px-2.5 py-0.5 text-ui-sm text-accent shadow-float"
          >
            {DELIVERABLES_COPY.picking}
          </p>
        )}
        {hostsCard &&<CommentCardHost hostId={hostId} host="deliverable" mode={mode} layout="anchored" accepts={accepts} frame={cardFrame} visible={visible} restoreFocus={restoreFocus} />}
        {/* P2-E1 end */}
      </div>
    </div>
  );
}

interface BodyProps {
  record: DeliverableRecord;
  shown: number;
  reloads: number;
  path: string;
  body: BodyKind;
  title: string;
  picking: boolean;
  onPick(message: PickMessage): void;
  onFrame(handle: FrameHandle | null): void; // P2-E1: the HTML frame's locate handle
}

function Body({ record, shown, reloads, path, body, title, picking, onPick, onFrame }: BodyProps) {
  const url = deliverableUrl(record.appSessionId, record.id, shown);
  switch (body) {
    case 'html':
      return (
        <HtmlFrame
          key={url}
          url={url}
          title={DELIVERABLES_COPY.frameTitle(title)}
          appSessionId={record.appSessionId}
          deliverableId={record.id}
          version={shown}
          picking={picking}
          onPick={onPick}
          onFrame={onFrame}
        />
      );
    case 'pdf':
      return <PdfFrame key={url} url={url} title={DELIVERABLES_COPY.frameTitle(title)} />;
    case 'video':
    case 'audio':
      return <Media key={url} kind={body} url={url} />;
    case 'file':
      return <FileBody key={url} tabId={viewerTabId(record.id, shown, reloads)} appSessionId={record.appSessionId} path={path} readOnly />;
  }
}

interface ActionsProps {
  record: DeliverableRecord;
  shown: number;
  reloads: number;
  path: string;
  body: BodyKind;
  present: boolean;
  mode: 'panel' | 'tab';
  comment: { picking: boolean; toggle(): void } | null; // an artifact's frame on screen
  commentRef: RefObject<HTMLButtonElement | null>; // P2-E1: where a dismissed comment card gives focus back
  onReload(): void;
}

function Actions({ record, shown, reloads, path, body, present, mode, comment, commentRef, onReload }: ActionsProps) {
  const session = useSessions((s) => s.records.get(record.appSessionId));
  const drawnKind = useViewer((s) => (body === 'file' ? (s.entries.get(viewerTabId(record.id, shown, reloads))?.kind ?? null) : null));
  const [problem, setProblem] = useState<{ text: string } | null>(null); // a new object per refusal, so each one is shown its full time
  useEffect(() => {
    if (problem === null) return;
    const timer = setTimeout(() => setProblem(null), REFUSAL_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [problem]);
  const run = (act: (appSessionId: AppSessionId, path: string) => Promise<string | null>) => async () => {
    const text = await act(record.appSessionId, path);
    setProblem(text === null ? null : { text });
  };
  const opensAsFile = drawnKind !== null && OPENS_AS_FILE.has(drawnKind) && underSession(path, session);
  const buttons: ReactNode[] = [];
  if (mode === 'panel') {
    buttons.push(
      <button key="tab" type="button" className={action} onClick={() => useLayout.getState().openTab({ kind: 'deliverable', appSessionId: record.appSessionId, deliverableId: record.id })}>
        {DELIVERABLES_COPY.openInTab}
      </button>,
    );
  }
  if (opensExternally(basename(path))) {
    buttons.push(
      <button key="external" type="button" className={action} disabled={!present} onClick={() => void run(mawsTranscriptActions.openDelivered)()}>
        {DELIVERABLES_COPY.openExternally}
      </button>,
    );
  }
  buttons.push(
    <button key="reveal" type="button" className={action} disabled={!present} onClick={() => void run(mawsTranscriptActions.revealDelivered)()}>
      {DELIVERABLES_COPY.reveal}
    </button>,
  );
  if (opensAsFile) {
    buttons.push(
      <button key="file" type="button" className={action} onClick={() => openFile(record.appSessionId, path)}>
        {DELIVERABLES_COPY.openAsFile}
      </button>,
    );
  }
  buttons.push(
    <button key="reload" type="button" className={action} onClick={onReload}>
      {DELIVERABLES_COPY.reload}
    </button>,
  );
  if (comment) {
    buttons.push(
      <button key="comment" ref={commentRef} type="button" className={`${action} aria-pressed:bg-bg-active`} aria-pressed={comment.picking} onClick={comment.toggle}>
        {DELIVERABLES_COPY.comment}
      </button>,
    );
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-1">
      {buttons}
      {problem && (
        <span role="alert" className="min-w-0 truncate text-ui-sm text-danger">
          {problem.text}
        </span>
      )}
    </div>
  );
}
