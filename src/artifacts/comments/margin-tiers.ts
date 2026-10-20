// P4-B1 (D3 and D1/N6 of docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md): what a document's margin shows in
// the room it has and where the page sits beside it, N1 to N6 of research/p4-ux-prior-art.md §1.3, on Docs' measured
// geometry (docs/doperpowers/evidence/p4/lc1/lc1-docs-margin.md items 6 and 7). The tier reads the side space beside the
// page (the scroll box's width less the page's), never the window's (N4). Cards while the least card and its two gutters
// fit: Docs centres the page, its gutter and the least card as one unit (N6), the card widening into the free space on
// its right up to CARD_MAX_PX (N1), and below the unit's width the page gives way, only as far as the least card needs and
// never past the box's left edge. Under that, the icon rail, which keeps its width and hangs over the page's right
// padding when the side space is short, the page keeping its own width (N2). Docs has no such tier (it scrolls sideways
// under its least card); the rail is a deliberate departure, the margin staying in view in a narrow box. Under a narrow
// body the margin is off and the rail's drawer applies (N3, P3-F1's threshold, not re-based). Minimize is the icon rail
// at any width, the page where Expand had it; Hide is no margin (N5).
import { RAIL_BESIDE_FROM_PX } from '../document/rail-width';
import type { CommentsView } from './view';

/** A card's widest: Docs' 417 (LC-1 item 6's sweep). */
export const CARD_MAX_PX = 417;
/** A card's narrowest, under which the cards become icons: Docs' 282 (LC-1 item 6's sweep). */
export const CARD_MIN_PX = 282;
/** An icon's size in the icon rail: Docs' Minimize avatar, 32 (LC-1 item 7). */
export const ICON_PX = 32;
/** From the page's right edge to the card's (or icon's) left: Docs' 26 (LC-1 item 6). */
export const MARGIN_PAGE_GUTTER_PX = 26;
/** From the card's right edge to the scroll box's: Docs' 25 (LC-1 item 6). */
export const MARGIN_EDGE_GUTTER_PX = 25;

/** What Docs centres with the page: its gutter and the least card. */
const UNIT = MARGIN_PAGE_GUTTER_PX + CARD_MIN_PX;
/** The least side space the cards take: the unit and the edge gutter. */
const LEAST = UNIT + MARGIN_EDGE_GUTTER_PX;
/** The icon rail's width: an icon and both gutters. */
const RAIL = MARGIN_PAGE_GUTTER_PX + ICON_PX + MARGIN_EDGE_GUTTER_PX;

export type MarginTier =
  | { kind: 'off' }
  /**
   * `width` the drawn card's (unrounded: the caller rounds), `reserve` the column's flex basis, which the row centres
   * with the page: the unit's while it fits, rising to the least card and both gutters as the page gives way.
   */
  | { kind: 'cards'; width: number; reserve: number }
  /** `reserve` the column's width beside the page, `overlap` how far the icons hang over the page's right padding. */
  | { kind: 'icons'; reserve: number; overlap: number };

const clamp = (low: number, value: number, high: number) => Math.min(Math.max(value, low), high);

/**
 * `bodyWidth` the editor body's (the drawer's threshold, as the rail reads it: 0, not laid out, is not narrow),
 * `scrollWidth` the page's scroll box's client width, `pageWidth` the page's rendered width.
 */
export function tierFor(input: { bodyWidth: number; scrollWidth: number; pageWidth: number; view: CommentsView }): MarginTier {
  const { bodyWidth, scrollWidth, pageWidth, view } = input;
  if (view === 'hide' || (bodyWidth > 0 && bodyWidth < RAIL_BESIDE_FROM_PX)) return { kind: 'off' };
  const sideSpace = scrollWidth - pageWidth;
  if (sideSpace >= LEAST) {
    // the page's left edge in the centred row: centred with the unit, giving way only as far as the least card needs
    const pageX = clamp(0, (sideSpace - UNIT) / 2, sideSpace - LEAST);
    const reserve = sideSpace - 2 * pageX;
    if (view === 'minimize') return { kind: 'icons', reserve, overlap: 0 };
    const width = clamp(CARD_MIN_PX, sideSpace - pageX - MARGIN_PAGE_GUTTER_PX - MARGIN_EDGE_GUTTER_PX, CARD_MAX_PX);
    return { kind: 'cards', width, reserve };
  }
  const reserve = Math.min(RAIL, Math.max(0, sideSpace));
  return { kind: 'icons', reserve, overlap: RAIL - reserve };
}
