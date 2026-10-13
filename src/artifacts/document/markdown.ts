// The agent's markdown (D1, D7 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; §4.4): GFM through
// `@tiptap/markdown` over the schema module's own extensions, plus this kind's dialect:
//
//   block ids     ` ^id` at the end of a one-line block's line (a paragraph, a heading; a list item's first line names
//                 the item); `^id` on its own line after a top-level block of several lines (a list, a quote, a table,
//                 code, a callout, the atoms); `<!-- ^id -->` after a table row's closing pipe (cells are positional).
//                 Inside containers, the ids of nested containers are not shown (a parse mints them).
//   chips         `<chip kind="date" iso="2026-10-12"/>`, `<chip kind="mention" type="person" ref="…" label="…"/>`,
//                 `<chip kind="dropdown" value="Doing" options='["Todo","Doing","Done"]'/>`
//   math          `$$E = mc^2$$` inline; a display block is `$$`, the LaTeX, `$$` on lines of their own
//   blocks        `:::callout {tone="warn"}` … `:::` (markdown inside), `:::diagram` … `:::` (mermaid source),
//                 `:::chart {spec="…"}` … `:::` (its source), `:::pending {intent="…"} :::`
//   comments      `<c:ID>` where an open thread's text starts and `</c:ID>` where it ends (each closing tag names its
//                 thread, so overlapping comments need no nesting; S5's read format); ignored on parse
//
// `@tiptap/markdown` tracks marks by type and so cannot write overlapping comments, nor does it place ids: both go into
// the content as private-use sentinel characters before it serializes and become the dialect after; a parse turns the
// dialect into sentinels first and back into ids after. Text that would read as markup is backslash-escaped, so
// serialize → parse returns the content. Copied and extended from P3-0's `s4/src/markdown.ts` and `s5/lib/read.mjs`.
import type { AnyExtension, JSONContent, MarkdownToken } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { MarkdownManager } from '@tiptap/markdown';
import { Marked } from 'marked';
import { BLOCK_TYPES, extensions, nanoid8, schemaFor } from './schema';

export interface SerializeOptions {
  /** Write block ids (`^id`, `<!-- ^id -->`); off for an export. Default on. */
  ids?: boolean;
  /** The threads whose comments are written as `<c:ID>…</c:ID>` milestones; comment marks are dropped otherwise. */
  milestones?: ReadonlySet<string> | null;
}

export interface ParseOptions {
  /** Mints the id of every block the markdown does not name. */
  generateID?: () => string;
}

// ── sentinels: private-use characters around an index into a per-call table ──
const LINE = '\uE000'; // the id of the textblock (or list item, or table row's last cell's row) the line belongs to
const ROW = '\uE001';
const OPEN = '\uE002'; // a comment milestone, opening
const CLOSE = '\uE003';
const BLOCK = '\uE004'; // a marker line naming the block before it (parse only)
const END = '\uE00F';
const sentinel = (kind: string, index: number): string => `${kind}${index}${END}`;
const SENTINEL = /[\uE000-\uE004](\d+)\uE00F/g;

const ID = '[0-9a-z]{2,32}';
const MARKER_LINE = new RegExp(`^[ \\t]*\\^(${ID})[ \\t]*$`);
const MARKER_EOL = new RegExp(`^(.*?)[ \\t]+\\^(${ID})[ \\t]*$`);
const MARKER_ROW = new RegExp(`^(.*?)[ \\t]*<!--[ \\t]*\\^(${ID})[ \\t]*-->[ \\t]*$`);
/** A comment milestone, as the agent reads it. */
export const MILESTONE = /<\/?c:[A-Za-z0-9_-]+>/g;
export const stripMilestones = (text: string): string => text.replace(MILESTONE, '');

