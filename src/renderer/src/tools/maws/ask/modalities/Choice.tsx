// A choice question (E1 M4): the options as radios, or checkboxes when `multi`, each with its description, and the
// `Other…` row with its text box unless the question set `allowOther: false`. The rows are the request card's
// (`request-card/variants/Question.tsx`), so a question reads the same in the card and in the sheet.
// P2-C3 (the P2 spec's Decision Log 34): a single-select question whose options carry previews lays the options out
// beside a pane showing the focused option's markdown (beside them when the question is wide enough, under them when
// not; a container query, as the panel's width is the one that varies). Focused is where the keyboard or a click last
// landed on an option (the radios' arrow keys move focus and selection together); before that the selected option, else
// the first with a preview. The Other row focuses nothing new. The pane's height never follows its content, so moving
// between previews does not move the rows beneath.
import { Checkbox, RadioGroup } from 'radix-ui';
import { useState } from 'react';
import type { AskQuestion } from '@shared/maws/tools';
import { Markdown } from '../../../../transcript';
import { SHEET } from '../copy';
import { pickOption, setOther, toggleOption } from '../draft';
import type { ModalityProps } from './types';

const OTHER = '\u0000other'; // the Other row's radio value: no option label can be it

export const OPTION_ROW =
  'flex w-full items-start gap-2 rounded-sm border border-border px-2.5 py-1.5 text-left outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:hover:bg-transparent data-[state=checked]:border-border-strong data-[state=checked]:bg-bg-active';

// The checked mark the request card's rows lack a glyph for: a dot or a tick in front of the label, so selection never
// rests on the row's tint alone.
function Mark({ multi }: { multi: boolean }) {
  return (
    <span aria-hidden className={`mt-0.5 flex size-3.5 shrink-0 items-center justify-center border border-border-strong ${multi ? 'rounded-[calc(var(--radius-sm)/2)]' : 'rounded-full'}`}>
      {multi ? (
        <Checkbox.Indicator className="text-fg">
          <svg viewBox="0 0 12 12" className="size-2.5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.75]">
            <path d="M2.5 6.25 5 8.5l4.5-5" />
          </svg>
        </Checkbox.Indicator>
      ) : (
        <RadioGroup.Indicator className="size-1.5 rounded-full bg-fg" />
      )}
    </span>
  );
}

export function OptionText({ label, description }: { label: string; description?: string | null }) {
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
      aria-label={SHEET.otherLabel(question)}
      placeholder={SHEET.otherPlaceholder}
      value={value}
      disabled={disabled}
      autoFocus={!disabled && value === ''}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-sm border border-border-strong bg-bg px-2 py-1 text-ui text-fg outline-accent focus-visible:outline-2"
    />
  );
}

type ChoiceOption = NonNullable<AskQuestion['options']>[number];

// The focused option's preview, or a quiet line for an option without one; it scrolls inside its own box.
function PreviewPane({ option }: { option: ChoiceOption }) {
  return (
    <div
      role="region"
      aria-label={SHEET.previewOf(option.label)}
      data-ask-preview=""
      data-preview-of={option.label}
      tabIndex={0}
      className="relative h-56 min-w-0 rounded-sm border border-border bg-bg-raised outline-accent focus-visible:outline-2 @lg:h-auto @lg:min-h-56"
    >
      <div className="absolute inset-0 overflow-auto px-3 py-2 text-ui text-fg">
        {option.preview !== undefined ? <Markdown markdown={option.preview} live={false} /> : <p className="m-0 text-ui-sm text-fg-faint">{SHEET.noPreview}</p>}
      </div>
    </div>
  );
}

export function Choice({ question, draft, disabled, edit }: ModalityProps) {
  const options = question.options ?? [];
  const allowOther = question.allowOther !== false;
  const other = draft.otherText;
  const [focused, setFocused] = useState<string | null>(null);
  const otherInput = other !== null && <OtherInput question={question.question} value={other} disabled={disabled} onChange={(text) => edit((d) => setOther(question, d, text))} />;

  if (question.multi === true) {
    return (
      <div role="group" aria-label={question.question} className="flex flex-col gap-1">
        {options.map((option) => (
          <Checkbox.Root
            key={option.label}
            aria-label={option.label}
            checked={draft.selected.includes(option.label)}
            disabled={disabled}
            onCheckedChange={(checked) => edit((d) => toggleOption(question, d, option.label, checked === true))}
            className={OPTION_ROW}
          >
            <Mark multi />
            <OptionText label={option.label} description={option.description} />
          </Checkbox.Root>
        ))}
        {allowOther && (
          <Checkbox.Root aria-label={SHEET.other} checked={other !== null} disabled={disabled} onCheckedChange={(checked) => edit((d) => setOther(question, d, checked === true ? (d.otherText ?? '') : null))} className={OPTION_ROW}>
            <Mark multi />
            <OptionText label={SHEET.other} />
          </Checkbox.Root>
        )}
        {otherInput}
      </div>
    );
  }

  const withPreview = options.find((option) => option.preview !== undefined);
  const shown = withPreview && (options.find((option) => option.label === (focused ?? draft.selected[0])) ?? withPreview);
  const radios = (
    <RadioGroup.Root
      aria-label={question.question}
      value={other !== null ? OTHER : (draft.selected[0] ?? '')}
      disabled={disabled}
      onValueChange={(value) => edit((d) => (value === OTHER ? setOther(question, d, d.otherText ?? '') : pickOption(question, d, value)))}
      className="flex min-w-0 flex-col gap-1"
    >
      {options.map((option) => (
        <RadioGroup.Item
          key={option.label}
          value={option.label}
          aria-label={option.label}
          onFocus={() => setFocused(option.label)}
          onClick={() => setFocused(option.label)}
          className={OPTION_ROW}
        >
          <Mark multi={false} />
          <OptionText label={option.label} description={option.description} />
        </RadioGroup.Item>
      ))}
      {allowOther && (
        <RadioGroup.Item value={OTHER} aria-label={SHEET.other} className={OPTION_ROW}>
          <Mark multi={false} />
          <OptionText label={SHEET.other} />
        </RadioGroup.Item>
      )}
      {otherInput}
    </RadioGroup.Root>
  );
  if (!shown) return radios;
  return (
    <div className="@container">
      <div className="grid gap-2 @lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {radios}
        <PreviewPane option={shown} />
      </div>
    </div>
  );
}
