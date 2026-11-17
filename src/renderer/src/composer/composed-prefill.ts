// Ticket 733a (docs/doperpowers/plans/2026-11-17-ticket-733a-composed-forms.md, Design 5 and §D): what a bubble edited in
// place is sent again as, for Send, for Fork and for the send after a rewind alike. Two questions, kept apart. Which form
// the stored row is: only a form's own reader, reading the row at its own place, says so (`storedFormOf`, when the edit
// begins); a search for a form's fixed words anywhere decides nothing here. Where what the person did not write stands:
// the form's reader says, never the row's ranges, which are layout only (they find a body again in the edited text and
// prove nothing about whether it was ever cleaned). So every slot a model, a command or a page wrote goes, with every chip
// in it opened to its body, through `leaveOutGrant` and one pasted segment, whatever the ranges; where the edited text can
// no longer be taken apart, the whole of it does (fail closed). A row of no form is the person's text, sent as typed.
// Pure: the result is a prefill the composer's serialiser frames (its one segment is a pasted atom).
import { BEFORE_THE_CHANGE, PROMOTION_ANCHOR, PROMOTION_HEAD, anchorTag, readPromotion, readQuote } from '@shared/anchor/message';
import { pastedPlaceholder } from '@shared/composer/pasted-content';
import { asTyped } from '@shared/engine/grant';
import { countLines, parsePlaceholders } from '@shared/composer/pasted-framing';
import { leaveOutGrant, type Range } from '@shared/engine/composed-content';
import { PLAN_LEAD } from '@shared/engine/host-prompts';
import type { Prefill } from '../stores/composer';
import { readRelay } from '../tools/agents/model/relay';
import { rowPrefill, type UserRow } from './edit-prefill';
import { typedFromRowText } from './editor/recall';
import { placeholdersOf } from '../transcript/model/user-text'; // the architect's ruling 4368

/**
 * The form of the row an edit began from, by the forms' own readers (§D); null is a person's message. `whole`: a comment
 * whose words hold a segment that is not its quoted line (words an earlier resend framed whole, say), its whole text the
 * slot. `several` (the architect's ruling 4366): a message of several comments, every segment its comments' words held
 * drawn in place, each a slot (`bodies`, in order).
 */
export type StoredForm = { kind: 'plan' } | { kind: 'promotion'; body: string | null } | { kind: 'comment'; quote: string | null } | { kind: 'several'; bodies: string[] } | { kind: 'whole' } | { kind: 'relay' } | null;

const PLAN_HEAD = `${PLAN_LEAD}\n\n`;
const PROMOTION_PARAGRAPH = `${PROMOTION_HEAD}\n\n`;

// The text that stood at a range of the row, as the edit's text holds it (its prefill's reading, `typedFromRowText`)
const typedAt = (row: UserRow, [from, to]: Range) => typedFromRowText(row.text.slice(from, to));

/**
 * The stored row's form, as an edit of it begins. An anchored row with a destination is a comment, its quoted line the one
 * `readQuote` names when it is the words' one segment (or the earlier writer's line, in words that hold none); words that
 * hold any other segment (an earlier resend's fail-closed fallback framed them whole, or a paste stands in them) go
 * framed whole, since sent as typed a body would leave its segment and read as the person's. An anchored row with none
 * is a promoted side question only under the promotion's own anchor, its body the segment `readPromotion` names (fail
 * closed: with no body, the whole edited text is the slot, also where an edit took the head out); under any other
 * anchor no writer of MAWS wrote it, at this build or an earlier one (the architect's ruling of 2026-11-17), so it is the
 * person's. A plan
 * prompt's row begins with its whole first line and a blank line (this build's shape, the earlier writer's, or a person's
 * message typed so: the architect's ruling of 2026-11-17, (3)), or with that line and a pasted block that took the blank
 * line. A relay begins with one of its writer's openings and holds its closing words.
 */
