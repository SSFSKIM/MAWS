// Review's stack laid out for happy-dom, which lays nothing out (UX wave U5b, M4): the stack's one measure seam
// (`reviewLayout`) answers from a model of the drawn page, its scroller scrolls within a clamped height and reports each
// change of its offset as a browser does, and a ResizeObserver reports every element it watches when the test lets the
// page settle. When the page shrinks under the scroller, the browser's clamp is reported as a browser does it: a scroll
// event of its own, at the next turn and before the observers, with no input before it. The model is one column:
// sections one under the other, a header over a body or a spacer (a header `header` high, and `changed` more while it
// holds a held file's "This file changed · Refresh" line), a body as tall as its diff rows (or one line of words when it
// holds no table), each row `row` high or as `rowOf` says for its file, a widget row (a comment's card) and an extend row
// (unsent comments) as high as the options say. The header standing at the scroller's top is the one of the section
// there, and the person reads the row just under it.
// Unified rows only: Split's two tables side by side are not modelled. Imported only by happy-dom suites.
import { act } from '@testing-library/react';
import { vi } from 'vitest';
import { reviewLayout } from '../tools/code/review/measure';

export interface StackLayoutOptions {
  viewport: number; // the scroller's height
  width?: number; // the stack's width (720)
  header?: number; // a section's header (30)
  changed?: number; // the line a held file's header gains, "This file changed · Refresh" (28; UX wave U5b, M5)
  row?: number; // a diff row (20)
  note?: number; // a body of words: "Loading", "Binary file" (24)
  widget?: number; // the library's widget row under a line, holding a comment's card (160; UX wave U5b, M5)
  extend?: number; // an extend row under a line, holding unsent comments (32)
}

export interface StackPageRow {
  path: string;
  side: 'old' | 'new';
  line: number;
}

const SCROLLER = '[data-review-stack]';

