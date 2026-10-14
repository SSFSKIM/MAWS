// P3-C M5 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Transform layer"): the transform layer's math,
// portable and DOM-free: rotated boxes, resizing from each handle (rotated, aspect-locked, from the centre), the
// rotation handle's angle, snapping to the slide, the margins, siblings and equal gaps, right/bottom pins converted on
// a first drag, transforms composed with a rotation, flow insertion.
import { describe, expect, it } from 'vitest';
import {
  angleFromPointer,
  corners,
  flowInsertIndex,
  hitTest,
  intersects,
  pinToLeftTop,
  resizeBox,
  rotatedBounds,
  rotationOf,
  slideLines,
  snapMove,
  snapResize,
  translateOf,
  withRotation,
  type Box,
} from './geometry';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h });

describe('rotated boxes', () => {
  it('turns the corners about the centre and bounds them', () => {
    const b = box(0, 0, 200, 100);
    const c = corners(b, 90);
    // 90° clockwise about (100, 50): the top-left corner goes to the top-right of the turned box
    expect(c[0]!.x).toBeCloseTo(150);
    expect(c[0]!.y).toBeCloseTo(-50);
    const r = rotatedBounds(b, 90);
    expect(r.x).toBeCloseTo(50);
    expect(r.y).toBeCloseTo(-50);
    expect(r.w).toBeCloseTo(100);
    expect(r.h).toBeCloseTo(200);
    const d = rotatedBounds(box(0, 0, 100, 100), 45);
    expect(d.w).toBeCloseTo(100 * Math.SQRT2);
  });

  it('hit-tests in the element’s own frame', () => {
    const b = box(0, 0, 200, 20);
    expect(hitTest(b, 0, { x: 190, y: 10 })).toBe(true);
    expect(hitTest(b, 90, { x: 190, y: 10 })).toBe(false); // turned upright: a thin vertical bar at x = 90..110
    expect(hitTest(b, 90, { x: 100, y: 90 })).toBe(true);
  });

  it('marquee intersection uses the rotated bounds', () => {
    expect(intersects(box(0, 0, 10, 10), box(5, 5, 10, 10))).toBe(true);
    expect(intersects(box(0, 0, 10, 10), box(10.5, 0, 10, 10))).toBe(false);
  });
});

describe('transforms', () => {
  it('reads the rotation in deg, turn and rad', () => {
    expect(rotationOf(undefined)).toBe(0);
    expect(rotationOf('rotate(30deg)')).toBe(30);
    expect(rotationOf('translateX(-50%) rotate(0.25turn)')).toBe(90);
    expect(rotationOf(`rotate(${Math.PI}rad)`)).toBeCloseTo(180);
  });

  it('composes a rotation with the element’s other transforms, in the dialect’s order', () => {
    expect(withRotation(undefined, 15)).toBe('rotate(15deg)');
    expect(withRotation('rotate(10deg)', 0)).toBeNull();
    expect(withRotation('translate(-50%, -50%) scale(1.2)', 30)).toBe('translate(-50%, -50%) rotate(30deg) scale(1.2)');
    expect(withRotation('translateX(-50%) rotate(5deg) skewX(10deg)', -45)).toBe('translateX(-50%) rotate(-45deg) skewX(10deg)');
    expect(withRotation('scale(2)', 0)).toBe('scale(2)');
    expect(withRotation('rotate(1deg)', 361)).toBe('rotate(1deg)'); // normalized to (-180, 180]
    expect(withRotation(undefined, 22.456)).toBe('rotate(22.46deg)');
  });

  it('reads a translate in px or % of the box', () => {
    expect(translateOf('translate(-50%, -50%)', 200, 100)).toEqual([-100, -50]);
    expect(translateOf('translateX(12px) rotate(4deg)', 200, 100)).toEqual([12, 0]);
    expect(translateOf('translateY(-50%)', 200, 100)).toEqual([0, -50]);
    expect(translateOf(undefined, 1, 1)).toEqual([0, 0]);
  });
});

