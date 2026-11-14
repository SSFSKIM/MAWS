// U12a (the UX wave's U12, l9-browser-delivery-06; Interfaces §D): a device size's page box, the one sum the pane, the
// options menu and the chip read, so the three cannot disagree.
import { describe, expect, it } from 'vitest';
import { BROWSER_VIEWPORTS } from '@shared/browser/tab';
import { fits, pageBox } from './viewport';

const [MOBILE, TABLET] = BROWSER_VIEWPORTS;
const ROOMY = { width: 1200, height: 1400 };

describe('pageBox', () => {
  it('Responsive answers no box: the page fills its room as today', () => {
    expect(pageBox(null, 1, ROOMY)).toBeNull();
    expect(pageBox(null, 1.25, { width: 200, height: 100 })).toBeNull();
  });

  it('Mobile in a roomy pane is 375 × 812, and the page reads 375 × 812', () => {
    expect(pageBox(MOBILE, 1, ROOMY)).toEqual({ width: 375, height: 812, reads: { width: 375, height: 812 } });
  });

  it('at page zoom 1.25 the element is 469 × 1015 in the pane’s pixels, and the page still reads 375 × 812', () => {
    expect(pageBox(MOBILE, 1.25, ROOMY)).toEqual({ width: 469, height: 1015, reads: { width: 375, height: 812 } });
  });

  it('a pane narrower or shorter than the size cuts that side to the room, and the reading follows', () => {
    expect(pageBox(MOBILE, 1, { width: 1200, height: 600 })).toEqual({ width: 375, height: 600, reads: { width: 375, height: 600 } });
    expect(pageBox(MOBILE, 1, { width: 320, height: 1400 })).toEqual({ width: 320, height: 812, reads: { width: 320, height: 812 } });
    expect(pageBox(TABLET, 1.25, { width: 800, height: 700 })).toEqual({ width: 800, height: 700, reads: { width: 640, height: 560 } });
  });
});

describe('fits', () => {
  it('Tablet does not fit under 768 points of room at zoom 1, nor under 960 at zoom 1.25', () => {
    expect(fits(TABLET, 1, { width: 767, height: 2000 })).toBe(false);
    expect(fits(TABLET, 1, { width: 768, height: 100 })).toBe(true); // the width decides: a shorter pane cuts the height
    expect(fits(TABLET, 1.25, { width: 959, height: 2000 })).toBe(false);
    expect(fits(TABLET, 1.25, { width: 960, height: 2000 })).toBe(true);
    expect(fits(MOBILE, 1, { width: 375, height: 1 })).toBe(true);
    expect(fits(MOBILE, 1, { width: 374, height: 2000 })).toBe(false);
  });
});
