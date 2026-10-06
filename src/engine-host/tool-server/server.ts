// The `maws` MCP server (P1 spec §3 A, binding; E1 execution document, Interfaces "The host"): the one SDK-hosted server
// every MAWS-launched session declares at initialize, served from the engine host over the control protocol's
// `mcp_message` round trip. The engine is the MCP client: each JSON-RPC message arrives wrapped in a `control_request
// {subtype: 'mcp_message', server_name, message}` and is answered `{mcp_response: <the JSON-RPC response>}` (E0a Q1,
// pass3/p1-sdk-mcp-roundtrip seqs 5 to 14). The handshake interleaves with the host's own initialize, so the server
// answers from construction on. A tool's failure is an MCP result with `isError: true`, which the model reads as an
// ordinary failed call; JSON-RPC errors answer only an unknown method or a malformed message (residue 4). A call the
// engine withdrew, or one still running when the process ended, is aborted (its signal's reason `withdrawn` or `exit`)
// and answered with nothing: no one waits. A call may instead be answered from outside its tool through `reply` (a
// blocking ask, whose answer must be committed only once its write settled: residue 12); the tool settling after that
// writes nothing more. Nothing here builds an event: the normaliser maps the `tools/call` rows and their answers.
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { MAWS_SERVER_NAME, mawsServerInfo, mawsToolList, TOOL_ERRORS, type MawsToolName } from '@shared/maws/tools';
import { McpMessageRequestSchema } from '@shared/wire/control';
import type { ControlRequestFrame } from '@shared/wire/frames';
import type { WriteOptions } from '../outbound-writer';

// Why a call's signal aborted (`signal.reason`).
export type CallAbortReason = 'withdrawn' | 'exit';

export interface McpToolContext {
  appSessionId: AppSessionId;
  cwd: string; // the engine's working directory (the tracker's, else the launch spec's)
  toolUseId: ToolUseId | null; // `params._meta["claudecode/toolUseId"]`: the transcript's id for the call
  requestId: RequestId; // the engine's `mcp_message` control request
  signal: AbortSignal; // aborted when the engine withdraws the request or the process ends
}

export interface McpToolResult {
  content: { type: 'text'; text: string }[];
  isError?: true;
}

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, unknown>;
  call(args: unknown, ctx: McpToolContext): Promise<McpToolResult>;
}

// A successful result: the value as pretty-printed JSON. A tool error: the refusal's text.
export const toolText = (value: unknown): McpToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
export const toolError = (text: string): McpToolResult => ({ content: [{ type: 'text', text }], isError: true });

// One X9 tool as `tools/list` describes it (src/shared/maws/tools.ts), served by `call`.
export function defineMawsTool(name: MawsToolName, call: McpToolDefinition['call']): McpToolDefinition {
  const entry = mawsToolList().find((tool) => tool.name === name)!;
  return { ...entry, call };
}

export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
const FALLBACK_PROTOCOL_VERSION = '2025-11-25'; // what 2.1.290 offers (E0a seq 5), for a client that names none

type RpcId = string | number;
type RpcMessage = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

export interface MawsToolServerDeps {
  tools: McpToolDefinition[];
  respond: (requestId: RequestId, response: unknown, opts?: WriteOptions) => Promise<void>;
  cwd: () => string;
  appSessionId: AppSessionId;
  version: string; // the app's, for `serverInfo`
  log: (message: string) => void;
  onChange?: () => void; // the calls in flight changed (the session's status counts them)
}

export class MawsToolServer {
  private readonly tools: Map<string, McpToolDefinition>;
  private readonly calls = new Map<RequestId, { id: RpcId; controller: AbortController; answered: boolean }>();

  constructor(private readonly deps: MawsToolServerDeps) {
    this.tools = new Map(deps.tools.map((tool) => [tool.name, tool]));
  }

  get inFlight(): number {
    return this.calls.size;
  }

