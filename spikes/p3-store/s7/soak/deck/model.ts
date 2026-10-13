// COPY of spikes/p3-store/s6/src/model.ts at 4ab6b9b7 for S7a (unchanged below this line).
// The Y.Map slide model in IR terms: a slide's element tree flattened to id-keyed records with a `parent` and a
// sibling key, read back into a tree with deterministic rules for the states concurrency can produce (an orphan whose
// parent was deleted, a parent cycle, equal keys). Talks to Yjs only through ydoc.ts.

import { type Attrs, type ElementIR, type SlideIR, type Style, type Tag, type TextBlock, CONTAINER_TAGS, TEXT_TAGS, isPinned } from './ir.ts'
import { type Bounds, ANY, FLOW_LAYER, OVER, UNDER, byKey, keyAfter, keyBefore, rekey, repairCollisions } from './order.ts'
import { partition, serializeDeckJson, serializeSlide, type DeckJson } from './serialize.ts'
import * as Y from './ydoc.ts'

export const ROOT = '' // the parent value of a section's direct children

/** One element as the model holds it. `order` places a flow child among its siblings; `z` places a pinned one. */
export interface FlatElement {
  id: string
  tag: Tag
  parent: string
  order?: string
  z?: string
  style: Style
  attrs: Attrs
  text?: TextBlock[]
  raw?: string
}

export type Group = 'under' | 'flow' | 'over'
export const GROUP_BOUNDS: Record<Group, Bounds> = { under: UNDER, flow: ANY, over: OVER }
export const groupKey = (g: Group): 'order' | 'z' => (g === 'flow' ? 'order' : 'z')

/** Which sibling list an element is in, from its own state (pinned-ness and its z against the flow layer). */
export function groupOf(e: Pick<FlatElement, 'tag' | 'style' | 'attrs' | 'z'>): Group {
  if (!isPinned(e.tag, e.style, e.attrs)) return 'flow'
  return e.z !== undefined && e.z < FLOW_LAYER ? 'under' : 'over'
}

// ---------------------------------------------------------------- scalars <-> FlatElement

export function toScalars(e: FlatElement): Y.Scalars {
  const s: Y.Scalars = { tag: e.tag, parent: e.parent }
  if (e.order !== undefined) s.order = e.order
  if (e.z !== undefined) s.z = e.z
  for (const [k, v] of Object.entries(e.style)) s[`style:${k}`] = v
  for (const [k, v] of Object.entries(e.attrs)) s[`attr:${k}`] = v
  if (e.raw !== undefined) s.raw = e.raw
  return s
}
export function fromScalars(id: string, s: Y.Scalars): FlatElement {
  const e: FlatElement = { id, tag: s.tag as Tag, parent: (s.parent as string) ?? ROOT, style: {}, attrs: {} }
  if (typeof s.order === 'string') e.order = s.order
  if (typeof s.z === 'string') e.z = s.z
  if (typeof s.raw === 'string') e.raw = s.raw
  for (const [k, v] of Object.entries(s)) {
    if (k.startsWith('style:')) e.style[k.slice(6)] = v as string
    else if (k.startsWith('attr:')) e.attrs[k.slice(5)] = v as string
  }
  return e
}
export function slideScalarsOf(ir: SlideIR): Y.Scalars {
  const s: Y.Scalars = {}
  for (const [k, v] of Object.entries(ir.style)) s[`style:${k}`] = v
  for (const [k, v] of Object.entries(ir.attrs)) s[`attr:${k}`] = v
  return s
}

// ---------------------------------------------------------------- IR -> flat

/** The IR's tree as flat records with fresh keys; the desired parent and group of each id for diff-apply. */
export function flatten(slide: SlideIR): { elements: FlatElement[]; lists: Map<string, Record<Group, string[]>> } {
  const elements: FlatElement[] = []
  const lists = new Map<string, Record<Group, string[]>>()
  const walk = (children: ElementIR[], parent: string) => {
    const parts = partition(children)
    lists.set(parent, { under: parts.under.map((c) => c.id), flow: parts.flow.map((c) => c.id), over: parts.over.map((c) => c.id) })
    for (const g of ['under', 'flow', 'over'] as const) {
      const keys = rekey(parts[g].map((c) => c.id), new Map(), GROUP_BOUNDS[g])
      for (const c of parts[g]) {
        const e: FlatElement = { id: c.id, tag: c.tag, parent, style: c.style, attrs: c.attrs }
        e[groupKey(g)] = keys.get(c.id)!
        if (c.text) e.text = c.text
        if (c.raw !== undefined) e.raw = c.raw
        elements.push(e)
        if (CONTAINER_TAGS.has(c.tag)) walk(c.children, c.id)
      }
    }
  }
  walk(slide.children, ROOT)
  return { elements, lists }
}

/** Create a slide from IR (inside the caller's transaction). */
export function importSlide(doc: Y.Doc, ir: SlideIR, order: string): void {
  Y.createSlide(doc, ir.id, { ...slideScalarsOf(ir), order }, ir.notes)
  for (const e of flatten(ir).elements) Y.createElement(doc, ir.id, e.id, toScalars(e), e.text)
}

