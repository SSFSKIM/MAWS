// E1 (M3): an `ask` call's capsule (E1 execution document, M3's decisions). A bordered row with a question glyph, the
// ask's title (else "Questions"), how many questions it asked and its state; one button opens the Question sheet with
// the capsule's own data (residue 14), so an answered ask reopens read-only after a reload or in a disk-only session.
// Once answered it lists one line per question, "header (or question) → answer", as the question row does. It stays in
// view when its turn folds (isPersistentRow). UX wave U1b (Interfaces §D, "A waiting row"): while its ask waits, the
// capsule's top line stays, its button reads Open beside (the sheet, with the same form and draft), and the form stands
// under the line. The word cut (T93, T94, T97, T98): an ask with no title of its own is headed by its count ("3
// questions"), a titled one keeps the count after its title; a cancelled capsule's chip reads Cancelled, why its tooltip
// and its description (and after the chip where nothing points: the touch rule, ticket 830); an answered capsule has no
// button, its top row is the press that opens its answers.
import { useId, type ReactNode } from 'react';
import type { AskQuestion } from '@shared/maws/tools';
import { Tip } from '../../../ui/tip';
import { TouchFact } from '../../../ui/touch-fact';
import { ASK, askAnswerCopy, askQuestionTitle, askStateCopy, askStateWhy } from '../../model/copy';
import type { AskRowData, Row } from '../../model/rows';
import { useActions, useRowSession } from '../context';
import { QuestionIcon } from './icons';

type AskRow = Extract<Row, { kind: 'ask' }>;

// The row without its base: what the sheet is handed.
export const askRowData = (row: AskRow): AskRowData => ({
  askId: row.askId, toolUseId: row.toolUseId, title: row.title, context: row.context, blocking: row.blocking, questions: row.questions, state: row.state, answers: row.answers, error: row.error, cancelReason: row.cancelReason,
});

function AnswerLine({ question, row }: { question: AskQuestion; row: AskRow }) {
  const answer = row.answers?.find((candidate) => candidate.id === question.id);
  return (
    <li className="transcript-question-line" data-ask-answer="" title={question.question}>
      <span className="transcript-question-label">{askQuestionTitle(question)}</span>
      <span className="transcript-question-arrow" aria-hidden="true">
        →
      </span>
      <span className="transcript-question-answer" data-answer={answer === undefined ? 'none' : ''}>
        {askAnswerCopy(answer)}
      </span>
    </li>
  );
}

export function AskCapsule({ row, form = null }: { row: AskRow; form?: ReactNode }) {
  const actions = useActions();
  const appSessionId = useRowSession();
  const describedBy = useId();
  const count = ASK.count(row.questions.length);
  const heading = row.title ?? count;
  const why = askStateWhy(row);
  const open = () => appSessionId && actions.openAsk(appSessionId, askRowData(row));
  const pressed = form === null && row.state === 'answered'; // the top row is itself the press
  // spaces between the parts, which the flex row does not draw, so a name read from them reads as words
  const top = (
    <>
      <QuestionIcon />{' '}
      <strong className="transcript-ask-title">{heading}</strong>{' '}
      {row.title !== null && (
        <>
          <span className="transcript-ask-count">{count}</span>{' '}
        </>
      )}
      <Tip content={why} description={why}>
        <span className="transcript-ask-chip" data-ask-chip="" tabIndex={why === null ? undefined : 0}>
          {askStateCopy(row)}
        </span>
      </Tip>
      <TouchFact>{why}</TouchFact>
    </>
  );
  return (
    <section className="transcript-ask" aria-label={heading} data-ask-id={row.askId} data-ask-state={row.state}>
      {pressed ? (
        <>
          <button type="button" className="transcript-ask-top" aria-describedby={describedBy} disabled={appSessionId === null} onClick={open}>
            {top}
          </button>
          <span id={describedBy} hidden>
            {ASK.viewAnswers}
          </span>
        </>
      ) : (
        <div className="transcript-ask-top">
          {top}{' '}
          <button type="button" className="transcript-ask-open" disabled={appSessionId === null} onClick={open}>
            {form !== null ? ASK.openBeside : ASK.open}
          </button>
        </div>
      )}
      {form !== null && <div className="transcript-ask-form">{form}</div>}
      {form === null && row.state === 'answered' && (
        <ul className="transcript-question-lines">
          {row.questions.map((question) => (
            <AnswerLine key={question.id} question={question} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}
