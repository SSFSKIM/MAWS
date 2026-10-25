// P3-HD M4a: the toy OAuth fixture's request logic (e2e/support/connector-oauth-core.mjs), driven through injected
// requests, clock and randomness only: no server, socket or process. One origin is both the MCP resource and its
// authorization server. The open phase (the default) advertises nothing; the OAuth phase, which a scene enters only after
// it has confirmed no engine is alive (P3-HD Decision Log 23), serves discovery, public-client registration, S256 PKCE
// with exact state/callback/resource/issuer, expiring tokens, refresh rotation and revocation.
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createOAuthFixtureCore, OPEN_CONTROL, parseOAuthControl, tokenHash,
  type FixtureRequest, type OAuthControl, type OAuthFixtureCore, type OAuthLogEntry, type OAuthSecret,
} from '../../e2e/support/connector-oauth-core.mjs';

const ORIGIN = 'http://127.0.0.1:41000';
const RESOURCE = `${ORIGIN}/mcp`;
const REDIRECT = 'http://127.0.0.1:52000/callback';
const VERIFIER = 'v'.repeat(20) + '-._~' + 'A1b2C3d4e5F6g7H8i9J0k'; // 45 unreserved characters
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const OAUTH: OAuthControl = { seq: 1, phase: 'oauth', accessTtlSeconds: 60, revocation: 'available' };

let clock: number;
let minted: number;
let core: OAuthFixtureCore;
let entries: OAuthLogEntry[];
let secrets: OAuthSecret[];

beforeEach(() => {
  clock = 1_000_000;
  minted = 0;
  entries = [];
  secrets = [];
  core = createOAuthFixtureCore({ id: 'series', origin: ORIGIN, now: () => clock, randomToken: () => `tok${String(++minted).padStart(4, '0')}${'x'.repeat(28)}` });
});

function send(request: Partial<FixtureRequest> & { url: string }, control: OAuthControl = OAUTH) {
  const out = core.handle({ method: 'GET', headers: {}, body: '', ...request }, control);
  entries.push(out.entry);
  secrets.push(...out.secrets);
  return out;
}
const json = (out: { response: { body: string } }) => JSON.parse(out.response.body) as Record<string, unknown>;
const rpc = (method: string, params: unknown = {}, id: number | null = 1) => JSON.stringify({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, params }); // null: a notification
const mcp = (body: string, token?: string, control: OAuthControl = OAUTH) =>
  send({ method: 'POST', url: '/mcp', headers: { 'content-type': 'application/json', ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) }, body }, control);
const form = (url: string, fields: Record<string, string>, control: OAuthControl = OAUTH) =>
  send({ method: 'POST', url, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() }, control);

function register(metadata: Record<string, unknown> = {}) {
  return send({ method: 'POST', url: '/register', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_name: 'MAWS', ...metadata }) });
}
function authorizeUrl(clientId: string, overrides: Record<string, string | null> = {}) {
  const params = new URLSearchParams();
  const fields: Record<string, string | null> = { response_type: 'code', client_id: clientId, code_challenge: CHALLENGE, code_challenge_method: 'S256', redirect_uri: REDIRECT, state: 'state-abc', scope: 'series:read', resource: RESOURCE, ...overrides };
  for (const [key, value] of Object.entries(fields)) if (value !== null) params.set(key, value);
  return `/authorize?${params.toString()}`;
}
function connect() {
  const clientId = json(register()).client_id as string;
  const location = new URL(send({ url: authorizeUrl(clientId) }).response.headers.location!);
  const code = location.searchParams.get('code')!;
  const out = form('/token', { grant_type: 'authorization_code', code, code_verifier: VERIFIER, redirect_uri: REDIRECT, resource: RESOURCE, client_id: clientId });
  const tokens = json(out) as { access_token: string; refresh_token: string; token_type: string; expires_in: number; scope: string };
  return { clientId, code, tokens };
}
const refresh = (clientId: string, refreshToken: string) => form('/token', { grant_type: 'refresh_token', refresh_token: refreshToken, resource: RESOURCE, client_id: clientId });

