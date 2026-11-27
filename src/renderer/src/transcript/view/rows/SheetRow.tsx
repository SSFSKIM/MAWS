// A question sheet call's row (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §I; the look's L1, L2 and
// M5): within board ticket 852's line model, no box. The head is a run's quiet line saying what the call did, its chevron
// folding the lines, which stand open at rest; a call with no lines (it only withdrew) is its head alone. The lines stand
// 19 px in, in one grid so ids, headers, sentences and Open stand in columns: a line is its id, its header and the
// sentence that asks, with Open; after the outcome it is the receipt in today's receipt tones (the label, the arrow, the
// answer). Over the row's own model the store's is laid (§I's table), for what the transcript does not hold yet: the
// row's own outcome wins. The store holds no IPC client of its own, so desk web bundles this row; its actions have no
// `openSheet`, and no line draws Open.
import { useEffect } from 'react';
import type { SheetModel } from '@shared/sheet/model';
import { receiptOf } from '@shared/sheet/words';
import { selectSheetModel, selectSheetSession, useSheets, watchSheet } from '../../../stores/sheet';
import { DisclosureBody } from '../../../ui/disclosure';
import { SHEET_ROW, sheetHead } from '../../model/copy';
import type { Row, SheetRowLine } from '../../model/rows';
import { NO_ACTIONS, rowElementId, useActions, useDisclosure, useRowSession, useTranscriptContext } from '../context';
import { Chevron } from './parts';

type SheetRowData = Extract<Row, { kind: 'sheet' }>;

/** L2: a call of more questions shows this many lines, the rest behind "N more". */
export const SHEET_ROW_SHOWN = 8;

/** What a line's third column reads: the sentence that asks, a receipt, or the line's word for having moved. */
type Said = { kind: 'sentence' } | { kind: 'receipt'; how: 'answered' | 'dismissed' | 'withdrawn'; text: string; queued: boolean } | { kind: 'revised_below' };
interface DrawnLine {
  line: SheetRowLine;
  said: Said;
  open: boolean; // the record lists the question open, so Open shows the side sheet at it
}

const outcomeSaid = (outcome: NonNullable<SheetRowLine['outcome']>, queued = false): Said =>
  outcome.how === 'answered' ? { kind: 'receipt', how: 'answered', text: outcome.receipt, queued } : { kind: 'receipt', how: outcome.how, text: outcome.how === 'dismissed' ? SHEET_ROW.dismissed : SHEET_ROW.withdrawn, queued };

/**
 * Whether a record's entry may stand for this row's line: it names no call, or it names this row's (the writer's fork
 * ruling, 2026-11-27: a fork's record whose floor could not be read restarts at q1, and a row copied from the parent
 * must not take the fork's q1). An open question always names the call that set its revision; a closed or pending
 * entry only where the model carries one.
 */
const namesCall = (entry: object, call: string): boolean => {
  const named = (entry as { callId?: unknown }).callId;
  return typeof named !== 'string' || named === call;
};

/** §I's table: a line as the record reads it, where the transcript holds no outcome for it yet. */
function overlaid(line: SheetRowLine, model: SheetModel | null, call: string): DrawnLine {
  const stored: DrawnLine = { line, said: { kind: 'sentence' }, open: false };
  if (line.place === 'revised_below') return { line, said: { kind: 'revised_below' }, open: false };
  if (line.outcome !== null) return { line, said: outcomeSaid(line.outcome), open: false };
  const id = line.id;
  if (id === null || line.place !== 'here' || model === null) return stored;
  const listed = model.open.find((question) => question.id === id);
  if (listed !== undefined) {
    if (!namesCall(listed, call)) return stored;
    const queued = listed.queued;
    return { line, said: queued === undefined ? { kind: 'sentence' } : outcomeSaid({ how: 'answered', receipt: receiptOf(queued.picks, queued.text) }, true), open: true };
  }
  if (model.hidden.some((hidden) => hidden.id === id && namesCall(hidden, call))) return { line, said: outcomeSaid({ how: 'dismissed' }, true), open: false };
  const pending = model.pending.find((outcome) => outcome.id === id);
  if (pending !== undefined) {
    if (!namesCall(pending, call)) return stored;
    return { line, said: outcomeSaid(pending.kind === 'answer' ? { how: 'answered', receipt: receiptOf(pending.picks, pending.text) } : { how: 'dismissed' }), open: false };
  }
  const closed = model.closed[id];
  if (closed !== undefined && namesCall(closed, call)) return { line, said: outcomeSaid(closed.how === 'answered' ? { how: 'answered', receipt: closed.receipt } : { how: closed.how }), open: false };
  return stored;
}

