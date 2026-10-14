// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D1, D2, D5, D9): the deck model's seam in the binding
// module, from P3-0's S6 (`spikes/p3-store/s6/src/ydoc.ts`, the v14 seam). Everything outside this file speaks the
// model's terms (slides, elements, keys, text blocks, change records); docs, the wire and transactions are `./doc`'s.
//
// v14 has one type, Y.Node: a name, attributes (plain values or nested nodes) and children (text with formats and nodes,
// inline in one sequence). One deck's Y.Doc:
//   deck:    root node: deck.json's keys but `order`, as JSON attributes; `sections`, `faces` and `dsOverrides` nested
//            nodes, key → JSON, so concurrent edits of different entries merge
//   slides:  root node: attribute id → <slide> {
//              order, 'style:<prop>', 'attr:<name>', held?: {source, reasons}   (attributes)
//              notes: <notes> node (plain text children),
//              elements: <elements> node, attribute id → <el> { tag, parent, order | z, 'style:*', 'attr:*', raw?,
//                        text?: <doc> node: <p>|<li> blocks of text (marks as formats {b:{}}, {a:{href}}, …) and <br>
//                        nodes — @y/prosemirror 2's node shape, so a Tiptap text box binds to it } }
//   threads: root node: attribute threadId → <thread> {its scalars as attributes; the messages as its child sequence}
import * as Y from '@y/y';
import diff from 'fast-diff';
import { MARK_ORDER, type Inline, type Marks, type TextBlock } from '../slides/ir';
import type { ContentIds } from './attribution';
import type { Doc } from './doc';

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type Scalars = Record<string, Json>;
type N = Y.Node;

export const DECK_ROOT = 'deck';
export const SLIDES_ROOT = 'slides';
export const THREADS_ROOT = 'threads';
export type DeckMap = 'sections' | 'faces' | 'dsOverrides';

const slidesNode = (doc: Doc): N => doc.get(SLIDES_ROOT);
const deckNode = (doc: Doc): N => doc.get(DECK_ROOT);
function slide(doc: Doc, id: string): N {
  const s = slidesNode(doc).getAttr(id) as N | undefined;
  if (!s) throw new Error(`no slide ${id}`);
  return s;
}
const elementsOf = (doc: Doc, slideId: string): N => slide(doc, slideId).getAttr('elements') as N;
function element(doc: Doc, slideId: string, id: string): N {
  const e = elementsOf(doc, slideId).getAttr(id) as N | undefined;
  if (!e) throw new Error(`no element ${slideId}/${id}`);
  return e;
}
/** A node's plain attributes (its nested nodes left out), in a dictionary with no prototype. */
function scalarsOf(n: N, key: (k: string) => string = (k) => k, value: (v: Json) => Json = (v) => v): Scalars {
  const out = Object.create(null) as Scalars;
  for (const [k, v] of n.attrEntries() as Iterable<[string, unknown]>) if (!(v instanceof Y.Node)) out[key(k)] = value(v as Json);
  return out;
}

// The index's keys and values are any JSON the agent wrote (Claude: "keep every key"), but a Y.Node refuses the attribute
// `__proto__` and a value's object decodes through plain assignment. So the index is stored escaped: a key that is
// `__proto__` or starts with ESC gains a leading ESC, at every depth of a value, and is read back into dictionaries with
// no prototype.
const ESC = '\u0001';
const escKey = (k: string): string => (k === '__proto__' || k.startsWith(ESC) ? ESC + k : k);
const unescKey = (k: string): string => (k.startsWith(ESC) ? k.slice(1) : k);
function escJson(v: Json): Json {
  if (Array.isArray(v)) return v.map(escJson);
  if (v === null || typeof v !== 'object') return v;
  const out: Record<string, Json> = {};
  for (const k of Object.keys(v)) out[escKey(k)] = escJson(v[k]!);
  return out;
}
function unescJson(v: Json): Json {
  if (Array.isArray(v)) return v.map(unescJson);
  if (v === null || typeof v !== 'object') return v;
  const out = Object.create(null) as Record<string, Json>;
  for (const k of Object.keys(v)) out[unescKey(k)] = unescJson(v[k]!);
  return out;
}
const attrKeys = (n: N): string[] => [...(n.attrKeys() as Iterable<string>)];

