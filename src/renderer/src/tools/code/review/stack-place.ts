// The band and the place on the drawn stack (UX wave U5b, M4; the execution document's §F, decisions 6 to 8): one per
// mounted stack, fed by the scroller's own events (its scroll, the person's input, a layout change: a commit, or a
// ResizeObserver reporting a body, a header or the scroller) and answering what the stack draws (the band) and where its
// scroller stands. The place has two parts and no third: the live place, always kept, read after every scroll the person
// makes and applied again at every layout change; and at most one outstanding reveal (the saved place after a mount, a
// requested file's top, a hunk jump's row, the line of a card opened where the stack draws nothing), applied instead of the live place until it is reached or the person's input
// cancels it. The live place changes in three ways only: the person's scroll, read where it lands; a reveal cancelled by
// the person's input, read where the reveal left the scroller; a reveal reached, the place it reached. A reveal still
// out never moves it, so the place saved at an unmount is the one in force (a saved place restored at a mount is the
// live place from the start). Each of the three reads the hunk counter again where the place now is. A scroll event is
// the person's only during their gesture (a wheel, touch, key or pointer press in the scroller, and a moment after); any
// other the stack did not make is a layout change. A scroll that comes under a layout not measured yet (the page's
// height or the scroller's changed since) is that layout change first: the browser's clamp of a page that shrank under
// it is nothing more, and the person's own scroll is their movement from the place the layout change holds. Positions
// are the model's (`stack-model.ts`) over the measures of the page (`stack-dom.ts`), so the band and the place read the
// same offsets. No React here.
//
// The reading edge is the scroller's top under the sticky header: what the person reads is the row just below the
// header that stays at the top, so a place names that row, and a hunk jumped to stands there. The header is the one of
// the section the place is in (a held file's has a second row); where the next section's header pushes it off, the edge
// crosses the incoming header (`edgeAt`), so every edge has one scroll position and a place stands where it was read.
//
// The cost of a scroll is the band's, not the scope's: the sections are found and their headers measured at a layout
// change and kept until the next (a scroll changes neither); a scroll measures the drawn bodies and reads the rows of the
// file at the reading edge, and the counter resolves that file's hunks alone, each row found by its index.
import { reviewLayout } from './measure';
import { drawnSections, rowsOf, settled, type DrawnSection } from './stack-dom';
import { bandOf, edgeAt, hunkPlace, placeAt, rowOf, scrollTopAt, sectionAt, stackLayout, topOfPlace, type RowsOf, type StackHunk, type StackLayout, type StackRow } from './stack-model';
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
}

// The page as last found at a layout change: its sections by path, the drawn bodies among them, and the heights of the
// scroller's content and viewport then (a scroll under other heights comes after a layout change not measured yet).
interface Found {
  sections: Map<string, DrawnSection>;
  bodies: [string, HTMLElement][];
  height: number;
  viewport: number;
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((item) => b.has(item));
const sameMap = (a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>) => a.size === b.size && [...a].every(([key, value]) => b.get(key) === value);
const sameBand = (a: Band, b: Band) => sameSet(a.drawn, b.drawn) && sameSet(a.near, b.near) && sameMap(a.spacers, b.spacers);
const atEnd = (el: HTMLElement) => el.scrollTop >= el.scrollHeight - el.clientHeight - 1;

// How long after the person's last input a scroll event is still theirs: the browser's animation of a key's or a
// wheel's scroll, or the scroll that follows a pointer released over the scroll bar. Momentum on a trackpad keeps sending
// wheel events, and a pointer held down keeps the gesture until it is released.
const GESTURE_MS = 500;

export class StackPlacer {
  private scroller: HTMLElement | null = null;
  private input: PlacerInput = { sections: [], order: [], current: 0 };
  private readonly headers = new Map<string, number>(); // measured, by path
  private readonly bodies = new Map<string, number>(); // last measured while drawn, by path
  private band: Band = EMPTY_BAND;
  private pending = false; // a band handed to the host and not drawn yet: the page lags the model
  private found: Found | null = null;
  private at = 0; // the scroller's offset when the stack last read or set it: a scroll of the person's moves from here
  private live: StackPlace | null = null;
  // The outstanding reveal: a place, or a requested file's section at the scroller's top (`top`), whatever its header
  // measures when it is applied.
  private reveal: { place: StackPlace; top?: true } | null = null;
  private own: number | null = null; // the offset the stack last put its scroller at: a scroll event there is its own
  private gesture = -Infinity; // when the person's last input in the scroller came
  private pressed = false; // a pointer held down in the scroller (a drag of its scroll bar)
  private recount = false; // the counter was last read where a file's rows were not drawn yet
  private card: StackPlace | null = null; // the line of a card opened and not drawn under it yet
  private inputs = 0; // the person's inputs in the scroller so far

