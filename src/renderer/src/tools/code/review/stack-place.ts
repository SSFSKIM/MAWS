// The band and the place on the drawn stack (UX wave U5b, M4; the execution document's §F, decisions 6 to 8): one per
// mounted stack, fed by the scroller's own events (its scroll, the person's input, a layout change: a commit, or a
// ResizeObserver reporting a body, a header or the scroller) and answering what the stack draws (the band) and where its
// scroller stands. The place has two parts and no third: the live place, always kept, read after every scroll the person
// makes and applied again at every layout change; and at most one outstanding reveal (the saved place after a mount, a
// requested file's top, a hunk jump's row), applied instead of the live place until it is reached or the person's input
// cancels it. Positions are the model's (`stack-model.ts`) over the measures of the page (`stack-dom.ts`), so the band
// and the place read the same offsets. No React here.
//
// The reading edge is the scroller's top under the sticky header: what the person reads is the row just below the
// header that stays at the top, so a place names that row, and a hunk jumped to stands there.
import { reviewLayout } from './measure';
import { drawnSections, rowsOf, settled } from './stack-dom';
import { bandOf, hunkPlace, placeAt, stackLayout, topOfPlace, type RowsOf, type StackHunk, type StackLayout, type StackRow } from './stack-model';
import type { StackPlace } from './view-state';

// A header not measured yet (`h-8`).
export const HEADER_PX = 32;

// What the stack draws: the bodies inside the band, the sections whose header lies inside it (a marked file is read
// there to learn whether its mark holds), and each unfolded section outside it as a spacer of this height.
export interface Band {
  drawn: ReadonlySet<string>;
  near: ReadonlySet<string>;
  spacers: ReadonlyMap<string, number>;
}
export const EMPTY_BAND: Band = { drawn: new Set(), near: new Set(), spacers: new Map() };

// A section as the placer weighs it.
export interface PlacedSection {
  path: string;
  folded: boolean;
  lines: number; // its body's rows for an estimate; 0: it draws no body
}

export interface PlacerInput {
  sections: readonly PlacedSection[];
  order: readonly StackHunk[]; // the hunks the counter counts
  current: number; // the counter's hunk
}

export interface PlacerHost {
  band(next: Band): void; // the band changed: draw it
  saved(place: StackPlace): void; // the place in force, for `places`
  counted(index: number): void; // the person's scroll moved the counter
}

interface Measured {
  el: HTMLElement;
  laidOut: boolean;
  viewport: number;
  layout: StackLayout;
  rows: RowsOf;
  sticky: number; // the header that stays at the top
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((item) => b.has(item));
const sameMap = (a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>) => a.size === b.size && [...a].every(([key, value]) => b.get(key) === value);
const sameBand = (a: Band, b: Band) => sameSet(a.drawn, b.drawn) && sameSet(a.near, b.near) && sameMap(a.spacers, b.spacers);
const atEnd = (el: HTMLElement) => el.scrollTop >= el.scrollHeight - el.clientHeight - 1;

export class StackPlacer {
  private scroller: HTMLElement | null = null;
  private input: PlacerInput = { sections: [], order: [], current: 0 };
  private readonly headers = new Map<string, number>(); // measured, by path
  private readonly bodies = new Map<string, number>(); // last measured while drawn, by path
  private band: Band = EMPTY_BAND;
  private pending = false; // a band handed to the host and not drawn yet: the page lags the model
  private live: StackPlace | null = null;
  // The outstanding reveal: a place, or a requested file's section at the scroller's top (`top`), whatever its header
  // measures when it is applied.
  private reveal: { place: StackPlace; top?: true } | null = null;
  private own: number | null = null; // the offset the stack last put its scroller at: a scroll event there is its own

  constructor(private readonly host: PlacerHost) {}

  // Mounted: a saved place for this key is the first reveal.
  attach(scroller: HTMLElement, saved: StackPlace | null): void {
    this.scroller = scroller;
    this.reveal = saved ? { place: saved } : null;
  }

  // Unmounted: the place then in force (a reveal reached became the live place).
  detach(): StackPlace | null {
    this.scroller = null;
    return this.live;
  }

  update(input: PlacerInput): void {
    this.input = input;
  }

  // The host drew the band it was handed.
  drawn(): void {
    this.pending = false;
  }

  // A request that named a file: that section's top at the scroller's top.
  revealSection(path: string): void {
    this.reveal = { place: { path, row: null, offset: 0 }, top: true };
    this.relayout();
  }

  // ↑ or ↓: the hunk's first row at the reading edge.
  revealHunk(hunk: StackHunk): void {
    this.reveal = { place: hunkPlace(hunk) };
    this.relayout();
  }

  // The person's wheel, touch, key or pointer inside the scroller: an outstanding reveal ends; the live place stands
  // until the scroll that follows.
  cancel(): void {
    this.reveal = null;
  }

  // A scroll event: the stack's own is ignored; the person's is read as the live place, and moves the counter.
  scrolled(): void {
    const el = this.scroller;
    if (!el) return;
    if (this.own !== null && Math.abs(el.scrollTop - this.own) < 1) return;
    this.own = null;
    this.reveal = null; // a scroll the stack did not make is the person's, with or without an input event before it
    const m = this.measure();
    if (!m) return;
    this.live = placeAt(m.layout, el.scrollTop + m.sticky, m.rows);
    if (this.live) this.host.saved(this.live);
    this.count(m);
    this.setBand(this.bandFor(m, el.scrollTop));
  }

