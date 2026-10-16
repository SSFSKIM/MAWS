// One fold's stretch of the main transcript (DX8's `transcript` slot, its `range`): strictly between two exchange
// items, at span granularity.
import type { JsonObject } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import { rowsInRange, unresolvedBounds } from './range';

type R = JsonObject & { uuid: string };
const text = (uuid: string, body: string): R => ({ type: 'assistant', uuid, message: { role: 'assistant', content: [{ type: 'text', text: body }] } });
const user = (uuid: string, body: string): R => ({ type: 'user', uuid, message: { role: 'user', content: body } });
const call = (uuid: string, id: string): R => ({ type: 'assistant', uuid, message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: {} }] } });
const result = (uuid: string, id: string): R => ({ type: 'user', uuid, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'blue' }] } });

const bodyOf = (row: R) => {
  const content = (row.message as { content: unknown }).content;
  return typeof content === 'string' ? content : (content as Array<{ type: string; text?: string }>).map((b) => b.text ?? b.type).join('');
};
const drawn = (rows: R[]) => rows.map((row) => `${row.uuid}: ${bodyOf(row)}`);

const ROWS: R[] = [
  user('p1', 'Do it.'),
  text('a1', 'Reading first. <message>Started.</message> Now the files.'),
  text('a2', 'Read both.'),
  call('q', 'toolu_q'),
  result('qa', 'toolu_q'),
  text('a3', 'Writing. <message>Wrote it.</message> Middle words. <essential>Merged.</essential> Trailing words.'),
  text('a4', 'After the last message.'),
];