  constructor(private readonly host: PlacerHost) {}

  // Mounted: a saved place for this key is the live place and the first reveal.
  attach(scroller: HTMLElement, saved: StackPlace | null): void {
    this.scroller = scroller;
    this.found = null;
    this.at = scroller.scrollTop;
    this.live = saved;
    this.begin(saved ? { place: saved } : null);
  }

  // Unmounted: the place then in force (a reveal reached became the live place; one still out never moved it).
  detach(): StackPlace | null {
    this.scroller = null;
    this.found = null;
    return this.live;
  }

  update(input: PlacerInput): void {
    this.input = input;
  }

  // A commit: the page lags the model until the band last handed to the host is the one drawn.
  drawn(band: Band): void {
    if (band === this.band) this.pending = false;
  }

  // A request that named a file: that section's top at the scroller's top.
  revealSection(path: string): void {
    this.begin({ place: { path, row: null, offset: 0 }, top: true });
    this.relayout();
  }

  // ↑ or ↓: the hunk's first row at the reading edge.
  revealHunk(hunk: StackHunk): void {
    this.revealPlace(hunkPlace(hunk));
  }

  // A place at the reading edge (a hunk's first row; a card opened on a line not drawn, M5).
  revealPlace(place: StackPlace): void {
    this.begin({ place });
    this.relayout();
  }

  // A card opened on a line (M5), or none: once the card is drawn in its row under the line, the stack shows it down to
  // its bottom itself (the field's own scroll as it takes the keyboard can come outside the person's gesture and be undone
  // as a layout change, or its event be overtaken by one). The person's input before then leaves it where it is drawn.
  showCard(place: StackPlace | null): void {
    this.card = place;
  }

  // The person's wheel, touch, key or pointer press inside the scroller: their gesture begins, and an outstanding reveal
  // ends where it left the scroller, which becomes the live place (so its file's late answer moves nothing).
  interact(): void {
    this.gesture = performance.now();
    this.inputs += 1;
    this.card = null;
    if (!this.reveal) return;
    this.reveal = null;
    const m = this.measure();
    if (!m?.laidOut) return;
    this.read(m);
    this.at = m.el.scrollTop;
  }

  press(): void {
    this.pressed = true;
    this.interact();
  }

  // A pointer released anywhere: a drag of the scroll bar ends, its last scroll still the person's.
  release(): void {
    if (!this.pressed) return;
    this.pressed = false;
    this.gesture = performance.now();
  }

  // A scroll event: the stack's own is ignored; the person's is read as the live place, and moves the counter; any other
  // is a layout change. Under a layout not measured yet it is that layout change first: the browser's clamp (the page
  // shrank, and the scroller was moved up to its new end) is nothing more; the person's scroll is their movement, from
  // where the layout change holds the place they read.
  scrolled(): void {
    const el = this.scroller;
    if (!el) return;
    if (this.own !== null && Math.abs(el.scrollTop - this.own) < 1) return;
    this.own = null;
    const theirs = this.pressed || performance.now() - this.gesture <= GESTURE_MS;
    const moved = !this.sameShape(el);
    if (!theirs || (moved && el.scrollTop < this.at && atEnd(el))) {
      this.relayout();
      return;
    }
    this.reveal = null;
    const by = el.scrollTop - this.at;
    const m = this.measure(moved);
    if (!m) return;
    const held = moved && this.live !== null ? topOfPlace(m.layout, this.live, m.rows) : null;
    if (held !== null) this.write(el, this.scrollFor(m.layout, held) + by);
    this.read(m);
    this.at = el.scrollTop;
    this.setBand(this.bandFor(m, el.scrollTop));
  }

  // How many inputs the person has made in the scroller (a wheel, touch, key or pointer press): one made since a moment
  // tells that they moved on from it.
  inputCount(): number {
    return this.inputs;
  }

  // A pointer held down in the scroller: what opens now opens where the person points.
  pointing(): boolean {
    return this.pressed;
  }

