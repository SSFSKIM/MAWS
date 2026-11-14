// The rule of a file the transcript names (UX wave U6c, docs/doperpowers/plans/2026-11-12-ux-wave-U6c-linked-file.md,
// Interfaces §A). On this Mac a file outside a session's folders opens read-only when that session's transcript writes
// its path whole, in a form the window makes a file click from ("The click sources"): the destination of an inline
// Markdown link (the link form), the whole value of a read's or an edit's chip (the value form), or the path of an
// anchored comment's tag (the anchor form). Each form's string is read as the click reads it and compared with the
// asked path whole, byte for byte. Pure, and shared: the daemon's search (`src/services/files/named.ts`) and the window's
// test (`src/renderer/src/tools/code/named-links.test.tsx`, which holds the window's readers to these copies) read the
// same functions. A bare mention, a path inside a longer name and a path after a scheme name nothing.
import { readAnchoredMessage } from '../anchor/message';

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
export const SCAN_STEP_CHARS = 64 * 1024; // the meter's work between two pauses of the scan

// The scan's work is bounded by construction (Decision Log 24). One meter per text: every loop of the block pass and the
// inline pass that advances over the text, its helpers' included, charges what it visits. The scan pauses (yields PAUSE,
// on which the daemon gives the event loop back) each time the meter has advanced SCAN_STEP_CHARS, and a text whose work
// would pass WORK_PER_CHAR times its length (with WORK_FLOOR more) names nothing more. Each helper call is bounded by a
// cap of its own, so the work between two pauses is at most STRETCH_MAX, whatever the text; what passes a cap is refused,
// as everything this rule cannot tell is.
export const WORK_PER_CHAR = 64;
export const WORK_FLOOR = 4096;
export const STRETCH_MAX = 16 * SCAN_STEP_CHARS;
export const PAUSE = Symbol('the scan pauses');
const LINE_TEST_MAX = 16 * 1024; // a block-level test reads at most this much of one line; one it cannot decide by then refuses the text
const BLOCK_MARKERS_MAX = 32; // container markers (`>`, a list item's, a footnote's) on one line at most
const OPENERS_MAX = 1024; // brackets open in one context at most

interface Meter {
  work: number;
  budget: number;
  pause: number; // the work at which the scan next pauses
}
// A text refused from where the scan stands: past its budget, or past a cap. Nothing more of it is named.
class ScanRefused extends Error {}
const meterFor = (text: string): Meter => ({ work: 0, budget: WORK_PER_CHAR * text.length + WORK_FLOOR, pause: SCAN_STEP_CHARS });
function charge(m: Meter, n: number): void {
  if (m.work + n > m.budget) throw new ScanRefused();
  m.work += n;
}
// Used as `if (m.work >= m.pause) yield pauseAt(m);` at the head of every loop of the two passes.
function pauseAt(m: Meter): typeof PAUSE {
  m.pause = m.work + SCAN_STEP_CHARS;
  return PAUSE;
}
// A cap passed: the work spent reaching it is counted (past the budget too), and the text is refused from here.
function refuseAfter(m: Meter, spent: number): never {
  m.work += spent;
  throw new ScanRefused();
}
// The end of a line-level test that read up to `limit`: when that was the cap and not the line's end, it could not decide.
function decided(i: number, limit: number, end: number): void {
  if (i >= limit && limit < end) throw new ScanRefused();
}
const lineLimit = (at: number, end: number) => Math.min(end, at + LINE_TEST_MAX);

const isSpaceOrTab = (code: number) => code === 32 || code === 9;
const isLineEnding = (code: number) => code === 10 || code === 13;
const isControl = (code: number) => code < 32 || code === 127;
const isDigit = (code: number) => code >= 48 && code <= 57;
const escapes = (text: string, at: number, limit: number) => text.charCodeAt(at) === 92 && at + 1 < limit && ASCII_PUNCTUATION.test(text[at + 1]!);

// The end of the line that starts at `start` (its line ending, or the text's end), found a pause's worth at a time.
function* lineEndFrom(text: string, start: number, m: Meter): Generator<typeof PAUSE, number, void> {
  for (let at = start; ; ) {
    const limit = Math.min(text.length, at + SCAN_STEP_CHARS);
    const found = text.slice(at, limit).indexOf('\n');
    charge(m, (found < 0 ? limit - at : found) + 1);
    if (found >= 0) return at + found;
    if (limit >= text.length) return text.length;
    at = limit;
    if (m.work >= m.pause) yield pauseAt(m);
  }
}
// From `at`, spaces, tabs and carriage returns up to `end`: the index after them.
function skipBlank(text: string, at: number, end: number, m: Meter): number {
  let i = at;
  while (i < end && (isSpaceOrTab(text.charCodeAt(i)) || text.charCodeAt(i) === 13)) i += 1;
  charge(m, i - at + 1);
  return i;
}
// Whether a line holds only spaces, tabs and carriage returns from `at` to its end.
function blankFrom(text: string, at: number, end: number, m: Meter): boolean {
  const limit = lineLimit(at, end);
  const i = skipBlank(text, at, limit, m);
  decided(i, limit, end);
  return i >= end;
}