// ---------------------------------------------------------------- deck

/** The index's plain keys (its maps left out), any key or nested key `__proto__` included. */
export function deckScalars(doc: Doc): Scalars {
  return scalarsOf(deckNode(doc), unescKey, unescJson);
}
export function setDeckKey(doc: Doc, key: string, v: Json): void {
  deckNode(doc).setAttr(escKey(key), escJson(v) as never);
}
export function deleteDeckKey(doc: Doc, key: string): void {
  deckNode(doc).deleteAttr(escKey(key));
}
function deckSub(doc: Doc, name: DeckMap, create: boolean): N | undefined {
  let m = deckNode(doc).getAttr(name) as N | undefined;
  if (!m && create) {
    m = new Y.Node(name);
    deckNode(doc).setAttr(name, m as never);
  }
  return m;
}
/** A nested map of the index, or undefined when the deck has none. */
export function deckEntries(doc: Doc, name: DeckMap): Record<string, Json> | undefined {
  const m = deckSub(doc, name, false);
  return m ? scalarsOf(m, unescKey, unescJson) : undefined;
}
/** Creates the nested map (empty) when the deck has none. */
export function ensureDeckMap(doc: Doc, name: DeckMap): void {
  deckSub(doc, name, true);
}
export function setDeckEntry(doc: Doc, name: DeckMap, key: string, v: Json): void {
  deckSub(doc, name, true)!.setAttr(escKey(key), escJson(v) as never);
}
export function deleteDeckEntry(doc: Doc, name: DeckMap, key: string): void {
  deckSub(doc, name, false)?.deleteAttr(escKey(key));
}
export function deleteDeckMap(doc: Doc, name: DeckMap): void {
  deckNode(doc).deleteAttr(name);
}

// ---------------------------------------------------------------- slides

export function slideIds(doc: Doc): string[] {
  return attrKeys(slidesNode(doc));
}
export function hasSlide(doc: Doc, id: string): boolean {
  return slidesNode(doc).hasAttr(id);
}
export function createSlide(doc: Doc, id: string, scalars: Scalars, notes: string): void {
  const s = new Y.Node('slide');
  slidesNode(doc).setAttr(id, s as never);
  for (const [k, v] of Object.entries(scalars)) s.setAttr(k, v as never);
  const t = new Y.Node('notes');
  s.setAttr('notes', t as never);
  if (notes) t.insert(0, notes);
  s.setAttr('elements', new Y.Node('elements') as never);
}
export function deleteSlide(doc: Doc, id: string): void {
  slidesNode(doc).deleteAttr(id);
}
export function slideScalars(doc: Doc, id: string): Scalars {
  return scalarsOf(slide(doc, id));
}
export function setSlideKey(doc: Doc, id: string, key: string, v: Json): void {
  slide(doc, id).setAttr(key, v as never);
}
export function deleteSlideKey(doc: Doc, id: string, key: string): void {
  slide(doc, id).deleteAttr(key);
}

type Op = { type: string; insert?: string | { name: string }[]; format?: Record<string, unknown> | null };
const opsOf = (n: N): Op[] => (n.toDelta().toJSON() as { children?: Op[] }).children ?? [];
const plainOf = (n: N): string =>
  opsOf(n)
    .map((o) => (typeof o.insert === 'string' ? o.insert : ''))
    .join('');
