// A question's words as a line shows them, a receipt as the record writes it, and the draft and the Send every surface
// builds its answers with (§B `words.ts`; the composite's §4.1, §4.2 and §8). Pure.
import type { SheetBy, SheetLine, SheetQuestion } from './model';
import { codePoints, cut } from './text';

// A sentence ends at a run of `.`, `?` or `!` (closing quotes and brackets after it kept) that ends a word.
const SENTENCE_END = /[.?!]+["'”’)\]]*(?=\s|$)/g;

/**
 * The question's first sentence that ends in a question mark, or its first sentence when none does: a row line or a
 * waiting line shows what is asked, not the statement before it. A sentence runs through the first `.`, `?` or `!`
 * that ends a word, or to a line break.
 */
export function questionSentence(text: string): string {
  const sentences: { text: string; asks: boolean }[] = [];
  const add = (sentence: string, asks: boolean): void => {
    const trimmed = sentence.trim();
    if (trimmed !== '') sentences.push({ text: trimmed, asks });
  };
  for (const line of text.split(/\r?\n/)) {
    let start = 0;
    for (const end of line.matchAll(SENTENCE_END)) {
      const stop = end.index + end[0].length;
      add(line.slice(start, stop), end[0].includes('?'));
      start = stop;
    }
    add(line.slice(start), false);
  }
  return (sentences.find((sentence) => sentence.asks) ?? sentences[0])?.text ?? '';
}

/** A receipt: the picked labels joined by ", ", or with none the text's first 80 characters (C2's I2, the record's). */
export const receiptOf = (labels: readonly string[], text: string): string => (labels.length > 0 ? labels.join(', ') : cut(text, 80));

/**
 * What the person typed for one question, and the revision they typed it against. `picks` are labels, `images` are
 * `uploads/<name>`, and `replaces` is the key of a queued answer this draft edits. A draft is never moved onto another
 * revision by code: only the person's act on the rewritten card does that (`confirmDraft`).
 */
export interface QuestionDraft {
  revision: number;
  picks: string[];
  text: string;
  images: string[];
  replaces?: string;
}

const hasText = (text: string): boolean => text.trim() !== '';

/** A pick, or text that is not blank. An image alone is no answer (composite §4.1). */
export const hasAnswer = (draft: QuestionDraft | undefined): boolean => draft !== undefined && (draft.picks.length > 0 || hasText(draft.text));

/** Whether the draft was typed against the question's wording as it stands. */
export const isConfirmed = (draft: QuestionDraft, question: SheetQuestion): boolean => draft.revision === question.revision;

/** The person's act on a rewritten card: the draft takes the question's revision, keeping the picks that are still labels. */
export function confirmDraft(draft: QuestionDraft, question: SheetQuestion): QuestionDraft {
  const labels = question.options.map((option) => option.label);
  const picks = draft.picks.filter((pick) => labels.includes(pick));
  return { ...draft, revision: question.revision, picks: question.multiSelect ? picks : picks.slice(0, 1) };
}

/** An inbox line's text is at most this many code points (the line schema's bound). */
export const TEXT_MAX = 20000;

/** A text the line schema would refuse: the draft is kept and edited, and stays out of Send until it is short enough. */
export const isTooLong = (draft: QuestionDraft): boolean => draft.text.length > TEXT_MAX && codePoints(draft.text) > TEXT_MAX;

/**
 * Whether the answer the card shows is no longer the one the draft was written against: another surface queued an
 * answer on the question while this draft was written (it replaces nothing), or the queued answer it edits is no longer
 * the one standing. Such a draft is kept, and is out of Send until the person chooses.
 */
export const draftConflict = (draft: QuestionDraft, question: SheetQuestion): boolean => draft.replaces !== question.queued?.key;

/** One call of the door takes at most fifty inbox lines (I3), and one Send is one call. */
export const SEND_MAX_LINES = 50;

/**
 * One Send: the inbox lines of the confirmed drafts with an answer, the open questions taken in their order, but for a
 * draft in conflict with the answer its card shows and one whose text is too long. A draft
 * that edits a queued answer gives a retract of that answer's key and then its answer, never parted. It stops before
 * the draft whose lines would pass `SEND_MAX_LINES`: `ids` are the questions it answers, `left` the confirmed drafts
 * with an answer it did not take, which stay drafts for the next Send.
 */
export function sendOf(
  open: readonly SheetQuestion[],
  drafts: ReadonlyMap<string, QuestionDraft>,
  by: SheetBy,
  newKey: () => string,
): { lines: SheetLine[]; ids: string[]; left: number } {
  const lines: SheetLine[] = [];
  const ids: string[] = [];
  let left = 0;
  for (const question of open) {
    const draft = drafts.get(question.id);
    if (draft === undefined || !hasAnswer(draft) || !isConfirmed(draft, question) || draftConflict(draft, question) || isTooLong(draft)) continue;
    const size = draft.replaces === undefined ? 1 : 2;
    if (left > 0 || lines.length + size > SEND_MAX_LINES) {
      left += 1;
      continue;
    }
    if (draft.replaces !== undefined) lines.push({ v: 1, key: newKey(), kind: 'retract', target: draft.replaces, by });
    lines.push({
      v: 1,
      key: newKey(),
      kind: 'answer',
      id: question.id,
      revision: draft.revision,
      ...(draft.picks.length > 0 ? { picks: [...draft.picks] } : {}),
      ...(hasText(draft.text) ? { text: draft.text } : {}),
      ...(draft.images.length > 0 ? { images: [...draft.images] } : {}),
      by,
    });
    ids.push(question.id);
  }
  return { lines, ids, left };
}
