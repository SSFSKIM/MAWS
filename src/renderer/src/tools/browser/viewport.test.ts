// U12a (the UX wave's U12, l9-browser-delivery-06; Interfaces §D): a device size's page box, the one sum the pane, the
// options menu and the chip read, so the three cannot disagree. UX wave U6b-5b (decision 35): with the app window's factor,
// the fourth argument, by which the element (in the window's CSS pixels) is divided.
import { describe, expect, it } from 'vitest';
import { BROWSER_VIEWPORTS } from '@shared/browser/tab';
import { fits, pageBox } from './viewport';

const [MOBILE, TABLET] = BROWSER_VIEWPORTS;
const ROOMY = { width: 1200, height: 1400 };

describe('pageBox', () => {
  it('Responsive answers no box: the page fills its room as today', () => {
    expect(pageBox(null, 1, ROOMY, 1)).toBeNull();
    expect(pageBox(null, 1.25, { width: 200, height: 100 }, 1)).toBeNull();
  });

  it('Mobile in a roomy pane is 375 × 812, and the page reads 375 × 812', () => {
    expect(pageBox(MOBILE, 1, ROOMY, 1)).toEqual({ width: 375, height: 812, reads: { width: 375, height: 812 } });
  });

  it('at page zoom 1.25 the element is 469 × 1015 in the pane’s pixels, and the page still reads 375 × 812', () => {
    expect(pageBox(MOBILE, 1.25, ROOMY, 1)).toEqual({ width: 469, height: 1015, reads: { width: 375, height: 812 } });
  });

  it('a pane narrower or shorter than the size cuts that side to the room, and the reading follows', () => {
    expect(pageBox(MOBILE, 1, { width: 1200, height: 600 }, 1)).toEqual({ width: 375, height: 600, reads: { width: 375, height: 600 } });
    expect(pageBox(MOBILE, 1, { width: 320, height: 1400 }, 1)).toEqual({ width: 320, height: 812, reads: { width: 320, height: 812 } });
    expect(pageBox(TABLET, 1.25, { width: 800, height: 700 }, 1)).toEqual({ width: 800, height: 700, reads: { width: 640, height: 560 } });
  });
});

describe('fits', () => {
  it('Tablet does not fit under 768 points of room at zoom 1, nor under 960 at zoom 1.25', () => {
    expect(fits(TABLET, 1, { width: 767, height: 2000 }, 1)).toBe(false);
    expect(fits(TABLET, 1, { width: 768, height: 100 }, 1)).toBe(true); // the width decides: a shorter pane cuts the height
    expect(fits(TABLET, 1.25, { width: 959, height: 2000 }, 1)).toBe(false);
    expect(fits(TABLET, 1.25, { width: 960, height: 2000 }, 1)).toBe(true);
    expect(fits(MOBILE, 1, { width: 375, height: 1 }, 1)).toBe(true);
    expect(fits(MOBILE, 1, { width: 374, height: 2000 }, 1)).toBe(false);
  });
});

