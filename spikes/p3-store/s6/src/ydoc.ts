// The Yjs seam: the only module that imports yjs. Everything else speaks the model's terms (slides, elements, keys,
// text blocks, change records). A v14 port rewrites this file; see the findings for what it touches.
//
// Layout of one deck's Y.Doc:
//   deck:   Y.Map  — deck.json's keys but `order` (JSON values), `sections` and `faces` as Y.Map key → JSON
//   slides: Y.Map  id → Y.Map {
//             order: fractional key, 'style:<prop>': string, 'attr:<name>': string, held?: {source, reasons},
//             notes: Y.Text,
//             elements: Y.Map id → Y.Map { tag, parent, order | z, 'style:*', 'attr:*', raw?: string,
//                                          text?: Y.XmlFragment (y-prosemirror shape: <p>|<li> blocks of Y.XmlText + <br>) } }

import * as Y from 'yjs'
import diff from 'fast-diff'
import { type Inline, type Marks, type TextBlock, MARK_ORDER } from './ir.ts'

export type Doc = Y.Doc
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json }
export type Scalars = Record<string, Json>

export function newDoc(clientID?: number): Doc {
  const d = new Y.Doc({ gc: true })
  if (clientID !== undefined) d.clientID = clientID
  return d
}
export function transact(doc: Doc, fn: () => void, origin?: unknown): void { doc.transact(fn, origin) }
export const encodeStateV1 = (doc: Doc): Uint8Array => Y.encodeStateAsUpdate(doc)
export const encodeStateV2 = (doc: Doc): Uint8Array => Y.encodeStateAsUpdateV2(doc)
export const stateVector = (doc: Doc): Uint8Array => Y.encodeStateVector(doc)
export const diffSince = (doc: Doc, sv: Uint8Array): Uint8Array => Y.encodeStateAsUpdate(doc, sv)
export const applyUpdate = (doc: Doc, u: Uint8Array, origin?: unknown): void => Y.applyUpdate(doc, u, origin)
export const applyUpdateV2 = (doc: Doc, u: Uint8Array, origin?: unknown): void => Y.applyUpdateV2(doc, u, origin)
export function onUpdate(doc: Doc, cb: (update: Uint8Array, origin: unknown) => void): () => void {
  const h = (u: Uint8Array, o: unknown) => cb(u, o); doc.on('update', h); return () => doc.off('update', h)
}
export function onUpdateV2(doc: Doc, cb: (update: Uint8Array, origin: unknown) => void): () => void {
  const h = (u: Uint8Array, o: unknown) => cb(u, o); doc.on('updateV2', h); return () => doc.off('updateV2', h)
}
/** Bring `to` up to `from` (one direction of a y-protocols sync step 2). Returns the bytes sent. */
export function pull(to: Doc, from: Doc, origin?: unknown): number {
  const u = Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)); Y.applyUpdate(to, u, origin); return u.length
}

const slidesMap = (doc: Doc) => doc.getMap<Y.Map<unknown>>('slides')
const deckMap = (doc: Doc) => doc.getMap<unknown>('deck')
function slide(doc: Doc, id: string): Y.Map<unknown> {
  const s = slidesMap(doc).get(id); if (!s) throw new Error(`no slide ${id}`); return s
}
const elementsOf = (doc: Doc, slideId: string) => slide(doc, slideId).get('elements') as Y.Map<Y.Map<unknown>>
function element(doc: Doc, slideId: string, id: string): Y.Map<unknown> {
  const e = elementsOf(doc, slideId).get(id); if (!e) throw new Error(`no element ${slideId}/${id}`); return e
}
function scalarsOf(m: Y.Map<unknown>): Scalars {
  const out: Scalars = {}
  for (const [k, v] of m.entries()) if (!(v instanceof Y.AbstractType)) out[k] = v as Json
  return out
}

// ---------------------------------------------------------------- deck

export function deckScalars(doc: Doc): Scalars { return scalarsOf(deckMap(doc)) }
export function setDeckKey(doc: Doc, key: string, v: Json): void { deckMap(doc).set(key, v) }
export function deleteDeckKey(doc: Doc, key: string): void { deckMap(doc).delete(key) }
function deckSub(doc: Doc, name: string, create: boolean): Y.Map<Json> | undefined {
  let m = deckMap(doc).get(name) as Y.Map<Json> | undefined
  if (!m && create) { m = new Y.Map<Json>(); deckMap(doc).set(name, m) }
  return m
}
export function deckEntries(doc: Doc, name: 'sections' | 'faces'): Record<string, Json> | undefined {
  const m = deckSub(doc, name, false); return m ? Object.fromEntries(m.entries()) : undefined
}
export function setDeckEntry(doc: Doc, name: 'sections' | 'faces', key: string, v: Json): void { deckSub(doc, name, true)!.set(key, v) }
export function deleteDeckEntry(doc: Doc, name: 'sections' | 'faces', key: string): void { deckSub(doc, name, false)?.delete(key) }
export function deleteDeckSub(doc: Doc, name: 'sections' | 'faces'): void { deckMap(doc).delete(name) }

