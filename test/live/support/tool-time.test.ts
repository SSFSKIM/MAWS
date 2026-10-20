// P4-A2 (X34): the tool-time guard's reader over recorded journals (the SDK probe's round trip, E2's artifact calls),
// over a launch's rotations, and its bounds over synthetic journals: a slow call named, a median over half the bound,
// the render tools under their own bound, other tools ignored and a withdrawn call counted but never held against it.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { JournalRow } from '@shared/wire/journal';
import { expectToolTime, guardToolTime, readToolCalls, readToolSpans, RENDER_TOOL_TIME_BOUND_MS, TOOL_TIME_BOUND_MS, TOOL_TIME_MEDIAN_MS } from './tool-time';

const FIXTURES = resolve(__dirname, '../../../spikes/protocol-probe/fixtures/pass3');

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

const T0 = Date.parse('2026-10-19T10:00:00.000Z');
const at = (ms: number) => new Date(T0 + ms).toISOString();
// A synthetic launch: each call `[name, startMs, ms | null]` journaled as the engine's `tools/call` in and MAWS's answer
// out (none for null), with the recording's `in` echo of the answer after it and a `tools/list` before them.
function launch(calls: [name: string, start: number, ms: number | null][]): JournalRow[] {
  const rows: JournalRow[] = [];
  const push = (direction: JournalRow['direction'], ms: number, frame: unknown) => rows.push({ seq: rows.length + 1, direction, at: at(ms), frame });
  const answer = (requestId: string) => ({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response: { mcp_response: { jsonrpc: '2.0', id: 0, result: { content: [] } } } } });
  push('in', 0, { type: 'control_request', request_id: 'r-list', request: { subtype: 'mcp_message', server_name: 'maws', message: { jsonrpc: '2.0', id: 0, method: 'tools/list' } } });
  push('out', 0, answer('r-list'));
  const events = calls.flatMap(([name, start, ms], i) => {
    const call = { type: 'control_request', request_id: `r${i}`, request: { subtype: 'mcp_message', server_name: 'maws', message: { jsonrpc: '2.0', id: i + 1, method: 'tools/call', params: { name, arguments: {}, _meta: { 'claudecode/toolUseId': `toolu_${i}` } } } } };
    return [{ ms: start, order: 0, direction: 'in' as const, frame: call }, ...(ms === null ? [] : [{ ms: start + ms, order: 1, direction: 'out' as const, frame: answer(`r${i}`) }, { ms: start + ms, order: 2, direction: 'in' as const, frame: answer(`r${i}`) }])];
  });
  for (const event of events.sort((a, b) => a.ms - b.ms || a.order - b.order)) push(event.direction, event.ms, event.frame);
  return rows;
}

