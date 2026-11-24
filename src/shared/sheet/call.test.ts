// A stored call of the sheet (X7) read with no record: its result's first line held to the pinned grammar, and the
// entries of the call paired with their ids by the grammar's own rule (§B `call.ts`).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RESULT_PATTERN, callEntries, isSheetCall, parseSheetResult } from './call';

const GRAMMAR = join(__dirname, '../../../test/fixtures/sheet/set/grammar');
const EXAMPLES = JSON.parse(readFileSync(join(GRAMMAR, 'result.examples.json'), 'utf8')) as { input: unknown; result: string; parsed: unknown }[];
const example = (first: RegExp) => {
  const found = EXAMPLES.find((call) => first.test(call.result));
  if (found === undefined) throw new Error(`no stored call of the pin's examples begins ${first}`);
  return found;
};

describe('the result’s grammar', () => {
  it('is the pattern the pin’s grammar/result.md gives, character for character', () => {
    const md = readFileSync(join(GRAMMAR, 'result.md'), 'utf8');
    const pattern = /## The pattern a reader matches\n\n[\s\S]*?\n\n {4}(\^.*\$)\n/.exec(md)?.[1];
    expect(RESULT_PATTERN.source).toBe(pattern);
  });

  it('parses every stored call of the pin to its `parsed`', () => {
    expect(EXAMPLES.length).toBeGreaterThan(0);
    for (const call of EXAMPLES) expect(parseSheetResult(call.result), call.result).toStrictEqual(call.parsed);
  });

  it('answers null for a first line that is not of the grammar', () => {
    for (const text of ['Added q1,q2.', 'Revised q3.', 'Withdrew q2. Added q1.', 'Added q1. ', 'Nothing done', 'InputValidationError: AskUserQuestion failed due to the following issue:', '']) {
      expect(parseSheetResult(text), text).toBeNull();
    }
  });
});

describe('isSheetCall', () => {
  it('tells the sheet’s form from today’s by the input', () => {
    expect(isSheetCall({ ask: [] })).toBe(true);
    expect(isSheetCall({ withdraw: ['q1'] })).toBe(true);
    expect(isSheetCall({ questions: [{ question: 'Ship?' }] })).toBe(false);
    expect(isSheetCall(null)).toBe(false);
    expect(isSheetCall([{ ask: [] }])).toBe(false);
    expect(isSheetCall('ask')).toBe(false);
  });
});

describe('callEntries', () => {
  it('pairs the entries of a call that partly succeeded with their ids, and gives the refused one and why', () => {
    const call = example(/^Added q7 \(entry 1\), q8 \(entry 4\)\. Revised q3/);
    const read = callEntries(call.input, call.result);
    expect(read.entries.map(({ entry, id, revision, outcome }) => ({ entry, id, revision, outcome }))).toEqual([
      { entry: 1, id: 'q7', revision: null, outcome: 'added' },
      { entry: 2, id: 'q3', revision: 2, outcome: 'revised' },
      { entry: 3, id: null, revision: null, outcome: 'refused' },
      { entry: 4, id: 'q8', revision: null, outcome: 'added' },
    ]);
    expect(read.entries[2]).toMatchObject({ question: 'Is this check right?', header: null, options: [], multiSelect: false });
    expect(read.notDone).toBe('Not done: entry 3, the reference src/x.ts could not be read: permission denied. q5 is not open (answered at 14:05).');
    expect(read.notDone).toContain('the reference src/x.ts could not be read: permission denied');
    expect(read.withdrew).toEqual([]);
  });

  it('pairs added entries by place when no item carries its entry', () => {
    const call = example(/^Added q7, q8\. Revised q3 \(revision 2\)\. Withdrew q2\./);
    const read = callEntries(call.input, call.result);
    expect(read.entries.map(({ entry, id, outcome }) => ({ entry, id, outcome }))).toEqual([
      { entry: 1, id: 'q7', outcome: 'added' },
      { entry: 2, id: 'q3', outcome: 'revised' },
      { entry: 3, id: 'q8', outcome: 'added' },
    ]);
    expect(read.withdrew).toEqual(['q2']);
    expect(read.notDone).toBeNull();
  });

  it('reads an eight-question call’s ids in the order of its entries, with each entry’s words', () => {
    const call = example(/^Added q1, q2, q3, q4, q5, q6, q7, q8\.$/);
    const read = callEntries(call.input, call.result);
    expect(read.entries.map((entry) => entry.id)).toEqual(['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8']);
    expect(read.entries[0]).toMatchObject({ header: 'Auth method', question: 'Which auth method should the login use?', options: ['OAuth', 'Passkeys'], multiSelect: false });
  });

  it('refuses every entry of a foreclosed call and says to call again', () => {
    const call = example(/^Nothing done\.\nNot done: the sheet could not be written/);
    const read = callEntries(call.input, call.result);
    expect(read.result).toEqual({ form: 'nothing' });
    expect(read.entries.map(({ id, outcome }) => ({ id, outcome }))).toEqual([{ id: null, outcome: 'refused' }]);
    expect(read.notDone).toMatch(/call again\.$/);
  });

  it('draws no id for a call whose outcome is not known, nor for one with no result yet', () => {
    const call = example(/^Outcome not known yet\./);
    for (const text of [call.result, null]) {
      const read = callEntries(call.input, text);
      expect(read.entries.map(({ id, outcome }) => ({ id, outcome }))).toEqual([{ id: null, outcome: 'unknown' }]);
      expect(read.notDone).toBeNull();
      expect(read.withdrew).toEqual([]);
    }
    const revise = callEntries({ ask: [{ id: 'q3', question: 'Ship the migration today?' }] }, null);
    expect(revise.entries[0]).toMatchObject({ id: 'q3', revision: null, outcome: 'unknown' });
  });

  it('reads a withdrawal that was refused as nothing withdrawn', () => {
    const call = example(/^Nothing done\.\nNot done: q3 is not open/);
    const read = callEntries(call.input, call.result);
    expect(read).toMatchObject({ entries: [], withdrew: [], notDone: 'Not done: q3 is not open (withdrawn at 09:12).' });
  });

  it('keeps the reasons apart when two results share their first line', () => {
    const input = { ask: [{ question: 'Keep the export?' }, { question: 'Which log level in production?' }] };
    const one = callEntries(input, 'Added q4 (entry 2).\nNot done: entry 1, two options share the label "Yes".');
    const two = callEntries(input, 'Added q4 (entry 2).\nNot done: entry 1, multiSelect needs options.');
    expect(one.entries).toEqual(two.entries);
    expect(one.notDone).not.toBe(two.notDone);
  });

  it('reads a result that is not of the grammar as no result: a denial', () => {
    const read = callEntries({ ask: [{ question: 'Ship?' }] }, 'InputValidationError: AskUserQuestion failed due to the following issue:\nask: too many');
    expect(read.result).toBeNull();
    expect(read.entries.map(({ id, outcome }) => ({ id, outcome }))).toEqual([{ id: null, outcome: 'unknown' }]);
    expect(read.notDone).toBeNull();
  });
});
