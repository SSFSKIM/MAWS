// The counted fold (the word cut, "What the cut builds"; rule 5: a fold keeps its count and its kinds): a block folded to
// one line, "Listed 9 agents", that opens in place. The line is a disclosure button named by its words, which carry the
// count, so the count stays in view folded and open; a chevron after the words says which. Opened, the block shows under
// the line with the shared disclosure motion and the line stays as it was. `lead` stands before the words (a row's
// glyph), outside the name. The open state is the caller's when it passes `open` (a virtualised transcript keeps it in
// its store across remounts), else the fold's own. It reads no store, so the editor bundles can draw it.
import { useId, useState, type ReactNode } from 'react';
import { DisclosureBody } from './disclosure';

const LINE =
  'group inline-flex max-w-full min-w-0 items-center gap-2 rounded-sm text-left text-fg-muted outline-accent hover:text-fg focus-visible:outline-2';
const CHEVRON = 'size-3 shrink-0 transition-transform duration-150 group-aria-expanded:rotate-90 motion-reduce:transition-none';

export interface CountedFoldProps {
  summary: string; // the folded line's words, with the count
  lead?: ReactNode; // aria-hidden: a glyph before the words
  open?: boolean;
  onOpenChange?(open: boolean): void;
  className?: string;
  children: ReactNode; // what the line folds
}

export function CountedFold({ summary, lead = null, open: kept, onOpenChange, className = '', children }: CountedFoldProps) {
  const [own, setOwn] = useState(false);
  const open = kept ?? own;
  const bodyId = useId();
  const toggle = () => {
    if (kept === undefined) setOwn(!open);
    onOpenChange?.(!open);
  };
  return (
    <div className={className} data-counted-fold="">
      <button type="button" className={LINE} aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
        {lead}
        <span className="min-w-0 truncate">{summary}</span>
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={CHEVRON}>
          <path d="M6 3.5 10.5 8 6 12.5" />
        </svg>
      </button>
      <DisclosureBody open={open} id={bodyId}>
        {children}
      </DisclosureBody>
    </div>
  );
}
