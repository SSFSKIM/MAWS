// The Yjs seam on v14 (@y/y 14.0.0-rc.28): the only module that imports @y/y. Everything else speaks the model's terms
// (slides, elements, keys, text blocks, change records). Same exported API as the v13 seam (ydoc-v13.ts).
//
// v14 has one type, Y.Node: a name, attributes (a map: plain values or nested nodes) and children (text with formats and
// nodes, inline in one sequence). Layout of one deck's Y.Doc:
//   deck:   root node — deck.json's keys but `order` as JSON attributes; `sections`, `faces` nested nodes, key → JSON
//   slides: root node — attribute id → <slide> {
//             order, 'style:<prop>', 'attr:<name>', held?: {source, reasons}   (attributes)
//             notes: <notes> node (plain text children),
//             elements: <elements> node, attribute id → <el> { tag, parent, order | z, 'style:*', 'attr:*', raw?,
//                       text?: <doc> node: <p>|<li> blocks of text (marks as formats {b:{}}, {a:{href}}, …) and <br> nodes
//                       — @y/prosemirror 2's node shape, so a Tiptap text box binds to it } }

import * as Y from '@y/y'
import diff from 'fast-diff'
import { type Inline, type Marks, type TextBlock, MARK_ORDER } from './ir.ts'

export const SEAM = 'v14 @y/y 14.0.0-rc.28'
export type Doc = Y.Doc
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json }
export type Scalars = Record<string, Json>
type N = Y.Node

export function newDoc(clientID?: number): Doc {
  const d = new Y.Doc({ gc: true })
  if (clientID !== undefined) d.clientID = clientID
  return d
}
export function transact(doc: Doc, fn: () => void, origin?: unknown): void { doc.transact(() => fn(), origin) }
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

const slidesNode = (doc: Doc): N => doc.get('slides')
const deckNode = (doc: Doc): N => doc.get('deck')
function slide(doc: Doc, id: string): N {
  const s = slidesNode(doc).getAttr(id) as N | undefined; if (!s) throw new Error(`no slide ${id}`); return s
}
const elementsOf = (doc: Doc, slideId: string): N => slide(doc, slideId).getAttr('elements') as N
function element(doc: Doc, slideId: string, id: string): N {
  const e = elementsOf(doc, slideId).getAttr(id) as N | undefined; if (!e) throw new Error(`no element ${slideId}/${id}`); return e
}
function scalarsOf(n: N): Scalars {
  const out: Scalars = {}
  for (const [k, v] of n.attrEntries() as Iterable<[string, unknown]>) if (!(v instanceof Y.Node)) out[k] = v as Json
  return out
}
const attrKeys = (n: N): string[] => [...(n.attrKeys() as Iterable<string>)]

// ---------------------------------------------------------------- deck

export function deckScalars(doc: Doc): Scalars { return scalarsOf(deckNode(doc)) }
export function setDeckKey(doc: Doc, key: string, v: Json): void { deckNode(doc).setAttr(key, v as never) }
export function deleteDeckKey(doc: Doc, key: string): void { deckNode(doc).deleteAttr(key) }
function deckSub(doc: Doc, name: string, create: boolean): N | undefined {
  let m = deckNode(doc).getAttr(name) as N | undefined
  if (!m && create) { m = new Y.Node(name); deckNode(doc).setAttr(name, m as never) }
  return m
}
export function deckEntries(doc: Doc, name: 'sections' | 'faces'): Record<string, Json> | undefined {
  const m = deckSub(doc, name, false); return m ? scalarsOf(m) : undefined
}
export function setDeckEntry(doc: Doc, name: 'sections' | 'faces', key: string, v: Json): void { deckSub(doc, name, true)!.setAttr(key, v as never) }
export function deleteDeckEntry(doc: Doc, name: 'sections' | 'faces', key: string): void { deckSub(doc, name, false)?.deleteAttr(key) }
export function deleteDeckSub(doc: Doc, name: 'sections' | 'faces'): void { deckNode(doc).deleteAttr(name) }

