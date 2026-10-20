// The agent's markdown (D1, D7 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; §4.4): GFM through
// `@tiptap/markdown` over the schema module's own extensions, plus this kind's dialect. The dialect is lossless
// (Decision Log 15): every state the schema stores reads back as it was, ids aside where they are not shown, so a
// `replace_block` built from a read changes only what the agent changed. Where GFM has no syntax, the dialect has one:
//
//   block ids     ` ^id` at the end of a one-line block's line (a paragraph, a heading; a list item's first line names
//                 the item); `^id` on its own line after a top-level block of several lines (a list, a quote, a table,
//                 code, a callout, the atoms); `<!-- ^id -->` after a table row's closing pipe, or on its `:::row` line
//                 (cells are positional). Inside containers the ids of nested containers are not shown (a parse mints
//                 them).
//   chips         `<chip kind="date" iso="2026-10-12"/>`, `<chip kind="mention" type="person" ref="…" label="…"/>`,
//                 `<chip kind="dropdown" value="Doing" options='["Todo","Doing","Done"]'/>`
//   math          `$$E = mc^2$$` inline, or `<math latex="…"/>` for LaTeX that form cannot hold (empty, several lines,
//                 a `$` at an end); a display block is `$$`, the LaTeX, `$$` on lines of their own (more `$` when the
//                 LaTeX has a `$$` line)
//   blocks        `:::callout {tone="warn"}` … `:::` (markdown inside), `:::diagram` … `:::` (mermaid source),
//                 `:::chart {spec="…"}` or `{spec-json='{…}'}` … `:::` (its source; a spec that is not a string as its
//                 JSON), `:::pending {intent="…"} :::`; a raw source with a colon line is fenced with more colons
//   tables        GFM when GFM says all of it (a header row then body rows, one plain paragraph per cell, no spans
//                 or widths, one alignment per column); otherwise `:::table`, `:::row <!-- ^id -->`, and
//                 `:::header {colspan="2" rowspan="1" colwidth="120,80" align="center"}` or `:::cell {…}` around each
//                 cell's markdown, each closed by `:::`
//   lists         numbered `1. ` (one space); lettered or roman `a.  `, `IV.  ` with two to four spaces (one space is
//                 text: `Dr. Smith`, Decision Log 19)
//   images        `![alt](src)` when the address and alt are plain and there is no asset; otherwise
//                 `<img src="…" alt="…" asset="…"/>` (an absent attribute is null)
//   highlight     `==text==`; with a colour `<mark color="#fde68a">text</mark>`
//   links         `[text](href "title")`, an address with spaces, parentheses or brackets in `<…>`
//   code          fenced with more backticks than any run in the code
//   whitespace    a space or tab at the edge of formatted text is written `&#32;` / `&#9;` (Markdown would move it out
//                 of the mark); an empty paragraph or heading holds one no-break space, and a text of only no-break
//                 spaces one more than it has; a line ending inside text (not a hardBreak) is `&#10;`, so what follows
//                 it never starts a line (P3-F, tracker L166). A reader's Markdown (`forReaders`, an export) writes it
//                 as Markdown's own line break instead (see `SerializeOptions.forReaders`)
//   line breaks   a hardBreak is CommonMark's backslash break, a backslash ending the line (Tiptap's two trailing
//                 spaces left a blank line between two breaks); one with no line after it in its block (a block's
//                 end, a heading) keeps Tiptap's form and does not read back as it was (P3-F, the tracker's P4 row)
//   comments      `<c:ID>` where an open thread's text starts and `</c:ID>` where it ends (each closing tag names its
//                 thread, so overlapping comments need no nesting; S5's read format), inside code too; ignored on
//                 parse. A literal `<c:x>` in code is written `<\c:x>` (one more backslash) and read back as written.
//
// `@tiptap/markdown` tracks marks by type and so cannot write overlapping comments, nor does it place ids: both go into
// the content as private-use sentinel characters before it serializes and become the dialect after; a parse turns the
// dialect into sentinels first and back into ids after (the content's own characters of that range are carried as
// pairs meanwhile, so neither side mistakes one for the other). Text that would read as markup is backslash-escaped, so
// serialize → parse returns the content. The node and mark forms live in markdown-syntax.ts. Copied and extended from
// P3-0's `s4/src/markdown.ts` and `s5/lib/read.mjs`.
import type { AnyExtension, JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { MarkdownManager } from '@tiptap/markdown';
import { Marked } from 'marked';
import { BLOCKS_TABLE, CHART_MARKDOWN /* P3-E */, MARKDOWN, gfmTable, letteredItem, rawRegion } from './markdown-syntax';
import { BLOCK_TYPES, extensions, nanoid8, schemaFor } from './schema';

export interface SerializeOptions {
  /** Write block ids (`^id`, `<!-- ^id -->`); off for an export. Default on. */
  ids?: boolean;
  /** The threads whose comments are written as `<c:ID>…</c:ID>` milestones; comment marks are dropped otherwise. */
  milestones?: ReadonlySet<string> | null;
  /** P3-E (E2 M5; E's Decision Log 32): a chart block's drawn view as Markdown, by block id, written in its place
   * (nested where the block is) instead of the dialect's `:::chart`; an export's only, absent for the lossless dialect. */
  charts?: ReadonlyMap<string, string>;
  /**
   * P3-F (tracker L166; the parent's ruling of 2026-10-18): Markdown for people to read (an export; ids and milestones
   * off): a line ending inside text, and a hardBreak, is rendered as a line break, never as the canonical `&#10;`:
   * CommonMark's hard line break (a backslash ending the line, the next line's start escaped) where the text goes on,
   * and an inline `<br>` where Markdown cannot break a line (in a heading, in a table cell, and at a block's end, where
   * a backslash would read literally). Code keeps its line ends either way. Judged by how a reader renders it, not by an
   * exact read-back: the dialect reads a backslash break back as a hardBreak and `<br>` as literal text.
   */
  forReaders?: boolean;
}

// P3-E start: the charts' Markdown carried in the temporary serialisation JSON (never the doc), for the chart's form
function withCharts(node: Json, charts: ReadonlyMap<string, string> | undefined): Json {
  if (!charts?.size) return node;
  const id = node.attrs?.id;
  if (node.type === 'chart' && typeof id === 'string' && charts.has(id)) return { ...node, attrs: { ...node.attrs, [CHART_MARKDOWN]: charts.get(id) } };
  return node.content ? { ...node, content: (node.content as Json[]).map((child) => withCharts(child, charts)) } : node;
}
// P3-E end

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
const SPACED_SENTINEL = /[ \t]?([\uE000-\uE004])(\d+)\uE00F/g;
// single characters the serializer passes through and restore() rewrites
const ESC = '\uE005'; // a backslash escape the dialect adds
const EDGE_SPACE = '\uE006'; // a space at a mark's edge: `&#32;`
const EDGE_TAB = '\uE007'; // a tab at a mark's edge: `&#9;`
const BREAK = '\uE008'; // nothing: splits two runs of one mark type whose attributes differ
const CODE_OPEN = '\uE009'; // around inline code a single-backtick span cannot hold
const CODE_CLOSE = '\uE00A';
const SPACE_HOLDER = '\uE00B'; // a no-break space the text holds or the placeholder of an empty block: `&#160;`
const SEPARATOR = '\uE00C'; // `<!---->`: lets `*` and `**` close before, or open after, a letter (read as nothing)
const NEWLINE = '\uE00E'; // a line ending inside text: `&#10;`, or a reader's `<br>` (P3-F, tracker L166)
// The content's own characters of this alphabet: each is written as LITERAL and a letter (`a` for U+E000 … `p` for
// U+E00F) before the sentinels go in and restored after they are gone, so a generated sentinel and a literal character
// are never confused (the whole-branch review's P6); a parse does the same around its own sentinels.
const LITERAL = '\uE00D';
const ALPHABET = /[\uE000-\uE00F]/g;
const LITERAL_PAIR = /\uE00D([a-p])/g;
const IN_ALPHABET = /[\uE000-\uE00F]/;
const toLiteral = (text: string): string => (IN_ALPHABET.test(text) ? text.replace(ALPHABET, (char) => `${LITERAL}${String.fromCharCode(97 + char.charCodeAt(0) - 0xe000)}`) : text);
const fromLiteral = (text: string): string => (text.includes(LITERAL) ? text.replace(LITERAL_PAIR, (_, letter: string) => String.fromCharCode(0xe000 + letter.charCodeAt(0) - 97)) : text);
/**
 * Every string a node's JSON holds (its texts, attribute values, and property names inside an opaque value), mapped, in
 * a copy whose every object and array is a new one, changed or not: what reads a block's JSON compares attribute values
 * by identity (Tiptap's `attrsEqual`, where the Markdown serializer opens and closes marks), and ProseMirror hands every
 * run of one mark the same attrs object, so a shared array value such as `userIds` would compare equal where a copy does
 * not, and the Markdown would change.
 * P4-R5: one traversal, each object built by a key loop rather than from an entries array; an own `__proto__` is defined,
 * as Object.fromEntries defines it, where assigning it would set the prototype (the one inherited setter a fresh object
 * has); two keys the map sends to one keep the first's place and the last's value, as there.
 */
export const mapStrings = <T>(value: T, map: (text: string) => string): T => {
  if (typeof value === 'string') return map(value) as T;
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, map)) as T; // a hole stays a hole
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    const name = map(key);
    const item = mapStrings(record[key], map);
    if (name === '__proto__') Object.defineProperty(out, name, { value: item, writable: true, enumerable: true, configurable: true });
    else out[name] = item;
  }
  return out as T;
};

