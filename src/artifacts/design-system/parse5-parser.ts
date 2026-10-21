// The canon check's HTML parser where no DOM is (the engine host): parse5, which builds the HTML spec's tree as the
// renderer's `DOMParser` does, read as the DOM nodes `canon.ts` reads (`DomNodeLike`). So the host refuses what the
// page's Check flags, by the same tree: the head and body split, implied elements, a template's contents outside its
// children, attributes by their qualified names. P4, the tracker row of 2026-10-14. One known gap: parse5 7 parses inside
// a `<select>` as the spec once did (dropping tags, closing it at a `<textarea>`), Chromium as the spec does now, so the
// trees part both ways there; a file holding a `<select>` tag is left to the page (`buildsPageTree`).
import { html as spec, parse, type DefaultTreeAdapterMap } from 'parse5';
import type { DomNodeLike, HtmlParser } from './canon';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];

const EMPTY: readonly DomNodeLike[] = [];
// A `<select` start tag anywhere in the source, as the tokenizer would end its name; a comment or an attribute naming
// one counts too, which only leaves more to the page.
const SELECT_TAG = /<select[\s/>]/i;

function domNode(node: Node): DomNodeLike | null {
  if (node.nodeName === '#text') return { nodeType: 3, nodeName: '#text', nodeValue: (node as DefaultTreeAdapterMap['textNode']).value, childNodes: EMPTY };
  if (node.nodeName === '#comment') return { nodeType: 8, nodeName: '#comment', nodeValue: (node as DefaultTreeAdapterMap['commentNode']).data, childNodes: EMPTY };
  if (!('tagName' in node)) return null; // a doctype: never under the head or the body
  return {
    nodeType: 1,
    // as the DOM names it: an HTML element upper-cased, a foreign one (svg, math) as the parser adjusted it
    nodeName: node.namespaceURI === spec.NS.HTML ? node.tagName.toUpperCase() : node.tagName,
    nodeValue: null,
    // a template's children are its `content`, as in the DOM, so they are not among its childNodes
    childNodes: children(node),
    attributes: node.attrs.map((attr) => ({ name: attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name, value: attr.value })),
  };
}

const children = (node: Element): DomNodeLike[] => node.childNodes.flatMap((child) => domNode(child) ?? []);

/**
 * parse5 as `DOMParser.parseFromString(source, 'text/html')`: the document parsed with scripting disabled (a
 * `DOMParser` document has no browsing context, so `<noscript>` holds markup), its head the html element's first
 * `<head>`, its body the first `<body>` or `<frameset>`.
 */
export const parse5Parser: HtmlParser = {
  parseFromString(source) {
    const html = parse(source, { scriptingEnabled: false }).childNodes.find((node): node is Element => node.nodeName === 'html');
    const first = (names: readonly string[]) => {
      const found = html?.childNodes.find((node): node is Element => names.includes(node.nodeName));
      return found ? domNode(found) : null;
    };
    return { head: first(['head']), body: first(['body', 'frameset']) };
  },
  buildsPageTree: (source) => !SELECT_TAG.test(source),
};