  // Whether a place's row stands wholly in view, between the reading edge and the scroller's bottom (a card opened on a
  // line the person can see is not moved to).
  inView(place: StackPlace): boolean {
    const m = this.measure(true);
    if (!m?.laidOut || place.row === null) return false;
    const at = topOfPlace(m.layout, place, m.rows);
    const index = m.layout.index.get(place.path);
    const rows = index === undefined ? null : m.rows(index);
    const row = rows ? rowOf(rows, place.row) : undefined;
    if (!at?.exact || !at.edge || !row) return false;
    const top = m.el.scrollTop;
    return at.top >= edgeAt(m.layout, top) - 0.5 && at.top + row.height <= top + m.viewport + 0.5;
  }

  // A layout change: the reveal, else the live place, applied again under the heights the page now has.
  relayout(): void {
    const m = this.measure(true);
    if (!m) return;
    const { el, layout, rows } = m;
    if (!m.laidOut) {
      this.setBand(this.bandFor(m, el.scrollTop));
      this.at = el.scrollTop;
      return;
    }
    const reveal = this.reveal;
    const at = reveal ? topOfPlace(layout, reveal.place, rows) : null;
    if (reveal && at === null) this.reveal = null; // its file left the stack: the live place stands
    if (reveal && at !== null) {
      // A section folded is not reached yet: the jump that unfolds it draws it next. A section's top (a request, or a
      // place whose row is not drawn: still being read, or a read that failed) stands at the scroller's top.
      const exact = at.exact && !this.input.sections[layout.index.get(reveal.place.path)!]?.folded;
      const want = reveal.top ? Math.max(0, at.top) : this.scrollFor(layout, at);
      this.write(el, want);
      const band = this.bandFor(m, el.scrollTop);
      const lags = this.pending || !sameBand(band, this.band);
      if (exact && !lags && (Math.abs(el.scrollTop - want) < 1 || (want > el.scrollTop && atEnd(el)))) {
        this.reveal = null; // reached: the place reached is the live place
        this.read(m);
        this.standCard(m);
      }
      this.setBand(band);
      this.at = el.scrollTop;
      return;
    }
    if (this.live === null) this.read(m);
    else {
      const target = topOfPlace(layout, this.live, rows);
      if (target !== null) this.write(el, this.scrollFor(layout, target));
      // A place read where its file was not drawn yet names no row; once the file draws, the row at the same spot is
      // read, so the place survives what moves inside the file from then on.
      if (target !== null && this.live.row === null && !this.pending && this.drawsRows(layout, this.live.path, rows)) this.read(m);
      // Counted again only once the file read at the edge draws its rows: until then a drawn body weighs what the page
      // shows, which can put the edge past hunks it has not reached.
      else if (this.recount && !this.pending && this.drawsRows(layout, this.live.path, rows)) this.count(m);
    }
    this.standCard(m);
    this.setBand(this.bandFor(m, el.scrollTop));
    this.at = el.scrollTop;
  }

  // A reveal begins: the person's gesture before it is over, the counter is the jump's, and a card's exposure still
  // waiting is replaced by it (a card opening installs its own after its reveal).
  private begin(reveal: { place: StackPlace; top?: true } | null): void {
    this.reveal = reveal;
    this.gesture = -Infinity;
    this.recount = false;
    this.card = null;
  }

  // The live place read where the scroller stands, saved, and the counter read there with it: whichever of its three
  // ways the place changes by, the counter follows it.
  private read(m: Measured): void {
    this.live = placeAt(m.layout, edgeAt(m.layout, m.el.scrollTop), m.rows);
    if (this.live) this.host.saved(this.live);
    this.count(m);
  }

  // The card waiting to be drawn, once it is: its line's row reaches down over the card's (`rowsOf`). Where the card's
  // bottom is below the scroller's, the scroller moves down by the least that shows it, never past its line at the
  // reading edge (a card taller than the view shows its top); a card higher up moves nothing, so the place read stands
  // (M5). Read as the live place where it moved.
  private standCard(m: Measured): void {
    const place = this.card;
    if (!place?.row || !m.laidOut) return;
    if (!this.found?.sections.get(place.path)?.body?.querySelector('[data-review-card-row] [data-comment-card]')) return;
    this.card = null;
    const at = topOfPlace(m.layout, place, m.rows);
    const index = m.layout.index.get(place.path);
    const rows = index === undefined ? null : m.rows(index);
    const row = rows ? rowOf(rows, place.row) : undefined;
    if (!at?.exact || !at.edge || !row) return;
    const top = m.el.scrollTop;
    const line = scrollTopAt(m.layout, at.top); // the line at the reading edge
    const want = Math.max(top, Math.min(line, at.top + row.height - m.viewport));
    if (Math.abs(want - top) < 1) return;
    this.write(m.el, want);
    this.read(m);
  }