export function readNotes(doc: Doc, id: string): string {
  return plainOf(slide(doc, id).getAttr('notes') as N);
}
/** Notes change as a character diff, so a concurrent edit to other words survives. */
export function patchNotes(doc: Doc, id: string, next: string): boolean {
  const t = slide(doc, id).getAttr('notes') as N;
  const cur = plainOf(t);
  if (cur === next) return false;
  let at = 0;
  for (const [op, s] of diff(cur, next)) {
    if (op === diff.DELETE) t.delete(at, s.length);
    else if (op === diff.INSERT) {
      t.insert(at, s);
      at += s.length;
    } else at += s.length;
  }
  return true;
}

// ---------------------------------------------------------------- elements

export function elementIds(doc: Doc, slideId: string): string[] {
  return attrKeys(elementsOf(doc, slideId));
}
export function hasElement(doc: Doc, slideId: string, id: string): boolean {
  return hasSlide(doc, slideId) && elementsOf(doc, slideId).hasAttr(id);
}
export function elementScalars(doc: Doc, slideId: string, id: string): Scalars {
  return scalarsOf(element(doc, slideId, id));
}
export function allElementScalars(doc: Doc, slideId: string): Map<string, Scalars> {
  const out = new Map<string, Scalars>();
  for (const [id, n] of elementsOf(doc, slideId).attrEntries() as Iterable<[string, N]>) out.set(id, scalarsOf(n));
  return out;
}
export function createElement(doc: Doc, slideId: string, id: string, scalars: Scalars, text?: TextBlock[]): void {
  const n = new Y.Node('el');
  elementsOf(doc, slideId).setAttr(id, n as never);
  for (const [k, v] of Object.entries(scalars)) n.setAttr(k, v as never);
  if (text) writeText(doc, slideId, id, text);
}
export function deleteElement(doc: Doc, slideId: string, id: string): void {
  elementsOf(doc, slideId).deleteAttr(id);
}
export function setElementKey(doc: Doc, slideId: string, id: string, key: string, v: Json): void {
  element(doc, slideId, id).setAttr(key, v as never);
}
export function deleteElementKey(doc: Doc, slideId: string, id: string, key: string): void {
  element(doc, slideId, id).deleteAttr(key);
}

// ---------------------------------------------------------------- text (a nested <doc> node per text element)

export function hasText(doc: Doc, slideId: string, id: string): boolean {
  return element(doc, slideId, id).getAttr('text') instanceof Y.Node;
}
export function removeText(doc: Doc, slideId: string, id: string): void {
  element(doc, slideId, id).deleteAttr('text');
}

function marksOf(format: Record<string, unknown> | null | undefined): Marks {
  const m: Marks = {};
  if (format) for (const k of MARK_ORDER) if (format[k] != null) (m as Record<string, unknown>)[k] = format[k];
  return m;
}
const markKey = (m: Marks) => JSON.stringify(m);
const BR = ' '; // a <br> node is one position in the block's sequence; in the diff string it is this character
const BR_KEY = '<br>';

function readBlock(n: N): TextBlock {
  const inline: Inline[] = [];
  for (const op of opsOf(n)) {
    if (typeof op.insert === 'string') {
      const marks = marksOf(op.format);
      const last = inline[inline.length - 1];
      if (last && 'text' in last && markKey(last.marks) === markKey(marks)) last.text += op.insert;
      else inline.push({ text: op.insert, marks });
    } else if (Array.isArray(op.insert)) for (const node of op.insert) if (node.name === 'br') inline.push({ br: true });
  }
  return { type: n.name === 'li' ? 'li' : 'p', inline };
}
const blocksOf = (f: N): N[] => f.toArray().filter((c): c is N => c instanceof Y.Node);
export function readText(doc: Doc, slideId: string, id: string): TextBlock[] {
  const f = element(doc, slideId, id).getAttr('text');
  return f instanceof Y.Node ? blocksOf(f).map(readBlock) : [];
}