export function fakeStackLayout(options: StackLayoutOptions) {
  const header = options.header ?? 30;
  const note = options.note ?? 24;
  let width = options.width ?? 720;
  let zoom = 1;
  let rowOf: (path: string, width: number) => number = () => options.row ?? 20;

  const sectionOf = (el: Element) => el.closest<HTMLElement>('[data-review-file]');
  const pathOf = (el: Element) => sectionOf(el)?.dataset.reviewFile ?? '';
  const headerOf = (section: Element) => (header + (section.querySelector(':scope > [data-review-file-header] [data-review-file-changed]') ? (options.changed ?? 28) : 0)) * zoom;
  const trsOf = (body: Element) => [...body.querySelectorAll('tr')];
  const rowHeight = (tr: Element) => {
    const state = (tr as HTMLElement).dataset.state;
    return (state === 'widget' ? (options.widget ?? 160) : state === 'extend' ? (options.extend ?? 32) : rowOf(pathOf(tr), width)) * zoom;
  };
  const bodyHeight = (body: Element) => {
    const trs = trsOf(body);
    return trs.length > 0 ? trs.reduce((sum, tr) => sum + rowHeight(tr), 0) : note * zoom;
  };
  const spacerHeight = (spacer: HTMLElement) => Number.parseFloat(spacer.style.height) || 0;
  const partsOf = (section: Element) => ({
    body: section.querySelector(':scope > [data-review-body]'),
    spacer: section.querySelector<HTMLElement>(':scope > [data-review-spacer]'),
  });
  const sectionHeight = (section: Element) => {
    const { body, spacer } = partsOf(section);
    return headerOf(section) + (body ? bodyHeight(body) : spacer ? spacerHeight(spacer) : 0);
  };
  const scroller = () => document.querySelector<HTMLElement>(SCROLLER);
  const sections = () => [...(scroller()?.querySelectorAll(':scope > [data-review-file]') ?? [])];

  function height(el: Element): number {
    if (el.matches('[data-review-file]')) return sectionHeight(el);
    if (el.matches('[data-review-file-header]')) return headerOf(sectionOf(el)!);
    if (el.matches('[data-review-body]')) return bodyHeight(el);
    if (el.matches('[data-review-spacer]')) return spacerHeight(el as HTMLElement);
    if (el.tagName === 'TR') return rowHeight(el);
    return 0;
  }

  // An element's top in the scroller's content.
  function topOf(el: Element): number {
    const section = sectionOf(el);
    if (!section) return 0;
    let top = 0;
    for (const other of sections()) {
      if (other === section) break;
      top += sectionHeight(other);
    }
    if (el === section || el.matches('[data-review-file-header]')) return top;
    top += headerOf(section);
    const body = el.closest('[data-review-body]');
    if (!body || el === body || el.tagName !== 'TR') return top;
    for (const tr of trsOf(body)) {
      if (tr === el) break;
      top += rowHeight(tr);
    }
    return top;
  }

  const scrollHeight = () => sections().reduce((sum, section) => sum + sectionHeight(section), 0);
  const tops = new WeakMap<Element, number>();
  const maxTop = () => Math.max(0, scrollHeight() - options.viewport);

  vi.spyOn(reviewLayout, 'height').mockImplementation(height);
  // The diff library draws a widget or an extend row only where its table's wrapper has a width (M5).
  const rect = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.matches('.unified-diff-table-wrapper, .old-diff-table-wrapper, .new-diff-table-wrapper') ? ({ x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, width, height: 0, toJSON: () => ({}) } as DOMRect) : rect.call(this);
  });
  vi.spyOn(reviewLayout, 'offsetWithin').mockImplementation((el, container) => topOf(el) - topOf(container));
  vi.spyOn(reviewLayout, 'width').mockImplementation((el) => (el.matches('[data-review], [data-review-stack]') ? width : 0));

  // The scroller's own properties, for the element that is the stack's scroller, whenever it is drawn.
  const restores: (() => void)[] = [];
  function override(name: 'scrollTop' | 'scrollHeight' | 'clientHeight', get: (el: Element) => number, set?: (el: Element, value: number) => void) {
    let proto: object | null = HTMLElement.prototype;
    let found: PropertyDescriptor | undefined;
    while (proto && !(found = Object.getOwnPropertyDescriptor(proto, name))) proto = Object.getPrototypeOf(proto);
    const original = found;
    const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: Element) {
        return this.matches(SCROLLER) ? get(this) : original?.get?.call(this);
      },
      set(this: Element, value: number) {
        if (this.matches(SCROLLER) && set) set(this, value);
        else original?.set?.call(this, value);
      },
    });
    restores.push(() => (own ? Object.defineProperty(HTMLElement.prototype, name, own) : delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]));
  }
  override('clientHeight', () => options.viewport);
  override('scrollHeight', scrollHeight);
  override(
    'scrollTop',
    (el) => Math.min(tops.get(el) ?? 0, maxTop()),
    (el, value) => {
      const next = Math.max(0, Math.min(value, maxTop()));
      if (next === Math.min(tops.get(el) ?? 0, maxTop())) return;
      tops.set(el, next);
      el.dispatchEvent(new Event('scroll'));
    },
  );

  // Every observer is told about every element it watches when the page settles, as a browser reports a box that moved.
  const observers = new Set<{ callback: ResizeObserverCallback; targets: Set<Element> }>();
  class FakeResizeObserver {
    private readonly entry: { callback: ResizeObserverCallback; targets: Set<Element> };
    constructor(callback: ResizeObserverCallback) {
      this.entry = { callback, targets: new Set() };
      observers.add(this.entry);
    }
    observe(target: Element) {
      this.entry.targets.add(target);
    }
    unobserve(target: Element) {
      this.entry.targets.delete(target);
    }
    disconnect() {
      this.entry.targets.clear();
      observers.delete(this.entry);
    }
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  // The browser's clamp of a scroller left past its end by a page that shrank.
  let clamps = 0;
  const clamp = () =>
    act(() => {
      const el = scroller();
      if (!el || (tops.get(el) ?? 0) <= maxTop()) return;
      tops.set(el, maxTop());
      clamps++;
      el.dispatchEvent(new Event('scroll'));
    });
  const flush = () =>
    act(() => {
      for (const { callback, targets } of [...observers]) {
        const live = [...targets].filter((target) => target.isConnected);
        if (live.length > 0) callback(live.map((target) => ({ target, contentRect: { width, height: height(target) } }) as unknown as ResizeObserverEntry), {} as ResizeObserver);
      }
    });

  return {
    scroller: () => scroller()!,
    topOf,
    height,
    // Turns of the event loop (the fake main's answers, the library drawing its rows), each followed by the observers.
    async settle(turns = 25): Promise<void> {
      for (let turn = 0; turn < turns; turn++) {
        await act(() => new Promise<void>((resolve) => setImmediate(resolve)));
        clamp();
        flush();
      }
    },
    // The person's scroll: a wheel, then the offset.
    scrollTo(top: number) {
      const el = scroller()!;
      act(() => {
        el.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
        el.scrollTop = top;
      });
    },
    // A scroll the browser makes whose event is still queued: the offset moves now, its event comes at `fire()`, so a
    // layout change can be applied in between.
    scrollQueued(top: number): () => void {
      const el = scroller()!;
      tops.set(el, Math.max(0, Math.min(top, maxTop())));
      return () => act(() => void el.dispatchEvent(new Event('scroll')));
    },
    setWidth(next: number) {
      width = next;
    },
    setZoom(next: number) {
      zoom = next;
    },
    setRows(next: (path: string, width: number) => number) {
      rowOf = next;
    },
    header: () => header * zoom,
    headerOf: (path: string) => headerOf(sections().find((section) => (section as HTMLElement).dataset.reviewFile === path)!), // as drawn now
    clamped: () => clamps, // the clamps the browser reported
    // The diff row the person reads at the top: the first under the sticky header (a hunk's header row reads as the
    // hunk's first row, under it).
    rowAtTop(): StackPageRow | null {
      const el = scroller();
      if (!el) return null;
      const scrollTop = el.scrollTop;
      let at: Element | null = null; // the section at the scroller's top, whose header stands there
      let from = 0;
      for (const section of sections()) {
        if (from > scrollTop) break;
        at = section;
        from += sectionHeight(section);
      }
      const edge = scrollTop + (at ? headerOf(at) : header * zoom);
      const trs = [...el.querySelectorAll<HTMLElement>('[data-review-body] tr')];
      for (let index = 0; index < trs.length; index++) {
        const top = topOf(trs[index]);
        if (edge < top || edge >= top + rowHeight(trs[index])) continue;
        const tr = trs[index].dataset.state === 'hunk' ? trs[index + 1] : trs[index];
        if (!tr) return null;
        const neu = tr.querySelector<HTMLElement>('[data-line-new-num]')?.dataset.lineNewNum;
        const old = tr.querySelector<HTMLElement>('[data-line-old-num]')?.dataset.lineOldNum;
        if (!neu && !old) return null;
        return { path: pathOf(tr), side: neu ? 'new' : 'old', line: Number(neu ?? old) };
      }
      return null;
    },
    restore() {
      restores.splice(0).forEach((undo) => undo());
    },
  };
}

export type FakeStackLayout = ReturnType<typeof fakeStackLayout>;
