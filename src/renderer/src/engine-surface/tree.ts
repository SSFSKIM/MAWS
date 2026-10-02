// The plain-data tree a plugin's `ui.render` hook drew, validated node by node before anything draws (R2; the engine's
// element table for the desktop surface, d.ts `RenderElement`; pass3/mods-surface-*). The engine validated the tree
// already (S287: "as the hooks engine validated it"); this is the surface's own guard, as Claude Desktop keeps one
// (c95e4d2cf-BLkI1oZK.js:434-627): a node that fails its element's shape draws as a fragment of its children, never
// failing its siblings, and a tree past Desktop's bounds (2000 nodes, depth 32, 256 KiB of text) draws nothing. Text is
// plain text, drawn as text nodes; a Link keeps only an `https:` or `http:` href; a Svg's source is bounded.
import * as z from 'zod';

export interface Press {
  plugin: string;
  handle: number;
}
export type StyleProps = Record<string, string | number | boolean>;

export type SurfaceNode =
  | string
  | { type: 'fragment'; children: SurfaceNode[] }
  | { type: 'Box' | 'Text' | 'div' | 'span' | 'b'; props: StyleProps; children: SurfaceNode[] }
  | { type: 'Button'; props: { key: string; label: string; hotkey?: string; plain?: boolean; dimColor?: boolean; variant?: 'primary' | 'secondary'; role?: 'dismiss'; autoFocus?: boolean }; press: Press }
  | { type: 'Input'; props: { key: string; label?: string; placeholder?: string; value?: string; submitLabel?: string; autoFocus?: boolean }; press: Press }
  | { type: 'Select'; props: { key: string; label?: string; options: { value: string; label?: string }[]; value?: string; autoFocus?: boolean }; press: Press }
  | { type: 'Link'; props: { href: string; label?: string }; children: SurfaceNode[] }
  | { type: 'Code'; props: { source: string; language?: string; path?: string; startLine?: number; format?: 'source' | 'diff'; wrap?: 'wrap' | 'truncate-end' } }
  | { type: 'Markdown'; props: { text: string; key?: string; dimColor?: boolean; pressableLinks?: string[] }; press?: Press }
  | { type: 'Svg'; props: { source: string; alt: string; width?: number; height?: number; isInteractive: boolean } }
  | { type: 'Client'; props: { key: string; module: string }; client: { plugin: string } }
  | { type: 'engine'; ref: number };

export const STYLED = ['Box', 'Text', 'div', 'span', 'b'] as const;
const HREF_MAX = 2048;
const SVG_MAX = 131_072;
const PX_MAX = 4096;

const str = z.string();
const opt = str.optional();
const flag = z.boolean().optional();
const press = z.strictObject({ plugin: z.string().max(256), handle: z.number().int() });
const webHref = (href: string) => {
  if (!URL.canParse(href)) return false;
  const { protocol } = new URL(href);
  return protocol === 'https:' || protocol === 'http:';
};

const SCHEMAS = {
  styled: z.looseObject({ type: z.enum(STYLED), props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional() }),
  engine: z.looseObject({ type: z.literal('engine'), ref: z.number().int() }),
  Button: z.looseObject({
    type: z.literal('Button'),
    props: z.looseObject({ key: str, label: str, hotkey: opt, action: opt, plain: flag, dimColor: flag, autoFocus: flag, variant: z.enum(['primary', 'secondary']).optional().catch(undefined), role: z.enum(['dismiss']).optional().catch(undefined) }),
    press,
  }),
  Input: z.looseObject({ type: z.literal('Input'), props: z.looseObject({ key: str, label: opt, placeholder: opt, value: opt, submitLabel: opt, autoFocus: flag }), press }),
  Select: z.looseObject({
    type: z.literal('Select'),
    props: z.looseObject({ key: str, label: opt, options: z.array(z.looseObject({ value: str, label: opt })).min(1).max(500), value: opt, autoFocus: flag }),
    press,
  }),
  Link: z.looseObject({ type: z.literal('Link'), props: z.looseObject({ href: str.max(HREF_MAX).refine(webHref), label: opt }) }),
  Code: z.looseObject({
    type: z.literal('Code'),
    props: z.looseObject({ source: str, language: opt, path: opt, startLine: z.number().int().optional().catch(undefined), format: z.enum(['source', 'diff']).optional().catch(undefined), wrap: z.enum(['wrap', 'truncate-end']).optional().catch(undefined) }),
  }),
  Markdown: z.looseObject({ type: z.literal('Markdown'), props: z.looseObject({ text: str, key: opt, dimColor: flag, pressableLinks: z.array(str.max(HREF_MAX)).max(500).optional() }), press: press.optional() }),
  Svg: z.looseObject({
    type: z.literal('Svg'),
    props: z.looseObject({ source: str.min(1).max(SVG_MAX), alt: str.trim().min(1), width: z.number().positive().max(PX_MAX).optional(), height: z.number().positive().max(PX_MAX).optional(), isInteractive: z.boolean().optional() }),
  }),
  Client: z.looseObject({ type: z.literal('Client'), props: z.looseObject({ key: str.min(1).max(256), module: str.min(1).max(256) }), client: z.looseObject({ plugin: str.min(1).max(256) }) }),
};

const fragment = (children: SurfaceNode[]): SurfaceNode => ({ type: 'fragment', children });

// Desktop's bounds on a drawn tree (c95e4d2cf:395-397).
const LIMITS = { nodes: 2000, depth: 32, chars: 262_144 };

interface Budget {
  nodes: number;
  chars: number;
}

