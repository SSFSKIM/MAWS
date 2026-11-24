// The editors' line glyphs (the word cut, rule 4: a glyph replaces a word only where nobody can misread it, and keeps
// the word as its name and tooltip through the shared NamedGlyph). 16 px strokes in the text's colour, as the app's
// own icons (renderer/src/app/IconButton.tsx), drawn here so the portable editors read no renderer module for them.
import type { ReactNode } from 'react';

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

const BUBBLE = 'M2.5 3.5h11v7.5h-6.5l-3 2.5v-2.5h-1.5z';

export const CommentPlusIcon = () => (
  <Glyph>
    <path d={BUBBLE} />
    <path d="M8 5.5v3.5M6.25 7.25h3.5" />
  </Glyph>
);
export const CommentsIcon = () => (
  <Glyph>
    <path d={BUBBLE} />
  </Glyph>
);
export const HistoryIcon = () => (
  <Glyph>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 5v3l2 1.5" />
  </Glyph>
);
export const SearchIcon = () => (
  <Glyph>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3 3" />
  </Glyph>
);
export const SendIcon = () => (
  <Glyph>
    <path d="M8 13V3M4 7l4-4 4 4" />
  </Glyph>
);
