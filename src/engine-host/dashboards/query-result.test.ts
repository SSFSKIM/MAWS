// E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): a query result's rows by the one closed rule, over
// the recorded engine wire's envelope (spikes/p3-connectors/fixtures/engine-mcp-call.jsonl seqs 11 and 13).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { QUERY_RESULT_PROBLEMS, queryRowsOf } from './query-result';

const wire = readFileSync(join(__dirname, '../../../spikes/p3-connectors/fixtures/engine-mcp-call.jsonl'), 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => JSON.parse(line) as { seq: number; frame: { response?: { response?: unknown } } });
const recorded = (seq: number) => wire.find((row) => row.seq === seq)!.frame.response!.response;
const ROWS = [{ t: 1, v: 107 }, { t: 2, v: 110 }];

describe('a query result’s rows', () => {
  it('reads the recorded wire’s envelope: structuredContent’s own rows, never the envelope', () => {
    for (const seq of [11, 13]) {
      const answer = queryRowsOf(recorded(seq));
      expect(answer.ok).toBe(true);
      expect((answer as { rows: unknown[] }).rows).toEqual((recorded(seq) as { structuredContent: { rows: unknown[] } }).structuredContent.rows);
    }
  });

  it('takes structuredContent as an array, or as an object with an own rows array whose other keys it ignores', () => {
    expect(queryRowsOf({ content: 'ignored', structuredContent: ROWS })).toEqual({ ok: true, rows: ROWS });
    expect(queryRowsOf({ content: [], structuredContent: { series: 'revenue', rows: ROWS } })).toEqual({ ok: true, rows: ROWS });
  });

  it('refuses structuredContent of another shape, without falling back to the text', () => {
    const text = JSON.stringify(ROWS);
    for (const structuredContent of [{ data: ROWS }, { rows: 'x' }, 'rows', 3, null, Object.create({ rows: ROWS }) as unknown]) {
      expect(queryRowsOf({ content: text, structuredContent })).toEqual({ ok: false, problem: QUERY_RESULT_PROBLEMS.structured });
    }
  });

  it('refuses a tool error whatever it carries', () => {
    expect(queryRowsOf({ isError: true, content: JSON.stringify(ROWS), structuredContent: ROWS })).toEqual({ ok: false, problem: QUERY_RESULT_PROBLEMS.toolError });
  });

  it('without structuredContent, reads exactly one text: the wire’s string or one text block', () => {
    expect(queryRowsOf({ content: JSON.stringify(ROWS) })).toEqual({ ok: true, rows: ROWS });
    expect(queryRowsOf({ content: [{ type: 'text', text: JSON.stringify({ rows: ROWS, at: 'x' }) }] })).toEqual({ ok: true, rows: ROWS });
  });

  it('refuses images, resources, several blocks, text that is not JSON and JSON of another shape', () => {
    expect(queryRowsOf({ content: [{ type: 'image', data: 'AA', mimeType: 'image/png' }] })).toEqual({ ok: false, problem: QUERY_RESULT_PROBLEMS.content });
    expect(queryRowsOf({ content: [{ type: 'resource', resource: { uri: 'x' } }] })).toEqual({ ok: false, problem: QUERY_RESULT_PROBLEMS.content });
    expect(queryRowsOf({ content: [{ type: 'text', text: '[]' }, { type: 'text', text: '[]' }] })).toEqual({ ok: false, problem: QUERY_RESULT_PROBLEMS.content });
    expect(queryRowsOf({ content: [] })).toEqual({ ok: false, problem: QUERY_RESULT_PROBLEMS.content });
    expect(queryRowsOf({ content: 'rows 107 110' })).toEqual({ ok: false, problem: QUERY_RESULT_PROBLEMS.notJson });
    expect(queryRowsOf({ content: '{"data":[]}' })).toEqual({ ok: false, problem: QUERY_RESULT_PROBLEMS.shape });
    expect(queryRowsOf([ROWS])).toEqual({ ok: false, problem: QUERY_RESULT_PROBLEMS.notAResult });
    expect(queryRowsOf(null)).toEqual({ ok: false, problem: QUERY_RESULT_PROBLEMS.notAResult });
  });
});
