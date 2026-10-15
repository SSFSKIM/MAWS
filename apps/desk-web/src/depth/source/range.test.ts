// One fold's stretch of the main transcript (DX8's `transcript` slot, its `range`): strictly between two exchange
// items, at span granularity.
import type { JsonObject } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import { rowsInRange } from './range';

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
});
