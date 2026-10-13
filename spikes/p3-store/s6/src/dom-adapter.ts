// The renderer's adapter: a DOM tree (DOMParser / <template>) → RawNode. Same loader, same IR as the host's parse5 path.
import type { RawNode } from './parse.ts'

interface DomLike { nodeType: number; nodeName: string; nodeValue: string | null; childNodes: ArrayLike<DomLike> }
interface ElLike extends DomLike { tagName: string; attributes: ArrayLike<{ name: string; value: string }>; innerHTML: string; content?: DomLike }

export function fromDom(n: DomLike): RawNode {
  if (n.nodeType === 3) return { kind: 'text', value: n.nodeValue ?? '' }
  if (n.nodeType !== 1) return { kind: 'comment' }
  const el = n as ElLike
  const host = el.tagName.toLowerCase() === 'template' && el.content ? el.content : el
  return {
    kind: 'element', tag: el.tagName.toLowerCase(),
    attrs: Array.from(el.attributes, (a) => [a.name, a.value] as [string, string]),
    children: Array.from(host.childNodes, fromDom),
    inner: () => el.innerHTML,
  }
}

/** Parse a slide file in a document (renderer): a <template> parses in fragment context like parse5's parseFragment. */
export function parseHtmlDom(doc: { createElement(t: 'template'): { innerHTML: string; content: DomLike } }, html: string): RawNode[] {
  const t = doc.createElement('template'); t.innerHTML = html
  return Array.from(t.content.childNodes, fromDom)
}
