// E2 (M4): the deliverable viewer (Design §4 "The viewer"), the Deliverables tool's record view and the body of the
// `deliverable` main tab. Before it draws a body it reads the record from main (`deliverables.get`): a record that is
// gone hands control back (`onGone`: the list with the notice), a version whose file is gone draws the missing state.
// The header: Back (panel), the title, the version switcher (an artifact of several versions), the console chip (an HTML
// body), and the actions: Open in tab (panel), Open externally (a kind main hands to the OS), Reveal in Finder, Open as
// file (a drawn file under the record's session directories, Decision Log 18) and Reload. The body by the shown
// version's type: the HTML frame, the PDF frame, native media, else the file viewer read-only.
//
// A frame is never re-pointed: its URL is fixed at creation and the frame is keyed by it and by Reload's count, so a
// version switch and a Reload mount a new frame on a scheme URL and an unmount removes it, never routing a deliverable
// frame through `about:blank` or anywhere main's frame policies would block.
import { useEffect, useState, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { opensExternally } from '@shared/ipc/schema/files';
import { deliverableUrl, type DeliverableRecord } from '@shared/maws/deliverable';
import { useLayout } from '../../stores/layout';
import { useSessions } from '../../stores/sessions';
import { openFile } from '../code/open-file';
import { FileBody } from '../code/viewer/FileViewer';
import { useViewer } from '../code/viewer/viewer-store';
import { mawsTranscriptActions } from '../maws/actions';
import { ConsoleChip } from './ConsoleChip';
import { DELIVERABLES_COPY } from './copy';
import { HtmlFrame } from './frames/HtmlFrame';
import { Media } from './frames/Media';
import { PdfFrame } from './frames/PdfFrame';
import { basename, bodyOf, latestVersion, titleOf, underSession, versionPath, type BodyKind } from './model';
import { clearConsole, lookup, lookupKey, useDeliverables } from './store';
import { Versions } from './Versions';

const REFUSAL_SHOWN_MS = 4_000; // the delivery row's
const OPENS_AS_FILE = new Set(['code', 'markdown', 'image', 'head']); // the viewer kinds a file tab draws the same way

const action = 'shrink-0 rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent';

// The viewer store's key for a drawn version: one entry per record version, never a layout tab's.
export const viewerTabId = (id: string, version: number) => `deliverable:${id}:v${version}`;

interface Props {
  appSessionId: AppSessionId; // the record's session (in the All scope, not necessarily the shown one)
  id: string;
  version: number | null; // null: the latest
  mode: 'panel' | 'tab';
  onBack?(): void;
  onVersion(version: number): void;
  onGone(id: string): void;
}

export function DeliverableViewer({ appSessionId, id, version, mode, onBack, onVersion, onGone }: Props) {
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

  if (found?.status === 'error') return <ReadError message={found.error} onBack={onBack} />;
  if (found?.status !== 'ready' || found.record === null) return <Waiting onBack={onBack} />;
  const record = found.record;
  const latest = latestVersion(record);
  const shown = version !== null && version >= 1 && version <= latest ? version : latest;
  const reload = () => {
    clearConsole(record.appSessionId, record.id, shown);
    setReloads((n) => n + 1);
  };
  return (
    <Shown
      record={record}
      shown={shown}
      present={found.present[shown - 1] ?? false}
      checked={fresh}
      reloads={reloads}
      mode={mode}
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

function ReadError({ message, onBack }: { message: string; onBack?: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {onBack && <BackButton onBack={onBack} />}
      <p role="alert" className="p-4 text-ui text-fg">
        {DELIVERABLES_COPY.couldNotRead(message)}
      </p>
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
  onBack?(): void;
  onVersion(version: number): void;
  onReload(): void;
}

function Shown({ record, shown, present, checked, reloads, mode, onBack, onVersion, onReload }: ShownProps) {
  const path = versionPath(record, shown);
  const body = bodyOf(path);
  const title = titleOf(record);
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
        <Actions record={record} shown={shown} path={path} body={body} present={present} mode={mode} onReload={onReload} />
      </header>
      <div className="relative min-h-0 flex-1">
        {!checked ? (
          <p className="p-4 text-ui text-fg-muted">{DELIVERABLES_COPY.loading}</p>
        ) : !present ? (
          <p data-missing="" className="p-4 font-mono text-ui-sm break-all text-fg-muted">
            {DELIVERABLES_COPY.missing(path)}
          </p>
        ) : (
          <Body key={reloads} record={record} shown={shown} path={path} body={body} title={title} />
        )}
      </div>
    </div>
  );
}

function Body({ record, shown, path, body, title }: { record: DeliverableRecord; shown: number; path: string; body: BodyKind; title: string }) {
  const url = deliverableUrl(record.appSessionId, record.id, shown);
  switch (body) {
    case 'html':
      return <HtmlFrame key={url} url={url} title={DELIVERABLES_COPY.frameTitle(title)} />;
    case 'pdf':
      return <PdfFrame key={url} url={url} title={DELIVERABLES_COPY.frameTitle(title)} />;
    case 'video':
    case 'audio':
      return <Media key={url} kind={body} url={url} />;
    case 'file':
      return <FileBody key={url} tabId={viewerTabId(record.id, shown)} appSessionId={record.appSessionId} path={path} readOnly />;
  }
}

function Actions({ record, shown, path, body, present, mode, onReload }: { record: DeliverableRecord; shown: number; path: string; body: BodyKind; present: boolean; mode: 'panel' | 'tab'; onReload(): void }) {
  const session = useSessions((s) => s.records.get(record.appSessionId));
  const drawnKind = useViewer((s) => (body === 'file' ? (s.entries.get(viewerTabId(record.id, shown))?.kind ?? null) : null));
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
