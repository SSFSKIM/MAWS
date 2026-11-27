// The question sheet's row in the transcript's model (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md
// §I; the composite's §8.1 and S8): a call of the sminos tool in the sheet's form is a `sheet` row, one line per entry
// of its `ask`, drawn from the transcript alone. The stored calls are the pin's (`grammar/result.examples.json`);
// every other name and word is invented.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SheetDelivery } from '@shared/sheet/delivery';
import { isPersistentRow, rowsOf, withAllExpanded } from './derive';
import { rowId } from './keys';
import { applyEvents, createState } from './reduce';
import type { Row } from './rows';
import { serializeRows } from './serialize';
import { sheetHead } from './copy';
import { builder, tool, uuid, type Builder } from './test-events';

type SheetRowData = Extract<Row, { kind: 'sheet' }>;
const TOOL = 'mcp__sminos__AskUserQuestion';
const EXAMPLES = JSON.parse(readFileSync(join(__dirname, '../../../../../test/fixtures/sheet/set/grammar/result.examples.json'), 'utf8')) as { input: unknown; result: string }[];

const reduce = (b: Builder) => applyEvents(createState(null, null), b.events);
const rows = (b: Builder) => rowsOf(withAllExpanded(reduce(b)));
const sheets = (b: Builder) => rows(b).filter((row): row is SheetRowData => row.kind === 'sheet');
const sheetOf = (b: Builder, call: string) => sheets(b).find((row) => row.toolUseId === call)!;
const lines = (row: SheetRowData) => row.lines.map((line) => [line.id ?? `#${line.entry}`, line.place, line.outcome === null ? null : line.outcome.how === 'answered' ? line.outcome.receipt : line.outcome.how]);

const entry = (question: string, fields: Record<string, unknown> = {}) => ({ question, ...fields });
const options = (...labels: string[]) => labels.map((label) => ({ label }));
// One turn whose agent calls the tool once and gets `result` back.
function call(b: Builder, id: string, input: unknown, result: string | null, extra: { isError?: boolean } = {}) {
  b.turn(`u-${id}`, `prompt for ${id}`);
  b.toolUse(id, TOOL, input as Record<string, unknown>);
  if (result !== null) b.result(id, result, { isError: extra.isError ?? false });
  b.text(`m-${id}`, 0, 'Asked.');
  b.end([`u-${id}`]);
}
// A turn the sminos plugin's prompt opened, carrying the deliveries as the producers send them.
function delivered(b: Builder, id: string, deliveries: SheetDelivery[]) {
  b.emit('turn.started', { userMessageUuid: uuid(id), origin: 'task-notification' });
  b.emit('user.message', { messageUuid: uuid(id), content: '[sheet v1] The human answered questions on your sheet.', isReplay: false, isSynthetic: true, origin: 'task-notification', bash: null, arrival: [{ class: 'sheet', deliveries }] });
  b.text(`m-${id}`, 0, 'Thanks.');
  b.end([], { origin: 'task-notification' });
}
const block = (fields: Partial<SheetDelivery>): SheetDelivery => ({ v: 1, keys: ['page-00000001'], answered: [], dismissed: [], ...fields });
const answer = (id: string, revision: number, picks: number[], text = '') => ({ id, revision, picks, text, images: [] });

const THREE = { ask: [entry('Two sailings share a berth within ten minutes. Which one should the import keep?', { header: 'Clash rule', options: options('Keep the earlier sailing', 'Keep the longer route') }), entry('Which notices should the printed sheet carry?', { header: 'Notices', options: options('Tides', 'Works', 'Fares'), multiSelect: true }), entry('What are the first and last days of the winter season?', { header: 'Season dates' })] };