describe('the control file', () => {
  it('defaults to the open phase when absent, malformed or out of range', () => {
    expect(OPEN_CONTROL).toEqual({ seq: 0, phase: 'open', accessTtlSeconds: 3600, revocation: 'available' });
    expect(parseOAuthControl(null)).toEqual(OPEN_CONTROL);
    expect(parseOAuthControl('{"phase":"oauth"')).toEqual(OPEN_CONTROL);
    expect(parseOAuthControl(JSON.stringify({ ...OAUTH, phase: 'OAUTH' }))).toEqual(OPEN_CONTROL);
    expect(parseOAuthControl(JSON.stringify({ ...OAUTH, accessTtlSeconds: 0 }))).toEqual(OPEN_CONTROL);
    expect(parseOAuthControl(JSON.stringify({ ...OAUTH, seq: -1 }))).toEqual(OPEN_CONTROL);
    expect(parseOAuthControl(JSON.stringify({ ...OAUTH, revocation: 'maybe' }))).toEqual(OPEN_CONTROL);
  });
  // P3-HD panel correction: the trust-binding scene's advertisements, valid only as 127.0.0.1 URLs of bounded length
  it('reads an optional advertisement override, refusing a malformed one whole', () => {
    const advertise = { resource: `${RESOURCE}?tenant=beta`, authorizationServer: `${ORIGIN}//127.0.0.1:41001`, issuer: `${ORIGIN}//127.0.0.1:41001` };
    expect(parseOAuthControl(JSON.stringify({ ...OAUTH, advertise }))).toEqual({ ...OAUTH, advertise });
    expect(parseOAuthControl(JSON.stringify({ ...OAUTH, advertise: {} }))).toEqual({ ...OAUTH, advertise: {} });
    for (const bad of [{ resource: 7 }, { issuer: 'https://elsewhere.example/' }, { other: 'x' }, ['x'], 'x', { resource: `${ORIGIN}/${'x'.repeat(2_100)}` }]) {
      expect(parseOAuthControl(JSON.stringify({ ...OAUTH, advertise: bad })), JSON.stringify(bad).slice(0, 40)).toEqual(OPEN_CONTROL);
    }
  });

  it('reads a complete control', () => {
    expect(parseOAuthControl(JSON.stringify(OAUTH))).toEqual(OAUTH);
    expect(parseOAuthControl(JSON.stringify({ seq: 4, phase: 'oauth', accessTtlSeconds: 2, revocation: 'unavailable' }))).toEqual({ seq: 4, phase: 'oauth', accessTtlSeconds: 2, revocation: 'unavailable' });
  });
});

describe('the open phase', () => {
  it('serves MCP without authorization and advertises no authorization anywhere', () => {
    const init = mcp(rpc('initialize', { protocolVersion: '2025-06-18' }), undefined, OPEN_CONTROL);
    expect(init.response.status).toBe(200);
    expect(json(init).result).toMatchObject({ serverInfo: { name: 'maws-oauth-fixture' }, capabilities: { tools: {} } });
    const list = mcp(rpc('tools/list'), undefined, OPEN_CONTROL);
    expect((json(list).result as { tools: unknown[] }).tools).toEqual([expect.objectContaining({ name: 'read_series', annotations: { readOnlyHint: true } })]);
    const paths = ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server', '/.well-known/openid-configuration', '/authorize', '/register', '/token', '/revoke'];
    for (const url of paths) {
      const out = send({ method: url === '/authorize' || url.startsWith('/.well') ? 'GET' : 'POST', url }, OPEN_CONTROL);
      expect(out.response.status, url).toBe(404);
      expect(out.response.headers['www-authenticate'], url).toBeUndefined();
      expect(out.entry.advertised, url).toBe(false);
    }
    expect(entries.every((entry) => entry.phase === 'open' && entry.seq === 0 && !entry.advertised && entry.status !== 401)).toBe(true);
    expect(entries.map((entry) => entry.route)).toEqual(['mcp', 'mcp', 'resourceMetadata', 'resourceMetadata', 'serverMetadata', 'serverMetadata', 'authorize', 'register', 'token', 'revoke']);
  });

  it('logs a presented Authorization header without requiring one', () => {
    const out = mcp(rpc('tools/list'), 'never-issued', OPEN_CONTROL);
    expect(out.response.status).toBe(200);
    expect(out.entry.bearer).toBe('unknown');
  });
});

