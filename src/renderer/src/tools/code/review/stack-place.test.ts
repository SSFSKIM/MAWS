// The cost of one scroll of the person's on the stack's placer (UX wave U5b-1's branch panel, its seventh and eighth
// findings; the execution document's "nothing outside the band"): over two hundred files and two thousand hunks, the
// page's reads and measures, the hunks the counter resolves, the rows it reads and the searches over the stack's paths
// are counted, and each is bounded by the band (the bodies drawn near the scroll position, the file at the reading
// edge), not by the scope. The page is built here as the stack draws it (only the bodies near the scroll position drawn,
// every other a spacer of its height) and laid out by arithmetic, since happy-dom lays nothing out. Counts, never time.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reviewLayout } from './measure';
import { StackPlacer, type Band, type PlacedSection } from './stack-place';
import type { StackHunk } from './stack-model';
import type { StackPlace } from './view-state';

const tally = vi.hoisted(() => {
  const counts = { hunks: 0, rows: 0, searches: 0, measures: 0, queries: 0 };
  const SEARCHES = new Set(['indexOf', 'lastIndexOf', 'includes', 'find', 'findIndex', 'findLast', 'findLastIndex']);
  const isIndex = (key: string | symbol) => typeof key === 'string' && /^\d+$/.test(key);
  return {
    counts,
    reset: () => {
      for (const key of Object.keys(counts) as (keyof typeof counts)[]) counts[key] = 0;
    },
    // An array whose element reads are counted under `name`.
    read<T>(items: T[], name: 'hunks' | 'rows'): T[] {
      return new Proxy(items, {
        get(target, key, receiver) {
          if (isIndex(key)) counts[name] += 1;
          return Reflect.get(target, key, receiver);
        },
      });
    },
    // An array whose linear searches are counted.
    searched(items: string[]): string[] {
      return new Proxy(items, {
        get(target, key, receiver) {
          if (typeof key === 'string' && SEARCHES.has(key)) counts.searches += 1;
          return Reflect.get(target, key, receiver);
        },
      });
    },
  };
});

// The stack's layout with its paths searched under count, and every drawn body's rows read under count.
vi.mock('./stack-model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./stack-model')>();
  return {
    ...actual,
    stackLayout: (...args: Parameters<typeof actual.stackLayout>) => {
      const layout = actual.stackLayout(...args);
      return { ...layout, paths: tally.searched(layout.paths) };
    },
  };
});
vi.mock('./stack-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./stack-dom')>();
  return {
    ...actual,
    rowsOf: (body: HTMLElement) => {
      const rows = actual.rowsOf(body);
      return rows && tally.read(rows, 'rows');
    },
  };
});

const HEADER = 30;
const ROW = 20;
const VIEWPORT = 400;
const HUNKS = 10; // per file
const LINES = 3; // per hunk, under its header row
const ROWS = HUNKS * (1 + LINES); // a file's drawn table rows
const BAND = 2; // viewports above and below the viewport the stack draws

interface Page {
  el: HTMLElement;
  sections: PlacedSection[];
  order: StackHunk[];
  drawn: number; // bodies drawn
  tops: number[]; // each section's top in the scroller
  heights: Map<Element, number>; // as the page lays them out
  offsets: Map<Element, number>; // a row's top in its body
}

