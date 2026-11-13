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

const isEscaped = (text: string, at: number) => {
  let slashes = 0;
  for (let i = at - 1; i >= 0 && text.charCodeAt(i) === 92; i -= 1) slashes += 1;
  return slashes % 2 === 1;
};
const isSpaceOrTab = (code: number) => code === 32 || code === 9;
const isLineEnding = (code: number) => code === 10 || code === 13;
const isControl = (code: number) => code < 32 || code === 127;
const escapes = (text: string, at: number, limit: number) => text.charCodeAt(at) === 92 && at + 1 < limit && ASCII_PUNCTUATION.test(text[at + 1]!);
// What may stand before a reference definition's `[` on its line: indentation and the markers of a quote or a list item.
const isLinePrefix = (code: number) => isSpaceOrTab(code) || code === 13 || code === 62 || code === 45 || code === 43 || code === 42 || code === 46 || code === 41 || (code >= 48 && code <= 57);

// Whether the line that starts at `at` is blank (spaces or tabs, then a line ending or the end).
function blankLineAt(text: string, at: number): boolean {
  let i = at;
  while (i < text.length && isSpaceOrTab(text.charCodeAt(i))) i += 1;
  return i >= text.length || isLineEnding(text.charCodeAt(i));
}

// The first newline at or after `at` that a blank line follows, or the text's end: no link's resource runs past it.
function blankLineAfter(text: string, at: number): number {
  for (let i = text.indexOf('\n', at); i !== -1; i = text.indexOf('\n', i + 1)) if (blankLineAt(text, i + 1)) return i;
  return text.length;
}

// From `at`, spaces or tabs and at most one line ending (a blank line ends the paragraph): the index after them, or -1.
function skipWhitespace(text: string, at: number): number {
  let i = at;
  while (i < text.length && isSpaceOrTab(text.charCodeAt(i))) i += 1;
  if (i < text.length && isLineEnding(text.charCodeAt(i))) {
    i += text.charCodeAt(i) === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1;
    if (blankLineAt(text, i)) return -1;
    while (isSpaceOrTab(text.charCodeAt(i))) i += 1;
  }
  return i;
}

// A scan that reached `LINK_TAIL_MAX` before it could tell: whether a resource stands there, and where it ends, is not
// known, so nothing up to the next blank line is read as a link.
const UNKNOWN = Symbol('past the bound');
type Scan<T> = T | null | typeof UNKNOWN;
const pastBound = (text: string, limit: number): null | typeof UNKNOWN => (limit < text.length ? UNKNOWN : null);