// ---------------------------------------------------------------- slides

export function slideIds(doc: Doc): string[] { return attrKeys(slidesNode(doc)) }
export function hasSlide(doc: Doc, id: string): boolean { return slidesNode(doc).hasAttr(id) }
export function createSlide(doc: Doc, id: string, scalars: Scalars, notes: string): void {
  const s = new Y.Node('slide')
  slidesNode(doc).setAttr(id, s as never)
  for (const [k, v] of Object.entries(scalars)) s.setAttr(k, v as never)
  const t = new Y.Node('notes'); s.setAttr('notes', t as never); if (notes) t.insert(0, notes)
  s.setAttr('elements', new Y.Node('elements') as never)
}
export function deleteSlide(doc: Doc, id: string): void { slidesNode(doc).deleteAttr(id) }
export function slideScalars(doc: Doc, id: string): Scalars { return scalarsOf(slide(doc, id)) }
export function setSlideKey(doc: Doc, id: string, key: string, v: Json): void { slide(doc, id).setAttr(key, v as never) }
export function deleteSlideKey(doc: Doc, id: string, key: string): void { slide(doc, id).deleteAttr(key) }

type Op = { type: string; insert?: string | { name: string }[]; format?: Record<string, unknown> | null }
const opsOf = (n: N): Op[] => (n.toDelta().toJSON() as { children?: Op[] }).children ?? []
function plainOf(n: N): string { return opsOf(n).map((o) => (typeof o.insert === 'string' ? o.insert : '')).join('') }
export function readNotes(doc: Doc, id: string): string { return plainOf(slide(doc, id).getAttr('notes') as N) }
/** Notes change as a character diff, so a concurrent edit to other words survives. */
export function patchNotes(doc: Doc, id: string, next: string): boolean {
  const t = slide(doc, id).getAttr('notes') as N
  const cur = plainOf(t); if (cur === next) return false
  let at = 0
  for (const [op, s] of diff(cur, next)) {
    if (op === diff.DELETE) t.delete(at, s.length)
    else if (op === diff.INSERT) { t.insert(at, s); at += s.length } else at += s.length
  }
  return true
}

// ---------------------------------------------------------------- elements

export function elementIds(doc: Doc, slideId: string): string[] { return attrKeys(elementsOf(doc, slideId)) }
export function hasElement(doc: Doc, slideId: string, id: string): boolean { return hasSlide(doc, slideId) && elementsOf(doc, slideId).hasAttr(id) }
export function elementScalars(doc: Doc, slideId: string, id: string): Scalars { return scalarsOf(element(doc, slideId, id)) }
export function allElementScalars(doc: Doc, slideId: string): Map<string, Scalars> {
  const out = new Map<string, Scalars>()
  for (const [id, n] of elementsOf(doc, slideId).attrEntries() as Iterable<[string, N]>) out.set(id, scalarsOf(n))
  return out
}
export function createElement(doc: Doc, slideId: string, id: string, scalars: Scalars, text?: TextBlock[]): void {
  const n = new Y.Node('el')
  elementsOf(doc, slideId).setAttr(id, n as never)
  for (const [k, v] of Object.entries(scalars)) n.setAttr(k, v as never)
  if (text) writeText(doc, slideId, id, text)
}
export function deleteElement(doc: Doc, slideId: string, id: string): void { elementsOf(doc, slideId).deleteAttr(id) }
export function setElementKey(doc: Doc, slideId: string, id: string, key: string, v: Json): void { element(doc, slideId, id).setAttr(key, v as never) }
export function deleteElementKey(doc: Doc, slideId: string, id: string, key: string): void { element(doc, slideId, id).deleteAttr(key) }

// ---------------------------------------------------------------- text (a nested <doc> node per text element)

