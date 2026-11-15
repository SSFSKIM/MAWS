// Presentation only: output tags are transparent, not a report grammar. Keep one Markdown tree so inline tags cannot
// split a list, paragraph, or emphasis; code is literal. The tags come out of the tree and the top-level blocks that
// carry a message's text sit in one wrapper, never one mark per text span. A message that starts or ends on its own
// line starts or ends its own paragraph; one inside a line keeps its paragraph.
//
// UX wave U2b (M2; A12): the wrapper is the mod's drawing of a message (`owner/view/Message.tsx`): its label first, then
// its blocks. Which tags are tags and which words are a message is the one reading of a text's marks
// (`src/shared/owner/marked.ts`), which every reader of the renderer takes: this tree takes out exactly its tags (a
// tag it does not take stays literal: in code, after a backslash, a mark left open in a completed text, a stray or
// crossing tag) and splits the messages as it does, each run of text under one mark a message of its own. The first
// message of the text carries the bullet (`spanRows`, 1411; the engine marks every text row of its conversation as the
// first of its reply, ruling 4), a later one none; while the text streams a mark still open at its end is drawn under
// its label and ` …`. A closed stretch's head draws the reading's spans alone (`Presenter.tsx`), not through this tree.
// The full drawing hands Markdown its text through `unglued`, so a fence the reading closes is a fence Markdown closes.
import type { Element, ElementContent, Root, RootContent } from 'hast';
import type { Plugin } from 'unified';
import { readMarked } from '@shared/owner/marked';
import { messageLabelNode } from '../view/Message';
import { isOutputTag, sourceTags } from './source-tags';

type Token = { close: boolean; name: string };
const tokenOf = (tag: string): Token => ({ close: tag.startsWith('</'), name: tag.replace(/^<\/?|(?: recommended)?>$/g, '') });
// A question's `choice` tags that pair: an opener with the closer that ends it, innermost first; a crossing closer is no
// pair and drops the openers before it. (The mark tags are the one reading's; the options pair within one of its runs.)
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

const MARKS = ['message', 'to-human', 'essential', 'need-input', 'insight']; // `choice` is a question's own, inside its mark

/** Whether the text draws a message, by the one reading (`live`: while its block streams). */
export const hasMessages = (text: string, live = false): boolean => readMarked(text, live).spans.length > 0;

// `transcript/surface/Rows.tsx`'s question of a completed text the engine's surface drew natively.
export const hasClosedMarks = (text: string): boolean => hasMessages(text);