// A destination at `at`: `<…>` with no line ending and no unescaped `<` or `>` inside, or a run with no space and no
// control character whose unescaped parentheses balance. `next` is the index after it.
function destinationAt(text: string, at: number, limit: number): Scan<{ destination: string; next: number }> {
  let i = at;
  if (text.charCodeAt(i) === 60) {
    for (i += 1; i < limit; i += 1) {
      const code = text.charCodeAt(i);
      if (escapes(text, i, limit)) i += 1;
      else if (code === 62) break;
      else if (code === 60 || isLineEnding(code)) return null;
    }
    return i >= limit ? pastBound(text, limit) : { destination: text.slice(at + 1, i), next: i + 1 };
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
  if (i >= limit && limit < text.length) return UNKNOWN;
  return depth === 0 ? { destination: text.slice(at, i), next: i } : null; // the text's end also ends a run (a definition's)
}

// A title at `at` (its opening marker): `"…"`, `'…'` or `(…)`, with no blank line inside. The index after it.
function titleAt(text: string, at: number, limit: number): Scan<number> {
  const marker = text.charCodeAt(at);
  const close = marker === 40 ? 41 : marker;
  let i = at + 1;
  for (; i < limit; i += 1) {
    const code = text.charCodeAt(i);
    if (escapes(text, i, limit)) i += 1;
    else if (code === close) break;
    else if (marker === 40 && code === 40) return null;
    else if (isLineEnding(code) && blankLineAt(text, code === 13 && text.charCodeAt(i + 1) === 10 ? i + 2 : i + 1)) return null;
  }
  return i >= limit ? pastBound(text, limit) : i + 1;
}
const isTitleMarker = (code: number) => code === 34 || code === 39 || code === 40;

// After the `(` of `](` at `open`: the inline resource its `)` closes, that is its destination and the index of the `)`.
function resourceAt(text: string, open: number): Scan<{ destination: string; end: number }> {
  const limit = Math.min(text.length, open + LINK_TAIL_MAX);
  let i = skipWhitespace(text, open);
  if (i < 0) return null;
  if (i >= limit) return pastBound(text, limit);
  const angle = text.charCodeAt(i) === 60;
  const found = destinationAt(text, i, limit);
  if (found === null || found === UNKNOWN) return found;
  i = found.next;
  const after = text.charCodeAt(i);
  if (angle && i < limit && !isSpaceOrTab(after) && !isLineEnding(after) && after !== 41) return null;
  // an optional title, after whitespace; then whitespace and `)`
  const beforeTitle = i;
  i = skipWhitespace(text, i);
  if (i < 0) return null;
  if (i >= limit) return pastBound(text, limit);
  if (i > beforeTitle && isTitleMarker(text.charCodeAt(i))) {
    const title = titleAt(text, i, limit);
    if (title === null || title === UNKNOWN) return title;
    i = skipWhitespace(text, title);
    if (i < 0) return null;
    if (i >= limit) return pastBound(text, limit);
  }
  return text.charCodeAt(i) === 41 ? { destination: found.destination, end: i } : null;
}

// After the `:` of a reference definition's label at `colon`: the index of the last character of its destination, and
// of its title when one follows; -1 when no destination does. Neither is a link, and the window draws neither. The
// definition's validity is not judged (what may follow it on the line): passing over too much fails towards the refusal.
function definitionEnd(text: string, colon: number): number | typeof UNKNOWN {
  const limit = Math.min(text.length, colon + 1 + LINK_TAIL_MAX);
  const i = skipWhitespace(text, colon + 1);
  if (i < 0) return -1;
  if (i >= limit) return pastBound(text, limit) ?? -1;
  const found = destinationAt(text, i, limit);
  if (found === UNKNOWN) return UNKNOWN;
  if (found === null) return -1;
  const t = skipWhitespace(text, found.next);
  if (t > found.next && t < limit && isTitleMarker(text.charCodeAt(t))) {
    const title = titleAt(text, t, limit);
    if (title === UNKNOWN) return UNKNOWN;
    if (title !== null) return title - 1;
  }
  return found.next - 1;
}

// The click path of every inline link the local check finds in `text`, in order. At each unescaped `]` followed by `(`:
// the `[` it closes (square brackets balance, escaped ones do not count, no blank line between) must not be escaped nor
// follow an unescaped `!` (an image); then the destination, an optional title, and `)`. A link's or an image's resource
// is read once and the scan goes on after it, and a reference definition's destination and title (a `[` that only
// indentation or a quote's or a list's marker precede on its line, closed by `]:`; not a footnote's `[^`) are passed
// over: text shaped like a link inside any of them is no link (the branch review's finding 1). No knowledge of the
// blocks around, so a link in a code fence or in inline code is found too (ruled).
export function linkPaths(text: string): string[] {
  const out: string[] = [];
  for (const path of linkSteps(text)) if (path !== null) out.push(path);
  return out;
}

// What `linkPaths` reads, one bounded step at a time (the branch review's finding 2): each link or definition met
// yields its click path, or null when it names none, and the scan yields null after every `SCAN_STEP_CHARS` of text, so a
// caller can stop at the first path it wants and give the event loop back between steps.
const SCAN_STEP_CHARS = 64 * 1024;
function* linkSteps(text: string): Generator<string | null, void, void> {
  let pause = SCAN_STEP_CHARS;
  const opens: { at: number; leads: boolean }[] = []; // each unescaped `[` not yet closed, and whether it leads its line
  let lineHasContent = false;
  let prefixOnly = true; // nothing but a line prefix so far on this line
  for (let i = 0; i < text.length; i += 1) {
    if (i >= pause) {
      pause = i + SCAN_STEP_CHARS;
      yield null;
    }
    const code = text.charCodeAt(i);
    if (code === 10) {
      if (!lineHasContent) opens.length = 0; // a blank line: nothing before it closes after it
      lineHasContent = false;
      prefixOnly = true;
      continue;
    }
    if (!isSpaceOrTab(code) && code !== 13) lineHasContent = true;
    const leads = prefixOnly;
    if (!isLinePrefix(code)) prefixOnly = false;
    if (code === 91 && !isEscaped(text, i)) opens.push({ at: i, leads });
    else if (code === 93 && !isEscaped(text, i)) {
      const opener = opens.pop();
      if (opener === undefined) continue;
      const after = text.charCodeAt(i + 1);
      let end: number;
      if (after === 40) {
        const resource = resourceAt(text, i + 2);
        if (resource === null) continue; // no resource: what follows the `(` is text
        if (resource === UNKNOWN) end = blankLineAfter(text, i + 2) - 1;
        else {
          end = resource.end;
          const image = opener.at > 0 && text.charCodeAt(opener.at - 1) === 33 && !isEscaped(text, opener.at - 1);
          yield image ? null : clickPath(resource.destination);
        }
      } else if (after === 58 && opener.leads && text.charCodeAt(opener.at + 1) !== 94) {
        const definition = definitionEnd(text, i + 1);
        if (definition !== UNKNOWN && definition < 0) continue;
        end = definition === UNKNOWN ? blankLineAfter(text, i + 2) - 1 : definition;
        yield null;
      } else continue;
      i = end; // what the resource or the definition holds is not read again
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
