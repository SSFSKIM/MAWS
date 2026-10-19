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

  // E3 M2 fix (reviewer finding 1): JSON.parse reads 1e400 as Infinity, which JSON.stringify would turn into a valid
  // null cell; refused here, in either arm, in the parser's own words, before the rows are ever serialized
  it('refuses a number no JSON can carry, in the text or the structured rows, before anything serializes it', () => {
    expect(queryRowsOf({ content: '[{"t":1,"v":107},{"t":2,"v":1e400}]' })).toEqual({ ok: false, problem: QUERY_RESULT_PROBLEMS.nonfinite(2, 'v') });
    expect(queryRowsOf({ content: [{ type: 'text', text: '{"rows":[{"v":-1e400}]}' }] })).toEqual({ ok: false, problem: QUERY_RESULT_PROBLEMS.nonfinite(1, 'v') });
    expect(queryRowsOf({ content: '', structuredContent: { rows: [{ t: 1, v: Infinity }] } })).toEqual({ ok: false, problem: QUERY_RESULT_PROBLEMS.nonfinite(1, 'v') });
    expect(queryRowsOf({ content: '', structuredContent: [{ t: 1 }, { t: Number.NaN }] })).toEqual({ ok: false, problem: QUERY_RESULT_PROBLEMS.nonfinite(2, 't') });
    expect(QUERY_RESULT_PROBLEMS.nonfinite(2, 'v')).toBe('record 2 holds a number in "v" too large to read');
  });

  // P3-F dashboard-model wave (scalpel-4#1): a row is a record and a cell a scalar, refused here otherwise in the parser's
  // own words before anything serializes the rows, since a cell nested thousands deep overflows the serializer's stack
  it('refuses a nested cell and a row that is no record, in either arm, before anything serializes the rows', () => {
    const deep = (n: number) => `${'['.repeat(n)}1${']'.repeat(n)}`;
    expect(queryRowsOf({ content: '[{"t":1},{"t":2,"v":{"a":1}}]' })).toEqual({ ok: false, problem: 'record 2 holds a nested value in "v"' });
    expect(queryRowsOf({ content: '[{"v":[1e400]}]' })).toEqual({ ok: false, problem: 'record 1 holds a nested value in "v"' });
    expect(queryRowsOf({ content: '', structuredContent: { rows: [{ v: [1] }] } })).toEqual({ ok: false, problem: 'record 1 holds a nested value in "v"' });
    expect(queryRowsOf({ content: '', structuredContent: [{ t: 1 }, 3] })).toEqual({ ok: false, problem: 'record 2 is not an object' });
    expect(queryRowsOf({ content: `[{"t":1,"v":${deep(10_000)}}]` })).toEqual({ ok: false, problem: 'record 1 holds a nested value in "v"' });
    expect(queryRowsOf({ content: `[${deep(10_000)}]` })).toEqual({ ok: false, problem: 'record 1 is not an object' });
  });
});
