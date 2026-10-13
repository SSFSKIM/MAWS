// artifact_publish's write half for a deck: a files map (`null` removes) diff-applied onto a replica as ONE
// transaction that writes only what changed: properties, added and removed elements, text, order. Run on the agent's
// replica held at the revision the agent read (the base), the update it produces merges with concurrent human edits
// by the CRDT rule, so a property the agent did not change is never written back over a human's newer value.
// The protocol's guards (baseRevision, the merge and refusal layers, idempotency by tool-use id) sit around this in
// the host and are not part of the spike.

import { type Diagnostic, type SlideIR, TEXT_TAGS, LIST_TAGS } from './ir.ts'
import { ID_RE, loadSlide } from './parse.ts'
import { parseHtml } from './parse5-adapter.ts'
import { type FlatElement, type Group, GROUP_BOUNDS, flatten, groupKey, groupOf, importSlide, readFlat, slideOrder, slideScalarsOf, toScalars } from './model.ts'
import { ANY, keyAfter, rekey } from './order.ts'
import type { DeckJson } from './serialize.ts'
import * as Y from './ydoc.ts'

export interface PublishOptions { seed?: string; origin?: unknown }
export interface PublishResult {
  ok: boolean
  refused?: string
  diagnostics: Record<string, Diagnostic[]>
  held: Record<string, string[]>
  /** Keys set or deleted, elements created or deleted, text operations: 0 for a no-op republish. */
  writes: number
}

const SLIDE_PATH = /^project\/slides\/([^/]+)\.html$/

export function publish(doc: Y.Doc, files: Record<string, string | null>, opts: PublishOptions = {}): PublishResult {
  const res: PublishResult = { ok: true, diagnostics: {}, held: {}, writes: 0 }
  // validate everything before writing anything: the whole map lands or nothing does
  let deck: DeckJson | undefined
  const slides: { id: string; path: string; source: string | null }[] = []
  for (const [path, content] of Object.entries(files)) {
    if (path === 'project/deck.json') {
      if (content === null) return refuse(res, 'project/deck.json cannot be removed')
      try { deck = JSON.parse(content) } catch (e) { return refuse(res, `project/deck.json: ${(e as Error).message}`) }
      if (!deck || typeof deck !== 'object' || Array.isArray(deck)) return refuse(res, 'project/deck.json is not an object')
      continue
    }
    const m = SLIDE_PATH.exec(path)
    if (!m || !ID_RE.test(m[1])) return refuse(res, `${path}: not a deck file path (project/deck.json or project/slides/<id>.html)`)
    slides.push({ id: m[1], path, source: content })
  }
  const loaded = slides.map((s) => {
    if (s.source === null) return { ...s, load: null }
    const taken = new Set(Y.hasSlide(doc, s.id) ? Y.elementIds(doc, s.id) : [])
    const load = loadSlide(parseHtml(s.source), { fileId: s.id, seed: opts.seed, taken })
    if (load.diagnostics.length) res.diagnostics[s.path] = load.diagnostics
    if (!load.ok) res.held[s.id] = load.held.reasons
    return { ...s, load }
  })

  Y.transact(doc, () => {
    const w = () => { res.writes++ }
    for (const s of loaded) {
      if (s.load === null) { if (Y.hasSlide(doc, s.id)) { Y.deleteSlide(doc, s.id); w() } continue }
      if (!Y.hasSlide(doc, s.id)) {
        const order = keyAfter(Y.slideIds(doc).map((id) => Y.slideScalars(doc, id).order as string), ANY)
        if (s.load.ok) importSlide(doc, s.load.slide, order)
        else Y.createSlide(doc, s.id, { order }, '')
        w()
      }
      if (!s.load.ok) {
        const held = { source: s.source!, reasons: s.load.held.reasons }
        if (JSON.stringify(Y.slideScalars(doc, s.id).held) !== JSON.stringify(held)) { Y.setSlideKey(doc, s.id, 'held', held); w() }
        continue // the last good model stays as the slide's content; the held source is what a read returns
      }
      if (Y.slideScalars(doc, s.id).held !== undefined) { Y.deleteSlideKey(doc, s.id, 'held'); w() }
      res.writes += diffSlide(doc, s.load.slide)
    }
    if (deck) res.writes += diffDeck(doc, deck)
  }, opts.origin)
  return res
}

function refuse(res: PublishResult, why: string): PublishResult { return { ...res, ok: false, refused: why } }