  // A layout change: the reveal, else the live place, applied again under the heights the page now has.
  relayout(): void {
    const m = this.measure();
    if (!m) return;
    if (!m.laidOut) {
      this.setBand(this.bandFor(m, m.el.scrollTop));
      return;
    }
    const { el, layout, rows, sticky } = m;
    const reveal = this.reveal;
    const at = reveal ? topOfPlace(layout, reveal.place, rows) : null;
    if (reveal && at === null) this.reveal = null; // its file left the stack: the live place stands
    if (reveal && at !== null) {
      // A section folded is not reached yet: the jump that unfolds it draws it next.
      const exact = at.exact && !this.input.sections.find((section) => section.path === reveal.place.path)?.folded;
      const want = Math.max(0, reveal.top || !exact ? at.top : at.top - sticky);
      this.write(el, want);
      this.live = placeAt(layout, el.scrollTop + sticky, rows);
      const band = this.bandFor(m, el.scrollTop);
      const lags = this.pending || !sameBand(band, this.band);
      if (exact && !lags && (Math.abs(el.scrollTop - want) < 1 || (want > el.scrollTop && atEnd(el)))) {
        this.reveal = null; // reached: the place reached is the live place
        if (this.live) this.host.saved(this.live);
      }
      this.setBand(band);
      return;
    }
    if (this.live === null) this.live = placeAt(layout, el.scrollTop + sticky, rows);
    else {
      const target = topOfPlace(layout, this.live, rows);
      if (target !== null) this.write(el, Math.max(0, target.top - sticky));
      // A place read where its file was not drawn yet names no row; once the file draws, the row at the same spot is
      // read, so the place survives what moves inside the file from then on.
      if (target !== null && this.live.row === null && !this.pending && this.drawsRows(layout, this.live.path, rows)) {
        this.live = placeAt(layout, el.scrollTop + sticky, rows);
        if (this.live) this.host.saved(this.live);
      }
    }
    this.setBand(this.bandFor(m, el.scrollTop));
  }

  // ---- the page --------------------------------------------------------------------------------------------------------

  // The measures of the page now (kept only while it is laid out: a hidden or collapsed scroller measures nothing), the
  // model's layout from them, and the drawn rows of each body, read once per layout.
  private measure(): Measured | null {
    const el = this.scroller;
    if (!el) return null;
    const viewport = el.clientHeight;
    const laidOut = viewport > 0;
    const dom = drawnSections(el);
    // A drawn body weighs what the page shows, settled or not, so the model is the page; only a settled body's height
    // is kept for the spacer that stands for it later.
    const shown = new Map<string, number>();
    if (laidOut)
      for (const [path, { header, body }] of dom) {
        if (header) this.headers.set(path, reviewLayout.height(header));
        if (!body) continue;
        const height = reviewLayout.height(body);
        shown.set(path, height);
        if (settled(body)) this.bodies.set(path, height);
      }
    const layout = stackLayout(
      this.input.sections.map((section) => ({
        path: section.path,
        header: this.headers.get(section.path) ?? HEADER_PX,
        body: section.lines === 0 ? 0 : (shown.get(section.path) ?? this.bodies.get(section.path) ?? null),
        lines: section.lines,
        folded: section.folded,
      })),
    );
    const cache = new Map<number, StackRow[] | null>();
    const rows: RowsOf = (index) => {
      if (!laidOut) return null;
      if (!cache.has(index)) {
        const body = dom.get(layout.paths[index])?.body;
        cache.set(index, body ? rowsOf(body) : null);
      }
      return cache.get(index)!;
    };
    const sticky = layout.tops.length > 0 ? layout.bodyTops[0] - layout.tops[0] : 0;
    return { el, laidOut, viewport, layout, rows, sticky };
  }

  private drawsRows(layout: StackLayout, path: string, rows: RowsOf): boolean {
    const index = layout.paths.indexOf(path);
    return index >= 0 && (rows(index)?.length ?? 0) > 0;
  }

  // The band around a scroll position. A scroller not laid out yet is taken as tall as the window, so the work stays
  // bounded before the first layout.
  private bandFor({ laidOut, viewport, layout }: Measured, scrollTop: number): Band {
    const height = laidOut ? viewport : window.innerHeight;
    const drawn = new Set([...bandOf(layout.bodyTops, layout.bodies, scrollTop, height)].map((index) => layout.paths[index]));
    const headers = layout.tops.map((top, index) => layout.bodyTops[index] - top);
    const near = new Set([...bandOf(layout.tops, headers, scrollTop, height)].map((index) => layout.paths[index]));
    const spacers = new Map<string, number>();
    layout.paths.forEach((path, index) => {
      const body = layout.bodies[index];
      if (body !== null && !drawn.has(path)) spacers.set(path, body);
    });
    return { drawn, near, spacers };
  }

  private setBand(next: Band): void {
    if (sameBand(next, this.band)) return;
    this.band = next;
    this.pending = true;
    this.host.band(next);
  }

  // The scroller put at an offset, within what it can reach; its scroll event is then known as the stack's own.
  private write(el: HTMLElement, top: number): void {
    const next = Math.min(top, Math.max(0, el.scrollHeight - el.clientHeight));
    if (Math.abs(next - el.scrollTop) >= 1) {
      this.own = next;
      el.scrollTop = next;
    }
    this.own = el.scrollTop;
  }

  // The hunk at the reading edge (the first before any has scrolled past); at the end of the scroller a later hunk
  // jumped to stands.
  private count({ el, layout, rows, sticky }: Measured): void {
    const { order, current } = this.input;
    let at = 0;
    order.forEach((hunk, index) => {
      const stop = topOfPlace(layout, hunkPlace(hunk), rows);
      if (stop !== null && stop.top - sticky <= el.scrollTop + 4) at = index;
    });
    if (at < current && atEnd(el)) return;
    if (at !== current) this.host.counted(at);
  }
}
