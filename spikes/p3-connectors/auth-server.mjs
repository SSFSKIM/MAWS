// P3-H spike U2 (docs/doperpowers/plans/2026-10-12-p3-co-work.md §4.12 U2; parent pin blob 8474a047 at c73ba534).
// A local OAuth 2.1 authorization server shaped like the MCP authorization spec (2025-06-18 onward) expects:
// RFC 8414 metadata, RFC 7591 dynamic client registration, PKCE (S256), RFC 8707 resource indicators bound into the
// token's audience, and refresh-token rotation (OAuth 2.1 §4.3.1 for public clients: each refresh revokes the
// refresh token it consumed). The /authorize step auto-approves, standing in for the user's consent page.
//   node auth-server.mjs <port>
import { randomUUID } from 'node:crypto';
import express from 'express';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { InvalidGrantError, InvalidRequestError } from '@modelcontextprotocol/sdk/server/auth/errors.js';

class Clients {
  clients = new Map();
  async getClient(id) { return this.clients.get(id); }
  async registerClient(meta) { this.clients.set(meta.client_id, meta); console.error(`registered client ${meta.client_id} (${meta.client_name ?? 'unnamed'}) redirect ${meta.redirect_uris}`); return meta; }
}

class Provider {
  clientsStore = new Clients();
  codes = new Map();
  access = new Map();
  refresh = new Map();
  async authorize(client, params, res) {
    if (!client.redirect_uris.includes(params.redirectUri)) throw new InvalidRequestError('Unregistered redirect_uri');
    const code = randomUUID();
    this.codes.set(code, { client, params });
    const u = new URL(params.redirectUri);
    u.searchParams.set('code', code);
    if (params.state !== undefined) u.searchParams.set('state', params.state);
    res.redirect(u.toString());
  }
  async challengeForAuthorizationCode(_client, code) {
    const c = this.codes.get(code);
    if (!c) throw new InvalidGrantError('unknown code');
    return c.params.codeChallenge;
  }
  mint(clientId, scopes, resource) {
    const at = `at-${randomUUID()}`;
    const rt = `rt-${randomUUID()}`;
    this.access.set(at, { clientId, scopes, resource: resource?.href, expiresAt: Date.now() + 60_000 });
    this.refresh.set(rt, { clientId, scopes, resource: resource?.href });
    return { access_token: at, token_type: 'bearer', expires_in: 60, refresh_token: rt, scope: scopes.join(' ') };
  }
  async exchangeAuthorizationCode(client, code, _verifier, _redirectUri, resource) {
    const c = this.codes.get(code);
    if (!c || c.client.client_id !== client.client_id) throw new InvalidGrantError('code not issued to this client');
    this.codes.delete(code);
    return this.mint(client.client_id, c.params.scopes ?? ['metrics:read'], resource ?? c.params.resource);
  }
  async exchangeRefreshToken(client, refreshToken, scopes, resource) {
    const r = this.refresh.get(refreshToken);
    if (!r || r.clientId !== client.client_id) throw new InvalidGrantError('refresh token unknown, rotated away, or not issued to this client');
    this.refresh.delete(refreshToken); // rotation: the consumed refresh token is dead for every holder
    return this.mint(client.client_id, scopes ?? r.scopes, resource ?? (r.resource ? new URL(r.resource) : undefined));
  }
  async verifyAccessToken(token) {
    const a = this.access.get(token);
    if (!a || a.expiresAt < Date.now()) throw new Error('invalid or expired');
    return { token, clientId: a.clientId, scopes: a.scopes, expiresAt: Math.floor(a.expiresAt / 1000), resource: a.resource ? new URL(a.resource) : undefined };
  }
}

const port = Number(process.argv[2]);
const issuerUrl = new URL(`http://127.0.0.1:${port}`);
const provider = new Provider();
const app = express();
app.use(express.json());
app.use(express.urlencoded());
app.use(mcpAuthRouter({ provider, issuerUrl, scopesSupported: ['metrics:read'] }));
app.post('/introspect', async (req, res) => {
  try {
    const t = await provider.verifyAccessToken(req.body.token);
    res.json({ active: true, client_id: t.clientId, scope: t.scopes.join(' '), exp: t.expiresAt, aud: t.resource?.href });
  } catch {
    res.json({ active: false });
  }
});
app.listen(port, '127.0.0.1', () => console.error(`auth server on ${issuerUrl.href}`));
