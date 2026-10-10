// P2-E1 (M1): the comment card's anchored placement (P2-E1 document, D4's table), Claude Desktop's card adapted to a host
// box and an element rectangle: 300 px wide, 4 px under the element's bottom edge, clamped 8 px inside the right edge,
// flipped above the element near the bottom, capped at 60 % of the host, docked when the host is too small, and the
// top-right corner when there is no pin.
import { describe, expect, it } from 'vitest';
import { CARD_MIN_HEIGHT, caretOf, dockCard, pinOf, placeCard, stripCard } from './placement';

const BOX = { width: 600, height: 800 };
const IDENTITY = { scale: 1, offset: { x: 0, y: 0 } };
const pin = (x: number, top: number, height: number) => pinOf({ x, y: top, width: 120, height }, IDENTITY);

describe('pinOf', () => {
  it('is the element’s bottom-left corner and its top edge, mapped by the frame’s scale and offset', () => {
    expect(pinOf({ x: 10, y: 20, width: 50, height: 30 }, IDENTITY)).toEqual({ x: 10, y: 50, top: 20 });
    expect(pinOf({ x: 10, y: 20, width: 50, height: 30 }, { scale: 2, offset: { x: 5, y: 7 } })).toEqual({ x: 25, y: 107, top: 47 });
  });
});

describe('placeCard', () => {
  it('opens below the element with room, 4 px under its bottom edge at its left, the top-left corner at the pin', () => {
    expect(placeCard(BOX, pin(24, 0, 90))).toEqual({ mode: 'below', left: 24, top: 94, width: 300, maxHeight: 480 });
  });

  it('caps the height at 60 % of the host, and at least 320', () => {
    expect(placeCard({ width: 600, height: 2000 }, pin(0, 0, 10))).toMatchObject({ mode: 'below', maxHeight: 1200 });
    // 60 % of 560 is 336; the room under the card (560 - 14) is more
    expect(placeCard({ width: 600, height: 560 }, pin(0, 0, 10))).toMatchObject({ mode: 'below', top: 14, maxHeight: 336 });
    // 60 % of 500 is under 320: 320, then bounded by the room under the card
    expect(placeCard({ width: 600, height: 500 }, pin(0, 0, 10))).toMatchObject({ mode: 'below', top: 14, maxHeight: 320 });
  });

  it('opens above an element near the bottom when the room above is larger, its bottom edge 4 px over the element’s top', () => {
    // the element 600..700: 96 px below it, 596 above
    expect(placeCard(BOX, pin(24, 600, 100))).toEqual({ mode: 'above', left: 24, bottom: 204, width: 300, maxHeight: 480 });
  });

  it('stays below when 320 px fit below, whatever the room above', () => {
    // the element 400..476: 320 below exactly
    expect(placeCard(BOX, pin(0, 400, 76))).toMatchObject({ mode: 'below', top: 480 });
  });

  it('stays below when neither side has the minimum height, overlapping the element so the minimum fits', () => {
    // a 200 px host, an element 100..110: 86 below, 96 above (under 120 each)
    expect(placeCard({ width: 600, height: 200 }, pin(0, 100, 10))).toEqual({ mode: 'below', left: 0, top: 200 - CARD_MIN_HEIGHT, width: 300, maxHeight: CARD_MIN_HEIGHT });
  });

  it('stays below when the room below is the larger, though under 320', () => {
    // the element 200..210: 286 below, 196 above
    expect(placeCard({ width: 600, height: 500 }, pin(0, 200, 10))).toMatchObject({ mode: 'below', top: 214 });
  });

  it('clamps the left edge so the card’s right edge stays 8 px inside the host, and never past the left edge', () => {
    expect(placeCard(BOX, pin(500, 0, 10))).toMatchObject({ left: 600 - 300 - 8 });
    expect(placeCard(BOX, pinOf({ x: -40, y: 0, width: 10, height: 10 }, IDENTITY))).toMatchObject({ left: 0 });
  });

  it('narrows to the host less 16 px, and docks at the bottom under 200 px wide or 160 px high', () => {
    expect(placeCard({ width: 260, height: 800 }, pin(0, 0, 10))).toMatchObject({ mode: 'below', width: 244, left: 0 });
    expect(placeCard({ width: 210, height: 800 }, pin(0, 0, 10))).toEqual({ mode: 'docked', width: 194, maxHeight: 320 });
    expect(placeCard({ width: 600, height: 150 }, pin(0, 0, 10))).toEqual({ mode: 'docked', width: 584, maxHeight: 134 });
    expect(placeCard({ width: 210, height: 800 }, null)).toMatchObject({ mode: 'docked' });
  });

  it('with no pin, or a pin with a non-finite value, takes the host’s top-right corner', () => {
    expect(placeCard(BOX, null)).toEqual({ mode: 'below', left: 600 - 300 - 8, top: 8, width: 300, maxHeight: 480 });
    expect(placeCard(BOX, { x: Number.NaN, y: 10, top: 0 })).toEqual(placeCard(BOX, null));
    expect(placeCard(BOX, { x: 0, y: Number.POSITIVE_INFINITY, top: 0 })).toEqual(placeCard(BOX, null));
  });

  it('clamps a pin outside the host into it', () => {
    // a pin under the host's bottom: the element's bottom at H; above has the room
    expect(placeCard(BOX, { x: 0, y: 5000, top: 4000 })).toMatchObject({ mode: 'above', bottom: 4 });
    // a pin over the host's top: below, at the top
    expect(placeCard(BOX, { x: 0, y: -50, top: -80 })).toMatchObject({ mode: 'below', top: 4 });
  });
});

