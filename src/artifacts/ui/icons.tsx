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
export const EyeOffIcon = () => (
  <Glyph>
    <path d="M2 8s2.25-4 6-4 6 4 6 4-2.25 4-6 4-6-4-6-4z" />
    <circle cx="8" cy="8" r="1.75" />
    <path d="m2.5 13.5 11-11" />
  </Glyph>
);
export const PencilIcon = () => (
  <Glyph>
    <path d="M10.5 3 13 5.5 6 12.5H3.5V10z" />
  </Glyph>
);
export const SidePanelIcon = () => (
  <Glyph>
    <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
    <path d="M9.5 3v10" />
  </Glyph>
);
/** A menu of further actions: three dots on the glyph's centre line (a text "…" sits on the baseline). */
export const MoreIcon = () => (
  <Glyph>
    <path d="M3.75 8h.01M8 8h.01M12.25 8h.01" strokeWidth={2.25} />
  </Glyph>
);