// From `at`, spaces or tabs and at most one line ending, after which a continuation line's container prefix (a quote's
// `>` markers and indentation, which Markdown strips) is passed over too: the index after them, or -1 at a second line
// ending. A context holds no blank line, so this never crosses one. `end` is a bound of its caller's.
function skipWhitespace(text: string, at: number, end: number, m: Meter): number {
  let i = at;
  while (i < end && isSpaceOrTab(text.charCodeAt(i))) i += 1;
  if (i < end && isLineEnding(text.charCodeAt(i))) {
    i += text.charCodeAt(i) === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1;
    while (i < end && (isSpaceOrTab(text.charCodeAt(i)) || text.charCodeAt(i) === 62)) i += 1;
    charge(m, i - at + 1);
    if (i < end && isLineEnding(text.charCodeAt(i))) return -1;
    return i;
  }
  charge(m, i - at + 1);
  return i;
}

// A scan that reached `LINK_TAIL_MAX` before it could tell: whether a resource or a definition stands there, and where
// it ends, is not known, so nothing more of its context is read as a link.
const UNKNOWN = Symbol('past the bound');
type Scan<T> = T | null | typeof UNKNOWN;
const pastBound = (end: number, limit: number): null | typeof UNKNOWN => (limit < end ? UNKNOWN : null);

// A destination at `at`: `<…>` with no line ending and no unescaped `<` or `>` inside, or a run with no space and no
// control character whose unescaped parentheses balance (the context's end also ends a run). `next` is the index after.
function destinationAt(text: string, at: number, limit: number, end: number, m: Meter): Scan<{ destination: string; next: number }> {
  let i = at;
  if (text.charCodeAt(i) === 60) {
    for (i += 1; i < limit; i += 1) {
      const code = text.charCodeAt(i);
      if (escapes(text, i, limit)) i += 1;
      else if (code === 62) break;
      else if (code === 60 || isLineEnding(code)) {
        charge(m, i - at + 1);
        return null;
      }
    }
    charge(m, i - at + 1);
    return i >= limit ? pastBound(end, limit) : { destination: text.slice(at + 1, i), next: i + 1 };
  }
  let depth = 0;
  for (; i < limit; i += 1) {
    const code = text.charCodeAt(i);
    if (escapes(text, i, limit)) i += 1;
    else if (code === 40) {
      if (++depth > PAREN_DEPTH_MAX) {
        charge(m, i - at + 1);
        return null;
      }
    } else if (code === 41) {
      if (depth === 0) break;
      depth -= 1;
    } else if (code === 32 || isControl(code)) break;
  }
  charge(m, i - at + 1);
  if (i >= limit && limit < end) return UNKNOWN;
  return depth === 0 && i > at ? { destination: text.slice(at, i), next: i } : null;
}

// A title at `at` (its opening marker): `"…"`, `'…'` or `(…)`. The index after it.
function titleAt(text: string, at: number, limit: number, end: number, m: Meter): Scan<number> {
  const marker = text.charCodeAt(at);
  const close = marker === 40 ? 41 : marker;
  let i = at + 1;
  for (; i < limit; i += 1) {
    const code = text.charCodeAt(i);
    if (escapes(text, i, limit)) i += 1;
    else if (code === close) break;
    else if (marker === 40 && code === 40) {
      charge(m, i - at + 1);
      return null;
    }
  }
  charge(m, i - at + 1);
  return i >= limit ? pastBound(end, limit) : i + 1;
}
const isTitleMarker = (code: number) => code === 34 || code === 39 || code === 40;

// After the `(` of `](` at `open`: the inline resource its `)` closes, that is its destination and the index of the `)`.
function resourceAt(text: string, open: number, end: number, m: Meter): Scan<{ destination: string; end: number }> {
  const limit = Math.min(end, open + LINK_TAIL_MAX);
  let i = skipWhitespace(text, open, limit, m);
  if (i < 0) return null;
  if (i >= limit) return pastBound(end, limit);
  let destination = ''; // an empty destination: `[r]()`, a link to nothing
  if (text.charCodeAt(i) !== 41) {
    const angle = text.charCodeAt(i) === 60;
    const found = destinationAt(text, i, limit, end, m);
    if (found === null || found === UNKNOWN) return found;
    destination = found.destination;
    i = found.next;
    const after = text.charCodeAt(i);
    if (angle && i < limit && !isSpaceOrTab(after) && !isLineEnding(after) && after !== 41) return null;
    // an optional title, after whitespace; then whitespace and `)`
    const beforeTitle = i;
    i = skipWhitespace(text, i, limit, m);
    if (i < 0) return null;
    if (i >= limit) return pastBound(end, limit);
    if (i > beforeTitle && isTitleMarker(text.charCodeAt(i))) {
      const title = titleAt(text, i, limit, end, m);
      if (title === null || title === UNKNOWN) return title;
      i = skipWhitespace(text, title, limit, m);
      if (i < 0) return null;
      if (i >= limit) return pastBound(end, limit);
    }
  }
  return text.charCodeAt(i) === 41 ? { destination, end: i } : null;
}

