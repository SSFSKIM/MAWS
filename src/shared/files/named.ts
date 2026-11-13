// The rule of a file the transcript names (UX wave U6c, docs/doperpowers/plans/2026-11-12-ux-wave-U6c-linked-file.md,
// Interfaces §A). On this Mac a file outside a session's folders opens read-only when that session's transcript writes
// its path whole, in a form the window makes a file click from ("The click sources"): the destination of an inline
// Markdown link (the link form), the whole value of a read's or an edit's chip (the value form), or the path of an
// anchored comment's tag (the anchor form). Each form's string is read as the click reads it and compared with the
// asked path whole, byte for byte. Pure, and shared: the daemon's search (`src/services/files/named.ts`) and the window's
// test (`src/renderer/src/tools/code/named-links.test.tsx`, which holds the window's readers to these copies) read the
// same functions. A bare mention, a path inside a longer name and a path after a scheme name nothing.
import { parseAnchoredText } from '../anchor/message';

// `.`, `..` and repeated separators collapsed without touching the disk (ruled 2026-09-29, O1): a receipt's path comes
// from the model's input and may carry `..`, which `files.*` refuses as not normal; the boundary then judges the
// normalised path as any other. A relative path stays relative (and is refused by the service as such).
export function normalizeLexically(path: string): string {
  const absolute = path.startsWith('/');
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!absolute) out.push('..');
      continue;
    }
    out.push(segment);
  }
  const joined = out.join('/');
  return absolute ? `/${joined}` : joined || '.';
}