describe('a sheet call’s row, from the transcript alone', () => {
  it('is a row of its own kind, one line per entry with its id, header and the sentence that asks; today’s form keeps its question row', () => {
    const b = builder();
    call(b, 'toolu_three', THREE, 'Added q4, q5, q6.');
    call(b, 'toolu_today', { questions: [{ question: 'Which colour?', header: 'Colour', options: options('Blue', 'Red'), multiSelect: false }] }, 'Your questions have been answered.');
    const all = rows(b);
    expect(all.filter((row) => row.kind === 'question').map((row) => row.id)).toEqual([rowId.question(tool('toolu_today'))]);
    const row = sheetOf(b, 'toolu_three');
    expect(row).toMatchObject({ id: rowId.sheet(tool('toolu_three')), state: 'done', withdrew: [], notDone: null, error: null });
    expect(row.lines).toEqual([
      { id: 'q4', entry: 1, header: 'Clash rule', sentence: 'Which one should the import keep?', revises: false, place: 'here', outcome: null },
      { id: 'q5', entry: 2, header: 'Notices', sentence: 'Which notices should the printed sheet carry?', revises: false, place: 'here', outcome: null },
      { id: 'q6', entry: 3, header: 'Season dates', sentence: 'What are the first and last days of the winter season?', revises: false, place: 'here', outcome: null },
    ]);
    expect(sheetHead(row)).toBe('Asked 3 questions');
  });

  it('gives an eight-question call its ids in the order of its entries', () => {
    const b = builder();
    call(b, 'toolu_eight', EXAMPLES[0]!.input, EXAMPLES[0]!.result);
    expect(sheetOf(b, 'toolu_eight').lines.map((line) => line.id)).toEqual(['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8']);
  });

  it('G1.d: a call that partly succeeded has the right ids, its refused entry by its number, and the reasons; no record is read', () => {
    const b = builder();
    call(b, 'toolu_partly', EXAMPLES[2]!.input, EXAMPLES[2]!.result);
    const row = sheetOf(b, 'toolu_partly');
    expect(lines(row)).toEqual([['q7', 'here', null], ['q3', 'here', null], ['#3', 'refused', null], ['q8', 'here', null]]);
    expect(row.lines[1]).toMatchObject({ revises: true });
    expect(row.notDone).toBe('Not done: entry 3, the reference src/x.ts could not be read: permission denied. q5 is not open (answered at 14:05).');
    expect(sheetHead(row)).toBe('Asked 2 questions, revised q3');
  });

  it('says each head-line form from its call', () => {
    const heads: [unknown, string, string][] = [
      [{ ask: [entry('Ship it?')] }, 'Added q9.', 'Asked a question'],
      [{ ask: [entry('Ship it now?', { id: 'q5' })] }, 'Revised q5 (revision 2).', 'Revised q5'],
      [{ ask: [entry('Paper size?'), entry('Notices?', { id: 'q5' })] }, 'Added q8. Revised q5 (revision 3).', 'Asked a question, revised q5'],
      [{ withdraw: ['q6'] }, 'Withdrew q6.', 'Withdrew q6'],
      [{ ask: [entry('Ship it?')], withdraw: ['q6'] }, 'Added q9. Withdrew q6.', 'Asked a question, withdrew q6'],
      [EXAMPLES[4]!.input, EXAMPLES[4]!.result, 'Nothing done'],
    ];
    for (const [input, result, head] of heads) {
      const b = builder();
      call(b, 'toolu_head', input, result);
      expect(sheetHead(sheetOf(b, 'toolu_head'))).toBe(head);
    }
  });

  it('a call that only withdrew has no lines; the question’s own line, in the row that asked it, reads withdrawn', () => {
    const b = builder();
    call(b, 'toolu_three', THREE, 'Added q4, q5, q6.');
    call(b, 'toolu_withdraw', { withdraw: ['q6'] }, 'Withdrew q6.');
    expect(sheetOf(b, 'toolu_withdraw')).toMatchObject({ lines: [], withdrew: ['q6'] });
    expect(lines(sheetOf(b, 'toolu_three'))).toEqual([['q4', 'here', null], ['q5', 'here', null], ['q6', 'here', 'withdrawn']]);
  });

  it('a revise moves the line to the revising call’s row, and the earlier row reads revised below', () => {
    const b = builder();
    call(b, 'toolu_three', THREE, 'Added q4, q5, q6.');
    call(b, 'toolu_revise', { ask: [entry('Which notices should the printed sheet carry, and in what order?', { id: 'q5', header: 'Notices', options: options('Tides', 'Works') })] }, 'Revised q5 (revision 2).');
    expect(lines(sheetOf(b, 'toolu_three'))).toEqual([['q4', 'here', null], ['q5', 'revised_below', null], ['q6', 'here', null]]);
    expect(lines(sheetOf(b, 'toolu_revise'))).toEqual([['q5', 'here', null]]);
  });

  it('a call whose outcome is not known draws no id, a revise’s neither; one with no result yet is running; one the engine denied is an error', () => {
    const b = builder();
    call(b, 'toolu_unknown', { ask: [entry('Ship it?'), entry('Again?', { id: 'q3' })] }, EXAMPLES[6]!.result);
    call(b, 'toolu_running', { ask: [entry('Ship it?')] }, null);
    call(b, 'toolu_denied', { ask: [entry('Ship it?')] }, '<tool_use_error>InputValidationError: ask[0].options is too long</tool_use_error>', { isError: true });
    expect(sheetOf(b, 'toolu_unknown')).toMatchObject({ state: 'unknown' });
    expect(sheetOf(b, 'toolu_unknown').lines.map((line) => line.id)).toEqual([null, null]);
    expect(sheetOf(b, 'toolu_running')).toMatchObject({ state: 'running', lines: [{ id: null }] });
    expect(sheetOf(b, 'toolu_denied')).toMatchObject({ state: 'error', error: 'InputValidationError: ask[0].options is too long', lines: [{ id: null, place: 'here' }] });
  });

  it('fills each receipt from a later delivery’s block: picks by their places among the answered revision’s options, a text, a dismissal', () => {
    const b = builder();
    call(b, 'toolu_three', THREE, 'Added q4, q5, q6.');
    call(b, 'toolu_revise', { ask: [entry('Which notices, in what order?', { id: 'q5', header: 'Notices', options: options('Works', 'Tides'), multiSelect: true })] }, 'Revised q5 (revision 2).');
    delivered(b, 'u-delivery', [block({ answered: [answer('q4', 1, [1]), answer('q5', 2, [2, 1]), answer('q6', 1, [], 'From the first of November to the last of March.')] })]);
    expect(lines(sheetOf(b, 'toolu_three'))).toEqual([['q4', 'here', 'Keep the earlier sailing'], ['q5', 'revised_below', null], ['q6', 'here', 'From the first of November to the last of March.']]);
    expect(lines(sheetOf(b, 'toolu_revise'))).toEqual([['q5', 'here', 'Tides, Works']]);
    delivered(b, 'u-dismissal', [block({ keys: ['page-00000002'], dismissed: ['q4'] })]);
    expect(lines(sheetOf(b, 'toolu_three'))[0]).toEqual(['q4', 'here', 'dismissed']); // the later delivery stands
    const notices = rows(b).filter((row) => row.kind === 'notice');
    expect(notices.map((row) => row.kind === 'notice' && [row.class, row.text])).toEqual([['answer', 'answered: q4, q5, q6'], ['answer', 'answered: dismissed q4']]);
  });

  it('says what a call did only where its outcome is known: running, not known and refused have their own words, with ask entries and with withdraw alone', () => {
    const heads: [unknown, string | null, boolean, string][] = [
      [{ ask: [entry('Ship it?'), entry('Again?', { id: 'q3' })] }, null, false, 'Changing the sheet'],
      [{ withdraw: ['q6'] }, null, false, 'Changing the sheet'],
      [{ ask: [entry('Ship it?'), entry('Again?', { id: 'q3' })] }, EXAMPLES[6]!.result, false, 'Outcome not known yet'],
      [{ withdraw: ['q6'] }, EXAMPLES[6]!.result, false, 'Outcome not known yet'],
      [{ ask: [entry('Ship it?')] }, '<tool_use_error>InputValidationError: ask[0].options is too long</tool_use_error>', true, 'Did not change the sheet'],
      [{ withdraw: ['q6'] }, '<tool_use_error>InputValidationError: withdraw[0] is not an id</tool_use_error>', true, 'Did not change the sheet'],
    ];
    for (const [input, result, isError, head] of heads) {
      const b = builder();
      call(b, 'toolu_head', input, result, { isError });
      expect(sheetHead(sheetOf(b, 'toolu_head')), `${JSON.stringify(input)} → ${result}`).toBe(head);
    }
  });

  it('a delivery’s turn that holds only its carrier keeps its notice when a later turn starts before any reply', () => {
    const b = builder();
    call(b, 'toolu_three', THREE, 'Added q4, q5, q6.');
    b.emit('turn.started', { userMessageUuid: null, origin: 'engine' });
    b.emit('user.message', { messageUuid: uuid('u-carrier'), content: '[sheet v1] The human answered questions on your sheet.', isReplay: false, isSynthetic: true, origin: 'task-notification', bash: null, arrival: [{ class: 'sheet', deliveries: [block({ answered: [answer('q4', 1, [2])] })] }] });
    b.turn('u-next', 'Carry on.');
    b.text('m-next', 0, 'Going on.');
    b.end(['u-next']);
    expect(lines(sheetOf(b, 'toolu_three'))[0]).toEqual(['q4', 'here', 'Keep the longer route']);
    expect(rows(b).filter((row) => row.kind === 'notice').map((row) => row.kind === 'notice' && row.text)).toEqual(['answered: q4']);
  });

  it('an answer whose text opens with spaces stays answered, its receipt the text’s first 80 characters as the record keeps it', () => {
    const b = builder();
    call(b, 'toolu_three', THREE, 'Added q4, q5, q6.');
    const text = `${' '.repeat(80)}From the first of November.`;
    delivered(b, 'u-delivery', [block({ answered: [answer('q6', 1, [], text)] })]);
    expect(sheetOf(b, 'toolu_three').lines[2]!.outcome).toEqual({ how: 'answered', receipt: ' '.repeat(80) });
  });

  it('stays in view when its turn folds, and copies as its lines', () => {
    const b = builder();
    call(b, 'toolu_three', THREE, 'Added q4, q5, q6.');
    call(b, 'toolu_withdraw', { withdraw: ['q6'] }, 'Withdrew q6.');
    const folded = rowsOf(reduce(b));
    expect(folded.filter((row) => row.kind === 'sheet').map((row) => row.id)).toEqual([rowId.sheet(tool('toolu_three')), rowId.sheet(tool('toolu_withdraw'))]);
    expect(isPersistentRow(sheetOf(b, 'toolu_three'))).toBe(true);
    expect(serializeRows([sheetOf(b, 'toolu_three')])).toBe('Asked 3 questions\n- q4 **Clash rule** Which one should the import keep?\n- q5 **Notices** Which notices should the printed sheet carry?\n- q6 **Season dates** → Withdrawn');
  });
});