describe('the OAuth phase: discovery', () => {
  it('answers MCP without a token 401, naming its protected-resource metadata', () => {
    const out = mcp(rpc('initialize'));
    expect(out.response.status).toBe(401);
    expect(out.response.headers['www-authenticate']).toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp", scope="series:read"`);
    expect(out.entry).toMatchObject({ route: 'mcp', bearer: 'none', status: 401, advertised: true, phase: 'oauth', seq: 1 });
  });

  it('logs a refused tools/call as the attempt it was, without answering it', () => {
    const out = mcp(rpc('tools/call', { name: 'read_series', arguments: { series: 'signups' } }), 'never-issued');
    expect(out.response.status).toBe(401);
    expect(out.entry).toMatchObject({ method: 'tools/call', tool: 'read_series', bearer: 'unknown' });
    const { tokens } = connect();
    const served = json(mcp(rpc('tools/call', { name: 'read_series', arguments: {} }), tokens.access_token)).result as { structuredContent: { n: number } };
    expect(served.structuredContent.n).toBe(1); // the refused call reached no tool
  });

  it('publishes exact resource and issuer metadata at the paths SDK 1.32.1 tries first', () => {
    for (const url of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
      const out = send({ url });
      expect(out.response.status).toBe(200);
      expect(json(out)).toEqual({ resource: RESOURCE, authorization_servers: [ORIGIN], scopes_supported: ['series:read'], bearer_methods_supported: ['header'] });
    }
    const server = send({ url: '/.well-known/oauth-authorization-server' });
    expect(json(server)).toEqual({
      issuer: ORIGIN, authorization_endpoint: `${ORIGIN}/authorize`, token_endpoint: `${ORIGIN}/token`, registration_endpoint: `${ORIGIN}/register`, revocation_endpoint: `${ORIGIN}/revoke`,
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'], scopes_supported: ['series:read'], authorization_response_iss_parameter_supported: true,
    });
    expect(send({ url: '/.well-known/openid-configuration' }).response.status).toBe(404); // RFC 8414 only
    expect(entries.filter((entry) => entry.status === 200).every((entry) => entry.advertised)).toBe(true);
  });
});

