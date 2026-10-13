import { describe, expect, it } from 'vitest';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import { mawsToolList, TOOL_ERRORS } from '@shared/maws/tools';
import type { ControlRequestFrame } from '@shared/wire/frames';
import { defineMawsTool, MawsToolServer, toolText, type McpToolContext, type McpToolDefinition } from './server';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness(tools: McpToolDefinition[] = []) {
  const sent: { requestId: RequestId; response: unknown }[] = [];
  const logs: string[] = [];
  let changes = 0;
  const server = new MawsToolServer({
    tools, appSessionId: 'app-1' as AppSessionId, version: '0.9.0', cwd: () => '/r/repo', log: (m) => logs.push(m), onChange: () => changes++,
    respond: async (requestId, response) => void sent.push({ requestId, response }),
  });
  let n = 0;
  const send = (message: unknown, server_name = 'maws'): RequestId => {
    const request_id = `req-${++n}`;
    server.accept({ type: 'control_request', request_id, request: { subtype: 'mcp_message', server_name, message } } as ControlRequestFrame);
    return request_id as RequestId;
  };
  const rpcOf = (requestId: RequestId) => (sent.find((s) => s.requestId === requestId)?.response as { mcp_response?: unknown } | undefined)?.mcp_response;
  return { server, sent, logs, send, rpcOf, changes: () => changes };
}