// A link label from the `[` at `at`: no unescaped bracket inside, at most LABEL_MAX characters, not only whitespace.
// The index of its `]`, or -1.
function labelEnd(text: string, at: number, end: number, m: Meter): number {
  const limit = Math.min(end, at + 1 + LABEL_MAX + 1);
  let blank = true;
  let i = at + 1;
  let close = -1;
  for (; i < limit; i += 1) {
    const code = text.charCodeAt(i);
    if (escapes(text, i, limit)) {
      i += 1;
      blank = false;
    } else if (code === 93) {
      close = blank ? -1 : i;
      break;
    } else if (code === 91) break;
    else if (!isSpaceOrTab(code) && !isLineEnding(code)) blank = false;
  }
  charge(m, i - at + 1);
  return close;
}
// A label as references match it: whitespace collapsed, case folded. Its callers pass at most LABEL_MAX characters.
function labelKey(label: string, m: Meter): string {
  charge(m, 4 * label.length + 1);
  return label.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase();
}
// The click path of a link's destination (`clickPath`), its passes over the destination charged.
function pathOf(destination: string, m: Meter): string | null {
  charge(m, 16 * destination.length + 64);
  return clickPath(destination);
}

// A reference definition at `at` (a paragraph's `[`), CommonMark's: `[label]:`, whitespace with at most one line ending,
// a destination, and either a title after whitespace or nothing, with only spaces or tabs after it to its line's end.
// Its label and the index of the line ending (or the context's end) that ends it; null when none stands there. A
// definition whose destination, title or trailing whitespace runs past the bound is taken as one to the context's end:
// nothing in it is read.
function definitionAt(text: string, at: number, end: number, m: Meter): { label: string; end: number } | null {
  if (text.charCodeAt(at + 1) === 94) return null; // `[^…]:` is a footnote's definition, whose text is Markdown
  const close = labelEnd(text, at, end, m);
  if (close < 0 || text.charCodeAt(close + 1) !== 58) return null;
  const label = text.slice(at + 1, close);
  const limit = Math.min(end, close + 2 + LINK_TAIL_MAX);
  const i = skipWhitespace(text, close + 2, limit, m);
  if (i < 0 || i >= end) return null;
  if (i >= limit) return { label, end };
  const found = destinationAt(text, i, limit, end, m);
  if (found === UNKNOWN) return { label, end };
  if (found === null) return null;
  // the line ending after `from` when only spaces or tabs stand before it, -1 when something else does
  const lineEnded = (from: number): number | typeof UNKNOWN => {
    const e = skipBlank(text, from, limit, m);
    if (e >= limit && limit < end) return UNKNOWN;
    return e >= end || text.charCodeAt(e) === 10 ? e : -1;
  };
  const t = skipWhitespace(text, found.next, limit, m);
  if (t > found.next && t < limit && isTitleMarker(text.charCodeAt(t))) {
    const title = titleAt(text, t, limit, end, m);
    if (title === UNKNOWN) return { label, end };
    if (title !== null) {
      const after = lineEnded(title);
      if (after === UNKNOWN) return { label, end };
      if (after >= 0) return { label, end: after };
    }
  }
  const plain = lineEnded(found.next);
  if (plain === UNKNOWN) return { label, end };
  return plain >= 0 ? { label, end: plain } : null;
}

// One line's container prefix, as far as it decides a block: the quote's depth (`>` markers), whether the line opens a
// container (a list item's marker, a footnote's definition), and where its content begins after the prefix, with the
// columns of indentation before it (a tab counted as four), and whether that content is a thematic break.
interface Line {
  start: number;
  end: number;
  quote: number;
  opens: boolean;
  footnote: boolean; // the line opens a footnote's definition (`[^label]:`)
  content: number; // the first character after the prefix and the indentation
  indent: number;
  thematic: boolean; // the content, indented less than four columns, is a thematic break
}

// The longest tail of a line made of one thematic-break marker (`-`, `*`, `_`) and spaces, tabs or carriage returns:
// its marker (0 when it holds none), where it starts, and how many markers it holds. Read once per line, from its end;
// a thematic break at `j` is exactly a marker at `j`, in this tail, with three or more of them from `j` on.
function tailOf(text: string, start: number, end: number, m: Meter): { marker: number; from: number; count: number } {
  let marker = 0;
  let count = 0;
  let i = end;
  for (; i > start; i -= 1) {
    if (end - i >= LINE_TEST_MAX) refuseAfter(m, end - i);
    const code = text.charCodeAt(i - 1);
    if (isSpaceOrTab(code) || code === 13) continue;
    if (code !== marker && (marker !== 0 || (code !== 45 && code !== 42 && code !== 95))) break;
    marker = code;
    count += 1;
  }
  charge(m, end - i + 1);
  return { marker, from: i, count };
}

