// The Notion export: a document's tabs as Notion's enhanced Markdown, the `pages[].content` of the hosted Notion MCP
// server's `notion-create-pages` (its `notion://docs/enhanced-markdown-spec`), so a document sent to Notion arrives as a
// page of Notion's own blocks, not an attached file. One block per line, blank lines meaning nothing (an empty paragraph
// is `<empty-block/>`); a block's children on the lines after it, one tab deeper; rich text escaped by Notion's set of
// markup characters, and a line's leading list or heading marker too, never inside code. Notion's forms where it has
// one: a quote is one `>` line (its paragraphs joined by `<br>`, the rest its children), a table its XML form with
// rich-text cells on a rectangular grid (spans written as empty cells), a callout its XML block with an icon and colour
// per tone, a highlight a yellow background, inline math the spec's backticked form. What Notion cannot hold degrades to
// what a reader sees: a comment's or an attribution's mark to its text, a chip to its text, an image Notion cannot fetch
// (a store asset, a data: URL) to `[Image: …]`, a chart without a drawn view to `[Chart: …]`, an unknown node to its
// content. Several tabs are written in order, each introduced by its title as a heading 1; the page title is not
// written (Notion takes it as a property).
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import { TableMap } from '@tiptap/pm/tables';
import { backtickFence } from '../markdown-syntax';
import { CALLOUT_TONES, type CalloutTone } from '../schema';
import { tabsOf, type ExportSource, type ViewRenderer } from './source';
import { chipText } from './values';

export function exportNotionMarkdown(source: ExportSource, { tab, renderView }: { tab?: string; renderView?: ViewRenderer } = {}): string {
  const tabs = tabsOf(source, tab);
  const lines = tabs.flatMap(({ title, body }) => {
    // an empty last paragraph is the editor's trailing node, not the author's
    let end = body.childCount;
    while (end > 0 && blank(body.child(end - 1))) end--;
    const content = children(body, { renderView }, 0, end);
    return tabs.length === 1 ? content : [`# ${text(title || 'Untitled')}`, ...content];
  });
  return `${lines.join('\n')}\n`;
}

interface Context {
  renderView?: ViewRenderer;
}

const blank = (node: PMNode): boolean => node.type.name === 'paragraph' && node.textContent.trim() === '' && every(node, (child) => child.isText);
const every = (node: PMNode, test: (child: PMNode) => boolean): boolean => {
  let all = true;
  node.forEach((child) => (all &&= test(child)));
  return all;
};
const indent = (lines: string[]): string[] => lines.map((line) => (line ? `\t${line}` : line));
const linesOf = (value: string): string[] => value.replace(/\r\n?/g, '\n').split('\n');

function children(node: PMNode, context: Context, from = 0, to = node.childCount): string[] {
  const out: string[] = [];
  for (let i = from; i < to; i++) out.push(...block(node.child(i), context));
  return out;
}