// P3-HD panel correction: what the trust-binding scene makes a fixture advertise (another tenant's resource; an
// authorization server whose discovery would leave its origin; a foreign document naming that issuer)
describe('the OAuth phase: advertisement overrides', () => {
  it('advertises the control’s resource and authorization server instead of its own', () => {
    const advertise = { resource: `${RESOURCE}?tenant=beta`, authorizationServer: `${ORIGIN}//127.0.0.1:41001` };
    for (const url of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
      expect(json(send({ url }, { ...OAUTH, advertise }))).toEqual({ resource: advertise.resource, authorization_servers: [advertise.authorizationServer], scopes_supported: ['series:read'], bearer_methods_supported: ['header'] });
    }
    // its own discovery paths under that server's `//` path are unknown routes: 404
    for (const url of ['/.well-known/oauth-authorization-server//127.0.0.1:41001', '/.well-known/openid-configuration//127.0.0.1:41001']) {
      expect(send({ url }, { ...OAUTH, advertise }).response.status, url).toBe(404);
    }
  });

  it('serves OpenID metadata naming the control’s issuer only when it names one', () => {
    const issuer = 'http://127.0.0.1:41002//127.0.0.1:41000';
    const oidc = send({ url: '/.well-known/openid-configuration' }, { ...OAUTH, advertise: { issuer } });
    expect(oidc.response.status).toBe(200);
    expect(json(oidc)).toMatchObject({ issuer, authorization_endpoint: `${ORIGIN}/authorize`, registration_endpoint: `${ORIGIN}/register`, jwks_uri: `${ORIGIN}/jwks`, subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'] });
    expect(oidc.entry).toMatchObject({ route: 'serverMetadata', advertised: true });
    expect(json(send({ url: '/.well-known/oauth-authorization-server' }, { ...OAUTH, advertise: { issuer } })).issuer).toBe(issuer);
    expect(send({ url: '/.well-known/openid-configuration' }, { ...OPEN_CONTROL, advertise: { issuer } }).response.status).toBe(404); // never in the open phase
    expect(send({ url: '/.well-known/openid-configuration' }).response.status).toBe(404);
  });
});

describe('the OAuth phase: registration', () => {
  it('registers a public client for an exact 127.0.0.1 redirect', () => {
    const out = register();
    expect(out.response.status).toBe(201);
    const client = json(out);
    expect(client).toMatchObject({ redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
    expect(typeof client.client_id).toBe('string');
    expect(client.client_secret).toBeUndefined();
    expect(out.entry).toMatchObject({ route: 'register', client: 1, status: 201 });
  });

  it.each([
    ['a confidential client', { token_endpoint_auth_method: 'client_secret_basic' }, 'invalid_client_metadata'],
    ['an unstated auth method', { token_endpoint_auth_method: undefined }, 'invalid_client_metadata'],
    ['localhost', { redirect_uris: ['http://localhost:52000/callback'] }, 'invalid_redirect_uri'],
    ['https', { redirect_uris: ['https://127.0.0.1:52000/callback'] }, 'invalid_redirect_uri'],
    ['no port', { redirect_uris: ['http://127.0.0.1/callback'] }, 'invalid_redirect_uri'],
    ['a query', { redirect_uris: [`${REDIRECT}?x=1`] }, 'invalid_redirect_uri'],
    ['another loopback spelling', { redirect_uris: ['http://127.1:52000/callback'] }, 'invalid_redirect_uri'],
    ['no redirect', { redirect_uris: [] }, 'invalid_redirect_uri'],
    ['implicit grant', { grant_types: ['implicit'] }, 'invalid_client_metadata'],
  ])('refuses %s', (_name, metadata, error) => {
    const out = register(metadata);
    expect(out.response.status).toBe(400);
    expect(json(out).error).toBe(error);
  });
});

describe('the OAuth phase: authorization', () => {
  it('redirects to the exact registered callback with a code, the state and the issuer', () => {
    const clientId = json(register()).client_id as string;
    const out = send({ url: authorizeUrl(clientId) });
    expect(out.response.status).toBe(302);
    const location = new URL(out.response.headers.location!);
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT);
    expect([...location.searchParams.keys()].sort()).toEqual(['code', 'iss', 'state']);
    expect(location.searchParams.get('state')).toBe('state-abc');
    expect(location.searchParams.get('iss')).toBe(ORIGIN);
    expect(out.entry).toMatchObject({ route: 'authorize', client: 1, status: 302 });
    expect(secrets.map((s) => s.kind)).toEqual(['state', 'codeChallenge', 'code']);
    expect(secrets.find((s) => s.kind === 'codeChallenge')!.value).toBe(CHALLENGE);
  });

  it.each([
    ['an unknown client', { client_id: 'nobody' }, 'unknown_client'],
    ['an unregistered callback port', { redirect_uri: 'http://127.0.0.1:52001/callback' }, 'redirect_mismatch'],
    ['an unregistered callback path', { redirect_uri: 'http://127.0.0.1:52000/other' }, 'redirect_mismatch'],
    ['a missing callback', { redirect_uri: null }, 'redirect_mismatch'],
  ])('answers %s 400 without redirecting', (_name, overrides, reason) => {
    const clientId = json(register()).client_id as string;
    const out = send({ url: authorizeUrl(clientId, overrides) });
    expect(out.response.status).toBe(400);
    expect(out.response.headers.location).toBeUndefined();
    expect(out.entry.error).toBe(reason);
    expect(secrets).toContainEqual({ kind: 'codeChallenge', value: CHALLENGE }); // recorded before any refusal
  });

  it.each([
    ['plain PKCE', { code_challenge_method: 'plain' }, 'invalid_request', 'pkce'],
    ['no PKCE', { code_challenge: null, code_challenge_method: null }, 'invalid_request', 'pkce'],
    ['a malformed challenge', { code_challenge: 'short' }, 'invalid_request', 'pkce'],
    ['no state', { state: null }, 'invalid_request', 'state_missing'],
    ['no resource', { resource: null }, 'invalid_target', 'resource_mismatch'],
    ['another resource', { resource: `${ORIGIN}/mcp/` }, 'invalid_target', 'resource_mismatch'],
    ['another scope', { scope: 'series:write' }, 'invalid_scope', 'scope'],
    ['another response type', { response_type: 'token' }, 'unsupported_response_type', 'response_type'],
  ])('redirects %s with an error and issues no code', (_name, overrides, error, reason) => {
    const clientId = json(register()).client_id as string;
    const out = send({ url: authorizeUrl(clientId, overrides) });
    expect(out.response.status).toBe(302);
    const location = new URL(out.response.headers.location!);
    expect(location.searchParams.get('error')).toBe(error);
    expect(location.searchParams.get('code')).toBeNull();
    expect(location.searchParams.get('iss')).toBe(ORIGIN);
    expect(out.entry.error).toBe(reason);
    expect(secrets.some((s) => s.kind === 'code')).toBe(false);
  });

  it('refuses a parameter given twice', () => {
    const clientId = json(register()).client_id as string;
    const out = send({ url: `${authorizeUrl(clientId)}&state=other` });
    expect(new URL(out.response.headers.location!).searchParams.get('error')).toBe('invalid_request');
  });
});

describe('the OAuth phase: code exchange', () => {
  it('issues an expiring Bearer token pair for the exact verifier, callback and resource', () => {
    const { tokens } = connect();
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 60, scope: 'series:read' });
    const last = entries.at(-1)!;
    expect(last).toMatchObject({ route: 'token', grant: 'authorization_code', status: 200, client: 1, issued: { family: 1, generation: 1, access: tokenHash(tokens.access_token), refresh: tokenHash(tokens.refresh_token) } });
    expect(secrets.map((s) => s.kind)).toEqual(['state', 'codeChallenge', 'code', 'codeVerifier', 'accessToken', 'refreshToken']);
  });

  it('takes its lifetime from the control at issuance', () => {
    const clientId = json(register()).client_id as string;
    const code = new URL(send({ url: authorizeUrl(clientId) }).response.headers.location!).searchParams.get('code')!;
    const out = form('/token', { grant_type: 'authorization_code', code, code_verifier: VERIFIER, redirect_uri: REDIRECT, resource: RESOURCE, client_id: clientId }, { ...OAUTH, accessTtlSeconds: 2 });
    expect(json(out).expires_in).toBe(2);
  });

  it.each([
    ['a wrong verifier', { code_verifier: 'w'.repeat(43) }, 'invalid_grant', 'verifier_mismatch'],
    ['a malformed verifier', { code_verifier: 'short' }, 'invalid_grant', 'verifier_mismatch'],
    ['another callback', { redirect_uri: 'http://127.0.0.1:52001/callback' }, 'invalid_grant', 'redirect_mismatch'],
    ['another resource', { resource: `${ORIGIN}/other` }, 'invalid_target', 'resource_mismatch'],
    ['no resource', { resource: undefined }, 'invalid_target', 'resource_mismatch'],
    ['another client', { client_id: 'nobody' }, 'invalid_client', 'unknown_client'],
    ['a client secret', { client_secret: 's' }, 'invalid_client', 'confidential_client'],
    ['an unknown code', { code: 'nope' }, 'invalid_grant', 'code_unknown'],
  ])('refuses %s', (_name, overrides, error, reason) => {
    const clientId = json(register()).client_id as string;
    const code = new URL(send({ url: authorizeUrl(clientId) }).response.headers.location!).searchParams.get('code')!;
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, redirect_uri: REDIRECT, resource: RESOURCE, client_id: clientId, ...overrides })) if (value !== undefined) fields[key] = value;
    const out = form('/token', fields);
    expect(out.response.status).toBe(error === 'invalid_client' ? 401 : 400);
    expect(json(out).error).toBe(error);
    expect(out.entry.error).toBe(reason);
    expect(out.entry.issued).toBeUndefined();
  });

  it('expires an unused code after a minute', () => {
    const clientId = json(register()).client_id as string;
    const code = new URL(send({ url: authorizeUrl(clientId) }).response.headers.location!).searchParams.get('code')!;
    clock += 60_001;
    const out = form('/token', { grant_type: 'authorization_code', code, code_verifier: VERIFIER, redirect_uri: REDIRECT, resource: RESOURCE, client_id: clientId });
    expect(out.entry.error).toBe('code_expired');
  });

  it('consumes a code once: a replay is refused and revokes what it issued', () => {
    const { clientId, code, tokens } = connect();
    const replay = form('/token', { grant_type: 'authorization_code', code, code_verifier: VERIFIER, redirect_uri: REDIRECT, resource: RESOURCE, client_id: clientId });
    expect(json(replay).error).toBe('invalid_grant');
    expect(replay.entry.error).toBe('code_replayed');
    expect(mcp(rpc('tools/list'), tokens.access_token).entry.bearer).toBe('revoked');
    expect(json(refresh(clientId, tokens.refresh_token)).error).toBe('invalid_grant');
  });

  it('consumes a code even when its exchange fails', () => {
    const clientId = json(register()).client_id as string;
    const code = new URL(send({ url: authorizeUrl(clientId) }).response.headers.location!).searchParams.get('code')!;
    form('/token', { grant_type: 'authorization_code', code, code_verifier: 'w'.repeat(43), redirect_uri: REDIRECT, resource: RESOURCE, client_id: clientId });
    const second = form('/token', { grant_type: 'authorization_code', code, code_verifier: VERIFIER, redirect_uri: REDIRECT, resource: RESOURCE, client_id: clientId });
    expect(second.entry.error).toBe('code_replayed');
  });

  it('refuses a token request that is not a form POST, or names an unknown grant', () => {
    expect(send({ url: '/token' }).response.status).toBe(405);
    expect(json(send({ method: 'POST', url: '/token', headers: { 'content-type': 'application/json' }, body: '{}' })).error).toBe('invalid_request');
    expect(json(form('/token', { grant_type: 'password' })).error).toBe('unsupported_grant_type');
  });
});