const ID = '[0-9a-z]{2,32}';
const MARKER_LINE = new RegExp(`^[ \\t]*\\^(${ID})[ \\t]*$`);
// the one space or tab before a line's `^id` is the marker's; any more is the text's (a trailing space reads back)
const MARKER_EOL = new RegExp(`^(.*?)[ \\t]\\^(${ID})[ \\t]*$`);
const MARKER_ROW = new RegExp(`^(.*?)[ \\t]*<!--[ \\t]*\\^(${ID})[ \\t]*-->[ \\t]*$`);
/** A comment milestone, as the agent reads it. */
export const MILESTONE = /<\/?c:[A-Za-z0-9_-]+>/g;
export const stripMilestones = (text: string): string => text.replace(MILESTONE, '');
// A literal milestone in code gains a backslash after its `<` (and a written one loses it), so it never reads as one.
const escapeLiteralMilestones = (text: string): string => text.replace(/<(\\*)(\/?c:[A-Za-z0-9_-]+>)/g, '<\\$1$2');
const unescapeLiteralMilestones = (text: string): string => text.replace(/<\\(\\*)(\/?c:[A-Za-z0-9_-]+>)/g, '<$1$2');

const markdownExtensions = (): AnyExtension[] =>
  extensions().map((ext) => (MARKDOWN[ext.name] ? (ext as unknown as { extend(config: object): AnyExtension }).extend(MARKDOWN[ext.name]) : ext));