describe('the maws server speaks MCP over mcp_message (E0a Q1)', () => {
  it('answers initialize with the offered protocol version, the listChanged capability and its info', async () => {
    const { send, rpcOf } = harness();
    const id = send({ method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'claude-code', version: '2.1.290' } }, jsonrpc: '2.0', id: 0 });
    await flush();
    expect(rpcOf(id)).toEqual({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-11-25', capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'maws', version: '0.9.0' } } });
    expect(JSON.stringify(rpcOf(id)).startsWith('{"jsonrpc":"2.0","id":0,"result"')).toBe(true); // the key order the engine echoes
  });

  it("answers a notification as the official SDK does, and ping with an empty result", async () => {
    const { send, rpcOf } = harness();
    const note = send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const ping = send({ jsonrpc: '2.0', id: 7, method: 'ping' });
    await flush();
    expect(JSON.stringify(rpcOf(note))).toBe('{"jsonrpc":"2.0","result":{},"id":0}'); // pass3/p1-sdk-mcp-roundtrip seq 11
    expect(rpcOf(ping)).toEqual({ jsonrpc: '2.0', id: 7, result: {} });
  });

  it('lists its tools with their titles, descriptions, JSON schemas and annotations', async () => {
    const tools = mawsToolList().map((entry) => defineMawsTool(entry.name, async () => toolText({})));
    const { send, rpcOf } = harness(tools);
    const id = send({ method: 'tools/list', jsonrpc: '2.0', id: 1 });
    await flush();
    expect(rpcOf(id)).toEqual({ jsonrpc: '2.0', id: 1, result: { tools: mawsToolList() } });
  });

  it('calls a tool with the context of the call and answers its result', async () => {
    const seen: { args: unknown; ctx: McpToolContext }[] = [];
    const tool = defineMawsTool('send_file', async (args, ctx) => {
      seen.push({ args, ctx });
      return toolText({ status: 'delivered', deliverables: [] });
    });
    const { send, rpcOf } = harness([tool]);
    const id = send({ method: 'tools/call', params: { name: 'send_file', arguments: { files: ['a.txt'] }, _meta: { 'claudecode/toolUseId': 'toolu_01', progressToken: 2 } }, jsonrpc: '2.0', id: 2 });
    await flush();
    expect(seen).toMatchObject([{ args: { files: ['a.txt'] }, ctx: { appSessionId: 'app-1', cwd: '/r/repo', toolUseId: 'toolu_01', requestId: id } }]);
    expect(rpcOf(id)).toEqual({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: JSON.stringify({ status: 'delivered', deliverables: [] }, null, 2) }] } });
  });

  it('answers an unknown tool, and a tool that throws, as tool errors (isError), never JSON-RPC errors', async () => {
    const boom = defineMawsTool('show_pane', async () => {
      throw new Error('disk on fire');
    });
    const { send, rpcOf, logs } = harness([boom]);
    const unknown = send({ method: 'tools/call', params: { name: 'echo_file', arguments: { path: 'probe.txt' } }, jsonrpc: '2.0', id: 2 });
    const thrown = send({ method: 'tools/call', params: { name: 'show_pane', arguments: { pane: 'terminal' } }, jsonrpc: '2.0', id: 3 });
    await flush();
    expect(rpcOf(unknown)).toEqual({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: TOOL_ERRORS.unknownTool('echo_file') }], isError: true } });
    expect(TOOL_ERRORS.unknownTool('echo_file')).toBe(
      'unknown tool "echo_file"; the maws server has send_file, ask, show_pane, artifact_create, artifact_list, artifact_screenshot, artifact_describe_type, artifact_read, artifact_publish, artifact_upload_asset, artifact_list_assets, artifact_export',
    ); // E2: seven; E4c: thirteen; P1 A-54 (2026-10-08): seven again; P3-A (M6): twelve, artifact_update retired
    expect(rpcOf(thrown)).toEqual({ jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: 'show_pane: disk on fire' }], isError: true } });
    expect(logs.join('\n')).toContain('disk on fire');
  });

  it('answers an unknown method -32601, a malformed message -32600, and another server -32601 naming it', async () => {
    const { send, rpcOf } = harness();
    const method = send({ jsonrpc: '2.0', id: 4, method: 'resources/list' });
    const malformed = send({ id: 5, method: 'ping' });
    const notObject = send('ping');
    const other = send({ method: 'initialize', params: { protocolVersion: '2025-11-25' }, jsonrpc: '2.0', id: 0 }, 'maws2');
    await flush();
    expect(rpcOf(method)).toEqual({ jsonrpc: '2.0', id: 4, error: { code: -32601, message: 'Method not found: resources/list' } });
    expect(rpcOf(malformed)).toEqual({ jsonrpc: '2.0', id: 5, error: { code: -32600, message: 'Invalid Request: not a JSON-RPC 2.0 message' } });
    expect(rpcOf(notObject)).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request: not a JSON-RPC 2.0 message' } });
    expect(rpcOf(other)).toEqual({ jsonrpc: '2.0', id: 0, error: { code: -32601, message: 'MAWS serves no MCP server named "maws2"' } });
  });

  it('counts calls in flight; a withdrawn call and every call at exit are aborted and answered with nothing', async () => {
    const signals: AbortSignal[] = [];
    const held = defineMawsTool('show_pane', (_args, ctx) => {
      signals.push(ctx.signal);
      return new Promise((resolve) => ctx.signal.addEventListener('abort', () => resolve(toolText({ late: true }))));
    });
    const { server, send, sent, changes } = harness([held]);
    const a = send({ method: 'tools/call', params: { name: 'show_pane', arguments: {} }, jsonrpc: '2.0', id: 1 });
    send({ method: 'tools/call', params: { name: 'show_pane', arguments: {} }, jsonrpc: '2.0', id: 2 });
    send({ method: 'tools/call', params: { name: 'show_pane', arguments: {} }, jsonrpc: '2.0', id: 3 });
    await flush();
    expect(server.inFlight).toBe(3);
    expect(changes()).toBeGreaterThan(0);
    server.cancel(a);
    server.cancel('not-a-call' as RequestId);
    await flush();
    expect(signals.map((s) => s.aborted)).toEqual([true, false, false]);
    expect(server.inFlight).toBe(2);
    server.processExited();
    await flush();
    expect(signals.every((s) => s.aborted)).toBe(true);
    expect(signals.map((s) => s.reason)).toEqual(['withdrawn', 'exit', 'exit']); // E1 M2: an ask's cancellation names why
    expect(server.inFlight).toBe(0);
    expect(sent).toEqual([]); // no one waits for those answers
  });

  // E1 review: the engine's MCP client abandons a call (a turn interrupted while an ask waits) by the MCP notification
  // `notifications/cancelled` naming the call's JSON-RPC id, not by a control_cancel_request
  it('a notifications/cancelled naming a call in flight aborts it as withdrawn and answers only the notification', async () => {
    const signals: AbortSignal[] = [];
    const held = defineMawsTool('show_pane', (_args, ctx) => {
      signals.push(ctx.signal);
      return new Promise((resolve) => ctx.signal.addEventListener('abort', () => resolve(toolText({ late: true }))));
    });
    const { server, send, sent, rpcOf } = harness([held]);
    const a = send({ method: 'tools/call', params: { name: 'show_pane', arguments: {} }, jsonrpc: '2.0', id: 1 });
    const b = send({ method: 'tools/call', params: { name: 'show_pane', arguments: {} }, jsonrpc: '2.0', id: 'two' });
    await flush();
    const note = send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'two', reason: 'AbortError: This operation was aborted' } });
    await flush();
    expect(signals.map((s) => s.aborted)).toEqual([false, true]);
    expect(signals[1]!.reason).toBe('withdrawn');
    expect(server.inFlight).toBe(1);
    expect(JSON.stringify(rpcOf(note))).toBe('{"jsonrpc":"2.0","result":{},"id":0}'); // the notification itself, as any
    expect(rpcOf(b)).toBeUndefined();
    expect(rpcOf(a)).toBeUndefined();
    expect(sent.map((s) => s.requestId)).toEqual([note]);
  });

  it('a notifications/cancelled naming no call in flight, or a call already answered, changes nothing', async () => {
    let settle!: (result: ReturnType<typeof toolText>) => void;
    const signals: AbortSignal[] = [];
    const held = defineMawsTool('ask', (_args, ctx) => {
      signals.push(ctx.signal);
      return new Promise((resolve) => (settle = resolve));
    });
    const { server, send, rpcOf } = harness([held]);
    const call = send({ method: 'tools/call', params: { name: 'ask', arguments: {} }, jsonrpc: '2.0', id: 5 });
    await flush();
    for (const params of [{ requestId: 6 }, { requestId: '5' }, { reason: 'no id' }, undefined]) send({ jsonrpc: '2.0', method: 'notifications/cancelled', ...(params && { params }) });
    send({ jsonrpc: '2.0', method: 'notifications/progress', params: { requestId: 5, progressToken: 1, progress: 1 } }); // another notification
    await flush();
    expect(signals[0]!.aborted).toBe(false);
    expect(server.inFlight).toBe(1);
    const result = toolText({ status: 'answered' });
    await server.reply(call, result);
    send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 5 } }); // too late: the answer is written
    await flush();
    expect(signals[0]!.aborted).toBe(false);
    settle(result);
    await flush();
    expect(rpcOf(call)).toEqual({ jsonrpc: '2.0', id: 5, result });
    expect(server.inFlight).toBe(0);
  });

  // E1 M2: a blocking ask answers its own call with the write's outcome in hand (residue 12)
  it('reply answers a call in flight with the given write options, and the tool settling after writes nothing more', async () => {
    let settle!: (result: ReturnType<typeof toolText>) => void;
    const held = defineMawsTool('ask', () => new Promise((resolve) => (settle = resolve)));
    const options: unknown[] = [];
    const sent: { requestId: RequestId; response: unknown }[] = [];
    let fail = true;
    const server = new MawsToolServer({
      tools: [held], appSessionId: 'app-1' as AppSessionId, version: '0', cwd: () => '/r', log: () => {},
      respond: async (requestId, response, opts) => {
        options.push(opts);
        if (fail) throw new Error('EPIPE');
        sent.push({ requestId, response });
      },
    });
    server.accept({ type: 'control_request', request_id: 'r1', request: { subtype: 'mcp_message', server_name: 'maws', message: { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'ask', arguments: {} } } } } as ControlRequestFrame);
    await flush();
    const result = toolText({ status: 'answered' });
    const flushed = () => {};
    await expect(server.reply('r1' as RequestId, result, { flushed })).rejects.toThrow('EPIPE');
    expect(server.inFlight).toBe(1); // a refused write leaves the call open for a retry
    fail = false;
    await server.reply('r1' as RequestId, result, { flushed });
    expect(options).toEqual([{ flushed }, { flushed }]);
    expect(sent).toEqual([{ requestId: 'r1', response: { mcp_response: { jsonrpc: '2.0', id: 4, result } } }]);
    await expect(server.reply('r1' as RequestId, result)).rejects.toThrow('no call r1 waits for an answer'); // answered once
    settle(result);
    await flush();
    expect(sent).toHaveLength(1);
    expect(server.inFlight).toBe(0);
    await expect(server.reply('r9' as RequestId, result)).rejects.toThrow('no call r9 waits for an answer');
  });

  it('logs an answer the pipe refused', async () => {
    const logs: string[] = [];
    const server = new MawsToolServer({ tools: [], appSessionId: 'app-1' as AppSessionId, version: '0', cwd: () => '/r', log: (m) => logs.push(m), respond: async () => Promise.reject(new Error('no engine process')) });
    server.accept({ type: 'control_request', request_id: 'r1', request: { subtype: 'mcp_message', server_name: 'maws', message: { jsonrpc: '2.0', id: 1, method: 'ping' } } } as ControlRequestFrame);
    await flush();
    expect(logs).toEqual(['mcp_message r1 not answered: no engine process']);
  });
});
