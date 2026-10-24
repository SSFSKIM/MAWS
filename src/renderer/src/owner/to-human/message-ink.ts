// Presentation only: closed output tags are transparent, not a report grammar. The shared owner parser still
// extracts attention and summary marks independently. Keep one Markdown tree so inline tags cannot split a list,
// paragraph, or emphasis; code is literal and an unfinished message is never repaired.
import type { Element, Root, RootContent, Text } from 'hast';
import type { Plugin } from 'unified';
import { codeRegions, insideCode } from '@shared/owner/to-human-parser';

const tags = (text: string) => [...text.matchAll(/<(\/?)(message|to-human|essential|need-input|insight|choice)(?: recommended)?>/g)];
type Token = { close: boolean; name: string };
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
  return paired(tags(text).filter((tag) => !inCode(tag.index)).map((tag) => ({ close: tag[1] === '/', name: tag[2] }))).size > 0;
}

type Tag = Token & { node: Text; start: number; end: number };
const ink = (value: string): Element => ({ type: 'element', tagName: 'span', properties: { className: ['owner-message-ink'] }, children: [{ type: 'text', value }] });

// Runs after the transcript's HTML/URL gates; creates only spans, never HTML from the assistant.
export const messageInk: Plugin<[], Root> = () => (tree) => {
  const tokens: Tag[] = [];
  const collect = (node: Root | RootContent, code = false) => {
    if (node.type === 'text' && !code) {
      for (const tag of tags(node.value)) tokens.push({ node, start: tag.index, end: tag.index + tag[0].length, close: tag[1] === '/', name: tag[2] });
    } else if ('children' in node) {
      for (const child of node.children) collect(child, code || (node.type === 'element' && (node.tagName === 'code' || node.tagName === 'pre')));
    }
  };
  collect(tree);
  const pairs = paired(tokens);
  const byNode = new Map<Text, Tag[]>();
  for (const token of tokens) if (pairs.has(token)) byNode.set(token.node, [...(byNode.get(token.node) ?? []), token]);
  const open: string[] = [];
  let removed = 0;
  const transform = (node: RootContent): RootContent[] => {
    if (node.type === 'text') {
      const children: RootContent[] = [];
      let from = 0;
      const take = (value: string) => { if (value) children.push(['message', 'to-human'].includes(open.at(-1) ?? '') ? ink(value) : { type: 'text', value }); };
      for (const token of byNode.get(node) ?? []) {
        take(node.value.slice(from, token.start));
        if (token.close) open.pop();
        else open.push(token.name);
        removed++;
        from = token.end;
      }
      take(node.value.slice(from));
      return children;
    }
    if (node.type === 'element') {
      const before = removed;
      // Code keeps its own syntax styling and literal tags, even inside a message.
      if (node.tagName !== 'code' && node.tagName !== 'pre') node.children = node.children.flatMap(transform) as Element['children'];
      if (node.tagName === 'p' && before !== removed && node.children.every((child) => (child.type === 'text' && !child.value.trim()) || (child.type === 'element' && child.tagName === 'br'))) return [];
    }
    return [node];
  };
  tree.children = tree.children.flatMap(transform);
};