  // Every `mcp_message` the engine sends; answered through `respond`, a call once its tool settles.
  accept(req: ControlRequestFrame): void {
    const requestId = req.request_id as RequestId;
    const parsed = McpMessageRequestSchema.safeParse(req.request);
    const message = (parsed.success && isObject(parsed.data.message) ? parsed.data.message : null) as RpcMessage | null;
    const id = message !== null && (typeof message.id === 'string' || typeof message.id === 'number') ? message.id : null;
    if (parsed.success && parsed.data.server_name !== MAWS_SERVER_NAME) {
      // the engine addresses only servers the host declared; a stray name (E0a's probe-only `maws2`) is still answered
      this.error(requestId, id ?? 0, JSONRPC_METHOD_NOT_FOUND, `MAWS serves no MCP server named "${parsed.data.server_name}"`);
      return;
    }
    if (message === null || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      this.error(requestId, id, JSONRPC_INVALID_REQUEST, 'Invalid Request: not a JSON-RPC 2.0 message');
      return;
    }
    if (id === null) {
      this.write(requestId, { jsonrpc: '2.0', result: {}, id: 0 }); // a notification: the official SDK's answer (E0a seq 11)
      return;
    }
    const params = isObject(message.params) ? (message.params as Record<string, unknown>) : {};
    switch (message.method) {
      case 'initialize': {
        const protocolVersion = typeof params.protocolVersion === 'string' ? params.protocolVersion : FALLBACK_PROTOCOL_VERSION;
        this.result(requestId, id, { protocolVersion, capabilities: { tools: { listChanged: true } }, serverInfo: mawsServerInfo(this.deps.version) });
        return;
      }
      case 'ping':
        this.result(requestId, id, {});
        return;
      case 'tools/list':
        this.result(requestId, id, { tools: [...this.tools.values()].map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })) });
        return;
      case 'tools/call':
        void this.call(requestId, id, params);
        return;
      default:
        this.error(requestId, id, JSONRPC_METHOD_NOT_FOUND, `Method not found: ${message.method}`);
    }
  }

  // The engine withdrew the request (`control_cancel_request`): the call's signal aborts and nothing is answered.
  cancel(requestId: RequestId): void {
    this.calls.get(requestId)?.controller.abort('withdrawn' satisfies CallAbortReason);
  }

  // The process is gone: every call in flight aborts; the pipe that would take their answers is closed.
  processExited(): void {
    for (const call of this.calls.values()) call.controller.abort('exit' satisfies CallAbortReason);
  }

  // Answers a call still in flight now, with the write's options (its `flushed` row), and settles only once the write
  // did: a refused write rejects and leaves the call open for another answer. The call's tool settling afterwards writes
  // nothing more. Rejects for a call that is not waiting (unknown, aborted, or already answered).
  async reply(requestId: RequestId, result: McpToolResult, opts: WriteOptions = {}): Promise<void> {
    const call = this.calls.get(requestId);
    if (!call || call.answered || call.controller.signal.aborted) throw new Error(`no call ${requestId} waits for an answer`);
    call.answered = true; // before the write: its flushed row may settle the tool before the write's promise resolves
    try {
      await this.deps.respond(requestId, { mcp_response: { jsonrpc: '2.0', id: call.id, result } }, opts);
    } catch (error) {
      call.answered = false;
      throw error;
    }
  }

  private async call(requestId: RequestId, id: RpcId, params: Record<string, unknown>): Promise<void> {
    const name = params.name;
    const tool = typeof name === 'string' ? this.tools.get(name) : undefined;
    if (!tool) {
      this.result(requestId, id, toolError(TOOL_ERRORS.unknownTool(String(name))));
      return;
    }
    const meta = isObject(params._meta) ? (params._meta as Record<string, unknown>) : {};
    const toolUseId = typeof meta['claudecode/toolUseId'] === 'string' ? (meta['claudecode/toolUseId'] as ToolUseId) : null;
    const controller = new AbortController();
    const call = { id, controller, answered: false };
    this.calls.set(requestId, call);
    this.deps.onChange?.();
    let result: McpToolResult;
    try {
      result = await tool.call(params.arguments, { appSessionId: this.deps.appSessionId, cwd: this.deps.cwd(), toolUseId, requestId, signal: controller.signal });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.log(`${tool.name} ${requestId} failed: ${message}`);
      result = toolError(`${tool.name}: ${message}`);
    } finally {
      this.calls.delete(requestId);
      this.deps.onChange?.();
    }
    if (controller.signal.aborted || call.answered) return;
    this.result(requestId, id, result);
  }

  private result(requestId: RequestId, id: RpcId, result: unknown): void {
    this.write(requestId, { jsonrpc: '2.0', id, result }); // the key order the engine echoes back (E0a seqs 6 and 9)
  }

  private error(requestId: RequestId, id: RpcId | null, code: number, message: string): void {
    this.write(requestId, { jsonrpc: '2.0', id, error: { code, message } });
  }

  private write(requestId: RequestId, rpc: Record<string, unknown>): void {
    this.deps.respond(requestId, { mcp_response: rpc }).catch((error: unknown) => this.deps.log(`mcp_message ${requestId} not answered: ${error instanceof Error ? error.message : String(error)}`));
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
