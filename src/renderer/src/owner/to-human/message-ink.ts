// Presentation only: closed output tags are transparent, not a report grammar. The shared owner parser still
// extracts attention and summary marks independently. Keep one Markdown tree so inline tags cannot split a list,
// paragraph, or emphasis; code is literal and an unfinished message is never repaired.
import type { Element, Root, RootContent } from 'hast';
import type { Plugin } from 'unified';
import { codeRegions, insideCode } from '@shared/owner/to-human-parser';
import { isOutputTag, outputTagPattern, sourceTags } from './source-tags';

type Token = { close: boolean; name: string };
const tokenOf = (tag: string): Token => ({ close: tag.startsWith('</'), name: tag.replace(/^<\/?|(?: recommended)?>$/g, '') });
function paired<T extends Token>(tokens: T[]): Set<T> {
  const stack: T[] = [];
  const pairs = new Set<T>();
  for (const token of tokens) {
    if (!token.close) stack.push(token);
    else if (stack.at(-1)?.name === token.name) {
      pairs.add(stack.pop()!);
      pairs.add(token);
    } else stack.length = 0;
  }
  return pairs;
}

export function hasClosedMarks(text: string): boolean {
  const inCode = insideCode(codeRegions(text));
  const tokens = [...text.matchAll(outputTagPattern())].filter((tag) => {
    let backslashes = 0;
    for (let at = tag.index - 1; at >= 0 && text[at] === '\\'; at--) backslashes++;
    return !inCode(tag.index) && backslashes % 2 === 0;
  });
  return paired(tokens.map((tag) => tokenOf(tag[0]))).size > 0;
}

const ink = (value: string): Element => ({ type: 'element', tagName: 'span', properties: { className: ['owner-message-ink'] }, children: [{ type: 'text', value }] });

// Only the source tokenizer's span has an exact tag range. Never rescan decoded text: an entity or backslash-escaped
// example can have the same displayed characters without having been an output tag in the source.
const decorate: Plugin<[], Root> = () => (tree, file) => {
  const source = String(file.value);
  const tokens: (Token & { node: Element })[] = [];
  const collect = (node: Root | RootContent) => {
    if (node.type === 'element' && node.tagName === 'span' && node.position) {
      const text = source.slice(node.position.start.offset, node.position.end.offset);
      if (isOutputTag(text)) { tokens.push({ ...tokenOf(text), node }); return; }
    }
    if ('children' in node) for (const child of node.children) collect(child);
  };
  collect(tree);
  const byNode = new Map([...paired(tokens)].map((token) => [token.node, token]));
  const open: string[] = [];
  let removed = 0;
  const transform = (node: RootContent): RootContent[] => {
    if (node.type === 'text') return [node.value && ['message', 'to-human'].includes(open.at(-1) ?? '') ? ink(node.value) : node];
    if (node.type === 'element') {
      const token = byNode.get(node);
      if (token) {
        if (token.close) open.pop();
        else open.push(token.name);
        removed++;
        return [];
      }
      const before = removed;
      // Code keeps its own syntax styling and literal tags, even inside a message.
      if (node.tagName !== 'code' && node.tagName !== 'pre') node.children = node.children.flatMap(transform) as Element['children'];
      if (node.tagName === 'p' && before !== removed && node.children.every((child) => (child.type === 'text' && !child.value.trim()) || (child.type === 'element' && child.tagName === 'br'))) return [];
    }
    return [node];
  };
  tree.children = tree.children.flatMap(transform);
};

export const messageInk = { source: sourceTags, decorate };
