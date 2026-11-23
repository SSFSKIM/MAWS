// The quiet spinner (the word cut, "What the cut builds"; Acceptance 5): it stands where the content will be and
// replaces "Reading…", "Loading…" and their kin. Nothing for the first half second of a wait, so a quick one shows
// nothing; then the app's small ring (the one the queue, the checklist and the side question draw), its accessible name
// the wait's words. A timer, not a frame: a hidden window draws none.
import { useEffect, useState } from 'react';

export const QUIET_MS = 500;
export const SPINNER = 'inline-block size-3 shrink-0 animate-spin rounded-full border border-border-strong border-t-accent motion-reduce:animate-none';

export function QuietSpinner({ label, className = '' }: { label: string; className?: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), QUIET_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!shown) return null;
  return <span role="progressbar" aria-label={label} className={`${SPINNER} ${className}`} />;
}

// A control's words kept while its action waits (Send while a comment goes, Submit while answers go): the words, then
// the quiet spinner named by the wait's words, never words in the words' place; the words alone while nothing waits.
// The control says `aria-busy` itself, since it alone knows its own state.
export function WaitingWords({ words, wait }: { words: string; wait: string | null }) {
  return (
    <>
      <span>{words}</span>
      {wait !== null && <QuietSpinner label={wait} className="ml-1.5 align-[-1px]" />}
    </>
  );
}