// ---------------------------------------------------------------- slides

export function slideIds(doc: Doc): string[] { return [...slidesMap(doc).keys()] }
export function hasSlide(doc: Doc, id: string): boolean { return slidesMap(doc).has(id) }
export function createSlide(doc: Doc, id: string, scalars: Scalars, notes: string): void {
  const s = new Y.Map<unknown>()
  slidesMap(doc).set(id, s)
  for (const [k, v] of Object.entries(scalars)) s.set(k, v)
  const t = new Y.Text(); s.set('notes', t); if (notes) t.insert(0, notes)
  s.set('elements', new Y.Map())
}
export function deleteSlide(doc: Doc, id: string): void { slidesMap(doc).delete(id) }
export function slideScalars(doc: Doc, id: string): Scalars { return scalarsOf(slide(doc, id)) }
export function setSlideKey(doc: Doc, id: string, key: string, v: Json): void { slide(doc, id).set(key, v) }
export function deleteSlideKey(doc: Doc, id: string, key: string): void { slide(doc, id).delete(key) }
export function readNotes(doc: Doc, id: string): string { return (slide(doc, id).get('notes') as Y.Text).toString() }
/** Notes change as a character diff, so a concurrent edit to other words survives. */
export function patchNotes(doc: Doc, id: string, next: string): boolean { return patchPlain(slide(doc, id).get('notes') as Y.Text, next) }

// ---------------------------------------------------------------- elements

export function elementIds(doc: Doc, slideId: string): string[] { return [...elementsOf(doc, slideId).keys()] }
export function hasElement(doc: Doc, slideId: string, id: string): boolean { return hasSlide(doc, slideId) && elementsOf(doc, slideId).has(id) }
export function elementScalars(doc: Doc, slideId: string, id: string): Scalars { return scalarsOf(element(doc, slideId, id)) }
export function allElementScalars(doc: Doc, slideId: string): Map<string, Scalars> {
  const out = new Map<string, Scalars>()
  for (const [id, m] of elementsOf(doc, slideId).entries()) out.set(id, scalarsOf(m))
  return out
}
export function createElement(doc: Doc, slideId: string, id: string, scalars: Scalars, text?: TextBlock[]): void {
  const m = new Y.Map<unknown>()
  elementsOf(doc, slideId).set(id, m)
  for (const [k, v] of Object.entries(scalars)) m.set(k, v)
  if (text) writeText(doc, slideId, id, text)
}
export function deleteElement(doc: Doc, slideId: string, id: string): void { elementsOf(doc, slideId).delete(id) }
export function setElementKey(doc: Doc, slideId: string, id: string, key: string, v: Json): void { element(doc, slideId, id).set(key, v) }
export function deleteElementKey(doc: Doc, slideId: string, id: string, key: string): void { element(doc, slideId, id).delete(key) }

// ---------------------------------------------------------------- text (a nested Y.XmlFragment per text element)

export function hasText(doc: Doc, slideId: string, id: string): boolean { return element(doc, slideId, id).get('text') instanceof Y.XmlFragment }
export function removeText(doc: Doc, slideId: string, id: string): void { element(doc, slideId, id).delete('text') }

function marksOf(attrs: Record<string, unknown> | undefined): Marks {
  const m: Marks = {}
  if (attrs) for (const k of MARK_ORDER) if (attrs[k] != null) (m as Record<string, unknown>)[k] = attrs[k]
  return m
}
const markKey = (m: Marks) => JSON.stringify(m)

function readBlock(el: Y.XmlElement): TextBlock {
  const inline: Inline[] = []
  for (const c of el.toArray()) {
    if (c instanceof Y.XmlText) {
      for (const op of c.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]) {
        if (typeof op.insert !== 'string') continue
        const marks = marksOf(op.attributes)
        const last = inline[inline.length - 1]
        if (last && 'text' in last && markKey(last.marks) === markKey(marks)) last.text += op.insert
        else inline.push({ text: op.insert, marks })
      }
    } else if (c instanceof Y.XmlElement && c.nodeName === 'br') inline.push({ br: true })
  }
  return { type: el.nodeName === 'li' ? 'li' : 'p', inline }
}
export function readText(doc: Doc, slideId: string, id: string): TextBlock[] {
  const f = element(doc, slideId, id).get('text')
  if (!(f instanceof Y.XmlFragment)) return []
  return f.toArray().filter((c): c is Y.XmlElement => c instanceof Y.XmlElement).map(readBlock)
}