describe('resizing', () => {
  const start = box(100, 100, 200, 100);

  it('moves the dragged edges and keeps the opposite ones', () => {
    expect(resizeBox(start, 'se', { x: 50, y: 20 }, {})).toEqual(box(100, 100, 250, 120));
    expect(resizeBox(start, 'nw', { x: 50, y: 20 }, {})).toEqual(box(150, 120, 150, 80));
    expect(resizeBox(start, 'e', { x: 50, y: 999 }, {})).toEqual(box(100, 100, 250, 100));
    expect(resizeBox(start, 'n', { x: 999, y: -30 }, {})).toEqual(box(100, 70, 200, 130));
  });

  it('Shift keeps the aspect, from a corner and from an edge', () => {
    const r = resizeBox(start, 'se', { x: 100, y: 0 }, { keepAspect: true });
    expect(r.w / r.h).toBeCloseTo(2);
    expect(r).toEqual(box(100, 100, 300, 150));
    const e = resizeBox(start, 'e', { x: 100, y: 0 }, { keepAspect: true });
    expect(e.w / e.h).toBeCloseTo(2);
    expect(e.y + e.h / 2).toBeCloseTo(150); // an edge handle grows the other side about its middle
  });

  it('Alt resizes from the centre', () => {
    expect(resizeBox(start, 'se', { x: 10, y: 10 }, { fromCentre: true })).toEqual(box(90, 90, 220, 120));
  });

  it('never goes below the minimum size, the opposite edge staying put', () => {
    const r = resizeBox(start, 'e', { x: -500, y: 0 }, { min: 8 });
    expect(r).toEqual(box(100, 100, 8, 100));
    const l = resizeBox(start, 'w', { x: 500, y: 0 }, { min: 8 });
    expect(l).toEqual(box(292, 100, 8, 100));
  });

  it('a rotated box resizes along its own axes, its opposite corner fixed on the slide', () => {
    const b = box(0, 0, 200, 100);
    const rot = 90;
    const before = corners(b, rot);
    // the se handle of a box turned 90° sits at the bottom-left on screen; dragging it 30 px left is +30 along its x axis
    const se = before[2]!;
    const r = resizeBox(b, 'se', { x: -30, y: 0 }, { rotation: rot });
    expect(r.w).toBeCloseTo(200);
    expect(r.h).toBeCloseTo(130);
    const after = corners(r, rot);
    expect(near(after[0]!.x, before[0]!.x) && near(after[0]!.y, before[0]!.y)).toBe(true); // the nw corner held
    expect(after[2]!.x).toBeCloseTo(se.x - 30);
    expect(after[2]!.y).toBeCloseTo(se.y);
  });
});

describe('rotating', () => {
  it('reads the handle’s angle about the centre, Shift by 15°', () => {
    const c = { x: 100, y: 100 };
    expect(angleFromPointer(c, { x: 100, y: 0 }, false)).toBeCloseTo(0);
    expect(angleFromPointer(c, { x: 200, y: 100 }, false)).toBeCloseTo(90);
    expect(angleFromPointer(c, { x: 0, y: 100 }, false)).toBeCloseTo(-90);
    expect(angleFromPointer(c, { x: 100, y: 200 }, false)).toBeCloseTo(180);
    expect(angleFromPointer(c, { x: 100 + Math.sin(0.4), y: 100 - Math.cos(0.4) }, true)).toBe(30); // 22.9° → 30° step... nearest
    expect(angleFromPointer(c, { x: 100 + Math.sin(0.2), y: 100 - Math.cos(0.2) }, true)).toBe(15);
  });
});

