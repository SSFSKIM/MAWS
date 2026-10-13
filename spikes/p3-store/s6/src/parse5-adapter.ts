// The host's adapter: parse5 (spec-conformant HTML fragment parsing) → RawNode. The renderer uses dom-adapter.ts.
import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5'
import type { RawNode } from './parse.ts'

type P5Node = DefaultTreeAdapterMap['childNode']

function convert(n: P5Node): RawNode {
  if (n.nodeName === '#text') return { kind: 'text', value: (n as DefaultTreeAdapterMap['textNode']).value }
  if (n.nodeName === '#comment' || n.nodeName === '#documentType') return { kind: 'comment' }
  const el = n as DefaultTreeAdapterMap['element']
  const host = el.nodeName === 'template' ? (el as DefaultTreeAdapterMap['template']).content : el
  return {
    kind: 'element', tag: el.tagName.toLowerCase(),
    attrs: el.attrs.map((a) => [a.name, a.value] as [string, string]),
    children: host.childNodes.map(convert),
    inner: () => serialize(host),
  }
}

export function parseHtml(html: string): RawNode[] { return parseFragment(html).childNodes.map(convert) }
