// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D3, D4; parent Decision Log 26): `artifact_publish`'s
// write half for a deck, on A's `KindAdapter.publish(live, base, sent, force)` contract. The agent's sent files are
// compared with its base (the files it last read) and the live model, property by property: a key the agent did not
// change (sent = base) is left alone even under force; one it changed applies when the live model still holds the base
// value, is left alone when live already holds the sent value, and otherwise conflicts. Text and notes merge at character
// level when the agent's changed ranges and the live changes since the read do not overlap. Any conflict refuses the
// whole publish (A's layer 3) unless `force`, which applies the agent's value for exactly the conflicting keys. The plan
// is made before anything is written; the writes are one transaction, none at all for a no-op republish.
//
// Elements are compared by key: an element's id, or for a table cell (positional in the files, D2) its row's id and
// column. Ids the agent left out are D4's: the base's id at the same place, else minted from base and sent only, so A's
// two calls of `publish` (the live write and the session's new base) mint the same ids.
import diff from 'fast-diff';
import { FilesError, type FileProblem, type PublishOutcome } from '../files';
import { transact, type Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { DECK_LIMITS, DECK_PATH, parseDeckJson, slideIdOf, slidePath, type DeckJson } from './deck';
import { parseHtml } from './html';
import { CONTAINER_TAGS, MARK_ORDER, TEXT_TAGS, isPinned, type Attrs, type ElementIR, type Marks, type SlideIR, type Style, type Tag, type TextBlock } from './ir';
import { cellMinter, childLists, groupOf, GROUP_BOUNDS, GROUPS, groupKey, heldOf, readDeckJson, readFlat, resolveParents, ROOT, slideFile, slideOrder, slideScalarsOf, type Group } from './model';
import { ANY, rekey, within } from './order';
import { loadSlide } from './parse';
import { partition } from './serialize';

/** A loader warning, or the publish's own, for the agent's answer (X25's deck part). `slide` is absent for the index. */
export interface DeckWarning {
  path: string;
  slide?: string;
  element?: string;
  property?: string;
  message: string;
}
export interface DeckPublishOutcome extends PublishOutcome {
  /** The slide files the publish created (a subset of `changed`). */
  added: string[];
  warnings: DeckWarning[];
  /** How many notes the loader made (healed to an equivalent; not listed). */
  notes: number;
  /** Sent slides that failed structurally: held with their reasons, the last good content kept. */
  held: { path: string; reasons: string[] }[];
}

export const GOOGLE_FONTS_WARNING = 'Google Fonts are not fetched in MAWS: upload the font file, or use the design system’s faces';

// ---------------------------------------------------------------- the compared form of a slide

interface El {
  key: string;
  tag: Tag;
  /** The parent's key ('' for the section). */
  parent: string;
  group: Group;
  style: Style;
  attrs: Attrs;
  text?: TextBlock[];
  raw?: string;
}
interface View {
  scalars: Y.Scalars;
  notes: string;
  els: Map<string, El>;
  /** `listKey(parent, group)` → element keys in order. */
  lists: Map<string, string[]>;
}
interface LiveView extends View {
  /** Element key → its model id (a cell's key is positional, its id the model's). */
  ids: Map<string, string>;
  /** Element key → its current sibling key (`order` or `z`). */
  place: Map<string, { order?: string; z?: string }>;
}
const EMPTY: View = { scalars: {}, notes: '', els: new Map(), lists: new Map() };
const listKey = (parent: string, g: Group) => `${parent}\u0000${g}`;
const cellKey = (rowId: string, index: number) => `${rowId}#${index}`;
const cellIndex = (key: string) => Number(key.slice(key.lastIndexOf('#') + 1));
const isCellKey = (key: string) => key.includes('#');

function viewOf(ir: SlideIR): View {
  const els = new Map<string, El>();
  const lists = new Map<string, string[]>();
  const walk = (children: ElementIR[], parent: string, row: boolean) => {
    const parts = partition(children);
    for (const g of GROUPS) {
      const keys = parts[g].map((c) => (row ? cellKey(parent, children.indexOf(c)) : c.id));
      if (keys.length) lists.set(listKey(parent, g), keys);
      parts[g].forEach((c, i) => {
        const key = keys[i]!;
        els.set(key, { key, tag: c.tag, parent, group: g, style: c.style, attrs: c.attrs, ...(c.text && { text: c.text }), ...(c.raw !== undefined && { raw: c.raw }) });
        if (CONTAINER_TAGS.has(c.tag)) walk(c.children, key, c.tag === 'tr');
      });
    }
  };
  walk(ir.children, ROOT, false);
  return { scalars: slideScalarsOf(ir), notes: ir.notes, els, lists };
}

function liveViewOf(doc: Doc, slideId: string): LiveView {
  const flat = readFlat(doc, slideId, true);
  const eff = resolveParents(flat);
  const byId = new Map(flat.map((e) => [e.id, e]));
  const keyOf = new Map<string, string>();
  const lists = childLists(flat, eff);
  for (const [parent, kids] of lists) {
    const row = byId.get(parent)?.tag === 'tr';
    kids.forEach((e, i) => keyOf.set(e.id, row ? cellKey(parent, i) : e.id));
  }
  const view: LiveView = { scalars: {}, notes: Y.readNotes(doc, slideId), els: new Map(), lists: new Map(), ids: new Map(), place: new Map() };
  for (const [k, v] of Object.entries(Y.slideScalars(doc, slideId))) if (k.startsWith('style:') || k.startsWith('attr:')) view.scalars[k] = v;
  for (const e of flat) {
    const key = keyOf.get(e.id)!;
    const parent = eff.get(e.id)!;
    const group = groupOf(e);
    view.els.set(key, { key, tag: e.tag, parent: parent === ROOT ? ROOT : keyOf.get(parent)!, group, style: e.style, attrs: e.attrs, ...(e.text && { text: e.text }), ...(e.raw !== undefined && { raw: e.raw }) });
    view.ids.set(key, e.id);
    view.place.set(key, { ...(e.order !== undefined && { order: e.order }), ...(e.z !== undefined && { z: e.z }) });
  }
  for (const [parent, kids] of lists)
    for (const g of GROUPS) {
      const keys = kids.filter((e) => groupOf(e) === g).map((e) => keyOf.get(e.id)!);
      if (keys.length) view.lists.set(listKey(parent === ROOT ? ROOT : keyOf.get(parent)!, g), keys);
    }
  return view;
}

/** An element's compared keys but its text and its place among its siblings. */
function propsOf(e: El | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!e) return out;
  out.set('tag', e.tag);
  out.set('parent', e.parent);
  if (e.raw !== undefined) out.set('raw', e.raw);
  for (const [k, v] of Object.entries(e.style)) out.set(`style:${k}`, v);
  for (const [k, v] of Object.entries(e.attrs)) out.set(`attr:${k}`, v);
  return out;
}
const propName = (key: string) => (key.startsWith('style:') || key.startsWith('attr:') ? key.slice(key.indexOf(':') + 1) : key === 'raw' ? 'content' : key);
const elementName = (key: string) => (isCellKey(key) ? `${key.slice(0, key.lastIndexOf('#'))} cell ${cellIndex(key) + 1}` : key);

