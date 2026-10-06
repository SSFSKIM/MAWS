import { describe, expect, it } from 'vitest';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import type { PendingAsk } from '@shared/maws/ask';
import type { ControlRequestFrame } from '@shared/wire/frames';
import { askTool } from './ask';
import { AskTable, type AskCancelReason } from './asks';
import { MawsToolServer } from './server';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const QUESTION = { id: 'q1', question: 'Proceed?', modality: 'choice', options: [{ label: 'Yes' }] };

function harness() {
  const asks = new AskTable();
  const cancelled: [string, AskCancelReason][] = [];
  const sent: unknown[] = [];
  const server = new MawsToolServer({
    tools: [askTool({ asks, cancelled: (ask: PendingAsk, reason) => cancelled.push([ask.askId, reason]) })],
    appSessionId: 'app-1' as AppSessionId, version: '0', cwd: () => '/r', log: () => {},
    respond: async (_requestId, response) => void sent.push(response),
  });
  const call = (requestId: string, args: unknown) =>
    server.accept({ type: 'control_request', request_id: requestId, request: { subtype: 'mcp_message', server_name: 'maws', message: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ask', arguments: args, _meta: { 'claudecode/toolUseId': `toolu_${requestId}` } } } } } as ControlRequestFrame);
  return { asks, cancelled, sent, server, call };
}

describe('the ask tool on the server (M2 fix wave: cancellation while the call is in flight)', () => {
  it.each([false, true])('an engine withdrawal before the call is answered cancels the ask (blocking %s), and nothing is written', async (blocking) => {
    const h = harness();
    h.call('r1', { blocking, questions: [QUESTION] });
    expect(h.asks.list().map((a) => a.askId)).toEqual(['toolu_r1']); // opened synchronously, the acknowledgement not yet written
    h.server.cancel('r1' as RequestId);
    await flush();
    expect(h.sent).toEqual([]);
    expect(h.cancelled).toEqual([['toolu_r1', 'withdrawn']]);
    expect(h.asks.list()).toEqual([]);
    expect(h.server.inFlight).toBe(0);
  });

  it('the process ending before an async acknowledgement is written cancels the ask for the exit', async () => {
    const h = harness();
    h.call('r1', { blocking: false, questions: [QUESTION] });
    h.server.processExited();
    await flush();
    expect(h.sent).toEqual([]);
    expect(h.cancelled).toEqual([['toolu_r1', 'exit']]);
    expect(h.asks.list()).toEqual([]);
  });

  it('an acknowledged async ask stays pending; a later withdrawal of the settled call changes nothing', async () => {
    const h = harness();
    h.call('r1', { blocking: false, questions: [QUESTION] });
    await flush();
    expect(h.sent).toHaveLength(1);
    h.server.cancel('r1' as RequestId); // no call in flight any more
    expect(h.cancelled).toEqual([]);
    expect(h.asks.list().map((a) => a.askId)).toEqual(['toolu_r1']);
  });
});