// A stack of `files` files, each `HUNKS` hunks, scrolled to `at`: the bodies within the band drawn, the rest spacers.
// Each file's header is `headerOf(file)` high (a held file's has a second line).
function pageOf(files: number, at: number, headerOf: (file: number) => number = () => HEADER): Page {
  const heights = new Map<Element, number>();
  const offsets = new Map<Element, number>();
  const el = document.createElement('div');
  el.setAttribute('data-review-stack', '');
  const sections: PlacedSection[] = [];
  const order: StackHunk[] = [];
  const tops: number[] = [];
  let top = 0;
  let drawn = 0;
  for (let f = 0; f < files; f++) {
    const path = `src/part-${String(f).padStart(3, '0')}.ts`;
    const body = ROWS * ROW;
    const section = document.createElement('section');
    section.dataset.reviewFile = path;
    tops.push(top);
    const header = document.createElement('div');
    header.setAttribute('data-review-file-header', '');
    heights.set(header, headerOf(f));
    section.append(header);
    const bodyTop = top + headerOf(f);
    if (bodyTop <= at + VIEWPORT + BAND * VIEWPORT && bodyTop + body >= at - BAND * VIEWPORT) {
      drawn += 1;
      const box = document.createElement('div');
      box.setAttribute('data-review-body', '');
      const block = document.createElement('div');
      block.dataset.reviewBlock = '0';
      const table = document.createElement('table');
      const tbody = document.createElement('tbody');
      let row = 0;
      for (let h = 0; h < HUNKS; h++) {
        const head = document.createElement('tr');
        head.dataset.state = 'hunk';
        const rows = [head];
        for (let line = 0; line < LINES; line++) {
          const tr = document.createElement('tr');
          const cell = document.createElement('td');
          cell.dataset.lineNewNum = String(1 + h * 10 + line);
          tr.append(cell);
          rows.push(tr);
        }
        for (const tr of rows) {
          heights.set(tr, ROW);
          offsets.set(tr, row * ROW);
          row += 1;
          tbody.append(tr);
        }
      }
      table.append(tbody);
      block.append(table);
      box.append(block);
      heights.set(box, body);
      section.append(box);
    } else {
      const spacer = document.createElement('div');
      spacer.setAttribute('data-review-spacer', '');
      heights.set(spacer, body);
      section.append(spacer);
    }
    el.append(section);
    sections.push({ path, folded: false, lines: ROWS });
    for (let h = 0; h < HUNKS; h++) order.push({ path, index: h, block: 0, anchor: { side: 'new', line: 1 + h * 10 } });
    top += headerOf(f) + body;
  }
  const total = top;
  let scrollTop = at;
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => VIEWPORT });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => total });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      const next = Math.max(0, Math.min(value, total - VIEWPORT));
      if (next === scrollTop) return;
      scrollTop = next;
      el.dispatchEvent(new Event('scroll'));
    },
  });
  document.body.append(el);
  vi.spyOn(reviewLayout, 'height').mockImplementation((element) => {
    tally.counts.measures += 1;
    return heights.get(element) ?? 0;
  });
  vi.spyOn(reviewLayout, 'offsetWithin').mockImplementation((element) => {
    tally.counts.measures += 1;
    return offsets.get(element) ?? 0;
  });
  return { el, sections, order, drawn, tops, heights, offsets };
}

// Every query the page answers (its own and its elements'), counted.
function countQueries(): void {
  for (const name of ['querySelector', 'querySelectorAll', 'closest'] as const) {
    let owner: object | null = HTMLElement.prototype;
    while (owner && !Object.prototype.hasOwnProperty.call(owner, name)) owner = Object.getPrototypeOf(owner);
    const original = (owner as Record<string, (...args: unknown[]) => unknown>)[name];
    vi.spyOn(owner as Record<string, (...args: unknown[]) => unknown>, name).mockImplementation(function (this: unknown, ...args: unknown[]) {
      tally.counts.queries += 1;
      return original.apply(this, args);
    });
  }
}

// The placer over the page, laid out once (a layout change: the page found and measured whole), then the person's
// scroll of `by` pixels, counted alone.
function scrollOnce(page: Page, by: number) {
  const handed: { band: Band | null } = { band: null };
  const placer = new StackPlacer({ band: (band) => void (handed.band = band), saved: () => {}, counted: () => {} });
  page.el.addEventListener('scroll', () => placer.scrolled());
  placer.update({ sections: page.sections, order: tally.read(page.order, 'hunks'), current: 0 });
  placer.attach(page.el, null);
  placer.relayout();
  if (handed.band) placer.drawn(handed.band);
  tally.reset();
  placer.interact(); // the person's wheel
  page.el.scrollTop += by;
  return { ...tally.counts };
}

// The placer over the page standing at `at`: its first layout reads the place there; a second, with nothing changed,
// stands that place again. Where the scroller stands after it.
function readThenStand(page: Page): number {
  const placer = new StackPlacer({ band: () => {}, saved: () => {}, counted: () => {} });
  page.el.addEventListener('scroll', () => placer.scrolled());
  placer.update({ sections: page.sections, order: page.order, current: 0 });
  placer.attach(page.el, null);
  placer.relayout();
  placer.relayout();
  return page.el.scrollTop;
}

// The branch's task review (finding 2's handoff): a sticky header is pushed off by the next section's, so the edge
// under the header standing at the top passes from one file to the next; the place read anywhere in that handoff, and
// stood again with nothing changed, is where the scroller was.
describe('the place read where one file’s header hands over to the next', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  for (const [from, to] of [
    [58, 30],
    [30, 58],
  ] as const) {
    it(`stands again where it was read, from a ${from} px header to a ${to} px one`, () => {
      const headers = (file: number) => (file === 0 ? from : to);
      const boundary = from + ROWS * ROW; // the second file's top
      const stood: { at: number; stood: number }[] = [];
      for (let at = boundary - 80; at <= boundary + 40; at++) {
        document.body.replaceChildren();
        const page = pageOf(3, at, headers);
        expect(page.tops[1]).toBe(boundary);
        expect(page.el.scrollTop).toBe(at);
        stood.push({ at, stood: readThenStand(page) });
      }
      expect(stood.filter(({ at, stood }) => stood !== at)).toEqual([]);
    });
  }
});