function SheetLine({ drawn, onOpen }: { drawn: DrawnLine; onOpen: ((id: string) => void) | null }) {
  const { line, said } = drawn;
  const refused = line.place === 'refused';
  const away = said.kind === 'revised_below';
  // a refused entry's number stands where its id would (the look: the bare number, in the id's place and tone)
  const mark = line.id ?? (refused ? String(line.entry) : '');
  const id = line.id;
  return (
    <li className="transcript-sheet-line" data-sheet-line="" data-away={away ? '' : undefined}>
      <span className="transcript-sheet-id">{mark}</span>
      {line.header === null && said.kind === 'sentence' ? (
        <span className="transcript-sheet-sentence" data-span="" title={line.sentence}>
          {line.sentence}
        </span>
      ) : (
        <>
          {/* the cut cells carry their whole words as their title (the line is `display: contents`, no box to hover) */}
          <span className="transcript-sheet-header transcript-question-label" title={line.header ?? line.sentence}>
            {line.header ?? line.sentence}
          </span>
          {said.kind === 'sentence' && (
            <span className="transcript-sheet-sentence" title={line.sentence}>
              {line.sentence}
            </span>
          )}
          {said.kind === 'revised_below' && <span className="transcript-sheet-word">{SHEET_ROW.revisedBelow}</span>}
          {said.kind === 'receipt' && (
            <span className="transcript-sheet-receipt">
              <span className="transcript-question-arrow" aria-hidden="true">
                {SHEET_ROW.arrow}
              </span>{' '}
              <span className="transcript-question-answer" data-how={said.how} title={said.text}>
                {said.text}
              </span>
              {said.queued && (
                <>
                  {' '}
                  <span className="transcript-sheet-word">{SHEET_ROW.queued}</span>
                </>
              )}
            </span>
          )}
        </>
      )}
      <span className="transcript-sheet-end">
        {refused && <span className="transcript-sheet-word">{SHEET_ROW.notAsked}</span>}
        {drawn.open && onOpen !== null && id !== null && (
          <button type="button" className="transcript-quiet-button" aria-label={SHEET_ROW.openName(id)} onClick={() => onOpen(id)}>
            {SHEET_ROW.open}
          </button>
        )}
      </span>
    </li>
  );
}

export function SheetRow({ row }: { row: SheetRowData }) {
  const { idPrefix } = useTranscriptContext();
  const actions = useActions();
  const appSessionId = useRowSession();
  const session = useSheets((state) => (appSessionId === null ? null : selectSheetSession(state, appSessionId)));
  const model = useSheets((state) => selectSheetModel(state, session));
  useEffect(() => (session === null ? undefined : watchSheet(session)), [session]);
  // the per-transcript flags start false: the lines stand open at rest, so the flag kept is the fold
  const [folded, fold] = useDisclosure(`sheet-fold:${row.id}`);
  const [more, showMore] = useDisclosure(`sheet-more:${row.id}`);
  const head = sheetHead(row);
  const tone = row.state === 'running' ? 'running' : row.state === 'error' ? 'error' : undefined;
  if (row.lines.length === 0 && row.notDone === null && row.error === null) {
    return (
      <div className="transcript-sheet" data-sheet-call="" data-state={row.state}>
        <div className="transcript-run-line" data-line={tone}>
          <span className="transcript-run-label">{head}</span>
        </div>
      </div>
    );
  }
  const onOpen = appSessionId !== null && actions.openSheet !== NO_ACTIONS.openSheet ? (id: string) => actions.openSheet(appSessionId, id) : null;
  // the ids are the call's own while its outcome is known: a call that is not known to have asked draws no Open
  const drawn = row.lines.map((line) => overlaid(line, row.state === 'done' ? model : null, row.toolUseId));
  const shown = more ? drawn : drawn.slice(0, SHEET_ROW_SHOWN);
  const bodyId = rowElementId(idPrefix, `${row.id}-lines`);
  return (
    <div className="transcript-sheet" data-sheet-call="" data-state={row.state}>
      <button type="button" className="transcript-run-line" data-line={tone} aria-expanded={!folded} aria-controls={bodyId} onClick={fold}>
        <span className="transcript-run-label">{head}</span>
        <Chevron />
      </button>
      <DisclosureBody open={!folded} id={bodyId} className="transcript-run-body">
        {shown.length > 0 && (
          <ul className="transcript-sheet-lines">
            {shown.map((line) => (
              <SheetLine key={line.line.id ?? `entry-${line.line.entry}`} drawn={line} onOpen={onOpen} />
            ))}
          </ul>
        )}
        {drawn.length > shown.length && (
          <button type="button" className="transcript-quiet-button transcript-sheet-more" onClick={showMore}>
            {SHEET_ROW.more(drawn.length - shown.length)}
          </button>
        )}
        {row.notDone !== null && <p className="transcript-sheet-note">{row.notDone}</p>}
        {row.error !== null && (
          <p className="transcript-sheet-note" data-tone="danger">
            {row.error}
          </p>
        )}
      </DisclosureBody>
    </div>
  );
}
