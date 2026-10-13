// P3-H spike U2 (docs/doperpowers/plans/2026-10-12-p3-co-work.md §4.12 U2; parent pin blob 8474a047 at c73ba534).
// MAWS's own `maws` server (src/engine-host/tool-server/server.ts) has no transport of its own: the engine host feeds it
// `control_request/mcp_message` frames. This shim gives it stdio (newline-delimited JSON-RPC, MCP's stdio framing) so a
// stock MCP client can drive it standalone: each line in becomes an mcp_message frame, each `mcp_response` a line out.
// The real tools need the host's services, so the shim serves one toy tool through the same class.
// Built by `esbuild --bundle` into build/maws-shim.mjs (see run-all.mjs).
import { createInterface } from 'node:readline';
import { MawsToolServer, toolText, type McpToolDefinition } from '../../src/engine-host/tool-server/server';
import type { AppSessionId } from '@shared/graph/ids';
import type { ControlRequestFrame } from '@shared/wire/frames';

const echo = {
  name: 'shim_echo',
  description: 'Echoes its text (the shim stands in for the host-bound tools).',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  annotations: { readOnlyHint: true, openWorldHint: false },
  call: async (args: unknown) => toolText({ echoed: (args as { text: string }).text }),
} as unknown as McpToolDefinition;

const server = new MawsToolServer({
  tools: [echo],
  respond: async (_requestId, response) => {
    process.stdout.write(`${JSON.stringify((response as { mcp_response: unknown }).mcp_response)}\n`);
  },
  cwd: () => process.cwd(),
  appSessionId: 'shim' as AppSessionId,
  version: '0.0.0-shim',
  log: (m) => process.stderr.write(`${m}\n`),
});

let n = 0;
createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line) as { id?: unknown };
  // a notification needs no answer on a real MCP transport; the control protocol's ack would be a stray response
  if (message.id === undefined) return;
  n += 1;
  server.accept({ type: 'control_request', request_id: `shim-${n}`, request: { subtype: 'mcp_message', server_name: 'maws', message } } as unknown as ControlRequestFrame);
});
