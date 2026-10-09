// A question the agent left for the person (a `need-input` mark; the P2-C document, Design §6 and §8): its Markdown,
// its choices as buttons in order (the recommended one marked, never preselected) in a labelled group, Reply, and the
// state main reports for it: unanswered (with the last refused send's reason), queued with Cancel, sent but not
// confirmed with Answer again, answered with Reply kept for a follow-up, or retired. A session held in a terminal or as
// a background job answers nowhere here: the card says where it is. Every action is the caller's: a control without
// its handler draws disabled (the cards draw state; answering is wired by M6).
import type { Choice } from '@shared/owner/to-human-parser';
import type { QuestionState } from '@shared/owner/state';
import { Markdown } from '../../transcript/view/markdown/Markdown';
import { LABEL, QUESTION } from './copy';

export interface QuestionActions {
  choose?(choice: Choice): void;
  reply?(): void;
  cancel?(): void;
  answerAgain?(): void;
}

export interface QuestionCardProps {
  text: string; // the question's Markdown, its choices lifted out
  choices: readonly Choice[];
  state: QuestionState | null; // null: main has no row for it yet (still streaming, or not derived yet): unanswered
  live: boolean;
  held: 'terminal' | 'background_job' | null; // the session is open elsewhere: nothing to answer here
  actions?: QuestionActions;
}

export function QuestionCard({ text, choices, state, live, held, actions = {} }: QuestionCardProps) {
  const current = state ?? { state: 'unanswered' as const };
  const offered = held === null && (current.state === 'unanswered' || current.state === 'delivered');
  return (
    <section className="owner-card" data-owner-card="need-input" data-state={current.state} aria-label={LABEL['need-input']}>
      <div className="owner-card-label">{LABEL['need-input']}</div>
      <div className="owner-card-body">
        <Markdown markdown={text} live={live} />
        {offered && current.state === 'unanswered' && choices.length > 0 && (
          <div role="group" aria-label={QUESTION.choices} className="owner-question-choices">
            {choices.map((choice, n) => (
              <button key={n} type="button" className="owner-question-choice" data-recommended={choice.recommended ? '' : undefined} disabled={!actions.choose} onClick={() => actions.choose?.(choice)}>
                <span className="owner-question-choice-text">{choice.text}</span>
                {choice.recommended && <span className="owner-question-recommended">{QUESTION.recommended}</span>}
              </button>
            ))}
          </div>
        )}
        <StateLine state={current} held={held} actions={actions} />
        {offered && (
          <div className="owner-card-actions">
            <button type="button" className="owner-card-button" disabled={!actions.reply} onClick={() => actions.reply?.()}>
              {QUESTION.reply}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function StateLine({ state, held, actions }: { state: QuestionState; held: QuestionCardProps['held']; actions: QuestionActions }) {
  if (held !== null && state.state !== 'delivered' && state.state !== 'retired') return <p className="owner-card-state">{held === 'terminal' ? QUESTION.terminal : QUESTION.backgroundJob}</p>;
  switch (state.state) {
    case 'unanswered':
      return state.failed ? <p className="owner-card-state" data-failed="">{state.failed.reason}</p> : null;
    case 'queued':
      return (
        <p className="owner-card-state">
          {QUESTION.queued}
          <button type="button" className="owner-card-button" disabled={!actions.cancel} onClick={() => actions.cancel?.()}>
            {QUESTION.cancel}
          </button>
        </p>
      );
    case 'unconfirmed':
      return (
        <p className="owner-card-state">
          {QUESTION.unconfirmed}
          <button type="button" className="owner-card-button" disabled={!actions.answerAgain} onClick={() => actions.answerAgain?.()}>
            {QUESTION.answerAgain}
          </button>
        </p>
      );
    case 'delivered':
      return (
        <p className="owner-card-state" data-answered="">
          {QUESTION.answered} <span className="owner-card-answer">{answerOf(state.answer.text)}</span>
        </p>
      );
    case 'retired':
      return null;
  }
}

// The answer as the person gave it: the prompt's text after its `Answering "<head>": ` header.
export const answerOf = (text: string): string => text.replace(/^Answering "[^"\n]*": ?/, '');
