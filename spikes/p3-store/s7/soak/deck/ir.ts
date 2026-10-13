// COPY of spikes/p3-store/s6/src/ir.ts at 4ab6b9b7 for S7a (unchanged below this line).
// The slide IR: the plain-data form between the dialect (HTML files) and the Y.Doc model.
// parse() produces it, serialize() consumes it, model.ts maps it to and from Yjs. No Yjs here.

export type Tag =
  | 'h1' | 'h2' | 'h3' | 'p' | 'ul' | 'ol'
  | 'div' | 'img' | 'table' | 'tr' | 'th' | 'td' | 'hr' | 'svg'
  | 'x-shape' | 'x-icon' | 'x-connector' | 'x-embed'

/** Marks of the slide-text schema (Claude's inline set, no wider). Attribute objects follow y-prosemirror's mark shape. */
export interface Marks {
  a?: { href: string }
  span?: { color: string }
  b?: Record<string, never>
  i?: Record<string, never>
  u?: Record<string, never>
}
export type MarkName = keyof Marks
/** Outermost first: the canonical nesting order of inline tags. */
export const MARK_ORDER: readonly MarkName[] = ['a', 'span', 'b', 'i', 'u']

export type Inline = { text: string; marks: Marks } | { br: true }
/** A text box's lines: one `p` block for h1-h3/p/th/td, one `li` block per item for ul/ol. */
export interface TextBlock { type: 'p' | 'li'; inline: Inline[] }

export type Style = Record<string, string>
export type Attrs = Record<string, string>

export interface ElementIR {
  id: string
  tag: Tag
  attrs: Attrs // every attribute but id and style
  style: Style // property -> normalized value
  children: ElementIR[] // containers (div, table, tr)
  text?: TextBlock[] // text elements
  raw?: string // svg and x-embed: inner markup, opaque
}

export interface SlideIR {
  id: string
  attrs: Attrs // data-transition, hidden
  style: Style
  children: ElementIR[]
  notes: string
}

export type Severity = 'warning' | 'note'
export interface Diagnostic { severity: Severity; where: string; message: string }

export type LoadResult =
  | { ok: true; slide: SlideIR; diagnostics: Diagnostic[] }
  | { ok: false; held: { reasons: string[] }; diagnostics: Diagnostic[] }

export const TEXT_TAGS = new Set<Tag>(['h1', 'h2', 'h3', 'p', 'ul', 'ol', 'th', 'td'])
export const LIST_TAGS = new Set<Tag>(['ul', 'ol'])
export const CONTAINER_TAGS = new Set<Tag>(['div', 'table', 'tr'])
export const RAW_TAGS = new Set<Tag>(['svg', 'x-embed'])

/** Pinned = out of flow: paints by z, not by flow order. */
export function isPinned(tag: Tag, style: Style, attrs: Attrs): boolean {
  return style.position === 'absolute' || (tag === 'x-connector' && attrs.x1 !== undefined)
}
