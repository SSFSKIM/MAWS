// The text the agent receives for an anchored comment, and its parse (X10's serialisation; E3 execution document,
// Design §2 and Interfaces "The agent-facing text"). One text block in three parts: a lead line naming what the comment
// is about in words, the comment as typed, and for a side thread a preamble paragraph; then a blank line and one
// self-closing `<maws_anchor …/>` tag carrying the anchor's fields. The parse recovers the anchor from the tag alone and
// strips the lead and the preamble only on an exact match, so the transcript draws the same row from the live prompt,
// the queued steer and the engine's JSONL, and nothing a human typed in that shape is taken for MAWS's framing.
import { AnchorSchema, type Anchor, type AnchorBox /* E4d */ } from './anchor';
import type { ArtifactKind } from '../artifacts/entity'; // P3-C

export type Destination = 'thread' | 'main';

export const SIDE_THREAD_PREAMBLE = 'You are in a side thread forked from the main conversation to handle this one comment. Address it here; the main conversation continues separately and is not waiting on you.';
// UX wave U5a (§A): a thread opened from several comments, in their last block; its own constant, a persisted text the
// reader matches exactly, as the one above
export const SIDE_THREAD_PREAMBLE_MANY = 'You are in a side thread forked from the main conversation to handle these comments. Address them here; the main conversation continues separately and is not waiting on you.';

const SCREENSHOT_SENTENCE = '. A screenshot of it is attached:';
const PROMOTION_HEAD = 'This side thread continues side questions the user asked beside the main conversation. The exchange so far:';
const PROMOTION_CONTINUE = 'Continue from here.';
const PROMOTION_ANCHOR: Anchor = { kind: 'none', label: 'Side question', locator: 'btw' };

// The parenthetical's parts per kind, each present only when its fields are (the schema leaves them optional; a
// producer that gives them all gets exactly Interfaces' table).
function leadParts(anchor: Anchor): string[] {
  const { path, line, pageUrl } = anchor;
  const present = (...parts: (string | false | undefined)[]): string[] => parts.filter((part): part is string => typeof part === 'string' && part !== '');
  switch (anchor.kind) {
    case 'file-line':
      return present(path !== undefined && `file ${path}`, line !== undefined && `line ${line}`);
    case 'pr-line': {
      const where = path !== undefined && line !== undefined ? `${path} line ${line}` : path ?? (line !== undefined ? `line ${line}` : undefined);
      return present(anchor.prNumber !== undefined && `PR #${anchor.prNumber}`, where, anchor.side !== undefined && `${anchor.side} side`, pageUrl);
    }
    case 'browser-element':
      return [`element ${anchor.locator}${pageUrl !== undefined ? ` on ${pageUrl}` : ''}`];
    case 'artifact-element':
      return present(`element ${anchor.locator} in the artifact`, pageUrl);
    case 'artifact-comment': // P3-B: the passage, then the ids the agent's document tools take; P3-C: by the artifact's kind
      return present((ARTIFACT_COMMENT_LEADS[anchor.artifactKind ?? 'document'] ?? ARTIFACT_COMMENT_LEADS.document)(anchor), anchor.threadId !== undefined && `thread ${anchor.threadId}`);
    case 'none':
      return [];
  }
}

// P3-C start (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, M7 fix wave 1; Decision Log 33, 35, 36): what an
// artifact comment is on, by the commented artifact's kind (`artifactKind`; absent, a document's, as before). B's
// document entry is its wording to the byte; a deck's names the element and the presentation, no slide number (the
// lead is a function of the anchor alone and the anchor carries none: the architect's ruling, Decision Log 36). A kind
// with no entry reads as a document's.
type CommentLead = (anchor: Anchor) => string;
const ARTIFACT_COMMENT_LEADS: { document: CommentLead } & Partial<Record<ArtifactKind, CommentLead>> = {
  document: (anchor) => `passage "${anchor.locator}"${anchor.artifactId !== undefined ? ` in document ${anchor.artifactId}` : ''}`,
  presentation: (anchor) => `element "${anchor.locator}"${anchor.artifactId !== undefined ? ` in presentation ${anchor.artifactId}` : ''}`,
  // P3-E (E2 M4; E's Decision Log 28 (5)): prose and chart blocks alike; a block's locator is `<view>: <caption or dataset id>`
  dashboard: (anchor) => `content "${anchor.locator}"${anchor.artifactId !== undefined ? ` in dashboard ${anchor.artifactId}` : ''}`,
  // P3-E (E1 M4; the P3-E spec's Decision Log 12): a design's board or element, by the anchor's target (absent, an element)
  design: (anchor) => `${anchor.artifactTarget === 'board' ? 'board' : 'element'} "${anchor.locator}"${anchor.artifactId !== undefined ? ` in design ${anchor.artifactId}` : ''}`,
};
// P3-C end