const asciiAlphanumeric = (code: number) => (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
const URI_SAFE = /[!#$&-;=?-Z_a-z~]/;

// remark's `href`: `normalizeUri` of micromark-util-sanitize-uri 2.0.1 (mdast-util-to-hast's link handler), mirrored
// line for line. A correct-looking escape (`%` and two ASCII alphanumerics) is kept, every other character outside the
// safe set is UTF-8 percent-encoded, and a lone surrogate becomes U+FFFD.
export function hrefOf(destination: string): string {
  const result: string[] = [];
  let index = -1;
  let start = 0;
  let skip = 0;
  while (++index < destination.length) {
    const code = destination.charCodeAt(index);
    let replace = '';
    if (code === 37 && asciiAlphanumeric(destination.charCodeAt(index + 1)) && asciiAlphanumeric(destination.charCodeAt(index + 2))) skip = 2;
    else if (code < 128) {
      if (!URI_SAFE.test(String.fromCharCode(code))) replace = String.fromCharCode(code);
    } else if (code > 55_295 && code < 57_344) {
      const next = destination.charCodeAt(index + 1);
      if (code < 56_320 && next > 56_319 && next < 57_344) {
        replace = String.fromCharCode(code, next);
        skip = 1;
      } else replace = '�';
    } else replace = String.fromCharCode(code);
    if (replace) {
      result.push(destination.slice(start, index), encodeURIComponent(replace));
      start = index + skip + 1;
    }
    if (skip) {
      index += skip;
      skip = 0;
    }
  }
  return result.join('') + destination.slice(start);
}

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
const BACKSLASH_ESCAPE = /\\([!-/:-@[-`{-~])/g;
const CHARACTER_REFERENCE = /&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/;
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/; // the window's `SCHEME` (markdown/sanitize.ts)
const PERCENT_ESCAPE = /%([0-9a-fA-F]{2})/g;
const LINE = /(?:#L(\d+)|:(\d+))$/; // the click's line suffix (markdown/Link.tsx)
const CHIP_SCHEME = 'maws-path:'; // the window's path chip (markdown/sanitize.ts, `remarkTranscriptSources`)

// The path a link with this destination asks for (click source 1): Markdown's backslash escapes resolved, remark's href,
// `decodeURI`, the line suffix off once, `.` and `..` collapsed. Null for a destination that is no path chip (a scheme in
// front, or empty) or that this reading does not recognise: a character reference, a letter or digit written as `%XX`
// (which is what lets the search pass a line over by its bytes, `needlesOf`), or an href `decodeURI` cannot read.
// Step 7 (Decision Log 12): the window parses `maws-path:<href>` as a URL before the click reads it (rehype-harden's
// `transformUrl`), so the destination is named only when the same reading of that serialisation gives the same path.
// The parser can only take a name away: where it reads a host, a port, a user or a query or fragment boundary into the
// href, the click asks for another path than the transcript wrote, and the answer is null.
export function clickPath(destination: string): string | null {
  if (destination === '' || CHARACTER_REFERENCE.test(destination)) return null;
  const url = destination.replace(BACKSLASH_ESCAPE, '$1');
  if (SCHEME.test(url)) return null;
  const href = hrefOf(url);
  const path = pathOfHref(href);
  if (path === null) return null;
  let parsed: string;
  try {
    parsed = new URL(`${CHIP_SCHEME}${href}`).href.slice(CHIP_SCHEME.length);
  } catch {
    return null;
  }
  return pathOfHref(parsed) === path ? path : null;
}

// Steps 3 to 6 of §A on an href.
function pathOfHref(href: string): string | null {
  for (const [, hex] of href.matchAll(PERCENT_ESCAPE)) if (asciiAlphanumeric(parseInt(hex, 16))) return null;
  let decoded: string;
  try {
    decoded = decodeURI(href);
  } catch {
    return null;
  }
  const line = LINE.exec(decoded);
  return normalizeLexically(line ? decoded.slice(0, line.index) : decoded);
}

// A link's destination and title cannot run longer than this past its `(` (a path is at most 1,024 bytes on macOS, three
// times that percent-encoded): a longer one is not recognised, so each link costs a bounded scan of a hostile text.
const LINK_TAIL_MAX = 16 * 1024;
const PAREN_DEPTH_MAX = 32; // micromark's linkResourceDestinationBalanceMax
const LABEL_MAX = 999; // a reference label's length at most (CommonMark)
const SCAN_STEP_CHARS = 64 * 1024; // the scan yields a step after this much text, so a caller can give the loop back

const isSpaceOrTab = (code: number) => code === 32 || code === 9;
const isLineEnding = (code: number) => code === 10 || code === 13;
const isControl = (code: number) => code < 32 || code === 127;
const isDigit = (code: number) => code >= 48 && code <= 57;
const escapes = (text: string, at: number, limit: number) => text.charCodeAt(at) === 92 && at + 1 < limit && ASCII_PUNCTUATION.test(text[at + 1]!);

// The end of the line that starts at `at`: its line ending, or the text's end.
function lineEndAt(text: string, at: number): number {
  const newline = text.indexOf('\n', at);
  return newline === -1 ? text.length : newline;
}
// From `at`, spaces, tabs and carriage returns up to `end`: the index after them.
function skipBlank(text: string, at: number, end: number): number {
  let i = at;
  while (i < end && (isSpaceOrTab(text.charCodeAt(i)) || text.charCodeAt(i) === 13)) i += 1;
  return i;
}

// From `at`, spaces or tabs and at most one line ending, after which a continuation line's container prefix (a quote's
// `>` markers and indentation, which Markdown strips) is passed over too: the index after them, or -1 at a second line
// ending. A context holds no blank line, so this never crosses one.
function skipWhitespace(text: string, at: number, end: number): number {
  let i = at;
  while (i < end && isSpaceOrTab(text.charCodeAt(i))) i += 1;
  if (i < end && isLineEnding(text.charCodeAt(i))) {
    i += text.charCodeAt(i) === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1;
    while (i < end && (isSpaceOrTab(text.charCodeAt(i)) || text.charCodeAt(i) === 62)) i += 1;
    if (i < end && isLineEnding(text.charCodeAt(i))) return -1;
  }
  return i;
}

// A scan that reached `LINK_TAIL_MAX` before it could tell: whether a resource or a definition stands there, and where
// it ends, is not known, so nothing more of its context is read as a link.
const UNKNOWN = Symbol('past the bound');
type Scan<T> = T | null | typeof UNKNOWN;
const pastBound = (end: number, limit: number): null | typeof UNKNOWN => (limit < end ? UNKNOWN : null);

// A destination at `at`: `<…>` with no line ending and no unescaped `<` or `>` inside, or a run with no space and no
// control character whose unescaped parentheses balance (the context's end also ends a run). `next` is the index after.
function destinationAt(text: string, at: number, limit: number, end: number): Scan<{ destination: string; next: number }> {
  let i = at;
  if (text.charCodeAt(i) === 60) {
    for (i += 1; i < limit; i += 1) {
      const code = text.charCodeAt(i);
      if (escapes(text, i, limit)) i += 1;
      else if (code === 62) break;
      else if (code === 60 || isLineEnding(code)) return null;
    }
    return i >= limit ? pastBound(end, limit) : { destination: text.slice(at + 1, i), next: i + 1 };
  }
  let depth = 0;
  for (; i < limit; i += 1) {
    const code = text.charCodeAt(i);
    if (escapes(text, i, limit)) i += 1;
    else if (code === 40) {
      if (++depth > PAREN_DEPTH_MAX) return null;
    } else if (code === 41) {
      if (depth === 0) break;
      depth -= 1;
    } else if (code === 32 || isControl(code)) break;
  }
  if (i >= limit && limit < end) return UNKNOWN;
  return depth === 0 && i > at ? { destination: text.slice(at, i), next: i } : null;
}

// A title at `at` (its opening marker): `"…"`, `'…'` or `(…)`. The index after it.
function titleAt(text: string, at: number, limit: number, end: number): Scan<number> {
  const marker = text.charCodeAt(at);
  const close = marker === 40 ? 41 : marker;
  let i = at + 1;
  for (; i < limit; i += 1) {
    const code = text.charCodeAt(i);
    if (escapes(text, i, limit)) i += 1;
    else if (code === close) break;
    else if (marker === 40 && code === 40) return null;
  }
  return i >= limit ? pastBound(end, limit) : i + 1;
}
const isTitleMarker = (code: number) => code === 34 || code === 39 || code === 40;

// After the `(` of `](` at `open`: the inline resource its `)` closes, that is its destination and the index of the `)`.
function resourceAt(text: string, open: number, end: number): Scan<{ destination: string; end: number }> {
  const limit = Math.min(end, open + LINK_TAIL_MAX);
  let i = skipWhitespace(text, open, limit);
  if (i < 0) return null;
  if (i >= limit) return pastBound(end, limit);
  let destination = ''; // an empty destination: `[r]()`, a link to nothing
  if (text.charCodeAt(i) !== 41) {
    const angle = text.charCodeAt(i) === 60;
    const found = destinationAt(text, i, limit, end);
    if (found === null || found === UNKNOWN) return found;
    destination = found.destination;
    i = found.next;
    const after = text.charCodeAt(i);
    if (angle && i < limit && !isSpaceOrTab(after) && !isLineEnding(after) && after !== 41) return null;
    // an optional title, after whitespace; then whitespace and `)`
    const beforeTitle = i;
    i = skipWhitespace(text, i, limit);
    if (i < 0) return null;
    if (i >= limit) return pastBound(end, limit);
    if (i > beforeTitle && isTitleMarker(text.charCodeAt(i))) {
      const title = titleAt(text, i, limit, end);
      if (title === null || title === UNKNOWN) return title;
      i = skipWhitespace(text, title, limit);
      if (i < 0) return null;
      if (i >= limit) return pastBound(end, limit);
    }
  }
  return text.charCodeAt(i) === 41 ? { destination, end: i } : null;
}

// A link label from the `[` at `at`: no unescaped bracket inside, at most LABEL_MAX characters, not only whitespace.
// The index of its `]`, or -1.
function labelEnd(text: string, at: number, end: number): number {
  const limit = Math.min(end, at + 1 + LABEL_MAX + 1);
  let blank = true;
  for (let i = at + 1; i < limit; i += 1) {
    const code = text.charCodeAt(i);
    if (escapes(text, i, limit)) {
      i += 1;
      blank = false;
    } else if (code === 93) return blank ? -1 : i;
    else if (code === 91) return -1;
    else if (!isSpaceOrTab(code) && !isLineEnding(code)) blank = false;
  }
  return -1;
}
// A label as references match it: whitespace collapsed, case folded.
const labelKey = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase();

// A reference definition at `at` (a paragraph's `[`), CommonMark's: `[label]:`, whitespace with at most one line ending,
// a destination, and either a title after whitespace or nothing, with only spaces or tabs after it to its line's end.
// Its label and the index of the line ending (or the context's end) that ends it; null when none stands there. A
// definition whose destination or title runs past the bound is taken as one to the context's end: nothing in it is read.
function definitionAt(text: string, at: number, end: number): { label: string; end: number } | null {
  if (text.charCodeAt(at + 1) === 94) return null; // `[^…]:` is a footnote's definition, whose text is Markdown
  const close = labelEnd(text, at, end);
  if (close < 0 || text.charCodeAt(close + 1) !== 58) return null;
  const label = text.slice(at + 1, close);
  const limit = Math.min(end, close + 2 + LINK_TAIL_MAX);
  const i = skipWhitespace(text, close + 2, limit);
  if (i < 0 || i >= end) return null;
  if (i >= limit) return { label, end };
  const found = destinationAt(text, i, limit, end);
  if (found === UNKNOWN) return { label, end };
  if (found === null) return null;
  const lineEnded = (from: number) => {
    const e = skipBlank(text, from, end);
    return e >= end || text.charCodeAt(e) === 10 ? e : -1;
  };
  const t = skipWhitespace(text, found.next, limit);
  if (t > found.next && t < limit && isTitleMarker(text.charCodeAt(t))) {
    const title = titleAt(text, t, limit, end);
    if (title === UNKNOWN) return { label, end };
    if (title !== null && lineEnded(title) >= 0) return { label, end: lineEnded(title) };
  }
  const plain = lineEnded(found.next);
  return plain >= 0 ? { label, end: plain } : null;
}

// One line's container prefix, as far as it decides a block: the quote's depth (`>` markers), whether the line opens a
// container (a list item's marker, a footnote's definition), and where its content begins after the prefix, with the
// columns of indentation before it (a tab counted as four).
interface Line {
  start: number;
  end: number;
  quote: number;
  opens: boolean;
  footnote: boolean; // the line opens a footnote's definition (`[^label]:`)
  content: number; // the first character after the prefix and the indentation
  indent: number;
}

const isThematicBreak = (text: string, at: number, end: number) => {
  const marker = text.charCodeAt(at);
  if (marker !== 45 && marker !== 42 && marker !== 95) return false;
  let count = 0;
  for (let i = at; i < end; i += 1) {
    const code = text.charCodeAt(i);
    if (code === marker) count += 1;
    else if (!isSpaceOrTab(code) && code !== 13) return false;
  }
  return count >= 3;
};

function lineAt(text: string, start: number): Line {
  const end = lineEndAt(text, start);
  let i = start;
  let quote = 0;
  let opens = false;
  let footnote = false;
  for (;;) {
    let j = i;
    let columns = 0;
    while (j < end && columns < 4 && isSpaceOrTab(text.charCodeAt(j))) {
      columns += text.charCodeAt(j) === 9 ? 4 : 1;
      j += 1;
    }
    if (columns >= 4) break;
    const code = text.charCodeAt(j);
    if (code === 62) {
      quote += 1;
      i = j + 1;
      if (isSpaceOrTab(text.charCodeAt(i))) i += 1;
      continue;
    }
    let marker = -1; // the index after a list item's marker
    if ((code === 45 || code === 43 || code === 42) && !isThematicBreak(text, j, end)) marker = j + 1;
    else if (isDigit(code)) {
      let k = j;
      while (k < end && k - j < 9 && isDigit(text.charCodeAt(k))) k += 1;
      if (text.charCodeAt(k) === 46 || text.charCodeAt(k) === 41) marker = k + 1;
    } else if (code === 91 && text.charCodeAt(j + 1) === 94) {
      const close = labelEnd(text, j, end);
      if (close > 0 && text.charCodeAt(close + 1) === 58) marker = close + 2;
    }
    if (marker < 0 || (marker < end && !isSpaceOrTab(text.charCodeAt(marker)) && text.charCodeAt(marker) !== 13)) break;
    opens = true;
    if (code === 91) footnote = true;
    // one to four spaces after the marker belong to it; past four, one does, and the rest is the content's indentation
    let spaces = 0;
    while (marker + spaces < end && spaces < 5 && isSpaceOrTab(text.charCodeAt(marker + spaces))) spaces += 1;
    i = marker + (spaces >= 5 ? 1 : spaces);
  }
  let content = i;
  let indent = 0;
  while (content < end && isSpaceOrTab(text.charCodeAt(content))) {
    indent += text.charCodeAt(content) === 9 ? 4 : 1;
    content += 1;
  }
  return { start, end, quote, opens, footnote, content, indent };
}

// After at most `max` of a quote's `>` markers at the start of a line: how many stood there, and the index after them.
function quoteMarkers(text: string, start: number, end: number, max: number): { count: number; at: number } {
  let at = start;
  let count = 0;
  while (count < max) {
    let j = at;
    while (j < end && j - at < 3 && text.charCodeAt(j) === 32) j += 1;
    if (text.charCodeAt(j) !== 62) break;
    count += 1;
    at = j + 1;
    if (isSpaceOrTab(text.charCodeAt(at))) at += 1;
  }
  return { count, at };
}
const columnsBetween = (text: string, from: number, to: number) => {
  let columns = 0;
  for (let i = from; i < to; i += 1) columns += text.charCodeAt(i) === 9 ? 4 : 1;
  return columns;
};

// A fence's opening at `at`: three or more backticks (whose info has none) or tildes, or two or more dollars (math).
function fenceAt(text: string, at: number, end: number): { marker: number; length: number } | null {
  const marker = text.charCodeAt(at);
  if (marker !== 96 && marker !== 126 && marker !== 36) return null;
  let i = at;
  while (i < end && text.charCodeAt(i) === marker) i += 1;
  const length = i - at;
  if (length < (marker === 36 ? 2 : 3)) return null;
  if (marker !== 126 && text.slice(i, end).includes(String.fromCharCode(marker))) return null;
  return { marker, length };
}
const closesFence = (text: string, at: number, end: number, fence: { marker: number; length: number }) => {
  let i = at;
  while (i < end && text.charCodeAt(i) === fence.marker) i += 1;
  return i - at >= fence.length && skipBlank(text, i, end) >= end;
};
const headingAt = (text: string, at: number, end: number) => {
  let i = at;
  while (i < end && i - at < 7 && text.charCodeAt(i) === 35) i += 1;
  const level = i - at;
  return level >= 1 && level <= 6 && (i >= end || isSpaceOrTab(text.charCodeAt(i)) || text.charCodeAt(i) === 13) ? i : -1;
};
const isSetextUnderline = (text: string, at: number, end: number) => {
  const marker = text.charCodeAt(at);
  if (marker !== 61 && marker !== 45) return false;
  let i = at;
  while (i < end && text.charCodeAt(i) === marker) i += 1;
  return skipBlank(text, i, end) >= end;
};
// The cells of a table row, [start, end) each: split at every unescaped `|`, the row's outer pipes dropped.
function cellsOf(text: string, at: number, end: number): [number, number][] {
  const cells: [number, number][] = [];
  let start = at;
  for (let i = at; i < end; i += 1) {
    if (escapes(text, i, end)) i += 1;
    else if (text.charCodeAt(i) === 124) {
      cells.push([start, i]);
      start = i + 1;
    }
  }
  cells.push([start, end]);
  if (cells.length > 1 && skipBlank(text, cells[0]![0], cells[0]![1]) >= cells[0]![1]) cells.shift();
  if (cells.length > 1 && skipBlank(text, cells[cells.length - 1]![0], cells[cells.length - 1]![1]) >= cells[cells.length - 1]![1]) cells.pop();
  return cells;
}
const DELIMITER_ROW = /^\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t\r]*$/;
const isDelimiterRow = (text: string, at: number, end: number) => {
  const row = text.slice(at, end);
  return row.includes('|') && DELIMITER_ROW.test(row);
};

// Where inline links can stand: a paragraph after its leading reference definitions, a heading's text, a table's cell.
interface Context {
  start: number;
  end: number;
}

// The block pass: the text's contexts, in order, and the labels of the reference definitions it holds. A code fence
// (backticks, tildes, or math's dollars), an indented code block, a thematic break or a heading's underline holds no
// link; a blank line, or a line of a quote's markers alone, ends a paragraph; a list item or a deeper quote starts a new
// one; a line that only continues a paragraph (a lazy one too) stays in it. Raw HTML is no block here, as in the window
// (its parser has HTML switched off). Where the pass cannot tell (a list item's own indentation, an ordered item that
// cannot interrupt a paragraph, a table under a paragraph), it takes the side that reads fewer links.
function* blocksOf(text: string, contexts: Context[], defined: Set<string>): Generator<null, void, void> {
  let fence: { marker: number; length: number; quote: number; column: number } | null = null;
  let paragraph: { lines: number[]; quote: number; end: number; dropped: boolean } | null = null;
  let table: { quote: number } | null = null;
  // A footnote's definition, from its line to a line indented less than four columns after a blank one: the window
  // draws it only where a call names it, so nothing in it is read as a link.
  let footnote = false;
  let afterBlank = false;
  let pause = SCAN_STEP_CHARS;
  const closeParagraph = () => {
    if (paragraph === null) return;
    const { lines, end, dropped } = paragraph;
    paragraph = null;
    let at = lines[0]!;
    let k = 0;
    for (;;) {
      const definition = text.charCodeAt(at) === 91 ? definitionAt(text, at, end) : null;
      if (definition === null) break;
      defined.add(labelKey(definition.label));
      while (k < lines.length && lines[k]! <= definition.end) k += 1;
      if (k >= lines.length) return;
      at = lines[k]!;
    }
    if (!dropped) contexts.push({ start: at, end });
  };
  const row = (line: Line) => {
    if (!footnote) for (const [start, end] of cellsOf(text, line.content, line.end)) contexts.push({ start, end });
  };
  for (let start = 0; start < text.length; ) {
    if (start >= pause) {
      pause = start + SCAN_STEP_CHARS;
      yield null;
    }
    const line = lineAt(text, start);
    const next = line.end + 1;
    const blank = skipBlank(text, line.content, line.end) >= line.end;
    if (line.footnote) footnote = true;
    else if (footnote && !blank && afterBlank && line.indent < 4) footnote = false;
    afterBlank = blank;
    if (fence !== null) {
      // Inside a fence a line is read for the fence's own quote markers and nothing else (a list marker there is code).
      // A quote that ends closes the fence. A closing fence stands at the opening's column, up to three more: one less
      // indented, in a list item, closes the item and opens a fence of its own, which this reads as the same code.
      const quoted = quoteMarkers(text, start, line.end, fence.quote);
      if (quoted.count < fence.quote) fence = null;
      else {
        let content = quoted.at;
        let indent = 0;
        while (content < line.end && isSpaceOrTab(text.charCodeAt(content))) {
          indent += text.charCodeAt(content) === 9 ? 4 : 1;
          content += 1;
        }
        if (indent >= fence.column && indent <= fence.column + 3 && closesFence(text, content, line.end, fence)) fence = null;
        start = next;
        continue;
      }
    }
    if (skipBlank(text, line.content, line.end) >= line.end) {
      closeParagraph();
      table = null;
      start = next;
      continue;
    }
    const opened = line.indent < 4 ? fenceAt(text, line.content, line.end) : null;
    const heading = line.indent < 4 ? headingAt(text, line.content, line.end) : -1;
    const blockStarts = opened !== null || heading >= 0 || (line.indent < 4 && isThematicBreak(text, line.content, line.end));
    if (table !== null && (line.quote < table.quote || line.opens || blockStarts)) table = null;
    if (table !== null) {
      row(line);
      start = next;
      continue;
    }
    if (line.indent >= 4) {
      if (paragraph !== null && !line.opens) {
        paragraph.lines.push(line.content);
        paragraph.end = line.end;
      } else closeParagraph(); // indented code
      start = next;
      continue;
    }
    if (opened !== null) {
      closeParagraph();
      fence = { ...opened, quote: line.quote, column: columnsBetween(text, quoteMarkers(text, start, line.end, Infinity).at, line.content) };
    } else if (heading >= 0) {
      closeParagraph();
      if (!footnote) contexts.push({ start: heading, end: line.end });
    } else if (blockStarts || (paragraph !== null && !line.opens && isSetextUnderline(text, line.content, line.end))) {
      closeParagraph();
    } else if (next < text.length && isTableHeader(text, line, lineAt(text, next))) {
      closeParagraph();
      table = { quote: line.quote };
      row(line);
      start = lineEndAt(text, next) + 1; // the delimiter row holds no link
      continue;
    } else if (paragraph === null || line.opens || line.quote > paragraph.quote) {
      closeParagraph();
      paragraph = { lines: [line.content], quote: line.quote, end: line.end, dropped: footnote };
    } else {
      paragraph.lines.push(line.content);
      paragraph.end = line.end;
    }
    start = next;
  }
  closeParagraph();
}
// A table's head: a row whose next line, in the same quote, is a delimiter row of as many cells.
const isTableHeader = (text: string, line: Line, below: Line) =>
  below.quote === line.quote && !below.opens && below.indent < 4 && isDelimiterRow(text, below.content, below.end) && cellsOf(text, below.content, below.end).length === cellsOf(text, line.content, line.end).length;

// eslint-disable-next-line no-control-regex -- an autolink's URI holds no control character, as CommonMark's
const AUTOLINK = /<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\x00-\x20<>]*|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/y;
const LITERAL_URL = /https?:\/\/|www\./iy; // GFM's literal autolinks
const isAlphanumeric = (code: number) => asciiAlphanumeric(code);

// The click path of every inline link the window draws as a path chip in `text`, in order (the link form; Interfaces
// §A). The text is read as the window's Markdown reads it, as far as a link's standing goes: by blocks first
// (`blocksOf`), then each context left to right, a code span, inline math, an autolink or a literal URL holding no
// link, and links as CommonMark pairs them (an opener closed by a link no longer opens one around it; a link inside an
// image's text is no chip). A link's or an image's resource, and a reference definition, are read once. Where the scan
// cannot tell how the window reads a span (a literal URL's extent, a resource past 16 KiB), it reads no link there:
// every path it names is one the window draws (the differential in `named-links.test.tsx` holds it), and a chip it does
// not name fails towards the refusal.
export function linkPaths(text: string): string[] {
  const out: string[] = [];
  for (const path of linkSteps(text)) if (path !== null) out.push(path);
  return out;
}

// What `linkPaths` reads, one bounded step at a time (the branch review's finding 2): each link met yields its click
// path, or null when it names none, and the scan yields null after every `SCAN_STEP_CHARS` of text, so a caller can stop
// at the first path it wants and give the event loop back between steps.
function* linkSteps(text: string): Generator<string | null, void, void> {
  const contexts: Context[] = [];
  const defined = new Set<string>();
  yield* blocksOf(text, contexts, defined);
  let pause = SCAN_STEP_CHARS;
  for (const { start, end } of contexts) {
    const opens: { at: number; image: boolean; active: boolean }[] = [];
    const runs = new Map<string, { from: number; at: number }>(); // per delimiter run, the first of its length found from a point
    // The first run of exactly `length` of `marker` from `from` before `end`, or -1 (a code span's or math's closing run).
    const runAt = (marker: string, length: number, from: number): number => {
      const key = `${marker}${length}`;
      const known = runs.get(key);
      if (known !== undefined && known.from <= from && (known.at === -1 || known.at >= from)) return known.at;
      let found = -1;
      for (let j = text.indexOf(marker, from); j !== -1 && j < end; ) {
        let k = j;
        while (k < end && text[k] === marker) k += 1;
        if (k - j === length) {
          found = j;
          break;
        }
        j = text.indexOf(marker, k);
      }
      runs.set(key, { from, at: found });
      return found;
    };
    const deactivate = () => {
      for (const opener of opens) if (!opener.image) opener.active = false;
    };
    for (let i = start; i < end; ) {
      if (i >= pause) {
        pause = i + SCAN_STEP_CHARS;
        yield null;
      }
      const code = text.charCodeAt(i);
      if (escapes(text, i, end)) {
        i += 2;
        continue;
      }
      if (code === 96 || code === 36) {
        // a code span, or inline math (two dollars or more): its run closed by the next run of the same length
        let k = i;
        while (k < end && text.charCodeAt(k) === code) k += 1;
        const length = k - i;
        const close = code === 36 && length < 2 ? -1 : runAt(text[i]!, length, k);
        i = close >= 0 ? close + length : k;
        continue;
      }
      if (code === 60) {
        AUTOLINK.lastIndex = i;
        const autolink = AUTOLINK.exec(text);
        i = autolink !== null && AUTOLINK.lastIndex <= end ? AUTOLINK.lastIndex : i + 1;
        continue;
      }
      if ((code === 104 || code === 72 || code === 119 || code === 87) && (i === start || !isAlphanumeric(text.charCodeAt(i - 1)))) {
        LITERAL_URL.lastIndex = i;
        if (LITERAL_URL.test(text)) {
          // a literal URL, to the next whitespace or `<`: no link in it, and none around it
          let k = i;
          while (k < end && !isSpaceOrTab(text.charCodeAt(k)) && !isLineEnding(text.charCodeAt(k)) && text.charCodeAt(k) !== 60) k += 1;
          opens.length = 0;
          i = k;
          continue;
        }
      }
      if (code === 33 && text.charCodeAt(i + 1) === 91) {
        opens.push({ at: i + 1, image: true, active: true });
        i += 2;
        continue;
      }
      if (code === 91) {
        opens.push({ at: i, image: false, active: true });
        i += 1;
        continue;
      }
      if (code !== 93) {
        i += 1;
        continue;
      }
      const opener = opens.pop();
      if (opener === undefined || !opener.active) {
        i += 1; // a literal `]`
        continue;
      }
      if (text.charCodeAt(i + 1) === 40) {
        const resource = resourceAt(text, i + 2, end);
        if (resource === UNKNOWN) {
          yield null; // past the bound: nothing more of this context is read
          break;
        }
        if (resource !== null) {
          if (opener.image) yield null;
          else {
            yield opens.some((open) => open.image) ? null : clickPath(resource.destination); // inside an image's text: alt text
            deactivate();
          }
          i = resource.end + 1;
          continue;
        }
      }
      // a reference link: full (`[text][label]`), collapsed (`[text][]`) or shortcut (`[text]`), when its label is defined
      let after = i + 1;
      let key = labelKey(text.slice(opener.at + 1, i)); // a shortcut's, unless a label follows
      if (text.charCodeAt(i + 1) === 91) {
        const close = text.charCodeAt(i + 2) === 93 ? i + 2 : labelEnd(text, i + 1, end);
        if (close > i + 2) key = labelKey(text.slice(i + 2, close));
        if (close > 0) after = close + 1;
      }
      if (defined.has(key)) {
        yield null; // the window draws no path chip for a reference link
        if (!opener.image) deactivate();
        i = after;
        continue;
      }
      i += 1; // no link: a literal `]`, and its opener gone
    }
  }
}

export const READ_TOOLS: ReadonlySet<string> = new Set(['Read', 'NotebookRead', 'LS']); // click source 2 (cells/ReadDetail.tsx)
export const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']); // click source 3 (cells/EditDetail.tsx)

const record = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

// The value a read's or an edit's chip shows for this call's input: the window's `filePathOf` (model/cells.ts), the first
// of `file_path`, `notebook_path`, `path` that is a string, else ''. Null for a tool that draws no file chip.
export function chipPath(toolName: string, input: unknown): string | null {
  if (!READ_TOOLS.has(toolName) && !EDIT_TOOLS.has(toolName)) return null;
  const fields = record(input);
  return str(fields.file_path, str(fields.notebook_path, str(fields.path)));
}

const MCP_TOOL = /^mcp__([^_].*?)__(.+)$/; // the window's `MCP_TOOL` (model/classify.ts)
export const isMcpTool = (toolName: string): boolean => MCP_TOOL.test(toolName);

// The path of the anchored comment's tag that ends `text` (click source 4), as the window parses it.
export const anchorPath = (text: string): string | null => parseAnchoredText(text)?.anchor.path ?? null;

export interface PendingCall {
  toolUseId: string;
  when: 'mcp' | 'edit';
}
export type RowClaim = { names: true } | { names: false; pending: PendingCall[] };

const NOTHING: RowClaim = { names: false, pending: [] };
const NAMES: RowClaim = { names: true };
const isThePath = (value: unknown, path: string) => typeof value === 'string' && normalizeLexically(value) === path;
const listOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

// The rule's work on one record, as steps: one per value visited (a block, a container or a string of a tool's input:
// fix round 1, item 5) and one per step of `linkSteps`, each bounded, and the answer at the end. `rowClaim` runs them
// at once; the daemon's search gives the event loop back between them.
type Steps<T> = Generator<void, T, void>;

// A content's texts: the content when a string, else the `text` of each block of type `text`, a step per block.
function* textsOf(content: unknown): Steps<string[]> {
  if (typeof content === 'string') return [content];
  const texts: string[] = [];
  for (const value of listOf(content)) {
    yield;
    const block = record(value);
    if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text);
  }
  return texts;
}

// Whether one of the texts links the path; it stops at the first that does.
function* linksTo(texts: readonly string[], path: string): Steps<boolean> {
  for (const text of texts) {
    yield;
    if (!text.includes('](')) continue;
    for (const found of linkSteps(text)) {
      if (found === path) return true;
      yield;
    }
  }
  return false;
}

// Whether any string of a value, at any depth (a tool's input), links the path; walked without recursion, a step per
// value visited, containers included, and an array's items read in place.
function* anyStringLinks(value: unknown, path: string): Steps<boolean> {
  const stack: { items: readonly unknown[]; at: number }[] = [{ items: [value], at: 0 }];
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    if (top.at >= top.items.length) {
      stack.pop();
      continue;
    }
    const next = top.items[top.at++];
    yield;
    if (typeof next === 'string') {
      if (yield* linksTo([next], path)) return true;
    } else if (next !== null && typeof next === 'object') stack.push({ items: Array.isArray(next) ? next : Object.values(next), at: 0 });
  }
  return false;
}

// A person's message names the path by a link in its text, or by its anchored comment's tag; the window joins the text
// blocks this way before it reads the tag (`userTextOf`, model/user-text.ts).
function* personNames(content: unknown, path: string): Steps<boolean> {
  const texts = yield* textsOf(content);
  return (yield* linksTo(texts, path)) || isThePath(anchorPath(texts.join('\n\n')), path);
}

// Whether a record names `path` (Interfaces §A, the table of `rowClaim`), or which calls a result form of it waits for.
export function rowClaim(row: unknown, path: string): RowClaim {
  const steps = rowClaimSteps(row, path);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

// `rowClaim` one bounded step at a time, stopping at the first string that names the path (the branch review's
// finding 2: one row under the row bound can hold a great many links).
export function* rowClaimSteps(row: unknown, path: string): Steps<RowClaim> {
  const fields = record(row);
  switch (fields.type) {
    case 'assistant': {
      for (const value of listOf(record(fields.message).content)) {
        yield;
        const block = record(value);
        if (block.type === 'text' && (yield* linksTo([str(block.text)], path))) return NAMES;
        if (block.type === 'tool_use' && (isThePath(chipPath(str(block.name), block.input), path) || (yield* anyStringLinks(block.input, path)))) return NAMES;
      }
      return NOTHING;
    }
    case 'user': {
      if (fields.isMeta === true || fields.isCompactSummary === true) return NOTHING; // the window draws no bubble for these
      const content = record(fields.message).content;
      if (yield* personNames(content, path)) return NAMES;
      const edited = isThePath(record(fields.toolUseResult).filePath, path);
      const pending: PendingCall[] = [];
      for (const value of listOf(content)) {
        yield;
        const block = record(value);
        if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
        if (yield* linksTo(yield* textsOf(block.content), path)) pending.push({ toolUseId: block.tool_use_id, when: 'mcp' });
        if (edited) pending.push({ toolUseId: block.tool_use_id, when: 'edit' });
      }
      return pending.length > 0 ? { names: false, pending } : NOTHING;
    }
    case 'attachment': {
      // a person's message the engine took into a running turn (`humanQueuedPrompt`, src/engine-host/fs/backfill.ts)
      const attachment = record(fields.attachment);
      const human = attachment.type === 'queued_command' && record(attachment.origin).kind === 'human' && attachment.commandMode === 'prompt' && attachment.isMeta !== true;
      if (!human || typeof attachment.source_uuid !== 'string' || attachment.source_uuid === '') return NOTHING;
      return (yield* personNames(attachment.prompt, path)) ? NAMES : NOTHING;
    }
    default:
      return NOTHING;
  }
}

// The class of the call `toolUseId` names, read from its own `tool_use` block in an `assistant` record; null for any
// other record. A waiting claim becomes a name exactly when the class is the one it waits for.
export function callClass(row: unknown, toolUseId: string): 'mcp' | 'edit' | 'other' | null {
  const fields = record(row);
  if (fields.type !== 'assistant') return null;
  const block = listOf(record(fields.message).content).map(record).find((candidate) => candidate.type === 'tool_use' && candidate.id === toolUseId);
  if (!block) return null;
  const name = str(block.name);
  return isMcpTool(name) ? 'mcp' : EDIT_TOOLS.has(name) ? 'edit' : 'other';
}

// What every record that names `path` holds in its bytes as written: the runs of ASCII letters and digits three
// characters or longer, longest first; when there is none, the longest run. JSON escapes no letter or digit, Markdown's
// backslash applies to punctuation, the tag's attribute escapes are punctuation, `normalizeLexically` removes whole
// segments and joins none, and a letter or digit written as `%XX` is refused by `clickPath`; so a line that lacks one of
// them need not be parsed.
export function needlesOf(path: string): string[] {
  const runs = (path.match(/[A-Za-z0-9]+/g) ?? []).sort((a, b) => b.length - a.length);
  const long = runs.filter((run) => run.length >= 3);
  return long.length > 0 ? long : runs.slice(0, 1);
}
