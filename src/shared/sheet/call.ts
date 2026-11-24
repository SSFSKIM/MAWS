// A stored call of the question sheet (contract X7; C2's I6; the pinned set's `grammar/`): which form a call of the
// tool is, and what it did, read from its input and its result's text alone, long after the record is gone. Pure.

/** A call of the sheet's form: its input has `ask` or `withdraw`. Today's form has `questions`. */
export function isSheetCall(input: unknown): boolean {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  return Object.hasOwn(input, 'ask') || Object.hasOwn(input, 'withdraw');
}

export type SheetResult =
  | { form: 'sentences'; added: { id: string; entry?: number }[]; revised: { id: string; entry?: number; revision: number }[]; withdrew: string[] }
  | { form: 'nothing' }
  | { form: 'unknown' };

/** The pattern a reader matches against a result's first line, whole: the pinned `grammar/result.md`'s. */
export const RESULT_PATTERN =
  /^(?:Nothing done\.|Outcome not known yet\.|Added q[0-9]+(?: \(entry [0-9]+\))?(?:, q[0-9]+(?: \(entry [0-9]+\))?)*\.(?: Revised q[0-9]+ \((?:entry [0-9]+, )?revision [0-9]+\)(?:, q[0-9]+ \((?:entry [0-9]+, )?revision [0-9]+\))*\.)?(?: Withdrew q[0-9]+(?:, q[0-9]+)*\.)?|Revised q[0-9]+ \((?:entry [0-9]+, )?revision [0-9]+\)(?:, q[0-9]+ \((?:entry [0-9]+, )?revision [0-9]+\))*\.(?: Withdrew q[0-9]+(?:, q[0-9]+)*\.)?|Withdrew q[0-9]+(?:, q[0-9]+)*\.)$/;
const SENTENCE = /(Added|Revised|Withdrew) ([^.]*)\./g;
const ITEM = /(q[0-9]+)(?: \((?:entry ([0-9]+))?(?:, )?(?:revision ([0-9]+))?\))?/g;

/** What a call did, from its result's first line; null when that line is not of the grammar (a denial is not). */
export function parseSheetResult(text: string): SheetResult | null {
  const first = text.split('\n')[0];
  if (!RESULT_PATTERN.test(first)) return null;
  if (first === 'Nothing done.') return { form: 'nothing' };
  if (first === 'Outcome not known yet.') return { form: 'unknown' };
  const out: Extract<SheetResult, { form: 'sentences' }> = { form: 'sentences', added: [], revised: [], withdrew: [] };
  for (const [, word, body] of first.matchAll(SENTENCE)) {
    for (const [, id, entry, revision] of body.matchAll(ITEM)) {
      if (word === 'Withdrew') out.withdrew.push(id);
      else if (word === 'Added') out.added.push(entry === undefined ? { id } : { id, entry: Number(entry) });
      else out.revised.push({ id, ...(entry === undefined ? {} : { entry: Number(entry) }), revision: Number(revision) });
    }
  }
  return out;
}

/**
 * One entry of a call's `ask`, and what became of it. `entry` is its place in `ask`, from 1. `id` is the question it
 * is on the sheet as: the added or revised one; the id a revise names while the outcome is not known; null for a
 * refused entry and for a new entry whose outcome is not known. `revision` is a revised entry's.
 */
export interface CallEntry {
  entry: number;
  id: string | null;
  revision: number | null;
  outcome: 'added' | 'revised' | 'refused' | 'unknown';
  header: string | null;
  question: string;
  options: string[];
  multiSelect: boolean;
}

interface AskedEntry {
  named: string | null; // the id a revise names
  header: string | null;
  question: string;
  options: string[];
  multiSelect: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const stringOr = <T>(value: unknown, otherwise: T): string | T => (typeof value === 'string' ? value : otherwise);

function askedOf(input: unknown): AskedEntry[] {
  const ask = isObject(input) && Array.isArray(input.ask) ? input.ask : [];
  return ask.map((entry): AskedEntry => {
    const fields = isObject(entry) ? entry : {};
    const options = Array.isArray(fields.options) ? fields.options : [];
    return {
      named: stringOr(fields.id, null),
      header: stringOr(fields.header, null),
      question: stringOr(fields.question, ''),
      options: options.map((option) => (isObject(option) ? stringOr(option.label, '') : '')),
      multiSelect: fields.multiSelect === true,
    };
  });
}

/**
 * The entries of a stored call, each paired with its id by the grammar's rule (I6): an entry that names an id is a
 * revise of it; the entries that name none are the added ones, in order, paired with `added` by place when no item
 * carries `(entry n)` and by that number when any does; an entry in neither sentence was refused. `resultText` is the
 * result's text whole, since a refusal's reasons are on a later line (`notDone`, `Not done: …` whole); null when the
 * call has no result yet. With no result, a first line of form `unknown`, or one not of the grammar, no entry has an
 * outcome and no new entry an id.
 */
export function callEntries(
  input: unknown,
  resultText: string | null,
): { result: SheetResult | null; entries: CallEntry[]; withdrew: string[]; notDone: string | null } {
  const asked = askedOf(input);
  const result = resultText === null ? null : parseSheetResult(resultText);
  const words = (asked: AskedEntry) => ({ header: asked.header, question: asked.question, options: asked.options, multiSelect: asked.multiSelect });

  if (result === null || result.form === 'unknown') {
    const entries = asked.map((one, index): CallEntry => ({ entry: index + 1, id: one.named, revision: null, outcome: 'unknown', ...words(one) }));
    return { result, entries, withdrew: [], notDone: null };
  }
  const notDone = resultText!.split('\n').slice(1).find((line) => line.startsWith('Not done: ')) ?? null;
  if (result.form === 'nothing') {
    const entries = asked.map((one, index): CallEntry => ({ entry: index + 1, id: null, revision: null, outcome: 'refused', ...words(one) }));
    return { result, entries, withdrew: [], notDone };
  }

  const numbered = [...result.added, ...result.revised].some((item) => item.entry !== undefined);
  let place = 0; // the next of `added` to pair by place
  const entries = asked.map((one, index): CallEntry => {
    const entry = index + 1;
    const refused: CallEntry = { entry, id: null, revision: null, outcome: 'refused', ...words(one) };
    if (one.named !== null) {
      const revised = result.revised.find((item) => item.id === one.named && (!numbered || item.entry === entry));
      return revised === undefined ? refused : { ...refused, id: revised.id, revision: revised.revision, outcome: 'revised' };
    }
    const added = numbered ? result.added.find((item) => item.entry === entry) : result.added[place++];
    return added === undefined ? refused : { ...refused, id: added.id, outcome: 'added' };
  });
  return { result, entries, withdrew: result.withdrew, notDone };
}
