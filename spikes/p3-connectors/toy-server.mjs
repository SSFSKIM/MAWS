// P3-H spike U2 (docs/doperpowers/plans/2026-10-12-p3-co-work.md §4.12 U2, §5 P3-H; parent pin blob 8474a047 at c73ba534).
// A toy "connector": an MCP server with a data-shaped tool, the kind a dashboard block would bind to.
//   node toy-server.mjs stdio                 -> stdio transport (what a user's `command`/`args` server is)
//   node toy-server.mjs http <port>           -> Streamable HTTP at http://127.0.0.1:<port>/mcp, no auth
//   node toy-server.mjs http <port> --auth <authPort>
//                                             -> the same, guarded by a bearer token issued by auth-server.mjs on
//                                                <authPort> (RFC 9728 protected-resource metadata, audience-checked)
import { randomUUID } from 'node:crypto';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { mcpAuthMetadataRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { z } from 'zod';

let calls = 0;

export function buildServer() {
  const server = new McpServer({ name: 'toy-metrics', version: '0.0.1' });
  server.registerTool(
    'metrics_snapshot',
    {
      title: 'Metrics snapshot',
      description: 'Returns the current values of a named metric series (toy data, deterministic per minute).',
      inputSchema: { series: z.string(), points: z.number().int().min(1).max(50).default(5) },
      outputSchema: { series: z.string(), at: z.string(), rows: z.array(z.object({ t: z.number(), v: z.number() })) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ series, points }) => {
      calls += 1;
      const now = Date.now();
      const rows = Array.from({ length: points }, (_, i) => ({ t: now - (points - 1 - i) * 60_000, v: Math.round(100 + 10 * Math.sin(i + series.length)) }));
      const structuredContent = { series, at: new Date(now).toISOString(), rows };
      return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent };
    },
  );
  server.registerTool(
    'send_document',
    {
      title: 'Send document',
      description: 'Pretends to deliver a document somewhere (a write: what "Send to" would call).',
      inputSchema: { title: z.string(), body: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ title, body }) => ({ content: [{ type: 'text', text: `delivered "${title}" (${body.length} chars) as doc-${randomUUID().slice(0, 8)}` }] }),
  );
  server.registerTool('call_count', { description: 'How many metrics_snapshot calls this process served.', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: String(calls) }] }));
  return server;
}

async function main() {
  const [mode, portArg, flag, authPortArg] = process.argv.slice(2);
  if (mode === 'stdio') {
    await buildServer().connect(new StdioServerTransport());
    return;
  }
  if (mode !== 'http') throw new Error(`usage: toy-server.mjs stdio | http <port> [--auth <authPort>]`);
  const port = Number(portArg);
  const mcpUrl = new URL(`http://127.0.0.1:${port}/mcp`);
  const app = express();
  app.use(express.json());
  let guard = (_req, _res, next) => next();
  if (flag === '--auth') {
    const authBase = `http://127.0.0.1:${Number(authPortArg)}`;
    const oauthMetadata = await (await fetch(`${authBase}/.well-known/oauth-authorization-server`)).json();
    // RFC 9728: this resource names its authorization server; clients discover it from the 401's WWW-Authenticate.
    app.use(mcpAuthMetadataRouter({ oauthMetadata, resourceServerUrl: mcpUrl, scopesSupported: ['metrics:read'], resourceName: 'toy-metrics' }));
    const verifier = {
      async verifyAccessToken(token) {
        const r = await fetch(`${authBase}/introspect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
        const info = await r.json();
        if (!info.active) throw new InvalidTokenError('inactive token');
        // audience binding (MCP authorization, RFC 8707): a token minted for another resource is refused
        if (info.aud !== mcpUrl.href) throw new InvalidTokenError(`token audience ${info.aud} is not ${mcpUrl.href}`);
        return { token, clientId: info.client_id, scopes: info.scope ? info.scope.split(' ') : [], expiresAt: info.exp };
      },
    };
    guard = requireBearerAuth({ verifier, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl) });
  }
  // Stateless Streamable HTTP: one server and transport per request (the SDK's stateless pattern).
  app.post('/mcp', guard, async (req, res) => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.listen(port, '127.0.0.1', () => console.error(`toy-metrics http on ${mcpUrl.href}${flag === '--auth' ? ' (bearer required)' : ''}`));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