// ---------------------------------------------------------------- model -> tree

export function readFlat(doc: Y.Doc, slideId: string, withText = true): FlatElement[] {
  const out: FlatElement[] = []
  for (const [id, s] of Y.allElementScalars(doc, slideId)) {
    const e = fromScalars(id, s)
    if (withText && TEXT_TAGS.has(e.tag)) e.text = Y.readText(doc, slideId, id)
    out.push(e)
  }
  return out
}

/**
 * The effective parent of every element. Rules (deterministic in the state, so every replica draws the same tree):
 * a parent that does not exist or cannot hold children → the section (an orphan of a concurrent delete keeps its
 * content); a parent cycle (two concurrent "move into") → the cycle's smallest id moves to the section.
 */
export function resolveParents(els: FlatElement[]): Map<string, string> {
  const byId = new Map(els.map((e) => [e.id, e]))
  const eff = new Map<string, string>()
  for (const e of els) eff.set(e.id, e.parent !== ROOT && byId.has(e.parent) && CONTAINER_TAGS.has(byId.get(e.parent)!.tag) ? e.parent : ROOT)
  for (const e of [...els].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const seen: string[] = []
    let cur = e.id
    while (cur !== ROOT && !seen.includes(cur)) { seen.push(cur); cur = eff.get(cur)! }
    if (cur !== ROOT) { // a cycle through `cur`
      const cycle = seen.slice(seen.indexOf(cur)).sort()
      eff.set(cycle[0], ROOT)
    }
  }
  return eff
}

/** Children of each parent in paint/flow order: [under by z] [flow by order] [over by z], ties by id. */
export function childLists(els: FlatElement[], eff = resolveParents(els)): Map<string, FlatElement[]> {
  const buckets = new Map<string, Record<Group, FlatElement[]>>()
  for (const e of els) {
    const p = eff.get(e.id)!
    if (!buckets.has(p)) buckets.set(p, { under: [], flow: [], over: [] })
    buckets.get(p)![groupOf(e)].push(e)
  }
  const out = new Map<string, FlatElement[]>()
  for (const [p, b] of buckets) {
    b.under.sort(byKey((e) => e.z)); b.flow.sort(byKey((e) => e.order)); b.over.sort(byKey((e) => e.z))
    out.set(p, [...b.under, ...b.flow, ...b.over])
  }
  return out
}

export function readSlide(doc: Y.Doc, slideId: string): SlideIR {
  const s = Y.slideScalars(doc, slideId)
  const ir: SlideIR = { id: slideId, attrs: {}, style: {}, children: [], notes: Y.readNotes(doc, slideId) }
  for (const [k, v] of Object.entries(s)) {
    if (k.startsWith('style:')) ir.style[k.slice(6)] = v as string
    else if (k.startsWith('attr:')) ir.attrs[k.slice(5)] = v as string
  }
  const lists = childLists(readFlat(doc, slideId))
  const build = (p: string): ElementIR[] => (lists.get(p) ?? []).map((e) => {
    const el: ElementIR = { id: e.id, tag: e.tag, attrs: e.attrs, style: e.style, children: CONTAINER_TAGS.has(e.tag) ? build(e.id) : [] }
    if (e.text) el.text = e.text
    if (e.raw !== undefined) el.raw = e.raw
    return el
  })
  ir.children = build(ROOT)
  return ir
}

/** Slide ids in deck order (by `order`, then id). */
export function slideOrder(doc: Y.Doc): string[] {
  return Y.slideIds(doc).map((id) => ({ id, order: Y.slideScalars(doc, id).order as string | undefined })).sort(byKey((s) => s.order)).map((s) => s.id)
}

/** The slide's file: canonical, or the held source verbatim with nothing lost. */
export function slideFile(doc: Y.Doc, slideId: string): string {
  const held = Y.slideScalars(doc, slideId).held as { source: string } | undefined
  return held ? held.source : serializeSlide(readSlide(doc, slideId))
}

export function readDeckJson(doc: Y.Doc): DeckJson {
  const deck: DeckJson = { ...(Y.deckScalars(doc) as Record<string, unknown>) }
  deck.order = slideOrder(doc)
  for (const sub of ['sections', 'faces'] as const) { const e = Y.deckEntries(doc, sub); if (e) deck[sub] = e }
  return deck
}

/** The deck's files, as artifact_read returns them. */
export function deckFiles(doc: Y.Doc): Record<string, string> {
  const files: Record<string, string> = { 'project/deck.json': serializeDeckJson(readDeckJson(doc)) }
  for (const id of slideOrder(doc)) files[`project/slides/${id}.html`] = slideFile(doc, id)
  return files
}

// ---------------------------------------------------------------- canvas-side writers (one gesture = one transaction)

export function setStyle(doc: Y.Doc, slideId: string, id: string, props: Style, origin?: unknown): void {
  Y.transact(doc, () => { for (const [k, v] of Object.entries(props)) Y.setElementKey(doc, slideId, id, `style:${k}`, v) }, origin)
}

