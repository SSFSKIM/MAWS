// P4-B1 (M1; D3 of docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md): the margin's tier from the side space
// beside the page, N1 to N4 of research/p4-ux-prior-art.md §1.3 (N5's view states as far as the tier goes), read with
// Docs' sample points beside an A4 page (docs/doperpowers/evidence/p4/lc1/lc1-docs-margin.md item 6; the icons item 7).
import { describe, expect, it } from 'vitest';
import { RAIL_BESIDE_FROM_PX } from '../document/rail-width';
import { CARD_MAX_PX, CARD_MIN_PX, ICON_PX, MARGIN_EDGE_GUTTER_PX, MARGIN_PAGE_GUTTER_PX, tierFor, type MarginTier } from './margin-tiers';
import type { CommentsView } from './view';

const PAGE = 794; // A4 at 96 px, Docs' page in LC-1
const beside = (sideSpace: number, view: CommentsView = 'expand'): MarginTier => tierFor({ bodyWidth: PAGE + sideSpace, scrollWidth: PAGE + sideSpace, pageWidth: PAGE, view });
const RAIL = MARGIN_PAGE_GUTTER_PX + ICON_PX + MARGIN_EDGE_GUTTER_PX; // the icon rail: an icon and both gutters
const LEAST = MARGIN_PAGE_GUTTER_PX + CARD_MIN_PX + MARGIN_EDGE_GUTTER_PX; // the least card and both gutters

describe('tierFor', () => {
  it('N1: with room, the page and the least card centre as one 308 px unit and the card widens to its right, up to 417', () => {
    expect(beside(1110)).toEqual({ kind: 'cards', width: 417, reserve: 308 }); // Docs' 1904 px scroll box
    expect(beside(510)).toEqual({ kind: 'cards', width: 358, reserve: 308 }); // the page at 101, the card 510 − 101 − 51
    expect(beside(358)).toEqual({ kind: 'cards', width: 282, reserve: 308 }); // the last side space the unit centres in
  });

  it('N1: under the centred unit the page gives way, only as far as the least card needs, to the box’s left edge', () => {
    expect(beside(345)).toEqual({ kind: 'cards', width: 282, reserve: 321 }); // the page at 12, not the 18.5 centring gives
    expect(beside(333)).toEqual({ kind: 'cards', width: 282, reserve: 333 }); // the page at the box's edge
    expect(LEAST).toBe(333);
  });

  it('N1, N2: a sweep from 1400 down to 0: the card never under CARD_MIN_PX nor past the box, reserve and overlap monotone', () => {
    let last: MarginTier | undefined;
    for (let side = 1400; side >= 0; side -= 0.5) {
      const tier = beside(side);
      if (side >= LEAST) {
        if (tier.kind !== 'cards') throw new Error(`side ${side}: ${tier.kind}`);
        expect(tier.width).toBeGreaterThanOrEqual(CARD_MIN_PX);
        expect(tier.width).toBeLessThanOrEqual(CARD_MAX_PX);
        expect(tier.reserve).toBeGreaterThanOrEqual(MARGIN_PAGE_GUTTER_PX + CARD_MIN_PX);
        const pageX = (side - tier.reserve) / 2; // the page's left edge in the centred row
        expect(pageX).toBeGreaterThanOrEqual(0);
        expect(pageX + MARGIN_PAGE_GUTTER_PX + tier.width + MARGIN_EDGE_GUTTER_PX).toBeLessThanOrEqual(side + 1e-9);
        if (last?.kind === 'cards') {
          expect(tier.width).toBeLessThanOrEqual(last.width); // narrowing shrinks the card first
          expect(tier.reserve).toBeGreaterThanOrEqual(last.reserve); // the column grows only as the page gives way
        }
      } else {
        if (tier.kind !== 'icons') throw new Error(`side ${side}: ${tier.kind}`);
        expect(tier.reserve + tier.overlap).toBe(RAIL);
        expect(tier.reserve).toBeLessThanOrEqual(side);
        if (last?.kind === 'icons') {
          expect(tier.reserve).toBeLessThanOrEqual(last.reserve);
          expect(tier.overlap).toBeGreaterThanOrEqual(last.overlap);
        }
      }
      last = tier;
    }
  });

  it('N2: under the least card and its gutters, the icon rail, reserving an icon and both gutters', () => {
    expect(beside(332)).toEqual({ kind: 'icons', reserve: 83, overlap: 0 });
    expect(beside(RAIL)).toEqual({ kind: 'icons', reserve: RAIL, overlap: 0 });
  });

  it('N2: with less side space than the icon rail needs, the rail reserves what there is and overlaps the page’s padding', () => {
    expect(beside(30)).toEqual({ kind: 'icons', reserve: 30, overlap: 53 });
    expect(beside(0)).toEqual({ kind: 'icons', reserve: 0, overlap: RAIL });
    // a page wider than its scroll box (a scrollbar's width): no negative reserve
    expect(beside(-12)).toEqual({ kind: 'icons', reserve: 0, overlap: RAIL });
  });

  it('N3: under a body of RAIL_BESIDE_FROM_PX the margin is off (the drawer applies), whatever the side space', () => {
    expect(tierFor({ bodyWidth: RAIL_BESIDE_FROM_PX - 1, scrollWidth: 2000, pageWidth: 400, view: 'expand' })).toEqual({ kind: 'off' });
    expect(tierFor({ bodyWidth: RAIL_BESIDE_FROM_PX, scrollWidth: RAIL_BESIDE_FROM_PX, pageWidth: 300, view: 'expand' })).toMatchObject({ kind: 'cards' });
  });

  it('N3: a body not laid out yet (0 px) is not narrow, as the rail reads it: the tier follows the side space', () => {
    expect(tierFor({ bodyWidth: 0, scrollWidth: 0, pageWidth: 0, view: 'expand' })).toEqual({ kind: 'icons', reserve: 0, overlap: RAIL });
  });

  it('N4: the tier reads the side space beside the page alone; the same side space in any box gives the same tier', () => {
    for (const side of [0, 30, 100, 340, 510, 1110]) {
      const wide = tierFor({ bodyWidth: 3000, scrollWidth: 2000 + side, pageWidth: 2000, view: 'expand' });
      const narrow = tierFor({ bodyWidth: 760, scrollWidth: 500 + side, pageWidth: 500, view: 'expand' });
      expect(wide).toEqual(narrow);
    }
    // it takes no window width at all: its only inputs are the four named
    expect(tierFor.length).toBe(1);
  });

  it('N5: Minimize gives the icon rail at any width, the page kept where Expand had it; Hide turns the margin off', () => {
    expect(beside(1110, 'minimize')).toEqual({ kind: 'icons', reserve: 308, overlap: 0 }); // Docs' page stays at 401
    expect(beside(345, 'minimize')).toEqual({ kind: 'icons', reserve: 321, overlap: 0 });
    expect(beside(332, 'minimize')).toEqual({ kind: 'icons', reserve: 83, overlap: 0 });
    expect(beside(10, 'minimize')).toEqual({ kind: 'icons', reserve: 10, overlap: RAIL - 10 });
    expect(beside(1110, 'hide')).toEqual({ kind: 'off' });
    expect(tierFor({ bodyWidth: RAIL_BESIDE_FROM_PX - 1, scrollWidth: 600, pageWidth: 400, view: 'minimize' })).toEqual({ kind: 'off' });
  });
});
