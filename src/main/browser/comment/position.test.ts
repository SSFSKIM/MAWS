// P2-E2: the pick's position in pane pixels, from the preload's rect in CSS px of the viewport and the page's zoom.
import { describe, expect, it } from 'vitest';
import { pickPosition } from './position';

const VIEWPORT = { width: 800, height: 600 };

describe('pickPosition', () => {
  it('is the centre of the element across and its bottom edge, in CSS px times the zoom, whole pixels', () => {
    expect(pickPosition({ x: 248, y: 312, width: 96, height: 30 }, VIEWPORT, 1)).toEqual({ x: 296, y: 342 });
    expect(pickPosition({ x: 248, y: 312, width: 96, height: 30 }, VIEWPORT, 1.25)).toEqual({ x: 370, y: 428 });
    expect(pickPosition({ x: 10.4, y: 0, width: 0.4, height: 20.3 }, VIEWPORT, 1)).toEqual({ x: 11, y: 20 });
  });

  it('clamps the span and the bottom to the viewport: an element wider than the page, or running off it, pins where it shows', () => {
    expect(pickPosition({ x: -200, y: 500, width: 1400, height: 300 }, VIEWPORT, 1)).toEqual({ x: 400, y: 600 });
    expect(pickPosition({ x: 700, y: -50, width: 400, height: 40 }, VIEWPORT, 1)).toEqual({ x: 750, y: 0 });
  });

  it('is none for a value it cannot read', () => {
    expect(pickPosition({ x: Number.NaN, y: 0, width: 1, height: 1 }, VIEWPORT, 1)).toBeUndefined();
    expect(pickPosition({ x: 0, y: 0, width: 1, height: 1 }, VIEWPORT, 0)).toBeUndefined();
    expect(pickPosition({ x: 0, y: 0, width: 1, height: 1 }, { width: Number.POSITIVE_INFINITY, height: 600 }, 1)).toBeUndefined();
  });
});