/** Insert runs into an integrated XmlText at `at`. An explicit attribute object, so nothing is inherited from the left. */
function insertRuns(t: Y.XmlText, at: number, runs: { text: string; marks: Marks }[]): number {
  for (const r of runs) { if (!r.text) continue; t.insert(at, r.text, { ...r.marks }); at += r.text.length }
  return at
}
function segments(inline: Inline[]): { text: string; marks: Marks }[][] {
  const segs: { text: string; marks: Marks }[][] = [[]]
  for (const r of inline) { if ('br' in r) segs.push([]); else segs[segs.length - 1].push(r) }
  return segs
}
function fillBlock(el: Y.XmlElement, block: TextBlock): void {
  segments(block.inline).forEach((seg, i) => {
    if (i > 0) el.push([new Y.XmlElement('br')])
    if (seg.some((r) => r.text)) { const t = new Y.XmlText(); el.push([t]); insertRuns(t, 0, seg) }
  })
}
function newBlock(f: Y.XmlFragment, at: number, block: TextBlock): void {
  const el = new Y.XmlElement(block.type); f.insert(at, [el]); fillBlock(el, block)
}
export function writeText(doc: Doc, slideId: string, id: string, blocks: TextBlock[]): void {
  const f = new Y.XmlFragment(); element(doc, slideId, id).set('text', f)
  blocks.forEach((b, i) => newBlock(f, i, b))
}

/** Per-character marks of a run list, for the diff. */
function explode(runs: { text: string; marks: Marks }[]): { s: string; m: string[] } {
  let s = ''; const m: string[] = []
  for (const r of runs) { s += r.text; for (let i = 0; i < r.text.length; i++) m.push(markKey(r.marks)) }
  return { s, m }
}

/**
 * Patch one XmlText from its current runs to `next` with the fewest operations: fast-diff over the characters for
 * inserts and deletes, then `format` over retained characters whose marks changed. Concurrent edits elsewhere in the
 * same text survive (character-level CRDT merge).
 */
function patchXmlText(t: Y.XmlText, next: { text: string; marks: Marks }[]): number {
  const cur = explode((t.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[])
    .filter((o) => typeof o.insert === 'string').map((o) => ({ text: o.insert as string, marks: marksOf(o.attributes) })))
  const nx = explode(next)
  if (cur.s === nx.s && cur.m.join('\u0000') === nx.m.join('\u0000')) return 0
  let ops = 0, at = 0, oi = 0, ni = 0
  for (const [op, s] of diff(cur.s, nx.s)) {
    if (op === diff.DELETE) { t.delete(at, s.length); oi += s.length; ops++; continue }
    if (op === diff.INSERT) {
      const runs: { text: string; marks: Marks }[] = []
      for (let k = 0; k < s.length; k++) {
        const mk = nx.m[ni + k]; const last = runs[runs.length - 1]
        if (last && markKey(last.marks) === mk) last.text += s[k]; else runs.push({ text: s[k], marks: JSON.parse(mk) })
      }
      at = insertRuns(t, at, runs); ni += s.length; ops += runs.length; continue
    }
    // retained: re-format runs whose marks differ
    let k = 0
    while (k < s.length) {
      const om = cur.m[oi + k], nm = nx.m[ni + k]
      if (om === nm) { k++; continue }
      let j = k + 1
      while (j < s.length && cur.m[oi + j] === om && nx.m[ni + j] === nm) j++
      const o = JSON.parse(om) as Record<string, unknown>, n = JSON.parse(nm) as Record<string, unknown>
      const delta: Record<string, unknown> = {}
      for (const name of MARK_ORDER) if (JSON.stringify(o[name]) !== JSON.stringify(n[name])) delta[name] = n[name] ?? null
      t.format(at + k, j - k, delta); ops++
      k = j
    }
    at += s.length; oi += s.length; ni += s.length
  }
  return ops
}
function patchPlain(t: Y.Text, next: string): boolean {
  const cur = t.toString(); if (cur === next) return false
  let at = 0
  for (const [op, s] of diff(cur, next)) {
    if (op === diff.DELETE) t.delete(at, s.length)
    else if (op === diff.INSERT) { t.insert(at, s); at += s.length } else at += s.length
  }
  return true
}

