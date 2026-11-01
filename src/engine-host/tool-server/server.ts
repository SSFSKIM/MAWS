// The `maws` MCP server (P1 spec §3 A, binding; E1 execution document, Interfaces "The host"): the one SDK-hosted server
// every MAWS-launched session declares at initialize, served from the engine host over the control protocol's
// `mcp_message` round trip. The engine is the MCP client: each JSON-RPC message arrives wrapped in a `control_request
// {subtype: 'mcp_message', server_name, message}` and is answered `{mcp_response: <the JSON-RPC response>}` (E0a Q1,
// pass3/p1-sdk-mcp-roundtrip seqs 5 to 14). The handshake interleaves with the host's own initialize, so the server
// answers from construction on; its initialize answer carries MAWS's always-on `instructions` (P4-B4). A tool's failure is an MCP result with `isError: true`, which the model reads as an
// ordinary failed call; JSON-RPC errors answer only an unknown method or a malformed message (residue 4). A call the
// engine withdrew (its control request cancelled, or the call abandoned by its MCP client's `notifications/cancelled`,
// as when the user interrupts the turn), or one still running when the process ended, is aborted (its signal's reason
// `withdrawn` or `exit`) and answered with nothing: no one waits. A call may instead be answered from outside its tool
// through `reply` (a blocking ask, whose answer must be committed only once its write settled: residue 12); the tool
// settling after that writes nothing more. Nothing here builds an event: the normaliser maps the `tools/call` rows and their answers.
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { cancelledCallOf, readMcpMessage, toolCallOf, type RpcId } from '@shared/maws/rpc';
import { mawsServerInfo, mawsToolList, TOOL_ERRORS, type MawsToolName } from '@shared/maws/tools';
import { MAWS_SERVER_INSTRUCTIONS } from '@shared/maws/instructions'; // P4-B4
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
  _meta?: Record<string, unknown>; // P4-R7: listed as the tool's `_meta` (`message`'s alwaysLoad)
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

// P5 O16 M3 (holder design §3.3; Interfaces §D): the answer to a `maws` tool call the old manager left running when its
// engine host stopped. Never a retryable error: the call's effect may have completed.
export const ORPHANED_CALL_TEXT = "MAWS's engine host restarted while this tool ran. Its result is unknown and its effect may have completed; check before retrying.";

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
  hold?: () => Promise<void>; // P5 O16 M3c: the e2e's hold (./e2e-hold.ts), awaited before any tool but `ask` runs
  gate?: () => Promise<void>; // P5 O16 M3c fix wave 2: the e2e's gate (./e2e-hold.ts), awaited before any call but `ask` is dispatched
}

export class MawsToolServer {
  private readonly tools: Map<string, McpToolDefinition>;
  private readonly calls = new Map<RequestId, { id: RpcId; controller: AbortController; answered: boolean }>();
  // P5 O16 M3b: the calls the handover's drain waits for; M3c fix wave 2 (D63): each with its tool's name, in call order
  private readonly delivering = new Map<RequestId, string>();
  private callsStarted = 0;

  constructor(private readonly deps: MawsToolServerDeps) {
    this.tools = new Map(deps.tools.map((tool) => [tool.name, tool]));
  }

  // P4-A3: how many calls have started, ever: a read the host makes knows from it whether one ran beside it
  get started(): number {
    return this.callsStarted;
  }

  get inFlight(): number {
    return this.calls.size;
  }

  // P5 O16 M3b (D9, D34, D41): the calls the handover's drain waits for, every tool's but `ask` (which waits on a human
  // and is carried across by its re-raise): each from its dispatch until its answer's write settles (the host's
  // `applied`, or the write's failure), or, for a call the engine withdrew, which writes no answer, until its tool
  // settles. Not `inFlight`, which `call()` clears before it queues the answer.
  inFlightThroughDelivery(): number {
    return this.delivering.size;
  }

