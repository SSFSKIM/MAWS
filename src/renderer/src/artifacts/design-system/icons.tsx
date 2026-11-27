// The Design System header's action icons (the word cut, docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 4;
// G558, as the owner saw them: a ticked circle for Check against law, a star for Set as my default, a bin for Delete
// design system…). 16 px strokes in the current colour, as the deck's and the document's header icons draw; each
// action's label stays its name and tooltip (the header's IconButton).
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const CheckLawIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden {...stroke}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M5.75 8.25 7.25 9.75 10.25 6.5" />
  </svg>
);

export const DefaultStarIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden {...stroke}>
    <path d="M8 2.5l1.65 3.4 3.75.5-2.73 2.6.67 3.7L8 10.9l-3.34 1.8.67-3.7L2.6 6.4l3.75-.5z" />
  </svg>
);

export const DeleteBinIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden {...stroke}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.75 7v4M9.25 7v4" />
  </svg>
);
