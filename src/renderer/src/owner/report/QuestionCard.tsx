// A question the agent left for the person (a `need-input` mark; the P2-C document, Design §6 and §8): its Markdown,
// its choices as buttons in order (the recommended one marked, never preselected) in a labelled group, Reply, and the
// state main reports for it: unanswered (with the last refused send's reason and Retry), queued with Cancel, sent but
// not confirmed with Answer again, answered with Reply kept for a follow-up, or retired. While the card's own send runs
// it says Sending… (Starting… when the send starts the session first) and offers nothing, so one click is one answer.
// Reply opens a text field on the card: Enter sends, Shift-Enter breaks the line, Escape closes it. A session held in a
// terminal or as a background job answers nowhere here: the card says where it is, with Take over. Every action is the
// caller's (`answering.ts`): a control without its handler draws disabled.
import { useId, useState, type KeyboardEvent } from 'react';
import type { Choice } from '@shared/owner/to-human-parser';
import type { QuestionState } from '@shared/owner/state';
import { Markdown } from '../../transcript/view/markdown/Markdown';
import { LABEL, QUESTION } from './copy';

export interface QuestionActions {
  choose?(choice: Choice): void;
  reply?(text: string): Promise<boolean>; // true: the reply left (the field closes); false: it stays, with its text
  retry?(): void; // the last send again
  cancel?(): void;
  takeOver?(): void;
}

export interface QuestionCardProps {
  text: string; // the question's Markdown, its choices lifted out
  choices: readonly Choice[];
  state: QuestionState | null; // null: main has no row for it yet (still streaming, or not derived yet): unanswered
  live: boolean;
  held: 'terminal' | 'background_job' | null; // the session is open elsewhere: nothing to answer here
  actions?: QuestionActions;
  busy?: 'sending' | 'starting' | null; // the card's own send is running
  note?: string | null; // what the card's last cancel answered ("Already on its way", or its failure)
}

export function QuestionCard({ text, choices, state, live, held, actions = {}, busy = null, note = null }: QuestionCardProps) {
  const current = state ?? { state: 'unanswered' as const };
  const [again, setAgain] = useState(false); // "Answer again" on an unconfirmed answer offers the choices again
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState('');
  const fieldId = useId();
  const reopened = again && current.state === 'unconfirmed';
  const asking = current.state === 'unanswered' || reopened;
  const offered = held === null && (asking || current.state === 'delivered');
  const idle = busy === null;

  const sendReply = async () => {
    if (!actions.reply || draft.trim() === '' || !idle) return;
    if (await actions.reply(draft)) {
      setDraft('');
      setReplying(false);
      setAgain(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendReply();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setReplying(false);
    }
  };
  const choose = (choice: Choice) => {
    setAgain(false);
    actions.choose?.(choice);
  };

  return (
    <section className="owner-card" data-owner-card="need-input" data-state={current.state} aria-label={LABEL['need-input']} aria-busy={!idle}>
      <div className="owner-card-label">{LABEL['need-input']}</div>
      <div className="owner-card-body">
        <Markdown markdown={text} live={live} />
        {offered && asking && choices.length > 0 && (
          <div role="group" aria-label={QUESTION.choices} className="owner-question-choices">
            {choices.map((choice, n) => (
              <button key={n} type="button" className="owner-question-choice" data-recommended={choice.recommended ? '' : undefined} disabled={!actions.choose || !idle} onClick={() => choose(choice)}>
                <span className="owner-question-choice-text">{choice.text}</span>
                {choice.recommended && <span className="owner-question-recommended">{QUESTION.recommended}</span>}
              </button>
            ))}
          </div>
        )}
        {busy !== null ? (
          <p role="status" className="owner-card-state">{busy === 'starting' ? QUESTION.starting : QUESTION.sending}</p>
        ) : (
          !reopened && <StateLine state={current} held={held} actions={actions} answerAgain={() => setAgain(true)} />
        )}
        {note !== null && !(current.state === 'unanswered' && current.failed?.reason === note) && <p role="status" className="owner-card-state">{note}</p>}
        {offered && replying && (
          <div className="owner-question-reply">
            <label htmlFor={fieldId} className="owner-question-reply-label">{QUESTION.replyLabel}</label>
            <textarea
              id={fieldId}
              className="owner-question-reply-field"
              rows={2}
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              readOnly={!idle}
            />
          </div>
        )}
        {offered && (
          <div className="owner-card-actions">
            {replying ? (
              <>
                <button type="button" className="owner-card-button" disabled={!actions.reply || !idle || draft.trim() === ''} onClick={() => void sendReply()}>
                  {QUESTION.send}
                </button>
                <button type="button" className="owner-card-button" onClick={() => setReplying(false)}>
                  {QUESTION.close}
                </button>
              </>
            ) : (
              <button type="button" className="owner-card-button" disabled={!actions.reply || !idle} onClick={() => setReplying(true)}>
                {QUESTION.reply}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function StateLine({ state, held, actions, answerAgain }: { state: QuestionState; held: QuestionCardProps['held']; actions: QuestionActions; answerAgain(): void }) {
  if (held !== null && state.state !== 'delivered' && state.state !== 'retired')
    return (
      <p className="owner-card-state">
        {held === 'terminal' ? QUESTION.terminal : QUESTION.backgroundJob}
        {actions.takeOver && (
          <button type="button" className="owner-card-button" onClick={() => actions.takeOver?.()}>
            {QUESTION.takeOver}
          </button>
        )}
      </p>
    );
  switch (state.state) {
    case 'unanswered':
      return state.failed ? (
        <p className="owner-card-state" data-failed="">
          {state.failed.reason}
          {actions.retry && (
            <button type="button" className="owner-card-button" onClick={() => actions.retry?.()}>
              {QUESTION.retry}
            </button>
          )}
        </p>
      ) : null;
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
          <button type="button" className="owner-card-button" disabled={!actions.choose && !actions.reply} onClick={answerAgain}>
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