function lineAt(text: string, start: number, end: number, m: Meter): Line {
  let i = start;
  let quote = 0;
  let opens = false;
  let footnote = false;
  let markers = 0;
  // the thematic-break test, against the line's tail read once; the markers before `j` counted as `j` moves on
  let tail: { marker: number; from: number; count: number } | null = null;
  let seenTo = 0;
  let seen = 0;
  const breakAt = (j: number): boolean => {
    tail ??= tailOf(text, start, end, m);
    if (text.charCodeAt(j) !== tail.marker || j < tail.from) return false;
    if (seenTo < tail.from) seenTo = tail.from;
    const from = seenTo;
    for (; seenTo < j; seenTo += 1) if (text.charCodeAt(seenTo) === tail.marker) seen += 1;
    charge(m, seenTo - from + 1);
    return tail.count - seen >= 3;
  };
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
      if (++markers > BLOCK_MARKERS_MAX) refuseAfter(m, j - start + 16);
      quote += 1;
      i = j + 1;
      if (isSpaceOrTab(text.charCodeAt(i))) i += 1;
      continue;
    }
    let marker = -1; // the index after a list item's marker
    if (code === 43 || ((code === 45 || code === 42) && !breakAt(j))) marker = j + 1;
    else if (isDigit(code)) {
      let k = j;
      while (k < end && k - j < 9 && isDigit(text.charCodeAt(k))) k += 1;
      if (text.charCodeAt(k) === 46 || text.charCodeAt(k) === 41) marker = k + 1;
    } else if (code === 91 && text.charCodeAt(j + 1) === 94) {
      const close = labelEnd(text, j, end, m);
      if (close > 0 && text.charCodeAt(close + 1) === 58) marker = close + 2;
    }
    if (marker < 0 || (marker < end && !isSpaceOrTab(text.charCodeAt(marker)) && text.charCodeAt(marker) !== 13)) break;
    if (++markers > BLOCK_MARKERS_MAX) refuseAfter(m, marker - start + 16);
    opens = true;
    if (code === 91) footnote = true;
    // one to four spaces after the marker belong to it; past four, one does, and the rest is the content's indentation
    let spaces = 0;
    while (marker + spaces < end && spaces < 5 && isSpaceOrTab(text.charCodeAt(marker + spaces))) spaces += 1;
    i = marker + (spaces >= 5 ? 1 : spaces);
  }
  charge(m, i - start + 16); // the prefix, and what its last try read past it (at most an indentation, nine digits and a marker)
  const limit = lineLimit(i, end);
  let content = i;
  let indent = 0;
  while (content < limit && isSpaceOrTab(text.charCodeAt(content))) {
    indent += text.charCodeAt(content) === 9 ? 4 : 1;
    content += 1;
  }
  charge(m, content - i + 1);
  decided(content, limit, end);
  const first = text.charCodeAt(content);
  const thematic = indent < 4 && content < end && (first === 45 || first === 42 || first === 95) && breakAt(content);
  return { start, end, quote, opens, footnote, content, indent, thematic };
}

// After at most `max` of a quote's `>` markers at the start of a line: how many stood there, and the index after them.
function quoteMarkers(text: string, start: number, end: number, max: number, m: Meter): { count: number; at: number } {
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
  charge(m, at - start + 4); // the markers, and the spaces the last try read past them
  return { count, at };
}
function columnsBetween(text: string, from: number, to: number, m: Meter): number {
  let columns = 0;
  for (let i = from; i < to; i += 1) columns += text.charCodeAt(i) === 9 ? 4 : 1;
  charge(m, to - from + 1);
  return columns;
}

