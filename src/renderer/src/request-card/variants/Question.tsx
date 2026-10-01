// The question body (C7 execution document, Request card; W4, the stepper after Claude Desktop's card): one question
// at a time under a "{n} of {N}" pager, its options as numbered radios (or checkboxes when `multiSelect`) with their
// descriptions, the `Other…` free-text row the engine always accepts last, and a single-select question's option
// previews in a sandboxed frame (only the selected option's, so a preview frame exists only while it is shown). A
// single-select pick moves on by itself after a beat (unless the question is the last or shows previews); a
// multi-select question and Other move on with Next; Skip leaves the question unanswered and moves on; the last step's
// Submit (or Skip) sends every answer as the one reply the wire takes (`question-roundtrip` seq 138), a skipped question
// left out of it. The picks live beside the request in the attention store, so a remount resumes them. Enter is Next or
// Submit once the question is answered, digits pick its options, and Esc declines the whole request with the plain
// permission deny the terminal's Escape writes: C3's broker admits it for a question, the engine hands the model
// `Denied by the user in MAWS.` and the turn goes on (pass3/question-deny seq 108 to 154), and the transcript records
// the question with no answers.
import { Checkbox, RadioGroup } from 'radix-ui';
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import type { Question } from '@shared/graph/events';
import { useAttention } from '../../stores/attention';
import { questionAnswers, toAnswer } from '../answers';
import { CardButton, Controls } from '../controls';
import { SandboxedPreview } from '../preview/SandboxedPreview';
import { advance, advancesOnPick, answerOf, EMPTY_DRAFT, goTo, pick, setOther, skip, toggle, type QuestionDraft } from '../question-steps';
import type { VariantProps } from './types';

const OTHER = '\u0000other'; // the Other row's radio value: no option label can be it
const ADVANCE_MS = 200; // T3's beat between a single-select pick and the next question, so the pick is seen

const ROW = 'flex w-full items-start gap-2 rounded-sm border border-border px-2.5 py-1.5 text-left outline-accent hover:bg-bg-hover focus-visible:outline-2 data-[state=checked]:border-border-strong data-[state=checked]:bg-bg-active';

function OptionText({ n, label, description }: { n: number; label: string; description: string | null }) {
  return (
    <>
      <span aria-hidden className="w-3 shrink-0 text-fg-muted tabular-nums">
        {n}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-fg">{label}</span>
        {description && <span className="text-ui-sm text-fg-muted">{description}</span>}
      </span>
    </>
  );
}

// Enter in the box is the step's Enter (C5's dispatcher refuses text entry, so it never reaches the card's binding).
function OtherInput({ question, value, onChange, onEnter, disabled }: { question: string; value: string; onChange(value: string): void; onEnter(): void; disabled: boolean }) {
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    onEnter();
  };
  return (
    <input
      type="text"
      aria-label={`Other answer to ${question}`}
      placeholder="Type your own answer"
      value={value}
      disabled={disabled}
      autoFocus
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      className="w-full rounded-sm border border-border-strong bg-bg px-2 py-1 text-ui text-fg outline-accent focus-visible:outline-2"
    />
  );
}

interface StepProps {
  question: Question;
  draft: QuestionDraft;
  disabled: boolean;
  onPick(label: string): void; // single-select
  onToggle(label: string, on: boolean): void; // multi-select
  onOther(text: string | null): void;
  onEnter(): void;
}

function SingleSelect({ question, draft, disabled, onPick, onOther, onEnter }: StepProps) {
  const selected = draft.selected[question.question] ?? [];
  const other = draft.other[question.question] ?? null;
  const value = other !== null ? OTHER : (selected[0] ?? '');
  const preview = question.options.find((o) => o.label === selected[0])?.preview ?? null;
  const hasPreviews = question.options.some((o) => o.preview !== null);
  return (
    <div className={hasPreviews ? 'grid gap-2 @lg:grid-cols-2' : ''}>
      <RadioGroup.Root
        aria-label={question.question}
        value={value}
        disabled={disabled}
        onValueChange={(next) => (next === OTHER ? onOther('') : onPick(next))}
        className="flex min-w-0 flex-col gap-1"
      >
        {question.options.map((option, i) => (
          <RadioGroup.Item key={option.label} value={option.label} aria-label={option.label} className={ROW}>
            <OptionText n={i + 1} label={option.label} description={option.description} />
          </RadioGroup.Item>
        ))}
        <RadioGroup.Item value={OTHER} aria-label="Other…" className={ROW}>
          <OptionText n={question.options.length + 1} label="Other…" description={null} />
        </RadioGroup.Item>
        {other !== null && <OtherInput question={question.question} value={other} onChange={onOther} onEnter={onEnter} disabled={disabled} />}
      </RadioGroup.Root>
      {hasPreviews &&
        (preview !== null ? (
          <SandboxedPreview preview={preview} title={`Preview of ${selected[0]}`} />
        ) : (
          <p className="m-0 self-center text-center text-ui-sm text-fg-faint">Select an option to preview it</p>
        ))}
    </div>
  );
}

