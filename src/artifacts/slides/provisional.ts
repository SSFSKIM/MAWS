// P4-A2 G2.2 (X35, the editors' provisional layer; docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md G-R2,
// G-R5): what a publish's slide file draws while it streams, React-free and DOM-free (the node typecheck reads this
// directory; Decision Log 5). The file's text so far is read by the loader as the publish reads it (parse5 drops a
// start tag the text ends inside, so an element appears once its tag closes, its text growing as it streams), merged over
// the live slide, and compared with it element by element. An open file's tail is the live slide's: an element the text
// has not reached is the live one in its live place, so an unfinished file never reads as removals; a whole file is the
// slide. What the merge leaves is a slide file the deck's canvas draws over a scratch doc, so the layer draws what the
// commit will draw; the slide's own section style, attributes and notes are the live slide's (shown at the swap).
import { isWhole, openPath, readPartialJson } from '@shared/maws/partial-json';
import { openElements } from './html';
import { CELL_TAGS, CONTAINER_TAGS, MARK_ORDER, RAW_TAGS, TEXT_TAGS, type ElementIR, type Marks, type SlideIR, type TextBlock } from './ir';
import { loadSlide, normalizeText } from './parse';
import { serializeSlide } from './serialize';

/**
 * A publish's slide as the layer draws it. Elements are named by key: an element's id, or for a table cell (positional,
 * D2) its row's id and column, `<rowId>#<column>` (`cellOf` reads one), the same in the live canvas and in one drawn
 * from `file`.
 */
export interface ProvisionalSlide {
  /** The slide file to draw (canonical): the live slide with the agent's elements merged in as far as they parse. */
  file: string;
  /** Live elements whose tag, style, attributes, text or raw markup the file changes. */
  changed: ReadonlySet<string>;
  /** Elements the live slide does not hold (one the agent left without an id is new, under a minted id). */
  added: ReadonlySet<string>;
  /** Live elements a whole file leaves out (never while the file is open). */
  removed: ReadonlySet<string>;
}

/** A table cell's key read back: its row's id and its column; null for any other element's key. */
export function cellOf(key: string): { row: string; column: number } | null {
  const at = key.lastIndexOf('#');
  return at < 0 ? null : { row: key.slice(0, at), column: Number(key.slice(at + 1)) };
}
const cellKey = (row: string, column: number) => `${row}#${column}`;

/**
 * The slide `slideId` as the publish's file `text` draws it over `live` (null for a slide the deck does not hold), the
 * text whole or, when `open`, still streaming (the layer's last file while it streams). Null when it draws nothing: the
 * file has no section yet, names another slide, or would be held by the loader, or nothing it holds so far differs from
 * the live slide (so a frame that changed nothing draws nothing, and `file` equal to the last one's means the same).
 */
export function provisionalSlide(slideId: string, live: SlideIR | null, text: string, open: boolean): ProvisionalSlide | null {
  const source = open ? withoutCutMarkup(text) : text;
  const liveSlide = live && normalized(live);
  const liveKeys = liveSlide ? keyed(liveSlide.children) : new Map<string, ElementIR>();
  const loaded = loadSlide(source, { fileId: slideId, taken: new Set([...liveKeys.values()].map((e) => e.id)) });
  if (!loaded.ok) return null;
  const sent = loaded.slide;
  // the elements the text ends inside, the section first: the section's own end makes the file whole
  const levels = open ? openElements(source) : [];
  const whole = levels.length === 0;

  if (!liveSlide) {
    const file = serializeSlide({ ...sent, notes: '' });
    return { file, changed: new Set(), added: new Set(keyed(sent.children).keys()), removed: new Set() };
  }
  const merged = new Merge(liveSlide, sent, source, levels.slice(1), whole).children();
  const file = serializeSlide({ ...liveSlide, children: merged });
  if (file === serializeSlide(liveSlide)) return null;
  const changed = new Set<string>();
  const added = new Set<string>();
  const drawn = keyed(merged);
  for (const [key, el] of drawn) {
    const was = liveKeys.get(key);
    if (!was) added.add(key);
    else if (differs(el, was)) changed.add(key);
  }
  const removed = new Set([...liveKeys.keys()].filter((key) => !drawn.has(key)));
  return { file, changed, added, removed };
}