describe('the OAuth phase: the resource', () => {
  it('serves initialize, tools/list and read_series with the H fixture page shape to a valid token', () => {
    const { tokens } = connect();
    expect(mcp(rpc('initialize', { protocolVersion: '2025-06-18' }), tokens.access_token).response.status).toBe(200);
    expect(mcp(rpc('notifications/initialized', {}, null), tokens.access_token).response.status).toBe(202);
    const list = json(mcp(rpc('tools/list'), tokens.access_token)).result as { tools: { name: string }[] };
    expect(list.tools.map((tool) => tool.name)).toEqual(['read_series']);
    const call = mcp(rpc('tools/call', { name: 'read_series', arguments: { series: 'signups' } }), tokens.access_token);
    const result = json(call).result as { structuredContent: unknown; content: { type: string; text: string }[] };
    expect(result.structuredContent).toEqual({ server: 'series', tool: 'read_series', arguments: { series: 'signups' }, n: 1 });
    expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent);
    expect(call.entry).toMatchObject({ route: 'mcp', method: 'tools/call', tool: 'read_series', arguments: { series: 'signups' }, bearer: 'valid', token: { family: 1, generation: 1, hash: tokenHash(tokens.access_token) }, status: 200 });
    const second = json(mcp(rpc('tools/call', { name: 'read_series', arguments: {} }), tokens.access_token)).result as { structuredContent: { n: number } };
    expect(second.structuredContent.n).toBe(2);
  });

  it('refuses an unknown tool as JSON-RPC, and anything but one POSTed message', () => {
    const { tokens } = connect();
    expect(json(mcp(rpc('tools/call', { name: 'write_series' }), tokens.access_token)).error).toMatchObject({ code: -32602 });
    expect(send({ method: 'GET', url: '/mcp', headers: { authorization: `Bearer ${tokens.access_token}` } }).response.status).toBe(405);
    expect(mcp('[]', tokens.access_token).response.status).toBe(400);
    expect(mcp('{', tokens.access_token).response.status).toBe(400);
  });

  it('expires an access token at its lifetime', () => {
    const { tokens } = connect();
    clock += 59_999;
    expect(mcp(rpc('tools/list'), tokens.access_token).response.status).toBe(200);
    clock += 1;
    const out = mcp(rpc('tools/list'), tokens.access_token);
    expect(out.response.status).toBe(401);
    expect(out.response.headers['www-authenticate']).toContain('error="invalid_token"');
    expect(out.entry).toMatchObject({ bearer: 'expired', token: { family: 1, generation: 1 } });
  });

  it('refuses an unknown or malformed bearer, logging the hash of any presented one', () => {
    // a second fixture's hash of a token it never issued names the first fixture's token, so a scene can prove that
    // another server never received it
    expect(mcp(rpc('tools/list'), 'never-issued').entry).toMatchObject({ bearer: 'unknown', status: 401, bearerHash: tokenHash('never-issued') });
    const { tokens } = connect();
    expect(mcp(rpc('tools/list'), tokens.access_token).entry.bearerHash).toBe(tokenHash(tokens.access_token));
    expect(mcp(rpc('tools/list')).entry.bearerHash).toBeUndefined();
    expect(send({ method: 'POST', url: '/mcp', headers: { authorization: 'Basic abc' }, body: rpc('tools/list') }).entry).toMatchObject({ bearer: 'malformed', status: 401 });
  });
});