// A fence's opening at `at`: three or more backticks (whose info has none) or tildes, or two or more dollars (math).
function fenceAt(text: string, at: number, end: number, m: Meter): { marker: number; length: number } | null {
  const marker = text.charCodeAt(at);
  if (marker !== 96 && marker !== 126 && marker !== 36) return null;
  const limit = lineLimit(at, end);
  let i = at;
  while (i < limit && text.charCodeAt(i) === marker) i += 1;
  charge(m, i - at + 1);
  decided(i, limit, end);
  const length = i - at;
  if (length < (marker === 36 ? 2 : 3)) return null;
  if (marker !== 126) {
    let j = i;
    while (j < limit && text.charCodeAt(j) !== marker) j += 1;
    charge(m, j - i + 1);
    if (j < limit) return null;
    decided(j, limit, end);
  }
  return { marker, length };
}
function closesFence(text: string, at: number, end: number, fence: { marker: number; length: number }, m: Meter): boolean {
  const limit = lineLimit(at, end);
  let i = at;
  while (i < limit && text.charCodeAt(i) === fence.marker) i += 1;
  charge(m, i - at + 1);
  decided(i, limit, end);
  return i - at >= fence.length && blankFrom(text, i, end, m);
}
function headingAt(text: string, at: number, end: number, m: Meter): number {
  let i = at;
  while (i < end && i - at < 7 && text.charCodeAt(i) === 35) i += 1;
  charge(m, i - at + 1);
  const level = i - at;
  return level >= 1 && level <= 6 && (i >= end || isSpaceOrTab(text.charCodeAt(i)) || text.charCodeAt(i) === 13) ? i : -1;
}
function isSetextUnderline(text: string, at: number, end: number, m: Meter): boolean {
  const marker = text.charCodeAt(at);
  if (marker !== 61 && marker !== 45) return false;
  const limit = lineLimit(at, end);
  let i = at;
  while (i < limit && text.charCodeAt(i) === marker) i += 1;
  charge(m, i - at + 1);
  decided(i, limit, end);
  return blankFrom(text, i, end, m);
}
// The cells of a table row, [start, end) each: split at every unescaped `|`, the row's outer pipes dropped. A row longer
// than LINE_TEST_MAX refuses the text.
function cellsOf(text: string, at: number, end: number, m: Meter): [number, number][] {
  if (end - at > LINE_TEST_MAX) throw new ScanRefused();
  charge(m, 2 * (end - at) + 1);
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
  const blank = ([from, to]: [number, number]) => skipBlank(text, from, to, m) >= to;
  if (cells.length > 1 && blank(cells[0]!)) cells.shift();
  if (cells.length > 1 && blank(cells[cells.length - 1]!)) cells.pop();
  return cells;
}
// GFM's delimiter row, read in one pass (it was a regular expression whose whitespace runs overlapped): cells of
// `:?-+:?` between spaces or tabs, split by `|`, a leading and a trailing `|` optional, at least one `|` in the row, and
// only spaces, tabs or carriage returns after its last cell.
function isDelimiterRow(text: string, at: number, end: number, m: Meter): boolean {
  const limit = lineLimit(at, end);
  let i = at;
  let pipes = 0;
  let valid = false;
  const code = () => (i < limit ? text.charCodeAt(i) : -1);
  if (code() === 124) {
    i += 1;
    pipes += 1;
  }
  for (let first = true; ; first = false) {
    while (isSpaceOrTab(code())) i += 1;
    const cell = i;
    if (code() === 58) i += 1;
    const dashes = i;
    while (code() === 45) i += 1;
    if (i === dashes) {
      // no cell: the row ended at its trailing pipe, unless this was its first cell or a colon stands alone
      if (!first && i === cell) {
        while (isSpaceOrTab(code()) || code() === 13) i += 1;
        valid = i >= end;
      }
      break;
    }
    if (code() === 58) i += 1;
    while (isSpaceOrTab(code())) i += 1;
    if (code() === 124) {
      i += 1;
      pipes += 1;
      continue;
    }
    while (isSpaceOrTab(code()) || code() === 13) i += 1;
    valid = i >= end;
    break;
  }
  charge(m, i - at + 1);
  decided(i, limit, end);
  return valid && pipes > 0;
}
// A table's head: a row whose next line, in the same quote, is a delimiter row of as many cells.
const isTableHeader = (text: string, line: Line, below: Line, m: Meter) =>
  below.quote === line.quote && !below.opens && below.indent < 4 && isDelimiterRow(text, below.content, below.end, m) && cellsOf(text, below.content, below.end, m).length === cellsOf(text, line.content, line.end, m).length;

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
// cannot interrupt a paragraph, a table under a paragraph), it takes the side that reads fewer links. A refusal here
// (a cap, the budget) refuses the whole text: its definitions, which every context reads, are not all known.
function* blocksOf(text: string, contexts: Context[], defined: Set<string>, m: Meter): Generator<typeof PAUSE, void, void> {
  let fence: { marker: number; length: number; quote: number; column: number } | null = null;
  let paragraph: { lines: number[]; quote: number; end: number; dropped: boolean } | null = null;
  let table: { quote: number } | null = null;
  // A footnote's definition, from its line to a line indented less than four columns after a blank one: the window
  // draws it only where a call names it, so nothing in it is read as a link.
  let footnote = false;
  let afterBlank = false;
  let ahead: Line | null = null; // the next line, when the table test has read it
  function* lineFrom(start: number): Generator<typeof PAUSE, Line, void> {
    const end = yield* lineEndFrom(text, start, m);
    return lineAt(text, start, end, m);
  }
  function* closeParagraph(): Generator<typeof PAUSE, void, void> {
    if (paragraph === null) return;
    const { lines, end, dropped } = paragraph;
    paragraph = null;
    let at = lines[0]!;
    let k = 0;
    for (;;) {
      if (m.work >= m.pause) yield pauseAt(m);
      const definition = text.charCodeAt(at) === 91 ? definitionAt(text, at, end, m) : null;
      if (definition === null) break;
      defined.add(labelKey(definition.label, m));
      if (definition.end >= end) return; // to the context's end
      const from = k;
      while (k < lines.length && lines[k]! <= definition.end) k += 1;
      charge(m, k - from + 1);
      if (k >= lines.length) return;
      at = lines[k]!;
    }
    if (!dropped) contexts.push({ start: at, end });
  }
  const row = (line: Line) => {
    if (!footnote) for (const [start, end] of cellsOf(text, line.content, line.end, m)) contexts.push({ start, end });
  };
  for (let start = 0; start < text.length; ) {
    if (m.work >= m.pause) yield pauseAt(m);
    const line: Line = ahead !== null && ahead.start === start ? ahead : yield* lineFrom(start);
    ahead = null;
    const next: number = line.end + 1;
    const blank = blankFrom(text, line.content, line.end, m);
    if (line.footnote) footnote = true;
    else if (footnote && !blank && afterBlank && line.indent < 4) footnote = false;
    afterBlank = blank;
    if (fence !== null) {
      // Inside a fence a line is read for the fence's own quote markers and nothing else (a list marker there is code).
      // A quote that ends closes the fence. A closing fence stands at the opening's column, up to three more: one less
      // indented, in a list item, closes the item and opens a fence of its own, which this reads as the same code.
      const quoted = quoteMarkers(text, start, line.end, fence.quote, m);
      if (quoted.count < fence.quote) fence = null;
      else {
        const limit = lineLimit(quoted.at, line.end);
        let content = quoted.at;
        let indent = 0;
        while (content < limit && isSpaceOrTab(text.charCodeAt(content))) {
          indent += text.charCodeAt(content) === 9 ? 4 : 1;
          content += 1;
        }
        charge(m, content - quoted.at + 1);
        decided(content, limit, line.end);
        if (indent >= fence.column && indent <= fence.column + 3 && closesFence(text, content, line.end, fence, m)) fence = null;
        start = next;
        continue;
      }
    }
    if (blank) {
      yield* closeParagraph();
      table = null;
      start = next;
      continue;
    }
    const opened = line.indent < 4 ? fenceAt(text, line.content, line.end, m) : null;
    const heading = line.indent < 4 ? headingAt(text, line.content, line.end, m) : -1;
    const blockStarts = opened !== null || heading >= 0 || line.thematic;
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
      } else yield* closeParagraph(); // indented code
      start = next;
      continue;
    }
    if (opened !== null) {
      yield* closeParagraph();
      fence = { ...opened, quote: line.quote, column: columnsBetween(text, quoteMarkers(text, start, line.end, BLOCK_MARKERS_MAX, m).at, line.content, m) };
    } else if (heading >= 0) {
      yield* closeParagraph();
      if (!footnote) contexts.push({ start: heading, end: line.end });
    } else if (blockStarts || (paragraph !== null && !line.opens && isSetextUnderline(text, line.content, line.end, m))) {
      yield* closeParagraph();
    } else {
      if (m.work >= m.pause) yield pauseAt(m);
      ahead = next < text.length ? yield* lineFrom(next) : null;
      if (ahead !== null && isTableHeader(text, line, ahead, m)) {
        yield* closeParagraph();
        table = { quote: line.quote };
        row(line);
        start = ahead.end + 1; // the delimiter row holds no link
        ahead = null;
        continue;
      }
      if (paragraph === null || line.opens || line.quote > paragraph.quote) {
        yield* closeParagraph();
        paragraph = { lines: [line.content], quote: line.quote, end: line.end, dropped: footnote };
      } else {
        paragraph.lines.push(line.content);
        paragraph.end = line.end;
      }
    }
    start = next;
  }
  yield* closeParagraph();
}

