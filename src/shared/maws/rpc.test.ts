import { describe, expect, it } from 'vitest';
import { cancelledCallOf, readMcpMessage, toolCallOf } from './rpc';

const req = (message: unknown, server_name = 'maws') => ({ subtype: 'mcp_message', server_name, message });

describe('readMcpMessage (the one reading the server and the normaliser share)', () => {
  it('reads a request with its id, method and params', () => {
    expect(readMcpMessage(req({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ask' } }))).toEqual({ kind: 'request', id: 3, method: 'tools/call', params: { name: 'ask' } });
    expect(readMcpMessage(req({ jsonrpc: '2.0', id: 'x', method: 'ping' }))).toEqual({ kind: 'request', id: 'x', method: 'ping', params: {} });
  });

  it('names another server, with the message id when it has one', () => {
    expect(readMcpMessage(req({ jsonrpc: '2.0', id: 0, method: 'initialize' }, 'maws2'))).toEqual({ kind: 'other_server', serverName: 'maws2', id: 0 });
    expect(readMcpMessage(req('not an object', 'maws2'))).toEqual({ kind: 'other_server', serverName: 'maws2', id: null });
  });

  it('refuses a message that is not JSON-RPC 2.0 with a method, and a request with no server name', () => {
    expect(readMcpMessage(req({ jsonrpc: '1.0', id: 1, method: 'tools/call' }))).toEqual({ kind: 'invalid', id: 1 });
    expect(readMcpMessage(req({ jsonrpc: '2.0', id: 1 }))).toEqual({ kind: 'invalid', id: 1 });
    expect(readMcpMessage(req(['x']))).toEqual({ kind: 'invalid', id: null });
    expect(readMcpMessage({ subtype: 'mcp_message', message: { jsonrpc: '2.0', id: 1, method: 'ping' } })).toEqual({ kind: 'invalid', id: null });
  });

  it('takes an id that is neither a string nor a number as a notification', () => {
    expect(readMcpMessage(req({ jsonrpc: '2.0', method: 'notifications/initialized' }))).toEqual({ kind: 'notification', method: 'notifications/initialized', params: {} });
    for (const id of [null, true, { n: 1 }]) expect(readMcpMessage(req({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'ask' } }))).toEqual({ kind: 'notification', method: 'tools/call', params: { name: 'ask' } });
  });
});

// E1 review: how the engine's MCP client abandons a call it sent (the official SDK's request abort handler)
describe('cancelledCallOf', () => {
  it("reads the JSON-RPC id a notifications/cancelled names, and nothing from any other message", () => {
    expect(cancelledCallOf(readMcpMessage(req({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 3, reason: 'AbortError: This operation was aborted' } })))).toBe(3);
    expect(cancelledCallOf(readMcpMessage(req({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'x' } })))).toBe('x');
    for (const params of [{}, { requestId: null }, { requestId: { n: 1 } }]) expect(cancelledCallOf(readMcpMessage(req({ jsonrpc: '2.0', method: 'notifications/cancelled', params })))).toBeNull();
    expect(cancelledCallOf(readMcpMessage(req({ jsonrpc: '2.0', method: 'notifications/progress', params: { requestId: 3 } })))).toBeNull();
    expect(cancelledCallOf(readMcpMessage(req({ jsonrpc: '2.0', id: 1, method: 'notifications/cancelled', params: { requestId: 3 } })))).toBeNull(); // a request, not a notification
    expect(cancelledCallOf(readMcpMessage(req({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 3 } }, 'maws2')))).toBeNull();
  });
});

describe('toolCallOf', () => {
  it("reads the name, the raw arguments and the engine's tool-use id", () => {
    expect(toolCallOf({ name: 'ask', arguments: { a: 1 }, _meta: { 'claudecode/toolUseId': 'toolu_1' } })).toEqual({ name: 'ask', args: { a: 1 }, toolUseId: 'toolu_1' });
    expect(toolCallOf({ name: 'ask', _meta: { 'claudecode/toolUseId': 7 } })).toEqual({ name: 'ask', args: undefined, toolUseId: null });
  });
});
