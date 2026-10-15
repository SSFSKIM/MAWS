// The document header's action icons (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): 16 px strokes in
// the current colour, as the header's own icons draw.
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const HistoryIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden {...stroke}>
    <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
    <path d="M2.5 2.5v2.2h2.2" />
    <path d="M8 5v3.2l2 1.3" />
  </svg>
);

export const SaveVersionIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden {...stroke}>
    <path d="M4.5 2.5h7v11L8 11l-3.5 2.5z" />
  </svg>
);

export const CommentsIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden {...stroke}>
    <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
  </svg>
);

export const SuggestIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden {...stroke}>
    <path d="M10.5 2.5l3 3-7 7H3.5v-3z" />
    <path d="M2.5 14.5h4" strokeDasharray="1.5 1.5" />
  </svg>
);