/** The block's slots: one entry per <br>-separated segment, its XmlText or null when the segment is empty. */
function slots(el: Y.XmlElement): (Y.XmlText | null)[] | null {
  const out: (Y.XmlText | null)[] = [null]
  for (const c of el.toArray()) {
    if (c instanceof Y.XmlText) { if (out[out.length - 1]) return null; out[out.length - 1] = c }
    else if (c instanceof Y.XmlElement && c.nodeName === 'br') out.push(null)
    else return null
  }
  return out
}

function slotIndex(el: Y.XmlElement, k: number): number {
  if (k === 0) return 0
  const arr = el.toArray(); let brs = 0
  for (let j = 0; j < arr.length; j++) if (arr[j] instanceof Y.XmlElement && ++brs === k) return j + 1
  return arr.length
}

/**
 * Patch a text element's fragment to `blocks`: unchanged blocks untouched; equal prefix and suffix kept; a block whose
 * <br> shape is unchanged patched character by character; anything else replaced block-wise. Returns ops written.
 */
export function patchText(doc: Doc, slideId: string, id: string, blocks: TextBlock[]): number {
  const f = element(doc, slideId, id).get('text')
  if (!(f instanceof Y.XmlFragment)) { writeText(doc, slideId, id, blocks); return 1 }
  const els = f.toArray().filter((c): c is Y.XmlElement => c instanceof Y.XmlElement)
  const cur = els.map(readBlock)
  const same = (a: TextBlock, b: TextBlock) => JSON.stringify(a) === JSON.stringify(b)
  let pre = 0
  while (pre < cur.length && pre < blocks.length && same(cur[pre], blocks[pre])) pre++
  let suf = 0
  while (suf < cur.length - pre && suf < blocks.length - pre && same(cur[cur.length - 1 - suf], blocks[blocks.length - 1 - suf])) suf++
  const curMid = els.slice(pre, els.length - suf), nextMid = blocks.slice(pre, blocks.length - suf)
  let ops = 0
  if (curMid.length === nextMid.length) {
    curMid.forEach((el, i) => {
      const nb = nextMid[i]; const sl = slots(el); const segs = segments(nb.inline)
      if (el.nodeName === nb.type && sl && sl.length === segs.length) {
        sl.forEach((t, k) => {
          if (t) ops += patchXmlText(t, segs[k])
          else if (segs[k].some((r) => r.text)) {
            // an empty segment gains text: a new XmlText right after the k-th <br> (or at the start)
            const nt = new Y.XmlText(); el.insert(slotIndex(el, k), [nt]); insertRuns(nt, 0, segs[k]); ops++
          }
        })
      } else {
        const at = pre + i; f.delete(at, 1); newBlock(f, at, nb); ops++
      }
    })
    return ops
  }
  f.delete(pre, curMid.length)
  nextMid.forEach((b, i) => newBlock(f, pre + i, b))
  return curMid.length + nextMid.length
}

// ---------------------------------------------------------------- observation

export type Change =
  | { kind: 'slide'; keys: string[] }
  | { kind: 'notes' }
  | { kind: 'added' | 'removed'; id: string }
  | { kind: 'element'; id: string; keys: string[] }
  | { kind: 'text'; id: string }

/** Deep changes of one slide as model-level records (what changed, never how Yjs represents it). */
export function observeSlide(doc: Doc, slideId: string, cb: (changes: Change[], origin: unknown, local: boolean) => void): () => void {
  const s = slide(doc, slideId)
  const h = (events: Y.YEvent<Y.AbstractType<unknown>>[], tx: Y.Transaction) => {
    const out: Change[] = []
    for (const ev of events) {
      const path = ev.path as (string | number)[]
      if (path.length === 0) {
        const keys = [...ev.changes.keys.keys()].filter((k) => k !== 'notes' && k !== 'elements') as string[]
        if (keys.length) out.push({ kind: 'slide', keys })
      } else if (path[0] === 'notes') out.push({ kind: 'notes' })
      else if (path[0] === 'elements' && path.length === 1) {
        for (const [id, ch] of (ev as Y.YMapEvent<unknown>).changes.keys) {
          if (ch.action !== 'add') out.push({ kind: 'removed', id })
          if (ch.action !== 'delete') out.push({ kind: 'added', id })
        }
      } else if (path[0] === 'elements') {
        const id = String(path[1])
        if (path.length === 2) {
          const keys = [...ev.changes.keys.keys()] as string[]
          if (keys.includes('text')) out.push({ kind: 'text', id })
          const rest = keys.filter((k) => k !== 'text'); if (rest.length) out.push({ kind: 'element', id, keys: rest })
        } else out.push({ kind: 'text', id })
      }
    }
    if (out.length) cb(out, tx.origin, tx.local)
  }
  s.observeDeep(h)
  return () => s.unobserveDeep(h)
}
