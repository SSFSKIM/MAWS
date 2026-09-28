// A session's status glyph as the sidebar, tabs and cards show it (§5.7: one derivation, `glyph.ts`): the character in
// its token tone, labelled for assistive technology, pulsing while working unless reduced motion is asked for.
import type { Glyph } from './glyph';

const TONE: Record<Glyph['tone'], string> = {
  accent: 'text-accent',
  warning: 'text-warning',
  info: 'text-info',
  danger: 'text-danger',
  faint: 'text-fg-faint',
};

export function GlyphMark({ glyph, className = '' }: { glyph: Glyph; className?: string }) {
  const pulse = glyph.pulse ? 'animate-pulse motion-reduce:animate-none' : '';
  return (
    <span role="img" aria-label={glyph.label} className={`inline-block text-center ${TONE[glyph.tone]} ${pulse} ${className}`}>
      {glyph.char}
    </span>
  );
}
