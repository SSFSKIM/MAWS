// Ticket 733a (docs/doperpowers/plans/2026-11-17-ticket-733a-composed-forms.md, Designs 2 and 4, §B and §C): content a
// model, a command or a page wrote, carried by a form MAWS composes and sends with the person's origin. Every line a
// reading of the grant's opening touches is left out, a marker of MAWS's own words in its place, and what remains
// stands inside a pasted segment, the engine's frame for text the person did not write; MAWS's own readers of a form
// read the segment back in place. Only content goes through here: never words a person typed or pasted into a message
// of their own. A leaf: it imports the grant's test and the paste's frame, and nothing that imports a form.
import { restorePastedTags, wrapPasted } from '../composer/pasted-framing';
import { grantSpans } from './grant';

type Work = { steps: number };

/** What stands where one line of content quoted the grant's opening (§E). */
export const LINE_LEFT_OUT = '(a line left out by MAWS)';
/** What stands where a run of lines did, across which the opening stood, or content left out whole (§E). */
export const LINES_LEFT_OUT = '(lines left out by MAWS)';

/** The rounds the budget of `leaveOutGrant` leaves room for: each round can make a reading the last did not leave. */
export const LEAVE_OUT_ROUNDS = 8;
/**
 * The budget of `leaveOutGrant`, a character of content, with a floor of `LEAVE_OUT_WORK_FLOOR_CHARS` characters for a
 * short text. Fitted from the counted work (the landing's M1): one round (the ranges' pass, the cutting and joining of
 * lines) cost at most 6 units a character over Design 2's table and its two long inputs (5.99: the thousands of blank
 * lines, 30,094 for 5,022 characters), and the budget leaves room for `LEAVE_OUT_ROUNDS` rounds and the pass that finds
 * none, 9 × 6. A text whose characters fold to many (U+FDFA folds to 18) costs more a round, and spends it sooner: it
 * fails closed, left out whole.
 */
export const LEAVE_OUT_WORK_PER_CHAR = 54;
export const LEAVE_OUT_WORK_FLOOR_CHARS = 32; // the pass over a marker that ends the last round, 4 units a character of its 24

// A line break of content: LF, CRLF, a lone CR, NEL, the line and paragraph separators
const BREAK = /\r\n|[\n\r\u0085\u2028\u2029]/g;

// The content's lines, each with its break: where each starts, and where its break begins
function linesOf(text: string): { starts: number[]; breaks: number[] } {
  const starts = [0];
  const breaks: number[] = [];
  BREAK.lastIndex = 0;
  for (let found = BREAK.exec(text); found !== null; found = BREAK.exec(text)) {
    breaks.push(found.index);
    starts.push(found.index + found[0].length);
  }
  breaks.push(text.length);
  return { starts, breaks };
}

// One round: every line a range touches left out, each run of such lines one marker that keeps the run's last break.
// The ranges come in order of their beginnings, so one sweep over the lines finds the lines they touch.
function leftOutLines(text: string, spans: readonly (readonly [number, number])[], work: Work): string {
  const { starts, breaks } = linesOf(text);
  const count = starts.length;
  const touched = new Uint8Array(count);
  let next = 0; // the next range not yet begun
  let reach = -1; // the furthest end of the ranges begun so far
  for (let line = 0; line < count; line += 1) {
    const end = line + 1 < count ? starts[line + 1]! : text.length;
    while (next < spans.length && spans[next]![0] < end) reach = Math.max(reach, spans[next++]![1]);
    if (reach > starts[line]!) touched[line] = 1;
  }
  let out = '';
  for (let line = 0; line < count; line += 1) {
    const end = line + 1 < count ? starts[line + 1]! : text.length;
    if (touched[line] === 0) {
      out += text.slice(starts[line], end);
      continue;
    }
    let last = line;
    while (last + 1 < count && touched[last + 1] === 1) last += 1;
    out += (last === line ? LINE_LEFT_OUT : LINES_LEFT_OUT) + text.slice(breaks[last], last + 1 < count ? starts[last + 1] : text.length);
    line = last;
  }
  work.steps += 3 * count + text.length + out.length;
  return out;
}

/**
 * Content with every line a reading of the grant's opening touches left out (Design 2): one line by itself becomes
 * `LINE_LEFT_OUT`, lines next to each other one `LINES_LEFT_OUT`, each run keeping its last line's break; again, on the
 * result, until no reading is left, since taking a line out can let a bracket before it pair with one after it. Content
 * that does not quote the opening comes back byte for byte. Each round's work is charged to a budget in proportion to the
 * content's length (`LEAVE_OUT_WORK_PER_CHAR`); when it is spent and a reading is still there, the whole content is
 * `LINES_LEFT_OUT`. What it returns quotes no opening: it returns only text in which `grantSpans` finds nothing, or the
 * marker, whose words hold neither the opening's first letter nor a run of its letters longer than one.
 */