function node(raw: unknown, depth: number, budget: Budget, above: Set<object>): SurfaceNode | null {
  budget.nodes += 1;
  if (budget.nodes >= LIMITS.nodes || depth >= LIMITS.depth) return null;
  if (typeof raw === 'string') {
    budget.chars += raw.length;
    return budget.chars < LIMITS.chars ? raw : null;
  }
  if (typeof raw === 'number') return String(raw);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || above.has(raw)) return fragment([]);
  const record = raw as Record<string, unknown>;
  budget.chars += JSON.stringify(record.props ?? {}).length;
  if (budget.chars >= LIMITS.chars) return null;
  const nested = new Set(above).add(raw);
  const kids = (): SurfaceNode[] | null => {
    const list = Array.isArray(record.children) ? record.children : [];
    const out: SurfaceNode[] = [];
    for (const child of list) {
      const drawn = node(child, depth + 1, budget, nested);
      if (drawn === null) return null;
      out.push(drawn);
    }
    return out;
  };
  const children = kids();
  if (children === null) return null;
  const type = record.type;
  if (typeof type === 'string' && (STYLED as readonly string[]).includes(type)) {
    const parsed = SCHEMAS.styled.safeParse(record);
    return parsed.success ? { type: parsed.data.type, props: parsed.data.props ?? {}, children } : fragment(children);
  }
  switch (type) {
    case 'engine': {
      const parsed = SCHEMAS.engine.safeParse(record);
      return parsed.success ? { type: 'engine', ref: parsed.data.ref } : fragment(children);
    }
    case 'Link': {
      const parsed = SCHEMAS.Link.safeParse(record);
      return parsed.success ? { type: 'Link', props: { href: parsed.data.props.href, ...(parsed.data.props.label !== undefined && { label: parsed.data.props.label }) }, children } : fragment(children);
    }
    case 'Button': {
      const parsed = SCHEMAS.Button.safeParse(record);
      if (!parsed.success) return fragment(children);
      const { key, label, hotkey, plain, dimColor, variant, role, autoFocus } = parsed.data.props;
      return { type: 'Button', props: { key, label, ...defined({ hotkey, plain, dimColor, variant, role, autoFocus }) }, press: parsed.data.press };
    }
    case 'Input': {
      const parsed = SCHEMAS.Input.safeParse(record);
      if (!parsed.success) return fragment(children);
      const { key, label, placeholder, value, submitLabel, autoFocus } = parsed.data.props;
      return { type: 'Input', props: { key, ...defined({ label, placeholder, value, submitLabel, autoFocus }) }, press: parsed.data.press };
    }
    case 'Select': {
      const parsed = SCHEMAS.Select.safeParse(record);
      if (!parsed.success || new Set(parsed.data.props.options.map((o) => o.value)).size !== parsed.data.props.options.length) return fragment(children);
      const { key, label, options, value, autoFocus } = parsed.data.props;
      return { type: 'Select', props: { key, options: options.map((o) => ({ value: o.value, ...(o.label !== undefined && { label: o.label }) })), ...defined({ label, value, autoFocus }) }, press: parsed.data.press };
    }
    case 'Code': {
      const parsed = SCHEMAS.Code.safeParse(record);
      if (!parsed.success) return fragment(children);
      const { source, language, path, startLine, format, wrap } = parsed.data.props;
      return { type: 'Code', props: { source, ...defined({ language, path, startLine, format, wrap }) } };
    }
    case 'Markdown': {
      const parsed = SCHEMAS.Markdown.safeParse(record);
      if (!parsed.success) return fragment(children);
      const { text, key, dimColor, pressableLinks } = parsed.data.props;
      return { type: 'Markdown', props: { text, ...defined({ key, dimColor, pressableLinks }) }, ...(parsed.data.press && { press: parsed.data.press }) };
    }
    case 'Svg': {
      const parsed = SCHEMAS.Svg.safeParse(record);
      if (!parsed.success || children.length > 0) return fragment(children);
      const { source, alt, width, height, isInteractive } = parsed.data.props;
      return { type: 'Svg', props: { source, alt, ...defined({ width, height }), isInteractive: isInteractive === true } };
    }
    case 'Client': {
      const parsed = SCHEMAS.Client.safeParse(record);
      if (!parsed.success || children.length > 0) return fragment(children);
      return { type: 'Client', props: { key: parsed.data.props.key, module: parsed.data.props.module }, client: { plugin: parsed.data.client.plugin } };
    }
    default:
      return fragment(children); // an element this surface does not draw (a terminal's Raster or Image): its children only
  }
}

function defined<T extends Record<string, unknown>>(record: T): Partial<T> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as Partial<T>;
}

// The tree to draw, or null when it is past the bounds (the site then draws MAWS's own, as for an `engine` answer).
export function parseTree(raw: unknown): SurfaceNode | null {
  return node(raw, 1, { nodes: 0, chars: 0 }, new Set());
}

// Whether a drawn tree is MAWS's own drawing (the `engine` node at its root, or nothing drawn at all).
export function drawsEngine(tree: SurfaceNode | null): boolean {
  return tree === null || (typeof tree !== 'string' && tree.type === 'engine');
}

// The text a tree says, flattened, for a site that draws text only (the working label) and for an accessible name.
export function textOf(tree: SurfaceNode | null): string {
  if (tree === null) return '';
  if (typeof tree === 'string') return tree;
  switch (tree.type) {
    case 'Button':
      return tree.props.label;
    case 'Link':
      return tree.children.length > 0 ? tree.children.map(textOf).join('') : (tree.props.label ?? tree.props.href);
    case 'Markdown':
      return tree.props.text;
    case 'Code':
      return tree.props.source;
    case 'Svg':
      return tree.props.alt;
    case 'Input':
    case 'Select':
      return tree.props.label ?? '';
    case 'Client':
    case 'engine':
      return '';
    default:
      return tree.children.map(textOf).join(tree.type === 'Box' || tree.type === 'div' ? ' ' : '');
  }
}
