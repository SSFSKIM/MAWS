// COPY of spikes/p3-store/s6/src/serialize.ts at 4ab6b9b7 for S7a (unchanged below this line).
// The canonical serializer: SlideIR → one slide file. Deterministic in every choice the parser normalizes away
// (attribute order, style order and form, whitespace, entity escaping, mark nesting, the pinned/flow interleave),
// so serialize(parse(x)) is a fixed point after one pass.

import { serializeStyle } from './css.ts'
import { type ElementIR, type Inline, type MarkName, type Marks, type SlideIR, type Style, type TextBlock, MARK_ORDER, LIST_TAGS, isPinned } from './ir.ts'

const VOID = new Set(['img', 'hr'])

export interface SerializeOptions {
  /** Resolve var(--ds-*) to literal values (the linked-directory mirror and the Claude-compatible export, Decision Log 21). */
  resolveVar?: (name: string) => string | undefined
}

export function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&#160;')
}
export function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&#160;')
}

/**
 * Paint order is source order with all flow content one layer at the first flow child (Claude, styles.md). So only
 * three things about a pinned child's place carry meaning: under the flow layer (before the first flow child) or over
 * it, and its order within that group. The canonical interleave: [pinned under] [flow] [pinned over].
 */
export function partition<T extends { tag: ElementIR['tag']; style: Style; attrs: ElementIR['attrs'] }>(children: T[]): { under: T[]; flow: T[]; over: T[] } {
  const firstFlow = children.findIndex((c) => !isPinned(c.tag, c.style, c.attrs))
  const under: T[] = [], flow: T[] = [], over: T[] = []
  children.forEach((c, i) => {
    if (!isPinned(c.tag, c.style, c.attrs)) flow.push(c)
    else if (firstFlow !== -1 && i < firstFlow) under.push(c)
    else over.push(c)
  })
  return { under, flow, over }
}
export function canonicalOrder<T extends { tag: ElementIR['tag']; style: Style; attrs: ElementIR['attrs'] }>(children: T[]): T[] {
  const { under, flow, over } = partition(children)
  return [...under, ...flow, ...over]
}

function attrString(id: string | undefined, attrs: Record<string, string>, style: Style, o: SerializeOptions): string {
  let s = id ? ` id="${escAttr(id)}"` : ''
  for (const k of Object.keys(attrs).sort()) s += attrs[k] === '' && k === 'hidden' ? ` ${k}` : ` ${k}="${escAttr(attrs[k])}"`
  const st = serializeStyle(style, o.resolveVar)
  if (st) s += ` style="${escAttr(st)}"`
  return s
}

function markOpen(m: MarkName, marks: Marks): string {
  if (m === 'a') return `<a href="${escAttr(marks.a!.href)}">`
  if (m === 'span') return `<span style="color:${escAttr(marks.span!.color)}">`
  return `<${m}>`
}
const markKey = (m: MarkName, marks: Marks) => m + JSON.stringify(marks[m])

/** Inline runs with the minimal canonical nesting: marks open outermost-first in MARK_ORDER; a <br> closes nothing it need not. */
export function serializeInline(inline: Inline[]): string {
  let out = ''
  let open: { name: MarkName; key: string }[] = []
  const closeTo = (k: number) => { while (open.length > k) out += `</${open.pop()!.name}>` }
  for (const run of inline) {
    if ('br' in run) { out += '<br>'; continue }
    const want = MARK_ORDER.filter((m) => run.marks[m]).map((m) => ({ name: m, key: markKey(m, run.marks) }))
    let k = 0
    while (k < open.length && k < want.length && open[k].key === want[k].key) k++
    closeTo(k)
    for (const w of want.slice(k)) { out += markOpen(w.name, run.marks); open.push(w) }
    out += escText(run.text)
  }
  closeTo(0)
  return out
}

function serializeText(tag: string, blocks: TextBlock[], pad: string): string {
  if (!LIST_TAGS.has(tag as never)) return serializeInline(blocks[0]?.inline ?? [])
  return blocks.map((b) => `\n${pad}  <li>${serializeInline(b.inline)}</li>`).join('') + `\n${pad}`
}

function serializeElement(el: ElementIR, depth: number, o: SerializeOptions): string {
  const pad = '  '.repeat(depth)
  const head = `${pad}<${el.tag}${attrString(el.id, el.attrs, el.style, o)}>`
  if (VOID.has(el.tag)) return head
  if (el.raw !== undefined) return `${head}${el.raw}</${el.tag}>`
  if (el.text) return `${head}${serializeText(el.tag, el.text, pad)}</${el.tag}>`
  if (el.children.length === 0) return `${head}</${el.tag}>`
  const kids = (el.tag === 'div' ? canonicalOrder(el.children) : el.children).map((c) => serializeElement(c, depth + 1, o))
  return `${head}\n${kids.join('\n')}\n${pad}</${el.tag}>`
}

export function serializeSlide(slide: SlideIR, o: SerializeOptions = {}): string {
  const lines = [`<section${attrString(slide.id, slide.attrs, slide.style, o)}>`]
  for (const c of canonicalOrder(slide.children)) lines.push(serializeElement(c, 1, o))
  if (slide.notes) lines.push(`  <aside>${escText(slide.notes)}</aside>`)
  lines.push('</section>')
  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------- deck.json (v4)

/** Claude's key order first, then every other key sorted: "keep every key you don't change, named here or not". */
const DECK_KEYS = ['v', 'createdOnFiles', 'lists', 'title', 'cover', 'order', 'sections', 'faces', 'designSystems']
export type DeckJson = Record<string, unknown> & { order?: string[] }

export function serializeDeckJson(deck: DeckJson): string {
  const keys = Object.keys(deck).sort((a, b) => {
    const ia = DECK_KEYS.indexOf(a), ib = DECK_KEYS.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || (a < b ? -1 : a > b ? 1 : 0)
  })
  const ordered: Record<string, unknown> = {}
  for (const k of keys) ordered[k] = deck[k]
  return JSON.stringify(ordered, null, 2) + '\n'
}
