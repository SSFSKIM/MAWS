// The question body (C7 execution document, Request card): one section per question, its options as radios (or
// checkboxes when `multiSelect`) with their descriptions, the `Other…` free-text row the engine always accepts, and a
// single-select question's option previews beside the list in a sandboxed frame (only the selected option's, so a
// preview frame exists only while it is shown). Submit is enabled once every question has an answer; Enter submits a
// complete form; Esc leaves the card without answering. C3's broker resolves a question request only with a question
// answer, so there is no Skip: a question is answered here or in the terminal.
import { Checkbox, RadioGroup } from 'radix-ui';
import { useEffect, useState } from 'react';
import type { Question } from '@shared/graph/events';
import { questionAnswers, toAnswer, type VariantState } from '../answers';
import { CardButton, Controls } from '../controls';
import { SandboxedPreview } from '../preview/SandboxedPreview';
import type { VariantProps } from './types';

const OTHER = '\u0000other'; // the Other row's radio value: no option label can be it

type QuestionState = Extract<VariantState, { kind: 'question' }>;

const ROW = 'flex w-full items-start gap-2 rounded-sm border border-border px-2.5 py-1.5 text-left outline-accent hover:bg-bg-hover focus-visible:outline-2 data-[state=checked]:border-border-strong data-[state=checked]:bg-bg-active';

function OptionText({ label, description }: { label: string; description: string | null }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-fg">{label}</span>
      {description && <span className="text-ui-sm text-fg-muted">{description}</span>}
    </span>
  );
}

function OtherInput({ question, value, onChange, disabled }: { question: string; value: string; onChange(value: string): void; disabled: boolean }) {
  return (
    <input
      type="text"
      aria-label={`Other answer to ${question}`}
      value={value}
      disabled={disabled}
      autoFocus
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-sm border border-border-strong bg-bg px-2 py-1 text-ui text-fg outline-accent focus-visible:outline-2"
    />
  );
}

interface SectionProps {
  question: Question;
  selected: string[];
  other: string | null; // null: the Other row is not chosen
  disabled: boolean;
  onSelected(labels: string[]): void;
  onOther(text: string | null): void;
}

function SingleSelect({ question, selected, other, disabled, onSelected, onOther }: SectionProps) {
  const value = other !== null ? OTHER : (selected[0] ?? '');
  const preview = question.options.find((o) => o.label === selected[0])?.preview ?? null;
  const hasPreviews = question.options.some((o) => o.preview !== null);
  return (
    <div className={hasPreviews ? 'grid grid-cols-2 gap-2' : ''}>
      <RadioGroup.Root
        aria-label={question.question}
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (next === OTHER) {
            onSelected([]);
            onOther('');
          } else {
            onOther(null);
            onSelected([next]);
          }
        }}
        className="flex min-w-0 flex-col gap-1"
      >
        {question.options.map((option) => (
          <RadioGroup.Item key={option.label} value={option.label} aria-label={option.label} className={ROW}>
            <OptionText label={option.label} description={option.description} />
          </RadioGroup.Item>
        ))}
        <RadioGroup.Item value={OTHER} aria-label="Other…" className={ROW}>
          <OptionText label="Other…" description={null} />
        </RadioGroup.Item>
        {other !== null && <OtherInput question={question.question} value={other} onChange={onOther} disabled={disabled} />}
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

function MultiSelect({ question, selected, other, disabled, onSelected, onOther }: SectionProps) {
  const toggle = (label: string, on: boolean) => onSelected(on ? question.options.map((o) => o.label).filter((l) => l === label || selected.includes(l)) : selected.filter((l) => l !== label));
  return (
    <div role="group" aria-label={question.question} className="flex flex-col gap-1">
      {question.options.map((option) => (
        <Checkbox.Root
          key={option.label}
          aria-label={option.label}
          checked={selected.includes(option.label)}
          disabled={disabled}
          onCheckedChange={(checked) => toggle(option.label, checked === true)}
          className={ROW}
        >
          <OptionText label={option.label} description={option.description} />
        </Checkbox.Root>
      ))}
      <Checkbox.Root aria-label="Other…" checked={other !== null} disabled={disabled} onCheckedChange={(checked) => onOther(checked === true ? '' : null)} className={ROW}>
        <OptionText label="Other…" description={null} />
      </Checkbox.Root>
      {other !== null && <OtherInput question={question.question} value={other} onChange={onOther} disabled={disabled} />}
    </div>
  );
}

export function QuestionBody({ request, busy, submit, bindKeys }: VariantProps<'question.requested'>) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string | null>>({});
  const state: QuestionState = {
    kind: 'question',
    questions: request.questions,
    selected,
    other: Object.fromEntries(Object.entries(other).filter((entry): entry is [string, string] => entry[1] !== null)),
  };
  const complete = questionAnswers(state) !== null;
  const send = () => complete && submit(toAnswer(state), 'Submitted');

  useEffect(() => {
    bindKeys({
      accept: send,
      decline: () => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined),
    });
  });

  return (
    <div className="flex flex-col gap-4">
      {request.questions.map((question) => {
        const Section = question.multiSelect ? MultiSelect : SingleSelect;
        return (
          <section key={question.question} className="flex flex-col gap-1.5">
            <span className="text-ui-sm text-fg-muted">{question.header}</span>
            <span className="text-fg">{question.question}</span>
            <Section
              question={question}
              selected={selected[question.question] ?? []}
              other={other[question.question] ?? null}
              disabled={busy}
              onSelected={(labels) => setSelected((s) => ({ ...s, [question.question]: labels }))}
              onOther={(text) => setOther((o) => ({ ...o, [question.question]: text }))}
            />
          </section>
        );
      })}
      <Controls>
        {!complete && <span className="mr-auto text-ui-sm text-fg-faint">Answer every question to submit</span>}
        <CardButton tone="primary" disabled={busy || !complete} onClick={send}>
          Submit
        </CardButton>
      </Controls>
    </div>
  );
}
