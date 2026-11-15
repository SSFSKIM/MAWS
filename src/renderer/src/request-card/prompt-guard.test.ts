// UX wave U1b M4 (the U1b document, Interfaces §F "The guard"; decision 18): the guard of one prompt at a transcript's end,
// transition by transition. The test drives the clock (performance's) and the geometry (each element's rectangle, what is
// topmost at a point, the intersection observer's entries) and asserts the guard's answers at given moments, never wall
// time; and it counts the geometry the guard reads while rows stream under an open prompt.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchPrompt } from './prompt-guard';

const GRACE = 400;

// ---- the geometry the test sets ---------------------------------------------------------------------------------------
const rects = new Map<Element, DOMRect>();
const rect = (left: number, top: number, width: number, height: number) => new DOMRect(left, top, width, height);
const contains = (r: DOMRect | undefined, x: number, y: number) => r !== undefined && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
let topmost: HTMLElement[] = []; // what elementFromPoint finds first, front to back

// An intersection observer the test fires, its entries computed from the rectangles the test set (clipped by the scroller
// and the window, as the browser reports them), so the guard reads none of the page's geometry to learn them.
const observers = new Set<FakeObserver>();
const WINDOW = () => rect(0, 0, window.innerWidth, window.innerHeight);
function clip(r: DOMRect, by: DOMRect): DOMRect {
  const left = Math.max(r.left, by.left);
  const top = Math.max(r.top, by.top);
  const right = Math.min(r.right, by.right);
  const bottom = Math.min(r.bottom, by.bottom);
  return right > left && bottom > top ? rect(left, top, right - left, bottom - top) : rect(0, 0, 0, 0);
}
const touches = (a: DOMRect, b: DOMRect) => a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
class FakeObserver {
  observed: Element[] = [];
  constructor(private readonly callback: (entries: IntersectionObserverEntry[], observer: unknown) => void) {
    observers.add(this);
  }
  observe(target: Element) {
    this.observed.push(target);
  }
  unobserve() {}
  takeRecords = () => [];
  disconnect() {
    observers.delete(this);
  }
  fire() {
    const entries = this.observed.map((target) => {
      const r = rects.get(target) ?? rect(0, 0, 0, 0);
      const seen = clip(clip(r, scrollerRect()), WINDOW());
      const area = (x: DOMRect) => x.width * x.height;
      // as the browser says it: a target that only touches the root's edge intersects, with an empty rectangle
      const isIntersecting = touches(r, scrollerRect()) && touches(r, WINDOW());
      return { target, boundingClientRect: r, intersectionRect: seen, isIntersecting, intersectionRatio: area(r) > 0 ? area(seen) / area(r) : 0, rootBounds: WINDOW(), time: performance.now() } as unknown as IntersectionObserverEntry;
    });
    this.callback(entries, this);
  }
}
const intersect = () => [...observers].forEach((observer) => observer.fire());

let scroller: HTMLElement;
const scrollerRect = () => rects.get(scroller) ?? rect(0, 0, 0, 0);
let card: HTMLElement;
let buttons: HTMLElement;
const place = (cardRect: DOMRect, buttonsRect: DOMRect) => {
  rects.set(card, cardRect);
  rects.set(buttons, buttonsRect);
};
// a card wholly in view inside the scroller (0..800 × 0..600), its buttons along its bottom
const IN_VIEW = () => place(rect(10, 100, 600, 200), rect(10, 250, 600, 40));
// half the card in view at the scroller's bottom edge; its buttons below that edge
const PARTLY = () => place(rect(10, 500, 600, 200), rect(10, 650, 600, 40));
// scrolled far away
const AWAY = () => place(rect(10, 2000, 600, 200), rect(10, 2150, 600, 40));
// its top on the scroller's bottom edge: touching the view, nothing of it shown
const EDGE = () => place(rect(10, 600, 600, 200), rect(10, 750, 600, 40));
// its top 5 px above that edge: a sliver shown
const SLIVER = () => place(rect(10, 595, 600, 200), rect(10, 745, 600, 40));

