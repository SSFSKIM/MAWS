// E1 (M3): a `send_file` call's delivery row (E1 execution document, M3's decisions; X12: the record and the viewer are
// E2's). A file glyph, "Delivered hello.txt" (or "Delivered N files") with the agent's caption, then a line per file:
// its name (the full path as its title) and two quiet buttons, Open externally and Reveal in Finder, which go through
// `files.openExternal` and `files.reveal` with the row's session; a refusal shows inline for a moment. Open externally
// is offered only for a file `files.openExternal` hands to the OS (`opensExternally`, as the viewer's row does).
// `urgency: 'high'` takes the accent border. It stays in view when its turn folds (isPersistentRow). E2 (M5): once the
// host recorded a file (it has a deliverable id), its name is a button that opens it in the Deliverables viewer.
import { useEffect, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { opensExternally } from '@shared/ipc/schema/files';
import { DELIVERY, deliveryHeading } from '../../model/copy';
import type { Row } from '../../model/rows';
import { useActions, useRowSession } from '../context';
import { FileIcon } from './icons';

type DeliveryRow = Extract<Row, { kind: 'delivery' }>;

export const REFUSAL_SHOWN_MS = 4_000;

function FileLine({ file, appSessionId, actionable }: { file: DeliveryRow['files'][number]; appSessionId: AppSessionId | null; actionable: boolean }) {
  const actions = useActions();
  const [problem, setProblem] = useState<{ text: string } | null>(null); // a new object per refusal, so each one is shown its full time
  const recorded = actionable ? file.id : null; // E2: the deliverable id the name opens; none while pending or refused
  useEffect(() => {
    if (problem === null) return;
    const timer = setTimeout(() => setProblem(null), REFUSAL_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [problem]);
  const run = (action: (appSessionId: AppSessionId, path: string) => Promise<string | null>) => async () => {
    if (appSessionId === null) return;
    const text = await action(appSessionId, file.path);
    setProblem(text === null ? null : { text });
  };
  return (
    <li className="transcript-delivery-file" data-path={file.path}>
      {recorded !== null ? (
        // E2: a recorded file's name opens it in the Deliverables viewer
        <button type="button" className="transcript-delivery-name transcript-delivery-open" title={file.path} disabled={appSessionId === null} onClick={() => appSessionId && actions.openDeliverable(appSessionId, recorded)}>
          {file.name}
        </button>
      ) : (
        <span className="transcript-delivery-name" title={file.path}>
          {file.name}
        </span>
      )}
      {actionable && (
        <span className="transcript-delivery-actions">
          {opensExternally(file.name) && (
            <button type="button" className="transcript-quiet-button" disabled={appSessionId === null} onClick={() => void run(actions.openDelivered)()}>
              {DELIVERY.openExternally}
            </button>
          )}
          <button type="button" className="transcript-quiet-button" disabled={appSessionId === null} onClick={() => void run(actions.revealDelivered)()}>
            {DELIVERY.reveal}
          </button>
        </span>
      )}
      {problem && (
        <span role="alert" className="transcript-delivery-problem">
          {problem.text}
        </span>
      )}
    </li>
  );
}

export function DeliveryRowView({ row }: { row: DeliveryRow }) {
  const appSessionId = useRowSession();
  const heading = deliveryHeading(row);
  return (
    <section className="transcript-delivery" data-delivery="" data-urgency={row.urgency}>
      <div className="transcript-delivery-top">
        <FileIcon />
        <span data-delivery-heading="">
          <strong>{heading}</strong>
          {row.caption && <span className="transcript-delivery-caption"> · {row.caption}</span>}
        </span>
      </div>
      {row.error !== null && <p className="transcript-delivery-error">{row.error}</p>}
      <ul className="transcript-delivery-files">
        {row.files.map((file, index) => (
          // a recorded file by its deliverable id; a pending one (no id yet) by its position, since a call may name a path twice
          <FileLine key={file.id ?? `pending:${index}`} file={file} appSessionId={appSessionId} actionable={row.error === null} />
        ))}
      </ul>
    </section>
  );
}