// ── escaping text that would read as markup ──
const TEXTBLOCKS = new Set(['paragraph', 'heading']);
const CONTAINERS_WITH_OWN_LINES = new Set(['doc', 'blockquote', 'callout']);
const ITEMS = new Set(['listItem', 'taskItem']);
const CELLS = new Set(['tableCell', 'tableHeader']);

const LETTERED_MARKER = /^(\s*[a-zA-Z]+)([.)])(?= {2})/;
const MARKER_AT_END = new RegExp(`([ \\t])\\^(${ID})$`);
// `@tiptap/markdown` already backslash-escapes \\ ` * _ [ ] ~ in text and writes & < > as entities; what the dialect adds
// is escaped here, through a placeholder its escaper leaves alone and `restore` turns into the backslash.
export function escapeText(text: string, { lineStart, lineEnd, inCell }: { lineStart: boolean; lineEnd: boolean; inCell: boolean }): string {
  let out = text.replace(/==/g, `${ESC}=${ESC}=`).replace(/\+\+/g, `${ESC}+${ESC}+`).replace(/\$\$/g, `${ESC}$${ESC}$`);
  if (inCell) out = out.replace(/\|/g, `${ESC}|`);
  if (lineStart) {
    out = out
      // a heading, an item (an empty one too: `-` or `+` alone), a line of dashes (a thematic break; `*` and `_` are
      // escaped already), a line of only `-` or of a lone `=` (a heading's underline after a hardBreak; `==` is escaped
      // already), a block, a marker
      .replace(/^(\s*)(#{1,6}(?=\s|$)|[-+](?=\s|$)|-(?=(?:[ \t]*-){2,}[ \t]*$|-+[ \t]*$)|=(?=[ \t]*$)|:::|\^)/, `$1${ESC}$2`)
      .replace(/^(\s*\d+)([.)])(?=\s|$)/, `$1${ESC}$2`)
      // a letter or roman marker with two spaces after it would read as an item (Decision Log 19)
      .replace(LETTERED_MARKER, `$1${ESC}$2`);
  }
  if (lineEnd) out = out.replace(MARKER_AT_END, `$1${ESC}^$2`);
  return out;
}
const restMarks = (node: Json | undefined): Mark[] => (node?.marks ?? []).filter((mark) => mark.type !== 'comment');
/**
 * Each text run's text escaped (P4, tracker L226). The runs the serializer writes side by side, with no mark delimiter
 * between them (one set of marks; a comment's edge splits them, its milestone or nothing), are escaped as one text, so
 * markup a comment's edge splits (`1` and `. x`, `x ` and `^ab`) is escaped as a whole; each escape stays in the run of
 * the character it precedes, inside or outside the comment. Inline code is not escaped (undefined). A reader's line
 * ending is kept, escaped where its next line starts; the canonical one is NEWLINE. P4-R5: the escaped text is sliced back
 * into the runs (built a code unit at a time, it was the host's row-5 step); markdown-runs.test.ts keeps that version as
 * the oracle, hence the exports.
 */
export function escapeRuns(content: Json[], tables: Pick<Tables, 'forReaders'>, { cell, lines }: { cell: boolean; lines: boolean }): (string | undefined)[] {
  const plain = (node: Json | undefined) => node?.type === 'text' && !(node.marks ?? []).some((mark) => mark.type === 'code');
  const together = (a: Json, b: Json) => {
    const [x, y] = [restMarks(a), restMarks(b)];
    return x.length === y.length && x.every((mark) => y.some((other) => sameMark(mark, other)));
  };
  const escaped: (string | undefined)[] = [];
  for (let start = 0, end = 1; start < content.length; start = end, end = start + 1) {
    if (!plain(content[start])) continue;
    while (end < content.length && plain(content[end]) && together(content[start], content[end])) end++;
    const runs = content.slice(start, end).map((node) => (lines ? (node.text ?? '') : (node.text ?? '').replace(/\n/g, NEWLINE)));
    const before = content[start - 1];
    const lineStart = start === 0 || before?.type === 'hardBreak' || (tables.forReaders && before?.type === 'text' && (before.text ?? '').endsWith('\n'));
    const lineEnd = end === content.length;
    const joined = runs.join('');
    const text =
      lines && joined.includes('\n')
        ? joined.split('\n').map((line, k, all) => escapeText(line, { lineStart: lineStart || k > 0, lineEnd: lineEnd || k < all.length - 1, inCell: cell })).join('\n')
        : escapeText(joined, { lineStart, lineEnd, inCell: cell });
    // back into the runs: a character goes to its run, an escape to the run of the character after it. A run's own
    // characters end at the running total of the runs' lengths, shifted by the escapes before them (code units: a run
    // may end inside a surrogate pair)
    let from = 0;
    let shift = 0;
    let esc = text.indexOf(ESC);
    for (let k = 0, total = 0; k < runs.length - 1; k++) {
      total += runs[k].length;
      for (; esc !== -1 && esc - shift < total; esc = text.indexOf(ESC, esc + 1)) shift++;
      escaped[start + k] = text.slice(from, (from = total + shift));
    }
    escaped[end - 1] = text.slice(from);
  }
  return escaped;
}
/**
 * CommonMark's hard line break, a backslash ending the line (P3-F, tracker L166): a hardBreak's form (Tiptap's two
 * trailing spaces leave a blank line between two breaks), and a reader's line ending. Unmarked, so marks close around it.
 */
const LINE_BREAK = `${ESC}\n`;
const edges = (text: string): string =>
  text.replace(/^[ \t]+|[ \t]+$/g, (run) => run.replace(/ /g, EDGE_SPACE).replace(/\t/g, EDGE_TAB));

interface Tables {
  ids: string[];
  threads: string[];
  /** The call's `forReaders` (P3-F, tracker L166). */
  forReaders: boolean;
}

type Json = JSONContent & { attrs?: Record<string, unknown> };
type Mark = NonNullable<Json['marks']>[number];
const sameMark = (a: Mark, b: Mark): boolean => a.type === b.type && JSON.stringify(a.attrs ?? {}) === JSON.stringify(b.attrs ?? {});

// ── serialization: the content prepared with sentinels, serialized, the sentinels turned into the dialect ──
function prepareInline(content: Json[], parent: Json, show: ReadonlySet<string>, tables: Tables, cell: boolean): Json[] {
  const code = parent.type === 'codeBlock';
  const out: Json[] = [];
  let active: string[] = [];
  // a reader's line ending breaks its line, but in a heading or a table cell, which cannot (they keep `<br>`)
  const lines = tables.forReaders && parent.type !== 'heading' && !cell;
  const escaped = code ? [] : escapeRuns(content, tables, { cell, lines });
  const pushSentinel = (kind: string, id: string, marks: Json['marks']) => {
    tables.threads.push(id);
    out.push({ type: 'text', text: sentinel(kind, tables.threads.length - 1), ...(marks && marks.length ? { marks } : {}) });
  };
  content.forEach((node, i) => {
    const ids = (node.marks ?? []).filter((mark) => mark.type === 'comment' && show.has(String(mark.attrs?.threadId))).map((mark) => String(mark.attrs?.threadId));
    const now = node.type === 'text' ? ids : [];
    for (const id of active.filter((open) => !now.includes(open)).reverse()) pushSentinel(CLOSE, id, restMarks(content[i - 1]));
    // two runs of one mark type with different attributes (two colours, two links) would merge: split them
    const prev = restMarks(content[i - 1]);
    const marks = restMarks(node);
    if (marks.some((mark) => prev.some((before) => before.type === mark.type && !sameMark(before, mark)))) {
      const kept = marks.filter((mark) => prev.some((before) => sameMark(before, mark)));
      out.push({ type: 'text', text: BREAK, ...(kept.length ? { marks: kept } : {}) });
    }
    for (const id of now.filter((id) => !active.includes(id))) pushSentinel(OPEN, id, marks);
    active = now;
    if (node.type === 'hardBreak') {
      // a heading, a reader's table cell and a block's end have no line to break onto: a reader's Markdown writes `<br>`;
      // the canonical form keeps the hardBreak as it was written, which does not read back exactly (the tracker's P4 row)
      const trailing = content.slice(i + 1).every((next) => next.type === 'hardBreak');
      const unbreakable = parent.type === 'heading' || (tables.forReaders && cell);
      if (tables.forReaders && (trailing || unbreakable)) out.push({ type: 'text', text: NEWLINE });
      else out.push(trailing || unbreakable ? node : { type: 'text', text: LINE_BREAK });
      return;
    }
    if (node.type !== 'text') {
      out.push(node);
      return;
    }
    const raw = node.text ?? '';
    let text: string;
    if (code) text = escapeLiteralMilestones(raw);
    else if (marks.some((mark) => mark.type === 'code')) {
      // a single-backtick span cannot hold a backtick, and Markdown trims or moves its edge spaces: restore() fences it
      text = escapeLiteralMilestones(raw);
      if (/`|^\s|\s$/.test(raw)) text = `${CODE_OPEN}${text}${CODE_CLOSE}`;
    } else if (!lines || !raw.includes('\n')) {
      text = escaped[i]!;
      if (marks.length > 0) text = edges(text);
    } else {
      // a reader's line break, each line escaped where it starts (escapeRuns)
      escaped[i]!.split('\n').forEach((line, k) => {
        if (k > 0) out.push({ type: 'text', text: LINE_BREAK });
        const piece = marks.length > 0 ? edges(line) : line;
        if (piece) out.push({ ...node, text: piece, marks: marks.length ? marks : undefined });
      });
      return;
    }
    out.push({ ...node, text, marks: marks.length ? marks : undefined });
  });
  // a hard line break ending a block would read as a literal backslash: a reader's block ends its lines with `<br>`. A
  // last line of bare spaces and tabs is no line (CommonMark drops it), so the breaks before it end the block too; a
  // marked space or tab is written as an entity (edges), the line's content
  let end = out.length;
  while (tables.forReaders && end > 0 && /^[ \t]+$/.test(out[end - 1].text ?? '')) end--;
  for (let k = end - 1; tables.forReaders && k >= 0 && out[k].text === LINE_BREAK; k--) out[k] = { type: 'text', text: NEWLINE };
  for (const id of active.reverse()) pushSentinel(CLOSE, id, restMarks(content[content.length - 1]));
  return code ? out : separate(out);
}

// CommonMark lets `*` and `**` (and GFM `~~`) close only after a letter or before a non-letter, and open only before a
// letter or after a non-letter: `**end.**x` and `x**.start**` are not emphasis. A separator between the two keeps them so.
const STARS = new Set(['bold', 'italic', 'strike']);
// A letter as CommonMark's flanking rules read it: neither whitespace nor punctuation (a private-use character is one).
const isLetter = (char: string | undefined): boolean => char != null && /[^\s\p{P}\p{S}]/u.test(char);
/**
 * The first or last character of a text as written; undefined for an atom, a break or a sentinel (not letters). A
 * literal pair starts with LITERAL, which stands for its private-use character (a letter), and ends in a letter.
 */
const edgeChar = (node: Json | undefined, end: boolean): string | undefined => {
  if (node?.type !== 'text' || !node.text) return undefined;
  const char = end ? /.$/su.exec(node.text.slice(-2))![0] : String.fromCodePoint(node.text.codePointAt(0)!); // whole code points
  return char >= '\uE000' && char <= '\uE00F' && char !== LITERAL ? undefined : char;
};
function separate(nodes: Json[]): Json[] {
  const out: Json[] = [];
  const has = (node: Json, mark: Mark) => (node.marks ?? []).some((other) => sameMark(other, mark));
  nodes.forEach((node, i) => {
    const before = nodes[i - 1];
    if (before) {
      const closing = (before.marks ?? []).some((mark) => STARS.has(mark.type) && !has(node, mark));
      const opening = (node.marks ?? []).some((mark) => STARS.has(mark.type) && !has(before, mark));
      const last = isLetter(edgeChar(before, true));
      const first = isLetter(edgeChar(node, false));
      if ((closing && !last && first) || (opening && last && !first)) {
        const kept = (before.marks ?? []).filter((mark) => has(node, mark));
        out.push({ type: 'text', text: SEPARATOR, ...(kept.length ? { marks: kept } : {}) });
      }
    }
    out.push(node);
  });
  return out;
}

/** Prepares one node: escaped text, comment milestones, and (with ids) the id sentinels where the dialect shows ids. */
function prepare(node: Json, parent: Json, show: ReadonlySet<string>, tables: Tables, ids: boolean, inherited: { line?: string; row?: string }, cell = false): Json {
  const children = (node.content ?? []) as Json[];
  if (node.type === 'text') return node;
  if (TEXTBLOCKS.has(node.type ?? '')) {
    let content = prepareInline(children, node, show, tables, cell);
    // an empty textblock holds one no-break space, a text of only no-break spaces one more (assignIds undoes both)
    const spaces = children.every((child) => child.type === 'text' && !child.marks?.length && /^\u00A0+$/.test(child.text ?? ''));
    if (spaces) content = [{ type: 'text', text: SPACE_HOLDER.repeat(children.reduce((n, child) => n + (child.text ?? '').length, 0) + 1) }];
    if (ids) {
      const own = CONTAINERS_WITH_OWN_LINES.has(parent.type ?? '') ? (node.attrs?.id as string | undefined) : undefined;
      const lineId = inherited.line ?? own;
      if (lineId) {
        tables.ids.push(lineId);
        content.push({ type: 'text', text: sentinel(LINE, tables.ids.length - 1) });
      }
      if (inherited.row) {
        tables.ids.push(inherited.row);
        content.push({ type: 'text', text: sentinel(ROW, tables.ids.length - 1) });
      }
    }
    return { ...node, content };
  }
  if (node.type === 'codeBlock') return { ...node, content: prepareInline(children, node, show, tables, cell) };
  if (node.type === 'table' && !gfmTable(node, { lineEndings: tables.forReaders })) {
    // structure blocks: a row's id goes on its `:::row` line; cells hold markdown, not a pipe row
    const rows = children.map((row) => ({
      ...row,
      attrs: { ...row.attrs, id: ids ? (row.attrs?.id ?? null) : null },
      content: ((row.content ?? []) as Json[]).map((c) => prepare(c, row, show, tables, ids, {})),
    }));
    return { ...node, attrs: { ...node.attrs, [BLOCKS_TABLE]: true }, content: rows };
  }
  if (children.length === 0) return node;
  const last = children.length - 1;
  return {
    ...node,
    content: children.map((child, i) => {
      const pass: { line?: string; row?: string } = {};
      if (ids && ITEMS.has(node.type ?? '') && i === 0 && TEXTBLOCKS.has(child.type ?? '')) pass.line = node.attrs?.id as string | undefined;
      if (ids && node.type === 'tableRow' && i === last) pass.row = node.attrs?.id as string | undefined;
      if (ids && CELLS.has(node.type ?? '') && i === 0 && inherited.row) pass.row = inherited.row;
      return prepare(child, node, show, tables, ids, pass, cell || CELLS.has(node.type ?? ''));
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

const FENCED_CODE = new RegExp(`\`${CODE_OPEN}([\\s\\S]*?)${CODE_CLOSE}\``, 'g');
/** Inline code that needs a longer fence: as many backticks as its longest run plus one, padded by a space each side. */
function fenceInlineCode(markdown: string): string {
  if (!markdown.includes(CODE_OPEN)) return markdown;
  return markdown.replace(FENCED_CODE, (_, code: string) => {
    const ticks = '`'.repeat(Math.max(0, ...[...code.matchAll(/`+/g)].map((m) => m[0].length)) + 1);
    return `${ticks} ${code} ${ticks}`;
  });
}

// what the single-character placeholders become (none becomes another), with the canonical line ending or a reader's
const FORMS: Record<string, string> = { [ESC]: '\\', [EDGE_SPACE]: '&#32;', [EDGE_TAB]: '&#9;', [BREAK]: '', [SPACE_HOLDER]: '&#160;', [SEPARATOR]: '<!---->', [NEWLINE]: '&#10;' };
const READER_FORMS: Record<string, string> = { ...FORMS, [NEWLINE]: '<br>' };
const PLACEHOLDER = new RegExp(`[${Object.keys(FORMS).join('')}]`, 'g');
function restore(markdown: string, tables: Tables): string {
  const rows = new Set<number>();
  const forms = tables.forReaders ? READER_FORMS : FORMS;
  const text = fenceInlineCode(markdown).replace(PLACEHOLDER, (char) => forms[char]);
  const lines = text.split('\n').map((line, at) => {
    let row: string | null = null;
    let out = line.replace(SENTINEL, (match, index: string) => {
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
    return fromLiteral(out);
  });
  realign(lines, rows);
  return lines.join('\n');
}

// ── parse: the dialect into sentinels, then the parsed content's sentinels into ids ──

/** A container a line can sit in: a block quote, or a list item whose content starts `indent` columns in. */
type Container = { quote: true } | { indent: number };
const QUOTE = /^ {0,3}>[ ]?/;
const ITEM = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?=[ \t]|$)/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

/**
 * The part of a line that continues the `open` containers (CommonMark's block structure, as far as the serializer writes
 * it: `>` quotes and items indented by their content column; no lazy continuation). `depth` counts the containers it
 * continues; `prefix` is what it consumed, `rest` the line inside them.
 */
function continuing(line: string, open: readonly Container[]): { depth: number; prefix: string; rest: string } {
  let rest = line;
  let depth = 0;
  for (const container of open) {
    if ('quote' in container) {
      const quote = QUOTE.exec(rest);
      if (!quote) break;
      rest = rest.slice(quote[0].length);
    } else if (/\S/.test(rest)) {
      if (!rest.startsWith(' '.repeat(container.indent))) break;
      rest = rest.slice(container.indent);
    }
    depth += 1;
  }
  return { depth, prefix: line.slice(0, line.length - rest.length), rest };
}

/** The quotes and list items a line opens at its start, pushed onto `open`; returns the line inside them. */
function opening(rest: string, open: Container[]): string {
  for (;;) {
    const quote = QUOTE.exec(rest);
    if (quote) {
      open.push({ quote: true });
      rest = rest.slice(quote[0].length);
      continue;
    }
    const lettered = letteredItem(rest);
    if (lettered) {
      open.push({ indent: lettered.column });
      rest = rest.slice(lettered.column);
      continue;
    }
    const item = THEMATIC_BREAK.test(rest) ? null : ITEM.exec(rest);
    if (!item) return rest;
    const spaces = /^ */.exec(rest.slice(item[0].length))![0].length;
    // the content column: the marker and one to four spaces after it; one when the item is blank or its content is code
    const indent = item[0].length + (/^[ \t]*$/.test(rest.slice(item[0].length)) || spaces > 4 ? 1 : spaces);
    open.push({ indent });
    rest = rest.slice(Math.min(indent, rest.length));
  }
}

/**
 * The dialect's markers into sentinels, line by line. Each line is read inside the quotes and list items it continues or
 * opens, so raw content (code, display math, a diagram's source) stays literal at any depth, a marker line names the
 * block before it in its own container, and a `:::row` line inside a quote keeps its id for the row's parser.
 */
function toSentinels(markdown: string, ids: string[]): string {
  const out: string[] = [];
  const open: Container[] = [];
  /** The raw region a line opened: its closing line, the containers it sits in, and whether it is code. */
  let raw: { close: RegExp; depth: number; code: boolean } | null = null;
  const id = (value: string) => ids.push(value) - 1;
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const { depth, ...within } = continuing(line, open);
    let { prefix, rest } = within;
    if (raw && depth === raw.depth) {
      const closes = raw.close.test(rest);
      // a code block's milestones go; its literal ones come back as written
      out.push(!closes && raw.code ? `${prefix}${unescapeLiteralMilestones(stripMilestones(rest))}` : line);
      if (closes) raw = null;
      continue;
    }
    raw = null; // a container the region sat in ended, and the region with it
    open.length = depth;
    const inner = opening(rest, open);
    const opened = open.length > depth;
    prefix += rest.slice(0, rest.length - inner.length);
    rest = inner;
    const close = rawRegion(rest);
    if (close) {
      raw = { close, depth: open.length, code: /^ {0,3}(`{3,}|~{3,})/.test(rest) };
      out.push(line);
      continue;
    }
    if (/^:::/.test(rest)) {
      out.push(line); // a structure line: the `<!-- ^id -->` of a `:::row` is read by its parser
      continue;
    }
    const plain = unescapeLiteralMilestones(stripMilestones(rest));
    let match = MARKER_LINE.exec(plain);
    if (match && !opened) {
      // a block of its own, between blank lines of its container
      const blank = prefix.replace(/[ \t]+$/, '');
      out.push(blank, `${prefix}${sentinel(BLOCK, id(match[1]))}`, blank);
      continue;
    }
    if (match) {
      // `- ^id` or `> ^id`: the id of the empty first line of the item or quote the line opens
      out.push(`${prefix}${sentinel(LINE, id(match[1]))}`);
      continue;
    }
    match = MARKER_ROW.exec(plain);
    if (match) {
      const cells = match[1];
      const close = cells.lastIndexOf('|');
      out.push(`${prefix}${close > 0 ? `${cells.slice(0, close).replace(/[ \t]+$/, '')} ${sentinel(ROW, id(match[2]))} ${cells.slice(close)}` : `${cells} ${sentinel(ROW, id(match[2]))}`}`);
      continue;
    }
    // the sentinel keeps a space before it: emphasis closing on punctuation (`**Hello.**`) or an encoded space must be
    // followed by whitespace to close (CommonMark's flanking rules), and a private-use character is neither
    match = MARKER_EOL.exec(plain);
    out.push(`${prefix}${match ? `${match[1]} ${sentinel(LINE, id(match[2]))}` : plain}`);
  }
  return out.join('\n');
}

/** Moves the sentinels' ids onto their blocks and drops the marker paragraphs and the sentinel text. */
function assignIds(node: Json, ids: string[], ancestors: Json[]): Json {
  let content = node.content as Json[] | undefined;
  if (content) {
    const kept: Json[] = [];
    for (const child of content) {
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
    for (const child of content) {
      if (child.type !== 'text' || !child.text) {
        texts.push(child);
        continue;
      }
      // a sentinel goes with the one space toSentinels put before it
      const text = child.text.replace(SPACED_SENTINEL, (_match, kind: string, index: string) => {
        const value = ids[Number(index)];
        if (kind === LINE) {
          const parent = ancestors[ancestors.length - 1];
          if (parent && ITEMS.has(parent.type ?? '') && parent.content?.[0] === node) parent.attrs = { ...parent.attrs, id: value };
          else result.attrs = { ...result.attrs, id: value };
        } else if (kind === ROW) {
          const row = [...ancestors].reverse().find((ancestor) => ancestor.type === 'tableRow');
          if (row) row.attrs = { ...row.attrs, id: value };
        }
        return '';
      });
      if (text) texts.push({ ...child, text });
    }
    result = { ...result, content: dropPlaceholder(texts) };
  }
  return result;
}

/** prepare()'s no-break space taken back: one alone is an empty block; otherwise one fewer. */
function dropPlaceholder(texts: Json[]): Json[] {
  if (texts.length === 0 || !texts.every((child) => child.type === 'text' && /^\u00A0+$/.test(child.text ?? ''))) return texts;
  const last = texts[texts.length - 1];
  const shorter = (last.text ?? '').slice(1);
  return shorter ? [...texts.slice(0, -1), { ...last, text: shorter }] : texts.slice(0, -1);
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
  serialize(node: PMNode, { ids = true, milestones = null, charts, forReaders }: SerializeOptions = {}): string {
    const blocks: PMNode[] = [];
    if (node.type.name === 'doc') node.forEach((block) => blocks.push(block));
    else blocks.push(node);
    return blocks.map((block) => this.block(block, { ids, milestones, charts, forReaders })).join('\n\n');
  }

  /** One top-level block as the dialect, its `^id` included when `ids` is on. */
  block(block: PMNode, { ids = true, milestones = null, charts, forReaders = false }: SerializeOptions = {}): string {
    const tables: Tables = { ids: [], threads: [], forReaders };
    const doc: Json = { type: 'doc', content: [] };
    const prepared = prepare(mapStrings(withCharts(block.toJSON() as Json, charts) /* P3-E */, toLiteral), doc, milestones ?? new Set(), tables, ids, {});
    const text = restore(this.md.serialize({ type: 'doc', content: [prepared] }).replace(/^\n+|\n+$/g, ''), tables);
    const id = block.attrs.id as string | null | undefined;
    return ids && id && !TEXTBLOCKS.has(block.type.name) ? `${text}\n^${id}` : text;
  }

  /** Markdown into top-level blocks of the schema: a `^id` it names is kept, every other block gets a fresh id. */
  parse(markdown: string, { generateID = nanoid8 }: ParseOptions = {}): PMNode[] {
    const ids: string[] = [];
    const parsed = this.md.parse(toSentinels(toLiteral(markdown), ids)) as Json;
    const doc = mapStrings(mintIds(assignIds(parsed, ids, []), generateID), fromLiteral);
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