// ---------------------------------------------------------------- text as one string (S6's `explode`)

const BLOCK = ' ';
const BR = ' ';
const BR_KEY = '<br>';
interface Exploded {
  s: string;
  /** One key per position: a block start `¶p`/`¶li`, `<br>`, or a text character's marks. */
  m: string[];
}
/** The marks in MARK_ORDER, so equal marks give equal keys whatever their object's key order. */
function marksKey(marks: Marks): string {
  const o: Record<string, unknown> = {};
  for (const k of MARK_ORDER) if (marks[k]) o[k] = marks[k];
  return JSON.stringify(o);
}
function explodeBlocks(blocks: TextBlock[] | undefined): Exploded {
  let s = '';
  const m: string[] = [];
  for (const b of blocks ?? []) {
    s += BLOCK;
    m.push(`¶${b.type}`);
    for (const r of b.inline) {
      if ('br' in r) {
        s += BR;
        m.push(BR_KEY);
        continue;
      }
      s += r.text;
      const key = marksKey(r.marks);
      for (let i = 0; i < r.text.length; i++) m.push(key);
    }
  }
  return { s, m };
}
function implodeBlocks(x: Exploded): TextBlock[] | null {
  const blocks: TextBlock[] = [];
  for (let i = 0; i < x.s.length; i++) {
    const key = x.m[i]!;
    if (key.startsWith('¶')) {
      blocks.push({ type: key === '¶li' ? 'li' : 'p', inline: [] });
      continue;
    }
    const block = blocks[blocks.length - 1];
    if (!block) return null;
    if (key === BR_KEY) {
      block.inline.push({ br: true });
      continue;
    }
    const last = block.inline[block.inline.length - 1];
    if (last && 'text' in last && marksKey(last.marks) === key) last.text += x.s[i];
    else block.inline.push({ text: x.s[i]!, marks: JSON.parse(key) as Marks });
  }
  return blocks;
}
const explodePlain = (s: string): Exploded => ({ s, m: Array.from({ length: s.length }, () => '') });
const sameExploded = (a: Exploded, b: Exploded) => a.s === b.s && a.m.length === b.m.length && a.m.every((k, i) => k === b.m[i]);
const sameText = (a: TextBlock[] | undefined, b: TextBlock[] | undefined) => sameExploded(explodeBlocks(a), explodeBlocks(b));

interface Edit {
  from: number;
  to: number;
  s: string;
  m: string[];
}
/** The changes from `b` to `o` as edits of ranges of `b`: deletions, insertions and re-marked text. */
function editsOf(b: Exploded, o: Exploded): Edit[] {
  const out: Edit[] = [];
  let cur: Edit | null = null;
  let bi = 0;
  let oi = 0;
  const open = () => {
    if (!cur || cur.to !== bi) {
      if (cur) out.push(cur);
      cur = { from: bi, to: bi, s: '', m: [] };
    }
    return cur;
  };
  for (const [op, text] of diff(b.s, o.s)) {
    if (op === diff.EQUAL) {
      for (let k = 0; k < text.length; k++, bi++, oi++) {
        if (b.m[bi] === o.m[oi]) continue;
        const e = open();
        e.to++;
        e.s += text[k];
        e.m.push(o.m[oi]!);
      }
    } else if (op === diff.DELETE) {
      open().to += text.length;
      bi += text.length;
    } else {
      const e = open();
      e.s += text;
      e.m.push(...o.m.slice(oi, oi + text.length));
      oi += text.length;
    }
  }
  if (cur) out.push(cur);
  return out;
}
/**
 * Two edits touch when their order in the result is not given: ranges that intersect, two insertions at one place, or
 * an insertion strictly inside the other's range. An insertion at a range's edge goes outside it.
 */