  // Where the scroller stands for a place found at `target`: at the reading edge (its row under its own section's
  // header, or in a header's handoff), or, for a section-top fallback, the section's top at the scroller's top.
  private scrollFor(layout: StackLayout, target: { top: number; edge: boolean }): number {
    return target.edge ? scrollTopAt(layout, target.top) : Math.max(0, target.top);
  }

  // ---- the page --------------------------------------------------------------------------------------------------------

  // The scroller's content and viewport are as tall as when the page was last found: no layout change since.
  private sameShape(el: HTMLElement): boolean {
    return this.found !== null && el.scrollHeight === this.found.height && el.clientHeight === this.found.viewport;
  }

  // The measures of the page now (kept only while it is laid out: a hidden or collapsed scroller measures nothing), the
  // model's layout from them, and the drawn rows of each body, read once per layout. The sections are found, and their
  // headers measured, at a layout change (`fresh`, or the scroller's heights changed since); otherwise those of the last
  // are kept, and only the drawn bodies are measured.
  private measure(fresh = false): Measured | null {
    const el = this.scroller;
    if (!el) return null;
    const viewport = el.clientHeight;
    const laidOut = viewport > 0;
    if (fresh || !this.sameShape(el) || this.found!.bodies.some(([, body]) => !body.isConnected)) {
      const sections = drawnSections(el);
      const bodies: [string, HTMLElement][] = [];
      for (const [path, { header, body }] of sections) {
        if (laidOut && header) this.headers.set(path, reviewLayout.height(header));
        if (body) bodies.push([path, body]);
      }
      this.found = { sections, bodies, height: el.scrollHeight, viewport };
    }
    const dom = this.found!.sections;
    // A drawn body weighs what the page shows, settled or not, so the model is the page; only a settled body's height
    // is kept for the spacer that stands for it later.
    const shown = new Map<string, number>();
    if (laidOut)
      for (const [path, body] of this.found!.bodies) {
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
    return { el, laidOut, viewport, layout, rows };
  }

  private drawsRows(layout: StackLayout, path: string, rows: RowsOf): boolean {
    const index = layout.index.get(path);
    return index !== undefined && (rows(index)?.length ?? 0) > 0;
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
    const next = Math.max(0, Math.min(top, el.scrollHeight - el.clientHeight));
    if (Math.abs(next - el.scrollTop) >= 1) {
      this.own = next;
      el.scrollTop = next;
    }
    this.own = el.scrollTop;
    this.at = el.scrollTop;
  }

  // The hunk at the reading edge (the first before any has scrolled past); at the end of the scroller a later hunk
  // jumped to stands. Every hunk of a file above the one at the edge is passed and none below it is reached, so only that
  // file's hunks are resolved: the hunks run in the stack's order, and the first of the edge's file is found by halving.
  // A hunk of a file whose rows are not drawn has no stop yet: it is counted again once its rows draw.
  private count({ el, layout, rows }: Measured): void {
    const { order, current } = this.input;
    const edge = edgeAt(layout, el.scrollTop) + 4;
    let at = 0;
    let unsure = false;
    if (order.length > 0 && layout.paths.length > 0) {
      const index = sectionAt(layout, edge);
      const sectionOf = (n: number) => layout.index.get(order[n].path) ?? -1;
      let first = 0;
      let after = order.length;
      while (first < after) {
        const mid = (first + after) >> 1;
        if (sectionOf(mid) < index) first = mid + 1;
        else after = mid;
      }
      at = Math.max(0, first - 1);
      for (let n = first; n < order.length && order[n].path === layout.paths[index]; n++) {
        const stop = topOfPlace(layout, hunkPlace(order[n]), rows);
        if (stop === null) continue;
        if (stop.exact) {
          if (stop.top <= edge) at = n;
          continue;
        }
        if (layout.bodyTops[index] + (layout.bodies[index] ?? 0) <= edge) at = n;
        else if (layout.bodyTops[index] <= edge) unsure = true;
      }
    }
    this.recount = unsure;
    if (at < current && atEnd(el)) return;
    if (at !== current) this.host.counted(at);
  }
}
