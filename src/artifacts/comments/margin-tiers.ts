// P4-B1 (D3 of docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md): what a document's margin shows in the room it
// has, N1 to N5 of research/p4-ux-prior-art.md §1.3. The tier reads the side space beside the page (the scroll box's
// width less the page's), never the window's (N4): cards while a card's least width and its gaps fit, at most
// CARD_MAX_PX, shrinking before anything collapses (N1); below that, the icon rail, which keeps its width and hangs over
// the page's right padding when the side space is short, the page keeping its own width (N2, Docs' icons sit in the
// page's margin); under a narrow body the margin is off and the rail's drawer applies (N3, P3-F1's threshold, not
// re-based). Minimize is the icon rail at any width; Hide is no margin, the passages' highlights kept (N5).
import { RAIL_BESIDE_FROM_PX } from '../document/rail-width';
import { MARGIN_GAP_PX } from './margin-layout';
import type { CommentsView } from './view';

/** A card's widest. LC-1 re-bases (item 6). */
export const CARD_MAX_PX = 300;
/** A card's narrowest, under which the cards become icons. LC-1 re-bases (item 6). */
export const CARD_MIN_PX = 200;
/** An icon's size in the icon rail. LC-1 re-bases (item 7). */
export const ICON_PX = 24;

export type MarginTier =
  | { kind: 'off' }
  /** `width` the cards', `reserve` the column's (the cards and a gap each side). */
  | { kind: 'cards'; width: number; reserve: number }
  /** `reserve` the column's width beside the page, `overlap` how far the icons hang over the page's right padding. */
  | { kind: 'icons'; reserve: number; overlap: number };

/**
 * `bodyWidth` the editor body's (the drawer's threshold, as the rail reads it: 0, not laid out, is not narrow),
 * `scrollWidth` the page's scroll box's client width, `pageWidth` the page's rendered width.
 */
export function tierFor(input: { bodyWidth: number; scrollWidth: number; pageWidth: number; view: CommentsView }): MarginTier {
  const { bodyWidth, scrollWidth, pageWidth, view } = input;
  if (view === 'hide' || (bodyWidth > 0 && bodyWidth < RAIL_BESIDE_FROM_PX)) return { kind: 'off' };
  const sideSpace = scrollWidth - pageWidth;
  const gaps = 2 * MARGIN_GAP_PX;
  if (view === 'expand' && sideSpace >= CARD_MIN_PX + gaps) {
    const width = Math.min(CARD_MAX_PX, sideSpace - gaps);
    return { kind: 'cards', width, reserve: width + gaps };
  }
  const reserve = Math.min(ICON_PX + gaps, Math.max(0, sideSpace));
  return { kind: 'icons', reserve, overlap: ICON_PX + gaps - reserve };
}