// A fence with mark tags glued to it on its line (the shared grammar's glued reading, `to-human-parser.ts`'s `GLUED`):
// the reading takes the tags and reads the fence as a fence, but CommonMark does not. Tags glued before an opening fence
// make the line a paragraph, so the fence opens nowhere and its closing line opens a code block of its own that runs
// on; tags glued after a closing fence make the line no closing fence, so the code runs on and takes the tags and every
// line after them. The text the full drawing hands to Markdown therefore breaks each such line where the reading takes
// its tags: the tags on a line of their own beside the fence, under the same indent. An opening line is broken only
// where its fence closes before the next tag the reading takes, so the code CommonMark then draws holds no tag of the
// reading's. Nothing the reading takes moves between message and record, and a line the reading leaves literal (inside
// a longer fence, say) is kept as written.
const TAGS = String.raw`(?:<\/?(?:message|to-human|essential|need-input|insight)>[ \t]*)+`;
const GLUED_OPENER = new RegExp(String.raw`^([ \t]*)(${TAGS})((\x60{3,}|~{3,}).*)$`);
const GLUED_CLOSER = new RegExp(String.raw`^([ \t]*)((?:\x60{3,}|~{3,})[ \t]*)(${TAGS})$`);
const ANY_CLOSER = new RegExp(String.raw`^[ \t]*(\x60{3,}|~{3,})[ \t]*(${TAGS})?$`);
export function unglued(text: string, live = false): string {
  if (!/(?:`{3}|~{3})/.test(text) || !/<\/?(?:message|to-human|essential|need-input|insight)>/.test(text)) return text;
  const taken = readMarked(text, live).tags;
  const takes = new Set(taken);
  const lines = text.split('\n');
  const starts: number[] = [];
  for (let i = 0, at = 0; i < lines.length; at += lines[i].length + 1, i += 1) starts.push(at);
  // Where the fence an opening line opens closes: the first later closing line of its kind, if no tag the reading
  // takes stands before it (a closer's own glued tags come after its fence).
  const closes = (from: number, fence: string): boolean => {
    for (let i = from + 1; i < lines.length; i += 1) {
      const close = ANY_CLOSER.exec(lines[i]);
      const end = close === null ? starts[i] + lines[i].length : starts[i] + lines[i].length - (close[2]?.length ?? 0);
      if (taken.some((at) => at > starts[from] + lines[from].length && at < end)) return false;
      // a closing line whose glued tags the reading takes is broken below, so CommonMark closes the fence there too
      if (close !== null && close[1][0] === fence[0] && close[1].length >= fence.length && (close[2] === undefined || takes.has(end))) return true;
    }
    return false;
  };
  return lines.map((line, i) => {
    const opener = GLUED_OPENER.exec(line);
    if (opener !== null) {
      const [, indent, tags, rest, fence] = opener;
      const info = rest.slice(fence.length);
      const opens = !(fence[0] === '`' && info.includes('`')); // a backtick fence's info string holds no backtick
      return opens && takes.has(starts[i] + indent.length) && closes(i, fence) ? `${indent}${tags.trimEnd()}\n${indent}${rest}` : line;
    }
    const closer = GLUED_CLOSER.exec(line);
    if (closer !== null) {
      const [, indent, fence, tags] = closer;
      return takes.has(starts[i] + indent.length + fence.length) ? `${indent}${fence.trimEnd()}\n${indent}${tags}` : line;
    }
    return line;
  }).join('\n');
}

const blank = (node: RootContent | undefined): boolean => node?.type === 'text' && !node.value.trim();
const lineBreak = (node: RootContent | undefined): boolean => node?.type === 'element' && node.tagName === 'br';
type Unit = { node: RootContent; message: number | null };

// Only the source tokenizer's span has an exact tag range. Never rescan decoded text: an entity or backslash-escaped
// example can have the same displayed characters without having been an output tag in the source.
const decorateWith = ({ live }: { live: boolean }): Plugin<[], Root> => () => (tree, file) => {
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
  const reading = readMarked(source, live);
  const taken = new Set(reading.tags);
  const isMarkTag = (token: Token) => MARKS.includes(token.name);
  const offsetOf = (token: { node: Element }) => token.node.position!.start.offset!;
  const marks = tokens.filter((token) => isMarkTag(token) && taken.has(offsetOf(token)));
  // A question's options pair within one run of the reading, between two tags it takes and never across one, as the
  // shared grammar lifts them from one part's text and a closed head draws each span alone: an option whose tags stand
  // on either side of a mark's tag is text, so the mark it crosses still ends where the reading ends it.
  const runs = new Map<number, (Token & { node: Element })[]>();
  for (const token of tokens) {
    if (isMarkTag(token)) continue;
    const run = reading.tags.filter((at) => at < offsetOf(token)).length;
    runs.set(run, [...(runs.get(run) ?? []), token]);
  }
  const options = [...runs.values()].flatMap((run) => [...paired(run)]);
  const byNode = new Map<RootContent, Token>([...marks, ...options].map((token) => [token.node, token]));
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

  const units: Unit[] = [];
  for (const child of tree.children) {
    touched = null;
    if (child.type === 'element' && child.tagName === 'p' && child.children.some((kid) => byNode.has(kid))) units.push(...cut(child));
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
      grouped.push(node);
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
// each decoration carries a name of its own: two anonymous plugins would share the first one's processor.
const named = (name: string, plugin: Plugin<[], Root>): Plugin<[], Root> => Object.defineProperty(plugin, 'name', { value: name });

/** The decoration of a text's one Markdown tree, completed or streaming. */
export const messageInk = { source: sourceTags, decorate: named('messageInk', decorateWith({ live: false })) };
export const liveMessageInk = { source: sourceTags, decorate: named('liveMessageInk', decorateWith({ live: true })) };