// `Comment on "<label>" (<parts>):`, or `Comment:` for the anchorless kind; with a screenshot the final colon becomes
// `. A screenshot of it is attached:`. The label is always quoted, so it is never read as part of the sentence.
// A persisted-format contract: the engine's transcripts keep these leads, and `readOneComment` strips one only when it
// equals the lead this function writes now, so a change of wording leaves every older transcript's lead as text.
export function anchorLead(anchor: Anchor, screenshot: boolean): string {
  const parts = leadParts(anchor);
  const lead = anchor.kind === 'none' ? 'Comment:' : `Comment on "${anchor.label}"${parts.length > 0 ? ` (${parts.join(', ')})` : ''}:`;
  return screenshot ? `${lead.slice(0, -1)}${SCREENSHOT_SENTENCE}` : lead;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' };
const escapeAttribute = (value: string) => value.replace(/[&"<>]/g, (c) => ESCAPES[c]!);
const unescapeAttribute = (value: string) => value.replace(/&(amp|quot|lt|gt);/g, (_, name: string) => ({ amp: '&', quot: '"', lt: '<', gt: '>' })[name]!);

// The tag's attributes, in the order they are written (Interfaces): the tag is byte-stable, and the parse accepts it
// only when re-writing the anchor it read gives the same bytes.
const TAG_FIELDS = ['kind', 'label', 'locator', 'pageUrl', 'path', 'line', 'side', 'prNumber', 'css', 'role', 'name', 'a11y', 'box' /* E4d */, 'artifactId', 'threadId' /* P3-B */, 'artifactKind' /* P3-C */, 'artifactTarget' /* P3-E */] as const;
const NUMERIC_FIELDS: ReadonlySet<string> = new Set(['line', 'prNumber']);

// E4d start: the browser-element box (E4d execution document, Design §6) is one attribute, `x,y,width,height`; any other
// form is handed to the schema as the string it is, which refuses it, so such a tag stays text
const tagValue = (value: string | number | AnchorBox) => (typeof value === 'object' ? `${value.x},${value.y},${value.width},${value.height}` : String(value));
function parseBox(value: string): AnchorBox | string {
  const match = /^(-?\d+),(-?\d+),(\d+),(\d+)$/.exec(value);
  return match ? { x: Number(match[1]), y: Number(match[2]), width: Number(match[3]), height: Number(match[4]) } : value;
}
// E4d end

export function anchorTag(anchor: Anchor): string {
  const attributes = TAG_FIELDS.flatMap((field) => {
    const value = anchor[field];
    return value === undefined ? [] : [` ${field}="${escapeAttribute(tagValue(value) /* E4d: was String(value) */)}"`];
  });
  return `<maws_anchor${attributes.join('')}/>`;
}

export function anchoredMessage(input: { anchor: Anchor; text: string; destination: Destination; screenshot: boolean }): string {
  const { anchor, text, destination, screenshot } = input;
  return `${anchorLead(anchor, screenshot)}\n${text.trim()}${destination === 'thread' ? `\n\n${SIDE_THREAD_PREAMBLE}` : ''}\n\n${anchorTag(anchor)}`;
}

// A `/btw` exchange promoted to a side thread: its first prompt lists the answered exchanges, then the text the human
// typed (else a line asking to continue), then the anchorless tag, so the thread's first row reads as a side question.
export function promotionMessage(exchanges: { question: string; response: string }[], text: string | null): string {
  const pairs = exchanges.map(({ question, response }) => `Q: ${question}\nA: ${response}`);
  const typed = text?.trim() || PROMOTION_CONTINUE;
  return [PROMOTION_HEAD, ...pairs, typed, anchorTag(PROMOTION_ANCHOR)].join('\n\n');
}

// E4d (2026-10-06): attribute names widened from `[A-Za-z]+` to `[A-Za-z][A-Za-z0-9]*` so X10's `a11y` parses (E4d
// execution document, Decision Log 21; a §6 exception); every older tag still matches.
const TAG_LINE = /^<maws_anchor((?: [A-Za-z][A-Za-z0-9]*="[^"]*")+)\/>$/;
const TAG_ATTRIBUTE = / ([A-Za-z][A-Za-z0-9]*)="([^"]*)"/g;

function parseTag(line: string): Anchor | null {
  const match = TAG_LINE.exec(line);
  if (!match) return null;
  const fields: Record<string, string | number | AnchorBox /* E4d */> = {};
  for (const [, name, raw] of match[1]!.matchAll(TAG_ATTRIBUTE)) {
    const value = unescapeAttribute(raw!);
    if (Object.hasOwn(fields, name!)) return null;
    fields[name!] = name === 'box' ? parseBox(value) /* E4d */ : NUMERIC_FIELDS.has(name!) ? (/^[1-9][0-9]*$/.test(value) ? Number(value) : Number.NaN) : value;
  }
  const parsed = AnchorSchema.omit({ screenshot: true }).safeParse(fields);
  if (!parsed.success) return null;
  return anchorTag(parsed.data) === line ? parsed.data : null;
}

const isBlank = (line: string) => line.trim() === '';

// The anchor of a message MAWS wrote, else null. The last non-empty line must be the exact tag; the first line is
// stripped only when it equals the lead regenerated from that anchor (with or without the screenshot sentence), and,
// independently, the paragraph before the tag only when it is the preamble, which is what says the destination was a
// side thread. A lead that does not match stays in the text; without the preamble the destination is then unknown
// (null): a `/btw` promotion.
// UX wave U5a (decision 15): the one-comment rule, renamed in M8 and unchanged in behaviour. A caller
// reads a message by `readAnchoredMessage`, which takes this rule for every message that is not framed; it stays exported
// because it is also build F's reader to the byte (§J), which the tests pin against framed messages.
export function readOneComment(text: string): { anchor: Anchor; text: string; destination: Destination | null } | null {
  const lines = text.split('\n');
  while (lines.length > 0 && isBlank(lines.at(-1)!)) lines.pop();
  const tagLine = lines.pop();
  if (tagLine === undefined) return null;
  const anchor = parseTag(tagLine);
  if (anchor === null) return null;
  const leads = [anchorLead(anchor, false), anchorLead(anchor, true)];
  const led = lines.length > 0 && leads.includes(lines[0]!);
  if (led) lines.shift();
  while (lines.length > 0 && isBlank(lines.at(-1)!)) lines.pop();
  const thread = lines.at(-1) === SIDE_THREAD_PREAMBLE && (lines.length === 1 || isBlank(lines.at(-2)!));
  if (thread) lines.pop();
  return { anchor, text: lines.join('\n').trim(), destination: thread ? 'thread' : led ? 'main' : null };
}

// UX wave U5a start (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, Interfaces §A; M1): a message of
// several comments. One comment is `anchoredMessage`'s text to the byte. Two to twenty open with a framing line no
// single-comment writer ever opened a message with (`anchoredMessage` opens with a lead, which begins `Comment`; a
// promotion with its own head), then one block a comment (lead, comment, blank line, tag), a blank line between blocks,
// the plural preamble once, in the last block, for a thread. Inside such a message every line of a comment that begins
// with `<maws_anchor` after zero or more backslashes takes one more backslash, so the only lines beginning with a bare
// `<maws_anchor` are the blocks' own tags and no words of a person's can end a block. The framing is plain words: the
// agent reads the line as what it says.
export interface MessageComment {
  anchor: Anchor;
  text: string;
  screenshot: boolean;
}

export const MESSAGE_COMMENTS_MAX = 20;
const FRAMING_LINE = /^([1-9][0-9]*) comments, in the order made:$/;
const framingLine = (count: number) => `${count} comments, in the order made:`;
const ESCAPED_OR_NOT = /^\\*<maws_anchor/; // a line the escape takes one more backslash in front of
const ESCAPED = /^\\+<maws_anchor/; // a line the reader takes one backslash off
const escapeLine = (line: string) => (ESCAPED_OR_NOT.test(line) ? `\\${line}` : line);
const unescapeLine = (line: string) => (ESCAPED.test(line) ? line.slice(1) : line);

/** The text of one message carrying `comments` (1 to 20), oldest first. */
export function commentsMessage(comments: readonly MessageComment[], destination: Destination): string {
  if (comments.length < 1 || comments.length > MESSAGE_COMMENTS_MAX) throw new RangeError(`a message carries 1 to ${MESSAGE_COMMENTS_MAX} comments, not ${comments.length}`);
  if (comments.length === 1) return anchoredMessage({ ...comments[0]!, destination });
  const blocks = comments.map(({ anchor, text, screenshot }, index) => {
    const preamble = destination === 'thread' && index === comments.length - 1 ? `\n\n${SIDE_THREAD_PREAMBLE_MANY}` : '';
    return `${anchorLead(anchor, screenshot)}\n${text.trim().split('\n').map(escapeLine).join('\n')}${preamble}\n\n${anchorTag(anchor)}`;
  });
  return [framingLine(comments.length), ...blocks].join('\n\n');
}

/** Every comment of a message MAWS wrote, else null. */
export function readAnchoredMessage(text: string): { comments: MessageComment[]; destination: Destination | null } | null {
  return readFramed(text) ?? readOne(text);
}

// A message of one comment, by `readOneComment`'s rule exactly; its lead carried the screenshot sentence when the
// message's first line is that lead (the line `readOneComment` strips, the tag being the last)
function readOne(text: string): { comments: MessageComment[]; destination: Destination | null } | null {
  const read = readOneComment(text);
  if (read === null) return null;
  const screenshot = text.split('\n')[0] === anchorLead(read.anchor, true);
  return { comments: [{ anchor: read.anchor, text: read.text, screenshot }], destination: read.destination };
}

// The framed reading, taken only when the whole structure checks: the framing line first, with N from 2 to 20; then
// exactly N blocks, each ending at the next line that is an exact tag; each block's first non-blank line its own tag's
// lead; no line of a comment a bare `<maws_anchor` (the writer escapes every such line); nothing but blank lines after the
// last tag. Anything else is no framed message, and the one-comment rule reads it.
// Its work, bounded by count (Decision Log 54): one pass over the lines, and the schema consulted at most once for each
// tag it accepts and once for the line that ends the reading, at most 21 times a message (MESSAGE_COMMENTS_MAX tags,
// and one more past them or one that fails); the one-comment rule's fallback then reads the last line's tag once.
function readFramed(text: string): { comments: MessageComment[]; destination: Destination } | null {
  const lines = text.split('\n');
  const framing = FRAMING_LINE.exec(lines[0]!);
  const count = framing === null ? 0 : Number(framing[1]);
  if (count < 2 || count > MESSAGE_COMMENTS_MAX) return null;
  while (lines.length > 1 && isBlank(lines.at(-1)!)) lines.pop();
  const blocks: { anchor: Anchor; body: string[] }[] = [];
  let body: string[] = [];
  for (const line of lines.slice(1)) {
    const anchor = parseTag(line);
    if (anchor === null) {
      // a bare `<maws_anchor` line that is no exact tag is refused below whatever follows (a block's lead it is not, a
      // comment's words never hold one, nothing may follow the last tag), so the reading ends here
      if (line.startsWith('<maws_anchor')) return null;
      body.push(line);
      continue;
    }
    blocks.push({ anchor, body });
    body = [];
    if (blocks.length > count) return null; // more tags than the framing names: not a message MAWS wrote, read no further
  }
  if (body.length > 0 || blocks.length !== count) return null;
  let destination: Destination = 'main';
  const comments: MessageComment[] = [];
  for (const [index, { anchor, body: block }] of blocks.entries()) {
    const start = block.findIndex((line) => !isBlank(line));
    const lead = block[start];
    const screenshot = lead === anchorLead(anchor, true);
    if (lead === undefined || (!screenshot && lead !== anchorLead(anchor, false))) return null;
    const words = block.slice(start + 1);
    if (words.some((line) => line.startsWith('<maws_anchor'))) return null;
    if (index === blocks.length - 1) {
      while (words.length > 0 && isBlank(words.at(-1)!)) words.pop();
      if (words.at(-1) === SIDE_THREAD_PREAMBLE_MANY && (words.length === 1 || isBlank(words.at(-2)!))) {
        words.pop();
        destination = 'thread';
      }
    }
    comments.push({ anchor, text: words.map(unescapeLine).join('\n').trim(), screenshot });
  }
  return { comments, destination };
}
// UX wave U5a end