/**
 * The filmstrip's order while a publish streams (G-R5): the live slides in their order, each slide new to the deck
 * (`added`, in the layer's file order) after the slide the streamed `order` of `deckText` names before it (first when
 * none does), or after the last slide until the order names it. A name still streaming is not yet a name; the order's
 * other changes show at the swap.
 */
export function provisionalOrder(liveOrder: readonly string[], added: readonly string[], deckText: string | undefined, open: boolean): string[] {
  const out = [...liveOrder];
  const named: string[] = [];
  const index = deckText === undefined ? undefined : readPartialJson(deckText);
  if (isRecord(index) && Array.isArray(index.order)) {
    const at = open ? openPath(deckText!) : null;
    index.order.forEach((id, k) => {
      if (typeof id === 'string' && isWhole(at, ['order', k])) named.push(id);
    });
  }
  named.forEach((id, k) => {
    if (!added.includes(id) || out.includes(id)) return;
    const before = named.slice(0, k).reverse().find((other) => out.includes(other));
    out.splice(before === undefined ? 0 : out.indexOf(before) + 1, 0, id);
  });
  for (const id of added) if (!out.includes(id)) out.push(id);
  return out;
}

// ---------------------------------------------------------------- the merge

/**
 * The agent's elements over the live slide's. Containers merge their children with their live counterpart's (by id; a
 * row's cells by position): while the file is open, each live child the text has not written anywhere stands in its
 * live place (before the first written live sibling that followed it, else after everything written), so nothing is
 * removed until the file is whole. The open element (the one the text ends inside) is the live one while its text (or
 * raw markup) is still a prefix of the live element's with the same tag, style and attributes. An element equal to its
 * live counterpart is drawn as the live one.
 */
class Merge {
  private readonly liveById = new Map<string, ElementIR>();
  private readonly written = new Set<string>();
  private readonly openLeaf: { el: ElementIR; contentStart: number } | null;

  constructor(
    private readonly live: SlideIR,
    private readonly sent: SlideIR,
    private readonly source: string,
    spine: { tag: string; contentStart: number }[],
    private readonly whole: boolean,
  ) {
    // by id, cells aside: a file's cells carry no id (the live slide's carry their model ids), so they go by position
    const walk = (els: ElementIR[], into: (e: ElementIR) => void) =>
      els.forEach((e) => {
        if (!CELL_TAGS.has(e.tag)) into(e);
        walk(e.children, into);
      });
    walk(live.children, (e) => this.liveById.set(e.id, e));
    walk(sent.children, (e) => this.written.add(e.id));
    // the spine below the section, level by level the last child of the level above while the tags agree
    let leaf: Merge['openLeaf'] = null;
    let level: ElementIR[] = sent.children;
    for (const open of spine) {
      const el = level[level.length - 1];
      if (!el || el.tag !== open.tag) break;
      if (!CONTAINER_TAGS.has(el.tag)) {
        if (TEXT_TAGS.has(el.tag) || RAW_TAGS.has(el.tag)) leaf = { el, contentStart: open.contentStart };
        break;
      }
      level = el.children;
    }
    this.openLeaf = whole ? null : leaf;
  }

  children(): ElementIR[] {
    return this.list(this.sent.children, this.live.children);
  }

  private list(sent: ElementIR[], live: ElementIR[]): ElementIR[] {
    const at = new Map(live.map((e, k) => [e.id, k]));
    const waiting = this.whole ? [] : live.filter((e) => !this.written.has(e.id));
    let next = 0;
    const out: ElementIR[] = [];
    for (const el of sent) {
      const place = at.get(el.id);
      if (place !== undefined) while (next < waiting.length && at.get(waiting[next]!.id)! < place) out.push(this.unwritten(waiting[next++]!));
      out.push(this.element(el, this.liveById.get(el.id)));
    }
    while (next < waiting.length) out.push(this.unwritten(waiting[next++]!));
    return out;
  }

  private cells(sent: ElementIR[], live: ElementIR[]): ElementIR[] {
    const out = sent.map((cell, k) => this.element(cell, live[k]));
    return this.whole ? out : [...out, ...live.slice(sent.length)];
  }

