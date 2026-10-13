// A minimal slide canvas: a DOM render of one slide from the model that patches itself on remote changes
// (observeSlide's change records → the fewest DOM writes: one style property, one attribute, one re-placed node, one
// re-rendered text box), a drag that writes style:left/top, and z-order actions. Runs on any DOM (happy-dom in Node,
// the renderer's document); never imports yjs.

import { type ElementIR, LIST_TAGS, TEXT_TAGS, isPinned } from './ir.ts'
import { type FlatElement, ROOT, childLists, groupOf, readFlat, setStyle, zOrder } from './model.ts'
import { escAttr, serializeInline } from './serialize.ts'
import * as Y from './ydoc.ts'

/** The renderer's defaults for Claude's semantics (a div or section with no display is a column), outside the inline style. */
export const CANVAS_CSS = `
.maws-slide { position: relative; width: 1920px; height: 1080px; overflow: hidden; isolation: isolate; box-sizing: border-box; display: flex; flex-direction: column; }
.maws-slide div { display: flex; flex-direction: column; }
.maws-slide * { margin: 0; box-sizing: border-box; }
.maws-slide [data-layer="under"] { z-index: -1; }`

type Doc = Document
type El = HTMLElement

/** A longest strictly increasing subsequence of `seq` (values, in order). */
function longestRun(seq: number[]): number[] {
  const tails: number[] = [], prev = new Array<number>(seq.length).fill(-1)
  seq.forEach((v, i) => {
    let lo = 0, hi = tails.length
    while (lo < hi) { const m = (lo + hi) >> 1; if (seq[tails[m]] < v) lo = m + 1; else hi = m }
    if (lo > 0) prev[i] = tails[lo - 1]
    tails[lo] = i
  })
  const out: number[] = []
  for (let i = tails.length ? tails[tails.length - 1] : -1; i !== -1; i = prev[i]) out.unshift(seq[i])
  return out
}

export class SlideCanvas {
  readonly root: El
  private nodes = new Map<string, El>()
  private stop: () => void
  private doc: Y.Doc
  private slideId: string
  private document: Doc
  /** DOM writes this canvas made, by kind (for the spike's "minimal patching" claim). */
  readonly writes = { style: 0, attr: 0, place: 0, text: 0, create: 0, remove: 0 }

  constructor(doc: Y.Doc, slideId: string, document: Doc, host: El) {
    this.doc = doc; this.slideId = slideId; this.document = document
    this.root = document.createElement('section')
    this.root.className = 'maws-slide'
    this.root.dataset.slide = slideId
    host.appendChild(this.root)
    this.renderAll()
    this.stop = Y.observeSlide(doc, slideId, (changes) => this.patch(changes))
  }

  dispose(): void { this.stop(); this.root.remove() }
  node(id: string): El | undefined { return this.nodes.get(id) }

  private renderAll(): void {
    const s = Y.slideScalars(this.doc, this.slideId)
    for (const [k, v] of Object.entries(s)) this.applySlideKey(k, v as string)
    for (const e of readFlat(this.doc, this.slideId)) this.create(e)
    this.placeAll()
  }

  private applySlideKey(k: string, v: string | undefined): void {
    if (k.startsWith('style:')) { v === undefined ? this.root.style.removeProperty(k.slice(6)) : this.root.style.setProperty(k.slice(6), v) }
    else if (k.startsWith('attr:')) { v === undefined ? this.root.removeAttribute(k.slice(5)) : this.root.setAttribute(k.slice(5), v) }
  }

  private create(e: FlatElement): El {
    let n: El
    if (e.tag === 'svg' || e.tag === 'x-embed') {
      // raw content parses in its own namespace through a template (an <x-embed> becomes a sandboxed iframe in P3-C)
      const t = this.document.createElement('template')
      t.innerHTML = `<${e.tag}${Object.entries(e.attrs).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('')}>${e.raw ?? ''}</${e.tag}>`
      n = t.content.firstElementChild as El
    } else {
      n = this.document.createElement(e.tag)
      for (const [k, v] of Object.entries(e.attrs)) n.setAttribute(k, v)
    }
    n.dataset.eid = e.id
    for (const [k, v] of Object.entries(e.style)) n.style.setProperty(k, v)
    this.nodes.set(e.id, n)
    this.writes.create++
    if (TEXT_TAGS.has(e.tag)) this.renderText(e.id, n, e.tag)
    return n
  }

  private renderText(id: string, n: El, tag: ElementIR['tag']): void {
    const blocks = Y.readText(this.doc, this.slideId, id)
    n.innerHTML = LIST_TAGS.has(tag) ? blocks.map((b) => `<li>${serializeInline(b.inline)}</li>`).join('') : serializeInline(blocks[0]?.inline ?? [])
  }

