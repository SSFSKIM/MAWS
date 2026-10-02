// Small pieces the row components share.
import { useEffect, useState } from 'react';
import { ticks, useTranscriptStore, workingDurationMs } from '../../../stores/transcript';

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

// A line of copy whose backtick spans are code (`Ran \`pnpm test\` in 3s`); an unmatched backtick stays literal.
export function CodeText({ text }: { text: string }) {
  const parts = text.split('`');
  if (parts.length < 3) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return part;
        return i === parts.length - 1 ? `\`${part}` : <code key={i}>{part}</code>;
      })}
    </>
  );
}

// `+{added} −{removed}` in the diff colours.
export function LineCounts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="transcript-counts">
      <span className="transcript-add">+{added}</span> <span className="transcript-del">−{removed}</span>
    </span>
  );
}

// Now, re-read once a second while `active` (a working duration ticks from it); frozen otherwise.
export function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

// How long something that started at `startedAt` has been working (W8: a streaming thinking block), re-read once a
// second while the key's process is live; without one it is the latest event's time, following the events and never
// the wall clock (the divider's rule).
export function useWorkingMs(storeKey: string, startedAt: string): number {
  const frozen = useTranscriptStore((state) => (ticks(state, storeKey) ? null : workingDurationMs(state.entries[storeKey], startedAt, 0, false)));
  const now = useTicker(frozen === null);
  return frozen ?? workingDurationMs(useTranscriptStore.getState().entries[storeKey], startedAt, now);
}