/** Set the keys of `next` that differ, delete the managed keys `next` lacks. */
function diffScalars(cur: Y.Scalars, next: Y.Scalars, managed: (k: string) => boolean, set: (k: string, v: Y.Json) => void, del: (k: string) => void): number {
  let n = 0
  for (const [k, v] of Object.entries(next)) if (JSON.stringify(cur[k]) !== JSON.stringify(v)) { set(k, v); n++ }
  for (const k of Object.keys(cur)) if (managed(k) && !(k in next)) { del(k); n++ }
  return n
}
const isStyleOrAttr = (k: string) => k.startsWith('style:') || k.startsWith('attr:')

export function diffSlide(doc: Y.Doc, ir: SlideIR): number {
  const sid = ir.id
  let n = diffScalars(Y.slideScalars(doc, sid), slideScalarsOf(ir), isStyleOrAttr,
    (k, v) => Y.setSlideKey(doc, sid, k, v), (k) => Y.deleteSlideKey(doc, sid, k))
  if (Y.patchNotes(doc, sid, ir.notes)) n++

  const before = new Map(readFlat(doc, sid, false).map((e) => [e.id, e]))
  const { elements, lists } = flatten(ir)
  const want = new Set(elements.map((e) => e.id))
  for (const id of before.keys()) if (!want.has(id)) { Y.deleteElement(doc, sid, id); n++ }

  for (const e of elements) {
    const cur = before.get(e.id)
    const { order: _o, z: _z, ...scalars } = toScalars(e) // keys are written below, only where order changed
    if (!cur) { Y.createElement(doc, sid, e.id, scalars, e.text); n++; continue }
    n += diffScalars(Y.elementScalars(doc, sid, e.id), scalars, (k) => isStyleOrAttr(k) || k === 'raw',
      (k, v) => Y.setElementKey(doc, sid, e.id, k, v), (k) => Y.deleteElementKey(doc, sid, e.id, k))
    if (e.text) {
      const kindChanged = TEXT_TAGS.has(cur.tag) && LIST_TAGS.has(cur.tag) !== LIST_TAGS.has(e.tag)
      if (!Y.hasText(doc, sid, e.id) || kindChanged) { Y.writeText(doc, sid, e.id, e.text); n++ }
      else n += Y.patchText(doc, sid, e.id, e.text)
    } else if (Y.hasText(doc, sid, e.id)) { Y.removeText(doc, sid, e.id); n++ }
  }

  // order: per parent and group, keep every key already in sequence, re-key the rest
  const placeOf = (f: FlatElement | undefined) => (f ? `${f.parent}\u0000${groupOf(f)}` : '')
  for (const [parent, groups] of lists) {
    for (const g of ['under', 'flow', 'over'] as Group[]) {
      const ids = groups[g]
      const k = groupKey(g)
      const current = new Map<string, string>()
      for (const id of ids) {
        const f = before.get(id)
        if (f && placeOf(f) === `${parent}\u0000${g}` && f[k] !== undefined) current.set(id, f[k]!)
      }
      for (const [id, key] of rekey(ids, current, GROUP_BOUNDS[g])) { Y.setElementKey(doc, sid, id, k, key); n++ }
      const other = k === 'order' ? 'z' : 'order'
      for (const id of ids) if (before.get(id)?.[other] !== undefined) { Y.deleteElementKey(doc, sid, id, other); n++ }
    }
  }
  return n
}

export function diffDeck(doc: Y.Doc, deck: DeckJson): number {
  let n = 0
  const { order, sections, faces, ...rest } = deck as DeckJson & { sections?: Record<string, Y.Json>; faces?: Record<string, Y.Json> }
  n += diffScalars(Y.deckScalars(doc), rest as Y.Scalars, () => true, (k, v) => Y.setDeckKey(doc, k, v), (k) => Y.deleteDeckKey(doc, k))
  for (const [name, next] of [['sections', sections], ['faces', faces]] as const) {
    const cur = Y.deckEntries(doc, name)
    if (next === undefined) { if (cur) { Y.deleteDeckSub(doc, name); n++ } continue }
    n += diffScalars(cur ?? {}, next, () => true, (k, v) => Y.setDeckEntry(doc, name, k, v), (k) => Y.deleteDeckEntry(doc, name, k))
  }
  if (Array.isArray(order)) {
    const exists = new Set(Y.slideIds(doc))
    const listed = order.filter((id, i) => typeof id === 'string' && exists.has(id) && order.indexOf(id) === i)
    const rest2 = slideOrder(doc).filter((id) => !listed.includes(id)) // "a file order leaves out shows last"
    const desired = [...listed, ...rest2]
    const current = new Map(desired.map((id) => [id, Y.slideScalars(doc, id).order as string]))
    for (const [id, k] of rekey(desired, current, ANY)) { Y.setSlideKey(doc, id, 'order', k); n++ }
  }
  return n
}
