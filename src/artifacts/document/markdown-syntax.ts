// The dialect's syntax for what GFM cannot say (D7 and Decision Log 15 of
// docs/doperpowers/plans/2026-10-12-p3-b-documents.md): one serializer and one parser per node or mark whose stored
// state plain GFM would lose, layered on the schema module's extensions by markdown.ts. Each form is read back by its
// own parser exactly; markdown.ts's head lists the forms. Kept apart from markdown.ts, which owns the sentinels, ids
// and milestones around them.
import { renderNestedMarkdownContent, type JSONContent, type MarkdownToken } from '@tiptap/core';
import { detectMarkerType, getListMarker, markerToStart } from '@tiptap/extension-list';
import { withoutControls } from './schema';

// ── attributes: `key="value"` (or single quotes), HTML-escaped ──
const escapeAttr = (value: string, quote = '"'): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
    .replace(/\t/g, '&#9;')
    .replace(quote === '"' ? /"/g : /'/g, quote === '"' ? '&quot;' : '&#39;');
const ENTITIES: Record<string, string> = { '#10': '\n', '#13': '\r', '#9': '\t', '#39': "'", quot: '"', lt: '<', gt: '>', amp: '&' };
const unescapeAttr = (value: string): string => value.replace(/&(#10|#13|#9|#39|quot|lt|gt|amp);/g, (_, name: string) => ENTITIES[name] ?? '');
export const attrString = (attrs: Record<string, string | null | undefined>): string =>
  Object.entries(attrs)
    .filter((entry): entry is [string, string] => entry[1] != null)
    .map(([key, value]) => (value.includes('"') && !value.includes("'") ? `${key}='${escapeAttr(value, "'")}'` : `${key}="${escapeAttr(value)}"`))
    .join(' ');
export function parseAttrString(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of source.matchAll(/([A-Za-z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[match[1]] = unescapeAttr(match[2] ?? match[3] ?? '');
  return out;
}
const braced = (attrs: Record<string, string | null | undefined>): string => {
  const text = attrString(attrs);
  return text ? ` {${text}}` : '';
};

/**
 * A block tokenizer's `start`: where in `src` a line of this block begins. marked asks it of a paragraph's text from its
 * second character to know where the paragraph stops, so only a match after a newline is a line start.
 */
const lineStart = (pattern: RegExp) => (src: string): number => {
  const at = src.search(pattern);
  return at < 0 ? -1 : at + 1;
};

// ── fences ──
// Structure (`:::callout`, `:::table`, `:::row`, `:::cell`) nests with three colons and closes on a `:::` line, counted
// by depth. Raw content never closes one: code fences, `$$` math and the raw `:::diagram`/`:::chart` sources are
// skipped while counting, and each of those is fenced longer than any line of its own content that could close it.
const longestRun = (text: string, line: RegExp): number => Math.max(0, ...text.split('\n').map((l) => line.exec(l)?.[1].length ?? 0));
export const backtickFence = (code: string): string => '`'.repeat(Math.max(3, Math.max(0, ...[...code.matchAll(/`+/g)].map((m) => m[0].length)) + 1));
const colonFence = (source: string): string => ':'.repeat(Math.max(3, longestRun(source, /^(:{3,})\s*$/) + 1));
const dollarFence = (latex: string): string => '$'.repeat(Math.max(2, longestRun(latex, /^(\${2,})\s*$/) + 1));

/** The closing line of a raw region a line opens (a code fence, display math, a raw colon block), if it opens one. */
export function rawRegion(line: string): RegExp | null {
  const code = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  if (code) return new RegExp(`^ {0,3}${code[1][0] === '`' ? '`' : '~'}{${code[1].length},}\\s*$`);
  const math = /^(\${2,})[ \t]*$/.exec(line);
  if (math) return new RegExp(`^${'\\$'.repeat(math[1].length)}[ \\t]*$`);
  const colons = /^(:{3,})(?:diagram|chart)(?![\w-])/.exec(line);
  if (colons) return new RegExp(`^${colons[1]}[ \\t]*$`);
  return null;
}

interface Fence {
  name: string;
  /** The rest of the opening line (attributes, a row's id comment). */
  head: string;
  body: string;
  raw: string;
}
const ONE_LINE = /\s:{3,}\s*$/; // `:::pending {…} :::`

/** The structure block `:::<name>` at the start of `src`, its body ending at the `:::` line that closes it. */
function readFence(src: string, names: string): Fence | undefined {
  const open = new RegExp(`^:::(${names})(?![\\w-])[ \\t]*([^\\n]*?)[ \\t]*(?:\\n|$)`).exec(src);
  if (!open || ONE_LINE.test(open[0].replace(/\n$/, ''))) return undefined;
  let depth = 1;
  let skip: RegExp | null = null;
  let at = open[0].length;
  if (!src.slice(0, at).endsWith('\n')) return undefined;
  for (const line of src.slice(at).split('\n')) {
    if (skip) {
      if (skip.test(line)) skip = null;
    } else if ((skip = rawRegion(line))) {
      // entered a raw region
    } else if (/^:::[\w-]/.test(line) && !ONE_LINE.test(line)) {
      depth += 1;
    } else if (/^:::[ \t]*$/.test(line) && --depth === 0) {
      const end = at + line.length;
      return { name: open[1], head: open[2], body: src.slice(open[0].length, Math.max(open[0].length, at - 1)), raw: src.slice(0, end + (src[end] === '\n' ? 1 : 0)) };
    }
    at += line.length + 1;
  }
  return undefined;
}

/** The structure blocks a body is made of, in order; null when it holds anything else. */
function readFences(body: string, names: string): Fence[] | null {
  const out: Fence[] = [];
  let rest = body.replace(/^\s+/, '');
  while (rest) {
    const fence = readFence(rest, names);
    if (!fence) return null;
    out.push(fence);
    rest = rest.slice(fence.raw.length).replace(/^\s+/, '');
  }
  return out;
}

type Lexer = { blockTokens(src: string): MarkdownToken[]; inlineTokens(src: string): MarkdownToken[] };

// ── ordered lists (Decision Log 19) ──
// A numbered list is marked's own (CommonMark: one space after the marker). A letter or roman marker opens an item only
// when two to four spaces follow it (Pandoc's rule, generalised), so `Dr. Smith` and `A. Lincoln` stay text; the
// serializer writes two. Tiptap's ordered-list tokenizer is not used: it took one space, cut continuation lines a column
// short (code gained a space per read) and read any line that looked like an item, code lines included, as one.
const LETTERED_TYPES = new Set(['a', 'A', 'i', 'I']);
const LETTERED = /^( {0,3})([a-zA-Z]+)([.)])( {2,4})(?=\S)/;
const isRoman = (marker: string): boolean => ['i', 'I'].includes(detectMarkerType(marker) ?? '');

/** A letter or roman item's marker and separator at the start of a line, and the column its content starts at. */
export function letteredItem(line: string): { marker: string; separator: string; column: number } | null {
  const match = LETTERED.exec(line);
  if (!match || !(/^(?:[a-z]{1,2}|[A-Z]{1,2})$/.test(match[2]) || isRoman(match[2]))) return null;
  return { marker: match[2], separator: match[3], column: match[0].length };
}
/** Where in `src` (after a newline) a lettered item starts, so one interrupts the paragraph of the item it nests in. */
const letteredStart = (src: string): number => {
  for (const candidate of src.matchAll(/\n( {0,3}[a-zA-Z]+[.)] {2,4}\S)/g)) if (letteredItem(candidate[1])) return candidate.index + 1;
  return -1;
};
/** One list's items share a separator and a case; another starts a new list. */
const sameList = (first: { marker: string; separator: string }, next: { marker: string; separator: string }): boolean =>
  next.separator === first.separator && (next.marker === next.marker.toUpperCase()) === (first.marker === first.marker.toUpperCase());

/** 1 for `a`, 26 for `z`, 27 for `aa` (Tiptap's numbering). */
const alphaValue = (marker: string): number => {
  const [first, second] = [...marker.toLowerCase()].map((char) => char.charCodeAt(0) - 96);
  return second == null ? first : first * 26 + second;
};
/**
 * A list's type and start from its first marker, and its second when the first reads both ways (`c` is the third
 * letter and roman 100): a second marker that is the next letter makes it a lettered list. Alone, a single letter is a
 * letter but `i`, and a longer valid roman numeral is roman.
 */
function listStyle(first: string, second: string | undefined): { type: string; start: number } {
  const upper = first === first.toUpperCase();
  const alpha = /^[a-z]{1,2}$/i.test(first);
  let roman = isRoman(first);
  if (alpha && roman) roman = second != null ? second.toLowerCase() !== getListMarker('a', alphaValue(first), '') : first.length > 1 || /^i$/i.test(first);
  if (roman) return { type: upper ? 'I' : 'i', start: markerToStart(first) };
  return { type: upper ? 'A' : 'a', start: alphaValue(first) };
}

const INTERRUPTS = /^ {0,3}(?:[-+*][ \t]|\d{1,9}[.)](?:[ \t]|$)|#{1,6}(?:[ \t]|$)|>|`{3,}|~{3,}|\$\$|:::)/;

/**
 * A lettered or roman list: its items' content is every following line indented to the item's column (blank lines
 * between), and an unindented line continues a paragraph the item ends in, never code.
 */
function letteredListToken(src: string, lexer: Lexer): MarkdownToken | undefined {
  const lines = src.split('\n');
  const items: Array<{ marker: string; separator: string; lines: string[] }> = [];
  let column = 0;
  let raw: RegExp | null = null; // a code fence or other raw region open in the current item
  let blank = false;
  let end = 0;
  for (const [at, line] of lines.entries()) {
    const current = items[items.length - 1];
    if (current && !/\S/.test(line)) {
      // a blank line; inside code, a whitespace-only line keeps what it holds past the item's indentation
      current.lines.push(raw ? line.slice(Math.min(column, /^ */.exec(line)![0].length)) : '');
      blank = true;
      continue;
    }
    if (current && /^ */.exec(line)![0].length >= column) {
      const content = line.slice(column);
      if (raw) {
        if (raw.test(content)) raw = null;
      } else raw = rawRegion(content);
      current.lines.push(content);
      [blank, end] = [false, at + 1];
      continue;
    }
    const item = letteredItem(line);
    if (item && (!current || sameList(items[0], item))) {
      items.push({ marker: item.marker, separator: item.separator, lines: [line.slice(item.column)] });
      column = item.column;
      raw = rawRegion(line.slice(item.column));
      [blank, end] = [false, at + 1];
      continue;
    }
    if (!current || item || blank || raw || INTERRUPTS.test(line)) break;
    current.lines.push(line); // a lazy continuation of the item's paragraph
    end = at + 1;
  }
  if (items.length === 0) return undefined;
  const { type, start } = listStyle(items[0].marker, items[1]?.marker);
  return {
    type: 'list',
    raw: lines.slice(0, end).join('\n'),
    ordered: true,
    start,
    typeMarker: type,
    items: items.map((item) => ({ type: 'list_item', raw: item.lines.join('\n'), tokens: lexer.blockTokens(item.lines.join('\n').replace(/\n+$/, '')) })),
  };
}

/** The serializer's marker: a number and one space, or a letter or roman numeral and two (Decision Log 19). */
type ItemContext = { parentType?: string; index?: number; meta?: { parentAttrs?: Record<string, unknown> } };
const itemMarker = (context: ItemContext): string => {
  if (context.parentType !== 'orderedList') return '- ';
  const attrs = context.meta?.parentAttrs ?? {};
  const type = attrs.type as string | null | undefined;
  return getListMarker(type, Number(attrs.start ?? 1) - 1 + (context.index ?? 0), LETTERED_TYPES.has(type ?? '') ? '.  ' : '. ');
};
type Json = JSONContent & { attrs?: Record<string, unknown> };
type Render = { renderChildren(nodes: JSONContent[] | JSONContent, separator?: string): string };
type Parse = {
  parseChildren(tokens: MarkdownToken[]): JSONContent[];
  parseInline(tokens: MarkdownToken[]): JSONContent[];
  applyMark(type: string, content: JSONContent[], attrs?: Record<string, unknown>): JSONContent;
};
const str = (value: unknown): string => (value == null ? '' : String(value));

/** `:::name {attrs}` NEWLINE markdown NEWLINE `:::`. */
const structureBlock = (name: string) => ({
  name,
  level: 'block' as const,
  start: lineStart(new RegExp(`\\n:::${name}(?![\\w-])`)),
  tokenize(src: string, _tokens: MarkdownToken[], lexer: Lexer) {
    const fence = readFence(src, name);
    if (!fence) return undefined;
    return { type: name, raw: fence.raw, attributes: parseAttrString(fence.head.replace(/^\{|\}$/g, '')), tokens: lexer.blockTokens(fence.body) };
  },
});

/** `:::name {attrs}` NEWLINE raw source NEWLINE `:::`, fenced by more colons when the source has a colon line. */
const rawBlock = (name: string) => ({
  name,
  level: 'block' as const,
  start: lineStart(new RegExp(`\\n:{3,}${name}(?![\\w-])`)),
  tokenize(src: string) {
    const open = new RegExp(`^(:{3,})${name}(?![\\w-])(?:[ \\t]+\\{([^\\n]*)\\})?[ \\t]*\\n`).exec(src);
    if (!open) return undefined;
    const close = new RegExp(`(?:^|\\n)${open[1]}[ \\t]*(?:\\n|$)`).exec(src.slice(open[0].length - 1));
    if (!close) return undefined;
    const bodyEnd = open[0].length - 1 + close.index;
    return { type: name, raw: src.slice(0, bodyEnd + close[0].length), attributes: parseAttrString(open[2] ?? ''), body: src.slice(open[0].length, Math.max(open[0].length, bodyEnd)) };
  },
});
const rawFenced = (name: string, attrs: Record<string, string | null>, source: string): string => {
  const fence = colonFence(source);
  return `${fence}${name}${braced(attrs)}\n${source}\n${fence}`;
};

// ── tables: GFM when GFM can say all of it, else structure blocks ──
const ALIGNS = new Set(['left', 'center', 'right']);
/** Text a GFM cell keeps as written: no hard break, no whitespace a cell would trim or collapse. */
const gfmText = (child: Json): boolean =>
  child.type === 'hardBreak' ? false : child.type !== 'text' || (!/[^\S ]/.test(child.text ?? '') && !/^ | $| {2}/.test(child.text ?? ''));

/** True when a pipe table holds every attribute and the content of `table` (header row first, plain cells). */
export function gfmTable(table: Json): boolean {
  const rows = (table.content ?? []) as Json[];
  if (rows.length === 0) return false;
  const width = rows[0].content?.length ?? 0;
  if (width === 0) return false;
  const aligns: unknown[] = [];
  return rows.every((row, r) => {
    const cells = (row.content ?? []) as Json[];
    if (cells.length !== width) return false;
    return cells.every((cell, c) => {
      const a = cell.attrs ?? {};
      if (cell.type !== (r === 0 ? 'tableHeader' : 'tableCell')) return false;
      if ((a.colspan ?? 1) !== 1 || (a.rowspan ?? 1) !== 1 || a.colwidth != null) return false;
      if (r === 0) aligns[c] = a.align ?? null;
      else if ((a.align ?? null) !== aligns[c]) return false;
      const blocks = (cell.content ?? []) as Json[];
      return blocks.length === 1 && blocks[0].type === 'paragraph' && ((blocks[0].content ?? []) as Json[]).every(gfmText);
    });
  });
}

/** Marks a table (in prepared JSON) to be written as structure blocks. */
export const BLOCKS_TABLE = '__blocks';

function renderBlocksTable(node: Json, h: Render): string {
  const rows = ((node.content ?? []) as Json[]).map((row) => {
    const id = row.attrs?.id as string | null | undefined;
    const cells = ((row.content ?? []) as Json[]).map((cell) => {
      const a = cell.attrs ?? {};
      const width = Array.isArray(a.colwidth) ? a.colwidth.join(',') : null;
      const attrs = braced({
        colspan: (a.colspan ?? 1) === 1 ? null : String(a.colspan),
        rowspan: (a.rowspan ?? 1) === 1 ? null : String(a.rowspan),
        colwidth: width,
        align: a.align == null ? null : String(a.align),
      });
      const body = cell.content?.length ? h.renderChildren(cell.content, '\n\n') : '';
      return `:::${cell.type === 'tableHeader' ? 'header' : 'cell'}${attrs}\n${body ? `${body}\n` : ''}:::`;
    });
    return `:::row${id ? ` <!-- ^${id} -->` : ''}\n${cells.length ? `${cells.join('\n')}\n` : ''}:::`;
  });
  return `:::table\n${rows.length ? `${rows.join('\n')}\n` : ''}:::`;
}

function blocksTableToken(src: string, lexer: Lexer) {
  const table = readFence(src, 'table');
  if (!table) return undefined;
  const rows = readFences(table.body, 'row');
  if (!rows) return undefined;
  const parsed = [];
  for (const row of rows) {
    const cells = readFences(row.body, 'cell|header');
    if (!cells) return undefined;
    parsed.push({
      id: /<!--\s*\^([0-9a-z]{2,32})\s*-->/.exec(row.head)?.[1] ?? null,
      cells: cells.map((cell) => ({ header: cell.name === 'header', attributes: parseAttrString(cell.head.replace(/^\{|\}$/g, '')), tokens: lexer.blockTokens(cell.body) })),
    });
  }
  return { type: 'blocksTable', raw: table.raw, rows: parsed };
}

function parseBlocksTable(token: MarkdownToken, h: Parse): JSONContent {
  const rows = token.rows as Array<{ id: string | null; cells: Array<{ header: boolean; attributes: Record<string, string>; tokens: MarkdownToken[] }> }>;
  return {
    type: 'table',
    content: rows.map((row) => ({
      type: 'tableRow',
      ...(row.id ? { attrs: { id: row.id } } : {}),
      content: row.cells.map((cell) => {
        const a = cell.attributes;
        const colwidth = a.colwidth ? a.colwidth.split(',').map(Number) : null;
        return {
          type: cell.header ? 'tableHeader' : 'tableCell',
          attrs: { colspan: Number(a.colspan ?? 1), rowspan: Number(a.rowspan ?? 1), colwidth, align: a.align && ALIGNS.has(a.align) ? a.align : null },
          content: h.parseChildren(cell.tokens),
        };
      }),
    })),
  };
}

// ── inline forms ──
const TAG_LINE = /^(<(?:chip|img|math)\b[^>\n]*\/>)[ \t]*(?:\n|$)/;
/** Inline math GFM-adjacent `$$…$$` can carry: one line, no `$$` inside, no `$` at either end. */
const plainLatex = (latex: string): boolean => /^[^\n$](?:[^\n]*[^\n$])?$/.test(latex) && !latex.includes('$$');
/** An image `![alt](src)` carries exactly: a plain address, a plain or absent alt, no asset. */
const plainImage = (a: Record<string, unknown>): boolean =>
  a.assetId == null && typeof a.src === 'string' && /^[^\s()<>\\]+$/.test(a.src) && (a.alt == null || (typeof a.alt === 'string' && /^[\p{L}\p{N} .,:;?'/-]+$/u.test(a.alt)));
const parseOptions = (text: string | undefined): string[] => {
  try {
    const value: unknown = JSON.parse(text ?? '[]');
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
};

/** The serializers and parsers, by extension name, that markdown.ts extends the schema's extensions with. */
export const MARKDOWN: Record<string, object> = {
  // The three entities the dialect writes for whitespace Markdown would drop (markdown.ts) read back as that whitespace;
  // marked leaves character references in text, and Tiptap decodes only the four it writes itself.
  text: {
    markdownTokenizer: {
      name: 'whitespaceEntity',
      level: 'inline',
      start: (src: string) => src.search(/&#(?:32|9|160);/),
      tokenize: (src: string) => {
        const match = /^&#(32|9|160);/.exec(src);
        return match ? { type: 'text', raw: match[0], text: String.fromCharCode(Number(match[1])) } : undefined;
      },
    },
  },
  // A paragraph is always a paragraph: Tiptap would lift a lone image out of it into a block the schema does not have.
  paragraph: {
    parseMarkdown: (token: MarkdownToken, h: Parse) => ({ type: 'paragraph', content: h.parseInline(token.tokens ?? []) }),
  },
  callout: {
    markdownTokenizer: structureBlock('callout'),
    parseMarkdown: (token: MarkdownToken, h: Parse) => {
      const tone = token.attributes?.tone as string | undefined;
      const content = h.parseChildren(token.tokens ?? []);
      return { type: 'callout', attrs: { tone: tone && ['note', 'tip', 'warn', 'danger'].includes(tone) ? tone : 'note' }, content: content.length ? content : [{ type: 'paragraph' }] };
    },
    renderMarkdown: (node: Json, h: Render) => `:::callout${braced({ tone: str(node.attrs?.tone ?? 'note') })}\n${h.renderChildren(node.content ?? [], '\n\n')}\n:::`,
  },
  diagram: {
    markdownTokenizer: rawBlock('diagram'),
    parseMarkdown: (token: MarkdownToken) => ({ type: 'diagram', attrs: { source: token.body as string } }),
    renderMarkdown: (node: Json) => rawFenced('diagram', {}, str(node.attrs?.source)),
  },
  // `spec` is opaque (E shapes it): a string rides as `spec`, any other value as its JSON in `spec-json`.
  chart: {
    markdownTokenizer: rawBlock('chart'),
    parseMarkdown: (token: MarkdownToken) => {
      const a = (token.attributes ?? {}) as Record<string, string>;
      let spec: unknown = a.spec ?? null;
      if (a['spec-json'] != null) {
        try {
          spec = JSON.parse(a['spec-json']);
        } catch {
          spec = a['spec-json'];
        }
      }
      return { type: 'chart', attrs: { source: token.body as string, spec } };
    },
    renderMarkdown: (node: Json) => {
      const spec = node.attrs?.spec;
      return rawFenced('chart', { spec: typeof spec === 'string' ? spec : null, 'spec-json': spec == null || typeof spec === 'string' ? null : JSON.stringify(spec) }, str(node.attrs?.source));
    },
  },
  pending: {
    markdownTokenizer: {
      name: 'pending',
      level: 'block',
      start: lineStart(/\n:::pending\b/),
      tokenize: (src: string) => {
        const match = /^:::pending(?:[ \t]+\{([^\n]*?)\})?[ \t]*:::[ \t]*(?:\n|$)/.exec(src);
        return match ? { type: 'pending', raw: match[0], attributes: parseAttrString(match[1] ?? '') } : undefined;
      },
    },
    parseMarkdown: (token: MarkdownToken) => ({ type: 'pending', attrs: { intent: token.attributes?.intent ?? '' } }),
    renderMarkdown: (node: Json) => `:::pending${braced({ intent: str(node.attrs?.intent) })} :::`,
  },
  mathBlock: {
    markdownTokenizer: {
      name: 'mathBlock',
      level: 'block',
      start: lineStart(/\n\$\$+[ \t]*(?:\n|$)/),
      tokenize: (src: string) => {
        const match = /^(\${2,})[ \t]*\n([\s\S]*?)\n\1[ \t]*(?:\n|$)/.exec(src);
        return match ? { type: 'mathBlock', raw: match[0], latex: match[2] } : undefined;
      },
    },
    parseMarkdown: (token: MarkdownToken) => ({ type: 'mathBlock', attrs: { latex: token.latex as string } }),
    renderMarkdown: (node: Json) => {
      const latex = str(node.attrs?.latex);
      const fence = dollarFence(latex);
      return `${fence}\n${latex}\n${fence}`;
    },
  },
  // `$$latex$$` inline; LaTeX that form cannot hold (empty, several lines, a `$` at an end) as `<math latex="…"/>`.
  math: {
    markdownTokenizer: {
      name: 'math',
      level: 'inline',
      start: (src: string) => {
        const at = [src.indexOf('$$'), src.indexOf('<math')].filter((i) => i >= 0);
        return at.length ? Math.min(...at) : -1;
      },
      tokenize: (src: string) => {
        const tag = /^<math\b([^>]*?)\/>/.exec(src);
        if (tag) return { type: 'math', raw: tag[0], latex: parseAttrString(tag[1]).latex ?? '' };
        const match = /^\$\$([^\n$](?:[^\n]*?[^\n$])?)\$\$(?!\$)/.exec(src);
        return match && !match[1].includes('$$') ? { type: 'math', raw: match[0], latex: match[1] } : undefined;
      },
    },
    parseMarkdown: (token: MarkdownToken) => ({ type: 'math', attrs: { latex: token.latex as string } }),
    renderMarkdown: (node: Json) => {
      const latex = str(node.attrs?.latex);
      return plainLatex(latex) ? `$$${latex}$$` : `<math ${attrString({ latex })}/>`;
    },
  },
  // The three chips share one syntax and so one tokenizer, registered on `date` under the token name `chip`.
  date: {
    markdownTokenName: 'chip',
    markdownTokenizer: {
      name: 'chip',
      level: 'inline',
      start: (src: string) => src.indexOf('<chip'),
      tokenize: (src: string) => {
        const match = /^<chip\b([^>]*?)\/>/.exec(src);
        return match ? { type: 'chip', raw: match[0], attributes: parseAttrString(match[1]) } : undefined;
      },
    },
    parseMarkdown: (token: MarkdownToken) => {
      const a = (token.attributes ?? {}) as Record<string, string>;
      if (a.kind === 'mention') return { type: 'mention', attrs: { kind: a.type ?? 'person', ref: a.ref ?? null, label: a.label ?? '' } };
      if (a.kind === 'dropdown') return { type: 'dropdown', attrs: { options: parseOptions(a.options), value: a.value ?? null } };
      if (a.kind === 'date') return { type: 'date', attrs: { iso: a.iso ?? null } };
      return { type: 'text', text: token.raw ?? '' };
    },
    renderMarkdown: (node: Json) => `<chip ${attrString({ kind: 'date', iso: node.attrs?.iso as string | null })}/>`,
  },
  // A line that is one of the dialect's inline tags alone would read as an HTML block: it is a paragraph.
  mention: {
    markdownTokenizer: {
      name: 'tagLine',
      level: 'block',
      start: lineStart(/\n<(?:chip|img|math)\b/),
      tokenize: (src: string, _tokens: MarkdownToken[], lexer: Lexer) => {
        const match = TAG_LINE.exec(src);
        return match ? { type: 'paragraph', raw: match[0], text: match[1], tokens: lexer.inlineTokens(match[1]) } : undefined;
      },
    },
    renderMarkdown: (node: Json) =>
      `<chip ${attrString({ kind: 'mention', type: str(node.attrs?.kind ?? 'person'), ref: node.attrs?.ref as string | null, label: str(node.attrs?.label) })}/>`,
  },
  // `<!---->` (markdown.ts's separator) reads as nothing.
  dropdown: {
    markdownTokenName: 'separator',
    markdownTokenizer: { name: 'separator', level: 'inline', start: (src: string) => src.indexOf('<!---->'), tokenize: (src: string) => (src.startsWith('<!---->') ? { type: 'separator', raw: '<!---->' } : undefined) },
    parseMarkdown: () => [],
    renderMarkdown: (node: Json) => `<chip ${attrString({ kind: 'dropdown', value: node.attrs?.value as string | null, options: JSON.stringify(node.attrs?.options ?? []) })}/>`,
  },
  // `![alt](src)` when that says it all; else `<img src="…" alt="…" asset="…"/>` (an asset, an empty alt, a rich one).
  image: {
    markdownTokenizer: {
      name: 'imgTag',
      level: 'inline',
      start: (src: string) => src.indexOf('<img'),
      tokenize: (src: string) => {
        const match = /^<img\b([^>]*?)\/>/.exec(src);
        return match ? { type: 'image', raw: match[0], attributes: parseAttrString(match[1]) } : undefined;
      },
    },
    parseMarkdown: (token: MarkdownToken) => {
      const a = token.attributes as Record<string, string> | undefined;
      if (a) return { type: 'image', attrs: { src: a.src ?? null, alt: a.alt ?? null, assetId: a.asset ?? null } };
      return { type: 'image', attrs: { src: token.href ?? null, alt: token.text || null } };
    },
    renderMarkdown: (node: Json) => {
      const a = node.attrs ?? {};
      if (plainImage(a)) return `![${str(a.alt)}](${str(a.src)})`;
      return `<img ${attrString({ src: a.src as string | null, alt: a.alt as string | null, asset: a.assetId as string | null })}/>`;
    },
  },
  // `==text==`, or `<mark color="…">text</mark>` with a colour; `=` inside the text is fine.
  highlight: {
    markdownTokenizer: {
      name: 'highlight',
      level: 'inline',
      start: (src: string) => {
        const at = [src.indexOf('=='), src.indexOf('<mark')].filter((i) => i >= 0);
        return at.length ? Math.min(...at) : -1;
      },
      tokenize: (src: string, _tokens: MarkdownToken[], lexer: Lexer) => {
        const tag = /^<mark\b([^>]*)>([\s\S]*?)<\/mark>/.exec(src);
        if (tag) return { type: 'highlight', raw: tag[0], attributes: parseAttrString(tag[1]), tokens: lexer.inlineTokens(tag[2]) };
        const plain = /^==((?:\\[\s\S]|[^\\=]|=(?!=))+?)==(?!=)/.exec(src);
        return plain ? { type: 'highlight', raw: plain[0], tokens: lexer.inlineTokens(plain[1]) } : undefined;
      },
    },
    parseMarkdown: (token: MarkdownToken, h: Parse) => h.applyMark('highlight', h.parseInline(token.tokens ?? []), { color: token.attributes?.color ?? null }),
    renderMarkdown: (node: Json, h: Render) =>
      node.attrs?.color == null ? `==${h.renderChildren(node)}==` : `<mark ${attrString({ color: String(node.attrs.color) })}>${h.renderChildren(node)}</mark>`,
  },
  // An address with spaces, parentheses or brackets goes in `<…>`; a title keeps its quotes; an empty title stays. Neither
  // holds a control character (the schema's contract, Decision Log 18): none is read in, and none is written out.
  link: {
    // marked reads an empty title (`""`) as none: the raw text tells them apart
    parseMarkdown: (token: MarkdownToken, h: Parse) => {
      const title = token.title || (/\s(?:""|''|\(\))\)$/.test(token.raw ?? '') ? '' : null);
      return h.applyMark('link', h.parseInline(token.tokens ?? []), { href: withoutControls(token.href), title: withoutControls(title) });
    },
    renderMarkdown: (node: Json, h: Render) => {
      const href = withoutControls(str(node.attrs?.href));
      const title = withoutControls(node.attrs?.title as string | null | undefined);
      const destination = /^[^\s()<>\\]*$/.test(href) ? href : `<${href.replace(/[\\<>]/g, '\\$&')}>`;
      return `[${h.renderChildren(node)}](${destination}${title == null ? '' : ` "${title.replace(/[\\"]/g, '\\$&')}"`})`;
    },
  },
  // A numbered list is marked's; a lettered or roman one this tokenizer's (Decision Log 19).
  orderedList: {
    markdownTokenizer: {
      name: 'orderedList',
      level: 'block',
      start: letteredStart,
      tokenize: (src: string, _tokens: MarkdownToken[], lexer: Lexer) => letteredListToken(src, lexer),
    },
  },
  listItem: {
    renderMarkdown: (node: Json, h: Parameters<typeof renderNestedMarkdownContent>[1], ctx?: ItemContext) =>
      renderNestedMarkdownContent(node, h, itemMarker, ctx, { alignNestedToPrefix: ctx?.parentType === 'orderedList' }),
  },
  // Fenced longer than any run of backticks in the code, so the code never closes its own fence.
  codeBlock: {
    renderMarkdown: (node: Json, h: Render) => {
      const code = node.content?.length ? h.renderChildren(node.content) : '';
      const fence = backtickFence(code);
      return `${fence}${str(node.attrs?.language)}\n${code}\n${fence}`;
    },
  },
  // A table GFM cannot say (merged or sized cells, several blocks in a cell, no header row, …) as structure blocks:
  //   :::table / :::row <!-- ^id --> / :::header {colspan="2" colwidth="120,80" align="center"} / :::cell …
  table: {
    renderMarkdown(this: { parent?: (node: Json, h: Render) => string }, node: Json, h: Render) {
      return node.attrs?.[BLOCKS_TABLE] ? renderBlocksTable(node, h) : (this.parent?.(node, h) ?? '');
    },
  },
  tableRow: {
    markdownTokenName: 'blocksTable',
    markdownTokenizer: { name: 'blocksTable', level: 'block', start: lineStart(/\n:::table(?![\w-])/), tokenize: (src: string, _t: MarkdownToken[], lexer: Lexer) => blocksTableToken(src, lexer) },
    parseMarkdown: (token: MarkdownToken, h: Parse) => parseBlocksTable(token, h),
  },
};