/** Insert inline content at `at` with explicit formats (nothing inherited from the left). Returns the new position. */
function insertInline(b: N, at: number, inline: Inline[]): number {
  for (const r of inline) {
    if ('br' in r) {
      b.insert(at, [new Y.Node('br')]);
      at++;
      continue;
    }
    if (!r.text) continue;
    b.insert(at, r.text, explicit(r.marks));
    at += r.text.length;
  }
  return at;
}
function explicit(m: Marks): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  for (const k of MARK_ORDER) f[k] = (m as Record<string, unknown>)[k] ?? null;
  return f;
}
function newBlock(f: N, at: number, block: TextBlock): void {
  const b = new Y.Node(block.type);
  f.insert(at, [b]);
  insertInline(b, 0, block.inline);
}
export function writeText(doc: Doc, slideId: string, id: string, blocks: TextBlock[]): void {
  const f = new Y.Node('doc');
  element(doc, slideId, id).setAttr('text', f as never);
  blocks.forEach((b, i) => newBlock(f, i, b));
}

/** The block as one string (a <br> is BR) and one mark key per position. */
function explode(inline: Inline[]): { s: string; m: string[] } {
  let s = '';
  const m: string[] = [];
  for (const r of inline) {
    if ('br' in r) {
      s += BR;
      m.push(BR_KEY);
      continue;
    }
    s += r.text;
    for (let i = 0; i < r.text.length; i++) m.push(markKey(r.marks));
  }
  return { s, m };
}

/**
 * Patch one block to `next` with the fewest operations: fast-diff over the block's positions (text and <br> alike, so a
 * changed line break is a character-level edit on v14), then `format` over retained text whose marks changed.
 */
function patchBlock(b: N, next: Inline[]): number {
  const cur = explode(readBlock(b).inline);
  const nx = explode(next);
  if (cur.s === nx.s && cur.m.join('\u0000') === nx.m.join('\u0000')) return 0;
  let ops = 0;
  let at = 0;
  let oi = 0;
  let ni = 0;
  for (const [op, s] of diff(cur.s, nx.s)) {
    if (op === diff.DELETE) {
      b.delete(at, s.length);
      oi += s.length;
      ops++;
      continue;
    }
    if (op === diff.INSERT) {
      const runs: Inline[] = [];
      for (let k = 0; k < s.length; k++) {
        const mk = nx.m[ni + k]!;
        if (mk === BR_KEY) {
          runs.push({ br: true });
          continue;
        }
        const last = runs[runs.length - 1];
        if (last && 'text' in last && markKey(last.marks) === mk) last.text += s[k];
        else runs.push({ text: s[k]!, marks: JSON.parse(mk) as Marks });
      }
      at = insertInline(b, at, runs);
      ni += s.length;
      ops += runs.length;
      continue;
    }
    let k = 0;
    while (k < s.length) {
      const om = cur.m[oi + k]!;
      const nm = nx.m[ni + k]!;
      if (om === nm || om === BR_KEY) {
        k++;
        continue;
      }
      let j = k + 1;
      while (j < s.length && cur.m[oi + j] === om && nx.m[ni + j] === nm) j++;
      const o = JSON.parse(om) as Record<string, unknown>;
      const n = JSON.parse(nm) as Record<string, unknown>;
      const delta: Record<string, unknown> = {};
      for (const name of MARK_ORDER) if (JSON.stringify(o[name]) !== JSON.stringify(n[name])) delta[name] = n[name] ?? null;
      b.format(at + k, j - k, delta);
      ops++;
      k = j;
    }
    at += s.length;
    oi += s.length;
    ni += s.length;
  }
  return ops;
}

/**
 * Patch a text element's <doc> to `blocks`: unchanged blocks untouched; equal prefix and suffix kept; a block of the
 * same kind patched character by character (line breaks included); a different count replaced block-wise.
 */
