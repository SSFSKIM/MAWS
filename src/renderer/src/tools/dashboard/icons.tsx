// The dashboard header's Datasets icon (P3-E2 M3): a 16 px stroke in the current colour, as B's header icons draw
// (src/renderer/src/tools/document/icons.tsx): a table's head and rows.
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const DatasetsIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden {...stroke}>
    <path d="M2.5 3.5h11v9h-11z" />
    <path d="M2.5 6.5h11M2.5 9.5h11M6.5 6.5v6" />
  </svg>
);
