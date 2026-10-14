// One question of the Question sheet (E1 M4): its header as a small-caps label, the question as the section's lead, the
// control its modality names, and under it, right-aligned, *Decide for me* and *Skip*, two toggles exclusive with each
// other and with the answer (`draft.ts`). While one is on the control stays as it was, dimmed, so turning the toggle
// off gives the answer back. `AnsweredSection` is the read-only form: the same label and lead, then the answer given.
// P2-C3: *Add note*, quiet at the left of that row, opens a note beside the answer; neither toggle touches it.
import { useState, type ReactNode } from 'react';
import type { ProjectRecord } from '@shared/ipc/schema';
import { ASK_NOTE_MAX, type AskAnswer, type AskQuestion } from '@shared/maws/tools';
import { SHEET } from './copy';
import { setDecide, setNote, setSkip, type Draft } from './draft';
import { Choice } from './modalities/Choice';
import { Paths } from './modalities/Paths';
import { Repository } from './modalities/Repository';
import { Text } from './modalities/Text';

const LABEL = 'm-0 text-ui-sm font-semibold tracking-wide text-fg-muted uppercase';

function Lead({ question }: { question: AskQuestion }) {
  return (
    <div className="flex flex-col gap-0.5">
      {question.header && <h3 className={LABEL}>{question.header}</h3>}
      <p className="m-0 whitespace-pre-wrap text-ui font-medium text-fg">{question.question}</p>
    </div>
  );
}

function Shell({ question, children }: { question: AskQuestion; children: ReactNode }) {
  return (
    <section aria-label={question.header ?? question.question} data-question-id={question.id} className="flex flex-col gap-2 border-t border-border px-4 py-3.5 first:border-t-0">
      <Lead question={question} />
      {children}
    </section>
  );
}

function Toggle({ pressed, disabled, onClick, children }: { pressed: boolean; disabled: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className="rounded-sm border px-2 py-0.5 text-ui-sm outline-accent focus-visible:outline-2 disabled:text-fg-faint aria-pressed:border-border-strong aria-pressed:bg-bg-active aria-pressed:text-fg aria-[pressed=false]:border-transparent aria-[pressed=false]:text-fg-muted aria-[pressed=false]:hover:bg-bg-hover aria-[pressed=false]:hover:text-fg"
    >
      {children}
    </button>
  );
}

// The note's field once opened (`draft.note` a string), focused when the button opened it; emptied and left, it closes
// back to the button.
function Note({ question, note, disabled, focus, edit }: { question: AskQuestion; note: string; disabled: boolean; focus: boolean; edit: QuestionSectionProps['edit'] }) {
  return (
    <textarea
      rows={2}
      maxLength={ASK_NOTE_MAX}
      aria-label={SHEET.noteLabel(question.question)}
      placeholder={SHEET.notePlaceholder}
      value={note}
      disabled={disabled}
      autoFocus={focus}
      onChange={(event) => edit((d) => setNote(d, event.target.value))}
      onBlur={() => edit((d) => (d.note !== null && d.note.trim() === '' ? setNote(d, null) : d))}
      className="w-full resize-y rounded-sm border border-border bg-bg px-2 py-1 text-ui-sm text-fg outline-accent placeholder:text-fg-faint focus-visible:outline-2 disabled:text-fg-muted"
    />
  );
}

export interface QuestionSectionProps {
  question: AskQuestion;
  draft: Draft;
  disabled: boolean;
  edit(change: (draft: Draft) => Draft): void;
  directory: string | null; // where the file and folder picker opens
  projects: readonly ProjectRecord[];
}

export function QuestionSection({ question, draft, disabled, edit, directory, projects }: QuestionSectionProps) {
  const set = draft.decide || draft.skip;
  const [focusNote, setFocusNote] = useState(false); // the field opened by the button, not one restored with the draft
  const props = { question, draft, disabled, edit };
  let control: ReactNode;
  switch (question.modality) {
    case 'choice':
      control = <Choice {...props} />;
      break;
    case 'text':
      control = <Text {...props} />;
      break;
    case 'file':
    case 'folder':
      control = <Paths {...props} directory={directory} />;
      break;
    case 'repository':
      control = <Repository {...props} projects={projects} />;
      break;
  }
  return (
    <Shell question={question}>
      <div data-question-set={set ? (draft.decide ? 'decide' : 'skip') : undefined} className={set ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
        {control}
      </div>
      <div className="flex items-center gap-1">
        {draft.note === null && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setFocusNote(true);
              edit((d) => setNote(d, d.note ?? ''));
            }}
            className="rounded-sm px-1 py-0.5 text-ui-sm text-fg-faint outline-accent hover:text-fg-muted focus-visible:outline-2 disabled:hover:text-fg-faint"
          >
            {SHEET.addNote}
          </button>
        )}
        <div className="ml-auto flex gap-1">
          <Toggle pressed={draft.decide} disabled={disabled} onClick={() => edit((d) => setDecide(d, !d.decide))}>
            {SHEET.decideForMe}
          </Toggle>
          <Toggle pressed={draft.skip} disabled={disabled} onClick={() => edit((d) => setSkip(d, !d.skip))}>
            {SHEET.skip}
          </Toggle>
        </div>
      </div>
      {draft.note !== null && <Note question={question} note={draft.note} disabled={disabled} focus={focusNote} edit={edit} />}
    </Shell>
  );
}

function AnswerValue({ question, answer }: { question: AskQuestion; answer: AskAnswer | undefined }) {
  const muted = (text: string) => <p className="m-0 text-ui text-fg-muted">{text}</p>;
  if (answer === undefined) return muted(SHEET.answerNone);
  if (answer.status === 'skipped') return muted(SHEET.answerSkipped);
  if (answer.status === 'decide_for_me') return muted(SHEET.answerDecided);
  const values = answer.value === undefined ? [] : Array.isArray(answer.value) ? answer.value : [answer.value];
  switch (question.modality) {
    case 'choice':
      return (
        <div className="flex flex-col gap-0.5 text-ui text-fg">
          {values.length > 0 && <p className="m-0">{values.join(', ')}</p>}
          {answer.otherText !== undefined && <p className="m-0">{SHEET.otherAnswer(answer.otherText)}</p>}
        </div>
      );
    case 'text':
      return <p className="m-0 whitespace-pre-wrap text-ui text-fg">{values.join('\n')}</p>;
    case 'file':
    case 'folder':
      return (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {values.map((path) => (
            <li key={path} className="truncate font-mono text-code text-fg" title={path}>
              {path}
            </li>
          ))}
        </ul>
      );
    case 'repository':
      return (
        <div className="flex flex-col text-ui">
          {answer.name !== undefined && <span className="text-fg">{answer.name}</span>}
          <span className={answer.name !== undefined ? 'text-ui-sm text-fg-muted' : 'text-fg'}>{values.join(', ')}</span>
        </div>
      );
  }
}

// The read-only form: `answers` null shows the questions alone (an ask that was never answered).
export function AnsweredSection({ question, answers }: { question: AskQuestion; answers: readonly AskAnswer[] | null }) {
  const answer = answers?.find((given) => given.id === question.id);
  return (
    <Shell question={question}>
      {answers !== null && <AnswerValue question={question} answer={answer} />}
      {answer?.note !== undefined && (
        <div data-ask-note="" className="flex flex-col gap-0.5">
          <span className="text-ui-sm text-fg-faint">{SHEET.note}</span>
          <p className="m-0 whitespace-pre-wrap text-ui text-fg-muted">{answer.note}</p>
        </div>
      )}
    </Shell>
  );
}
