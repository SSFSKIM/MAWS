// The deck header's action icons (P3-C M6; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D8 "Shell"): 16 px
// strokes in the current colour, as the header's own icons and the document's draw.
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const PresentIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden {...stroke}>
    <path d="M2.5 3h11v7.5h-11z" />
    <path d="M8 10.5v2.5M5.5 13.5h5" />
    <path d="M7 5.25l2.5 1.5L7 8.25z" />
  </svg>
);

export const ThemeIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden {...stroke}>
    <path d="M8 2.5a5.5 5.5 0 1 0 0 11c.9 0 1.4-.6 1.4-1.3 0-.9-.8-1.2-.8-2 0-.7.6-1.2 1.3-1.2h1.4a2.2 2.2 0 0 0 2.2-2.2C13.5 4.6 11.1 2.5 8 2.5z" />
    <circle cx="5.25" cy="7" r=".6" />
    <circle cx="7.25" cy="4.9" r=".6" />
    <circle cx="10.1" cy="5.3" r=".6" />
  </svg>
);

export const CheckIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden {...stroke}>
    <path d="M3 2.5h7l3 3v8H3z" />
    <path d="M5.5 9l1.75 1.75L10.5 7.5" />
  </svg>
);
