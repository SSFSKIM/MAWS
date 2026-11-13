// The card's buttons and small shared pieces, in tokens only (X7), so every variant's controls look the same.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { formatChord, parseChord } from '@shared/keymap/chord';

const TONES = {
  primary: 'border-fg bg-fg text-bg hover:bg-fg-muted disabled:border-fg-faint disabled:bg-fg-faint',
  secondary: 'border-border-strong text-fg hover:bg-bg-hover disabled:text-fg-faint',
  danger: 'border-border-strong text-danger hover:bg-bg-hover disabled:text-fg-faint',
} as const;

// UX wave U1a (§D): `chord`, an accelerator (a row's effective chord), is the key that answers this button. It is printed
// inside the button in the keymap's formatting and hidden from the accessibility tree, and the button carries it in
// `aria-keyshortcuts`, so the button's name stays its words ("Allow once", not "Allow once ⌘↩"). Null or absent: no hint.
export function CardButton({ tone = 'secondary', className = '', chord = null, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof TONES; chord?: string | null }) {
  return (
    <button type="button" aria-keyshortcuts={chord === null ? undefined : ariaKeys(chord)} {...props} className={`rounded-sm border px-2.5 py-1 whitespace-nowrap outline-accent focus-visible:outline-2 ${TONES[tone]} ${className}`}>
      {children}
      {chord !== null && (
        <kbd aria-hidden="true" className="ml-1.5 font-ui opacity-70">
          {formatChord(chord)}
        </kbd>
      )}
    </button>
  );
}

// An accelerator in `aria-keyshortcuts`'s words: the modifiers as a KeyboardEvent names them, then the key ('Cmd+Shift+Enter'
// → 'Meta+Shift+Enter'); a one-character key as written, any other by the name the chord matches (`Enter`, `Escape`, `F6`).
function ariaKeys(accelerator: string): string {
  const chord = parseChord(accelerator);
  const last = accelerator.split('+').at(-1) ?? '';
  const modifiers = [chord.meta && 'Meta', chord.ctrl && 'Control', chord.alt && 'Alt', chord.shift && 'Shift'].filter(Boolean);
  return [...modifiers, last.length === 1 ? last : chord.key].join('+');
}

export function Controls({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>;
}

export function Muted({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`m-0 text-ui-sm text-fg-muted ${className}`}>{children}</p>;
}

export const pretty = (value: unknown) => JSON.stringify(value ?? null, null, 2);

// A text area the card owns: Enter keeps its newline, ⌘Enter runs `onSubmit` (C5's dispatcher refuses text entry, so
// this is the only Enter path inside it).
export function CardTextarea({ label, value, onChange, onSubmit, submitOnEnter = false, autoFocus, disabled }: {
  label: string;
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  submitOnEnter?: boolean; // plain Enter also submits (Shift+Enter keeps the newline)
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  return (
    <textarea
      aria-label={label}
      value={value}
      rows={2}
      autoFocus={autoFocus}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
        if (event.metaKey || (submitOnEnter && !event.shiftKey)) {
          event.preventDefault();
          onSubmit();
        }
      }}
      className="w-full resize-y rounded-sm border border-border-strong bg-bg px-2 py-1.5 text-ui text-fg outline-accent focus-visible:outline-2"
    />
  );
}
