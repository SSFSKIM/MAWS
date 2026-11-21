// E1 (M3): a `send_file` call's delivery row (E1 execution document, M3's decisions; X12: the record and the viewer are
// E2's). A file glyph, "Delivered hello.txt" (or "Delivered N files") with the agent's caption, then a line per file:
// its name (the full path as its title) and two quiet buttons, Open externally and Reveal in Finder (on pointing or focus
// within the file's line, and always where nothing points: the word cut, T101), which go through
// `files.openExternal` and `files.reveal` with the row's session; a refusal shows inline for a moment. Open externally
// is offered only for a file `files.openExternal` hands to the OS (`opensExternally`, as the viewer's row does).
// `urgency: 'high'` takes the accent border. It stays in view when its turn folds (isPersistentRow). E2 (M5): once the
// host recorded a file (it has a deliverable id), its name is a button that opens it; P3-L M6b: the id is the File
// artifact's, opened in the panel's Artifacts tool.
// P5 O7 M4: on a lane B session on another machine both buttons would act on that machine's desktop. P5 O7 M5a (A10):
// Open externally opens a copy of the file here (the actions' `openDelivered`, lane-b/open-copy.ts); Reveal in Finder
// stays greyed, and the line says where the file is ("on <machine>", in view whether or not the buttons show). Ticket
// 627: a terminal (lane A) session there over RL2 has no copy route here: both are greyed, each with the window's
// helper's sentence. The word cut (T101): a greyed button keeps the keyboard (`aria-disabled`, as UnavailableButton
// draws it), its sentence its tooltip and description, and the copy's sentence is Open externally's tooltip the same way.
import { useEffect, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { opensExternally } from '@shared/ipc/schema/files';
import { COPY_WORDS } from '../../../lane-b/open-copy'; // P5 O7 M5a
import { ELSEWHERE_WORDS, useElsewhereMachine } from '../../../lane-b/remote-session'; // P5 O7 M4
import { useRemoteUnavailable } from '../../../lane-b/remote-unavailable'; // ticket 627
import { Tip, unavailableClickProps } from '../../../ui/tip';
import { DELIVERY, deliveryHeading } from '../../model/copy';
import type { Row } from '../../model/rows';
import { useActions, useRowSession } from '../context';
import { FileIcon } from './icons';

type DeliveryRow = Extract<Row, { kind: 'delivery' }>;

export const REFUSAL_SHOWN_MS = 4_000;

// A file's quiet button: greyed with its reason (`aria-disabled`, still focusable), or with what it does as its tooltip;
// `disabled` only outside a mounted transcript, where there is no session to act on.
function FileAction({ words, name, reason, fact, disabled, onPress }: { words: string; name: string; reason: string | null; fact: string | null; disabled: boolean; onPress: () => Promise<void> }) {
  const tip = reason ?? fact;
  return (
    <Tip content={tip} description={tip} {...unavailableClickProps(reason)}>
      <button type="button" className="transcript-quiet-button" aria-label={DELIVERY.actionLabel(words, name)} disabled={disabled} onClick={() => void onPress()}>
        {words}
      </button>
    </Tip>
  );
}

function FileLine({ file, appSessionId, actionable }: { file: DeliveryRow['files'][number]; appSessionId: AppSessionId | null; actionable: boolean }) {
  const actions = useActions();
  const [problem, setProblem] = useState<{ text: string } | null>(null); // a new object per refusal, so each one is shown its full time
  const recorded = actionable ? file.id : null; // E2: the artifact id the name opens; none while pending or refused
  const elsewhere = useElsewhereMachine(appSessionId); // P5 O7 M4
  const notOpened = useRemoteUnavailable(appSessionId, 'files.openExternal'); // a lane B session's opens a copy instead
  const notRevealed = useRemoteUnavailable(appSessionId, 'files.reveal');
  // why a button is greyed, else what it does here (a copy of a file on another machine), else nothing
  const opens = elsewhere !== null ? { reason: null, fact: COPY_WORDS.title(elsewhere) } : { reason: notOpened, fact: null };
  const reveals = { reason: elsewhere !== null ? ELSEWHERE_WORDS.title(elsewhere) : notRevealed, fact: null };
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
        // E2: a recorded file's name opens its artifact (P3-L M6b)
        <button type="button" className="transcript-delivery-name transcript-delivery-open" title={file.path} disabled={appSessionId === null} onClick={() => appSessionId && actions.openArtifact(appSessionId, recorded)}>
          {file.name}
        </button>
      ) : (
        <span className="transcript-delivery-name" title={file.path}>
          {file.name}
        </span>
      )}
      {actionable && (
        <span className="transcript-delivery-actions" data-on-hover="">
          {opensExternally(file.name) && <FileAction words={DELIVERY.openExternally} name={file.name} {...opens} disabled={appSessionId === null} onPress={run(actions.openDelivered)} />}
          <FileAction words={DELIVERY.reveal} name={file.name} {...reveals} disabled={appSessionId === null} onPress={run(actions.revealDelivered)} />
        </span>
      )}
      {actionable && elsewhere !== null && <span className="transcript-delivery-elsewhere">{ELSEWHERE_WORDS.on(elsewhere)}</span>}
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
