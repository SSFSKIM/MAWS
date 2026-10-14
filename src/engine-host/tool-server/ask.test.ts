import { describe, expect, it } from 'vitest';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import type { PendingAsk } from '@shared/maws/ask';
import type { ControlRequestFrame } from '@shared/wire/frames';
import { askTool } from './ask';
import { askAttentionItem, AskTable, type AskCancelReason } from './asks';
import { MawsToolServer, toolText } from './server';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const QUESTION = { id: 'q1', question: 'Proceed?', modality: 'choice', options: [{ label: 'Yes' }] };

function harness(subagentUses: readonly string[] = []) {
  const asks = new AskTable();
  const cancelled: [string, AskCancelReason][] = [];
  const sent: unknown[] = [];
  const server = new MawsToolServer({
    tools: [askTool({ asks, cancelled: (ask: PendingAsk, reason) => cancelled.push([ask.askId, reason]) })],
    appSessionId: 'app-1' as AppSessionId, version: '0', cwd: () => '/r', log: () => {},
    respond: async (_requestId, response) => void sent.push(response),
    fromSubagent: (toolUseId) => toolUseId !== null && subagentUses.includes(toolUseId), // P2-C3
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

// P2-C3 (the P2 spec's Decision Log 35): the server's `fromSubagent` names the calls a subagent made
describe("the ask tool for a subagent's call", () => {
  it('holds a non-blocking ask from a subagent as a blocking one: no acknowledgement, a question item, the answer in its own result', async () => {
    const h = harness(['toolu_r1']);
    h.call('r1', { blocking: false, questions: [QUESTION] });
    await flush();
    expect(h.sent).toEqual([]); // no {status: 'asked'}
    const [held] = h.asks.list();
    expect(held).toMatchObject({ askId: 'toolu_r1', blocking: true });
    expect(askAttentionItem(held!, 'app-1' as AppSessionId, null).kind).toBe('question');
    const written = toolText({ status: 'answered', askId: 'toolu_r1', answers: [{ id: 'q1', question: 'Proceed?', status: 'answered', value: ['Yes'], note: 'go' }] });
    expect(h.asks.claim('toolu_r1')).not.toBeNull();
    await h.server.reply('r1' as RequestId, written);
    h.asks.commit('toolu_r1', written);
    expect(h.sent).toEqual([{ mcp_response: { jsonrpc: '2.0', id: 1, result: written } }]);
  });

  it("keeps the main conversation's non-blocking ask asynchronous", async () => {
    const h = harness(['toolu_other']);
    h.call('r1', { blocking: false, questions: [QUESTION] });
    await flush();
    expect(h.asks.list()).toMatchObject([{ askId: 'toolu_r1', blocking: false }]);
    expect(h.sent).toEqual([{ mcp_response: { jsonrpc: '2.0', id: 1, result: toolText({ status: 'asked', askId: 'toolu_r1' }) } }]);
  });
});
