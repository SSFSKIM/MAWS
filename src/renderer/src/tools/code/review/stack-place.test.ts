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
}

// A stack of `files` files, each `HUNKS` hunks, scrolled to `at`: the bodies within the band drawn, the rest spacers.
function pageOf(files: number, at: number): Page {
  const heights = new Map<Element, number>();
  const offsets = new Map<Element, number>();
  const el = document.createElement('div');
  el.setAttribute('data-review-stack', '');
  const sections: PlacedSection[] = [];
  const order: StackHunk[] = [];
  let top = 0;
  let drawn = 0;
  for (let f = 0; f < files; f++) {
    const path = `src/part-${String(f).padStart(3, '0')}.ts`;
    const body = ROWS * ROW;
    const section = document.createElement('section');
    section.dataset.reviewFile = path;
    const header = document.createElement('div');
    header.setAttribute('data-review-file-header', '');
    heights.set(header, HEADER);
    section.append(header);
    const bodyTop = top + HEADER;
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
    top += HEADER + body;
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
  return { el, sections, order, drawn };
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