describe('snapping', () => {
  const lines = slideLines();

  it('names the slide’s edges, centre and 128 px margins', () => {
    expect(lines.x.map((l) => l.at)).toEqual([0, 128, 960, 1792, 1920]);
    expect(lines.y.map((l) => l.at)).toEqual([0, 128, 540, 952, 1080]);
  });

  it('snaps a moving box’s edge or centre to the nearest line within the threshold', () => {
    const r = snapMove(box(132, 300, 200, 100), { lines, siblings: [] }, 6);
    expect(r.x).toBe(128); // its left edge to the margin
    expect(r.y).toBe(300); // nothing within 6 px vertically
    expect(r.guides.some((g) => g.axis === 'x' && g.at === 128 && g.kind === 'margin')).toBe(true);
    const c = snapMove(box(857, 487, 200, 100), { lines, siblings: [] }, 6);
    expect([c.x, c.y]).toEqual([860, 490]); // its centre to the slide's centre on both axes
    expect(snapMove(box(140, 300, 200, 100), { lines, siblings: [] }, 6).x).toBe(140); // 12 px away: free
  });

  it('snaps to a sibling’s edges and centre', () => {
    const sib = box(600, 600, 300, 200);
    const r = snapMove(box(902, 300, 100, 100), { lines: { x: [], y: [] }, siblings: [sib] }, 6);
    expect(r.x).toBe(900); // left to the sibling's right edge
    const g = r.guides.find((x) => x.axis === 'x' && x.at === 900)!;
    expect(g.kind).toBe('edge');
    expect(g.from).toBe(300);
    expect(g.to).toBe(800); // the guide spans both boxes
    expect(snapMove(box(698, 300, 100, 100), { lines: { x: [], y: [] }, siblings: [sib] }, 6).x).toBe(700); // centres
  });

  it('snaps to equal gaps between siblings in a row', () => {
    const a = box(100, 400, 200, 100);
    const b = box(700, 400, 200, 100);
    // between a (ends 300) and b (starts 700) a 200 px box sits with 100 px each side at x = 400
    const r = snapMove(box(404, 410, 200, 80), { lines: { x: [], y: [] }, siblings: [a, b] }, 6);
    expect(r.x).toBe(400);
    expect(r.guides.filter((g) => g.kind === 'gap')).toHaveLength(2);
    // after a pair with a 100 px gap: a (100..300), c (400..600), the next at 700
    const c = box(400, 400, 200, 100);
    const after = snapMove(box(703, 420, 50, 50), { lines: { x: [], y: [] }, siblings: [a, c] }, 6);
    expect(after.x).toBe(700);
    // a sibling in another row does not make a gap
    const off = snapMove(box(404, 800, 200, 80), { lines: { x: [], y: [] }, siblings: [a, b] }, 6);
    expect(off.x).toBe(404);
  });

  it('snaps the dragged edges of a resize, not the fixed ones', () => {
    const r = snapResize(box(100, 100, 1694, 200), 'e', { lines, siblings: [] }, 6);
    expect(r.box.w).toBe(1692); // the right edge to the margin at 1792
    expect(r.box.x).toBe(100);
    expect(r.guides.map((g) => [g.axis, g.at])).toEqual([['x', 1792]]);
    const n = snapResize(box(100, 131, 200, 200), 'n', { lines, siblings: [] }, 6);
    expect(n.box).toEqual(box(100, 128, 200, 203)); // the top edge to the margin, the bottom kept
  });
});

describe('pins', () => {
  it('converts a right/bottom pin to left/top at the element’s place on its first drag', () => {
    expect(pinToLeftTop({ position: 'absolute', right: '128px', bottom: '64px' }, box(1632, 952, 160, 64))).toEqual({ left: '1632px', top: '952px', right: null, bottom: null });
    expect(pinToLeftTop({ position: 'absolute', left: '50%', top: 'calc(50% - 20px)' }, box(960, 520, 10, 10))).toEqual({ left: '960px', top: '520px' });
    expect(pinToLeftTop({ position: 'absolute', left: '10px', top: '20px' }, box(10, 20, 1, 1))).toEqual({});
    // left and right together stretch: the width is written so it keeps its size once the right pin goes
    expect(pinToLeftTop({ position: 'absolute', left: '0px', right: '0px', top: '0px' }, box(0, 0, 1920, 40))).toEqual({ right: null, width: '1920px' });
  });
});

describe('flow insertion', () => {
  it('finds the slot along the parent’s axis from the pointer', () => {
    const boxes = [box(0, 0, 100, 100), box(0, 120, 100, 100), box(0, 240, 100, 100)];
    expect(flowInsertIndex(boxes, { x: 50, y: 10 }, 'column')).toBe(0);
    expect(flowInsertIndex(boxes, { x: 50, y: 160 }, 'column')).toBe(1);
    expect(flowInsertIndex(boxes, { x: 50, y: 200 }, 'column')).toBe(2);
    expect(flowInsertIndex(boxes, { x: 50, y: 900 }, 'column')).toBe(3);
    const row = [box(0, 0, 100, 50), box(200, 0, 100, 50)];
    expect(flowInsertIndex(row, { x: 260, y: 0 }, 'row')).toBe(2);
  });
});
