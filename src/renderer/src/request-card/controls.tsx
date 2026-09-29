// The card's buttons and small shared pieces, in tokens only (X7), so every variant's controls look the same.
import type { ButtonHTMLAttributes, ReactNode } from 'react';

const TONES = {
  primary: 'border-fg bg-fg text-bg hover:bg-fg-muted disabled:border-fg-faint disabled:bg-fg-faint',
  secondary: 'border-border-strong text-fg hover:bg-bg-hover disabled:text-fg-faint',
  danger: 'border-border-strong text-danger hover:bg-bg-hover disabled:text-fg-faint',
} as const;

export function CardButton({ tone = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof TONES }) {
  return <button type="button" {...props} className={`rounded-sm border px-2.5 py-1 whitespace-nowrap outline-accent focus-visible:outline-2 ${TONES[tone]} ${className}`} />;
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
