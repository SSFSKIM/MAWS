// Small pieces the row components share.

// The disclosure chevron; rotates when its button's aria-expanded is true (transcript.css).
export function Chevron() {
  return (
    <svg className="transcript-chevron" viewBox="0 0 12 12" aria-hidden="true">
      <path d="m4 2 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Per-row copy (residue *Copy and export*): the sandboxed renderer may use the clipboard on a user gesture.
export function copyText(text: string): void {
  void navigator.clipboard?.writeText(text);
}

const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
export const clockTime = (at: string) => TIME.format(Date.parse(at));