  // P5 O16 M3c fix wave 2 (D63): the tool of the first call `inFlightThroughDelivery` counts (what an update waits for,
  // in the engine host's status); null when none is
  deliveringTool(): string | null {
    for (const tool of this.delivering.values()) return tool;
    return null;
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
      void this.write(requestId, { jsonrpc: '2.0', result: {}, id: 0 }); // a notification: the official SDK's answer (E0a seq 11)
      const abandoned = cancelledCallOf(message);
      if (abandoned !== null) this.abandoned(abandoned);
      return;
    }
    const { id, params } = message;
    switch (message.method) {
      case 'initialize': {
        const protocolVersion = typeof params.protocolVersion === 'string' ? params.protocolVersion : FALLBACK_PROTOCOL_VERSION;
        // P4-B4 (route (b), its Decision Log 1): the always-on link paragraph, which the engine renders to the model
        void this.result(requestId, id, { protocolVersion, capabilities: { tools: { listChanged: true } }, serverInfo: mawsServerInfo(this.deps.version), instructions: MAWS_SERVER_INSTRUCTIONS });
        return;
      }
      case 'ping':
        void this.result(requestId, id, {});
        return;
      case 'tools/list':
        void this.result(requestId, id, { tools: [...this.tools.values()].map(({ name, title, description, inputSchema, annotations, _meta }) => ({ name, title, description, inputSchema, annotations, ...(_meta !== undefined && { _meta }) })) });
        return;
      case 'tools/call':
        // fix wave 2: the e2e's gate keeps a call out of flight until it opens (under MAWS_E2E alone)
        if (this.deps.gate && toolCallOf(params).name !== 'ask') {
          this.deps.log(`e2e: ${requestId} waits for the call gate`);
          void this.deps.gate().then(() => (this.deps.log(`e2e: ${requestId} passed the call gate`), this.call(requestId, id, params)));
        }
        else void this.call(requestId, id, params);
        return;
      default:
        this.error(requestId, id, JSONRPC_METHOD_NOT_FOUND, `Method not found: ${message.method}`);
    }
  }

  // P5 O16 M3: a `tools/call` an earlier engine host dispatched and never answered (its result unknown): answered with
  // ORPHANED_CALL_TEXT as a tool error, never run again.
  orphaned(req: ControlRequestFrame): void {
    const message = readMcpMessage(req.request);
    if (message.kind !== 'request') return this.accept(req); // not a call: answered as any request (D36)
    void this.result(req.request_id as RequestId, message.id, toolError(ORPHANED_CALL_TEXT));
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
    if (name !== 'ask') {
      this.delivering.set(requestId, String(name)); // P5 O16 M3b
      this.deps.onChange?.(); // M3c fix wave 2: an update waiting for quiet hears the call start
    }
    const tool = typeof name === 'string' ? this.tools.get(name) : undefined;
    if (!tool) {
      void this.result(requestId, id, toolError(TOOL_ERRORS.unknownTool(String(name)))).then(() => this.retire(requestId));
      return;
    }
    const controller = new AbortController();
    const call = { id, controller, answered: false };
    this.calls.set(requestId, call);
    this.callsStarted++;
    this.deps.onChange?.();
    let result: McpToolResult;
    try {
      if (name !== 'ask' && this.deps.hold) await this.deps.hold();
      result = await tool.call(args, { appSessionId: this.deps.appSessionId, cwd: this.deps.cwd(), toolUseId, requestId, signal: controller.signal, fromSubagent: this.deps.fromSubagent?.(toolUseId) ?? false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.log(`${tool.name} ${requestId} failed: ${message}`);
      result = toolError(`${tool.name}: ${message}`);
    } finally {
      this.calls.delete(requestId);
      this.deps.onChange?.();
    }
    if (controller.signal.aborted || call.answered) return this.retire(requestId);
    await this.result(requestId, id, result);
    this.retire(requestId);
  }

  // P5 O16 M3b: a call's delivery is over (its answer's write settled, or its withdrawn tool did)
  private retire(requestId: RequestId): void {
    if (this.delivering.delete(requestId)) this.deps.onChange?.();
  }

  private result(requestId: RequestId, id: RpcId, result: unknown): Promise<void> {
    return this.write(requestId, { jsonrpc: '2.0', id, result }); // the key order the engine echoes back (E0a seqs 6 and 9)
  }

  private error(requestId: RequestId, id: RpcId | null, code: number, message: string): void {
    void this.write(requestId, { jsonrpc: '2.0', id, error: { code, message } });
  }

  // Settles once the write did, either way: a refused write is logged, never thrown.
  private write(requestId: RequestId, rpc: Record<string, unknown>): Promise<void> {
    return this.deps.respond(requestId, { mcp_response: rpc }).catch((error: unknown) => this.deps.log(`mcp_message ${requestId} not answered: ${error instanceof Error ? error.message : String(error)}`));
  }
}