describe('the rows a fold draws', () => {
  it('a row with unmarked text beside its bounding span: the text is drawn, the span is not', () => {
    const view = rowsInRange(ROWS, { from: 'a1#0', to: 'toolu_q' });
    expect(view).toMatchObject({ from: 'found', to: 'found' });
    expect(drawn(view.rows)).toEqual(['a1: Now the files.', 'a2: Read both.']);
    // Before a `to` span: the row's text ahead of it.
    expect(drawn(rowsInRange(ROWS, { from: 'toolu_q', to: 'a3#0' }).rows)).toEqual(['a3: Writing.']);
  });

  it('a fold bounded by a question’s call id leaves out the call and its answer', () => {
    expect(drawn(rowsInRange(ROWS, { from: 'toolu_q', to: 'a3#0' }).rows)).not.toContain('q: tool_use');
    expect(rowsInRange(ROWS, { from: 'toolu_q', to: 'a3#0' }).rows.map((row) => row.uuid)).toEqual(['a3']);
    expect(rowsInRange(ROWS, { from: 'a1#0', to: 'toolu_q' }).rows.map((row) => row.uuid)).toEqual(['a1', 'a2']);
  });

  it('two bounds in one row: what lies between its spans, an alias counted as a span', () => {
    expect(drawn(rowsInRange(ROWS, { from: 'a3#0', to: 'a3#1' }).rows)).toEqual(['a3: Middle words.']);
    expect(drawn(rowsInRange(ROWS, { from: 'a3#1', to: null }).rows)).toEqual(['a3: Trailing words.', 'a4: After the last message.']);
  });

  it('open ends: the first fold from the start, a live session’s last fold through the end and what arrives after', () => {
    expect(rowsInRange(ROWS, { from: null, to: 'a1#0' }).rows.map((row) => row.uuid)).toEqual(['p1', 'a1']);
    expect(drawn(rowsInRange(ROWS, { from: null, to: 'a1#0' }).rows).at(-1)).toBe('a1: Reading first.');
    const later = [...ROWS, text('a5', 'Arrived later.')];
    const view = rowsInRange(later, { from: 'a3#1', to: null });
    expect(view).toMatchObject({ from: 'found', to: 'open' });
    expect(view.rows.map((row) => row.uuid)).toEqual(['a3', 'a4', 'a5']);
  });

  it('a bounding span that leaves nothing of its row drops the row', () => {
    const rows = [text('m1', '<message>Only this.</message>'), text('w', 'Work.'), text('m2', '<message>And this.</message>')];
    expect(drawn(rowsInRange(rows, { from: 'm1#0', to: 'm2#0' }).rows)).toEqual(['w: Work.']);
  });

  it('cuts a row by the spans the export numbered: an unclosed <message> is span #0, as sminos record reads it', () => {
    const rows = [text('w1', 'Work before. <message>Already in channel'), text('w2', 'Working on.'), text('m2', '<message>Next.</message>')];
    // Ending at the open span: the working record before it, never the channel's message again.
    expect(drawn(rowsInRange(rows, { from: null, to: 'w1#0' }).rows)).toEqual(['w1: Work before.']);
    // Starting at it: nothing of the row is after the span, and the rows after it are drawn.
    expect(drawn(rowsInRange(rows, { from: 'w1#0', to: 'm2#0' }).rows)).toEqual(['w2: Working on.']);
    // A nested mark is spans of their own, numbered as the export numbers them.
    const nested = [text('n', '<message>Outer <insight>inner</insight> tail</message> end')];
    expect(drawn(rowsInRange(nested, { from: 'n#1', to: null }).rows)).toEqual(['n: <message>tail</message> end']);
  });

  it('a fold after an earlier tool call keeps its rows that are not results: prompts and string-content notifications', () => {
    const prompt = user('p2', 'Please keep this instruction');
    const notification = user('n1', '<task-notification>\n<task-id>a1</task-id>\n</task-notification>');
    const bare: R = { type: 'user', uuid: 'bare', message: { role: 'user' } };
    // After a question bound (its call is the earlier call).
    const afterQuestion = rowsInRange([call('q', 'toolu_q'), prompt, notification, bare, text('m', '<message>Done.</message>')], { from: 'toolu_q', to: 'm#0' });
    expect(afterQuestion.rows.map((row) => row.uuid)).toEqual(['p2', 'n1', 'bare']);
    // After a message bound that follows an earlier tool call (and its result, drawn in the earlier fold).
    const rows = [call('read', 'toolu_read'), text('m1', '<message>Reading.</message>'), result('read-result', 'toolu_read'), prompt, notification, text('m2', '<message>Next.</message>')];
    const afterMessage = rowsInRange(rows, { from: 'm1#0', to: 'm2#0' });
    expect(afterMessage.rows.map((row) => row.uuid)).toEqual(['p2', 'n1']);
    expect(afterMessage.rows[0]).toBe(prompt); // passed through as it is
  });

  it('a span inside the stretch (one the log missed) is kept as a span', () => {
    const rows = [text('m1', '<message>One.</message> <message>Two.</message> Work.'), text('m2', '<message>Three.</message>')];
    expect(drawn(rowsInRange(rows, { from: 'm1#0', to: 'm2#0' }).rows)).toEqual(['m1: <message>Two.</message> Work.']);
  });

  it('a bound no held row names is missing, and the stretch is drawn as if it were open', () => {
    const view = rowsInRange(ROWS.slice(3), { from: 'a1#0', to: 'a3#0' });
    expect(view).toMatchObject({ from: 'missing', to: 'found' });
    expect(view.rows.map((row) => row.uuid)).toEqual(['q', 'qa', 'a3']);
    expect(rowsInRange(ROWS, { from: 'a1#0', to: 'toolu_elsewhere' })).toMatchObject({ from: 'found', to: 'missing' });
  });

  it('a question bound leaves out only its own call and answer: a parallel tool’s call and result between them are drawn', () => {
    const rows = [
      text('m1', '<message>Asking now.</message>'),
      call('q', 'toolu_q'),
      { type: 'assistant', uuid: 'read', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_read', name: 'Read', input: {} }] } } as R,
      result('read-result', 'toolu_read'),
      { type: 'user', uuid: 'both', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_q', content: 'blue' }, { type: 'tool_result', tool_use_id: 'toolu_other', content: 'kept' }] } } as R,
      result('qa', 'toolu_q'),
      text('a1', 'Working after the answer.'),
      text('m2', '<message>Done.</message>'),
    ];
    const view = rowsInRange(rows, { from: 'toolu_q', to: 'm2#0' });
    expect(view.rows.map((row) => row.uuid)).toEqual(['read', 'read-result', 'both', 'a1']);
    // A row carrying the answer beside another result keeps the other.
    expect(JSON.stringify(view.rows[2])).not.toContain('toolu_q');
    expect(JSON.stringify(view.rows[2])).toContain('toolu_other');
    // The same rows are the same objects next time (a live row continues what is drawn).
    expect(rowsInRange(rows, { from: 'toolu_q', to: 'm2#0' }).rows[2]).toBe(view.rows[2]);
    // Bounded at its end by the question: everything before its call.
    expect(rowsInRange(rows, { from: 'm1#0', to: 'toolu_q' }).rows.map((row) => row.uuid)).toEqual([]);
  });
});

describe('the bounds a fold says it could not find', () => {
  const live = (bounds: { from: 'open' | 'found' | 'missing'; to: 'open' | 'found' | 'missing' }, more: boolean) => unresolvedBounds({ phase: 'live', more, bounds });

  it('its end, once its start is held, though older rows exist (no older page can help)', () => {
    expect(live({ from: 'found', to: 'missing' }, true)).toEqual({ start: false, end: true });
  });

  it('its start only once the transcript has no older rows; an open start’s missing end likewise', () => {
    expect(live({ from: 'missing', to: 'found' }, true)).toEqual({ start: false, end: false });
    expect(live({ from: 'missing', to: 'missing' }, false)).toEqual({ start: true, end: true });
    expect(live({ from: 'open', to: 'missing' }, true)).toEqual({ start: false, end: false });
    expect(live({ from: 'open', to: 'missing' }, false)).toEqual({ start: false, end: true });
    expect(unresolvedBounds({ phase: 'loading', more: false, bounds: { from: 'missing', to: 'missing' } })).toEqual({ start: false, end: false });
  });
});
