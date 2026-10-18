// Route E's engine half (P3 Decision Log 24; P3-H): one MCP tool run through a live engine's `mcp_call` control, with
// no model turn and no engine permission check, answered as a result or a typed refusal. The engine checks nothing, so
// MAWS's grant is the only gate and is main's to enforce before calling here; nothing here marks a session used or
// starts one: a caller hands in the control client of a process that is already live. Wire facts: the live probe
// (spikes/p3-connectors/fixtures/engine-mcp-call.jsonl, 2.1.296) and the handler it ran (2.1.292 cli.pretty.js
// 598393-598497; the same strings in 2.1.300 at 76701-76790). The engine's errors carry no code, so a refusal is read
// from the message the way the engine's own clients read "Unsupported control request subtype" (2.1.300 163300).
import { randomBytes } from 'node:crypto';
import type { McpCallResponse } from '@shared/wire/control';
import { mcpCall, mcpStatus } from './controls';
import { ControlCancelled, ControlError, ControlTimeout, type ControlClient } from './rpc';

// The engine's name for a server inside a qualified tool name (2.1.292 cli.pretty.js 610421-610425): every character
// outside [a-zA-Z0-9_-] becomes `_`, and a claude.ai connector's runs of `_` collapse and its ends are trimmed.
// P3-H H3b: exported, route E's collision check compares names by it.
export function normalizedMcpName(name: string): string {
  const replaced = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  return name.startsWith('claude.ai ') ? replaced.replace(/_+/g, '_').replace(/^_|_$/g, '') : replaced;
}

// The qualified name the engine gives a server's tool, both parts normalised (2.1.292 cli.pretty.js 16875); `server`
// and `tool` are the names mcp_status reports (a plugin server's `plugin:<plugin>:<server>`, a connector's
// `claude.ai <name>`). Two configured names that normalise alike share one qualified name, so a call cannot say which it
// means.
export const qualifiedMcpToolName = (server: string, tool: string): string => `mcp__${normalizedMcpName(server)}__${normalizedMcpName(tool)}`;

export const MCP_CALL_REFUSALS = [
  'unsupported', // the engine does not handle mcp_call
  'not_connected', // the server is not connected (none of that name, or it did not come up within the engine's 30 s)
  'needs_auth', // the server wants the engine's own OAuth flow (mcp_authenticate), then a retry
  'session_expired', // the server's MCP session expired (mcp_reconnect), then a retry
  'cancelled', // by the caller, or the engine reports the call cancelled
  'timeout', // unanswered within the caller's bound; the engine was asked to cancel, and the tool may have run
  'exited', // the process is gone or its pipe broke
  'failed', // anything else: the tool's own error, an unexpected answer
] as const;
export type McpCallRefusal = (typeof MCP_CALL_REFUSALS)[number];
export type McpCallOutcome = { ok: true; result: McpCallResponse } | { ok: false; refusal: McpCallRefusal; message: string };

export interface McpToolCall {
  server: string; // as mcp_status names it
  tool: string; // as mcp_status lists it
  arguments?: Record<string, unknown>;
}

function refusalOf(error: ControlError): McpCallRefusal {
  if (error instanceof ControlCancelled) return 'cancelled';
  if (error instanceof ControlTimeout) return 'timeout';
  if (error.code === 'exited' || error.code === 'write_failed') return 'exited';
  const message = error.message;
  if (message.startsWith('Unsupported control request subtype')) return 'unsupported';
  if (message.startsWith('MCP server not connected: ')) return 'not_connected';
  if (message.includes('send mcp_authenticate and retry')) return 'needs_auth';
  if (message.includes('send mcp_reconnect and retry')) return 'session_expired';
  if (message.startsWith('mcp_call cancelled by client')) return 'cancelled';
  return 'failed';
}

// `timeoutMs` defaults to the long class's; `signal` cancels through control_cancel_request.
export async function callMcpTool(client: ControlClient, call: McpToolCall, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<McpCallOutcome> {
  try {
    const result = await mcpCall(client, { tool: qualifiedMcpToolName(call.server, call.tool), arguments: call.arguments ?? {} }, opts);
    return { ok: true, result };
  } catch (error) {
    if (!(error instanceof ControlError)) throw error;
    return { ok: false, refusal: refusalOf(error), message: error.message };
  }
}

// The compatibility check: a call to a server the session does not have, which an engine that handles mcp_call refuses
// at once as not connected (engine-mcp-call.jsonl seqs 22-23) and one that does not refuses as an unsupported subtype
// (pass3/mods-gate-served-off seq 30's form). The server's name is fresh per probe and unguessable, and is checked
// against every server the session's mcp_status reports, by the normalised name the call resolves through, so the probe
// never reaches a configured tool. `unknown` when no answer settles it, or when the servers cannot be read.
export type McpCallSupport = 'supported' | 'unsupported' | 'unknown';
const PROBE_ATTEMPTS = 4;
const probeServer = (nonce: string) => `maws_probe_${nonce}`;

// `nonce` is for tests; by default 128 random bits.
export async function probeMcpCall(client: ControlClient, opts: { signal?: AbortSignal; timeoutMs?: number; nonce?: () => string } = {}): Promise<McpCallSupport> {
  let present: Set<string>;
  try {
    const status = await mcpStatus(client, {}, { signal: opts.signal });
    present = new Set(status.mcpServers.map((server) => normalizedMcpName(server.name)));
  } catch (error) {
    if (error instanceof ControlError) return 'unknown';
    throw error;
  }
  const nonce = opts.nonce ?? (() => randomBytes(16).toString('hex'));
  let server: string | null = null;
  for (let attempt = 0; attempt < PROBE_ATTEMPTS && server === null; attempt += 1) {
    const candidate = probeServer(nonce());
    if (!present.has(normalizedMcpName(candidate))) server = candidate;
  }
  if (server === null) return 'unknown';
  const outcome = await callMcpTool(client, { server, tool: 'probe' }, opts);
  if (outcome.ok) return 'supported';
  if (outcome.refusal === 'unsupported') return 'unsupported';
  return outcome.refusal === 'timeout' || outcome.refusal === 'exited' || outcome.refusal === 'cancelled' ? 'unknown' : 'supported';
}