  /** Put every node under its effective parent in [under][flow][over] order, moving only nodes out of place. */
  private placeAll(only?: Set<string>): void {
    const els = readFlat(this.doc, this.slideId, false)
    const lists = childLists(els)
    const parents = only ?? new Set([ROOT, ...els.map((e) => e.id)])
    for (const p of parents) {
      const host = p === ROOT ? this.root : this.nodes.get(p)
      if (!host) continue
      const want = (lists.get(p) ?? []).map((e) => { const n = this.nodes.get(e.id)!; this.setLayer(n, e, p === ROOT); return n })
      // keyed reconciliation: nodes already in a longest increasing run of their wanted positions stay; the rest move
      const pos = new Map(want.map((n, i) => [n, i]))
      const seq = Array.from(host.children).map((c) => pos.get(c as El)).filter((i): i is number => i !== undefined)
      const stay = new Set(longestRun(seq).map((i) => want[i]))
      for (let i = want.length - 1; i >= 0; i--) {
        const n = want[i], next = want[i + 1] ?? null
        if (stay.has(n) && n.parentElement === host) continue
        if (n.parentElement === host && n.nextElementSibling === next) continue
        host.insertBefore(n, next); this.writes.place++
      }
    }
  }
  /**
   * Plain CSS paints every positioned element over all in-flow content (CSS 2.1 Appendix E); the dialect paints a
   * section's pinned child listed before the first flow child UNDER the flow layer. The section isolates and those
   * children take z-index:-1. Only the section: inside a relative host pinned children always paint over (Claude).
   */
  private setLayer(n: El, e: FlatElement, inSection: boolean): void {
    const under = inSection && groupOf(e) === 'under'
    if (under && n.dataset.layer !== 'under') n.dataset.layer = 'under'
    else if (!under && n.dataset.layer) delete n.dataset.layer
  }

  private patch(changes: Y.Change[]): void {
    const replace = new Set<string>()
    const reparents = new Set<string>()
    for (const c of changes) {
      switch (c.kind) {
        case 'slide': for (const k of c.keys) { this.applySlideKey(k, Y.slideScalars(this.doc, this.slideId)[k] as string | undefined); this.writes.style++ } break
        case 'notes': break
        case 'removed': { const n = this.nodes.get(c.id); if (n) { n.remove(); this.nodes.delete(c.id); this.writes.remove++ } reparents.add(ROOT); break }
        case 'added': replace.add(c.id); break
        case 'text': { const n = this.nodes.get(c.id); if (n && Y.hasElement(this.doc, this.slideId, c.id)) { this.renderText(c.id, n, Y.elementScalars(this.doc, this.slideId, c.id).tag as ElementIR['tag']); this.writes.text++ } break }
        case 'element': {
          const n = this.nodes.get(c.id)
          if (!n || !Y.hasElement(this.doc, this.slideId, c.id)) break
          const s = Y.elementScalars(this.doc, this.slideId, c.id)
          for (const k of c.keys) {
            const v = s[k] as string | undefined
            if (k.startsWith('style:')) {
              v === undefined ? n.style.removeProperty(k.slice(6)) : n.style.setProperty(k.slice(6), v); this.writes.style++
              if (k === 'style:position') reparents.add(n.parentElement === this.root ? ROOT : (n.parentElement as El)?.dataset.eid ?? ROOT)
            } else if (k.startsWith('attr:')) { v === undefined ? n.removeAttribute(k.slice(5)) : n.setAttribute(k.slice(5), v); this.writes.attr++ }
            else if (k === 'order' || k === 'z' || k === 'parent') {
              reparents.add(n.parentElement === this.root ? ROOT : (n.parentElement as El)?.dataset.eid ?? ROOT)
              reparents.add((s.parent as string) ?? ROOT)
            } else if (k === 'raw' || k === 'tag') replace.add(c.id)
          }
        }
      }
    }
    for (const id of replace) {
      if (!Y.hasElement(this.doc, this.slideId, id)) continue
      const old = this.nodes.get(id)
      const e = readFlat(this.doc, this.slideId).find((f) => f.id === id)!
      const n = this.create(e)
      if (old) old.replaceWith(n) // child element nodes are re-placed under the new node by placeAll
      reparents.add(e.parent); reparents.add(id)
    }
    if (reparents.size) this.placeAll(reparents.has(ROOT) || replace.size ? undefined : reparents)
  }

  // ---------------------------------------------------------------- interactions

  /** Pointer drag on pinned elements: each move writes style:left/top as one transaction. `scale` = screen px per slide px. */
  attachDrag(scale = 1): void {
    let drag: { id: string; x: number; y: number; left: number; top: number } | null = null
    const px = (v: string | undefined) => (v && v.endsWith('px') ? Number(v.slice(0, -2)) : 0)
    this.root.addEventListener('pointerdown', (ev) => {
      const t = (ev.target as El).closest('[data-eid]') as El | null
      if (!t) return
      const id = t.dataset.eid!
      const s = Y.elementScalars(this.doc, this.slideId, id)
      const e = { tag: s.tag as ElementIR['tag'], style: { position: s['style:position'] as string }, attrs: {} }
      if (!isPinned(e.tag, e.style, e.attrs)) return // flow children move by re-ordering, not here
      drag = { id, x: (ev as PointerEvent).clientX, y: (ev as PointerEvent).clientY, left: px(s['style:left'] as string), top: px(s['style:top'] as string) }
    })
    this.root.addEventListener('pointermove', (ev) => {
      if (!drag) return
      const p = ev as PointerEvent
      setStyle(this.doc, this.slideId, drag.id, {
        left: `${Math.round(drag.left + (p.clientX - drag.x) / scale)}px`,
        top: `${Math.round(drag.top + (p.clientY - drag.y) / scale)}px`,
      }, 'drag')
    })
    this.root.addEventListener('pointerup', () => { drag = null })
  }

  bringToFront(id: string): void { zOrder(this.doc, this.slideId, id, 'front', 'z-order') }
  sendToBack(id: string): void { zOrder(this.doc, this.slideId, id, 'back', 'z-order') }
}
