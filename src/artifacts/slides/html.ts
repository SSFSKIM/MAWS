// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D1 and Decision Log 2), from S6's
// `spikes/p3-store/s6/src/parse5-adapter.ts`. The dialect's one HTML front end: parse5's spec-conformant fragment
// parsing, the same in the engine host and the renderer, so a slide never loads differently in the two processes
// (S6 kept a DOM adapter beside it only to prove either works). The loader (parse.ts) reads the `RawNode` tree.
import { parseFragment, serialize, Tokenizer, type DefaultTreeAdapterMap } from 'parse5';

export type RawNode =
  | { kind: 'element'; tag: string; attrs: [string, string][]; children: RawNode[]; inner: () => string }
  | { kind: 'text'; value: string }
  | { kind: 'comment' };
export type RawElement = Extract<RawNode, { kind: 'element' }>;

type P5Node = DefaultTreeAdapterMap['childNode'];

function convert(n: P5Node): RawNode {
  if (n.nodeName === '#text') return { kind: 'text', value: (n as DefaultTreeAdapterMap['textNode']).value };
  if (n.nodeName === '#comment' || n.nodeName === '#documentType') return { kind: 'comment' };
  const el = n as DefaultTreeAdapterMap['element'];
  const host = el.nodeName === 'template' ? (el as DefaultTreeAdapterMap['template']).content : el;
  return {
    kind: 'element',
    tag: el.tagName.toLowerCase(),
    attrs: el.attrs.map((a) => [a.prefix ? `${a.prefix}:${a.name}` : a.name, a.value] as [string, string]),
    children: host.childNodes.map(convert),
    inner: () => serialize(host),
  };
}

/** Document markup a slide file never holds (parent §4.5); parse5's fragment parse would drop html, head and body silently. */
const OUTER_TAGS = new Set(['html', 'head', 'body', 'title', 'link', 'style', 'script', 'meta']);
const noop = () => {};

/**
 * The document markup a slide file carries outside an `<svg>` (whose own `<title>` and `<style>` are its business) and
 * an `<x-embed>` (a whole small page): read from parse5's tokenizer, before the tree builder repairs it away.
 */
export function outerMarkup(html: string): string[] {
  const found = new Set<string>();
  let svg = 0;
  let embed = 0;
  const tokenizer = new Tokenizer(
    { sourceCodeLocationInfo: false },
    {
      onStartTag: (t) => {
        if (t.tagName === 'x-embed' && !t.selfClosing) embed++;
        else if (embed === 0 && t.tagName === 'svg' && !t.selfClosing) svg++;
        else if (embed === 0 && svg === 0 && OUTER_TAGS.has(t.tagName)) found.add(`<${t.tagName}>`);
      },
      onEndTag: (t) => {
        if (t.tagName === 'x-embed') embed = Math.max(0, embed - 1);
        else if (embed === 0 && t.tagName === 'svg') svg = Math.max(0, svg - 1);
        else if (embed === 0 && svg === 0 && OUTER_TAGS.has(t.tagName)) found.add(`<${t.tagName}>`);
      },
      onDoctype: () => {
        if (embed === 0 && svg === 0) found.add('<!DOCTYPE>');
      },
      onComment: noop,
      onEof: noop,
      onCharacter: noop,
      onNullCharacter: noop,
      onWhitespaceCharacter: noop,
    },
  );
  tokenizer.write(html, true);
  return [...found];
}

/** A slide file's markup as a node tree, parsed in fragment context. */
export function parseHtml(html: string): RawNode[] {
  return parseFragment(html).childNodes.map(convert);
}
