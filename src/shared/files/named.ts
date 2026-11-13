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

// The path a link with this destination asks for (click source 1): Markdown's backslash escapes resolved, remark's href,
// `decodeURI`, the line suffix off once, `.` and `..` collapsed. Null for a destination that is no path chip (a scheme in
// front, or empty) or that this reading does not recognise: a character reference, a letter or digit written as `%XX`
// (which is what lets the search pass a line over by its bytes, `needlesOf`), or an href `decodeURI` cannot read.
export function clickPath(destination: string): string | null {
  if (destination === '' || CHARACTER_REFERENCE.test(destination)) return null;
  const url = destination.replace(BACKSLASH_ESCAPE, '$1');
  if (SCHEME.test(url)) return null;
  for (const [, hex] of url.matchAll(PERCENT_ESCAPE)) if (asciiAlphanumeric(parseInt(hex, 16))) return null;
  let decoded: string;
  try {
    decoded = decodeURI(hrefOf(url));
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

// Whether the line that starts at `at` is blank (spaces or tabs, then a line ending or the end).
function blankLineAt(text: string, at: number): boolean {
  let i = at;
  while (i < text.length && isSpaceOrTab(text.charCodeAt(i))) i += 1;
  return i >= text.length || isLineEnding(text.charCodeAt(i));
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

// After the `(` of `](` at `open`: the destination of an inline link that its `)` closes, or null.
function destinationAt(text: string, open: number): string | null {
  const limit = Math.min(text.length, open + LINK_TAIL_MAX);
  let i = skipWhitespace(text, open);
  if (i < 0 || i >= limit) return null;
  let destination: string;
  if (text.charCodeAt(i) === 60) {
    // `<…>`: no line ending and no unescaped `<` or `>` inside; then whitespace or `)`
    const start = i + 1;
    for (i = start; i < limit; i += 1) {
      const code = text.charCodeAt(i);
      if (escapes(text, i, limit)) i += 1;
      else if (code === 62) break;
      else if (code === 60 || isLineEnding(code)) return null;
    }
    if (i >= limit) return null;
    destination = text.slice(start, i);
    i += 1;
    const after = text.charCodeAt(i);
    if (i < limit && !isSpaceOrTab(after) && !isLineEnding(after) && after !== 41) return null;
  } else {
    // a run with no space and no control character, whose unescaped parentheses balance
    const start = i;
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
    if (i >= limit || depth !== 0) return null;
    destination = text.slice(start, i);
  }
  // an optional title, after whitespace: `"…"`, `'…'` or `(…)`, with no blank line inside; then whitespace and `)`
  const beforeTitle = i;
  i = skipWhitespace(text, i);
  if (i < 0 || i >= limit) return null;
  const marker = text.charCodeAt(i);
  if (i > beforeTitle && (marker === 34 || marker === 39 || marker === 40)) {
    const close = marker === 40 ? 41 : marker;
    for (i += 1; i < limit; i += 1) {
      const code = text.charCodeAt(i);
      if (escapes(text, i, limit)) i += 1;
      else if (code === close) break;
      else if (marker === 40 && code === 40) return null;
      else if (isLineEnding(code) && blankLineAt(text, code === 13 && text.charCodeAt(i + 1) === 10 ? i + 2 : i + 1)) return null;
    }
    if (i >= limit) return null;
    i = skipWhitespace(text, i + 1);
    if (i < 0 || i >= limit) return null;
  }
  return text.charCodeAt(i) === 41 ? destination : null;
}

// The click path of every inline link the local check finds in `text`, in order. At each unescaped `]` followed by `(`:
// the `[` it closes (square brackets balance, escaped ones do not count, no blank line between) must not be escaped nor
// follow an unescaped `!` (an image); then the destination, an optional title, and `)`. No knowledge of the blocks
// around, so a link in a code fence or in inline code is found too (ruled).
export function linkPaths(text: string): string[] {
  const out: string[] = [];
  const opens: number[] = []; // each unescaped `[` not yet closed
  let lineHasContent = false;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 10) {
      if (!lineHasContent) opens.length = 0; // a blank line: nothing before it closes after it
      lineHasContent = false;
      continue;
    }
    if (!isSpaceOrTab(code) && code !== 13) lineHasContent = true;
    if (code === 91 && !isEscaped(text, i)) opens.push(i);
    else if (code === 93 && !isEscaped(text, i)) {
      const opener = opens.pop();
      if (opener === undefined || text.charCodeAt(i + 1) !== 40) continue;
      if (opener > 0 && text.charCodeAt(opener - 1) === 33 && !isEscaped(text, opener - 1)) continue; // an image
      const destination = destinationAt(text, i + 2);
      const path = destination === null ? null : clickPath(destination);
      if (path !== null) out.push(path);
    }
  }
  return out;
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
const blocks = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.map(record) : []);
const textsOf = (content: unknown): string[] => (typeof content === 'string' ? [content] : blocks(content).flatMap((block) => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])));
const linksTo = (texts: readonly string[], path: string) => texts.some((text) => text.includes('](') && linkPaths(text).includes(path));
const isThePath = (value: unknown, path: string) => typeof value === 'string' && normalizeLexically(value) === path;

