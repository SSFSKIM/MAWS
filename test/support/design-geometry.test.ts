// P3-E1 M6: what the design surfaces' evidence probe counts as visible chrome (e2e/support/design-geometry.ts). A node
// clipped to nothing in a box of at most one pixel (the screen-reader-only pattern: dnd-kit's live region, Tailwind's
// sr-only) is an accessibility utility, not chrome, wherever it sits; anything with a drawn area, or a one-pixel node
// that is not clipped away, still counts.
import { describe, expect, it } from 'vitest';
import { visuallyHidden } from '../../e2e/support/design-geometry';

describe('a visually hidden accessibility node', () => {
  it('is dnd-kit’s live region and the sr-only pattern as Chromium computes them', () => {
    expect(visuallyHidden({ w: 1, h: 1, clip: 'rect(0px, 0px, 0px, 0px)', clipPath: 'inset(100%)' })).toBe(true); // dnd-kit's LiveRegion
    expect(visuallyHidden({ w: 1, h: 1, clip: 'rect(0px, 0px, 0px, 0px)', clipPath: 'none' })).toBe(true); // sr-only
    expect(visuallyHidden({ w: 0.5, h: 1, clip: 'auto', clipPath: 'inset(100%)' })).toBe(true);
  });
  it('is never a node with a drawn area, or a one-pixel node left unclipped', () => {
    expect(visuallyHidden({ w: 24, h: 24, clip: 'rect(0px, 0px, 0px, 0px)', clipPath: 'inset(100%)' })).toBe(false);
    expect(visuallyHidden({ w: 1, h: 30, clip: 'rect(0px, 0px, 0px, 0px)', clipPath: 'none' })).toBe(false);
    expect(visuallyHidden({ w: 1, h: 1, clip: 'auto', clipPath: 'none' })).toBe(false);
    expect(visuallyHidden({ w: 1, h: 1, clip: 'rect(0px, 4px, 4px, 0px)', clipPath: 'inset(10%)' })).toBe(false);
  });
});