// A context's runs of backticks and of dollars, indexed in one pass from the first one met (a code span's or inline
// math's closing run is looked up, not searched for): per marker, each run's start and end in order, and per marker and
// length the starts of the runs of exactly that length.
interface Runs {
  starts: Map<number, number[]>;
  ends: Map<number, number[]>;
  byLength: Map<number, Map<number, number[]>>;
}
function* runsOf(text: string, from: number, end: number, m: Meter): Generator<typeof PAUSE, Runs, void> {
  const runs: Runs = { starts: new Map([[96, []], [36, []]]), ends: new Map([[96, []], [36, []]]), byLength: new Map([[96, new Map()], [36, new Map()]]) };
  let run = -1; // the start of the run being read
  for (let i = from; ; i += 1) {
    const code = i < end ? text.charCodeAt(i) : -1;
    if (run >= 0 && code !== text.charCodeAt(run)) {
      const marker = text.charCodeAt(run);
      runs.starts.get(marker)!.push(run);
      runs.ends.get(marker)!.push(i);
      const lengths = runs.byLength.get(marker)!;
      const list = lengths.get(i - run);
      if (list === undefined) lengths.set(i - run, [run]);
      else list.push(run);
      run = -1;
    }
    if (i >= end) break;
    if (run < 0 && (code === 96 || code === 36)) run = i;
    charge(m, 1);
    if (m.work >= m.pause) yield pauseAt(m);
  }
  return runs;
}
// The index of the first of `sorted` at or after `at` (its length when none is), by bisection.
function firstFrom(sorted: readonly number[], at: number, m: Meter): number {
  let low = 0;
  let high = sorted.length;
  let steps = 1;
  for (; low < high; steps += 1) {
    const middle = (low + high) >>> 1;
    if (sorted[middle]! < at) low = middle + 1;
    else high = middle;
  }
  charge(m, steps);
  return low;
}