export function hasText(doc: Doc, slideId: string, id: string): boolean { return element(doc, slideId, id).getAttr('text') instanceof Y.Node }
export function removeText(doc: Doc, slideId: string, id: string): void { element(doc, slideId, id).deleteAttr('text') }

function marksOf(format: Record<string, unknown> | null | undefined): Marks {
  const m: Marks = {}
  if (format) for (const k of MARK_ORDER) if (format[k] != null) (m as Record<string, unknown>)[k] = format[k]
  return m
}
const markKey = (m: Marks) => JSON.stringify(m)
const BR = ' ' // a <br> node is one position in the block's sequence; in the diff string it is this character
const BR_KEY = '<br>'

function readBlock(n: N): TextBlock {
  const inline: Inline[] = []
  for (const op of opsOf(n)) {
    if (typeof op.insert === 'string') {
      const marks = marksOf(op.format)
      const last = inline[inline.length - 1]
      if (last && 'text' in last && markKey(last.marks) === markKey(marks)) last.text += op.insert
      else inline.push({ text: op.insert, marks })
    } else if (Array.isArray(op.insert)) for (const node of op.insert) if (node.name === 'br') inline.push({ br: true })
  }
  return { type: n.name === 'li' ? 'li' : 'p', inline }
}
const blocksOf = (f: N): N[] => f.toArray().filter((c): c is N => c instanceof Y.Node)
export function readText(doc: Doc, slideId: string, id: string): TextBlock[] {
  const f = element(doc, slideId, id).getAttr('text')
  return f instanceof Y.Node ? blocksOf(f).map(readBlock) : []
}

/** Insert inline content at `at` with explicit formats (nothing inherited from the left). Returns the new position. */
function insertInline(b: N, at: number, inline: Inline[]): number {
  for (const r of inline) {
    if ('br' in r) { b.insert(at, [new Y.Node('br')]); at++; continue }
    if (!r.text) continue
    b.insert(at, r.text, explicit(r.marks)); at += r.text.length
  }
  return at
}
function explicit(m: Marks): Record<string, unknown> {
  const f: Record<string, unknown> = {}
  for (const k of MARK_ORDER) f[k] = (m as Record<string, unknown>)[k] ?? null
  return f
}
function newBlock(f: N, at: number, block: TextBlock): void {
  const b = new Y.Node(block.type); f.insert(at, [b]); insertInline(b, 0, block.inline)
}
export function writeText(doc: Doc, slideId: string, id: string, blocks: TextBlock[]): void {
  const f = new Y.Node('doc'); element(doc, slideId, id).setAttr('text', f as never)
  blocks.forEach((b, i) => newBlock(f, i, b))
}

/** The block as one string (a <br> is BR) and one mark key per position. */
function explode(inline: Inline[]): { s: string; m: string[] } {
  let s = ''; const m: string[] = []
  for (const r of inline) {
    if ('br' in r) { s += BR; m.push(BR_KEY); continue }
    s += r.text; for (let i = 0; i < r.text.length; i++) m.push(markKey(r.marks))
  }
  return { s, m }
}

/**
 * Patch one block to `next` with the fewest operations: fast-diff over the block's positions (text and <br> alike, so a
 * changed line break is a character-level edit on v14), then `format` over retained text whose marks changed.
 */
