// An editable value on the page: a draft while the owner types, written when they leave the field or press Enter,
// dropped on Escape. A write the model refuses (Decision Log 19) shows its reason beside the field and keeps the draft.
import { useState, type KeyboardEvent } from 'react';

export function CommitField(props: {
  label: string;
  value: string;
  /** Writes the value; returns a refusal to show, or null when it was written. */
  commit(text: string): string | null;
  disabled?: boolean;
  className?: string;
  width?: string;
}) {
  const { label, value, commit, disabled, className, width } = props;
  const [draft, setDraft] = useState<{ base: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A draft is over the value it started from; when the value changes under it (a remote edit), the draft goes.
  const text = draft && draft.base === value ? draft.text : value;
  const write = () => {
    if (!draft || draft.base !== value || draft.text === value) {
      setDraft(null);
      return;
    }
    const refused = commit(draft.text.trim());
    setError(refused);
    if (!refused) setDraft(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') write();
    else if (event.key === 'Escape') {
      setDraft(null);
      setError(null);
    }
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
        onChange={(event) => setDraft({ base: value, text: event.target.value })}
        onBlur={write}
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
