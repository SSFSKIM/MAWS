// An answered question in history (Derivation, *Requests*): each question under its header with its options, the
// chosen ones marked (a multi-select answer is the labels joined by `, `), an answer that is no option shown as the
// answer. Option descriptions go through the shared markdown pipeline; previews are never rendered (they are C7's live
// form concern and need the isolated frame of §5.3). No controls: a pending question is C7's card in the slot.
import type { Question } from '@shared/graph/events';
import { QUESTION } from '../../model/copy';
import type { Row } from '../../model/rows';
import { Markdown } from '../markdown/Markdown';

function picked(question: Question, answers: Record<string, string> | null): string[] {
  const answer = answers?.[question.question];
  if (answer === undefined) return [];
  return question.multiSelect ? answer.split(', ') : [answer];
}

function QuestionItem({ question, answers }: { question: Question; answers: Record<string, string> | null }) {
  const chosen = picked(question, answers);
  const labels = new Set(question.options.map((option) => option.label));
  const other = chosen.filter((answer) => !labels.has(answer));
  return (
    <div className="transcript-question-item" data-question="">
      <div className="transcript-question-header" data-question-header="">
        {question.header}
      </div>
      <div className="transcript-question-text">{question.question}</div>
      <ul className="transcript-question-options">
        {question.options.map((option) => {
          const isChosen = chosen.includes(option.label);
          return (
            <li key={option.label} className="transcript-question-option" data-chosen={isChosen ? '' : undefined}>
              <span className="transcript-question-label" data-option-label="">
                {option.label}
              </span>
              {isChosen && <span className="transcript-badge">{QUESTION.chosen}</span>}
              {option.description && (
                <div className="transcript-question-description">
                  <Markdown markdown={option.description} live={false} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {other.length > 0 && <div className="transcript-question-answer">{QUESTION.answer(other.join(', '))}</div>}
      {answers?.[question.question] === undefined && <div className="transcript-question-answer">{QUESTION.notAnswered}</div>}
    </div>
  );
}

export function QuestionRow({ row }: { row: Extract<Row, { kind: 'question' }> }) {
  return (
    <section className="transcript-question" aria-label={QUESTION.heading}>
      {row.questions.map((question) => (
        <QuestionItem key={question.question} question={question} answers={row.answers} />
      ))}
    </section>
  );
}
