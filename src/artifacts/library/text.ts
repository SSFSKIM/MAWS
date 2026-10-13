// The library's text extractor (the P3-L document, Decision Log 3): what the owner's search finds in an artifact. One
// generic extractor, so no kind registers one and B, C, D and E owe nothing. Portable (§4.10): the engine host runs it
// on `library.text`, and nothing here needs Node.
//
// - A Y.Doc's text is every text reached from its root types: a node's text runs (one text, whatever its formatting),
//   the nodes among its children, in order, and its node-valued attributes (a deck's `notes`, an element map's
//   entries), depth-first. Roots and attributes have no order of their own, so they are taken by name and the same
//   state always gives the same text. Plain attribute values (ids, styles, JSON) and embedded values are properties,
//   not text, so they are not searched. One text per line.
// - An html page's text is its markup without scripts, styles, comments and tags, entities decoded, whitespace
//   collapsed.
// - A file's text is its content when it is UTF-8 text of at most FILE_TEXT_MAX_BYTES, else its name.
//
// Every text is capped at TEXT_MAX_BYTES of UTF-8.
import type { Doc, Node } from '@artifacts/yjs';
import type { DocKind } from '@shared/artifacts/entity';

export const TEXT_MAX_BYTES = 256 * 1024;
export const FILE_TEXT_MAX_BYTES = 1024 * 1024;

// What the host read for an artifact: a document kind's doc, an html page's bytes, a file's name and its bytes (null
// when it was too large to read, or could not be).
export type TextSource = { kind: DocKind; doc: Doc } | { kind: 'html'; bytes: Uint8Array } | { kind: 'file'; name: string; bytes: Uint8Array | null };

export function extractText(source: TextSource): string {
  switch (source.kind) {
    case 'html':
      return capped(htmlText(new TextDecoder().decode(source.bytes)));
    case 'file':
      return capped(fileText(source.name, source.bytes));
    default:
      return capped(docText(source.doc));
  }
}

// ---- Y.Doc ---------------------------------------------------------------------------------------------------------

// The binding module exports `Node` as a type only (Decision Log 25 keeps `@y/y` imports in it), so a node is told from
// an attribute's or an embed's value by its shape: decoded values are JSON, bytes or a node, and only a node has methods.
function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as Node).toArray === 'function' && typeof (value as Node).attrEntries === 'function';
}

const byName = <T>(entries: Iterable<[string, T]>): T[] => [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, value]) => value);

function docText(doc: Doc): string {
  const lines: string[] = [];
  let budget = TEXT_MAX_BYTES; // characters; enough to stop the walk early, `capped` trims to bytes
  const push = (text: string) => {
    if (text.trim() === '') return;
    lines.push(text);
    budget -= text.length + 1;
  };
  const walk = (node: Node) => {
    let run = '';
    for (const child of node.toArray() as unknown[]) {
      if (budget <= 0) return;
      if (typeof child === 'string') {
        run += child;
        continue;
      }
      push(run);
      run = '';
      if (isNode(child)) walk(child);
    }
    push(run);
    for (const value of byName(node.attrEntries() as Iterable<[string, unknown]>)) {
      if (budget <= 0) return;
      if (isNode(value)) walk(value);
    }
  };
  for (const root of byName(doc.share.entries() as Iterable<[string, unknown]>)) if (isNode(root) && budget > 0) walk(root);
  return lines.join('\n');
}

// ---- html ----------------------------------------------------------------------------------------------------------

// A comment or a script or style element, whichever opens first, so a `<script>` inside a comment is the comment's
// and a `<!--` inside a script is the script's; an unclosed one runs to the end, as a browser reads it.
const COMMENT_OR_RAW_TEXT = /<!--[\s\S]*?(?:-->|$)|<(script|style)\b[\s\S]*?(?:<\/\1\s*>|$)/gi;
const DECLARATION = /<[!?][^>]*>/g; // doctype, CDATA's opener, processing instructions
const TAG = /<\/?[a-zA-Z](?:[^>"']|"[^"]*"|'[^']*')*>/g; // an attribute value may hold a `>`

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', middot: '·', bull: '•', deg: '°', times: '×', divide: '÷',
  euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', para: '¶', eacute: 'é', egrave: 'è', agrave: 'à', aacute: 'á', ccedil: 'ç',
  ouml: 'ö', uuml: 'ü', auml: 'ä', szlig: 'ß', ntilde: 'ñ', larr: '←', rarr: '→', uarr: '↑', darr: '↓', check: '✓',
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));/g, (entity, decimal: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (name !== undefined) return NAMED[name] ?? entity;
    const code = decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex!, 16);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '�';
  });
}

function htmlText(markup: string): string {
  const stripped = markup.replace(COMMENT_OR_RAW_TEXT, ' ').replace(DECLARATION, ' ').replace(TAG, ' ');
  return decodeEntities(stripped).replace(/\s+/g, ' ').trim();
}

// ---- file ----------------------------------------------------------------------------------------------------------

function fileText(name: string, bytes: Uint8Array | null): string {
  if (bytes === null || bytes.length > FILE_TEXT_MAX_BYTES) return name;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return name; // not UTF-8
  }
  return text.includes('\u0000') ? name : text; // a NUL is binary, whatever else decodes
}

// ---- the cap -------------------------------------------------------------------------------------------------------

// The longest prefix of `text` whose UTF-8 is at most TEXT_MAX_BYTES; `encodeInto` stops before a character that would
// not fit whole.
function capped(text: string): string {
  if (text.length * 3 <= TEXT_MAX_BYTES) return text;
  const { read } = new TextEncoder().encodeInto(text, new Uint8Array(TEXT_MAX_BYTES));
  return text.slice(0, read);
}
