// Presentation only: closed output tags are transparent, not a report grammar. The shared owner parser still
// extracts attention and summary marks independently. Keep one Markdown tree so inline tags cannot split a list,
// paragraph, or emphasis; code is literal and an unfinished message is never repaired. The tags come out of the tree
// and the top-level blocks that carry a message's text sit in one wrapper, never one mark per text span. A message that
// starts or ends on its own line starts or ends its own paragraph; one inside a line keeps its paragraph.
//
// UX wave U2b (M2; A12): the wrapper is the mod's drawing of a message (`owner/view/Message.tsx`): its label first, then
// its blocks. A message is what the mod reads as one (`parseMarked`, `to-human/hooks/mods/to-human.tsx` 144, at 0.8.2):
// every mark, the older `to-human`, `essential`, `need-input` and `insight` as `<message>`, and each run of text under
// one mark a message of its own, so a mark nested in another, and the outer one's text after it, are each their own.
// The first message of the text carries the bullet (`spanRows`, 1411; the engine marks every text row of its
// conversation as the first of its reply, ruling 4), a later one none. While the text streams a mark still open at its
// end reads as open (the shared grammar's `parseLive`): its message is drawn under its label and ` …`. A closed
// stretch's head (`only`) draws its messages alone, as the mod draws a folded mixed row: exactly the marked ranges, a
// mark inside a line cut out of its paragraph, where the full drawing keeps the authored paragraph whole.
import type { Element, ElementContent, Root, RootContent } from 'hast';
import type { Plugin } from 'unified';
import { codeRegions, insideCode } from '@shared/owner/to-human-parser';
import { messageLabelNode } from '../view/Message';
import { isOutputTag, outputTagPattern, sourceTags } from './source-tags';

type Token = { close: boolean; name: string };
const tokenOf = (tag: string): Token => ({ close: tag.startsWith('</'), name: tag.replace(/^<\/?|(?: recommended)?>$/g, '') });
// The tokens that pair: an opener with the closer that ends it, innermost first; a crossing closer is no pair and drops
// the openers before it. `live`: an opener still open at the end pairs with the end of the text.
function paired<T extends Token>(tokens: T[], live: boolean): Set<T> {
  const stack: T[] = [];
  const pairs = new Set<T>();
  for (const token of tokens) {
    if (!token.close) stack.push(token);
    else if (stack.at(-1)?.name === token.name) {
      pairs.add(stack.pop()!);
      pairs.add(token);
    } else stack.length = 0;
  }
  if (live) for (const open of stack) pairs.add(open);
  return pairs;
}

const MARKS = ['message', 'to-human', 'essential', 'need-input', 'insight']; // `choice` is a question's own, inside its mark

// Whether the text draws a message: a mark that closes, or (`live`, a streaming block) one still open at its end. Tags
// in code, and tags escaped by a backslash, are literal.
export function hasMessages(text: string, live = false): boolean {
  const inCode = insideCode(codeRegions(text));
  const tokens = [...text.matchAll(outputTagPattern())].filter((tag) => {
    let backslashes = 0;
    for (let at = tag.index - 1; at >= 0 && text[at] === '\\'; at--) backslashes++;
    return !inCode(tag.index) && backslashes % 2 === 0;
  });
  return [...paired(tokens.map((tag) => tokenOf(tag[0])), live)].some((token) => MARKS.includes(token.name));
}

export const hasClosedMarks = (text: string): boolean => hasMessages(text, false);

const blank = (node: RootContent | undefined): boolean => node?.type === 'text' && !node.value.trim();
const lineBreak = (node: RootContent | undefined): boolean => node?.type === 'element' && node.tagName === 'br';
type Unit = { node: RootContent; message: number | null };

