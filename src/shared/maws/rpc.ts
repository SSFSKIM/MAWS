// How the `maws` server reads one `mcp_message` control request (E1 execution document, Interfaces "The host"; residue
// 1's admission rule): the engine host's server answers by this reading and the normaliser maps by it, so a message the
// server refuses on its envelope (another server, not JSON-RPC 2.0, no method) or takes as a notification (an id that
// is neither a string nor a number) never opens an ask, records a delivery or shows a pane in the event graph.
import type { ToolUseId } from '../graph/ids';
import { McpMessageRequestSchema } from '../wire/control';
import { MAWS_SERVER_NAME } from './tools';

export type RpcId = string | number;

export type McpMessageRead =
  | { kind: 'other_server'; serverName: string; id: RpcId | null } // answered -32601, naming the server
  | { kind: 'invalid'; id: RpcId | null } // not a JSON-RPC 2.0 message with a method: answered -32600
  | { kind: 'notification'; method: string } // no usable id: answered as the official SDK answers a notification
  | { kind: 'request'; id: RpcId; method: string; params: Record<string, unknown> };

export function readMcpMessage(request: unknown): McpMessageRead {
  const parsed = McpMessageRequestSchema.safeParse(request);
  const message = parsed.success && isObject(parsed.data.message) ? parsed.data.message : null;
  const id = message !== null && (typeof message.id === 'string' || typeof message.id === 'number') ? message.id : null;
  if (parsed.success && parsed.data.server_name !== MAWS_SERVER_NAME) return { kind: 'other_server', serverName: parsed.data.server_name, id };
  if (message === null || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return { kind: 'invalid', id };
  if (id === null) return { kind: 'notification', method: message.method };
  return { kind: 'request', id, method: message.method, params: isObject(message.params) ? message.params : {} };
}

// A `tools/call` request's tool name, raw arguments and the engine's correlator (`_meta["claudecode/toolUseId"]`).
export function toolCallOf(params: Record<string, unknown>): { name: unknown; args: unknown; toolUseId: ToolUseId | null } {
  const meta = isObject(params._meta) ? params._meta : {};
  const correlator = meta['claudecode/toolUseId'];
  return { name: params.name, args: params.arguments, toolUseId: typeof correlator === 'string' ? (correlator as ToolUseId) : null };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
