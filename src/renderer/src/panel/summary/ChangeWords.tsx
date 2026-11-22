// The uncommitted change line's words, shared by the card's own line (Environment.tsx) and Review's control in its place
// (tools/code/review/ReviewSummary.tsx): "Clean", "…" or "Change unavailable" while the diff is not known, else
// "+12 −3 · 4 files". The word cut (P36, T364): the untracked and binary counts leave the line for its tooltip and
// description (`uncounted`, empty when there are none); each caller gives the line its own owner, a button or a span.
import type { ReactNode } from 'react';
import type { GitEntry } from '../../stores/git';
import { SUMMARY_COPY } from '../copy';
import { changeLine } from './derive';

export function changeWords(entry: GitEntry): { words: ReactNode; uncounted: string } {
  const line = changeLine(entry.status, entry.uncommitted?.files ?? null);
  if (line.kind === 'clean') return { words: SUMMARY_COPY.clean, uncounted: '' };
  if (line.kind === 'unknown') return { words: entry.error ? SUMMARY_COPY.changeUnavailable : SUMMARY_COPY.pending, uncounted: '' };
  return {
    words: (
      <>
        <span className="text-success">+{line.insertions}</span> <span className="text-danger">−{line.deletions}</span> {SUMMARY_COPY.files(line.files)}
      </>
    ),
    uncounted: SUMMARY_COPY.uncounted(line.untracked, line.binary),
  };
}
