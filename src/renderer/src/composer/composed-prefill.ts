// Ticket 733a (docs/doperpowers/plans/2026-11-17-ticket-733a-composed-forms.md, Design 5 and §D): what a bubble edited in
// place is sent again as, for Send, for Fork and for the send after a rewind alike. Two questions, kept apart. Which form
// the stored row is: only a form's own reader, reading the row at its own place, says so (`storedFormOf`, when the edit
// begins); a search for a form's fixed words anywhere decides nothing here. Where what the person did not write stands:
// the form's reader says, never the row's ranges, which are layout only (they find a body again in the edited text and
// prove nothing about whether it was ever cleaned). So every slot a model, a command or a page wrote goes, with every chip
// in it opened to its body, through `leaveOutGrant` and one pasted segment, whatever the ranges; where the edited text can
// no longer be taken apart, the whole of it does (fail closed). A row of no form is the person's text, sent as typed.
// Pure: the result is a prefill the composer's serialiser frames (its one segment is a pasted atom).
import { PROMOTION_ANCHOR, PROMOTION_HEAD, anchorTag, readPromotion, readQuote } from '@shared/anchor/message';
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
 * drawn in place, each a slot (`bodies`, in order). A slot is the place its row records (the architect's ruling 4376):
 * `at`, in the edit's text as it began, and the `body` that stood there.
 */
export type Slot = { at: Range; body: string };
export type StoredForm = { kind: 'plan' } | { kind: 'promotion'; body: Slot | null } | { kind: 'comment'; quote: Slot | null } | { kind: 'several'; bodies: Slot[] } | { kind: 'whole' } | { kind: 'relay' } | null;
// The same form with each slot a range of the row's own text, as the forms' readers and the transcript record it
type RowForm = { kind: 'plan' } | { kind: 'promotion'; body: Range | null } | { kind: 'comment'; quote: Range | null } | { kind: 'several'; bodies: Range[] } | { kind: 'whole' } | { kind: 'relay' } | null;

const PLAN_HEAD = `${PLAN_LEAD}\n\n`;
const PROMOTION_PARAGRAPH = `${PROMOTION_HEAD}\n\n`;


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
export const storedFormOf = (row: UserRow): StoredForm => storedRowEdit(row).form;

function rowFormOf(row: UserRow): RowForm {
  const composed = row.composed ?? [];
  // the architect's ruling 4366: several comments, each segment of their words a slot, as their writer framed it
  if (row.comments !== undefined && row.comments !== null) return { kind: 'several', bodies: composed };
  if (row.anchor !== undefined && row.anchorFrame !== undefined) {
    if (row.anchorFrame.destination !== null) {
      // every segment is a slot or the whole is: a quote only where it is the words' one segment (or, from the earlier
      // writer, where they hold none), and words holding any other segment go framed whole
      const quote = readQuote(row.anchor, row.text, composed);
      if (quote !== null && composed.length <= 1) return { kind: 'comment', quote };
      return composed.length > 0 ? { kind: 'whole' } : { kind: 'comment', quote: null };
    }
    if (anchorTag(row.anchor) !== anchorTag(PROMOTION_ANCHOR)) return null;
    return { kind: 'promotion', body: readPromotion(row.text, composed)?.body ?? null };
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
  const form = rowFormOf(row);
  const ranges = form === null ? [] : form.kind === 'promotion' ? (form.body === null ? [] : [form.body]) : form.kind === 'comment' ? (form.quote === null ? [] : [form.quote]) : form.kind === 'several' ? form.bodies : [];
  const { text, bodies } = chipsAtTheirPlaces(row);
  const prefill = rowPrefill({ ...row, text });
  const images = prefill.images ?? [];
  if (ranges.length === 0) return { text: prefill.text, bodies, images, form: form as StoredForm };
  // a form drawn in place holds no chip (its row records none); one that did is no shape a writer of MAWS writes: closed
  if (row.placeholders.length > 0) return { text: prefill.text, bodies, images, form: { kind: 'whole' } };
  // the architect's ruling 4376: each slot is carried at the place the row records it, into the edit's text
  const placed = typedAround(row.text, ranges);
  const slots = placed.slots.map((at): Slot => ({ at, body: placed.text.slice(at[0], at[1]) }));
  const typedForm: StoredForm = form!.kind === 'promotion' ? { kind: 'promotion', body: slots[0]! } : form!.kind === 'comment' ? { kind: 'comment', quote: slots[0]! } : { kind: 'several', bodies: slots };
  return { text: placed.text, bodies: {}, images, form: typedForm };
}

// The row's text as the edit holds it (`typedFromRowText`), read a piece at a time around `ranges` (in order, apart), and
// where each range stands in it
function typedAround(text: string, ranges: readonly Range[]): { text: string; slots: Range[] } {
  let out = '';
  let from = 0;
  const slots: Range[] = [];
  for (const [start, end] of ranges) {
    out += typedFromRowText(text.slice(from, start));
    const body = typedFromRowText(text.slice(start, end));
    slots.push([out.length, out.length + body.length]);
    out += body;
    from = end;
  }
  return { text: out + typedFromRowText(text.slice(from)), slots };
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
  // compared as the opening reads a spelling: by its numbers, whatever digits write them (the architect's ruling 4376)
  const keyOf = (n: number, lines: number) => pastedPlaceholder(n, lines);
  const shared = spellings.some((spelling) => !chips.some((chip) => chip.from === spelling.start) && chips.some((chip) => keyOf(chip.n, chip.lines) === keyOf(spelling.n, spelling.lines)));
  const fresh = freshNumbers(spellings);
  const bodies: Record<string, string> = {};
  let text = '';
  let from = 0;
  for (const chip of chips) {
    const spelling = shared ? keyOf(fresh(), chip.lines) : spellingAt(chip.from, chip.to);
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
  return { prefill: framedAsForm(storedRowEdit(row), 'as stored'), search: drawn.text, key: keyOf(drawn.text, (drawn.pasted ?? []).map((body) => body.text)) };
}

/** What an edited row is sent again as (Design 5's table): the edit's prefill with each slot of its form one pasted atom. */
export const composedPrefill = (edit: Edit): Prefill => framedAsForm(edit, 'edited');

/**
 * Each slot of the edit's form one pasted atom. A slot is found at the place its row records (the architect's ruling
 * 4376), never by its text: it counts while the text there is still its body, ending at the form's separator or the
 * text's end, and otherwise the whole text is the slot (fail closed). An edited text also holds Design 5's rule that the
 * body stands there exactly once: a copy of it elsewhere leaves the whole text the slot. A text as stored (a recall)
 * is the row's own, its places exact, and goes as its first send framed it.
 */
function framedAsForm(edit: Edit, as: 'as stored' | 'edited'): Prefill {
  const { text, form } = edit;
  const typed: Prefill = { text, bodies: edit.bodies ?? {}, images: edit.images ?? [] };
  if (form === null) return typed;
  const holds = (slot: Slot, separator: string) => {
    const [from, to] = slot.at;
    if (slot.body === '' || text.slice(from, to) !== slot.body || (to < text.length && !text.startsWith(separator, to))) return false;
    return as === 'as stored' || (text.indexOf(slot.body) === from && text.indexOf(slot.body, from + 1) < 0);
  };
  switch (form.kind) {
    case 'plan':
      return text.startsWith(PLAN_HEAD) ? slotAt(edit, PLAN_HEAD.length, text.length) : whole(edit);
    case 'promotion':
      return form.body !== null && text.startsWith(PROMOTION_PARAGRAPH) && form.body.at[0] === PROMOTION_PARAGRAPH.length && holds(form.body, '\n\n') ? slotsAt(edit, [form.body.at]) : whole(edit);
    case 'several':
      return form.bodies.every((slot) => holds(slot, '\n')) ? slotsAt(edit, form.bodies.map((slot) => slot.at)) : whole(edit);
    case 'comment':
      if (form.quote === null) return typed;
      return holds(form.quote, '\n') ? slotsAt(edit, [form.quote.at]) : whole(edit);
    case 'whole':
    case 'relay':
      return whole(edit);
  }
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
// The smallest positive numbers no spelling of `taken` holds, one per call (the reviewer's last re-read: a number past
// the largest a text spells is not safe, since a typed spelling can be 2^53, where adding one changes nothing, or past
// 1e21, which no parser reads back). Each is at most the count of spellings and calls, so it reads back as written.
function freshNumbers(taken: readonly { n: number }[]): () => number {
  const held = new Set(taken.map((spelling) => spelling.n));
  let n = 0;
  return () => {
    do n += 1;
    while (held.has(n));
    return n;
  };
}

function slotsAt(edit: Edit, ranges: readonly Range[]): Prefill {
  const bodies = edit.bodies ?? {};
  const others = parsePlaceholders([edit.text, ...Object.keys(bodies)].join('\n')).filter((placeholder) => placeholder.kind === 'pasted');
  const fresh = freshNumbers(others);
  const added: Record<string, string> = {};
  let text = '';
  let at = 0;
  for (const [from, to] of ranges) {
    const content = leaveOutGrant(opened(edit.text.slice(from, to), bodies));
    text += edit.text.slice(at, from);
    if (content !== '') {
      const key = pastedPlaceholder(fresh(), countLines(content));
      text += key;
      added[key] = content;
    }
    at = to;
  }
  return { text: text + edit.text.slice(at), bodies: { ...bodies, ...added }, images: edit.images ?? [] };
}

const slotAt = (edit: Edit, from: number, to: number): Prefill => slotsAt(edit, [[from, to]]);
const whole = (edit: Edit): Prefill => slotAt(edit, 0, edit.text.length);