// After the `<` at `at`: the index after an autolink's `>` (CommonMark's URI or email autolink), null when none stands
// there, UNKNOWN when its candidate runs past LINK_TAIL_MAX. Every character of either form is above U+0020 and not `<`
// or `>`, so the one candidate ends at the first `>`, and the pattern is run on it alone.
// eslint-disable-next-line no-control-regex -- an autolink's URI holds no control character, as CommonMark's
const AUTOLINK = /^<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\x00-\x20<>]*|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>$/;
function autolinkEnd(text: string, at: number, end: number, m: Meter): Scan<number> {
  const limit = Math.min(end, at + LINK_TAIL_MAX);
  let i = at + 1;
  for (; i < limit; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 62 || code === 60 || code <= 32) break;
  }
  charge(m, 2 * (i - at) + 1);
  if (i >= limit) return pastBound(end, limit);
  return text.charCodeAt(i) === 62 && AUTOLINK.test(text.slice(at, i + 1)) ? i + 1 : null;
}
// GFM's literal autolinks start `http://`, `https://` or `www.` (any case).
function literalUrlAt(text: string, at: number, m: Meter): boolean {
  charge(m, 8);
  const head = text.slice(at, at + 8).toLowerCase();
  return head.startsWith('http://') || head.startsWith('https://') || head.startsWith('www.');
}
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
  for (const path of linkSteps(text)) if (typeof path === 'string') out.push(path);
  return out;
}

// The scan's work on `text` as its meter counts it (Decision Log 24's tests): the whole, and the most of it between two
// pauses, the start and the end counted as pauses.
export function linkWork(text: string): { work: number; longest: number } {
  const m = meterFor(text);
  let longest = 0;
  let last = 0;
  for (const step of linkSteps(text, m)) {
    if (step !== PAUSE) continue;
    longest = Math.max(longest, m.work - last);
    last = m.work;
  }
  return { work: m.work, longest: Math.max(longest, m.work - last) };
}

// What `linkPaths` reads, one bounded step at a time (the branch review's finding 2; Decision Log 24): each link met
// yields its click path, or null when it names none, and the scan yields PAUSE each time its meter has advanced
// SCAN_STEP_CHARS, so a caller can stop at the first path it wants and give the event loop back at every pause. A text
// refused (a cap, the budget) yields nothing more.
function* linkSteps(text: string, m: Meter = meterFor(text)): Generator<string | null | typeof PAUSE, void, void> {
  const contexts: Context[] = [];
  const defined = new Set<string>();
  try {
    yield* blocksOf(text, contexts, defined, m);
    for (const { start, end } of contexts) {
      // each context is a dispatch, an empty one too (a table's empty cells): charged, and a point to pause at
      charge(m, 1);
      if (m.work >= m.pause) yield pauseAt(m);
      yield* contextLinks(text, start, end, defined, m);
    }
  } catch (error) {
    if (!(error instanceof ScanRefused)) throw error;
  }
}

