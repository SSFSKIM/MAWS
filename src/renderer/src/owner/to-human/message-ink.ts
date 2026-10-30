// Presentation only: closed output tags are transparent, not a report grammar. The shared owner parser still
// extracts attention and summary marks independently. Keep one Markdown tree so inline tags cannot split a list,
// paragraph, or emphasis; code is literal and an unfinished message is never repaired. The tags come out of the tree
// and the top-level blocks that carry a message's text sit in one wrapper (presenter.css draws the bar and the label on
// it), never one mark per text span. A message that starts or ends on its own line starts or ends its own paragraph; one inside a line
// keeps its paragraph.
import type { Element, ElementContent, Root, RootContent } from 'hast';
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

const MESSAGE = ['message', 'to-human'];
const blank = (node: RootContent | undefined): boolean => node?.type === 'text' && !node.value.trim();
const lineBreak = (node: RootContent | undefined): boolean => node?.type === 'element' && node.tagName === 'br';
type Unit = { node: RootContent; message: number | null };

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
  const byNode = new Map<RootContent, Token>([...paired(tokens)].map((token) => [token.node, token]));
  const open: { name: string; message: number }[] = []; // message: the ordinal of an open message, else 0
  let messages = 0;
  let touched: number | null = null; // the message whose text the block being drawn holds
  let removed = 0;
  const touch = () => { touched = open.findLast((entry) => entry.message)?.message ?? touched; }; // a legacy tag inside a message is transparent
  const enter = (token: Token) => {
    if (token.close) open.pop();
    else open.push({ name: token.name, message: MESSAGE.includes(token.name) ? ++messages : 0 });
    removed++;
  };
  const transform = (node: RootContent): RootContent[] => {
    if (node.type === 'text') {
      if (node.value.trim()) touch();
      return [node];
    }
    if (node.type === 'element') {
      const token = byNode.get(node);
      if (token) { enter(token); return []; }
      const before = removed;
      // Code keeps its own syntax styling and literal tags, even inside a message.
      if (node.tagName === 'code' || node.tagName === 'pre') touch();
      else node.children = node.children.flatMap(transform) as Element['children'];
      if (node.tagName === 'p' && before !== removed && node.children.every((child) => blank(child) || lineBreak(child))) return [];
    }
    return [node];
  };

  // A paragraph with tags among its own children is cut where a message begins or ends at a line's edge.
  const cut = (paragraph: Element): Unit[] => {
    const units: Unit[] = [];
    let kids: ElementContent[] = [];
    const flush = () => {
      while (blank(kids[0]) || lineBreak(kids[0])) kids.shift();
      while (blank(kids.at(-1)) || lineBreak(kids.at(-1))) kids.pop();
      if (kids.length) units.push({ node: { ...paragraph, properties: { ...paragraph.properties }, children: kids }, message: touched });
      kids = [];
      touched = null;
    };
    const children = paragraph.children;
    for (let at = 0; at < children.length; at++) {
      const token = byNode.get(children[at]);
      if (!token) { kids.push(...(transform(children[at]) as ElementContent[])); continue; }
      const isMessage = MESSAGE.includes(token.name);
      const last = kids.findLast((kid) => !blank(kid));
      if (!token.close && isMessage && (!last || lineBreak(last))) flush();
      enter(token);
      if (token.close && isMessage) {
        let next = at + 1;
        while (blank(children[next])) next++;
        if (next >= children.length || lineBreak(children[next])) { at = next; flush(); }
      }
    }
    flush();
    return units;
  };

  const units: Unit[] = [];
  for (const child of tree.children) {
    touched = null;
    if (child.type === 'element' && child.tagName === 'p' && child.children.some((kid) => byNode.has(kid))) units.push(...cut(child));
    else for (const node of transform(child)) units.push({ node, message: touched });
  }
  // Consecutive blocks of one message sit in one wrapper, the element presenter.css draws the bar and label on.
  const grouped: RootContent[] = [];
  let wrapper: Element | null = null;
  let current: number | null = null;
  for (const { node, message } of units) {
    if (blank(node) && wrapper) { wrapper.children.push(node as ElementContent); continue; }
    if (node.type !== 'element' || message === null) { wrapper = null; current = null; grouped.push(node); continue; }
    if (!wrapper || current !== message) {
      wrapper = { type: 'element', tagName: 'div', properties: { className: ['owner-message-ink'] }, children: [] };
      current = message;
      grouped.push(wrapper);
    }
    wrapper.children.push(node);
  }
  tree.children = grouped;
};

export const messageInk = { source: sourceTags, decorate };