// ── escaping ──
const ESCAPED = /[\\*~`$[\]<>{}|^]/g;
/** Text as Notion's rich text: its markup characters escaped, a line ending a `<br>` (a newline would end the block). */
const text = (value: string): string => value.replace(/\r\n?/g, '\n').replace(ESCAPED, '\\$&').replace(/\n/g, '<br>');
/** A block's text at the start of its line: a heading's, a list item's or a divider's marker is escaped too. */
const lineStart = (line: string): string =>
  line
    .replace(/^(#{1,6})(?=\s|$)/, '\\$1')
    .replace(/^([-+])(?=\s|$)/, '\\$1')
    .replace(/^-(?=(?:[ \t]*-){2,}[ \t]*$)/, '\\-')
    .replace(/^(\d{1,9})([.)])(?=\s|$)/, '$1\\$2');
const codeSpan = (code: string): string => {
  const value = code.replace(/\r\n?/g, '\n').replace(/\n/g, '<br>'); // Notion's multi-line inline code
  if (!value.includes('`')) return `\`${value}\``;
  const ticks = '`'.repeat(Math.max(...[...value.matchAll(/`+/g)].map((run) => run[0].length)) + 1);
  return `${ticks} ${value} ${ticks}`;
};
const inlineMath = (latex: unknown): string => {
  const value = String(latex ?? '').replace(/\s*\n\s*/g, ' ').trim();
  return value ? `$\`${value}\`$` : '';
};
// Notion links only absolute addresses; the characters that would end `(…)` early are percent-encoded
const address = (href: unknown, schemes: RegExp): string | null => {
  const value = typeof href === 'string' ? href.trim() : '';
  return schemes.test(value) ? value.replace(/[\s()<>]/g, (char) => (char === '(' ? '%28' : char === ')' ? '%29' : encodeURIComponent(char))) : null;
};
const LINKABLE = /^(?:https?:\/\/|mailto:)/i;
const FETCHABLE = /^https?:\/\//i;

// ── rich text ──
/** A mark Notion can write: its delimiters, and a key that tells two of one type apart (two links). */
interface Wrap {
  key: string;
  open: string;
  close: string;
}
const ORDER = ['link', 'highlight', 'underline', 'bold', 'italic', 'strike']; // outermost first
function wrapOf(mark: Mark): Wrap | null {
  switch (mark.type.name) {
    case 'bold':
      return { key: 'bold', open: '**', close: '**' };
    case 'italic':
      return { key: 'italic', open: '*', close: '*' };
    case 'strike':
      return { key: 'strike', open: '~~', close: '~~' };
    case 'underline':
      return { key: 'underline', open: '<span underline="true">', close: '</span>' };
    case 'highlight':
      return { key: 'highlight', open: '<span color="yellow_bg">', close: '</span>' };
    case 'link': {
      const url = address(mark.attrs.href, LINKABLE);
      return url ? { key: `link ${url}`, open: '[', close: `](${url})` } : null;
    }
    default:
      return null; // comments, the attribution marks; code is written as a span of its own
  }
}
const wrapsOf = (marks: readonly Mark[]): Wrap[] =>
  marks
    .map(wrapOf)
    .filter((wrap): wrap is Wrap => wrap !== null)
    .sort((a, b) => ORDER.indexOf(a.key.split(' ')[0]) - ORDER.indexOf(b.key.split(' ')[0]));
const sameWraps = (a: Wrap[], b: Wrap[]): boolean => a.length === b.length && a.every((wrap, i) => wrap.key === b[i].key);
const isCode = (node: PMNode): boolean => node.marks.some((mark) => mark.type.name === 'code');

/** What a textblock's content becomes: text (one run per mark set), already-written inline pieces, or an image block. */
type Run = { text: string; code: boolean; wraps: Wrap[] } | { raw: string; wraps: Wrap[]; soft?: boolean } | { image: string };
/** A textblock's line: rich text, or (where blocks may follow, `split`) an image Notion fetches, on a line of its own. */
interface Segment {
  line: string;
  text: boolean;
}

function runsOf(node: PMNode, split: boolean): Run[] {
  const runs: Run[] = [];
  node.forEach((child) => {
    const wraps = wrapsOf(child.marks);
    const last = runs[runs.length - 1];
    if (child.isText) {
      const code = isCode(child);
      if (last && 'text' in last && last.code === code && sameWraps(last.wraps, wraps)) last.text += child.text ?? '';
      else runs.push({ text: child.text ?? '', code, wraps });
      return;
    }
    switch (child.type.name) {
      case 'hardBreak':
        runs.push({ raw: '<br>', wraps, soft: true });
        return;
      case 'image': {
        const alt = typeof child.attrs.alt === 'string' ? child.attrs.alt.trim() : '';
        const url = address(child.attrs.src, FETCHABLE);
        if (url && split) runs.push({ image: `![${text(alt)}](${url})` });
        else if (url && !wraps.some((wrap) => wrap.key.startsWith('link '))) runs.push({ raw: `[${text(alt || 'Image')}](${url})`, wraps });
        else runs.push({ raw: text(`[Image: ${alt || 'image'}]`), wraps });
        return;
      }
      case 'math':
        runs.push({ raw: inlineMath(child.attrs.latex), wraps });
        return;
      default:
        runs.push({ raw: text(chipText(child)), wraps }); // a date, a mention, a dropdown: what the chip shows
    }
  });
  return runs;
}

/**
 * A textblock's content as Notion's rich text. Marks open and close as a stack, a mark going on across runs kept open;
 * a run's edge whitespace is written outside the marks that open or close at it (`**bold** `, never `**bold **`), and a
 * break or a run of whitespace never opens one. `start` escapes each line's leading marker.
 */
function inline(node: PMNode, { split, start }: { split: boolean; start: boolean }): Segment[] {
  const runs = runsOf(node, split);
  const segments: Segment[] = [];
  const stack: Wrap[] = [];
  let out = '';
  const close = (keep: number) => {
    while (stack.length > keep) out += stack.pop()!.close;
  };
  // the open marks a run keeps: the longest bottom of the stack it still has
  const kept = (wraps: Wrap[]) => {
    let keep = 0;
    while (keep < stack.length && wraps.some((wrap) => wrap.key === stack[keep].key)) keep++;
    return keep;
  };
  const flush = () => {
    close(0);
    const line = out.replace(/^[ \t]+|[ \t]+$/g, ''); // a line's leading tab would read as indentation
    if (line) segments.push({ line: start ? lineStart(line) : line, text: true });
    out = '';
  };
  runs.forEach((run, i) => {
    if ('image' in run) {
      flush();
      segments.push({ line: run.image, text: false });
      return;
    }
    const next = runs[i + 1];
    const after = next && !('image' in next) ? next.wraps : [];
    const body = 'raw' in run ? run.raw : run.code ? codeSpan(run.text) : text(run.text);
    const [, lead, core, trail] = 'text' in run && !run.code ? /^(\s*)([\s\S]*?)(\s*)$/.exec(body)! : ['', '', body, ''];
    if (core === '' || ('soft' in run && run.soft)) {
      close(kept(run.wraps.filter((wrap) => after.some((other) => other.key === wrap.key))));
      out += body;
      return;
    }
    close(kept(run.wraps));
    const opening = run.wraps.filter((wrap) => !stack.some((open) => open.key === wrap.key));
    out += lead;
    for (const wrap of opening) {
      out += wrap.open;
      stack.push(wrap);
    }
    out += core;
    if (trail) close(kept(after));
    out += trail;
  });
  flush();
  return segments;
}
/** A textblock's content as one line of rich text: images inline (a link or the placeholder), no marker escaped. */
const rich = (node: PMNode): string =>
  inline(node, { split: false, start: false })
    .map(({ line }) => line)
    .join('');

// ── blocks ──
const CALLOUTS: Record<CalloutTone, { icon: string; color: string }> = {
  note: { icon: 'ℹ️', color: 'gray_bg' },
  tip: { icon: '💡', color: 'green_bg' },
  warn: { icon: '⚠️', color: 'yellow_bg' },
  danger: { icon: '🛑', color: 'red_bg' },
};

function block(node: PMNode, context: Context): string[] {
  const a = node.attrs;
  switch (node.type.name) {
    case 'paragraph':
      return paragraph(node);
    case 'heading':
      return [`${'#'.repeat(Math.min(4, Math.max(1, Math.trunc(Number(a.level)) || 1)))} ${rich(node)}`]; // Notion has four levels
    case 'blockquote':
      return quote(node, context);
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const out: string[] = [];
      node.forEach((child, _offset, i) => out.push(...(['listItem', 'taskItem'].includes(child.type.name) ? item(child, marker(node, child, i), context) : block(child, context))));
      return out;
    }
    case 'listItem':
    case 'taskItem':
      return item(node, marker(node, node, 0), context);
    case 'codeBlock':
      return fenced(typeof a.language === 'string' ? a.language : '', node.textContent);
    case 'diagram':
      return fenced('mermaid', String(a.source ?? ''));
    case 'mathBlock': {
      // nothing in it is escaped, so a `$$` line of its own would close it: LaTeX reads a line ending as a space
      const latex = String(a.latex ?? '');
      const lines = linesOf(latex);
      return ['$$', ...(!latex ? [] : lines.some((line) => /^\s*\$\$\s*$/.test(line)) ? [lines.join(' ')] : lines), '$$'];
    }
    case 'horizontalRule':
      return ['---'];
    case 'table':
      return table(node);
    case 'callout': {
      const { icon, color } = CALLOUTS[(CALLOUT_TONES as readonly unknown[]).includes(a.tone) ? (a.tone as CalloutTone) : 'note'];
      return [`<callout icon="${icon}" color="${color}">`, ...indent(children(node, context)), '</callout>'];
    }
    case 'chart': {
      const view = context.renderView?.(node);
      return view ? linesOf(view.markdown) : [lineStart(chartPlaceholder(node))];
    }
    case 'pending':
      return [lineStart(pendingPlaceholder(node))];
    default:
      if (node.isTextblock) return paragraph(node);
      if (node.firstChild?.isBlock) return children(node, context);
      return node.textContent.trim() ? [lineStart(text(node.textContent.trim()))] : [];
  }
}

function paragraph(node: PMNode): string[] {
  const lines = inline(node, { split: true, start: true }).map(({ line }) => line);
  return lines.some((line) => line.trim() !== '') ? lines : ['<empty-block/>'];
}

/** An item's marker: a bullet, its number (the list's start counted on), or its box. */
function marker(list: PMNode, item: PMNode, index: number): string {
  if (item.type.name === 'taskItem') return item.attrs.checked ? '- [x] ' : '- [ ] ';
  if (list.type.name !== 'orderedList') return '- ';
  const start = Number(list.attrs.start);
  return `${(Number.isInteger(start) ? start : 1) + index}. `;
}

/** A list item: its first paragraph's text on the marker's line, everything after it one tab deeper. */
function item(node: PMNode, mark: string, context: Context): string[] {
  const first = node.firstChild;
  if (first && first.type.name === 'paragraph') {
    const segments = inline(first, { split: true, start: true });
    if (segments.length === 0 || segments[0].text) return [`${mark}${segments[0]?.line ?? ''}`, ...indent([...segments.slice(1).map(({ line }) => line), ...children(node, context, 1)])];
  }
  return [mark, ...indent(children(node, context))];
}

/** A quote: one `>` line (a second would be a second quote), its leading paragraphs joined by `<br>`, the rest its children. */
function quote(node: PMNode, context: Context): string[] {
  const joined: string[] = [];
  let i = 0;
  for (; i < node.childCount && node.child(i).type.name === 'paragraph'; i++) {
    const segments = inline(node.child(i), { split: true, start: i === 0 });
    if (segments.some((segment) => !segment.text)) break; // an image is a block: it and what follows are children
    joined.push(segments.map(({ line }) => line).join(''));
  }
  return [`> ${joined.join('<br>')}`, ...indent(children(node, context, i))];
}

// Notion names its code languages in full; the short names a fence usually carries, mapped (others as written)
const LANGUAGES = new Map(
  Object.entries({
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    py: 'python',
    sh: 'shell',
    zsh: 'shell',
    yml: 'yaml',
    md: 'markdown',
    rb: 'ruby',
    rs: 'rust',
    kt: 'kotlin',
    cs: 'c#',
    cpp: 'c++',
    objc: 'objective-c',
    golang: 'go',
    dockerfile: 'docker',
    text: '', // Notion's default, "plain text"
    txt: '',
    plaintext: '',
  }),
);
function fenced(language: string, code: string): string[] {
  const fence = backtickFence(code);
  const name = language.replace(/[`\s]/g, '').toLowerCase();
  return [`${fence}${LANGUAGES.get(name) ?? name}`, ...linesOf(code), fence];
}

/** A table on its grid: a slot a span covers is an empty cell (Notion cannot merge cells from Markdown). */
function table(node: PMNode): string[] {
  const map = TableMap.get(node);
  if (map.width === 0) return [];
  const header = (cell: PMNode | null) => cell !== null && cell.type.name === 'tableHeader';
  const at = (row: number, col: number) => {
    const pos = map.map[row * map.width + col];
    return pos ? node.nodeAt(pos) : null;
  };
  const firstRow = node.firstChild;
  const headerRow = firstRow !== null && firstRow.childCount > 0 && every(firstRow, header);
  let allHeaders = true;
  let firstColumn = true;
  const rows: string[] = [];
  for (let row = 0; row < map.height; row++) {
    rows.push('\t<tr>');
    for (let col = 0; col < map.width; col++) {
      const index = row * map.width + col;
      const pos = map.map[index];
      const origin = pos !== 0 && (col === 0 || map.map[index - 1] !== pos) && (row === 0 || map.map[index - map.width] !== pos);
      const cell = at(row, col);
      allHeaders &&= header(cell);
      if (col === 0) firstColumn &&= header(cell);
      rows.push(`\t\t<td>${origin && cell ? cellText(cell) : ''}</td>`);
    }
    rows.push('\t</tr>');
  }
  const headerColumn = firstColumn && !allHeaders;
  return [`<table header-row="${headerRow}"${headerColumn ? ' header-column="true"' : ''}>`, ...rows, '</table>'];
}

/** A cell holds rich text only: its blocks as lines of rich text joined by `<br>`. */
const cellText = (cell: PMNode): string => flat(cell).join('<br>');
function flat(node: PMNode): string[] {
  const a = node.attrs;
  switch (node.type.name) {
    case 'codeBlock':
      return [codeSpan(node.textContent)];
    case 'diagram':
      return [codeSpan(String(a.source ?? ''))];
    case 'mathBlock':
      return [inlineMath(a.latex)];
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const out: string[] = [];
      node.forEach((child, _offset, i) => {
        const [first = '', ...rest] = flat(child);
        const bullet = child.type.name === 'taskItem' ? (child.attrs.checked ? '☑ ' : '☐ ') : node.type.name === 'orderedList' ? marker(node, child, i) : '• ';
        out.push(`${bullet}${first}`, ...rest);
      });
      return out;
    }
    case 'horizontalRule':
      return [];
    case 'chart':
      return [chartPlaceholder(node)];
    case 'pending':
      return [pendingPlaceholder(node)];
    default: {
      if (node.isTextblock) return [rich(node)];
      if (node.firstChild?.isBlock) {
        const out: string[] = [];
        node.forEach((child) => out.push(...flat(child)));
        return out;
      }
      return node.textContent.trim() ? [text(node.textContent.trim())] : [];
    }
  }
}

/** A chart without a drawn view: its spec's title, else "chart" (the spec is the dashboard's, read as far as a title). */
function chartPlaceholder(node: PMNode): string {
  let spec: unknown = node.attrs.spec;
  if (typeof spec === 'string') {
    try {
      spec = JSON.parse(spec) as unknown;
    } catch {
      spec = null;
    }
  }
  const title = spec !== null && typeof spec === 'object' && 'title' in spec && typeof spec.title === 'string' ? spec.title.trim() : '';
  return text(`[Chart: ${title || 'chart'}]`);
}
const pendingPlaceholder = (node: PMNode): string => {
  const intent = String(node.attrs.intent ?? '').trim();
  return text(intent ? `[Pending: ${intent}]` : '[Pending]');
};