export function patchText(doc: Doc, slideId: string, id: string, blocks: TextBlock[]): number {
  const f = element(doc, slideId, id).getAttr('text');
  if (!(f instanceof Y.Node)) {
    writeText(doc, slideId, id, blocks);
    return 1;
  }
  const els = blocksOf(f);
  const cur = els.map(readBlock);
  const same = (a: TextBlock, b: TextBlock) => JSON.stringify(a) === JSON.stringify(b);
  let pre = 0;
  while (pre < cur.length && pre < blocks.length && same(cur[pre]!, blocks[pre]!)) pre++;
  let suf = 0;
  while (suf < cur.length - pre && suf < blocks.length - pre && same(cur[cur.length - 1 - suf]!, blocks[blocks.length - 1 - suf]!)) suf++;
  const curMid = els.slice(pre, els.length - suf);
  const nextMid = blocks.slice(pre, blocks.length - suf);
  if (curMid.length === nextMid.length) {
    let ops = 0;
    curMid.forEach((b, i) => {
      if (b.name === nextMid[i]!.type) ops += patchBlock(b, nextMid[i]!.inline);
      else {
        const at = pre + i;
        f.delete(at, 1);
        newBlock(f, at, nextMid[i]!);
        ops++;
      }
    });
    return ops;
  }
  f.delete(pre, curMid.length);
  nextMid.forEach((b, i) => newBlock(f, pre + i, b));
  return curMid.length + nextMid.length;
}

// ---------------------------------------------------------------- threads (D9; M7 builds the thread module on these)

/** A new thread, `threadId → <thread>` with its scalars; its messages are appended by `postMessage`. */
export function createThread(doc: Doc, threadId: string, scalars: Scalars): void {
  const t = new Y.Node('thread');
  doc.get(THREADS_ROOT).setAttr(threadId, t as never);
  for (const [k, v] of Object.entries(scalars)) t.setAttr(k, v as never);
}
export function threadIds(doc: Doc): string[] {
  return attrKeys(doc.get(THREADS_ROOT));
}
function thread(doc: Doc, threadId: string): N {
  const t = doc.get(THREADS_ROOT).getAttr(threadId) as N | undefined;
  if (!t) throw new Error(`no thread ${threadId}`);
  return t;
}
export function threadScalars(doc: Doc, threadId: string): Scalars {
  return scalarsOf(thread(doc, threadId));
}
export function setThreadKey(doc: Doc, threadId: string, key: string, v: Json): void {
  thread(doc, threadId).setAttr(key, v as never);
}
/** A message appended to the thread's child sequence (one item per message, so a reply never races a resolve). */
export function postMessage(doc: Doc, threadId: string, message: Json): void {
  thread(doc, threadId).push([message as never]);
}
export function threadMessages(doc: Doc, threadId: string): Json[] {
  return thread(doc, threadId).toArray() as Json[];
}

// ---------------------------------------------------------------- the host's hooks

type Struct = Y.Item | Y.GC | Y.Skip;

/**
 * The slides an update touched (its inserted and deleted content, each followed up its parents to the `slides` root),
 * so the host repairs only those (D5). Null when that cannot be told: some content of the update is not in `doc`.
 * Content collected since (a deleted element's insides) is skipped: the element's own entry still names its slide.
 */
export function touchedSlides(doc: Doc, update: Uint8Array): Set<string> | null {
  const ids = Y.createContentIdsFromUpdate(update);
  const root = slidesNode(doc);
  const out = new Set<string>();
  let unknown = false;
  const visit = (set: Y.IdSet) =>
    set.forEach((range, client) => {
      if (unknown) return;
      const structs = doc.store.clients.get(client) as Struct[] | undefined;
      if (!structs) {
        unknown = true;
        return;
      }
      const end = range.clock + range.len;
      let i: number;
      try {
        i = Y.findIndexSS(structs, range.clock);
      } catch {
        unknown = true;
        return;
      }
      for (; i < structs.length && structs[i]!.id.clock < end; i++) {
        const struct = structs[i]!;
        if (!(struct instanceof Y.Item)) continue;
        const id = slideOf(struct, root);
        if (id === undefined) {
          unknown = true;
          return;
        }
        if (id !== null) out.add(id);
      }
    });
  visit(ids.inserts);
  visit(ids.deletes);
  return unknown ? null : out;
}