// ── the dialect's attributes: `key="value"` (or single quotes), HTML-escaped ──
const escapeAttr = (value: string, quote = '"'): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '&#10;')
    .replace(quote === '"' ? /"/g : /'/g, quote === '"' ? '&quot;' : '&#39;');
const unescapeAttr = (value: string): string =>
  value.replace(/&(#10|#39|quot|lt|gt|amp);/g, (_, name: string) => ({ '#10': '\n', '#39': "'", quot: '"', lt: '<', gt: '>', amp: '&' })[name] ?? '');
const attrString = (attrs: Record<string, string | null | undefined>): string =>
  Object.entries(attrs)
    .filter((entry): entry is [string, string] => entry[1] != null)
    .map(([key, value]) => (value.includes('"') && !value.includes("'") ? `${key}='${escapeAttr(value, "'")}'` : `${key}="${escapeAttr(value)}"`))
    .join(' ');
function parseAttrString(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of source.matchAll(/([A-Za-z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[match[1]] = unescapeAttr(match[2] ?? match[3] ?? '');
  return out;
}
const braced = (attrs: Record<string, string | null | undefined>): string => {
  const text = attrString(attrs);
  return text ? ` {${text}}` : '';
};

// ── the custom nodes' markdown: one serializer and one parser each ──
type Json = JSONContent & { attrs?: Record<string, unknown> };
const str = (value: unknown): string => (value == null ? '' : String(value));
const json = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value));
const parseOptions = (text: string | undefined): string[] => {
  try {
    const value: unknown = JSON.parse(text ?? '[]');
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
};

/**
 * A block tokenizer's `start`: where in `src` a line of this block begins. marked asks it of a paragraph's text from its
 * second character to know where the paragraph stops, so only a match after a newline is a line start.
 */
const lineStart = (pattern: RegExp) => (src: string): number => {
  const at = src.search(pattern);
  return at < 0 ? -1 : at + 1;
};

/** `:::name {attrs}` NEWLINE body NEWLINE `:::`, the body raw (diagram, chart) or markdown (callout). */
const fencedBlock = (name: string, raw: boolean) => ({
  name,
  level: 'block' as const,
  start: lineStart(new RegExp(`\\n:::${name}\\b`)),
  tokenize(src: string, _tokens: MarkdownToken[], lexer: { blockTokens(src: string): MarkdownToken[] }) {
    const open = new RegExp(`^:::${name}(?:[ \\t]+\\{([^\\n]*)\\})?[ \\t]*\\n`).exec(src);
    if (!open) return undefined;
    // the body ends at the `:::` line that closes this block: nested `:::name` lines open deeper levels
    let depth = 1;
    let at = open[0].length;
    for (const line of src.slice(at).split('\n')) {
      if (/^:::[\w-]+/.test(line) && !/\s:::\s*$/.test(line)) depth += 1;
      else if (/^:::\s*$/.test(line)) depth -= 1;
      if (depth === 0) {
        const body = src.slice(open[0].length, at).replace(/\n$/, '');
        return {
          type: name,
          raw: src.slice(0, at + line.length + (src[at + line.length] === '\n' ? 1 : 0)),
          attributes: parseAttrString(open[1] ?? ''),
          body,
          tokens: raw ? [] : lexer.blockTokens(body),
        };
      }
      at += line.length + 1;
    }
    return undefined;
  },
});

const MARKDOWN: Record<string, object> = {
  callout: {
    markdownTokenizer: fencedBlock('callout', false),
    parseMarkdown: (token: MarkdownToken, h: { parseChildren(tokens: MarkdownToken[]): JSONContent[] }) => {
      const tone = token.attributes?.tone as string | undefined;
      const content = h.parseChildren(token.tokens ?? []);
      return { type: 'callout', attrs: { tone: tone && ['note', 'tip', 'warn', 'danger'].includes(tone) ? tone : 'note' }, content: content.length ? content : [{ type: 'paragraph' }] };
    },
    renderMarkdown: (node: Json, h: { renderChildren(nodes: JSONContent[], separator?: string): string }) =>
      `:::callout${braced({ tone: str(node.attrs?.tone ?? 'note') })}\n${h.renderChildren(node.content ?? [], '\n\n')}\n:::`,
  },
  diagram: {
    markdownTokenizer: fencedBlock('diagram', true),
    parseMarkdown: (token: MarkdownToken) => ({ type: 'diagram', attrs: { source: token.body as string } }),
    renderMarkdown: (node: Json) => `:::diagram\n${str(node.attrs?.source)}\n:::`,
  },
  chart: {
    markdownTokenizer: fencedBlock('chart', true),
    parseMarkdown: (token: MarkdownToken) => ({ type: 'chart', attrs: { source: token.body as string, spec: token.attributes?.spec ?? null } }),
    renderMarkdown: (node: Json) => `:::chart${braced({ spec: node.attrs?.spec == null ? null : json(node.attrs.spec) })}\n${str(node.attrs?.source)}\n:::`,
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
      start: lineStart(/\n\$\$[ \t]*(?:\n|$)/),
      tokenize: (src: string) => {
        const match = /^\$\$[ \t]*\n([\s\S]*?)\n\$\$[ \t]*(?:\n|$)/.exec(src);
        return match ? { type: 'mathBlock', raw: match[0], latex: match[1] } : undefined;
      },
    },
    parseMarkdown: (token: MarkdownToken) => ({ type: 'mathBlock', attrs: { latex: token.latex as string } }),
    renderMarkdown: (node: Json) => `$$\n${str(node.attrs?.latex)}\n$$`,
  },
  math: {
    markdownTokenizer: {
      name: 'math',
      level: 'inline',
      start: (src: string) => src.indexOf('$$'),
      tokenize: (src: string) => {
        const match = /^\$\$([^\n]+?)\$\$/.exec(src);
        return match ? { type: 'math', raw: match[0], latex: match[1] } : undefined;
      },
    },
    parseMarkdown: (token: MarkdownToken) => ({ type: 'math', attrs: { latex: token.latex as string } }),
    renderMarkdown: (node: Json) => `$$${str(node.attrs?.latex)}$$`,
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
  mention: {
    renderMarkdown: (node: Json) =>
      `<chip ${attrString({ kind: 'mention', type: str(node.attrs?.kind ?? 'person'), ref: node.attrs?.ref as string | null, label: str(node.attrs?.label) })}/>`,
  },
  dropdown: {
    renderMarkdown: (node: Json) => `<chip ${attrString({ kind: 'dropdown', value: node.attrs?.value as string | null, options: JSON.stringify(node.attrs?.options ?? []) })}/>`,
  },
  image: {
    parseMarkdown: (token: MarkdownToken) => ({ type: 'image', attrs: { src: token.href ?? null, alt: token.text || null } }),
    renderMarkdown: (node: Json) => `![${str(node.attrs?.alt).replace(/([\\[\]])/g, '\\$1')}](${str(node.attrs?.src).replace(/([ ()])/g, (c) => encodeURIComponent(c))})`,
  },
};

const markdownExtensions = (): AnyExtension[] =>
  extensions().map((ext) => (MARKDOWN[ext.name] ? (ext as unknown as { extend(config: object): AnyExtension }).extend(MARKDOWN[ext.name]) : ext));

// ── escaping text that would read as markup ──
const TEXTBLOCKS = new Set(['paragraph', 'heading']);
const CONTAINERS_WITH_OWN_LINES = new Set(['doc', 'blockquote', 'callout']);
const ITEMS = new Set(['listItem', 'taskItem']);
const CELLS = new Set(['tableCell', 'tableHeader']);

// `@tiptap/markdown` already backslash-escapes \\ ` * _ [ ] ~ in text and writes & < > as entities; what the dialect adds
// is escaped here, through a placeholder its escaper leaves alone and `restore` turns into the backslash.
const ESC = '\uE005';
function escapeText(text: string, { lineStart, lineEnd, inCell }: { lineStart: boolean; lineEnd: boolean; inCell: boolean }): string {
  let out = text.replace(/==/g, `${ESC}=${ESC}=`).replace(/\+\+/g, `${ESC}+${ESC}+`).replace(/\$\$/g, `${ESC}$${ESC}$`);
  if (inCell) out = out.replace(/\|/g, `${ESC}|`);
  if (lineStart) out = out.replace(/^(\s*)(#{1,6}(?=\s|$)|[-+](?=\s)|:::|\^)/, `$1${ESC}$2`).replace(/^(\s*\d+)([.)])(?=\s|$)/, `$1${ESC}$2`);
  if (lineEnd) out = out.replace(new RegExp(`([ \\t])\\^(${ID})$`), `$1${ESC}^$2`);
  return out;
}

interface Tables {
  ids: string[];
  threads: string[];
}

// ── serialization: the content prepared with sentinels, serialized, the sentinels turned into the dialect ──
function prepareInline(content: Json[], parent: Json, show: ReadonlySet<string>, tables: Tables, cell: boolean): Json[] {
  const code = parent.type === 'codeBlock';
  const out: Json[] = [];
  let active: string[] = [];
  const restMarks = (node: Json | undefined) => (node?.marks ?? []).filter((mark) => mark.type !== 'comment');
  const pushSentinel = (kind: string, id: string, marks: Json['marks']) => {
    tables.threads.push(id);
    out.push({ type: 'text', text: sentinel(kind, tables.threads.length - 1), ...(marks && marks.length ? { marks } : {}) });
  };
  content.forEach((node, i) => {
    const ids = code ? [] : (node.marks ?? []).filter((mark) => mark.type === 'comment' && show.has(String(mark.attrs?.threadId))).map((mark) => String(mark.attrs?.threadId));
    const now = node.type === 'text' ? ids : [];
    for (const id of active.filter((open) => !now.includes(open)).reverse()) pushSentinel(CLOSE, id, restMarks(content[i - 1]));
    for (const id of now.filter((id) => !active.includes(id))) pushSentinel(OPEN, id, restMarks(node));
    active = now;
    if (node.type !== 'text') {
      out.push(node);
      return;
    }
    const marks = restMarks(node);
    const inCode = code || marks.some((mark) => mark.type === 'code');
    const prev = content[i - 1];
    const text = inCode ? node.text ?? '' : escapeText(node.text ?? '', { lineStart: i === 0 || prev?.type === 'hardBreak', lineEnd: i === content.length - 1, inCell: cell });
    out.push({ ...node, text, marks: marks.length ? marks : undefined });
  });
  for (const id of active.reverse()) pushSentinel(CLOSE, id, restMarks(content[content.length - 1]));
  return out;
}

/** Prepares one node: escaped text, comment milestones, and (with ids) the id sentinels where the dialect shows ids. */
function prepare(node: Json, parent: Json, show: ReadonlySet<string>, tables: Tables, ids: boolean, inherited: { line?: string; row?: string }, cell = false): Json {
  const children = node.content ?? [];
  if (node.type === 'text' || children.length === 0) {
    if (!TEXTBLOCKS.has(node.type ?? '') || !ids) return node;
  }
  const isTextblock = TEXTBLOCKS.has(node.type ?? '') || node.type === 'codeBlock';
  if (isTextblock) {
    let content = prepareInline(children as Json[], node, show, tables, cell);
    if (ids && node.type !== 'codeBlock') {
      const own = CONTAINERS_WITH_OWN_LINES.has(parent.type ?? '') ? (node.attrs?.id as string | undefined) : undefined;
      const lineId = inherited.line ?? own;
      if (lineId || inherited.row) {
        if (content.length === 0 || content.every((child) => child.type === 'text' && !child.text)) content = [{ type: 'text', text: '\u00A0' }];
        if (lineId) {
          tables.ids.push(lineId);
          content.push({ type: 'text', text: sentinel(LINE, tables.ids.length - 1) });
        }
        if (inherited.row) {
          tables.ids.push(inherited.row);
          content.push({ type: 'text', text: sentinel(ROW, tables.ids.length - 1) });
        }
      }
    }
    return { ...node, content };
  }
  const last = children.length - 1;
  return {
    ...node,
    content: children.map((child, i) => {
      const pass: { line?: string; row?: string } = {};
      if (ids && ITEMS.has(node.type ?? '') && i === 0 && TEXTBLOCKS.has(child.type ?? '')) pass.line = node.attrs?.id as string | undefined;
      if (ids && node.type === 'tableRow' && i === last) pass.row = node.attrs?.id as string | undefined;
      if (ids && CELLS.has(node.type ?? '') && i === 0 && inherited.row) pass.row = inherited.row;
      return prepare(child as Json, node, show, tables, ids, pass, cell || CELLS.has(node.type ?? ''));
    }),
  };
}

/**
 * Re-pads the table rows that carried a row sentinel (and the delimiter row among them) to their cells' widths: the
 * serializer measured the sentinels in.
 */
function realign(lines: string[], rows: Set<number>): void {
  const DELIMITER = /^\|?(\s*:?-+:?\s*\|)+\s*:?-*:?\s*$/;
  const split = (line: string) => {
    const comment = /[ \t]*(<!-- \^[0-9a-z]+ -->)$/.exec(line);
    const body = comment ? line.slice(0, comment.index) : line;
    return { cells: body.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim()), comment: comment?.[1] ?? null };
  };
  const dashes = (cell: string, width: number) => {
    const left = cell.startsWith(':') ? ':' : '';
    const right = cell.length > 1 && cell.endsWith(':') ? ':' : '';
    return left + '-'.repeat(Math.max(3, width - left.length - right.length)) + right;
  };
  for (let start = 0; start < lines.length; start++) {
    if (!rows.has(start)) continue;
    let end = start;
    while (end + 1 < lines.length && (rows.has(end + 1) || (end === start && DELIMITER.test(lines[end + 1])))) end++;
    const table = lines.slice(start, end + 1).map((line, i) => ({ ...split(line), delimiter: !rows.has(start + i) }));
    const widths: number[] = [];
    for (const row of table) if (!row.delimiter) row.cells.forEach((cell, c) => (widths[c] = Math.max(widths[c] ?? 3, cell.length)));
    table.forEach((row, i) => {
      const cells = row.cells.map((cell, c) => (row.delimiter ? dashes(cell, widths[c] ?? 3) : cell.padEnd(widths[c] ?? 0)));
      lines[start + i] = `| ${cells.join(' | ')} |${row.comment ? ` ${row.comment}` : ''}`;
    });
    start = end;
  }
}

function restore(markdown: string, tables: Tables): string {
  const rows = new Set<number>();
  const lines = markdown.split('\n').map((line, at) => {
    let row: string | null = null;
    let out = line.replaceAll(ESC, '\\').replace(SENTINEL, (match, index: string) => {
      const n = Number(index);
      switch (match[0]) {
        case LINE:
          return ` ^${tables.ids[n]}`;
        case ROW:
          row = tables.ids[n];
          return '';
        case OPEN:
          return `<c:${tables.threads[n]}>`;
        default:
          return `</c:${tables.threads[n]}>`;
      }
    });
    if (row != null) {
      rows.add(at);
      out = `${out.replace(/[ \t]+$/, '')} <!-- ^${row} -->`;
    }
    return out;
  });
  realign(lines, rows);
  return lines.join('\n');
}

// ── parse: the dialect into sentinels, then the parsed content's sentinels into ids ──
function toSentinels(markdown: string, ids: string[]): string {
  const out: string[] = [];
  let fence: RegExp | null = null;
  const id = (value: string) => ids.push(value) - 1;
  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (fence) {
      if (fence.test(raw)) fence = null;
      out.push(raw);
      continue;
    }
    const opening = /^\s*(`{3,}|~{3,})/.exec(raw);
    if (opening) {
      fence = new RegExp(`^\\s*${opening[1][0] === '`' ? '`' : '~'}{${opening[1].length},}\\s*$`);
      out.push(raw);
      continue;
    }
    if (/^:::(diagram|chart)\b/.test(raw)) {
      fence = /^:::\s*$/;
      out.push(raw);
      continue;
    }
    if (/^\$\$[ \t]*$/.test(raw)) {
      fence = /^\$\$[ \t]*$/;
      out.push(raw);
      continue;
    }
    const line = raw.replace(MILESTONE, '');
    let match = MARKER_LINE.exec(line);
    if (match) {
      out.push('', sentinel(BLOCK, id(match[1])), '');
      continue;
    }
    match = MARKER_ROW.exec(line);
    if (match) {
      const cells = match[1];
      const close = cells.lastIndexOf('|');
      out.push(close > 0 ? `${cells.slice(0, close).replace(/[ \t]+$/, '')}${sentinel(ROW, id(match[2]))} ${cells.slice(close)}` : `${cells}${sentinel(ROW, id(match[2]))}`);
      continue;
    }
    match = MARKER_EOL.exec(line);
    out.push(match ? `${match[1]}${sentinel(LINE, id(match[2]))}` : line);
  }
  return out.join('\n');
}

/** Moves the sentinels' ids onto their blocks and drops the marker paragraphs and the sentinel text. */
function assignIds(node: Json, ids: string[], ancestors: Json[]): Json {
  let content = node.content;
  if (content) {
    const kept: Json[] = [];
    for (const child of content as Json[]) {
      const only = child.type === 'paragraph' && child.content?.length === 1 ? child.content[0].text : undefined;
      const blockMarker = only ? new RegExp(`^${BLOCK}(\\d+)${END}$`).exec(only) : null;
      if (blockMarker) {
        const previous = kept[kept.length - 1];
        if (previous) previous.attrs = { ...previous.attrs, id: ids[Number(blockMarker[1])] };
        continue;
      }
      kept.push(child.type === 'text' ? child : assignIds(child, ids, [...ancestors, node]));
    }
    content = kept;
  }
  let result: Json = content ? { ...node, content } : { ...node };
  if (TEXTBLOCKS.has(node.type ?? '') && content) {
    const texts: Json[] = [];
    let marked = false;
    for (const child of content) {
      if (child.type !== 'text' || !child.text) {
        texts.push(child);
        continue;
      }
      const text = child.text.replace(SENTINEL, (match, index: string) => {
        marked = true;
        const value = ids[Number(index)];
        if (match[0] === LINE) {
          const parent = ancestors[ancestors.length - 1];
          if (parent && ITEMS.has(parent.type ?? '') && parent.content?.[0] === node) parent.attrs = { ...parent.attrs, id: value };
          else result.attrs = { ...result.attrs, id: value };
        } else if (match[0] === ROW) {
          const row = [...ancestors].reverse().find((ancestor) => ancestor.type === 'tableRow');
          if (row) row.attrs = { ...row.attrs, id: value };
        }
        return '';
      });
      if (text) texts.push({ ...child, text });
    }
    // a sentinel's own space went with it; an empty block was written as a no-break space
    const lastText = texts[texts.length - 1];
    if (marked && lastText?.type === 'text' && lastText.text) {
      texts[texts.length - 1] = { ...lastText, text: lastText.text.replace(/[ \t]+$/, '') };
      if (!texts[texts.length - 1].text) texts.pop();
    }
    const plain = texts.every((child) => child.type === 'text' && /^\u00A0*$/.test(child.text ?? ''));
    result = { ...result, content: plain ? [] : texts };
  }
  return result;
}

const ID_TYPES = new Set<string>(BLOCK_TYPES);
function mintIds(node: Json, generateID: () => string): Json {
  const content = node.content?.map((child) => mintIds(child as Json, generateID));
  const attrs = ID_TYPES.has(node.type ?? '') && !node.attrs?.id ? { ...node.attrs, id: generateID() } : node.attrs;
  return { ...node, ...(attrs ? { attrs } : {}), ...(content ? { content } : {}) };
}

/** The agent's markdown over the schema module: parse with ids kept or minted, serialize with ids and milestones. */
export class DocMarkdown {
  private readonly md = new MarkdownManager({ marked: new Marked() as unknown as typeof import('marked').marked, extensions: markdownExtensions() });

  /** A doc (a tab body) or one block as the dialect; blocks are separated by a blank line. */
  serialize(node: PMNode, { ids = true, milestones = null }: SerializeOptions = {}): string {
    const blocks: PMNode[] = [];
    if (node.type.name === 'doc') node.forEach((block) => blocks.push(block));
    else blocks.push(node);
    return blocks.map((block) => this.block(block, { ids, milestones })).join('\n\n');
  }

  /** One top-level block as the dialect, its `^id` included when `ids` is on. */
  block(block: PMNode, { ids = true, milestones = null }: SerializeOptions = {}): string {
    const tables: Tables = { ids: [], threads: [] };
    const doc: Json = { type: 'doc', content: [] };
    const prepared = prepare(block.toJSON() as Json, doc, milestones ?? new Set(), tables, ids, {});
    const text = restore(this.md.serialize({ type: 'doc', content: [prepared] }).replace(/^\n+|\n+$/g, ''), tables);
    const id = block.attrs.id as string | null | undefined;
    return ids && id && !TEXTBLOCKS.has(block.type.name) ? `${text}\n^${id}` : text;
  }

  /** Markdown into top-level blocks of the schema: a `^id` it names is kept, every other block gets a fresh id. */
  parse(markdown: string, { generateID = nanoid8 }: ParseOptions = {}): PMNode[] {
    const ids: string[] = [];
    const parsed = this.md.parse(toSentinels(markdown, ids)) as Json;
    const doc = mintIds(assignIds(parsed, ids, []), generateID);
    if (!doc.content?.length) return [];
    const node = schemaFor().nodeFromJSON(doc);
    node.check();
    const blocks: PMNode[] = [];
    node.forEach((block) => blocks.push(block));
    return blocks;
  }
}

let shared: DocMarkdown | null = null;
/** The process's one `DocMarkdown` (the markdown manager registers its tokenizers once, on its own `marked`). */
export const docMarkdown = (): DocMarkdown => (shared ??= new DocMarkdown());
