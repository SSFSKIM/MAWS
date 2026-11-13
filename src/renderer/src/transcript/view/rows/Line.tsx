// One line of what entered a session or what an agent sent (UX wave U3, UC-2 "The rows"; the U3a document, M2): the
// lead mark, the words in one line cut with an ellipsis at the column's edge, and, when the line opens to show more, the
// line itself is the control (a click, or Enter or Space with focus). What stands at the line's end (a send's state,
// Reply) is the caller's, after it, so it stays in view however the words are cut.
import type { ReactNode } from 'react';

export function ArrivalLine({ mark, open, onToggle, children }: { mark: string; open: boolean; onToggle: (() => void) | null; children: ReactNode }) {
  const content = (
    <>
      <span className="transcript-line-mark" aria-hidden="true">
        {mark}
      </span>
      <span className="transcript-line-text">{children}</span>
    </>
  );
  if (onToggle === null) return <span className="transcript-line-words">{content}</span>;
  return (
    <button type="button" className="transcript-line-words" aria-expanded={open} onClick={onToggle}>
      {content}
    </button>
  );
}