describe('the OAuth phase: refresh rotation', () => {
  it('rotates both tokens; the old access token is superseded and the old refresh token dead', () => {
    const { clientId, tokens } = connect();
    const out = refresh(clientId, tokens.refresh_token);
    const next = json(out) as { access_token: string; refresh_token: string; token_type: string };
    expect(next.token_type).toBe('Bearer');
    expect(next.access_token).not.toBe(tokens.access_token);
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect(out.entry).toMatchObject({ grant: 'refresh_token', status: 200, issued: { family: 1, generation: 2, access: tokenHash(next.access_token), refresh: tokenHash(next.refresh_token) } });
    expect(mcp(rpc('tools/list'), tokens.access_token).entry).toMatchObject({ bearer: 'superseded', status: 401, token: { generation: 1 } });
    expect(mcp(rpc('tools/list'), next.access_token).entry).toMatchObject({ bearer: 'valid', status: 200, token: { generation: 2 } });
  });

  it('treats reuse of a rotated refresh token as replay and revokes the family', () => {
    const { clientId, tokens } = connect();
    const next = json(refresh(clientId, tokens.refresh_token)) as { access_token: string; refresh_token: string };
    const replay = refresh(clientId, tokens.refresh_token);
    expect(json(replay).error).toBe('invalid_grant');
    expect(replay.entry.error).toBe('refresh_replayed');
    expect(mcp(rpc('tools/list'), next.access_token).entry.bearer).toBe('revoked');
    expect(refresh(clientId, next.refresh_token).entry.error).toBe('refresh_revoked');
  });

  it.each([
    ['another resource', { resource: `${ORIGIN}/other` }, 'resource_mismatch'],
    ['no resource', { resource: undefined }, 'resource_mismatch'],
    ['another client', { client_id: 'nobody' }, 'unknown_client'],
    ['an unknown token', { refresh_token: 'nope' }, 'refresh_unknown'],
  ])('refuses %s without rotating', (_name, overrides, reason) => {
    const { clientId, tokens } = connect();
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, resource: RESOURCE, client_id: clientId, ...overrides })) if (value !== undefined) fields[key] = value;
    expect(form('/token', fields).entry.error).toBe(reason);
    expect(refresh(clientId, tokens.refresh_token).entry.status).toBe(200); // still the live refresh token
  });
});

