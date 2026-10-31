// P5 O16 M3 (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3 and Interfaces §D; D24, D36, D42): what an adopter
// reads from a launch's journal before it consumes anything. Every file of the launch in order, a rotation included;
// the requests still outstanding: an engine request with neither an answer out nor a cancellation in, less a `tools/call`
// its MCP client withdrew (`notifications/cancelled`, correlated here by server and JSON-RPC id) and less an ask the
// journal records as retired; an async ask acknowledged and not yet answered or cancelled; and our requests with no
// response in. No row is ever identified by its content beyond its ids.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JournalRow } from '@shared/wire/journal';
import { JournalWriter } from '../journal';
import { launchRows, OutstandingSet, spawnRowOf } from './restore';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-restore-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

let seq = 0;
const row = (direction: JournalRow['direction'], frame: Record<string, unknown>): JournalRow => ({ seq: ++seq, direction, at: '2026-10-31T10:00:00.000Z', frame });
const request = (requestId: string, req: Record<string, unknown>) => row('in', { type: 'control_request', request_id: requestId, request: req });
const answer = (requestId: string, response: unknown = {}) => row('out', { type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
const toolsCall = (requestId: string, rpcId: number, name: string, args: unknown = {}, toolUseId = `toolu_${rpcId}`) =>
  request(requestId, { subtype: 'mcp_message', server_name: 'maws', message: { jsonrpc: '2.0', id: rpcId, method: 'tools/call', params: { name, arguments: args, _meta: { 'claudecode/toolUseId': toolUseId } } } });
const mcpAnswer = (requestId: string, rpcId: number, text: string) => answer(requestId, { mcp_response: { jsonrpc: '2.0', id: rpcId, result: { content: [{ type: 'text', text }] } } });

function fold(rows: JournalRow[]) {
  const set = new OutstandingSet();
  for (const r of rows) set.observe(r);
  return set.result();
}

describe('the outstanding set', () => {
  it('an engine request is outstanding until our answer goes out or the engine cancels it', () => {
    const out = fold([
      request('e-1', { subtype: 'can_use_tool', tool_name: 'Bash', input: {} }),
      request('e-2', { subtype: 'hook_callback', callback_id: 'maws_Stop_1', input: {} }),
      request('e-3', { subtype: 'request_user_dialog', dialog_kind: 'x' }),
      answer('e-1'),
      row('in', { type: 'control_cancel_request', request_id: 'e-3' }),
    ]);
    expect(out.inbound.map((r) => r.request.request_id)).toEqual(['e-2']);
    expect(out.inbound[0]!.seq).toBe(seq - 3);
  });

  it('a tools/call its MCP client withdrew (notifications/cancelled, same JSON-RPC id) is not outstanding; another id is', () => {
    const out = fold([
      toolsCall('e-10', 7, 'artifact_publish'),
      toolsCall('e-11', 8, 'artifact_publish'),
      request('e-12', { subtype: 'mcp_message', server_name: 'maws', message: { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 7 } } }),
      answer('e-12', { mcp_response: { jsonrpc: '2.0', result: {}, id: 0 } }),
    ]);
    expect(out.inbound.map((r) => r.request.request_id)).toEqual(['e-11']);
  });

  it('an async ask acknowledged is open until its answer\'s row or its cancellation; a blocking ask is a call in flight', () => {
    const asked = (askId: string) => JSON.stringify({ status: 'asked', askId }, null, 2);
    const out = fold([
      toolsCall('e-20', 1, 'ask', { questions: [], blocking: false }, 'toolu_async'),
      mcpAnswer('e-20', 1, asked('toolu_async')),
      toolsCall('e-21', 2, 'ask', { questions: [], blocking: false }, 'toolu_done'),
      mcpAnswer('e-21', 2, asked('toolu_done')),
      row('meta', { event: 'maws_ask_answered', askId: 'toolu_done', toolUseId: 'toolu_done', answers: [] }),
      toolsCall('e-22', 3, 'ask', { questions: [] }, 'toolu_blocking'),
      toolsCall('e-23', 4, 'ask', { questions: [] }, 'toolu_retired'),
      row('meta', { event: 'maws_ask_cancelled', askId: 'toolu_retired', toolUseId: 'toolu_retired', reason: 'withdrawn' }),
    ]);
    expect(out.asyncAsks.map((a) => [a.askId, a.request.request_id])).toEqual([['toolu_async', 'e-20']]);
    expect(out.inbound.map((r) => r.request.request_id)).toEqual(['e-22']);
  });

  it('our requests with no response in are the outbound set', () => {
    const ours = (id: string, subtype: string) => row('out', { type: 'control_request', request_id: id, request: { subtype } });
    const theirs = (id: string) => row('in', { type: 'control_response', response: { subtype: 'success', request_id: id } });
    expect(fold([ours('L-1', 'initialize'), theirs('L-1'), ours('L-2', 'interrupt'), ours('L-3', 'side_question'), theirs('L-3')]).outbound).toEqual(['L-2']);
  });
});

describe('the launch\'s rows', () => {
  it('reads every file of the launch in order, a rotation included, and finds its spawn row', () => {
    const writer = new JournalWriter(dir, 'launch01', { maxBytes: 400 });
    writer.row('meta', { event: 'reconnect', phase: 'attempting' });
    writer.row('meta', { event: 'spawn', bin: '/x/claude', args: ['-p'], envKeys: ['PATH'], cwd: '/w', gateway: 'direct', engineVersion: '2.1.283', launchId: 'launch01', sessionId: 'eng-1' });
    for (let i = 0; i < 10; i += 1) writer.row('in', { type: 'system', subtype: 'status', n: i, pad: 'x'.repeat(60) });
    const other = new JournalWriter(dir, 'launch02', { maxBytes: 400 });
    other.row('meta', { event: 'spawn' });
    const rows = [...launchRows(dir, 'launch01')];
    expect(rows.map((r) => r.seq)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(writer.currentPath).not.toBe(writer.path); // it did rotate
    expect(spawnRowOf(rows)).toMatchObject({ bin: '/x/claude', sessionId: 'eng-1', envKeys: ['PATH'] });
  });
});