function touches(x: Edit, y: Edit): boolean {
  const [xi, yi] = [x.from === x.to, y.from === y.to];
  if (xi && yi) return x.from === y.from;
  if (xi) return y.from < x.from && x.from < y.to;
  if (yi) return x.from < y.from && y.from < x.to;
  return x.from < y.to && y.from < x.to;
}

/**
 * The three-way merge of a text: `null` when the agent's changes and the live ones since the read overlap, else the
 * base with both applied.
 */
function merge3(b: Exploded, a: Exploded, l: Exploded): Exploded | null {
  const mine = editsOf(b, a);
  const theirs = editsOf(b, l);
  if (mine.some((x) => theirs.some((y) => touches(x, y)))) return null;
  const all = [...mine, ...theirs].sort((x, y) => x.from - y.from || x.to - y.to); // an insertion before a range at its start
  let s = '';
  const m: string[] = [];
  let at = 0;
  for (const e of all) {
    s += b.s.slice(at, e.from) + e.s;
    m.push(...b.m.slice(at, e.from), ...e.m);
    at = e.to;
  }
  return { s: s + b.s.slice(at), m: [...m, ...b.m.slice(at)] };
}

type Merged<T> = { kind: 'keep' } | { kind: 'set'; value: T } | { kind: 'conflict' };
function mergeBlocks(b: TextBlock[] | undefined, a: TextBlock[] | undefined, l: TextBlock[] | undefined, force: boolean): Merged<TextBlock[]> {
  const [eb, ea, el] = [explodeBlocks(b), explodeBlocks(a), explodeBlocks(l)];
  if (sameExploded(ea, eb) || sameExploded(ea, el)) return { kind: 'keep' };
  if (sameExploded(el, eb)) return { kind: 'set', value: a ?? [] };
  const merged = merge3(eb, ea, el);
  const blocks = merged && implodeBlocks(merged);
  return blocks ? { kind: 'set', value: blocks } : force ? { kind: 'set', value: a ?? [] } : { kind: 'conflict' };
}
function mergeNotes(b: string, a: string, l: string, force: boolean): Merged<string> {
  if (a === b || a === l) return { kind: 'keep' };
  if (l === b) return { kind: 'set', value: a };
  const merged = merge3(explodePlain(b), explodePlain(a), explodePlain(l));
  return merged ? { kind: 'set', value: merged.s } : force ? { kind: 'set', value: a } : { kind: 'conflict' };
}

// ---------------------------------------------------------------- sibling sequences

