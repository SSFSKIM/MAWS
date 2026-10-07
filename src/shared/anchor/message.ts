// The text the agent receives for an anchored comment, and its parse (X10's serialisation; E3 execution document,
// Design §2 and Interfaces "The agent-facing text"). One text block in three parts: a lead line naming what the comment
// is about in words, the comment as typed, and for a side thread a preamble paragraph; then a blank line and one
// self-closing `<maws_anchor …/>` tag carrying the anchor's fields. The parse recovers the anchor from the tag alone and
// strips the lead and the preamble only on an exact match, so the transcript draws the same row from the live prompt,
// the queued steer and the engine's JSONL, and nothing a human typed in that shape is taken for MAWS's framing.
import { AnchorSchema, type Anchor, type AnchorBox /* E4d */ } from './anchor';

export type Destination = 'thread' | 'main';

export const SIDE_THREAD_PREAMBLE = 'You are in a side thread forked from the main conversation to handle this one comment. Address it here; the main conversation continues separately and is not waiting on you.';

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
    case 'none':
      return [];
  }
}

// `Comment on "<label>" (<parts>):`, or `Comment:` for the anchorless kind; with a screenshot the final colon becomes
// `. A screenshot of it is attached:`. The label is always quoted, so it is never read as part of the sentence.
// A persisted-format contract: the engine's transcripts keep these leads, and `parseAnchoredText` strips one only when it
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
const TAG_FIELDS = ['kind', 'label', 'locator', 'pageUrl', 'path', 'line', 'side', 'prNumber', 'css', 'role', 'name', 'a11y', 'box' /* E4d */] as const;
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
export function parseAnchoredText(text: string): { anchor: Anchor; text: string; destination: Destination | null } | null {
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