  private element(el: ElementIR, was: ElementIR | undefined): ElementIR {
    if (!was || was.tag !== el.tag) return CONTAINER_TAGS.has(el.tag) ? { ...el, children: this.inside(el, []) } : el;
    if (CONTAINER_TAGS.has(el.tag)) {
      const own = differs(el, was) ? el : was;
      return { ...own, children: this.inside(el, was.children) };
    }
    if (this.openLeaf?.el === el && sameProps(el, was) && this.streamsInto(el, was)) return was;
    return differs(el, was) ? el : was;
  }

  private inside(el: ElementIR, live: ElementIR[]): ElementIR[] {
    return el.tag === 'tr' ? this.cells(el.children, live) : this.list(el.children, live);
  }

  // The open element's text (or raw markup, as the text carries it) so far is a prefix of the live element's.
  private streamsInto(el: ElementIR, was: ElementIR): boolean {
    if (RAW_TAGS.has(el.tag)) return (was.raw ?? '').startsWith(this.source.slice(this.openLeaf!.contentStart));
    const [now, then] = [explode(el.text), explode(was.text)];
    return now.length <= then.length && now.every((token, k) => token === then[k]);
  }

  // A live element the text has not written: as it stands, less any descendant the text wrote elsewhere.
  private unwritten(el: ElementIR): ElementIR {
    if (!CONTAINER_TAGS.has(el.tag) || el.tag === 'tr') return el;
    return { ...el, children: el.children.filter((c) => !this.written.has(c.id)).map((c) => this.unwritten(c)) };
  }
}

/** Every element of a tree by key (an element's id; a cell's `<rowId>#<column>`). */
function keyed(children: ElementIR[]): Map<string, ElementIR> {
  const out = new Map<string, ElementIR>();
  const walk = (els: ElementIR[], row: string | null) =>
    els.forEach((e, k) => {
      out.set(row === null ? e.id : cellKey(row, k), e);
      if (CONTAINER_TAGS.has(e.tag)) walk(e.children, e.tag === 'tr' ? e.id : null);
    });
  walk(children, null);
  return out;
}

/** The live slide with its text as the loader reads it back, so it compares (and serializes) as the agent's file does. */
function normalized(slide: SlideIR): SlideIR {
  const walk = (e: ElementIR): ElementIR => ({ ...e, ...(e.text && { text: normalizeText(e.text) }), children: e.children.map(walk) });
  return { ...slide, children: slide.children.map(walk) };
}

const stable = (o: Readonly<Record<string, string>>) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
const sameProps = (a: ElementIR, b: ElementIR) => a.tag === b.tag && stable(a.style) === stable(b.style) && stable(a.attrs) === stable(b.attrs);

/** An element's own tag, style, attributes, text or raw markup differ (its children and its place aside). */
function differs(a: ElementIR, b: ElementIR): boolean {
  if (!sameProps(a, b) || a.raw !== b.raw) return true;
  const [x, y] = [explode(a.text), explode(b.text)];
  return x.length !== y.length || x.some((token, k) => token !== y[k]);
}

/** A text as tokens: a block's start, a line break, or one character with its marks. */
function explode(blocks: TextBlock[] | undefined): string[] {
  const out: string[] = [];
  for (const block of blocks ?? []) {
    out.push(`¶${block.type}`);
    for (const run of block.inline) {
      if ('br' in run) out.push('<br>');
      else {
        const marks = marksKey(run.marks);
        for (const ch of run.text) out.push(`${marks}${ch}`);
      }
    }
  }
  return out;
}
function marksKey(marks: Marks): string {
  return JSON.stringify(MARK_ORDER.filter((m) => marks[m]).map((m) => [m, marks[m]]));
}

/**
 * An open text's tail the loader would misread: a markup token the text ends inside (a `<` no `>` has followed, which
 * parse5 would read as text where it begins with nothing after it) and a character reference cut before its `;`
 * (`&am` read as itself, then `&` once whole). Both are dropped until they complete.
 */
function withoutCutMarkup(text: string): string {
  const lt = text.lastIndexOf('<');
  const cut = lt >= 0 && text.indexOf('>', lt) < 0 ? text.slice(0, lt) : text;
  return cut.replace(/&[#A-Za-z0-9]*$/, '');
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
