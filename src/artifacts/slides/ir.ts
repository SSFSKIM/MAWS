// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D1), from P3-0's S6 (spikes/p3-store/s6/src/ir.ts).
// The slide IR: the plain-data form between the dialect (a slide file's HTML) and the deck model. The loader
// (parse.ts) produces it, the serializer (serialize.ts) consumes it, the model maps it to and from Yjs. No Yjs here.

export type Tag =
  | 'h1' | 'h2' | 'h3' | 'p' | 'ul' | 'ol'
  | 'div' | 'img' | 'table' | 'tr' | 'th' | 'td' | 'hr' | 'svg'
  | 'x-shape' | 'x-icon' | 'x-connector' | 'x-embed';

/** Marks of the slide-text schema (Claude's inline set, no wider). Attribute objects follow y-prosemirror's mark shape. */
export interface Marks {
  a?: { href: string };
  span?: { color: string };
  b?: Record<string, never>;
  i?: Record<string, never>;
  u?: Record<string, never>;
}
export type MarkName = keyof Marks;
/** Outermost first: the canonical nesting order of inline tags. */
export const MARK_ORDER: readonly MarkName[] = ['a', 'span', 'b', 'i', 'u'];

export type Inline = { text: string; marks: Marks } | { br: true };
/** A text box's lines: one `p` block for h1-h3/p/th/td, one `li` block per item for ul/ol. */
export interface TextBlock {
  type: 'p' | 'li';
  inline: Inline[];
}

export type Style = Record<string, string>;
export type Attrs = Record<string, string>;

export interface ElementIR {
  /** The element's identity (§4.5). Table cells carry `''`: they are positional, their ids the model's (D2). */
  id: string;
  tag: Tag;
  /** Every attribute but `id` and `style`. */
  attrs: Attrs;
  /** Property → normalized value. */
  style: Style;
  /** A container's children (div, table, tr). */
  children: ElementIR[];
  /** A text element's blocks. */
  text?: TextBlock[];
  /** svg and x-embed: the inner markup, opaque. */
  raw?: string;
}

export interface SlideIR {
  id: string;
  /** `data-transition`, `data-section`, `hidden`. */
  attrs: Attrs;
  style: Style;
  children: ElementIR[];
  notes: string;
}

export type Severity = 'warning' | 'note';
/**
 * What the loader dropped or changed, shaped for the agent's tool answer (X25): the slide, the element (its id; absent
 * for the section itself) and the property or attribute concerned. A warning changed something visible; a note healed
 * to an equivalent.
 */
export interface Diagnostic {
  severity: Severity;
  slide: string;
  element?: string;
  property?: string;
  message: string;
}

export type LoadResult =
  | { ok: true; slide: SlideIR; diagnostics: Diagnostic[] }
  | { ok: false; held: { reasons: string[] }; diagnostics: Diagnostic[] };

export const TEXT_TAGS = new Set<Tag>(['h1', 'h2', 'h3', 'p', 'ul', 'ol', 'th', 'td']);
export const LIST_TAGS = new Set<Tag>(['ul', 'ol']);
export const CONTAINER_TAGS = new Set<Tag>(['div', 'table', 'tr']);
export const RAW_TAGS = new Set<Tag>(['svg', 'x-embed']);
export const CELL_TAGS = new Set<Tag>(['th', 'td']);

/** Pinned = out of flow: paints by z, not by flow order. A connector with coordinates is a pinned layer (Claude). */
export function isPinned(tag: Tag, style: Style, attrs: Attrs): boolean {
  return style.position === 'absolute' || (tag === 'x-connector' && attrs.x1 !== undefined);
}