const now = () => performance.now();
// the geometry the guard reads: rectangles, computed styles, hit tests
let rectReads: { mock: { calls: unknown[] }; mockClear(): void };
let styleReads: { mock: { calls: unknown[] }; mockClear(): void };
let hits = 0;
const reads = () => ({ rects: rectReads.mock.calls.length, styles: styleReads.mock.calls.length, hits });
const unread = () => {
  rectReads.mockClear();
  styleReads.mockClear();
  hits = 0;
};
// a scroll: the browser's intersection entries say what it changed
const scrolled = () => {
  scroller.dispatchEvent(new Event('scroll'));
  intersect();
};
// a change to the page (an overlay opening or closing, an element laid over the buttons): the guard hears it through the
// page's mutations
const mutated = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
  vi.advanceTimersByTime(0);
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
  vi.advanceTimersByTime(10_000);
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  card = document.createElement('div');
  buttons = document.createElement('div');
  card.append(buttons);
  scroller.append(card);
  document.body.append(scroller);
  rects.set(scroller, rect(0, 0, 800, 600));
  IN_VIEW();
  topmost = [];
  hits = 0;
  rectReads = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rects.get(this) ?? rect(0, 0, 0, 0);
  });
  styleReads = vi.spyOn(window, 'getComputedStyle');
  document.elementFromPoint = (x: number, y: number) => {
    hits += 1;
    return topmost.find((element) => contains(rects.get(element), x, y)) ?? ([buttons, card].find((element) => contains(rects.get(element), x, y)) ?? document.body);
  };
});
afterEach(() => {
  document.body.replaceChildren();
  rects.clear();
  observers.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function watch() {
  const guard = watchPrompt(card, buttons);
  return { guard, startedAt: now() };
}

describe('the guard of a prompt at a transcript’s end', () => {
  it('arms its deny and its allows 400 ms after the watch starts, with the card in view and its buttons whole', () => {
    const { guard, startedAt } = watch();
    expect(guard.mayDeny(startedAt + GRACE - 1)).toBe(false);
    expect(guard.mayAllow(startedAt + GRACE - 1)).toBe(false);
    expect(guard.mayDeny(startedAt + GRACE)).toBe(true);
    expect(guard.mayAllow(startedAt + GRACE)).toBe(true);
  });

  it('a card partly in view for seconds whose buttons then come wholly into view: no allow until 400 ms after that moment, and the deny acts throughout', () => {
    PARTLY();
    const { guard } = watch();
    vi.advanceTimersByTime(3000);
    expect(guard.mayDeny(now())).toBe(true); // any sliver in view: Esc's rule
    expect(guard.mayAllow(now())).toBe(false); // the buttons are below the scroller's edge
    IN_VIEW();
    scrolled();
    const wholeAt = now();
    expect(guard.mayAllow(wholeAt + GRACE - 1)).toBe(false);
    expect(guard.mayDeny(wholeAt + GRACE - 1)).toBe(true);
    expect(guard.mayAllow(wholeAt + GRACE)).toBe(true);
  });

  it('an overlay that closes: the deny and the allows answer nothing for 400 ms after it closed', async () => {
    const { guard, startedAt } = watch();
    vi.advanceTimersByTime(2 * GRACE);
    expect(guard.mayAllow(now())).toBe(true);
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.dataset.state = 'open';
    document.body.append(menu);
    await mutated();
    vi.advanceTimersByTime(1000);
    menu.remove();
    await mutated();
    const clearedAt = now();
    expect(clearedAt).toBeGreaterThan(startedAt + 2 * GRACE);
    expect(guard.mayDeny(clearedAt + GRACE - 1)).toBe(false);
    expect(guard.mayAllow(clearedAt + GRACE - 1)).toBe(false);
    expect(guard.mayDeny(clearedAt + GRACE)).toBe(true);
    expect(guard.mayAllow(clearedAt + GRACE)).toBe(true);
  });

  it('a card that leaves the view answers nothing, and re-arms 400 ms after it returns', () => {
    const { guard } = watch();
    vi.advanceTimersByTime(2 * GRACE);
    AWAY();
    intersect();
    expect(guard.mayDeny(now())).toBe(false);
    expect(guard.mayAllow(now())).toBe(false);
    vi.advanceTimersByTime(5000);
    IN_VIEW();
    intersect();
    const shownAt = now();
    expect(guard.mayDeny(shownAt + GRACE - 1)).toBe(false);
    expect(guard.mayAllow(shownAt + GRACE - 1)).toBe(false);
    expect(guard.mayDeny(shownAt + GRACE)).toBe(true);
    expect(guard.mayAllow(shownAt + GRACE)).toBe(true);
  });

  // The branch review (2026-11-15 UTC): the observer's "shown" is the same test as the press's, any area of the card
  // left once clipped, so a card that only touches the view's edge starts no clock.
  it('a card that only touches the view’s edge is not shown: a sliver that arrives later waits the full 400 ms from its own arrival', () => {
    AWAY();
    const { guard } = watch();
    vi.advanceTimersByTime(1000);
    EDGE();
    intersect(); // intersecting, by the browser's word, with an empty rectangle
    vi.advanceTimersByTime(2 * GRACE);
    SLIVER();
    intersect();
    const arrivedAt = now();
    expect(guard.mayDeny(arrivedAt)).toBe(false);
    expect(guard.mayDeny(arrivedAt + GRACE - 1)).toBe(false);
    expect(guard.mayDeny(arrivedAt + GRACE)).toBe(true);
  });

  it('buttons covered by another element refuse an allow, and re-arm 400 ms after they are uncovered', async () => {
    const { guard } = watch();
    vi.advanceTimersByTime(2 * GRACE);
    const toast = document.createElement('div');
    rects.set(toast, rect(400, 240, 300, 60)); // over the buttons' right end
    topmost = [toast];
    document.body.append(toast);
    await mutated();
    expect(guard.mayAllow(now())).toBe(false);
    expect(guard.mayDeny(now())).toBe(true); // the card is still in view
    vi.advanceTimersByTime(2000);
    toast.remove();
    topmost = [];
    await mutated();
    const uncoveredAt = now();
    expect(guard.mayAllow(uncoveredAt + GRACE - 1)).toBe(false);
    expect(guard.mayAllow(uncoveredAt + GRACE)).toBe(true);
  });

  it('buttons that became whole with no scroll, resize or intersection event are caught at the press, which stamps and refuses', () => {
    PARTLY();
    const { guard } = watch();
    vi.advanceTimersByTime(3000);
    IN_VIEW(); // moved with no event the guard hears
    const pressedAt = now();
    expect(guard.mayAllow(pressedAt)).toBe(false); // the press counts as the moment they became whole
    expect(guard.mayAllow(pressedAt + GRACE - 1)).toBe(false);
    expect(guard.mayAllow(pressedAt + GRACE)).toBe(true);
  });

  it('a card below its scrolling ancestor’s edge is out of view, though the window would show it', () => {
    place(rect(10, 650, 600, 100), rect(10, 700, 600, 40)); // inside the window (768 high), below the scroller (600)
    const { guard } = watch();
    vi.advanceTimersByTime(2 * GRACE);
    expect(guard.mayDeny(now())).toBe(false);
    expect(guard.mayAllow(now())).toBe(false);
  });

  it('reads no geometry while rows stream under an open prompt and the list follows them, but at a press', async () => {
    const { guard } = watch();
    intersect();
    await mutated(); // the observers settle
    unread();
    for (let i = 0; i < 40; i++) {
      const row = document.createElement('div');
      row.dataset.index = String(i);
      row.textContent = `streamed row ${i}`;
      scroller.insertBefore(row, card);
      row.textContent += ' and more of it';
      scroller.dispatchEvent(new Event('scroll')); // the list following its end
      await mutated();
      vi.advanceTimersToNextFrame();
    }
    expect(reads()).toEqual({ rects: 0, styles: 0, hits: 0 });
    expect(guard.mayAllow(now())).toBe(true); // the bounded reads: one press's
    expect(reads().hits).toBe(4);
  });

  it('stops watching once disposed', () => {
    const { guard } = watch();
    expect(observers.size).toBe(1);
    guard.dispose();
    expect(observers.size).toBe(0);
  });
});
