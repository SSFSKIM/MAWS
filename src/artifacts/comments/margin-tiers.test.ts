// P4-B1 (M1; D3 of docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md): the margin's tier from the side space
// beside the page, N1 to N4 of research/p4-ux-prior-art.md §1.3 (N5's view states as far as the tier goes).
import { describe, expect, it } from 'vitest';
import { RAIL_BESIDE_FROM_PX } from '../document/rail-width';
import { MARGIN_GAP_PX as G } from './margin-layout';
import { CARD_MAX_PX, CARD_MIN_PX, ICON_PX, tierFor, type MarginTier } from './margin-tiers';
import type { CommentsView } from './view';

const PAGE = 816; // 8.5 in at 96 px
const beside = (sideSpace: number, view: CommentsView = 'expand'): MarginTier => tierFor({ bodyWidth: PAGE + sideSpace, scrollWidth: PAGE + sideSpace, pageWidth: PAGE, view });

describe('tierFor', () => {
  it('N1: with room, cards at most CARD_MAX_PX wide, the column reserving the card and a gap each side', () => {
    expect(beside(1000)).toEqual({ kind: 'cards', width: CARD_MAX_PX, reserve: CARD_MAX_PX + 2 * G });
    expect(beside(CARD_MAX_PX + 2 * G)).toEqual({ kind: 'cards', width: CARD_MAX_PX, reserve: CARD_MAX_PX + 2 * G });
  });

  it('N1: narrowing shrinks the cards first, to CARD_MIN_PX, before anything collapses', () => {
    expect(beside(250)).toEqual({ kind: 'cards', width: 250 - 2 * G, reserve: 250 });
    expect(beside(CARD_MIN_PX + 2 * G)).toEqual({ kind: 'cards', width: CARD_MIN_PX, reserve: CARD_MIN_PX + 2 * G });
    let last = Infinity;
    for (let side = 800; side >= CARD_MIN_PX + 2 * G; side -= 7) {
      const tier = beside(side);
      if (tier.kind !== 'cards') throw new Error(`side ${side}: ${tier.kind}`);
      expect(tier.width).toBeLessThanOrEqual(last);
      expect(tier.reserve).toBeLessThanOrEqual(side); // the cards never hang over the page
      last = tier.width;
    }
  });

  it('N2: under a card’s least width plus the gaps, the icon rail, reserving an icon and its gaps', () => {
    expect(beside(CARD_MIN_PX + 2 * G - 1)).toEqual({ kind: 'icons', reserve: ICON_PX + 2 * G, overlap: 0 });
    expect(beside(ICON_PX + 2 * G)).toEqual({ kind: 'icons', reserve: ICON_PX + 2 * G, overlap: 0 });
  });

  it('N2: with less side space than the icon rail needs, the rail reserves what there is and overlaps the page’s padding', () => {
    expect(beside(30)).toEqual({ kind: 'icons', reserve: 30, overlap: ICON_PX + 2 * G - 30 });
    expect(beside(0)).toEqual({ kind: 'icons', reserve: 0, overlap: ICON_PX + 2 * G });
    // a page wider than its scroll box (a scrollbar's width): no negative reserve
    expect(beside(-12)).toEqual({ kind: 'icons', reserve: 0, overlap: ICON_PX + 2 * G });
  });

  it('N3: under a body of RAIL_BESIDE_FROM_PX the margin is off (the drawer applies), whatever the side space', () => {
    expect(tierFor({ bodyWidth: RAIL_BESIDE_FROM_PX - 1, scrollWidth: 2000, pageWidth: 400, view: 'expand' })).toEqual({ kind: 'off' });
    expect(tierFor({ bodyWidth: RAIL_BESIDE_FROM_PX, scrollWidth: RAIL_BESIDE_FROM_PX, pageWidth: 400, view: 'expand' })).toMatchObject({ kind: 'cards' });
  });

  it('N3: a body not laid out yet (0 px) is not narrow, as the rail reads it: the tier follows the side space', () => {
    expect(tierFor({ bodyWidth: 0, scrollWidth: 0, pageWidth: 0, view: 'expand' })).toEqual({ kind: 'icons', reserve: 0, overlap: ICON_PX + 2 * G });
  });

  it('N4: the tier reads the side space beside the page alone; the same side space in any box gives the same tier', () => {
    for (const side of [0, 30, 100, 230, 400]) {
      const wide = tierFor({ bodyWidth: 3000, scrollWidth: 2000 + side, pageWidth: 2000, view: 'expand' });
      const narrow = tierFor({ bodyWidth: 760, scrollWidth: 500 + side, pageWidth: 500, view: 'expand' });
      expect(wide).toEqual(narrow);
    }
    // it takes no window width at all: its only inputs are the four named
    expect(tierFor.length).toBe(1);
  });

  it('N5: Minimize gives the icon rail at any width; Hide turns the margin off', () => {
    expect(beside(1000, 'minimize')).toEqual({ kind: 'icons', reserve: ICON_PX + 2 * G, overlap: 0 });
    expect(beside(10, 'minimize')).toEqual({ kind: 'icons', reserve: 10, overlap: ICON_PX + 2 * G - 10 });
    expect(beside(1000, 'hide')).toEqual({ kind: 'off' });
    expect(tierFor({ bodyWidth: RAIL_BESIDE_FROM_PX - 1, scrollWidth: 600, pageWidth: 400, view: 'minimize' })).toEqual({ kind: 'off' });
  });
});