describe('the OAuth phase: revocation', () => {
  it('revokes the whole grant from its refresh or access token, answering 200', () => {
    const { clientId, tokens } = connect();
    const out = form('/revoke', { token: tokens.refresh_token, token_type_hint: 'refresh_token', client_id: clientId });
    expect(out.response.status).toBe(200);
    expect(out.entry.revoked).toEqual({ family: 1 });
    expect(form('/revoke', { token: tokens.access_token, token_type_hint: 'access_token', client_id: clientId }).response.status).toBe(200);
    expect(mcp(rpc('tools/list'), tokens.access_token).entry.bearer).toBe('revoked');
    expect(refresh(clientId, tokens.refresh_token).entry.error).toBe('refresh_revoked');
  });

  it('answers an unknown token 200 and refuses another client', () => {
    const { tokens } = connect();
    expect(form('/revoke', { token: 'nope', client_id: 'whoever' }).response.status).toBe(200);
    const other = form('/revoke', { token: tokens.refresh_token, client_id: 'nobody' });
    expect(other.response.status).toBe(401);
    expect(other.entry.error).toBe('unknown_client');
    expect(mcp(rpc('tools/list'), tokens.access_token).entry.bearer).toBe('valid');
  });

  it('is unavailable when the control says so, and then revokes nothing', () => {
    const { clientId, tokens } = connect();
    const out = form('/revoke', { token: tokens.refresh_token, client_id: clientId }, { ...OAUTH, revocation: 'unavailable' });
    expect(out.response.status).toBe(503);
    expect(out.entry.error).toBe('unavailable');
    expect(mcp(rpc('tools/list'), tokens.access_token).entry.bearer).toBe('valid');
  });
});

