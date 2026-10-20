// X34's journal reader over a recorded journal and over the cases a live run can leave: a call answered after the
// writer's rotation, a call never answered, an error answer, and `mcp_message` traffic that is not a tool call.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readToolSpans } from './tool-time';

const REPO = resolve(__dirname, '../../..');
const ARTIFACTS = join(REPO, 'spikes/protocol-probe/fixtures/pass3/p1-maws-artifacts.jsonl');

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

const call = (seq: number, at: string, requestId: string, name: string, toolUseId?: string, method = 'tools/call') => ({
  seq,
  direction: 'in',
  at,
  frame: { type: 'control_request', request_id: requestId, request: { subtype: 'mcp_message', server_name: 'maws', message: { jsonrpc: '2.0', id: seq, method, params: { name, arguments: {}, ...(toolUseId ? { _meta: { 'claudecode/toolUseId': toolUseId } } : {}) } } } },
});
const answer = (seq: number, at: string, requestId: string, subtype: 'success' | 'error' = 'success') => ({
  seq,
  direction: 'out',
  at,
  frame: { type: 'control_response', response: subtype === 'success' ? { subtype, request_id: requestId, response: { mcp_response: { jsonrpc: '2.0', id: 0, result: { content: [] } } } } : { subtype, request_id: requestId, error: 'refused' } },
});
const write = (file: string, rows: object[]) => writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');

describe('readToolSpans', () => {
  it('reads every tool call of a recorded journal with its answer, by request id', () => {
    const spans = readToolSpans(ARTIFACTS);
    expect(spans.map((s) => s.name)).toEqual(['artifact_create', 'artifact_screenshot', 'artifact_update', 'artifact_list', 'artifact_update']);
    expect(spans[0]).toEqual({ toolUseId: 'toolu_01WzDzsxgQVaHD2wjyyt61Yt', name: 'artifact_create', requestSeq: 183, responseSeq: 184, startedAt: '2026-10-06T12:53:13.540Z', answeredAt: '2026-10-06T12:53:13.544Z', ms: 4 });
    expect(spans[1]!.ms).toBe(102);
    for (const span of spans) expect(span.ms).toBe(Date.parse(span.answeredAt!) - Date.parse(span.startedAt));
  });

  it('follows the launch into its rotations, keeps an unanswered call with null times, counts an error answer and skips other MCP methods', () => {
    dir = mkdtempSync(join(tmpdir(), 'maws-tool-time-'));
    const base = join(dir, 'abcd1234.jsonl');
    write(base, [
      { seq: 1, direction: 'meta', at: '2026-10-19T10:00:00.000Z', frame: { event: 'spawn' } },
      call(2, '2026-10-19T10:00:01.000Z', 'r-list', 'tools/list', undefined, 'tools/list'),
      answer(3, '2026-10-19T10:00:01.010Z', 'r-list'),
      call(4, '2026-10-19T10:00:02.000Z', 'r-edit', 'artifact_edit', 'toolu_edit'),
      answer(5, '2026-10-19T10:00:02.040Z', 'r-other'), // answers a request this reader never saw
    ]);
    write(join(dir, 'abcd1234.1.jsonl'), [answer(6, '2026-10-19T10:00:02.090Z', 'r-edit'), call(7, '2026-10-19T10:00:03.000Z', 'r-publish', 'artifact_publish', 'toolu_publish'), answer(8, '2026-10-19T10:00:03.500Z', 'r-publish', 'error')]);
    write(join(dir, 'abcd1234.2.jsonl'), [call(9, '2026-10-19T10:00:04.000Z', 'r-read', 'artifact_read')]);
    write(join(dir, 'other999.jsonl'), [answer(10, '2026-10-19T10:00:04.100Z', 'r-read')]); // another launch's file

    expect(readToolSpans(base)).toEqual([
      { toolUseId: 'toolu_edit', name: 'artifact_edit', requestSeq: 4, responseSeq: 6, startedAt: '2026-10-19T10:00:02.000Z', answeredAt: '2026-10-19T10:00:02.090Z', ms: 90 },
      { toolUseId: 'toolu_publish', name: 'artifact_publish', requestSeq: 7, responseSeq: 8, startedAt: '2026-10-19T10:00:03.000Z', answeredAt: '2026-10-19T10:00:03.500Z', ms: 500 },
      { toolUseId: null, name: 'artifact_read', requestSeq: 9, responseSeq: null, startedAt: '2026-10-19T10:00:04.000Z', answeredAt: null, ms: null },
    ]);
    // a rotation named on its own is read alone
    expect(readToolSpans(join(dir, 'abcd1234.1.jsonl')).map((s) => [s.name, s.ms])).toEqual([['artifact_publish', 500]]);
  });
});
