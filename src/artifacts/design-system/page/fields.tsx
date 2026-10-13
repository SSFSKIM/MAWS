// An editable value on the page. Every edit that reads is written as it is made (Decision Log 17: the page holds no
// unsaved buffer, so it needs no close guard and a tab closed mid-edit loses nothing written); what the owner typed
// stays in the field until they leave it, so the stored form (`16px` for `16`) does not jump under the caret. An edit
// that does not read yet (`#12`, `1e`) stays in the field, shown as invalid with the model's reason, and is not
// written; Escape drops it. A remote change replaces an invalid draft; a written draft stands until the field is left.
import { useState, type KeyboardEvent } from 'react';

export function CommitField(props: {
  label: string;
  value: string;
  /** Writes the value if it reads; returns why not, or null when it was written. */
  commit(text: string): string | null;
  disabled?: boolean;
  className?: string;
  width?: string;
}) {
  const { label, value, commit, disabled, className, width } = props;
  // A draft is what the owner typed: written to the doc (`refusal` null), or not, with why; `base` is the value it was
  // typed over, so an unwritten draft goes when the value changes under it.
  const [draft, setDraft] = useState<{ text: string; base: string; refusal: string | null } | null>(null);
  const live = draft && (draft.refusal === null || draft.base === value) ? draft : null;
  const text = live ? live.text : value;
  const error = live?.refusal ?? null;
  const edit = (next: string) => {
    const refusal = next.trim() === '' ? 'Type a value' : commit(next.trim());
    setDraft({ text: next, base: value, refusal });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') setDraft(null);
  };
  return (
    <span className={`dsp-field${className ? ` ${className}` : ''}`}>
      <input
        aria-label={label}
        aria-invalid={error ? true : undefined}
        title={error ?? undefined}
        value={text}
        disabled={disabled}
        spellCheck={false}
        style={width ? { width } : undefined}
        onChange={(event) => edit(event.target.value)}
        onBlur={() => setDraft((d) => (d && d.refusal !== null ? d : null))}
        onKeyDown={onKeyDown}
      />
      {error ? (
        <span role="alert" className="dsp-field-error">
          {error}
        </span>
      ) : null}
    </span>
  );
}