describe('phase changes and the safe log', () => {
  it('keeps its grants across a return to the open phase, and enforces them again in the next OAuth phase', () => {
    const { tokens } = connect();
    expect(mcp(rpc('tools/list'), undefined, { ...OPEN_CONTROL, seq: 2 }).response.status).toBe(200);
    expect(mcp(rpc('tools/list'), undefined, { ...OAUTH, seq: 3 }).response.status).toBe(401);
    expect(mcp(rpc('tools/list'), tokens.access_token, { ...OAUTH, seq: 3 }).entry).toMatchObject({ bearer: 'valid', seq: 3 });
  });

  it('never writes a state, code, verifier or token value into a log entry', () => {
    const { clientId, tokens } = connect();
    const next = json(refresh(clientId, tokens.refresh_token)) as { refresh_token: string };
    mcp(rpc('tools/call', { name: 'read_series', arguments: {} }), tokens.access_token);
    form('/revoke', { token: next.refresh_token, client_id: clientId });
    const log = JSON.stringify(entries);
    expect(secrets.length).toBeGreaterThanOrEqual(7);
    for (const secret of secrets) expect(log.includes(secret.value), secret.kind).toBe(false);
    expect(log).not.toContain(VERIFIER);
    expect(log).not.toContain(CHALLENGE);
    expect(entries.every((entry) => !entry.path.includes('?'))).toBe(true);
  });
});

// P4-AGG M1: engine mode, the fixture an engine's own sign-in runs against (the spec's acceptance 9). The engine's
// callback is `http://localhost:<port>/callback` when it listens itself, or the `127.0.0.1` one a host passes it; both,
// and only those, register. The MAWS mode above keeps refusing localhost.
describe('engine mode', () => {
  const ENGINE_REDIRECTS = ['http://localhost:52000/callback', 'http://127.0.0.1:52000/callback'];
  const engineCore = () => createOAuthFixtureCore({ id: 'series', origin: ORIGIN, mode: 'engine', now: () => clock, randomToken: () => `tok${String(++minted).padStart(4, '0')}${'x'.repeat(28)}` });
  const registerFor = (fixture: OAuthFixtureCore, redirectUris: string[]) =>
    fixture.handle({ method: 'POST', url: '/register', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: redirectUris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_name: 'Claude Code (fixture)' }) }, OAUTH);

  it.each(ENGINE_REDIRECTS)('registers the engine callback %s', (redirect) => {
    const out = registerFor(engineCore(), [redirect]);
    expect(out.response.status).toBe(201);
    expect(json(out).redirect_uris).toEqual([redirect]);
  });

  it.each([
    ['another path', 'http://localhost:52000/other'],
    ['no port', 'http://localhost/callback'],
    ['https', 'https://localhost:52000/callback'],
    ['a query', 'http://localhost:52000/callback?x=1'],
    ['another host', 'http://example.com:52000/callback'],
    ['another loopback spelling', 'http://127.1:52000/callback'],
  ])('refuses %s', (_name, redirect) => {
    const out = registerFor(engineCore(), [redirect]);
    expect(out.response.status).toBe(400);
    expect(json(out).error).toBe('invalid_redirect_uri');
  });

  it('completes a token exchange through a localhost callback', () => {
    const fixture = engineCore();
    const redirect = ENGINE_REDIRECTS[0]!;
    const clientId = json(registerFor(fixture, [redirect])).client_id as string;
    const params = new URLSearchParams({ response_type: 'code', client_id: clientId, code_challenge: CHALLENGE, code_challenge_method: 'S256', redirect_uri: redirect, state: 'engine-state', resource: RESOURCE });
    const location = new URL(fixture.handle({ method: 'GET', url: `/authorize?${params}`, headers: {}, body: '' }, OAUTH).response.headers.location!);
    expect(`${location.origin}${location.pathname}`).toBe(redirect);
    expect(location.searchParams.get('state')).toBe('engine-state');
    const body = new URLSearchParams({ grant_type: 'authorization_code', code: location.searchParams.get('code')!, code_verifier: VERIFIER, redirect_uri: redirect, resource: RESOURCE, client_id: clientId }).toString();
    const out = fixture.handle({ method: 'POST', url: '/token', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }, OAUTH);
    expect(out.response.status).toBe(200);
    expect(json(out)).toMatchObject({ token_type: 'Bearer' });
  });

  it('is the MAWS mode unless named', () => {
    expect(json(register({ redirect_uris: ['http://localhost:52000/callback'] })).error).toBe('invalid_redirect_uri');
  });
});
