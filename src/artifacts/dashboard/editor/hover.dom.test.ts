// Where the host's hover tip sits (P3-E2 M3, Decision Log 21): beside the pointer inside the figure's frame, which is
// also the frame's horizontal scroller (a figure wider than its column scrolls rather than shrinks). The tip is placed in
// the frame's visible box (flipped to the pointer's other side at a right or bottom edge, clamped inside it) and written
// in the frame's scrolled content coordinates, so a tip at a revealed right-edge point is whole and readable.
import { afterEach, describe, expect, it } from 'vitest';
import { attachHover } from './hover';

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

/** A frame at (100, 50) showing `visible` of its content, scrolled by `scroll`, around a figure with one bar mark. */
function world({ visible = [400, 300] as [number, number], scroll = [0, 0] as [number, number], tipSize = [120, 24] as [number, number], at = [100, 50] as [number, number], parent = document.body as HTMLElement } = {}) {
  const frame = parent.appendChild(document.createElement('div'));
  frame.innerHTML = '<svg width="672" height="300"><path d="M0,0h10v10h-10Z" data-tip="2024 · 미국 · growth_pct: 2.79"/></svg>';
  const tip = frame.appendChild(document.createElement('div'));
  tip.hidden = true;
  frame.getBoundingClientRect = () => rect(at[0], at[1], visible[0], visible[1]);
  Object.defineProperties(frame, {
    clientWidth: { value: visible[0] },
    clientHeight: { value: visible[1] },
    clientLeft: { value: 0 },
    clientTop: { value: 0 },
    scrollLeft: { value: scroll[0] },
    scrollTop: { value: scroll[1] },
  });
  const measured: string[] = []; // the tip's width style when it was measured
  tip.getBoundingClientRect = () => {
    measured.push(tip.style.width);
    return rect(0, 0, tipSize[0], tipSize[1]);
  };
  const release = attachHover(frame, tip);
  const mark = frame.querySelector('[data-tip]')!;
  const move = (clientX: number, clientY: number) => {
    mark.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX, clientY }));
    return { left: Number.parseFloat(tip.style.left), top: Number.parseFloat(tip.style.top), hidden: tip.hidden, text: tip.textContent };
  };
  return { frame, tip, at: move, release, measured, resize: (w: number, h: number) => void (tipSize = [w, h]) };
}

const releases: Array<() => void> = [];
afterEach(() => {
  for (const release of releases.splice(0)) release();
  document.body.replaceChildren();
});
const make = (options?: Parameters<typeof world>[0]) => {
  const w = world(options);
  releases.push(w.release);
  return w;
};

describe('the hover tip', () => {
  it('sits 12 px below and right of the pointer, its exact text', () => {
    const { at } = make();
    expect(at(150, 100)).toEqual({ left: 62, top: 62, hidden: false, text: '2024 · 미국 · growth_pct: 2.79' });
  });

  it('flips to the pointer\'s left at the frame\'s right edge, and above it at the bottom edge, whole inside the visible box', () => {
    const { at } = make();
    // pointer 10 px from the right edge (x 490 of 100..500): the tip ends 12 px left of the pointer
    expect(at(490, 100)).toMatchObject({ left: 390 - 12 - 120, top: 62 });
    // pointer 10 px from the bottom edge (y 340 of 50..350): the tip ends 12 px above the pointer
    expect(at(150, 340)).toMatchObject({ left: 62, top: 290 - 12 - 24 });
  });

  it('keeps a tip wider than the room on either side inside the visible box', () => {
    const { at } = make({ tipSize: [300, 24] });
    const placed = at(300, 100); // 200 px of room on the left, 200 on the right
    expect(placed.left).toBeGreaterThanOrEqual(0);
    expect(placed.left + 300).toBeLessThanOrEqual(400);
  });

  it('writes its place in the scrolled frame\'s content coordinates, so a revealed right-edge point\'s tip is in view', () => {
    // the frame shows 400 of a 672 px figure scrolled 272 px right (its last point revealed at x 490)
    const { at } = make({ scroll: [272, 30] });
    const placed = at(490, 100);
    expect(placed).toMatchObject({ left: 272 + 390 - 12 - 120, top: 30 + 62 });
    // in the frame's visible box: content x minus the scroll, inside 0..400
    expect(placed.left - 272).toBeGreaterThanOrEqual(0);
    expect(placed.left - 272 + 120).toBeLessThanOrEqual(400);
  });

  it('stays inside the window when the frame runs past it: a tall frame, the pointer near the window\'s bottom', () => {
    const height = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    Object.defineProperty(window, 'innerHeight', { value: 500, configurable: true });
    try {
      const { at } = make({ visible: [400, 900], at: [100, 100] });
      const placed = at(150, 490); // the frame reaches y 1000; the window ends at 500
      expect(placed.top).toBe(490 - 12 - 24 - 100); // above the pointer, in the frame's coordinates
      expect(100 + placed.top + 24).toBeLessThanOrEqual(500);
    } finally {
      if (height) Object.defineProperty(window, 'innerHeight', height);
    }
  });

  it('stays inside a clipping ancestor (the editor\'s scroller) that shows less of the frame', () => {
    const scroller = document.body.appendChild(document.createElement('div'));
    scroller.style.overflowY = 'auto';
    scroller.getBoundingClientRect = () => rect(0, 0, 1000, 300);
    Object.defineProperties(scroller, { clientWidth: { value: 1000 }, clientHeight: { value: 300 }, clientLeft: { value: 0 }, clientTop: { value: 0 } });
    const { at } = make({ visible: [400, 900], at: [100, 50], parent: scroller });
    const placed = at(150, 290); // the scroller shows the frame down to y 300
    expect(placed.top).toBe(290 - 12 - 24 - 50);
    expect(50 + placed.top + 24).toBeLessThanOrEqual(300);
  });

  it('fixes the measured width before it is placed, and measures afresh for the next value', () => {
    const { at, tip, measured, resize } = make({ scroll: [272, 0] });
    at(490, 100);
    expect(measured).toEqual(['']); // measured at its natural size, no width imposed
    expect(tip.style.width).toBe('120px'); // kept at that size wherever it is placed
    expect(tip.style.boxSizing).toBe('border-box');
    resize(200, 40);
    at(150, 100);
    expect(measured).toEqual(['', '']);
    expect(tip.style.width).toBe('200px');
  });
});