export function leaveOutGrant(content: string, work?: Work): string {
  const budget = LEAVE_OUT_WORK_PER_CHAR * (content.length + LEAVE_OUT_WORK_FLOOR_CHARS);
  const meter = { steps: 0 };
  let text = content;
  for (;;) {
    const spans = grantSpans(text, meter);
    if (spans.length === 0) break;
    if (meter.steps > budget) {
      text = LINES_LEFT_OUT;
      break;
    }
    text = leftOutLines(text, spans, meter);
  }
  if (work) work.steps += meter.steps;
  return text;
}

/** Content as a form carries it (Design 3): its lines that quote the opening left out, inside one pasted segment. */
export function composedContent(content: string, tagId: string, work?: Work): string {
  return wrapPasted(tagId, leaveOutGrant(content, work));
}

/** A range of a text, half-open; a list of them in order. */
export type Range = readonly [from: number, to: number];

const SEGMENT_HEAD = '\n\n<pasted_content id="';
const CLOSING_HEAD = '\n</pasted_content id="';
const TAG_ID = /^[0-9a-f]{4}$/;

// The segment `wrapPasted` writes, at `at`; `closingAt(id, from)` finds the first closing tag of that id at a line's start
// (its line break before it) from `from` on
function segmentAt(text: string, at: number, closingAt: (id: string, from: number) => number): { body: string; end: number } | null {
  if (!text.startsWith(SEGMENT_HEAD, at)) return null;
  const id = text.slice(at + SEGMENT_HEAD.length, at + SEGMENT_HEAD.length + 4);
  if (!TAG_ID.test(id) || !text.startsWith('">\n', at + SEGMENT_HEAD.length + 4)) return null;
  const body = at + SEGMENT_HEAD.length + 4 + 3;
  const close = closingAt(id, body);
  if (close < 0) return null;
  const tail = close + CLOSING_HEAD.length + 4; // the closing tag's `">`
  if (!text.startsWith('">\n', tail)) return null;
  return { body: text.slice(body, close), end: tail + 3 };
}

/**
 * The segment `wrapPasted` wrote at `at` (§C): its two line breaks, the opening tag with a four-hex id, a line break, the
 * body up to the first closing tag of the same id at a line's start, and the one line break after it. The body as it
 * stands, its tags neutralised; `end` is just past the segment. Null where the text there is no such segment.
 */
export function takeSegment(text: string, at: number): { body: string; end: number } | null {
  return segmentAt(text, at, (id, from) => text.indexOf(`${CLOSING_HEAD}${id}">`, from));
}

/**
 * A form's text with every segment `wrapPasted` wrote in it read in place (§C, Design 4): the segment's body, its
 * neutralised tags restored, where the segment stood, the frame's own line breaks dropped (the two before the opening
 * tag, the one after the closing tag); and the range of each body in the text it gives. Called only on a text one of
 * the forms' recognisers accepted. Linear: the closing tags are found in one pass, and each segment takes the first of its
 * id after its opening.
 */
export function segmentsInPlace(text: string): { text: string; composed: Range[] } {
  const closings = new Map<string, { at: number[]; next: number }>();
  for (let at = text.indexOf(CLOSING_HEAD); at >= 0; at = text.indexOf(CLOSING_HEAD, at + 1)) {
    if (!text.startsWith('">', at + CLOSING_HEAD.length + 4)) continue;
    const id = text.slice(at + CLOSING_HEAD.length, at + CLOSING_HEAD.length + 4);
    const of = closings.get(id) ?? { at: [], next: 0 };
    of.at.push(at);
    closings.set(id, of);
  }
  const closingAt = (id: string, from: number): number => {
    const of = closings.get(id);
    if (of === undefined) return -1;
    while (of.next < of.at.length && of.at[of.next]! < from) of.next += 1;
    return of.next < of.at.length ? of.at[of.next]! : -1;
  };
  let out = '';
  const composed: Range[] = [];
  let from = 0;
  for (let at = text.indexOf(SEGMENT_HEAD); at >= 0; at = text.indexOf(SEGMENT_HEAD, from)) {
    const segment = segmentAt(text, at, closingAt);
    if (segment === null) {
      out += text.slice(from, at + 1);
      from = at + 1;
      continue;
    }
    out += text.slice(from, at);
    const body = restorePastedTags(segment.body);
    composed.push([out.length, out.length + body.length]);
    out += body;
    from = segment.end;
  }
  return { text: out + text.slice(from), composed };
}
