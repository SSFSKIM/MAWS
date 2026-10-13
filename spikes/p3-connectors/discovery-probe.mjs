// P3-H spike U2 (docs/doperpowers/plans/2026-10-12-p3-co-work.md §4.12 U2; parent pin blob 8474a047 at c73ba534).
// What real remote connectors would ask of MAWS as a new OAuth client: one unauthenticated initialize per server (no
// credentials sent, nothing registered), then the public RFC 9728 and RFC 8414 metadata the 401 points to.
//   node discovery-probe.mjs   -> results/discovery.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverOAuthProtectedResourceMetadata, discoverAuthorizationServerMetadata, extractResourceMetadataUrl } from '@modelcontextprotocol/sdk/client/auth.js';

const here = dirname(fileURLToPath(import.meta.url));
const targets = [
  'https://mcp.notion.com/mcp',
  'https://mcp.linear.app/mcp',
  'https://mcp.atlassian.com/v1/mcp',
  'https://mcp.sentry.dev/mcp',
  'https://mcp.asana.com/v2/mcp',
  'https://mcp.stripe.com/',
  'https://mcp.canva.com/mcp',
  'https://mcp.figma.com/mcp',
  'https://mcp.slack.com/mcp',
  'https://api.githubcopilot.com/mcp/',
  'https://mcp.deepwiki.com/mcp',
];
const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'maws-discovery-probe', version: '0.0.1' } } };

const rows = [];
for (const url of targets) {
  const row = { url };
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(init), signal: AbortSignal.timeout(15_000) });
    row.status = r.status;
    row.wwwAuthenticate = r.headers.get('www-authenticate');
    await r.body?.cancel();
    if (r.status === 401 || r.status === 403) {
      const prmUrl = extractResourceMetadataUrl(r);
      let prm;
      try {
        prm = await discoverOAuthProtectedResourceMetadata(url, prmUrl ? { resourceMetadataUrl: prmUrl } : undefined);
        row.protectedResource = { resource: prm.resource, authorization_servers: prm.authorization_servers, scopes_supported: prm.scopes_supported };
      } catch (e) {
        row.protectedResource = `none: ${e.message.slice(0, 160)}`;
      }
      const asUrl = prm?.authorization_servers?.[0] ?? new URL(url).origin;
      const as = await discoverAuthorizationServerMetadata(asUrl);
      row.authorizationServer = as && {
        issuer: as.issuer,
        registration_endpoint: as.registration_endpoint ?? null,
        client_id_metadata_document_supported: as.client_id_metadata_document_supported ?? null,
        code_challenge_methods_supported: as.code_challenge_methods_supported ?? null,
        token_endpoint_auth_methods_supported: as.token_endpoint_auth_methods_supported ?? null,
        grant_types_supported: as.grant_types_supported ?? null,
      };
    }
  } catch (e) {
    row.error = `${e.constructor?.name}: ${e.message.slice(0, 200)}`;
  }
  rows.push(row);
  console.log(JSON.stringify(row));
}
mkdirSync(join(here, 'results'), { recursive: true });
writeFileSync(join(here, 'results', 'discovery.json'), `${JSON.stringify({ at: new Date().toISOString(), rows }, null, 2)}\n`);