// UX wave U6b-5b (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5b-zoom.md, decision 35; finding 8): the element is
// min(round(W × z ÷ a), the room) in the window's CSS pixels, what the page reads is round(element × a ÷ z), and a size fits
// when W × z ÷ a is no more than the room. On the Mac at every factor the element read 375 and the menu offered Mobile from
// a room of 375 CSS pixels, the app's factor nowhere in the sum.
describe('the app window’s zoom (U6b-5b, placement 6)', () => {
  it('at 200 % Mobile is an element of 188 CSS pixels, which the page reads as 376, and the chip says so', () => {
    expect(pageBox(MOBILE, 1, ROOMY, 2)).toEqual({ width: 188, height: 406, reads: { width: 376, height: 812 } });
  });

  it.each([
    [2, 1, { width: 188, height: 406, reads: { width: 376, height: 812 } }],
    [2, 1.25, { width: 234, height: 508, reads: { width: 374, height: 813 } }],
    [1.25, 1, { width: 300, height: 650, reads: { width: 375, height: 813 } }],
    [1.25, 1.25, { width: 375, height: 812, reads: { width: 375, height: 812 } }],
    [0.5, 1, { width: 750, height: 1624, reads: { width: 375, height: 812 } }],
    [0.5, 1.25, { width: 938, height: 2030, reads: { width: 375, height: 812 } }],
  ])('at an app factor of %s and a tab zoom of %s the element, the reading and the fit come from the one formula', (app, zoom, box) => {
    const room = { width: 4000, height: 4000 };
    expect(pageBox(MOBILE, zoom, room, app)).toEqual(box);
    expect(fits(MOBILE, zoom, { width: Math.ceil((375 * zoom) / app), height: 1 }, app)).toBe(true);
    expect(fits(MOBILE, zoom, { width: Math.ceil((375 * zoom) / app) - 1, height: 1 }, app)).toBe(false);
  });

  // main places the view edge by edge (decision 27: each edge times the factor, rounded), so what the page reads depends
  // on where the element sits: at 125 % an element of 650 CSS pixels from a top of 158 is 198 to 1010 points, 812, where
  // from a top of 0 it is 0 to 813
  it('reads the element’s placed edges: at 125 % Mobile from a top of 158 reads 812, from a top of 0 reads 813', () => {
    expect(pageBox(MOBILE, 1, { width: 1000, height: 1100, placed: { x: 350, y: 158, width: 300, height: 650 } }, 1.25)).toEqual({ width: 300, height: 650, reads: { width: 375, height: 812 } });
    expect(pageBox(MOBILE, 1, { width: 1000, height: 1100, placed: { x: 0, y: 0, width: 300, height: 650 } }, 1.25)).toEqual({ width: 300, height: 650, reads: { width: 375, height: 813 } });
    expect(pageBox(MOBILE, 1, { width: 1000, height: 1100, placed: { x: 406, y: 40, width: 188, height: 406 } }, 2)).toEqual({ width: 188, height: 406, reads: { width: 376, height: 812 } }); // 375 → 376 at 200 %, wherever it sits
    expect(pageBox(MOBILE, 1, { width: 1000, height: 1100, placed: { x: 407, y: 41, width: 188, height: 406 } }, 2)!.reads).toEqual({ width: 376, height: 812 });
  });

  // The branch review (scalpel-3#2): the pane measures the element's two edges and sends main their difference, which
  // can be a pixel under the nominal size; the reading takes the rect as sent, both edges. At 80 % with the tab at 75 %,
  // Mobile's element is 352 CSS pixels, 282 points; measured 351 apart it is placed as 281 points, which the page reads
  // as 375, not 376 (a Retina display, two device pixels a point)
  it('reads the rect as the pane sent it, both edges, not the nominal size from its origin', () => {
    const room = (width: number) => ({ width: 1000, height: 1100, placed: { x: 0, y: 0, width, height: 761 }, scale: 2 });
    expect(pageBox(MOBILE, 0.75, room(351), 0.8)).toEqual({ width: 352, height: 761, reads: { width: 375, height: 812 } });
    expect(pageBox(MOBILE, 0.75, room(352), 0.8)!.reads.width).toBe(376); // the control: the nominal 352 from the same origin
  });

  // The branch review (scalpel-3#1): Blink's `innerWidth` and `innerHeight` are `AdjustForAbsoluteZoom::AdjustInt` of the
  // frame's size in device pixels by the layout zoom (the display's scale times the tab's zoom): biased by half a pixel
  // above a zoom of 1, then truncated with a tolerance of 0.01, which is not a rounding to the nearest. 894 points at a tab
  // zoom of 110 % read 812 on a Retina display (1788.5 / 2.2 = 812.95) and 813 on a display of one pixel a point
  // (894.5 / 1.1 = 813.18); rounding to the nearest says 813 for both
  it('reads as Blink does: 894 points at a tab zoom of 110 % read 812 on a Retina display, 813 at one pixel a point', () => {
    expect(pageBox(TABLET, 1.1, { width: 2000, height: 894, scale: 2 }, 1)).toEqual({ width: 845, height: 894, reads: { width: 768, height: 812 } });
    expect(pageBox(TABLET, 1.1, { width: 2000, height: 894, scale: 1 }, 1)!.reads.height).toBe(813);
    expect(pageBox(TABLET, 1.1, { width: 2000, height: 894 }, 1)!.reads.height).toBe(813); // no scale given: one pixel a point
  });

  // under a zoom of 1 there is no bias: the quotient is truncated, so 281 points at 75 % read 374 (374.67), not 375
  it('truncates under a zoom of 1: 281 points at 75 % read 374 at one pixel a point', () => {
    expect(pageBox(MOBILE, 0.75, { width: 1000, height: 1100, scale: 1 }, 1)).toEqual({ width: 281, height: 609, reads: { width: 374, height: 812 } });
  });

  it('offers Mobile in a room of 300 CSS pixels at 200 % (it needs 188), and not in a room of 500 at 50 % (it needs 750)', () => {
    expect(fits(MOBILE, 1, { width: 300, height: 100 }, 2)).toBe(true);
    expect(fits(MOBILE, 1, { width: 500, height: 100 }, 0.5)).toBe(false);
    expect(fits(MOBILE, 1, { width: 370, height: 100 }, 1)).toBe(false); // the Mac's room just under 375, at 100 %
  });

  it('cuts a side to its room, and reads the room times a ÷ z, rounded', () => {
    expect(pageBox(MOBILE, 1, { width: 150, height: 300 }, 2)).toEqual({ width: 150, height: 300, reads: { width: 300, height: 600 } });
    expect(pageBox(TABLET, 1.25, { width: 333, height: 2000 }, 0.8)).toEqual({ width: 333, height: 1600, reads: { width: 213, height: 1024 } });
  });
});
