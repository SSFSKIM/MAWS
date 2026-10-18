// P3-H H3b: one server's tool as a live session's mcp_status answer reports it (P3 Decision Log 24, 82 and 83). The
// answer is read here, in the host, and never leaves it: main learns only whether the tool is ready, its fingerprint and
// whether it is read-only (the answer's server configuration carries header values verbatim, Decision Log 82).
//
// Ready means: exactly one server of that name, connected, not an SDK server (mcp_call refuses those), listing the tool;
// and no name the call could be confused with. mcp_call names a tool by its qualified name, both parts normalised
// (./mcp-call.ts), and the 2.1.301 capture shows a normalised server collision reaching the first configured server
// whichever raw spelling is sent (e2e/fixtures/connectors/run-38892612152/collision), so a raw name never
// disambiguates: a server whose normalised name another reported server shares (connected or not), a tool whose
// normalised name another tool of the server shares, and a qualified name another server's tool forms too, are all
// refused as `collision`.
//
// The fingerprint is the identity the owner granted: the server's name, scope, transport, and command and args or URL,
// with the tool's name; never a header, `env`, helper or OAuth field.
import { createHash } from 'node:crypto';
import type { McpStatusResponse } from '@shared/wire/control';
import { normalizedMcpName, qualifiedMcpToolName } from '../mcp-call';

export type ConnectorToolState = { ready: true; fingerprint: string; readOnly: boolean } | { ready: false; why: 'absent' | 'notConnected' | 'sdk' | 'toolMissing' | 'collision' };

interface Tool {
  name: string;
  annotations?: unknown;
}
interface Server {
  name: string;
  status: string;
  scope?: unknown;
  config?: unknown;
  tools?: unknown;
}

const record = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const toolsOf = (server: Server): Tool[] => (Array.isArray(server.tools) ? server.tools.filter((tool): tool is Tool => typeof record(tool)?.name === 'string') : []);

export function connectorToolState(answer: McpStatusResponse, server: string, tool: string): ConnectorToolState {
  const servers = answer.mcpServers as Server[];
  const named = servers.filter((entry) => entry.name === server);
  if (named.length === 0) return { ready: false, why: 'absent' };
  const key = normalizedMcpName(server);
  if (named.length > 1 || servers.some((entry) => entry.name !== server && normalizedMcpName(entry.name) === key)) return { ready: false, why: 'collision' };
  const entry = named[0]!;
  if (entry.status !== 'connected') return { ready: false, why: 'notConnected' };
  const config = record(entry.config);
  if (config?.type === 'sdk') return { ready: false, why: 'sdk' };
  const tools = toolsOf(entry);
  const listed = tools.filter((candidate) => candidate.name === tool);
  if (listed.length === 0) return { ready: false, why: 'toolMissing' };
  const toolKey = normalizedMcpName(tool);
  if (listed.length > 1 || tools.some((candidate) => candidate.name !== tool && normalizedMcpName(candidate.name) === toolKey)) return { ready: false, why: 'collision' };
  const qualified = qualifiedMcpToolName(server, tool);
  for (const other of servers) {
    if (other.name === server) continue;
    if (toolsOf(other).some((candidate) => qualifiedMcpToolName(other.name, candidate.name) === qualified)) return { ready: false, why: 'collision' };
  }
  return { ready: true, fingerprint: fingerprint(entry, config, tool), readOnly: record(listed[0]!.annotations)?.readOnly === true };
}

// P3-HD start (route D's verified source, ./provenance.ts): the same fingerprint over the same named fields, so a route
// change alone never asks the owner again.
export function connectorFingerprint(server: { name: string; scope?: unknown; config?: unknown }, tool: string): string {
  return fingerprint(server as Server, record(server.config), tool);
}
// P3-HD end

// The fields are named, so a field the engine adds later (or a header, `env`, `headersHelper`, `oauth`) never enters.
function fingerprint(server: Server, config: Record<string, unknown> | null, tool: string): string {
  const field = (value: unknown) => (value === undefined ? null : value);
  const identity = ['maws.connector/1', server.name, field(server.scope), field(config?.type), field(config?.command), field(config?.args), field(config?.url), tool];
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}
