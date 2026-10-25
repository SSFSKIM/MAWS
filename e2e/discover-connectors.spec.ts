// P4-AGG's Discover group, the connectors half (`pnpm e2e:discover`, MAWS_DISCOVER_E2E=1; the spec skips itself
// otherwise): docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md.
//   oauth fixture, engine mode: M1's proof that the toy OAuth fixture can serve the engine's own sign-in (acceptance 9).
//            Started in engine mode, it is in its OAuth phase with no engine-PID gate; a plain HTTP client registers the
//            engine's `http://localhost:<port>/callback`, is redirected there with a code and the state, exchanges it
//            and reads the MCP resource with the token. Around it, the Keychain custody of a scratch configuration
//            directory: its exact item (fact 2) absent before and claimed, then released after (no engine ran), the
//            Keychain left as it was found.
import { mkdtempSync, rmSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { engineKeychainCustody, readOAuthLog, startOAuthFixture, summarizeOAuthLog, type OAuthFixture } from './support/connector-oauth';

test.skip(process.env.MAWS_DISCOVER_E2E !== '1', 'the Discover e2e runs under pnpm e2e:discover (MAWS_DISCOVER_E2E=1)');

let root: string;
let fixture: OAuthFixture | null = null;
test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-discover-oauth-'));
});
test.afterEach(async () => {
  await fixture?.close();
  fixture = null;
  rmSync(root, { recursive: true, force: true });
});

test('oauth fixture, engine mode: a localhost-redirect token exchange from a plain client, the Keychain left as found', async () => {
  const custody = engineKeychainCustody(join(root, 'claude-config'));
  custody.claim();
  fixture = await startOAuthFixture({ root, id: 'engine', mode: 'engine' });
  const { origin, resourceUrl } = fixture;
  const post = (path: string, body: string, headers: Record<string, string>) => fetch(`${origin}${path}`, { method: 'POST', headers, body, redirect: 'manual' });
  const rpc = (method: string) => JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: {} });

  const unauthorized = await post('/mcp', rpc('tools/list'), { 'content-type': 'application/json' });
  expect(unauthorized.status).toBe(401); // the OAuth phase from the start: no engine-PID gate
  expect(unauthorized.headers.get('www-authenticate')).toContain(`${origin}/.well-known/oauth-protected-resource/mcp`);

  const callback = 'http://localhost:53682/callback'; // the engine's own listener's shape; nothing needs to listen
  const registered = await post('/register', JSON.stringify({ redirect_uris: [callback], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_name: 'Claude Code (engine)' }), { 'content-type': 'application/json' });
  expect(registered.status).toBe(201);
  const clientId = ((await registered.json()) as { client_id: string }).client_id;

  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('hex');
  const query = new URLSearchParams({ response_type: 'code', client_id: clientId, code_challenge: challenge, code_challenge_method: 'S256', redirect_uri: callback, state, resource: resourceUrl });
  const authorized = await fetch(`${origin}/authorize?${query}`, { redirect: 'manual' });
  expect(authorized.status).toBe(302);
  const location = new URL(authorized.headers.get('location')!);
  expect(`${location.origin}${location.pathname}`).toBe(callback);
  expect(location.searchParams.get('state')).toBe(state);

  const exchanged = await post('/token', new URLSearchParams({ grant_type: 'authorization_code', code: location.searchParams.get('code')!, code_verifier: verifier, redirect_uri: callback, resource: resourceUrl, client_id: clientId }).toString(), { 'content-type': 'application/x-www-form-urlencoded' });
  expect(exchanged.status).toBe(200);
  const token = ((await exchanged.json()) as { access_token: string }).access_token;
  const listed = await post('/mcp', rpc('tools/list'), { 'content-type': 'application/json', authorization: `Bearer ${token}` });
  expect(listed.status).toBe(200);

  const summary = summarizeOAuthLog(readOAuthLog(fixture)).oauth;
  expect({ registrations: summary.registrations, authorizations: summary.authorizations, codeExchanges: summary.codeExchanges, unauthorized: summary.unauthorized }).toEqual({ registrations: 1, authorizations: 1, codeExchanges: 1, unauthorized: 1 });

  await fixture.close();
  expect(custody.release({ enginePids: [] })).toEqual({ service: custody.service, found: false, deleted: false });
});
