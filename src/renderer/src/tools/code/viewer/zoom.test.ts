// P2-F W-V (L95, §2 item 6): the media viewers' sizing arithmetic: fit grows or shrinks the media into the pane with its
// aspect kept, zoom steps move through a fixed ladder from wherever the view is (fit included), actual size is 1.
import { describe, expect, it } from 'vitest';
import { drawnSize, fitScale, scaleOf, ZOOM_STEPS, zoomedIn, zoomedOut } from './zoom';

describe('media zoom', () => {
  it('fits by the tighter side: a small image grows, a large one shrinks, the aspect kept', () => {
    expect(fitScale({ width: 64, height: 64 }, { width: 600, height: 400 })).toBe(400 / 64);
    expect(fitScale({ width: 160, height: 120 }, { width: 800, height: 300 })).toBe(300 / 120);
    expect(fitScale({ width: 4000, height: 1000 }, { width: 800, height: 600 })).toBe(0.2);
  });

  it('reads the scale of fit from the pane and of a step as itself', () => {
    expect(scaleOf('fit', { width: 64, height: 64 }, { width: 640, height: 640 })).toBe(10);
    expect(scaleOf(1, { width: 64, height: 64 }, { width: 640, height: 640 })).toBe(1);
    expect(scaleOf(2, { width: 64, height: 64 }, { width: 640, height: 640 })).toBe(2);
  });

  it('steps in to the next rung above the current scale, and out to the next below', () => {
    expect(zoomedIn(1)).toBe(1.5);
    expect(zoomedOut(1)).toBe(0.75);
    expect(zoomedIn(2.4)).toBe(3); // from a fit between rungs
    expect(zoomedOut(2.4)).toBe(2);
    expect(zoomedIn(0.01)).toBe(ZOOM_STEPS[0]);
  });

  it('holds at the ladder’s ends, and a fit beyond them steps back onto it', () => {
    const top = ZOOM_STEPS.at(-1)!;
    expect(zoomedIn(top)).toBe(top);
    expect(zoomedOut(ZOOM_STEPS[0])).toBe(ZOOM_STEPS[0]);
    expect(zoomedOut(top * 3)).toBe(top);
    expect(zoomedIn(ZOOM_STEPS[0] / 4)).toBe(ZOOM_STEPS[0]);
  });

  it('treats a scale within rounding of a rung as that rung', () => {
    expect(zoomedIn(1.4999999)).toBe(2);
    expect(zoomedOut(1.5000001)).toBe(1);
  });

  it('draws the media at its natural size times the scale, in whole pixels never past the fit (no scrollbar at fit)', () => {
    expect(drawnSize({ width: 64, height: 48 }, 6.25)).toEqual({ width: 400, height: 300 });
    expect(drawnSize({ width: 333, height: 101 }, 0.5)).toEqual({ width: 166, height: 50 });
    const box = { width: 400.5, height: 300.75 };
    expect(drawnSize({ width: 64, height: 48 }, fitScale({ width: 64, height: 48 }, box))).toEqual({ width: 400, height: 300 });
  });

  it('never draws a positive side at 0 px: thin media keeps at least a pixel across', () => {
    const pane = { width: 600, height: 400 };
    expect(drawnSize({ width: 2000, height: 1 }, fitScale({ width: 2000, height: 1 }, pane))).toEqual({ width: 600, height: 1 });
    expect(drawnSize({ width: 1, height: 4000 }, fitScale({ width: 1, height: 4000 }, pane))).toEqual({ width: 1, height: 400 });
    expect(drawnSize({ width: 3, height: 3 }, ZOOM_STEPS[0])).toEqual({ width: 1, height: 1 });
  });
});
