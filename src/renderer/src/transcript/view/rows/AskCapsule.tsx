// E1 (M3): an `ask` call's capsule (E1 execution document, M3's decisions). A bordered row with a question glyph, the
// ask's title (else "Questions"), how many questions it asked and its state; one button opens the Question sheet with
// the capsule's own data (residue 14), so an answered ask reopens read-only after a reload or in a disk-only session.
// Once answered it lists one line per question, "header (or question) → answer", as the question row does. It stays in
// view when its turn folds (isPersistentRow). UX wave U1b (Interfaces §D, "A waiting row"): while its ask waits, the
// capsule's top line stays, its button reads Open beside (the sheet, with the same form and draft), and the form stands
// under the line.
import type { ReactNode } from 'react';
import type { AskQuestion } from '@shared/maws/tools';
import { ASK, askAnswerCopy, askQuestionTitle, askStateCopy } from '../../model/copy';
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
  const chip = askStateCopy(row);
  return (
    <section className="transcript-ask" aria-label={row.title ?? ASK.title} data-ask-id={row.askId} data-ask-state={row.state}>
      <div className="transcript-ask-top">
        <QuestionIcon />
        <strong className="transcript-ask-title">{row.title ?? ASK.title}</strong>
        <span className="transcript-ask-count">{ASK.count(row.questions.length)}</span>
        <span className="transcript-ask-chip" data-ask-chip="">
          {chip}
        </span>
        <button type="button" className="transcript-ask-open" disabled={appSessionId === null} onClick={() => appSessionId && actions.openAsk(appSessionId, askRowData(row))}>
          {form !== null ? ASK.openBeside : row.state === 'answered' ? ASK.viewAnswers : ASK.open}
        </button>
      </div>
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