/** The slide an item sits in: its id, null when it is outside `slides`, undefined when its parent is not loaded. */
function slideOf(item: Y.Item, root: N): string | null | undefined {
  for (let it: Y.Item = item; ; ) {
    const parent = it.parent;
    if (!(parent instanceof Y.Node)) return undefined;
    if (parent === root) return it.parentSub;
    if (parent._item === null) return null; // another root: deck, threads
    it = parent._item;
  }
}

/**
 * What a restore keeps of the conversations (parent Decision Log 32; D5's `revertScope`): every message appended to a
 * thread since `old`, and every thread created since, whole. Thread scalars set since on a thread `old` had (its status,
 * who resolved it) are not kept, so a restore reverts them.
 */
export function conversationsSince(live: Doc, old: Doc): ContentIds {
  const sv = Y.decodeStateVector(Y.encodeStateVector(old));
  const inserts = Y.createIdSet();
  const since = (item: Y.Item): boolean => item.id.clock + item.length > (sv.get(item.id.client) ?? 0);
  const keep = (item: Y.Item) => {
    const from = Math.max(item.id.clock, sv.get(item.id.client) ?? 0);
    const end = item.id.clock + item.length;
    if (end > from) inserts.add(item.id.client, from, end - from);
  };
  const keepWhole = (node: N) => {
    for (const last of node._map.values()) for (let it: Y.Item | null = last; it !== null; it = it.left) keepItem(it);
    for (let it = node._start; it !== null; it = it.right) keepItem(it);
  };
  const keepItem = (item: Y.Item) => {
    keep(item);
    if (item.content instanceof Y.ContentType) keepWhole(item.content.type as N);
  };
  for (const item of live.get(THREADS_ROOT)._map.values()) {
    if (item.deleted || !(item.content instanceof Y.ContentType)) continue;
    const node = item.content.type as N;
    if (since(item)) keepItem(item);
    else for (let it = node._start; it !== null; it = it.right) if (since(it)) keepItem(it);
  }
  return Y.createContentIds(inserts, Y.createIdSet());
}

// ---------------------------------------------------------------- observation

export type Change =
  | { kind: 'slide'; keys: string[] }
  | { kind: 'notes' }
  | { kind: 'added' | 'removed'; id: string }
  | { kind: 'element'; id: string; keys: string[] }
  | { kind: 'text'; id: string };

type AttrOp = { type: 'insert' | 'delete' | 'modify'; value?: { attrs?: Record<string, AttrOp> } };

/** Deep changes of one slide as model-level records, read from v14's deep delta (one event per transaction). */
export function observeSlide(doc: Doc, slideId: string, cb: (changes: Change[], origin: unknown, local: boolean) => void): () => void {
  const s = slide(doc, slideId);
  const h = (ev: Y.YEvent<never>, tx: Y.Transaction) => {
    const attrs = (ev.deltaDeep.toJSON() as { attrs?: Record<string, AttrOp> }).attrs ?? {};
    const out: Change[] = [];
    const slideKeys = Object.keys(attrs).filter((k) => k !== 'notes' && k !== 'elements');
    if (slideKeys.length) out.push({ kind: 'slide', keys: slideKeys });
    if (attrs.notes) out.push({ kind: 'notes' });
    for (const [id, op] of Object.entries(attrs.elements?.value?.attrs ?? {})) {
      if (op.type === 'delete') out.push({ kind: 'removed', id });
      else if (op.type === 'insert') out.push({ kind: 'removed', id }, { kind: 'added', id });
      else {
        const keys = Object.keys(op.value?.attrs ?? {});
        if (keys.includes('text')) out.push({ kind: 'text', id });
        const rest = keys.filter((k) => k !== 'text');
        if (rest.length) out.push({ kind: 'element', id, keys: rest });
      }
    }
    if (out.length) cb(out, tx.origin, tx.local);
  };
  s.observeDeep(h as never);
  return () => s.unobserveDeep(h as never);
}