function MultiSelect({ question, draft, disabled, onToggle, onOther, onEnter }: StepProps) {
  const selected = draft.selected[question.question] ?? [];
  const other = draft.other[question.question] ?? null;
  return (
    <div role="group" aria-label={question.question} className="flex flex-col gap-1">
      {question.options.map((option, i) => (
        <Checkbox.Root
          key={option.label}
          aria-label={option.label}
          checked={selected.includes(option.label)}
          disabled={disabled}
          onCheckedChange={(checked) => onToggle(option.label, checked === true)}
          className={ROW}
        >
          <OptionText n={i + 1} label={option.label} description={option.description} />
        </Checkbox.Root>
      ))}
      <Checkbox.Root aria-label="Other…" checked={other !== null} disabled={disabled} onCheckedChange={(checked) => onOther(checked === true ? '' : null)} className={ROW}>
        <OptionText n={question.options.length + 1} label="Other…" description={null} />
      </Checkbox.Root>
      {other !== null && <OtherInput question={question.question} value={other} onChange={onOther} onEnter={onEnter} disabled={disabled} />}
    </div>
  );
}

// The element that owns the card's keys for the placement (RequestCard's rule): the docked frame, or C5's article
// around an Overview card. Inline and hover own none.
function keyOwner(body: HTMLElement, placement: VariantProps<'question.requested'>['placement']): HTMLElement | null {
  if (placement === 'docked') return body.closest<HTMLElement>('[data-docked-frame]');
  if (placement === 'card') return body.closest<HTMLElement>('[data-request-card]')?.parentElement?.closest<HTMLElement>('[tabindex]') ?? null;
  return null;
}

const ARROW = 'rounded-sm px-1 text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent';

export function QuestionBody({ item, request, placement, busy, submit, bindKeys }: VariantProps<'question.requested'>) {
  const { questions } = request;
  const count = questions.length;
  const draft = useAttention((s) => s.drafts.get(item.id)) ?? EMPTY_DRAFT;
  const save = (next: QuestionDraft) => useAttention.getState().setDraft(item.id, next);
  const step = Math.min(draft.step, count - 1);
  const question = questions[step];
  const last = step === count - 1;
  const answered = answerOf(draft, question) !== null;

  const reply = (final: QuestionDraft) => {
    const answers = questionAnswers({ kind: 'question', questions, selected: final.selected, other: final.other });
    submit(toAnswer({ kind: 'question', questions, selected: final.selected, other: final.other }), Object.keys(answers).length > 0 ? 'Submitted' : 'Skipped');
  };
  const forward = () => {
    if (!answered) return;
    if (last) reply(draft);
    else save(advance(draft, count));
  };
  const skipStep = () => {
    const skipped = skip(draft, question, count);
    save(skipped);
    if (last) reply(skipped);
  };
  const decline = () => submit(toAnswer({ kind: 'permission', decision: 'deny', message: '' }), 'Skipped');

  // A single-select pick moves on after a beat, from the draft as it is then, and only if the step is still this one.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelAdvance = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancelAdvance, []);
  const onPick = (label: string) => {
    save(pick(draft, question, label));
    if (!advancesOnPick(question, last)) return;
    cancelAdvance();
    timer.current = setTimeout(() => {
      timer.current = null;
      const now = useAttention.getState().drafts.get(item.id);
      if (now && now.step === step) save(advance(now, count));
    }, ADVANCE_MS);
  };
  const onToggle = (label: string, on: boolean) => save(toggle(draft, question, label, on));
  const onOther = (text: string | null) => {
    cancelAdvance();
    save(setOther(draft, question, text));
  };
  const show = (to: number) => {
    cancelAdvance();
    save(goTo(draft, to, count));
  };

  useEffect(() => {
    bindKeys({
      accept: forward,
      decline,
      digit: (n) => {
        const option = question.options[n - 1];
        if (option) {
          if (question.multiSelect) onToggle(option.label, !(draft.selected[question.question] ?? []).includes(option.label));
          else onPick(option.label);
        } else if (n === question.options.length + 1) onOther(draft.other[question.question] ?? '');
      },
    });
  });

  // A step change removes the focused option with its question: focus goes back to the key owner, so Enter and the
  // digits go on working, or (inline, with no owner) to the new question's first option. Focus elsewhere is left be.
  const bodyRef = useRef<HTMLDivElement>(null);
  const shown = useRef(step);
  useLayoutEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    const body = bodyRef.current;
    const active = document.activeElement;
    if (!body || (active !== null && active !== document.body)) return;
    (keyOwner(body, placement) ?? body.querySelector<HTMLElement>('[role="radio"], [role="checkbox"]'))?.focus();
  }, [step, placement]);

  const Step = question.multiSelect ? MultiSelect : SingleSelect;
  return (
    <div ref={bodyRef} data-question-step={step + 1} className="@container flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-ui-sm text-fg-muted">{question.header}</span>
          {count > 1 && (
            <span className="flex shrink-0 items-center gap-0.5 text-ui-sm text-fg-muted">
              <button type="button" aria-label="Show previous question" className={ARROW} disabled={busy || step === 0} onClick={() => show(step - 1)}>
                ‹
              </button>
              <span aria-live="polite" className="tabular-nums">
                {step + 1} of {count}
              </span>
              <button type="button" aria-label="Show next question" className={ARROW} disabled={busy || step >= draft.reached} onClick={() => show(step + 1)}>
                ›
              </button>
            </span>
          )}
        </div>
        <span className="text-fg">{question.question}</span>
      </div>
      <Step key={question.question} question={question} draft={draft} disabled={busy} onPick={onPick} onToggle={onToggle} onOther={onOther} onEnter={forward} />
      <Controls>
        <CardButton disabled={busy} onClick={skipStep}>
          Skip
        </CardButton>
        <CardButton tone="primary" disabled={busy || !answered} title={answered ? undefined : 'Choose an option or skip this question'} onClick={forward}>
          {last ? 'Submit' : 'Next'}
        </CardButton>
      </Controls>
    </div>
  );
}