const restrict = (seq: string[], keep: Set<string>) => seq.filter((k) => keep.has(k));
const sameSeq = (a: string[], b: string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

/**
 * The wanted order of one sibling list (the deck's slides, or one parent's flow, under or over list): the live order
 * unless the agent re-ordered what it read (then its order, with what others added since kept after their live
 * predecessors), its new members placed after their predecessor in its order. `conflict` when both the agent and
 * someone else re-ordered the members all three share, differently.
 */
function mergeSequence(members: Set<string>, seqB: string[], seqA: string[], seqL: string[], force: boolean): { desired: string[]; conflict: boolean } {
  const [b, a, l] = [restrict(seqB, members), restrict(seqA, members), restrict(seqL, members)];
  const inB = new Set(b);
  const inA = new Set(a);
  const ab = new Set(a.filter((k) => inB.has(k)));
  const reordered = !sameSeq(restrict(a, ab), restrict(b, ab));
  let desired: string[];
  let conflict = false;
  if (!reordered) {
    desired = [...l];
    a.forEach((k, i) => {
      if (inB.has(k) || desired.includes(k)) return;
      insertNear(desired, k, a.slice(0, i).reverse(), a.slice(i + 1));
    });
  } else {
    const shared = new Set(l.filter((k) => ab.has(k)));
    const liveSeq = restrict(l, shared);
    if (!sameSeq(liveSeq, restrict(b, shared)) && !sameSeq(liveSeq, restrict(a, shared)) && !force) conflict = true;
    desired = [...a];
    l.forEach((k, i) => {
      if (inA.has(k)) return;
      insertNear(desired, k, l.slice(0, i).reverse(), l.slice(i + 1));
    });
  }
  for (const k of members) if (!desired.includes(k)) desired.push(k);
  return { desired, conflict };
}
/** Put `k` after the nearest of `before` (nearest first) that `seq` holds, else before the first of `after` it holds, else last. */
function insertNear(seq: string[], k: string, before: string[], after: string[]): void {
  const prev = before.find((p) => seq.includes(p));
  if (prev !== undefined) return void seq.splice(seq.indexOf(prev) + 1, 0, k);
  const next = after.find((n) => seq.includes(n));
  if (next !== undefined) return void seq.splice(seq.indexOf(next), 0, k);
  seq.push(k);
}

// ---------------------------------------------------------------- the publish

interface Loaded {
  path: string;
  id: string;
  source: string;
  ir: SlideIR | null;
  /** The base file loaded: its IR, null when it was held, undefined when the session never read the slide. */
  base: SlideIR | null | undefined;
  reasons: string[];
  /** How many elements the file left without an id. */
  idless: number;
}

/** Stable JSON: equal by meaning whatever a nested object's key order. */
function stable(v: unknown): string {
  if (v === undefined) return '';
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}

/** The section id a file's markup gives, read without the loader (for a held file's name check). */
function sectionIdOf(source: string): string | null {
  const top = parseHtml(source).find((n) => n.kind === 'element');
  return top && top.kind === 'element' && top.tag === 'section' ? (new Map(top.attrs).get('id') ?? '') : null;
}

/** Path → id of the base slide's element at each place, for D4: `parentPath \0 index \0 tag`. */
function baseSlots(ir: SlideIR): Map<string, string> {
  const slots = new Map<string, string>();
  const walk = (children: ElementIR[], path: string) =>
    children.forEach((c, index) => {
      if (c.id) slots.set(`${path}\u0000${index}\u0000${c.tag}`, c.id);
      if (CONTAINER_TAGS.has(c.tag)) walk(c.children, `${path}/${c.id}`);
    });
  walk(ir.children, ir.id);
  return slots;
}
function idsOf(ir: SlideIR): Set<string> {
  const ids = new Set<string>();
  const walk = (children: ElementIR[]) =>
    children.forEach((c) => {
      if (c.id) ids.add(c.id);
      walk(c.children);
    });
  walk(ir.children);
  return ids;
}

/** Load a slide file the agent sent, minting the ids it left out from its base slide (D4). */
function loadSent(path: string, id: string, source: string, base: SlideIR | null | undefined): Loaded & { diagnostics: ReturnType<typeof loadSlide>['diagnostics'] } {
  const slots = base ? baseSlots(base) : new Map<string, string>();
  let idless = 0;
  const result = loadSlide(source, {
    fileId: id,
    taken: base ? idsOf(base) : new Set(),
    mint: (parentPath, index, tag) => {
      idless++;
      return slots.get(`${parentPath}\u0000${index}\u0000${tag}`);
    },
  });
  return { path, id, source, ir: result.ok ? result.slide : null, base, reasons: result.ok ? [] : result.held.reasons, idless, diagnostics: result.diagnostics };
}
function loadBase(source: string | undefined, id: string): SlideIR | null | undefined {
  if (source === undefined) return undefined;
  const result = loadSlide(source, { fileId: id });
  return result.ok ? result.slide : null;
}

/** Counts the writes and the paths they changed. */
class Writer {
  writes = 0;
  readonly paths = new Set<string>();
  constructor(readonly doc: Doc) {}
  on(path: string, write: () => void): void {
    write();
    this.writes++;
    this.paths.add(path);
  }
}

/**
 * The deck's publish (D3): `live` the host replica the write goes through, `base` the files the session last read,
 * `sent` its files (`null` removes one). Throws `FilesError` naming every path the deck cannot hold, before writing.
 */
export function publishDeck(live: Doc, base: Readonly<Record<string, string>>, sent: Readonly<Record<string, string | null>>, force: boolean): DeckPublishOutcome {
  // ---- 1. plan: paths, the index, the limits; every sent slide loaded
  const problems: FileProblem[] = [];
  const paths = Object.keys(sent).sort();
  let bytes = 0;
  for (const path of paths) {
    const text = sent[path];
    if (text !== null && text !== undefined) bytes += new TextEncoder().encode(text).length;
    if (path === DECK_PATH) {
      if (text === null) problems.push({ path, message: 'the deck’s index cannot be removed' });
    } else if (slideIdOf(path) === null) problems.push({ path, message: 'not a deck file: project/deck.json or project/slides/<id>.html, an id of [A-Za-z0-9_-]{1,64}' });
  }
  const warnings: DeckWarning[] = [];
  let notes = 0;
  const held: DeckPublishOutcome['held'] = [];

  let sentDeck: DeckJson | null = null;
  const deckText = sent[DECK_PATH];
  if (typeof deckText === 'string' && deckText !== base[DECK_PATH]) {
    const parsed = parseDeckJson(deckText);
    if (!parsed.ok) for (const message of parsed.problems) problems.push({ path: DECK_PATH, message });
    else {
      sentDeck = parsed.deck;
      for (const d of parsed.diagnostics) {
        if (d.severity === 'note') notes++;
        else warnings.push({ path: DECK_PATH, property: d.property, message: d.message });
      }
      if (Object.values(sentDeck.faces ?? {}).some((face) => face.href !== undefined)) warnings.push({ path: DECK_PATH, property: 'faces', message: GOOGLE_FONTS_WARNING });
    }
  }

  const loaded: (Loaded | { path: string; id: string; removed: true })[] = [];
  for (const path of paths) {
    const id = slideIdOf(path);
    const source = sent[path];
    if (id === null || path === DECK_PATH) continue;
    if (source === null) {
      loaded.push({ path, id, removed: true });
      continue;
    }
    if (source === undefined || source === base[path]) continue; // not the agent's change
    const baseIr = loadBase(base[path], id);
    const l = loadSent(path, id, source, baseIr);
    if (!l.ir) {
      const named = sectionIdOf(source);
      if (named !== null && named !== '' && named !== id) {
        problems.push({ path, message: `the section’s id is "${named}", not the file name’s "${id}"` });
        continue;
      }
      held.push({ path, reasons: l.reasons });
    }
    for (const d of l.diagnostics) {
      if (d.severity === 'note') notes++;
      else warnings.push({ path, slide: d.slide, ...(d.element !== undefined && { element: d.element }), ...(d.property !== undefined && { property: d.property }), message: d.message });
    }
    if (baseIr && l.ir && l.idless > 0 && l.idless === countElements(l.ir)) {
      warnings.push({ path, slide: id, message: `${l.idless} elements had no id: re-read to keep their identity` });
    }
    loaded.push(l);
  }

  const liveIds = new Set(Y.slideIds(live));
  // a removal of a slide the session never read is not the agent's change (A's rule for a file it never saw)
  const removedIds = new Set(loaded.filter((l) => 'removed' in l && liveIds.has(l.id) && base[l.path] !== undefined).map((l) => l.id));
  const createdIds = new Set(loaded.filter((l) => !('removed' in l) && !liveIds.has(l.id)).map((l) => l.id));
  const finalCount = liveIds.size - removedIds.size + createdIds.size;
  if (finalCount > DECK_LIMITS.slides) problems.push({ path: DECK_PATH, message: `the deck would hold ${finalCount} slides (over ${DECK_LIMITS.slides})` });
  if (finalCount + 1 > DECK_LIMITS.files) problems.push({ path: DECK_PATH, message: `the deck would hold ${finalCount + 1} files (over ${DECK_LIMITS.files})` });
  if (bytes > DECK_LIMITS.publishBytes) problems.push({ path: DECK_PATH, message: `the publish sends ${bytes} bytes (over ${DECK_LIMITS.publishBytes})` });
  if (problems.length > 0) throw new FilesError(problems);

  // ---- 2. compare per key; every write deferred to one transaction
  const conflicts: PublishOutcome['conflicts'] = [];
  const writes: ((w: Writer) => void)[] = [];
  const added: string[] = [];
  for (const l of loaded) {
    if ('removed' in l) {
      if (removedIds.has(l.id)) planRemoval(live, l.id, l.path, base[l.path]!, force, conflicts, writes);
    } else planSlide(live, l, base[l.path], force, conflicts, writes, added);
  }
  planDeck(live, base, sentDeck, createdIds, removedIds, force, conflicts, writes, warnings);

  if (conflicts.length > 0 && !force) return { changed: [], conflicts, added: [], warnings, notes, held };

  // ---- 3. write once
  const w = new Writer(live);
  if (writes.length > 0) transact(live, () => writes.forEach((write) => write(w)));
  return { changed: [...w.paths].sort(), conflicts: [], added: added.filter((p) => w.paths.has(p)).sort(), warnings, notes, held };
}

function countElements(ir: SlideIR): number {
  let n = 0;
  const walk = (children: ElementIR[]) =>
    children.forEach((c) => {
      if (c.tag !== 'th' && c.tag !== 'td') n++;
      walk(c.children);
    });
  walk(ir.children);
  return n;
}

function planRemoval(live: Doc, id: string, path: string, baseFile: string, force: boolean, conflicts: PublishOutcome['conflicts'], writes: ((w: Writer) => void)[]): void {
  if (slideFile(live, id) !== baseFile && !force) {
    conflicts.push({ path, detail: 'slide: changed since your read' });
    return;
  }
  writes.push((w) => {
    w.on(path, () => Y.deleteSlide(w.doc, id));
    w.paths.add(DECK_PATH); // its order lists one slide fewer
  });
}

/** A slide the publish creates: the slide, its order key (written with the deck's order) and the index's order. */
function createSlide(w: Writer, path: string, id: string, scalars: Y.Scalars, notes: string, added: string[]): void {
  w.on(path, () => Y.createSlide(w.doc, id, scalars, notes));
  w.paths.add(DECK_PATH);
  added.push(path);
}

function planSlide(live: Doc, l: Loaded, baseFile: string | undefined, force: boolean, conflicts: PublishOutcome['conflicts'], writes: ((w: Writer) => void)[], added: string[]): void {
  const { path, id, base: baseIr } = l;
  const conflict = (detail: string) => conflicts.some((c) => c.path === path && c.detail === detail) || conflicts.push({ path, detail });
  const exists = Y.hasSlide(live, id);
  const liveFile = exists ? slideFile(live, id) : undefined;
  const liveHeld = exists ? heldOf(live, id) : null;

  // a held file: compared as a whole, the last good model kept
  if (!l.ir) {
    if (baseFile === undefined && exists && liveFile !== l.source && !force) return void conflict('slide: created since your read');
    if (baseFile !== undefined && exists && liveFile !== baseFile && liveFile !== l.source && !force) return void conflict('slide: changed since your read');
    if (baseFile !== undefined && !exists && !force) return void conflict('slide: removed since your read');
    const value = { source: l.source, reasons: l.reasons };
    writes.push((w) => {
      if (!Y.hasSlide(w.doc, id)) createSlide(w, path, id, {}, '', added);
      if (stable(Y.slideScalars(w.doc, id).held) !== stable(value)) w.on(path, () => Y.setSlideKey(w.doc, id, 'held', value as unknown as Y.Json));
    });
    return;
  }

  const a = viewOf(l.ir);
  if (!exists) {
    if (baseFile !== undefined && !force) return void conflict('slide: removed since your read');
    writes.push((w) => {
      createSlide(w, path, id, a.scalars, a.notes, added);
      planElements(path, EMPTY, a, { ...EMPTY, ids: new Map(), place: new Map() }, true, () => {})(w);
    });
    return;
  }

  // the base the agent's change is read against
  let b: View;
  const lv = liveViewOf(live, id);
  if (baseFile === undefined) {
    if (liveFile === l.source) return;
    if (!force) return void conflict('slide: created since your read');
    b = EMPTY;
  } else if (baseIr === null || liveHeld) {
    // a held base (or a slide held since the read): the model's last good content is what the agent's file replaces
    if (liveFile !== baseFile && !force) return void conflict('slide: changed since your read');
    b = baseIr === null ? lv : viewOf(baseIr!);
  } else b = viewOf(baseIr!);

  const planned = planElements(path, b, a, lv, force, conflict);
  const scalarSets: [string, Y.Json | undefined][] = [];
  for (const key of new Set([...Object.keys(b.scalars), ...Object.keys(a.scalars)])) {
    const [bv, av, lvv] = [b.scalars[key], a.scalars[key], lv.scalars[key]];
    if (av === bv || av === lvv) continue;
    if (lvv !== bv && !force) {
      conflict(`slide: ${propName(key)} changed since your read`);
      continue;
    }
    scalarSets.push([key, av]);
  }
  const notesMerge = mergeNotes(b.notes, a.notes, lv.notes, force);
  if (notesMerge.kind === 'conflict') conflict('notes: changed since your read');

  writes.push((w) => {
    for (const [key, v] of scalarSets) w.on(path, () => (v === undefined ? Y.deleteSlideKey(w.doc, id, key) : Y.setSlideKey(w.doc, id, key, v)));
    if (notesMerge.kind === 'set') w.on(path, () => Y.patchNotes(w.doc, id, notesMerge.value));
    planned(w);
    if (liveHeld) w.on(path, () => Y.deleteSlideKey(w.doc, id, 'held'));
  });
}

/**
 * The element half of a slide's three-way compare: removals, creations, keys, text and placement. Conflicts are
 * reported now; the returned function writes.
 */
function planElements(path: string, b: View, a: View, lv: LiveView, force: boolean, conflict: (detail: string) => void): (w: Writer) => void {
  const removals: string[] = [];
  const creations: string[] = [];
  const sets = new Map<string, Map<string, string | undefined>>(); // key → prop → value (undefined deletes)
  const texts = new Map<string, TextBlock[]>();
  const merged = new Map<string, Map<string, string>>(); // each surviving element's props after the publish

  const changedSince = (x: El, y: El) => {
    const px = propsOf(x);
    const py = propsOf(y);
    return px.size !== py.size || [...px].some(([k, v]) => py.get(k) !== v) || !sameText(x.text, y.text);
  };
  for (const key of new Set([...b.els.keys(), ...a.els.keys()])) {
    const [eb, ea, el] = [b.els.get(key), a.els.get(key), lv.els.get(key)];
    const name = elementName(key);
    if (eb && !ea) {
      if (!el) continue;
      if (changedSince(eb, el) && !force) conflict(`element ${name}: changed since your read`);
      else removals.push(key);
      continue;
    }
    if (!ea) continue;
    if (!el) {
      if (eb && changedSince(eb, ea) && !force) {
        conflict(`element ${name}: removed since your read`);
        continue;
      }
      if (eb && !changedSince(eb, ea)) continue; // removed by someone else, and the agent did not change it
      creations.push(key);
      merged.set(key, propsOf(ea));
      continue;
    }
    // in live: key by key against the base (absent when the agent created what someone else created meanwhile)
    if (!eb && !changedSince(ea, el)) continue;
    if (!eb && !force) {
      conflict(`element ${name}: created since your read`);
      continue;
    }
    const [pb, pa, pl] = [propsOf(eb), propsOf(ea), propsOf(el)];
    const out = new Map(pl);
    const set = new Map<string, string | undefined>();
    for (const prop of new Set([...pb.keys(), ...pa.keys()])) {
      const [vb, va, vl] = [pb.get(prop), pa.get(prop), pl.get(prop)];
      if (va === vb || va === vl) continue;
      if (vl !== vb && !force) {
        conflict(`element ${name}: ${propName(prop)} changed since your read`);
        continue;
      }
      set.set(prop, va);
      if (va === undefined) out.delete(prop);
      else out.set(prop, va);
    }
    if (set.size) sets.set(key, set);
    merged.set(key, out);
    if (TEXT_TAGS.has(out.get('tag') as Tag)) {
      const text = mergeBlocks(eb?.text, ea.text, el.text, force);
      if (text.kind === 'conflict') conflict(`text of ${name}: changed since your read`);
      else if (text.kind === 'set') texts.set(key, text.value);
    }
  }
  // every live element the agent did not touch keeps its props
  for (const [key, el] of lv.els) if (!merged.has(key) && !removals.includes(key)) merged.set(key, propsOf(el));

  // placement: each surviving element's list, then each list's wanted order
  const final = new Map<string, { parent: string; group: Group }>();
  for (const [key, props] of merged) {
    const style: Style = {};
    const attrs: Attrs = {};
    for (const [k, v] of props) {
      if (k.startsWith('style:')) style[k.slice(6)] = v;
      else if (k.startsWith('attr:')) attrs[k.slice(5)] = v;
    }
    const tag = props.get('tag') as Tag;
    let group: Group = 'flow';
    if (isPinned(tag, style, attrs)) {
      const [ea, eb, el] = [a.els.get(key), b.els.get(key), lv.els.get(key)];
      const agentLayer = ea && ea.group !== 'flow' && (!eb || eb.group !== ea.group) ? ea.group : undefined;
      group = agentLayer ?? (el && el.group !== 'flow' ? el.group : ea && ea.group !== 'flow' ? ea.group : 'over');
    }
    final.set(key, { parent: props.get('parent') ?? ROOT, group });
  }
  // a child whose parent does not survive: the agent placed it in an element removed since, or removed an element
  // someone filled since (with force, it is an orphan the host's repair moves to the section)
  for (const { parent } of final.values())
    if (parent !== ROOT && !final.has(parent) && !force) conflict(`element ${elementName(parent)}: ${removals.includes(parent) ? 'changed' : 'removed'} since your read`);

  const listsOf = new Map<string, Set<string>>();
  for (const [key, { parent, group }] of final) {
    const lk = listKey(parent, group);
    if (!listsOf.has(lk)) listsOf.set(lk, new Set());
    listsOf.get(lk)!.add(key);
  }
  const placements: { list: string; desired: string[]; group: Group }[] = [];
  for (const [lk, members] of listsOf) {
    const [parent, group] = lk.split('\u0000') as [string, Group];
    const isRow = final.has(parent) && merged.get(parent)?.get('tag') === 'tr';
    if (isRow) {
      placements.push({ list: lk, group, desired: [...members].sort((x, y) => cellIndex(x) - cellIndex(y)) });
      continue;
    }
    const { desired, conflict: clash } = mergeSequence(members, b.lists.get(lk) ?? [], a.lists.get(lk) ?? [], lv.lists.get(lk) ?? [], force);
    if (clash) conflict(parent === ROOT ? 'order: changed since your read' : `order in ${elementName(parent)}: changed since your read`);
    placements.push({ list: lk, group, desired });
  }

  return (w) => {
    const { doc } = w;
    const sid = slideIdOf(path)!;
    const ids = new Map(lv.ids);
    const mintCell = cellMinter(doc, Y.elementIds(doc, sid));
    for (const key of removals) {
      const id = ids.get(key)!;
      if (Y.hasElement(doc, sid, id)) w.on(path, () => Y.deleteElement(doc, sid, id));
      ids.delete(key);
    }
    for (const key of creations) ids.set(key, isCellKey(key) ? mintCell(ids.get(key.slice(0, key.lastIndexOf('#')))!) : key);
    // a creation's parent may itself be new: ids first, then the elements
    const idOf = (key: string) => (key === ROOT ? ROOT : (ids.get(key) ?? key));
    for (const key of creations) {
      const e = a.els.get(key)!;
      const scalars: Y.Scalars = { tag: e.tag, parent: idOf(e.parent) };
      for (const [k, v] of Object.entries(e.style)) scalars[`style:${k}`] = v;
      for (const [k, v] of Object.entries(e.attrs)) scalars[`attr:${k}`] = v;
      if (e.raw !== undefined) scalars.raw = e.raw;
      w.on(path, () => Y.createElement(doc, sid, ids.get(key)!, scalars, e.text));
    }
    for (const [key, props] of sets) {
      const id = ids.get(key)!;
      for (const [prop, v] of props) w.on(path, () => (v === undefined ? Y.deleteElementKey(doc, sid, id, prop) : Y.setElementKey(doc, sid, id, prop, prop === 'parent' ? idOf(v) : v)));
      const tag = merged.get(key)!.get('tag') as Tag;
      if (props.has('tag') && !TEXT_TAGS.has(tag) && Y.hasText(doc, sid, id)) w.on(path, () => Y.removeText(doc, sid, id));
    }
    for (const [key, blocks] of texts) {
      const id = ids.get(key)!;
      if (!Y.hasText(doc, sid, id)) w.on(path, () => Y.writeText(doc, sid, id, blocks));
      else {
        const ops = Y.patchText(doc, sid, id, blocks);
        if (ops > 0) {
          w.writes += ops;
          w.paths.add(path);
        }
      }
    }
    for (const { desired, group } of placements) {
      const k = groupKey(group);
      const other = k === 'order' ? 'z' : 'order';
      const current = new Map<string, string>();
      for (const key of desired) {
        const was = lv.els.get(key);
        const place = lv.place.get(key)?.[k];
        if (was && was.group === group && final.get(key)?.parent === was.parent && within(place, GROUP_BOUNDS[group])) current.set(key, place!);
      }
      for (const [key, value] of rekey(desired, current, GROUP_BOUNDS[group])) w.on(path, () => Y.setElementKey(doc, sid, ids.get(key)!, k, value));
      for (const key of desired) if (lv.place.get(key)?.[other] !== undefined) w.on(path, () => Y.deleteElementKey(doc, sid, ids.get(key)!, other));
    }
  };
}

/** The index: its keys and maps key by key, and the slide order (always: a slide created or removed moves it). */
function planDeck(
  live: Doc,
  base: Readonly<Record<string, string>>,
  sentDeck: DeckJson | null,
  createdIds: Set<string>,
  removedIds: Set<string>,
  force: boolean,
  conflicts: PublishOutcome['conflicts'],
  writes: ((w: Writer) => void)[],
  warnings: DeckWarning[],
): void {
  const conflict = (detail: string) => conflicts.push({ path: DECK_PATH, detail });
  const baseParsed = base[DECK_PATH] === undefined ? null : parseDeckJson(base[DECK_PATH]!);
  const b: DeckJson = baseParsed?.ok ? baseParsed.deck : { order: [] };
  const l = readDeckJson(live);
  const keyWrites: ((w: Writer) => void)[] = [];
  if (sentDeck) {
    const maps = ['sections', 'faces', 'dsOverrides'] as const;
    const skip = new Set<string>(['order', ...maps]);
    for (const key of new Set([...Object.keys(b), ...Object.keys(sentDeck)])) {
      if (skip.has(key)) continue;
      const [vb, va, vl] = [stable(b[key]), stable(sentDeck[key]), stable(l[key])];
      if (va === vb || va === vl) continue;
      if (vl !== vb && !force) {
        conflict(`deck.json key ${key}: changed since your read`);
        continue;
      }
      const value = sentDeck[key];
      keyWrites.push((w) => w.on(DECK_PATH, () => (value === undefined ? Y.deleteDeckKey(w.doc, key) : Y.setDeckKey(w.doc, key, value as Y.Json))));
    }
    for (const name of maps) {
      const [mb, ma, ml] = [b[name] as Record<string, unknown> | undefined, sentDeck[name] as Record<string, unknown> | undefined, l[name] as Record<string, unknown> | undefined];
      if ((ma === undefined) !== (mb === undefined) && (ml === undefined) === (mb === undefined)) {
        keyWrites.push((w) => w.on(DECK_PATH, () => (ma === undefined ? Y.deleteDeckMap(w.doc, name) : Y.ensureDeckMap(w.doc, name))));
      }
      if (ma === undefined) continue;
      for (const entry of new Set([...Object.keys(mb ?? {}), ...Object.keys(ma)])) {
        const [vb, va, vl] = [stable(mb?.[entry]), stable(ma[entry]), stable(ml?.[entry])];
        if (va === vb || va === vl) continue;
        if (vl !== vb && !force) {
          conflict(`deck.json key ${name}.${entry}: changed since your read`);
          continue;
        }
        const value = ma[entry];
        keyWrites.push((w) => w.on(DECK_PATH, () => (value === undefined ? Y.deleteDeckEntry(w.doc, name, entry) : Y.setDeckEntry(w.doc, name, entry, value as Y.Json))));
      }
    }
  }

  // the slide order
  const seqL = slideOrder(live);
  const listed = new Set(sentDeck?.order ?? []);
  // a new slide no sent order places is appended after the last slide
  const appended = [...createdIds].filter((id) => !listed.has(id)).sort();
  const members = new Set([...seqL.filter((id) => !removedIds.has(id)), ...createdIds].filter((id) => !appended.includes(id)));
  const seqB = b.order;
  let seqA: string[];
  if (sentDeck) {
    for (const id of sentDeck.order) if (!members.has(id)) warnings.push({ path: DECK_PATH, property: 'order', message: `order lists slide ${id}, which has no file; dropped` });
    // a slide the order leaves out shows last (Claude); only slides the agent knows: one created since keeps its place
    seqA = [...sentDeck.order.filter((id) => members.has(id)), ...seqB.filter((id) => members.has(id) && !listed.has(id))];
  } else seqA = seqB.filter((id) => members.has(id));
  const merged = mergeSequence(members, seqB, seqA, seqL, force);
  if (merged.conflict) conflict('order: changed since your read');
  const desired = [...merged.desired, ...appended];
  writes.push((w) => {
    keyWrites.forEach((write) => write(w));
    const current = new Map<string, string>();
    for (const id of desired) {
      const order = Y.hasSlide(w.doc, id) ? (Y.slideScalars(w.doc, id).order as string | undefined) : undefined;
      if (order !== undefined) current.set(id, order);
    }
    for (const [id, order] of rekey(desired, current, ANY)) if (Y.hasSlide(w.doc, id)) w.on(createdIds.has(id) ? slidePath(id) : DECK_PATH, () => Y.setSlideKey(w.doc, id, 'order', order));
  });
}
