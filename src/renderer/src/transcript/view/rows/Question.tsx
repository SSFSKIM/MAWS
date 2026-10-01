// An answered question in history (Derivation, *Requests*; W4, the owner's compact receipt): one bordered widget, one
// line per question reading "header (or the question) → answer", the question in full as the line's title. An answer
// that is no option reads as written; a question left out of the reply reads Not answered, and every question of a
// request declined whole reads Skipped. No options, no previews, no controls: a pending question is C7's card in the
// slot. The row stays in view when its turn folds (isPersistentRow).
import type { Question } from '@shared/graph/events';
import { QUESTION } from '../../model/copy';
import type { Row } from '../../model/rows';

// A question the human declined whole: the card's Esc answers the request with a plain permission deny, which C3
// reports as `question.answered` with no answers (C3's broker, `pass3/question-deny`), so an answer map that is present
// and empty. Skipping every question one by one sends the same empty map.
const wasSkipped = (answers: Record<string, string> | null) => answers !== null && Object.keys(answers).length === 0;

function QuestionLine({ question, answers }: { question: Question; answers: Record<string, string> | null }) {
  const answer = answers?.[question.question];
  return (
    <li className="transcript-question-line" data-question="" title={question.question}>
      <span className="transcript-question-label" data-question-label="">
        {question.header || question.question}
      </span>
      <span className="transcript-question-arrow" aria-hidden="true">
        →
      </span>
      <span className="transcript-question-answer" data-answer={answer === undefined ? 'none' : ''}>
        {answer ?? (wasSkipped(answers) ? QUESTION.skipped : QUESTION.notAnswered)}
      </span>
    </li>
  );
}

export function QuestionRow({ row }: { row: Extract<Row, { kind: 'question' }> }) {
  return (
    <section className="transcript-question" aria-label={QUESTION.heading}>
      <ul className="transcript-question-lines">
        {row.questions.map((question) => (
          <QuestionLine key={question.question} question={question} answers={row.answers} />
        ))}
      </ul>
    </section>
  );
}
