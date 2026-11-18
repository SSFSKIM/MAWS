// An answered question in history (Derivation, *Requests*; W4, the owner's compact receipt): one bordered widget, one
// line per question reading "header (or the question) → answer", the question in full as the line's title. An answer
// that is no option reads as written; a question left out of the reply reads Not answered. No options, no previews, no
// controls: a pending question is C7's card in the slot. The row stays in view when its turn folds (isPersistentRow).
// UX wave U1b (the U1b document, Interfaces §D "A question's receipt"; decisions 8 and 10): per line, the first that
// applies: the row's own answer; Dismissed, for a question dismissed or declined whole; what the attention store knows of
// the call's answer under the row's own session (the answer this window gave, a dismissal, a settlement's words), until
// the transcript's own row carries it; Not answered. The store is the row's one source outside the transcript: a row
// never reads the lane A store, which imports MAWS's IPC client (desk web bundles the rows).
import type { Question } from '@shared/graph/events';
import { useAttention, type Receipt } from '../../../stores/attention';
import { QUESTION, questionRefused /* E1 */ } from '../../model/copy';
import type { Row } from '../../model/rows';
import { useRowSession } from '../context';

type QuestionRowData = Extract<Row, { kind: 'question' }>;

// A question the human dismissed, or declined whole: the card's Esc answers the request with a plain permission deny,
// which C3 reports as `question.answered` with no answers (C3's broker, `pass3/question-deny`), so an answer map that is
// present and empty (skipping every question one by one sends the same empty map); an asynchronous question's dismissal
// is its delivery's word (`dismissed`).
const wasDismissed = (row: QuestionRowData) => row.dismissed === true || (row.answers !== null && Object.keys(row.answers).length === 0);

// A line's words, and whether they are an answer given (the others draw in the quieter tone). The one place they are
// chosen: the owner's card 2 of "The look" changes a dismissed row here.
function answerOf(question: Question, row: QuestionRowData, receipt: Receipt | undefined): { text: string; given: boolean } {
  const own = row.answers?.[question.question];
  if (own !== undefined) return { text: own, given: true };
  if (wasDismissed(row)) return { text: QUESTION.dismissed, given: false };
  if (row.answers === null && receipt !== undefined) {
    if ('answers' in receipt) {
      if (Object.hasOwn(receipt.answers, question.question)) return { text: receipt.answers[question.question], given: true };
    } else return { text: 'dismissed' in receipt ? QUESTION.dismissed : receipt.settled, given: false };
  }
  return { text: QUESTION.notAnswered, given: false };
}

function QuestionLine({ question, answer }: { question: Question; answer: { text: string; given: boolean } }) {
  return (
    <li className="transcript-question-line" data-question="" title={question.question}>
      <span className="transcript-question-label" data-question-label="">
        {question.header || question.question}
      </span>
      <span className="transcript-question-arrow" aria-hidden="true">
        →
      </span>
      <span className="transcript-question-answer" data-answer={answer.given ? '' : 'none'}>
        {answer.text}
      </span>
    </li>
  );
}

export function QuestionRow({ row }: { row: QuestionRowData }) {
  const session = useRowSession();
  const receipt = useAttention((state) => (session === null ? undefined : state.receipts.get(session)?.get(row.toolUseId)));
  return (
    <section className="transcript-question" aria-label={QUESTION.heading}>
      <ul className="transcript-question-lines">
        {row.questions.map((question) => (
          <QuestionLine key={question.question} question={question} answer={answerOf(question, row, receipt)} />
        ))}
      </ul>
      {/* E1 (A-17): the engine refused the call before any card could ask, so the refusal shows where the question is drawn */}
      {row.error !== null && (
        <p className="transcript-question-refused" data-question-refused="">
          {questionRefused(row.error)}
        </p>
      )}
    </section>
  );
}