describe('dockCard', () => {
  it('is the host’s full width less 16 px at its bottom, at most 320 high', () => {
    expect(dockCard({ width: 600, height: 800 })).toEqual({ mode: 'docked', width: 584, maxHeight: 320 });
    expect(dockCard({ width: 600, height: 200 })).toEqual({ mode: 'docked', width: 584, maxHeight: 184 });
  });
});

// P2-E2: the strip under a native view, and its caret under the element
describe('stripCard', () => {
  it('is the column’s full width less 16 px, at most half its height less 16 and never over 320', () => {
    expect(stripCard({ width: 600, height: 800 })).toEqual({ mode: 'strip', width: 584, maxHeight: 320 });
    expect(stripCard({ width: 600, height: 500 })).toEqual({ mode: 'strip', width: 584, maxHeight: 234 });
    expect(stripCard({ width: 600, height: 501 })).toEqual({ mode: 'strip', width: 584, maxHeight: 234 }); // half rounded down, as the strip's own cap
    expect(stripCard({ width: 10, height: 20 })).toEqual({ mode: 'strip', width: 0, maxHeight: 0 });
  });
});

describe('caretOf', () => {
  const COLUMN = { width: 600, height: 800 };
  it('stands under the pin’s x, kept on the card’s own top edge (its 8 px margin plus half the caret’s square)', () => {
    expect(caretOf({ x: 250, y: 90, top: 60 }, COLUMN)).toBe(250);
    expect(caretOf({ x: 14, y: 90, top: 60 }, COLUMN)).toBe(14);
    expect(caretOf({ x: 586, y: 90, top: 60 }, COLUMN)).toBe(586);
    expect(caretOf({ x: 0, y: 90, top: 60 }, COLUMN)).toBe(14);
    expect(caretOf({ x: 900, y: 90, top: 60 }, COLUMN)).toBe(586);
  });
  it('keeps the caret inside an element only partly visible at the viewport’s edge', () => {
    // main pins a visible span 0..16 at its centre, 8; the caret's 12 px square at 14 spans 8..20, over the span
    expect(caretOf({ x: 8, y: 90, top: 60 }, COLUMN)).toBe(14);
    expect(caretOf({ x: 592, y: 90, top: 60 }, COLUMN)).toBe(586);
  });
  it('is none without a pin or with a non-finite x', () => {
    expect(caretOf(null, COLUMN)).toBeNull();
    expect(caretOf({ x: Number.NaN, y: 0, top: 0 }, COLUMN)).toBeNull();
  });
});