function patchBlock(b: N, next: Inline[]): number {
  const cur = explode(readBlock(b).inline), nx = explode(next)
  if (cur.s === nx.s && cur.m.join('\u0000') === nx.m.join('\u0000')) return 0
  let ops = 0, at = 0, oi = 0, ni = 0
  for (const [op, s] of diff(cur.s, nx.s)) {
    if (op === diff.DELETE) { b.delete(at, s.length); oi += s.length; ops++; continue }
    if (op === diff.INSERT) {
      const runs: Inline[] = []
      for (let k = 0; k < s.length; k++) {
        const mk = nx.m[ni + k]
        if (mk === BR_KEY) { runs.push({ br: true }); continue }
        const last = runs[runs.length - 1]
        if (last && 'text' in last && markKey(last.marks) === mk) last.text += s[k]; else runs.push({ text: s[k], marks: JSON.parse(mk) })
      }
      at = insertInline(b, at, runs); ni += s.length; ops += runs.length; continue
    }
    let k = 0
    while (k < s.length) {
      const om = cur.m[oi + k], nm = nx.m[ni + k]
      if (om === nm || om === BR_KEY) { k++; continue }
      let j = k + 1
      while (j < s.length && cur.m[oi + j] === om && nx.m[ni + j] === nm) j++
      const o = JSON.parse(om) as Record<string, unknown>, n = JSON.parse(nm) as Record<string, unknown>
      const delta: Record<string, unknown> = {}
      for (const name of MARK_ORDER) if (JSON.stringify(o[name]) !== JSON.stringify(n[name])) delta[name] = n[name] ?? null
      b.format(at + k, j - k, delta); ops++
      k = j
    }
    at += s.length; oi += s.length; ni += s.length
  }
  return ops
}

/**
 * Patch a text element's <doc> to `blocks`: unchanged blocks untouched; equal prefix and suffix kept; a block of the
 * same kind patched character by character (line breaks included); a different count replaced block-wise.
 */
export function patchText(doc: Doc, slideId: string, id: string, blocks: TextBlock[]): number {
  const f = element(doc, slideId, id).getAttr('text')
  if (!(f instanceof Y.Node)) { writeText(doc, slideId, id, blocks); return 1 }
  const els = blocksOf(f)
  const cur = els.map(readBlock)
  const same = (a: TextBlock, b: TextBlock) => JSON.stringify(a) === JSON.stringify(b)
  let pre = 0
  while (pre < cur.length && pre < blocks.length && same(cur[pre], blocks[pre])) pre++
  let suf = 0
  while (suf < cur.length - pre && suf < blocks.length - pre && same(cur[cur.length - 1 - suf], blocks[blocks.length - 1 - suf])) suf++
  const curMid = els.slice(pre, els.length - suf), nextMid = blocks.slice(pre, blocks.length - suf)
  if (curMid.length === nextMid.length) {
    let ops = 0
    curMid.forEach((b, i) => {
      if (b.name === nextMid[i].type) ops += patchBlock(b, nextMid[i].inline)
      else { const at = pre + i; f.delete(at, 1); newBlock(f, at, nextMid[i]); ops++ }
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

type AttrOp = { type: 'insert' | 'delete' | 'modify'; value?: { attrs?: Record<string, AttrOp> } }

/** Deep changes of one slide as model-level records, read from v14's deep delta (one event per transaction). */
export function observeSlide(doc: Doc, slideId: string, cb: (changes: Change[], origin: unknown, local: boolean) => void): () => void {
  const s = slide(doc, slideId)
  const h = (ev: Y.YEvent<never>, tx: Y.Transaction) => {
    const attrs = (ev.deltaDeep.toJSON() as { attrs?: Record<string, AttrOp> }).attrs ?? {}
    const out: Change[] = []
    const slideKeys = Object.keys(attrs).filter((k) => k !== 'notes' && k !== 'elements')
    if (slideKeys.length) out.push({ kind: 'slide', keys: slideKeys })
    if (attrs.notes) out.push({ kind: 'notes' })
    for (const [id, op] of Object.entries(attrs.elements?.value?.attrs ?? {})) {
      if (op.type === 'delete') out.push({ kind: 'removed', id })
      else if (op.type === 'insert') out.push({ kind: 'removed', id }, { kind: 'added', id })
      else {
        const keys = Object.keys(op.value?.attrs ?? {})
        if (keys.includes('text')) out.push({ kind: 'text', id })
        const rest = keys.filter((k) => k !== 'text'); if (rest.length) out.push({ kind: 'element', id, keys: rest })
      }
    }
    if (out.length) cb(out, tx.origin, tx.local)
  }
  s.observeDeep(h as never)
  return () => s.unobserveDeep(h as never)
}
