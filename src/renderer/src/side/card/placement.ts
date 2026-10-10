// The comment card's placement (P2-E1 document, D4): Claude Desktop's card (`frame-shell-chrome`'s `GT`: 300 px wide,
// 320 px of room below that never flips, a height cap of max(320, 60 % of the viewport)) adapted to a host box and an
// element rectangle instead of a click point. Pure, in the host's own coordinates (top-left 0,0). The card pins at the
// element's bottom-left corner and opens below it, or above it when the element sits near the bottom and the room above
// is larger; flipping above the pin rather than above the element would cover the element, so Desktop's middle case
// collapses into "the side with more room". A host too small for a card docks it at its bottom edge, never hidden, since
// a hidden card would lose the draft. Any rect is safe: every value is clamped into the host.
//
// P2-E2: a host beside a native view (the browser pane's page, which the renderer cannot draw over) docks its card as a
// strip in flow under the view instead (`stripCard`): the view's box shrinks by the strip, so the card never lies over
// the page, and the strip takes at most half the column it shares with the view, so the page keeps the other half. Its
// pin is a caret on the strip's top edge under the element (`caretOf`), the one coordinate the strip can draw.
import type { CardRect } from '../../tools/code/anchor/anchor';

export const CARD_WIDTH = 300;
export const CARD_MIN_HEIGHT = 120; // the composer half's height, and the least a thread with a Reply field needs
const GAP = 4; // between the element's edge and the card's
const INSET = 8; // the card's right edge inside the host's, and the corner's offset
const NO_FLIP = 320; // this much room below never flips
const DOCK_MAX = 320;
const DOCK_MIN_WIDTH = 200; // under this card width, or ...
const DOCK_MIN_HEIGHT = 160; // ... a host under this height, the card docks

export interface CardPin {
  x: number; // the element's left
  y: number; // its bottom
  top: number; // its top, for the flip
}

export type CardStyle =
  | { mode: 'below'; left: number; top: number; width: number; maxHeight: number }
  | { mode: 'above'; left: number; bottom: number; width: number; maxHeight: number }
  | { mode: 'docked'; width: number; maxHeight: number }
  | { mode: 'strip'; width: number; maxHeight: number }; // P2-E2: in flow, under a native view

interface Box {
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

// The element's rect, in the host frame's viewport CSS pixels, mapped into the host by the frame's scale and offset.
export function pinOf(rect: CardRect, frame: { scale: number; offset: { x: number; y: number } }): CardPin {
  const { scale, offset } = frame;
  return { x: rect.x * scale + offset.x, y: (rect.y + rect.height) * scale + offset.y, top: rect.y * scale + offset.y };
}

// The docked layout: the host's full width less 16 px, in flow at its bottom edge.
export function dockCard(box: Box): CardStyle {
  return { mode: 'docked', width: Math.max(0, box.width - 2 * INSET), maxHeight: Math.max(0, Math.min(DOCK_MAX, box.height - 2 * INSET)) };
}

// P2-E2: the strip under a native view, from the column it shares with the view: its full width less 16 px, at most
// half its height (`stripMax`) less the strip's own 16 px of margin, and never over DOCK_MAX.
export function stripCard(column: Box): CardStyle {
  return { mode: 'strip', width: Math.max(0, column.width - 2 * INSET), maxHeight: clamp(stripMax(column) - 2 * INSET, 0, DOCK_MAX) };
}

// P2-E2: the most the strip itself takes of its column, a hard limit: in a column too short for the card's own floor
// (its padding, border and margin) the strip clips the card rather than take the page's half.
export const stripMax = (column: Box): number => Math.floor(column.height / 2);

const CARET_INSET = 12; // the caret stays on the card's straight top edge, clear of its rounded corners

// P2-E2: the caret's x in the strip (whose left edge is the view's), under the pin and kept on the card's top edge; null
// with no pin or a non-finite one.
export function caretOf(pin: CardPin | null, column: Box): number | null {
  if (pin === null || !Number.isFinite(pin.x)) return null;
  const min = INSET + CARET_INSET;
  return clamp(pin.x, min, Math.max(min, column.width - INSET - CARET_INSET));
}

// D4's table, row by row.
export function placeCard(box: Box, pin: CardPin | null): CardStyle {
  const { width: W, height: H } = box;
  const width = Math.min(CARD_WIDTH, W - 2 * INSET);
  if (width < DOCK_MIN_WIDTH || H < DOCK_MIN_HEIGHT) return dockCard(box);
  const cap = Math.max(NO_FLIP, Math.round(0.6 * H));
  if (pin === null || ![pin.x, pin.y, pin.top].every(Number.isFinite)) {
    return { mode: 'below', left: W - width - INSET, top: INSET, width, maxHeight: Math.min(cap, H - 2 * INSET) };
  }
  const x = clamp(pin.x, 0, Math.max(0, W - width - INSET));
  const y = clamp(pin.y, 0, H);
  const top = clamp(pin.top, 0, y);
  const below = H - (y + GAP);
  const above = top - GAP;
  if (below < NO_FLIP && above > below && above >= CARD_MIN_HEIGHT) {
    return { mode: 'above', left: x, bottom: H - (top - GAP), width, maxHeight: Math.min(cap, above) };
  }
  const cardTop = clamp(y + GAP, 0, Math.max(0, H - CARD_MIN_HEIGHT));
  return { mode: 'below', left: x, top: cardTop, width, maxHeight: Math.min(cap, H - cardTop) };
}
