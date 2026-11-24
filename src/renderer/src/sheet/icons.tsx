// The sheet's glyphs, drawn in the line's colour.
export function Chevron({ className }: { className?: string }) {
  // transcript.css turns it when it is its expanded button's own child
  return (
    <svg className={className ? `transcript-chevron ${className}` : 'transcript-chevron'} viewBox="0 0 12 12" aria-hidden="true">
      <path d="m4 2 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function OpenIcon() {
  return (
    <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
      <path d="M5 2H2.5v7.5H10V7M7 2h3v3M10 2 5.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
      <path d="m3 3 6 6M9 3 3 9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
