// P3-E1 M6: the design surfaces' evidence probe's one judgement made outside the page (e2e/support/design.ts,
// `surfaceEvidence`): whether a node lying outside the editor is chrome at all. The screen-reader-only pattern (a box of
// at most one pixel clipped to nothing: dnd-kit's live region for the board list's keyboard reordering, Tailwind's
// sr-only) draws nothing wherever it is placed, so it is an accessibility utility, not chrome; a node with a drawn area,
// or a one-pixel node not clipped away, is. Free of Playwright, so test/support/design-geometry.test.ts checks it.

/** A node's box and its computed `clip` and `clip-path`, as the page measured them. */
export interface NodeDraw {
  w: number;
  h: number;
  clip: string;
  clipPath: string;
}

const CLIPPED_TO_NOTHING = /^rect\(\s*0(px)?\s*,?\s*0(px)?\s*,?\s*0(px)?\s*,?\s*0(px)?\s*\)$/;

export function visuallyHidden({ w, h, clip, clipPath }: NodeDraw): boolean {
  return w <= 1 && h <= 1 && (CLIPPED_TO_NOTHING.test(clip.trim()) || clipPath.trim() === 'inset(100%)');
}