export function storedFormOf(row: UserRow): StoredForm {
  const composed = row.composed ?? [];
  // the architect's ruling 4366: several comments, each segment of their words a slot, as their writer framed it
  if (row.comments !== undefined && row.comments !== null) return { kind: 'several', bodies: composed.map((range) => typedAt(row, range)) };
  if (row.anchor !== undefined && row.anchorFrame !== undefined) {
    if (row.anchorFrame.destination !== null) {
      // every segment is a slot or the whole is: a quote only where it is the words' one segment (or, from the earlier
      // writer, where they hold none), and words holding any other segment go framed whole
      const quote = readQuote(row.anchor, row.text, composed);
      if (quote !== null && composed.length <= 1) return { kind: 'comment', quote: typedAt(row, quote) };
      return composed.length > 0 ? { kind: 'whole' } : { kind: 'comment', quote: null };
    }
    if (anchorTag(row.anchor) !== anchorTag(PROMOTION_ANCHOR)) return null;
    const body = readPromotion(row.text, composed)?.body ?? null;
    return { kind: 'promotion', body: body === null ? null : typedAt(row, body) };
  }
  if (row.text.startsWith(PLAN_HEAD) || (row.text.startsWith(`${PLAN_LEAD}\n`) && row.placeholders.includes(PLAN_LEAD.length + 1))) return { kind: 'plan' };
  return readRelay(row.text) === null ? null : { kind: 'relay' };
}

type Edit = { text: string; bodies?: Readonly<Record<string, string>>; images?: Prefill['images']; form: StoredForm };

/**
 * The edit a stored row opens (Design 5): its text as drawn and typed, each chip with the body pasted at its place, its
 * images, and its form by the forms' own readers. The bubble's editor holds it; it goes out through `composedPrefill`
 * and back into the composer through `handBackEdit`.
 */
export function storedRowEdit(row: UserRow): { text: string; bodies: Record<string, string>; images: NonNullable<Prefill['images']>; form: StoredForm } {
  const { text, bodies } = chipsAtTheirPlaces(row);
  const prefill = rowPrefill({ ...row, text });
  return { text: prefill.text, bodies, images: prefill.images ?? [], form: storedFormOf(row) };
}

/**
 * The architect's rulings 4345 (2) and 4368: a placeholder's spelling is a chip only where the row records one, at that
 * place (`placeholders`, which the transcript derives from the pasted blocks of every row it reads, `splitPastedSegments`
 * in transcript/model/user-text.ts); every other spelling of it is the text's own. The edit's text is the person's to
 * change and keys a chip by its spelling, so where a recorded chip's spelling also stands elsewhere in the text, the
 * recorded chips take numbers no spelling in the text holds; the body each names is the one pasted at its place.
 */
function chipsAtTheirPlaces(row: UserRow): { text: string; bodies: Record<string, string> } {
  const chips = placeholdersOf(row.text, row.attachments, row.placeholders);
  const spellings = parsePlaceholders(row.text).filter((placeholder) => placeholder.kind === 'pasted');
  const spellingAt = (from: number, to: number) => row.text.slice(from, to);
  const shared = spellings.some((spelling) => !chips.some((chip) => chip.from === spelling.start) && chips.some((chip) => spellingAt(chip.from, chip.to) === spellingAt(spelling.start, spelling.end)));
  let n = shared ? Math.max(0, ...spellings.map((spelling) => spelling.n)) : 0;
  const bodies: Record<string, string> = {};
  let text = '';
  let from = 0;
  for (const chip of chips) {
    const spelling = shared ? pastedPlaceholder((n += 1), chip.lines) : spellingAt(chip.from, chip.to);
    text += row.text.slice(from, chip.from) + spelling;
    from = chip.to;
    if (chip.attachment.text !== null) bodies[spelling] = asTyped(chip.attachment.text); // UX wave U1c: as pasted
  }
  return { text: text + row.text.slice(from), bodies };
}

/**
 * A stored row put back into the composer from where it is kept (the branch's review, the architect's rulings on history
 * recall and 4366): `prefill`, what the composer loads, the row's edit as its form's reader says. The row as drawn leaves
 * here only as strings: `search`, the text the history's search reads, and `key`, what `keyOf` makes of the drawn text and
 * its pasted bodies, by which the history collapses its entries.
 */
export function storedRowPrefill(row: UserRow, keyOf: (text: string, bodies: (string | null)[]) => string): { prefill: Prefill; search: string; key: string } {
  const drawn = rowPrefill(row);
  return { prefill: composedPrefill(storedRowEdit(row)), search: drawn.text, key: keyOf(drawn.text, (drawn.pasted ?? []).map((body) => body.text)) };
}

