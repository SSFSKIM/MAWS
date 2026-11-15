// UX wave U1b M4: happy-dom lays nothing out and never fires an `IntersectionObserver`, so a prompt's guard
// (`request-card/prompt-guard.ts`) would find every card out of view. This lays each mounted permission card out in the
// window, one band each in document order, its row of decision buttons (`[data-decision-buttons]`) along the band's
// bottom and topmost at its points; every other element keeps happy-dom's own rectangle. `shift` moves every band (a
// scroll) and fires the intersection observers watching a prompt with the entries the browser would report for it.
import { vi } from 'vitest';

const BAND = 120;
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-decision-buttons]')];
const inside = (r: DOMRect, x: number, y: number) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

interface Watch {
  targets: Element[];
  callback: IntersectionObserverCallback;
  self: IntersectionObserver;
}

export function layOutPrompts(): { shift(by: number): void; restore(): void } {
  let offset = 0;
  const cardAt = (band: number) => new DOMRect(10, offset + 20 + band * BAND, 620, BAND - 10);
  const buttonsAt = (band: number) => new DOMRect(20, offset + 90 + band * BAND, 600, 32);
  // a prompt's card or its buttons, by band; null for any other element
  const laidOut = (element: Element): DOMRect | null => {
    const all = rows();
    const band = all.indexOf(element as HTMLElement);
    if (band >= 0) return buttonsAt(band);
    const card = element.hasAttribute('data-request-card') ? all.findIndex((row) => element.contains(row)) : -1;
    return card >= 0 ? cardAt(card) : null;
  };
  const original = Element.prototype.getBoundingClientRect;
  const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return laidOut(this) ?? original.call(this);
  });
  const own = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
  document.elementFromPoint = (x: number, y: number) => rows().find((_, band) => inside(buttonsAt(band), x, y)) ?? document.body;

  // the page's intersection observers, fired on a shift for the prompts they watch (any other target gets no entry)
  const watches = new Set<Watch>();
  class LaidOutObserver {
    private readonly watch: Watch;
    constructor(callback: IntersectionObserverCallback) {
      this.watch = { targets: [], callback, self: this as unknown as IntersectionObserver };
      watches.add(this.watch);
    }
    observe(target: Element) {
      this.watch.targets.push(target);
    }
    unobserve(target: Element) {
      this.watch.targets = this.watch.targets.filter((t) => t !== target);
    }
    takeRecords = () => [];
    disconnect() {
      watches.delete(this.watch);
    }
  }
  const observer = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = LaidOutObserver as unknown as typeof IntersectionObserver;
  const entryOf = (target: Element, r: DOMRect): IntersectionObserverEntry => {
    const view = new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const [left, top, right, bottom] = [Math.max(r.left, view.left), Math.max(r.top, view.top), Math.min(r.right, view.right), Math.min(r.bottom, view.bottom)];
    const seen = right > left && bottom > top ? new DOMRect(left, top, right - left, bottom - top) : new DOMRect(0, 0, 0, 0);
    const area = (x: DOMRect) => x.width * x.height;
    return { target, boundingClientRect: r, intersectionRect: seen, isIntersecting: area(seen) > 0, intersectionRatio: area(seen) / area(r), rootBounds: view, time: performance.now() } as IntersectionObserverEntry;
  };

  return {
    shift: (by) => {
      offset = by;
      for (const watch of watches) {
        const entries = watch.targets.flatMap((target) => {
          const r = laidOut(target);
          return r === null ? [] : [entryOf(target, r)];
        });
        if (entries.length > 0) watch.callback(entries, watch.self);
      }
    },
    restore: () => {
      spy.mockRestore();
      globalThis.IntersectionObserver = observer;
      if (own) Object.defineProperty(document, 'elementFromPoint', own);
      else delete (document as { elementFromPoint?: unknown }).elementFromPoint;
    },
  };
}
