// The design header's own icon (P3-E1 M3): 16 px strokes in the current colour, as the deck's and the header's draw.
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** Zoom to fit: four corners drawn in around a frame. */
export const ZoomToFitIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden {...stroke}>
    <path d="M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3" />
    <path d="M5.5 6h5v4h-5z" />
  </svg>
);