// The inline pass over one context. The bracket openers are a stack walked by no link: the link openers below
// `inactiveBelow` are the ones a link closed after them made inactive, and `images` counts the image openers open.
function* contextLinks(text: string, start: number, end: number, defined: ReadonlySet<string>, m: Meter): Generator<string | null | typeof PAUSE, void, void> {
  const opens: { at: number; image: boolean }[] = [];
  let inactiveBelow = 0;
  let images = 0;
  let runs: Runs | null = null;
  let url = false; // inside a literal URL, to the next whitespace or `<`: no link in it, and none around it
  const open = (at: number, image: boolean) => {
    if (opens.length >= OPENERS_MAX) throw new ScanRefused();
    opens.push({ at, image });
    if (image) images += 1;
  };
  for (let i = start; i < end; ) {
    charge(m, 1);
    if (m.work >= m.pause) yield pauseAt(m);
    const code = text.charCodeAt(i);
    if (url) {
      if (!isSpaceOrTab(code) && !isLineEnding(code) && code !== 60) {
        i += 1;
        continue;
      }
      url = false;
    }
    if (escapes(text, i, end)) {
      i += 2;
      continue;
    }
    if (code === 96 || code === 36) {
      // a code span, or inline math (two dollars or more): its run closed by the next run of the same length
      if (runs === null) runs = yield* runsOf(text, i, end, m);
      const k = runs.ends.get(code)![firstFrom(runs.starts.get(code)!, i + 1, m) - 1]!; // the end of the run that holds `i`
      const length = k - i; // after an escaped first marker, less than its run's
      let close = -1;
      const sameLength = code !== 36 || length >= 2 ? runs.byLength.get(code)!.get(length) : undefined;
      if (sameLength !== undefined) {
        const at = firstFrom(sameLength, k, m);
        if (at < sameLength.length) close = sameLength[at]!;
      }
      i = close >= 0 ? close + length : k;
      continue;
    }
    if (code === 60) {
      const autolink = autolinkEnd(text, i, end, m);
      if (autolink === UNKNOWN) {
        yield null; // past the bound: nothing more of this context is read
        break;
      }
      i = autolink ?? i + 1;
      continue;
    }
    if ((code === 104 || code === 72 || code === 119 || code === 87) && (i === start || !isAlphanumeric(text.charCodeAt(i - 1))) && literalUrlAt(text, i, m)) {
      opens.length = 0;
      inactiveBelow = 0;
      images = 0;
      url = true;
      i += 1;
      continue;
    }
    if (code === 33 && text.charCodeAt(i + 1) === 91) {
      open(i + 1, true);
      i += 2;
      continue;
    }
    if (code === 91) {
      open(i, false);
      i += 1;
      continue;
    }
    if (code !== 93) {
      i += 1;
      continue;
    }
    const opener = opens.pop();
    if (opener === undefined) {
      i += 1; // a literal `]`
      continue;
    }
    if (opener.image) images -= 1;
    const active = opener.image || opens.length >= inactiveBelow;
    inactiveBelow = Math.min(inactiveBelow, opens.length);
    if (!active) {
      i += 1;
      continue;
    }
    if (text.charCodeAt(i + 1) === 40) {
      const resource = resourceAt(text, i + 2, end, m);
      if (resource === UNKNOWN) {
        yield null; // past the bound: nothing more of this context is read
        break;
      }
      if (resource !== null) {
        if (opener.image) yield null;
        else {
          yield images > 0 ? null : pathOf(resource.destination, m); // inside an image's text: alt text
          inactiveBelow = opens.length;
        }
        i = resource.end + 1;
        continue;
      }
    }
    // a reference link: full (`[text][label]`), collapsed (`[text][]`) or shortcut (`[text]`), when its label is defined
    let after = i + 1;
    // a shortcut's key, unless a label follows; null when the text is too long to be a label
    let key = i - opener.at - 1 <= LABEL_MAX ? labelKey(text.slice(opener.at + 1, i), m) : null;
    if (text.charCodeAt(i + 1) === 91) {
      const close = text.charCodeAt(i + 2) === 93 ? i + 2 : labelEnd(text, i + 1, end, m);
      if (close > i + 2) key = labelKey(text.slice(i + 2, close), m);
      if (close > 0) after = close + 1;
    }
    // A text too long to read as a label is taken as a defined one whenever any label is: the window's parser matches a
    // reference's text whitespace-collapsed, at any length, and taking it as a link only names less.
    if (key === null ? defined.size > 0 : defined.has(key)) {
      yield null; // the window draws no path chip for a reference link
      if (!opener.image) inactiveBelow = opens.length;
      i = after;
      continue;
    }
    i += 1; // no link: a literal `]`, and its opener gone
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
// A name longer than this is taken as no MCP tool's (the pattern backtracks over a long one; an MCP tool's name is far
// shorter), so a result waiting for an MCP call of such a name names nothing: the refusal's side.
const TOOL_NAME_MAX = 1024;
export const isMcpTool = (toolName: string): boolean => toolName.length <= TOOL_NAME_MAX && MCP_TOOL.test(toolName);

// The paths of the anchored comments' tags in `text` (click source 4), as the window parses it (`userTextOf`,
// model/user-text.ts): the one comment's, or, for a message of several comments (UX wave U5a, whose bubble draws a chip
// for each), every comment's that has a path, in the order made.
export const anchorPaths = (text: string): string[] =>
  (readAnchoredMessage(text)?.comments ?? []).flatMap(({ anchor }) => (anchor.path === undefined ? [] : [anchor.path]));

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
// fix round 1, item 5) and one per step of `linkSteps`, each bounded, and the answer at the end; a step that is PAUSE
// is the scan's meter (Decision Log 24). `rowClaim` runs them at once; the daemon's search gives the event loop back
// at every PAUSE and every NAMED_CLAIM_STEPS steps.
type Steps<T> = Generator<typeof PAUSE | undefined, T, void>;

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
      yield found === PAUSE ? PAUSE : undefined;
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
  return (yield* linksTo(texts, path)) || (yield* anchorNames(texts.join('\n\n'), path));
}

// The anchor form's read of a person's message (UX wave U5a, docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md,
// Decision Log 54): the window reads it only when it holds a tag; the meter is charged for the reader's one pass over the
// text, as the link pass's loops are, and then a step and the path's compare for each comment read, at most
// MESSAGE_COMMENTS_MAX, since the reader reads no more.
function* anchorNames(text: string, path: string): Steps<boolean> {
  if (!text.includes('<maws_anchor')) return false;
  const m = meterFor(text);
  try {
    charge(m, text.length + 1);
    for (const { anchor } of readAnchoredMessage(text)?.comments ?? []) {
      yield;
      charge(m, (anchor.path?.length ?? 0) + 1);
      if (isThePath(anchor.path, path)) return true;
    }
  } catch (error) {
    if (error instanceof ScanRefused) return false;
    throw error;
  }
  return false;
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
