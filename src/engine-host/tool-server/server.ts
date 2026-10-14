// The `maws` MCP server (P1 spec §3 A, binding; E1 execution document, Interfaces "The host"): the one SDK-hosted server
// every MAWS-launched session declares at initialize, served from the engine host over the control protocol's
// `mcp_message` round trip. The engine is the MCP client: each JSON-RPC message arrives wrapped in a `control_request
// {subtype: 'mcp_message', server_name, message}` and is answered `{mcp_response: <the JSON-RPC response>}` (E0a Q1,
// pass3/p1-sdk-mcp-roundtrip seqs 5 to 14). The handshake interleaves with the host's own initialize, so the server
// answers from construction on. A tool's failure is an MCP result with `isError: true`, which the model reads as an
// ordinary failed call; JSON-RPC errors answer only an unknown method or a malformed message (residue 4). A call the
// engine withdrew (its control request cancelled, or the call abandoned by its MCP client's `notifications/cancelled`,
// as when the user interrupts the turn), or one still running when the process ended, is aborted (its signal's reason
// `withdrawn` or `exit`) and answered with nothing: no one waits. A call may instead be answered from outside its tool
// through `reply` (a blocking ask, whose answer must be committed only once its write settled: residue 12); the tool
// settling after that writes nothing more. Nothing here builds an event: the normaliser maps the `tools/call` rows and their answers.
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { cancelledCallOf, readMcpMessage, toolCallOf, type RpcId } from '@shared/maws/rpc';
import { mawsServerInfo, mawsToolList, TOOL_ERRORS, type MawsToolName } from '@shared/maws/tools';
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
  // P2-C3 (the P2 spec's Decision Log 35): the call is a subagent's, told by its tool use having arrived in an assistant
  // frame whose `parent_tool_use_id` is set (MawsToolServerDeps.fromSubagent); false when nothing tells
  fromSubagent: boolean;
}

// E2: an image block (`artifact_screenshot`'s PNG) reaches the model unchanged; the engine inserts its own text block
// pointing at the original it saved (E2 M0, pass3/p1-sdk-mcp-image seq 69).
export type McpContentBlock = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

export interface McpToolResult {
  content: McpContentBlock[];
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


export interface MawsToolServerDeps {
  tools: McpToolDefinition[];
  respond: (requestId: RequestId, response: unknown, opts?: WriteOptions) => Promise<void>;
  cwd: () => string;
  appSessionId: AppSessionId;
  version: string; // the app's, for `serverInfo`
  log: (message: string) => void;
  onChange?: () => void; // the calls in flight changed (the session's status counts them)
  fromSubagent?: (toolUseId: ToolUseId | null) => boolean; // P2-C3: the normaliser's reading of the frames before the call
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

  // Every `mcp_message` the engine sends, read as the normaliser reads it (src/shared/maws/rpc.ts); answered through
  // `respond`, a call once its tool settles.
  accept(req: ControlRequestFrame): void {
    const requestId = req.request_id as RequestId;
    const message = readMcpMessage(req.request);
    if (message.kind === 'other_server') {
      // the engine addresses only servers the host declared; a stray name (E0a's probe-only `maws2`) is still answered
      this.error(requestId, message.id ?? 0, JSONRPC_METHOD_NOT_FOUND, `MAWS serves no MCP server named "${message.serverName}"`);
      return;
    }
    if (message.kind === 'invalid') {
      this.error(requestId, message.id, JSONRPC_INVALID_REQUEST, 'Invalid Request: not a JSON-RPC 2.0 message');
      return;
    }
    if (message.kind === 'notification') {
      this.write(requestId, { jsonrpc: '2.0', result: {}, id: 0 }); // a notification: the official SDK's answer (E0a seq 11)
      const abandoned = cancelledCallOf(message);
      if (abandoned !== null) this.abandoned(abandoned);
      return;
    }
    const { id, params } = message;
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

  // The engine's MCP client gave up on the call it sent with this JSON-RPC id (`notifications/cancelled`): it has dropped
  // the call's response handler, so the call aborts as a withdrawn one does. A call already answered (its answer is on
  // its way or written) is left to settle; an id naming no call in flight is nothing.
  private abandoned(id: RpcId): void {
    for (const call of this.calls.values()) {
      if (call.id === id && !call.answered) call.controller.abort('withdrawn' satisfies CallAbortReason);
    }
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
    const { name, args, toolUseId } = toolCallOf(params);
    const tool = typeof name === 'string' ? this.tools.get(name) : undefined;
    if (!tool) {
      this.result(requestId, id, toolError(TOOL_ERRORS.unknownTool(String(name))));
      return;
    }
    const controller = new AbortController();
    const call = { id, controller, answered: false };
    this.calls.set(requestId, call);
    this.deps.onChange?.();
    let result: McpToolResult;
    try {
      result = await tool.call(args, { appSessionId: this.deps.appSessionId, cwd: this.deps.cwd(), toolUseId, requestId, signal: controller.signal, fromSubagent: this.deps.fromSubagent?.(toolUseId) ?? false });
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