// Whether any string of a value, at any depth (a tool's input), passes `test`; walked without recursion.
function anyString(value: unknown, test: (text: string) => boolean): boolean {
  const stack = [value];
  while (stack.length > 0) {
    const next = stack.pop();
    if (typeof next === 'string') {
      if (test(next)) return true;
    } else if (next !== null && typeof next === 'object') for (const child of Object.values(next)) stack.push(child);
  }
  return false;
}

// A person's message names the path by a link in its text, or by its anchored comment's tag; the window joins the text
// blocks this way before it reads the tag (`userTextOf`, model/user-text.ts).
function personNames(content: unknown, path: string): boolean {
  const texts = textsOf(content);
  return linksTo(texts, path) || isThePath(anchorPath(texts.join('\n\n')), path);
}

// Whether a record names `path` (Interfaces §A, the table of `rowClaim`), or which calls a result form of it waits for.
export function rowClaim(row: unknown, path: string): RowClaim {
  const fields = record(row);
  switch (fields.type) {
    case 'assistant': {
      for (const block of blocks(record(fields.message).content)) {
        if (block.type === 'text' && linksTo([str(block.text)], path)) return { names: true };
        if (block.type === 'tool_use' && (isThePath(chipPath(str(block.name), block.input), path) || anyString(block.input, (text) => linksTo([text], path)))) return { names: true };
      }
      return NOTHING;
    }
    case 'user': {
      if (fields.isMeta === true || fields.isCompactSummary === true) return NOTHING; // the window draws no bubble for these
      const content = record(fields.message).content;
      if (personNames(content, path)) return { names: true };
      const edited = isThePath(record(fields.toolUseResult).filePath, path);
      const pending: PendingCall[] = [];
      for (const block of blocks(content)) {
        if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
        if (linksTo(textsOf(block.content), path)) pending.push({ toolUseId: block.tool_use_id, when: 'mcp' });
        if (edited) pending.push({ toolUseId: block.tool_use_id, when: 'edit' });
      }
      return pending.length > 0 ? { names: false, pending } : NOTHING;
    }
    case 'attachment': {
      // a person's message the engine took into a running turn (`humanQueuedPrompt`, src/engine-host/fs/backfill.ts)
      const attachment = record(fields.attachment);
      const human = attachment.type === 'queued_command' && record(attachment.origin).kind === 'human' && attachment.commandMode === 'prompt' && attachment.isMeta !== true;
      if (!human || typeof attachment.source_uuid !== 'string' || attachment.source_uuid === '') return NOTHING;
      return personNames(attachment.prompt, path) ? { names: true } : NOTHING;
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
  const block = blocks(record(fields.message).content).find((candidate) => candidate.type === 'tool_use' && candidate.id === toolUseId);
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