/** What an edited row is sent again as (Design 5's table): the edit's prefill with each slot of its form one pasted atom. */
export function composedPrefill(edit: Edit): Prefill {
  const { text, form } = edit;
  const typed: Prefill = { text, bodies: edit.bodies ?? {}, images: edit.images ?? [] };
  if (form === null) return typed;
  switch (form.kind) {
    case 'plan':
      return text.startsWith(PLAN_HEAD) ? slotAt(edit, PLAN_HEAD.length, text.length) : whole(edit);
    case 'promotion':
      return form.body !== null && standsOnceAt(text, form.body, PROMOTION_PARAGRAPH.length, '\n\n') && text.startsWith(PROMOTION_PARAGRAPH) ? slotAt(edit, PROMOTION_PARAGRAPH.length, PROMOTION_PARAGRAPH.length + form.body.length) : whole(edit);
    case 'several': {
      const ranges = placedInOrder(text, form.bodies);
      return ranges === null ? whole(edit) : slotsAt(edit, ranges);
    }
    case 'comment': {
      if (form.quote === null) return typed;
      const at = text.startsWith(`${BEFORE_THE_CHANGE}\n`) ? BEFORE_THE_CHANGE.length + 1 : 0;
      return standsOnceAt(text, form.quote, at, '\n') ? slotAt(edit, at, at + form.quote.length) : whole(edit);
    }
    case 'whole':
    case 'relay':
      return whole(edit);
  }
}

// Whether `body` stands in `text` exactly once, at `at`, and ends there at the form's separator or at the text's end.
function standsOnceAt(text: string, body: string, at: number, separator: string): boolean {
  if (body === '' || text.indexOf(body) !== at) return false;
  const end = at + body.length;
  return text.indexOf(body, at + 1) < 0 && (end === text.length || text.startsWith(separator, end));
}

// Where each of `bodies` stands in `text`, in order, each on lines of its own (from a line's start to a line's end); null
// where one does not, and the whole text is then the slot
function placedInOrder(text: string, bodies: readonly string[]): Range[] | null {
  const ranges: Range[] = [];
  let from = 0;
  for (const body of bodies) {
    const at = body === '' ? -1 : text.indexOf(body, from);
    const end = at + body.length;
    if (at < 0 || (at > 0 && text[at - 1] !== '\n') || (end < text.length && text[end] !== '\n')) return null;
    ranges.push([at, end]);
    from = end;
  }
  return ranges;
}

// The slot's text with every chip in it opened to the body it named when the edit began. A placeholder's spelling is a
// chip only where the stored row recorded an attachment under it (the edit's `bodies`, keyed by the placeholder); any
// other is the slot's own text, a form's body drawn in place holding none (the branch's review: a model's text that
// spells a placeholder goes as it was written, never left out as an unavailable chip)
function opened(slot: string, bodies: Readonly<Record<string, string>>): string {
  let out = '';
  let from = 0;
  for (const placeholder of parsePlaceholders(slot)) {
    const body = placeholder.kind === 'pasted' ? bodies[pastedPlaceholder(placeholder.n, placeholder.lines)] : undefined;
    if (body === undefined) continue;
    out += slot.slice(from, placeholder.start) + body;
    from = placeholder.end;
  }
  return out + slot.slice(from);
}

// The edit with each of `ranges` (in order, apart) of its text one pasted atom: the slot opened and left out, under a
// placeholder no other in the text or the edit's bodies holds; an empty slot is no atom
function slotsAt(edit: Edit, ranges: readonly Range[]): Prefill {
  const bodies = edit.bodies ?? {};
  const others = parsePlaceholders([edit.text, ...Object.keys(bodies)].join('\n')).filter((placeholder) => placeholder.kind === 'pasted');
  let n = Math.max(0, ...others.map((placeholder) => placeholder.n));
  const added: Record<string, string> = {};
  let text = '';
  let at = 0;
  for (const [from, to] of ranges) {
    const content = leaveOutGrant(opened(edit.text.slice(from, to), bodies));
    text += edit.text.slice(at, from);
    if (content !== '') {
      n += 1;
      const key = pastedPlaceholder(n, countLines(content));
      text += key;
      added[key] = content;
    }
    at = to;
  }
  return { text: text + edit.text.slice(at), bodies: { ...bodies, ...added }, images: edit.images ?? [] };
}

const slotAt = (edit: Edit, from: number, to: number): Prefill => slotsAt(edit, [[from, to]]);
const whole = (edit: Edit): Prefill => slotAt(edit, 0, edit.text.length);
