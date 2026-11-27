// Where the host's hover tip sits (P3-E2 M3, Decision Log 21): beside the pointer inside the figure's frame, which is
// also the frame's horizontal scroller (a figure wider than its column scrolls rather than shrinks). The tip is placed in
// the frame's visible box (flipped to the pointer's other side at a right or bottom edge, clamped inside it) and written
// in the frame's scrolled content coordinates, so a tip at a revealed right-edge point is whole and readable.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachHover, NOTE_GAP_PX, NOTE_INSET_PX, NOTE_MAX_PX, placeNote } from './hover';

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

// The word cut (G598), the whole-branch review's fix wave: a ⚠ mark's note (sheet.css's `::after`) opens from the mark's
// start rightward while it fits in what can be seen around the mark (the editor's scroller, the window); otherwise from
// the mark's end leftward where there is more room that way; and its width is capped to the room on the side it opens
// to, so no part of it is clipped, as the shared Tip flips and shifts.
describe('a mark’s note', () => {
  /** A mark `width` wide at `left` in a scroller that shows `seen` (its left and width) of the page. */
  function markIn(seen: [number, number], left: number, width = 14) {
    const scroller = document.body.appendChild(document.createElement('div'));
    scroller.style.overflowX = 'auto'; // happy-dom's computed style does not expand the `overflow` shorthand
    scroller.getBoundingClientRect = () => rect(seen[0], 0, seen[1], 600);
    Object.defineProperties(scroller, { clientWidth: { value: seen[1] }, clientHeight: { value: 600 }, clientLeft: { value: 0 }, clientTop: { value: 0 } });
    const mark = scroller.appendChild(document.createElement('span'));
    mark.getBoundingClientRect = () => rect(left, 100, width, 16);
    placeNote(mark);
    return { side: mark.dataset.noteSide ?? 'start', max: mark.style.getPropertyValue('--dash-note-max') };
  }

  it('opens rightward from the mark at its full width where that fits', () => {
    expect(markIn([0, 800], 100)).toEqual({ side: 'start', max: `${NOTE_MAX_PX}px` });
  });

  it('opens leftward from the mark’s end near the scroller’s right edge', () => {
    expect(markIn([0, 800], 700)).toEqual({ side: 'end', max: `${NOTE_MAX_PX}px` });
  });

  it('caps its width to the room on the side with more of it, so neither edge clips it', () => {
    expect(markIn([0, 420], 300)).toEqual({ side: 'end', max: `${300 + 14 - NOTE_INSET_PX}px` });
    expect(markIn([100, 300], 150)).toEqual({ side: 'start', max: `${400 - 150 - NOTE_INSET_PX}px` });
  });
});

// The pair review's fix wave (G603): the note opens under the mark while its height fits below it in what can be seen;
// a mark near the bottom of the editor's scroller or of the window opens it above, where there is more room that way.
// Its height is read as the note will be drawn, at the width its side allows.
describe('a mark’s note, upward near the bottom edge', () => {
  /** The note's drawn height, as the stylesheet lays it out at `--dash-note-max` (happy-dom lays out no `::after`). */
  function noteHeight(height: (max: string) => number) {
    const own = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) =>
      pseudo === '::after' ? ({ height: `${height((el as HTMLElement).style.getPropertyValue('--dash-note-max'))}px` } as CSSStyleDeclaration) : own(el, pseudo),
    );
  }
  afterEach(() => vi.restoreAllMocks());

  /** A mark 16 px tall at `top` in a scroller that clips its height to `seen` (its top and height) of the page. */
  function markAt(top: number, seen: [number, number] = [0, 600], left = 100) {
    const scroller = document.body.appendChild(document.createElement('div'));
    scroller.style.overflowY = 'auto';
    scroller.getBoundingClientRect = () => rect(0, seen[0], 800, seen[1]);
    Object.defineProperties(scroller, { clientWidth: { value: 800 }, clientHeight: { value: seen[1] }, clientLeft: { value: 0 }, clientTop: { value: 0 } });
    const mark = scroller.appendChild(document.createElement('span'));
    mark.getBoundingClientRect = () => rect(left, top, 14, 16);
    placeNote(mark);
    return { above: mark.hasAttribute('data-note-above'), mark };
  }

  it('opens under the mark where its height fits below it', () => {
    noteHeight(() => 40);
    expect(markAt(100).above).toBe(false);
    // just enough room: the note, its gap and the inset end at the scroller's bottom edge
    expect(markAt(600 - NOTE_INSET_PX - NOTE_GAP_PX - 40 - 16).above).toBe(false);
  });

  it('opens above the mark near the scroller’s bottom edge', () => {
    noteHeight(() => 40);
    expect(markAt(570).above).toBe(true);
    expect(markAt(600 - NOTE_INSET_PX - NOTE_GAP_PX - 40 - 16 + 1).above).toBe(true);
  });

  it('opens above the mark near the window’s bottom edge, where no scroller clips it', () => {
    noteHeight(() => 40);
    const { above } = markAt(window.innerHeight - 20, [0, window.innerHeight + 400]);
    expect(above).toBe(true);
  });

  it('stays under the mark when there is even less room above it', () => {
    noteHeight(() => 80);
    expect(markAt(40, [0, 100]).above).toBe(false);
  });

  it('measures the note at the width its side allows, which can make it too tall to fit below', () => {
    // at its full width the note is one line; narrowed to the room left of a mark near the right edge, it wraps
    noteHeight((max) => (max === `${NOTE_MAX_PX}px` ? 24 : 120));
    expect(markAt(500, [0, 600], 100).above).toBe(false);
    expect(markAt(500, [0, 600], 700).above).toBe(false); // leftward at full width: still one line
    const scroller = document.body.appendChild(document.createElement('div'));
    scroller.style.overflowX = 'auto';
    scroller.style.overflowY = 'auto';
    scroller.getBoundingClientRect = () => rect(0, 0, 300, 600);
    Object.defineProperties(scroller, { clientWidth: { value: 300 }, clientHeight: { value: 600 }, clientLeft: { value: 0 }, clientTop: { value: 0 } });
    const mark = scroller.appendChild(document.createElement('span'));
    mark.getBoundingClientRect = () => rect(150, 500, 14, 16);
    placeNote(mark);
    expect(mark.style.getPropertyValue('--dash-note-max')).not.toBe(`${NOTE_MAX_PX}px`); // narrowed
    expect(mark.hasAttribute('data-note-above')).toBe(true); // 120 px tall at that width: no room below
  });

  it('drops the upward side when the mark is placed again with room below', () => {
    noteHeight(() => 40);
    const { mark } = markAt(570);
    expect(mark.hasAttribute('data-note-above')).toBe(true);
    mark.getBoundingClientRect = () => rect(100, 100, 14, 16);
    placeNote(mark);
    expect(mark.hasAttribute('data-note-above')).toBe(false);
  });
});