// Only the source tokenizer's span has an exact tag range. Never rescan decoded text: an entity or backslash-escaped
// example can have the same displayed characters without having been an output tag in the source.
const decorateWith = ({ live, only }: { live: boolean; only: boolean }): Plugin<[], Root> => () => (tree, file) => {
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
  const byNode = new Map<RootContent, Token>([...paired(tokens, live)].map((token) => [token.node, token]));
  const open: { name: string; message: number }[] = []; // message: the ordinal of an open mark's current run, else 0
  let messages = 0;
  let touched: number | null = null; // the message whose text the block being drawn holds
  let removed = 0;
  const touch = () => { touched = open.findLast((entry) => entry.message)?.message ?? touched; }; // a `choice` inside a mark is transparent
  const enter = (token: Token) => {
    if (token.close) {
      const closed = open.pop();
      // `parseMarked`: the mark it was inside starts a run of its own with the next text under it
      const outer = open.findLast((entry) => entry.message);
      if (closed?.message && outer) outer.message = ++messages;
    } else open.push({ name: token.name, message: MARKS.includes(token.name) ? ++messages : 0 });
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
      const isMark = MARKS.includes(token.name);
      const last = kids.findLast((kid) => !blank(kid));
      if (!token.close && isMark && (!last || lineBreak(last))) flush();
      enter(token);
      if (token.close && isMark) {
        let next = at + 1;
        while (blank(children[next])) next++;
        if (next >= children.length || lineBreak(children[next])) { at = next; flush(); }
      }
    }
    flush();
    return units;
  };

  // A closed stretch's head (`only`) keeps exactly the marked ranges: a block with tags among its own children is cut
  // at every tag into the runs `parseMarked` reads, each run under its message, the words outside any mark dropped.
  const holdsTag = (node: RootContent): boolean => byNode.has(node) || (node.type === 'element' && node.tagName !== 'code' && node.children.some(holdsTag));
  const inMessage = () => open.findLast((entry) => entry.message)?.message ?? null;
  const runs = (block: Element): Unit[] => {
    const units: Unit[] = [];
    let kids: ElementContent[] = [];
    let run = inMessage();
    const flush = () => {
      while (blank(kids[0]) || lineBreak(kids[0])) kids.shift();
      while (blank(kids.at(-1)) || lineBreak(kids.at(-1))) kids.pop();
      if (kids.length) units.push({ node: { ...block, properties: { ...block.properties }, children: kids }, message: run });
      kids = [];
    };
    for (const child of block.children) {
      const token = byNode.get(child);
      if (token) {
        enter(token);
        if (inMessage() !== run) { flush(); run = inMessage(); }
        continue;
      }
      const before = removed;
      touched = null;
      const drawn = transform(child) as ElementContent[];
      if (removed === before) { kids.push(...drawn); continue; }
      // A tag inside an inline element (`**<message>…</message>**`): the element goes whole, under the message it holds.
      flush();
      kids.push(...drawn);
      const after = inMessage();
      run = touched;
      flush();
      run = after;
    }
    flush();
    return units;
  };

  const units: Unit[] = [];
  for (const child of tree.children) {
    touched = null;
    const tagged = child.type === 'element' && child.children.some((kid) => byNode.has(kid));
    if (only && child.type === 'element' && holdsTag(child) && child.tagName !== 'pre') units.push(...runs(child));
    else if (tagged && child.tagName === 'p') units.push(...cut(child));
    else for (const node of transform(child)) units.push({ node, message: touched });
  }
  // The runs still open at the end of a streaming text: their messages read ` …`.
  const streaming = new Set(open.map((entry) => entry.message).filter((message) => message > 0));
  // Consecutive blocks of one message sit in one wrapper, under the message's label.
  const grouped: RootContent[] = [];
  let wrapper: Element | null = null;
  let current: number | null = null;
  let drawn = 0;
  for (const { node, message } of units) {
    if (blank(node) && wrapper) { wrapper.children.push(node as ElementContent); continue; }
    if (node.type !== 'element' || message === null) {
      wrapper = null;
      current = null;
      if (!only) grouped.push(node);
      continue;
    }
    if (!wrapper || current !== message) {
      wrapper = { type: 'element', tagName: 'div', properties: { className: ['owner-message-ink'] }, children: [messageLabelNode(drawn === 0, streaming.has(message))] };
      current = message;
      drawn += 1;
      grouped.push(wrapper);
    }
    wrapper.children.push(node);
  }
  tree.children = grouped;
};

// Streamdown caches its processor by its plugins' function names (`generateCacheKey`, read in streamdown's dist), so
// each decoration carries a name of its own: four anonymous plugins would share the first one's processor.
const named = (name: string, plugin: Plugin<[], Root>): Plugin<[], Root> => Object.defineProperty(plugin, 'name', { value: name });

/** The decoration of a text's one Markdown tree: completed or streaming, whole or its messages alone (a closed head). */
export const messageInk = { source: sourceTags, decorate: named('messageInk', decorateWith({ live: false, only: false })) };
export const liveMessageInk = { source: sourceTags, decorate: named('liveMessageInk', decorateWith({ live: true, only: false })) };
export const reportMessageInk = { source: sourceTags, decorate: named('reportMessageInk', decorateWith({ live: false, only: true })) };
export const liveReportMessageInk = { source: sourceTags, decorate: named('liveReportMessageInk', decorateWith({ live: true, only: true })) };