describe('readToolSpans', () => {
  it('pairs each recorded tools/call with the out control_response of its request id, never the in echo', () => {
    const spans = readToolSpans(join(FIXTURES, 'p1-sdk-mcp-roundtrip.jsonl'));
    expect(spans.map((s) => [s.name, s.toolUseId, s.requestSeq, s.responseSeq])).toEqual([
      ['echo_file', 'toolu_01EThqbUucMRpM9sLzabT5Vs', 71, 72],
      ['echo_upper', 'toolu_01RfCnFUEHK4LDECmY3yNDQY', 161, 162],
      ['shout', 'toolu_013SDtbFMEGndEHwGZjCQJNU', 274, 275], // the second server's call, by its own request id
    ]);
    for (const span of spans) {
      expect(span.ms).toBe(Date.parse(span.answeredAt!) - Date.parse(span.startedAt));
      expect(span.ms).toBeGreaterThanOrEqual(0); // the probe's echo tools answer within the journal's millisecond
    }
  });

  it('reads E2’s artifact calls with their times, the screenshot slower than the store calls', () => {
    const spans = readToolSpans(join(FIXTURES, 'p1-maws-artifacts.jsonl'));
    expect(spans.map((s) => [s.name, s.ms])).toEqual([['artifact_create', 4], ['artifact_screenshot', 102], ['artifact_update', 9], ['artifact_list', 1], ['artifact_update', 1]]);
    expect(spans[0]).toMatchObject({ toolUseId: 'toolu_01WzDzsxgQVaHD2wjyyt61Yt', requestSeq: 183, responseSeq: 184, startedAt: '2026-10-06T12:53:13.540Z', answeredAt: '2026-10-06T12:53:13.544Z' });
  });

  it('reads a launch’s base file with its rotations, keeping a call answered after the rotation and the unanswered one apart', () => {
    dir = mkdtempSync(join(tmpdir(), 'maws-tool-time-'));
    const rows = launch([['artifact_edit', 1_000, 90], ['artifact_read', 2_000, null]]);
    const write = (file: string, part: JournalRow[]) => writeFileSync(join(dir!, file), part.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const cut = rows.findIndex((r) => r.direction === 'out' && r.seq > 3); // the edit's answer opens the rotation
    write('abcd1234.jsonl', rows.slice(0, cut));
    write('abcd1234.1.jsonl', rows.slice(cut));
    write('other999.jsonl', rows); // another launch's file
    const calls = readToolCalls(join(dir, 'abcd1234.jsonl'));
    expect(calls).toEqual(readToolCalls(rows));
    expect(calls.spans).toEqual([{ toolUseId: 'toolu_0', name: 'artifact_edit', requestSeq: 3, responseSeq: 4, startedAt: at(1_000), answeredAt: at(1_090), ms: 90 }]);
    expect(calls.unanswered).toEqual([{ toolUseId: 'toolu_1', name: 'artifact_read', requestSeq: 6, startedAt: at(2_000) }]);
    expect(readToolSpans(join(dir, 'abcd1234.jsonl'))).toEqual(calls.spans);
  });
});

// P4-A1's case for the reader it built to the same shape (merged at A2's landing, the architect keeping this one): an
// answer to a request the reader never saw, an error answer counted as an answer, another MCP method skipped, another
// launch's file left alone, and a rotation named on its own read alone.
describe('readToolCalls, A1’s cases', () => {
  const call = (seq: number, atIso: string, requestId: string, name: string, toolUseId?: string, method = 'tools/call'): JournalRow => ({
    seq, direction: 'in', at: atIso,
    frame: { type: 'control_request', request_id: requestId, request: { subtype: 'mcp_message', server_name: 'maws', message: { jsonrpc: '2.0', id: seq, method, params: { name, arguments: {}, ...(toolUseId ? { _meta: { 'claudecode/toolUseId': toolUseId } } : {}) } } } },
  });
  const answer = (seq: number, atIso: string, requestId: string, subtype: 'success' | 'error' = 'success'): JournalRow => ({
    seq, direction: 'out', at: atIso,
    frame: { type: 'control_response', response: subtype === 'success' ? { subtype, request_id: requestId, response: { mcp_response: { jsonrpc: '2.0', id: 0, result: { content: [] } } } } : { subtype, request_id: requestId, error: 'refused' } },
  });
  it('follows the launch into its rotations, keeps an unanswered call apart, counts an error answer and skips other MCP methods', () => {
    dir = mkdtempSync(join(tmpdir(), 'maws-tool-time-'));
    const write = (file: string, rows: JournalRow[]) => writeFileSync(join(dir!, file), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
    const base = join(dir, 'abcd1234.jsonl');
    write('abcd1234.jsonl', [
      { seq: 1, direction: 'meta', at: '2026-10-19T10:00:00.000Z', frame: { event: 'spawn' } },
      call(2, '2026-10-19T10:00:01.000Z', 'r-list', 'tools/list', undefined, 'tools/list'),
      answer(3, '2026-10-19T10:00:01.010Z', 'r-list'),
      call(4, '2026-10-19T10:00:02.000Z', 'r-edit', 'artifact_edit', 'toolu_edit'),
      answer(5, '2026-10-19T10:00:02.040Z', 'r-other'), // answers a request this reader never saw
    ]);
    write('abcd1234.1.jsonl', [answer(6, '2026-10-19T10:00:02.090Z', 'r-edit'), call(7, '2026-10-19T10:00:03.000Z', 'r-publish', 'artifact_publish', 'toolu_publish'), answer(8, '2026-10-19T10:00:03.500Z', 'r-publish', 'error')]);
    write('abcd1234.2.jsonl', [call(9, '2026-10-19T10:00:04.000Z', 'r-read', 'artifact_read')]);
    write('other999.jsonl', [answer(10, '2026-10-19T10:00:04.100Z', 'r-read')]); // another launch's file
    const calls = readToolCalls(base);
    expect(calls.spans).toEqual([
      { toolUseId: 'toolu_edit', name: 'artifact_edit', requestSeq: 4, responseSeq: 6, startedAt: '2026-10-19T10:00:02.000Z', answeredAt: '2026-10-19T10:00:02.090Z', ms: 90 },
      { toolUseId: 'toolu_publish', name: 'artifact_publish', requestSeq: 7, responseSeq: 8, startedAt: '2026-10-19T10:00:03.000Z', answeredAt: '2026-10-19T10:00:03.500Z', ms: 500 },
    ]);
    expect(calls.unanswered).toEqual([{ toolUseId: null, name: 'artifact_read', requestSeq: 9, startedAt: '2026-10-19T10:00:04.000Z' }]);
    // a rotation named on its own is read alone
    expect(readToolSpans(join(dir, 'abcd1234.1.jsonl')).map((s) => [s.name, s.ms])).toEqual([['artifact_publish', 500]]);
  });
});

describe('expectToolTime', () => {
  it('passes the store calls under the bound and returns their median and max', () => {
    const spans = readToolSpans(launch([['artifact_read', 0, 20], ['artifact_edit', 100, 40], ['artifact_read', 200, 30], ['send_file', 300, 5_000]]));
    expect(expectToolTime(spans)).toEqual({ calls: 3, medianMs: 30, maxMs: 40 });
  });

  it('fails naming every call over the bound, its tool, tool_use id and time', () => {
    const spans = readToolSpans(launch([['artifact_read', 0, 20], ['artifact_publish', 100, 1_250], ['artifact_edit', 2_000, 1_001], ['artifact_read', 4_000, 30], ['artifact_list', 5_000, 2], ['artifact_comments', 6_000, 3]]));
    expect(() => expectToolTime(spans)).toThrow(/artifact_publish toolu_1 took 1,250 ms, over the 1,000 ms bound\n {2}artifact_edit toolu_2 took 1,001 ms, over the 1,000 ms bound$/);
    expect(expectToolTime(spans, { bound: 2_000, median: 2_000 })).toMatchObject({ calls: 6, medianMs: 25, maxMs: 1_250 });
  });

  it('fails a median over half the bound though no call is over it', () => {
    const spans = readToolSpans(launch([['artifact_publish', 0, 600], ['artifact_read', 1_000, 100], ['artifact_publish', 2_000, 700], ['artifact_read', 3_000, 520]]));
    expect(() => expectToolTime(spans)).toThrow(/^MAWS's tool time is over the X34 bound \(test\/live\/support\/tool-time\.ts\):\n {2}the median of the 4 calls is 560 ms, over 500 ms$/);
    expect(() => expectToolTime(spans.slice(1, 2))).not.toThrow(); // the median of the one read alone, 100 ms
    expect(TOOL_TIME_MEDIAN_MS).toBe(TOOL_TIME_BOUND_MS / 2);
  });
});

describe('guardToolTime', () => {
  it('summarises the store calls, the render calls under their own bound and the withdrawn ones, other tools ignored', () => {
    const rows = launch([['artifact_create', 0, 40], ['artifact_screenshot', 100, 2_000], ['artifact_publish', 3_000, 60], ['send_file', 4_000, 9_000], ['artifact_edit', 20_000, null], ['artifact_read', 21_000, 10], ['ask', 22_000, null]]);
    const summary = guardToolTime(rows);
    expect(summary).toMatchObject({ guarded: 3, render: 1, medianMs: 40, maxMs: 60, renderMaxMs: 2_000, unanswered: 1 });
    expect(summary.spans.map((s) => s.name)).toEqual(['artifact_create', 'artifact_screenshot', 'artifact_publish', 'send_file', 'artifact_read']);
    expect(summary.line).toBe('3 store calls, median 40 ms, max 60 ms (bound 1,000 ms, median 500 ms); 1 render calls, max 2,000 ms (bound 3,500 ms); unanswered (withdrawn): artifact_edit toolu_4');
  });

  it('fails a render call over its own bound and a store call over the store bound in one error', () => {
    const rows = launch([['artifact_export', 0, RENDER_TOOL_TIME_BOUND_MS + 1], ['artifact_dataset', 10_000, 1_500], ['artifact_read', 20_000, 10], ['artifact_list', 21_000, 1]]);
    expect(() => guardToolTime(rows)).toThrow(/ {2}artifact_dataset toolu_1 took 1,500 ms, over the 1,000 ms bound\n {2}artifact_export toolu_0 took 3,501 ms, over the 3,500 ms bound$/);
  });

  it('reads a recorded journal by its path: E2’s screenshot under the render bound, its retired artifact_update ignored', () => {
    expect(guardToolTime(join(FIXTURES, 'p1-maws-artifacts.jsonl'))).toMatchObject({ guarded: 2, render: 1, medianMs: 2.5, maxMs: 4, renderMaxMs: 102, unanswered: 0 });
  });
});
