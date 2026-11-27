// One line of what entered a session or what an agent sent (UX wave U3, UC-2 "The rows"; the U3a document, M2): the
// lead mark and the words in one line, cut with an ellipsis at the column's edge. Since a narrower column cuts any line
// and no word may be out of reach, the line itself is always the control that opens what it stands for (a click, or
// Enter or Space with focus; the architect's ruling of 2026-11-13). What stands at the line's end (a send's state,
// Reply) is the caller's, after it, so it stays in view however the words are cut. `markWords`, where the mark stands
// for words (the word cut, T73: a message's arrow for "Message from"), are read in its place and not drawn. `fact`, the
// secondary facts about the line's words (a peer's address; ticket 815), is the line's tip, which the keyboard reaches,
// since the words inside the one control cannot each take focus.
import type { ReactNode } from 'react';
import { DisclosureBody } from '../../../ui/disclosure';
import { Tip } from '../../../ui/tip';

export function ArrivalLine({ mark, markWords, fact = null, open, onToggle, children }: { mark: string; markWords?: string; fact?: { content: ReactNode; description: string } | null; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <Tip content={fact?.content} description={fact?.description}>
      <button type="button" className="transcript-line-words" aria-expanded={open} onClick={onToggle}>
        <span className="transcript-line-mark" aria-hidden="true">
          {mark}
        </span>
        {markWords !== undefined && <span className="sr-only">{`${markWords} `}</span>}
        <span className="transcript-line-text">{children}</span>
      </button>
    </Tip>
  );
}

// What a line opens, under it (board ticket 850): through the shared disclosure motion, as every fold of the transcript.
export function ArrivalBody({ open, children }: { open: boolean; children: ReactNode }) {
  return <DisclosureBody open={open}>{children}</DisclosureBody>;
}
