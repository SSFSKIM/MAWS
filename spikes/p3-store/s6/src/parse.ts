// The canonical parser (the loader) of one slide file: a node tree → SlideIR, with Claude's loading rule:
// an unknown property or attribute is dropped with a diagnostic; a structurally invalid slide is held, never trimmed.
// Written against RawNode so the host (parse5, parse5-adapter.ts) and the renderer (DOMParser, dom-adapter.ts) share it.

import { parseStyle, spanStyle } from './css.ts'
import {
  type Attrs, type Diagnostic, type ElementIR, type Inline, type LoadResult, type MarkName, type Marks, type SlideIR,
  type Tag, type TextBlock, LIST_TAGS, MARK_ORDER, TEXT_TAGS, isPinned,
} from './ir.ts'

export type RawNode =
  | { kind: 'element'; tag: string; attrs: [string, string][]; children: RawNode[]; inner: () => string }
  | { kind: 'text'; value: string }
  | { kind: 'comment' }

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
export const LIMITS = { divDepth: 15, elements: 200, cells: 4000, textChars: 20000, marks: 100, notes: 4000, svgBytes: 52 * 1024, embedBytes: 16 * 1024, embeds: 8 }

const ELEMENT_TAGS = new Set<string>(['h1', 'h2', 'h3', 'p', 'ul', 'ol', 'div', 'img', 'table', 'hr', 'svg', 'x-shape', 'x-icon', 'x-connector', 'x-embed'])
const ATTRS: Partial<Record<Tag, readonly string[]>> = {
  img: ['src', 'alt', 'data-crop'],
  svg: [], // every root attribute of an svg is kept verbatim (an opaque graphic); see attrsFor
  'x-shape': ['kind'],
  'x-icon': ['name'],
  'x-connector': ['x1', 'y1', 'x2', 'y2', 'head', 'head-start', 'head-end', 'route', 'from'],
  div: ['data-group'],
}
const COMMON_ATTRS = ['data-fit', 'data-build-in', 'data-build-out']
const SHAPE_KINDS = ['rect', 'rounded', 'ellipse', 'diamond', 'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'line']
export const ICON_NAMES = ('Activity Book Chart Chat Check CheckCircle Clock Cloud Code Database Globe GraduationCap Home Key Lightbulb ' +
  'Lightning Link Lock PaperPlane Play Search Settings Star ThumbsUp Tool Trust Users Verified Warning Wrench').split(' ')
const ENUMS: Record<string, readonly string[]> = {
  'data-transition': ['fade', 'push', 'magic'],
  'data-fit': ['none', 'shrink', 'grow'],
  kind: SHAPE_KINDS, name: ICON_NAMES,
  head: ['end', 'both', 'none'], 'head-start': ['none', 'open', 'filled'], 'head-end': ['none', 'open', 'filled'],
  route: ['straight', 'hv', 'vh', 'elbow'], from: ['tl', 'tr', 'bl', 'br'],
}

/** 32-bit FNV-1a, base36, 4 characters: the `<hash>` of a minted id. */
export function hash4(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(36).padStart(4, '0').slice(-4)
}

export interface LoadOptions {
  /** The file name's id; the section's id must equal it. */
  fileId?: string
  /** Mixed into minted ids so a later publish never re-mints an id an earlier one used (the publish's revision or tool-use id). */
  seed?: string
  /** Ids already used elsewhere (the live slide's elements), never minted. */
  taken?: ReadonlySet<string>
}

class Held extends Error {}

export function loadSlide(nodes: RawNode[], opts: LoadOptions = {}): LoadResult {
  const diags: Diagnostic[] = []
  const reasons: string[] = []
  try {
    const slide = new Loader(diags, reasons, opts).run(nodes)
    if (reasons.length) return { ok: false, held: { reasons }, diagnostics: diags }
    return { ok: true, slide, diagnostics: diags }
  } catch (e) {
    if (e instanceof Held) return { ok: false, held: { reasons }, diagnostics: diags }
    throw e
  }
}

class Loader {
  private ids = new Set<string>()
  private needsId: ElementIR[] = []
  private elementCount = 0
  private cellCount = 0
  private textChars = 0
  private markCount = 0
  private embeds = 0
  private sectionId = ''
  private diags: Diagnostic[]
  private reasons: string[]
  private opts: LoadOptions
  constructor(diags: Diagnostic[], reasons: string[], opts: LoadOptions) { this.diags = diags; this.reasons = reasons; this.opts = opts }

  private hold(why: string): never { this.reasons.push(why); throw new Held(why) }
  private warn(where: string, message: string) { this.diags.push({ severity: 'warning', where, message }) }
  private note(where: string, message: string) { this.diags.push({ severity: 'note', where, message }) }

  run(nodes: RawNode[]): SlideIR {
    const top = nodes.filter((n) => !(n.kind === 'text' && !n.value.trim()) && n.kind !== 'comment')
    if (top.length !== 1 || top[0].kind !== 'element' || top[0].tag !== 'section') this.hold('a slide file holds exactly one <section> and nothing else')
    const sec = top[0] as Extract<RawNode, { kind: 'element' }>
    const attrs = new Map(sec.attrs)
    const id = attrs.get('id') ?? ''
    if (!ID_RE.test(id)) this.hold(`section id "${id}" is not [A-Za-z0-9_-]{1,64}`)
    if (this.opts.fileId !== undefined && id !== this.opts.fileId) this.hold(`section id "${id}" differs from the file name "${this.opts.fileId}"`)
    this.sectionId = id; this.ids.add(id)

    const slide: SlideIR = { id, attrs: {}, style: {}, children: [], notes: '' }
    for (const [name, value] of sec.attrs) {
      if (name === 'id') continue
      if (name === 'style') { slide.style = parseStyle(value, `section#${id}`, this.diags); continue }
      if (name === 'hidden') { slide.attrs.hidden = ''; continue }
      if (name === 'data-transition') { this.enumAttr(slide.attrs, name, value, `section#${id}`); continue }
      this.dropAttr(`section#${id}`, name)
    }

    const kids = sec.children.filter((n) => n.kind !== 'comment' || (this.note(`section#${id}`, 'comment dropped'), false))
    const asides = kids.filter((n) => n.kind === 'element' && n.tag === 'aside')
    if (asides.length > 1) this.hold('more than one <aside>')
    if (asides.length === 1) {
      const last = [...kids].reverse().find((n) => !(n.kind === 'text' && !n.value.trim()))
      if (last !== asides[0]) this.hold('<aside> (the notes) is not the section\'s last child')
      slide.notes = textContent(asides[0]).trim()
      if (slide.notes.length > LIMITS.notes) this.warn(`section#${id}`, `notes over ${LIMITS.notes} characters`)
    }
    slide.children = this.children(kids.filter((n) => !asides.includes(n)), 'section', 0)
    if (this.elementCount > LIMITS.elements) this.hold(`${this.elementCount} elements (over ${LIMITS.elements})`)
    if (this.cellCount > LIMITS.cells) this.hold(`${this.cellCount} table cells (over ${LIMITS.cells})`)
    if (this.textChars > LIMITS.textChars) this.hold(`${this.textChars} characters of text (over ${LIMITS.textChars})`)
    if (this.markCount > LIMITS.marks) this.hold(`${this.markCount} inline marks (over ${LIMITS.marks})`)
    this.mintIds()
    return slide
  }

  private children(nodes: RawNode[], parent: 'section' | 'div' | 'table' | 'tr', depth: number): ElementIR[] {
    const out: ElementIR[] = []
    for (const n of nodes) {
      if (n.kind === 'comment') { this.note(parent, 'comment dropped'); continue }
      if (n.kind === 'text') { if (n.value.trim()) this.hold(`text "${n.value.trim().slice(0, 24)}" directly inside <${parent}>`); continue }
      if (parent === 'table') {
        if (n.tag === 'tbody' || n.tag === 'thead' || n.tag === 'tfoot') { this.note('table', `<${n.tag}> unwrapped`); out.push(...this.children(n.children, 'table', depth)); continue }
        if (n.tag !== 'tr') this.hold(`<${n.tag}> inside <table>`)
        out.push(this.element(n, 'tr', parent, depth)); continue
      }
      if (parent === 'tr') {
        if (n.tag !== 'th' && n.tag !== 'td') this.hold(`<${n.tag}> inside <tr>`)
        for (const [k] of n.attrs) if (k === 'colspan' || k === 'rowspan') this.hold(`${k} on a table cell`)
        this.cellCount++
        out.push(this.element(n, n.tag as Tag, parent, depth)); continue
      }
      if (!ELEMENT_TAGS.has(n.tag)) this.hold(`unknown or misplaced tag <${n.tag}>`)
      out.push(this.element(n, n.tag as Tag, parent, depth))
    }
    return out
  }

  private element(n: Extract<RawNode, { kind: 'element' }>, tag: Tag, parent: string, depth: number): ElementIR {
    if (tag !== 'tr' && tag !== 'th' && tag !== 'td') this.elementCount++
    const where = `<${tag}>`
    const el: ElementIR = { id: '', tag, attrs: {}, style: {}, children: [] }
    const allowed = new Set([...(ATTRS[tag] ?? []), ...COMMON_ATTRS])
    for (const [name, value] of n.attrs) {
      if (name === 'id') {
        if (!ID_RE.test(value)) this.warn(where, `id "${value}" is not [A-Za-z0-9_-]{1,64}; a new id is minted`)
        else if (this.ids.has(value)) this.warn(where, `duplicate id "${value}"; a new id is minted`)
        else { el.id = value; this.ids.add(value) }
        continue
      }
      if (name === 'style') { el.style = parseStyle(value, where, this.diags); continue }
      if (tag === 'svg') { el.attrs[name] = value; continue }
      if (tag === 'img' && /^data-video(-[a-z]+)*$/.test(name)) { el.attrs[name] = value; continue }
      if (!allowed.has(name)) { this.dropAttr(where, name); continue }
      if (name in ENUMS) { this.enumAttr(el.attrs, name, value, where); continue }
      if (tag === 'x-connector' && /^[xy][12]$/.test(name)) {
        const m = /^\s*(-?(?:\d+\.?\d*|\.\d+))\s*(px|%)?\s*$/.exec(value)
        if (!m) { this.warn(where, `${name}="${value}" dropped`); continue }
        el.attrs[name] = String(Number(m[1])) + (m[2] === '%' ? '%' : ''); continue
      }
      if (tag === 'img' && name === 'src' && !/^(\/_blob\/|project\/ds\/|asset:)/.test(value)) { this.warn(where, `src "${value.slice(0, 40)}" is not an asset path; the image becomes a placeholder`); continue }
      el.attrs[name] = value.trim()
    }
    if (!el.id) this.needsId.push(el)

    if (tag === 'div') {
      const d = depth + 1
      if (d > LIMITS.divDepth) this.hold(`more than ${LIMITS.divDepth} nested <div>s`)
      el.children = this.children(n.children, 'div', d)
    } else if (tag === 'table') el.children = this.children(n.children, 'table', depth)
    else if (tag === 'tr') el.children = this.children(n.children, 'tr', depth)
    else if (TEXT_TAGS.has(tag)) el.text = LIST_TAGS.has(tag) ? this.list(n, where) : [this.block('p', n.children, where)]
    else if (tag === 'svg') {
      const raw = n.inner()
      if (raw.length > LIMITS.svgBytes) this.hold(`an <svg> over ${LIMITS.svgBytes} bytes`)
      if (/<script|\son[a-z]+\s*=|<foreignobject|(?:href|src)\s*=\s*["']?\s*(?:https?:|data:|\/\/)|url\(\s*["']?\s*(?:https?:|data:|\/\/)/i.test(raw)) this.hold('an <svg> with script, an event handler, foreignObject or an external URL')
      el.raw = raw
    } else if (tag === 'x-embed') {
      if (parent !== 'section') this.hold('<x-embed> is not a direct child of the section')
      if (++this.embeds > LIMITS.embeds) this.hold(`more than ${LIMITS.embeds} <x-embed>s`)
      el.raw = n.inner()
      if (el.raw.length > LIMITS.embedBytes) this.hold(`an <x-embed> over ${LIMITS.embedBytes} bytes`)
    } else if (n.children.some((c) => c.kind === 'element' || (c.kind === 'text' && c.value.trim()))) {
      this.hold(`<${tag}> holds content`)
    }
    if (tag === 'x-embed' && !isPinned(tag, el.style, el.attrs)) this.hold('<x-embed> is not pinned (position:absolute)')
    return el
  }

  private list(n: Extract<RawNode, { kind: 'element' }>, where: string): TextBlock[] {
    const blocks: TextBlock[] = []
    for (const c of n.children) {
      if (c.kind === 'comment' || (c.kind === 'text' && !c.value.trim())) continue
      if (c.kind !== 'element' || c.tag !== 'li') this.hold(`${where} holds something other than <li>`)
      const li = c as Extract<RawNode, { kind: 'element' }>
      if (li.attrs.length) this.warn(where, '<li> attributes dropped (plain items only)')
      blocks.push(this.block('li', li.children, where))
    }
    return blocks
  }

  /** Inline content to normalized runs: HTML whitespace collapsing, adjacent equal runs merged. */
  private block(type: 'p' | 'li', nodes: RawNode[], where: string): TextBlock {
    type Ch = { ch: string; marks: Marks } | { br: true }
    const chars: Ch[] = []
    const walk = (ns: RawNode[], marks: Marks) => {
      for (const n of ns) {
        if (n.kind === 'comment') continue
        if (n.kind === 'text') { for (const ch of n.value.replace(/[\t\n\r\f]/g, ' ')) chars.push({ ch, marks }); continue }
        let next: Marks | null = null
        const add = (m: MarkName, v: object) => { next = { ...(next ?? marks), [m]: v } }
        switch (n.tag) {
          case 'br': chars.push({ br: true }); continue
          case 'b': case 'strong': add('b', {}); if (n.tag === 'strong') this.note(where, '<strong> became <b>'); break
          case 'i': case 'em': add('i', {}); if (n.tag === 'em') this.note(where, '<em> became <i>'); break
          case 'u': add('u', {}); break
          case 'a': {
            const href = n.attrs.find(([k]) => k === 'href')?.[1]?.trim()
            if (href && /^https:\/\//.test(href)) add('a', { href })
            else this.warn(where, `link "${href ?? ''}" dropped (https links only); its text kept`)
            break
          }
          case 'span': {
            const st = n.attrs.find(([k]) => k === 'style')?.[1] ?? ''
            const s = spanStyle(st, where, this.diags)
            if (s.color) add('span', { color: s.color })
            if (s.bold) add('b', {}); if (s.italic) add('i', {}); if (s.underline) add('u', {})
            break
          }
          case 'ul': case 'ol': this.hold(`nested list inside ${where}`)
          default: this.hold(`<${n.tag}> inside the text of ${where}`)
        }
        for (const [k] of n.attrs) if (!(n.tag === 'a' && k === 'href') && !(n.tag === 'span' && k === 'style')) this.dropAttr(`<${n.tag}> in ${where}`, k)
        walk(n.children, next ?? marks)
      }
    }
    walk(nodes, {})
    // collapse: runs of spaces to one (the first keeps its marks), none at the block's ends or beside a <br>
    const out: Ch[] = []
    for (const c of chars) {
      if ('ch' in c && c.ch === ' ') {
        const prev = out[out.length - 1]
        if (!prev || 'br' in prev || prev.ch === ' ') continue
      }
      if ('br' in c) { const prev = out[out.length - 1]; if (prev && 'ch' in prev && prev.ch === ' ') out.pop() }
      out.push(c)
    }
    while (out.length && 'ch' in out[out.length - 1] && (out[out.length - 1] as { ch: string }).ch === ' ') out.pop()
    const inline: Inline[] = []
    for (const c of out) {
      if ('br' in c) { inline.push({ br: true }); continue }
      this.textChars++
      const last = inline[inline.length - 1]
      if (last && 'text' in last && sameMarks(last.marks, c.marks)) last.text += c.ch
      else inline.push({ text: c.ch, marks: canonMarks(c.marks) })
    }
    this.markCount += inline.filter((r) => 'text' in r && Object.keys(r.marks).length).length
    return { type, inline }
  }

  private enumAttr(target: Attrs, name: string, value: string, where: string) {
    const v = value.trim().toLowerCase()
    if (name === 'data-build-in' || name === 'data-build-out') { target[name] = v.replace(/\s+/g, ' '); return }
    const allowed = ENUMS[name]
    const ok = name === 'name' ? allowed.find((a) => a.toLowerCase() === v) : allowed.includes(v) ? v : undefined
    if (ok === undefined) { this.warn(where, `${name}="${value}" dropped (not one of ${allowed.join(', ')})`); return }
    if (ok !== value) this.note(where, `${name}="${value}" normalized to "${ok}"`)
    target[name] = ok
  }

  private dropAttr(where: string, name: string) {
    if (name === 'class' || name.startsWith('data-')) this.note(where, `${name} ignored`)
    else this.warn(where, `unsupported attribute ${name} dropped`)
  }

  /** `e<n>-<hash>`: n counts the id-less elements in document order, hash of the section id and the seed; bumped past taken ids. */
  private mintIds() {
    const taken = new Set([...this.ids, ...(this.opts.taken ?? [])])
    const h = hash4(`${this.sectionId}\u0000${this.opts.seed ?? ''}`)
    let n = 0
    for (const el of this.needsId) {
      let id = `e${++n}-${h}`
      while (taken.has(id)) id = `e${++n}-${h}`
      el.id = id; taken.add(id)
    }
  }
}

export function canonMarks(m: Marks): Marks {
  const out: Marks = {}
  for (const k of MARK_ORDER) if (m[k]) (out as Record<string, unknown>)[k] = m[k]
  return out
}
export function sameMarks(a: Marks, b: Marks): boolean { return JSON.stringify(canonMarks(a)) === JSON.stringify(canonMarks(b)) }

function textContent(n: RawNode): string {
  if (n.kind === 'text') return n.value
  if (n.kind === 'comment') return ''
  return n.children.map(textContent).join('')
}