// The architect's review (its second finding): a card opened on a line in view, its exposure waiting for the card to
// draw under the line; the person presses ↑ in the toolbar (outside the scroller, so no input there) before it draws.
describe('a card’s exposure and the person’s navigation', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('leaves the hunk the person jumped to at the top when the card opened before the jump draws: no scroll, the place the jump’s', () => {
    const page = pageOf(3, 0);
    const saved: StackPlace[] = [];
    // every band handed is drawn at once, as the stack's commit draws it
    const placer: StackPlacer = new StackPlacer({ band: (band) => placer.drawn(band), saved: (place) => saved.push(place), counted: () => {} });
    page.el.addEventListener('scroll', () => placer.scrolled());
    placer.update({ sections: page.sections, order: page.order, current: 0 });
    placer.attach(page.el, null);
    placer.relayout();
    placer.interact(); // the person's wheel, to the first file's sixth hunk
    page.el.scrollTop = 5 * (1 + LINES) * ROW;
    const hunkRow = (h: number) => page.el.querySelector(`[data-review-file="src/part-000.ts"] [data-line-new-num="${1 + h * 10}"]`)!.closest('tr')!;
    // the card opened on the ninth hunk's first line, in view: no reveal, its exposure waits for the card
    const line = { path: 'src/part-000.ts', row: { block: 0, side: 'new' as const, line: 1 + 8 * 10 }, offset: 0 };
    placer.showCard(line);
    placer.relayout();
    placer.revealHunk(page.order[4]); // ↑, to the fifth hunk
    placer.relayout(); // the commit after it: the jump reached
    expect(page.el.scrollTop).toBe(4 * (1 + LINES) * ROW); // its header row and first line under the file’s header
    // the card draws under its line, 160 px high: a layout change
    const widget = document.createElement('tr');
    widget.dataset.state = 'widget';
    widget.innerHTML = '<td><div data-review-card-row="new:81"><div data-comment-card></div></div></td>';
    hunkRow(8).after(widget);
    page.heights.set(widget, 160);
    page.offsets.set(widget, page.offsets.get(hunkRow(8))! + ROW);
    const body = page.el.querySelector('[data-review-file="src/part-000.ts"] [data-review-body]')!;
    page.heights.set(body, page.heights.get(body)! + 160);
    let scrolls = 0;
    page.el.addEventListener('scroll', () => scrolls++);
    saved.length = 0;
    placer.relayout();
    expect({ scrolls, scrollTop: page.el.scrollTop, saved }).toEqual({ scrolls: 0, scrollTop: 4 * (1 + LINES) * ROW, saved: [] });
  });
});

describe('one scroll of the person’s on the stack', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  // The seventh finding: the sections are found and their headers measured at a layout change, and kept through a scroll.
  it('reads and measures the page within the band: two hundred files cost what twenty do, and no header is measured', () => {
    countQueries();
    const at = 3_000;
    const wide = pageOf(200, at);
    const many = scrollOnce(wide, 2 * ROW);
    document.body.replaceChildren();
    const narrow = pageOf(20, at);
    const few = scrollOnce(narrow, 2 * ROW);
    expect(wide.drawn).toBe(narrow.drawn); // the same band
    expect({ measures: many.measures, queries: many.queries }).toEqual({ measures: few.measures, queries: few.queries });
    // The drawn bodies' heights, and the rows of the file at the reading edge (each its top and height); per body a
    // few queries for whether it has settled, per row a few for its lines.
    expect(many.measures).toBeLessThanOrEqual(wide.drawn + 2 * ROWS);
    expect(many.queries).toBeLessThanOrEqual(4 * wide.drawn + 4 * ROWS + 8);
  });

  // The eighth finding: the counter resolves the hunks of the file at the reading edge alone, each row by its index.
  it('resolves the hunks of the file at the reading edge alone, of two thousand: no hunk of another file, no search over the paths', () => {
    const page = pageOf(200, 3_000);
    expect(page.order).toHaveLength(2_000);
    const counted = scrollOnce(page, 2 * ROW);
    // The first hunk of the edge's file found by halving, then its own hunks.
    expect(counted.hunks).toBeLessThanOrEqual(HUNKS + 2 * Math.ceil(Math.log2(page.order.length + 1)) + 2);
    // The rows of the file at the edge: once for the place read there, once for their index.
    expect(counted.rows).toBeLessThanOrEqual(2 * ROWS);
    expect(counted.searches).toBe(0);
  });
});
