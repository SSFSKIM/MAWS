// A text question (E1 M4): one text box, the model's placeholder when it gave one. Enter keeps its newline.
import { SHEET } from '../copy';
import { setText } from '../draft';
import type { ModalityProps } from './types';

export function Text({ question, draft, disabled, edit }: ModalityProps) {
  return (
    <textarea
      aria-label={question.question}
      placeholder={question.placeholder ?? SHEET.textPlaceholder}
      value={draft.text}
      rows={3}
      disabled={disabled}
      onChange={(event) => {
        const text = event.target.value;
        edit((d) => setText(d, text));
      }}
      className="w-full resize-y rounded-sm border border-border-strong bg-bg px-2 py-1.5 text-ui text-fg outline-accent placeholder:text-fg-faint focus-visible:outline-2"
    />
  );
}