/** Z-order on a pinned element: front = over everything; back = under the flow layer (before the first flow child). */
export function zOrder(doc: Y.Doc, slideId: string, id: string, to: 'front' | 'back', origin?: unknown): void {
  const els = readFlat(doc, slideId, false)
  const eff = resolveParents(els)
  const me = els.find((e) => e.id === id)!
  const sibs = els.filter((e) => e.id !== id && eff.get(e.id) === eff.get(id) && groupOf(e) !== 'flow').map((e) => e.z)
  const z = to === 'front' ? keyAfter(sibs, OVER) : keyBefore(sibs, UNDER)
  if (!isPinned(me.tag, me.style, me.attrs)) throw new Error('z-order applies to pinned elements; flow content is one layer')
  Y.transact(doc, () => Y.setElementKey(doc, slideId, id, 'z', z), origin)
}
/** Re-parent (group / ungroup): one key, so a concurrent move and a concurrent re-parent never duplicate. */
export function moveInto(doc: Y.Doc, slideId: string, id: string, parent: string, origin?: unknown): void {
  const els = readFlat(doc, slideId, false)
  const me = els.find((e) => e.id === id)!
  const g = groupOf(me)
  const sibs = els.filter((e) => e.parent === parent && e.id !== id && groupOf(e) === g).map((e) => e[groupKey(g)])
  Y.transact(doc, () => {
    Y.setElementKey(doc, slideId, id, 'parent', parent)
    Y.setElementKey(doc, slideId, id, groupKey(g), keyAfter(sibs, GROUP_BOUNDS[g]))
  }, origin)
}

/** Delete an element and its descendants as the model sees them now. */
export function deleteElementTree(doc: Y.Doc, slideId: string, id: string, origin?: unknown): void {
  const els = readFlat(doc, slideId, false)
  const eff = resolveParents(els)
  const doomed = new Set([id])
  let grew = true
  while (grew) { grew = false; for (const e of els) if (!doomed.has(e.id) && doomed.has(eff.get(e.id)!)) { doomed.add(e.id); grew = true } }
  Y.transact(doc, () => { for (const d of doomed) Y.deleteElement(doc, slideId, d) }, origin)
}

/** Slide re-order: one key on the moved slide. */
export function moveSlide(doc: Y.Doc, slideId: string, afterId: string | null, origin?: unknown): void {
  const ids = slideOrder(doc).filter((s) => s !== slideId)
  const at = afterId === null ? 0 : ids.indexOf(afterId) + 1
  const desired = [...ids.slice(0, at), slideId, ...ids.slice(at)]
  const cur = new Map(ids.map((s) => [s, Y.slideScalars(doc, s).order as string]))
  const keys = rekey(desired, cur, ANY)
  Y.transact(doc, () => { for (const [s, k] of keys) Y.setSlideKey(doc, s, 'order', k) }, origin)
}

// ---------------------------------------------------------------- repair (the host runs it after applying an update)

/**
 * Write the deterministic resolution of states concurrency produced: orphans and cycles re-parented to the section,
 * equal sibling keys separated, equal slide keys separated. Returns the number of keys written (0 on a clean state).
 */
export function repair(doc: Y.Doc, origin?: unknown): number {
  let writes = 0
  Y.transact(doc, () => {
    const slides = Y.slideIds(doc).map((id) => ({ id, order: Y.slideScalars(doc, id).order as string | undefined }))
    for (const [id, k] of repairCollisions(slides, (s) => s.order, ANY)) { Y.setSlideKey(doc, id, 'order', k); writes++ }
    for (const sid of Y.slideIds(doc)) {
      if (Y.slideScalars(doc, sid).held) continue
      const els = readFlat(doc, sid, false)
      const eff = resolveParents(els)
      for (const e of els) if (eff.get(e.id) !== e.parent) { Y.setElementKey(doc, sid, e.id, 'parent', eff.get(e.id)!); e.parent = eff.get(e.id)!; writes++ }
      const byParent = new Map<string, FlatElement[]>()
      for (const e of els) { if (!byParent.has(e.parent)) byParent.set(e.parent, []); byParent.get(e.parent)!.push(e) }
      for (const sibs of byParent.values()) for (const g of ['under', 'flow', 'over'] as const) {
        const list = sibs.filter((e) => groupOf(e) === g)
        for (const [id, k] of repairCollisions(list, (e) => e[groupKey(g)], GROUP_BOUNDS[g])) { Y.setElementKey(doc, sid, id, groupKey(g), k); writes++ }
      }
    }
  }, origin)
  return writes
}

// ---------------------------------------------------------------- object anchors

export interface Anchor { slideId: string; elementId: string }
export type AnchorState = { live: true; tag: Tag; parent: string } | { live: false }
/** An anchor resolves by ids alone: no path, index or position enters it, so moves, restyles, re-orders and publishes cannot move it. */
export function resolveAnchor(doc: Y.Doc, a: Anchor): AnchorState {
  if (!Y.hasElement(doc, a.slideId, a.elementId)) return { live: false }
  const s = Y.elementScalars(doc, a.slideId, a.elementId)
  return { live: true, tag: s.tag as Tag, parent: s.parent as string }
}
