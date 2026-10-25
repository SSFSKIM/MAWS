// P3-HD M4a: the request logic of the toy OAuth fixture (support/connector-oauth-server.mjs runs it over HTTP on
// 127.0.0.1; test/support/connector-oauth-core.test.ts drives it directly). One origin is both an MCP resource at
// `/mcp` and the authorization server for it, so a scene configures one URL.
//
// Two phases, chosen per request by the scene's control file (support/connector-oauth.ts writes it):
// - open (the default, and what an absent or malformed control means): `/mcp` answers without authorization and every
//   authorization route answers 404, so an engine configured with this URL never sees a 401 or metadata (P3-HD Decision
//   Log 23: an engine's discovery may enter its native credential custody).
// - oauth, entered only after the scene has confirmed no engine is alive: RFC 9728 protected-resource and RFC 8414
//   authorization-server metadata (issuer = the origin, as written), RFC 7591 registration of a public client
//   (`none`) for an exact `http://127.0.0.1:<port>/<path>` redirect, an auto-approving authorization endpoint standing
//   in for consent (S256 PKCE, state, the exact resource, RFC 9207 `iss` on the callback), a token endpoint
//   (single-use codes, RFC 8707 resource binding, expiring access tokens, refresh rotation with replay detection) and
//   RFC 7009 revocation. `/mcp` then requires a live Bearer token of this fixture.
// Grants survive phase changes, so a relaunch and a later OAuth phase can reuse them.
// P4-AGG M1: in engine mode (`mode: 'engine'`) registration admits the engine's own callbacks instead,
// `http://localhost:<port>/callback` and `http://127.0.0.1:<port>/callback`; everything else is the same.
//
// Each request yields its answer, one safe log entry and the secrets it saw or minted. Entries carry the pathname
// only, counts and ordinals and token hashes, never a state, code, verifier, challenge or token value; the secrets go
// to a separate file a scene scans its retained evidence against and never retains.
import { createHash } from 'node:crypto';
import { URL, URLSearchParams } from 'node:url';

export const OAUTH_SCOPE = 'series:read';
export const CODE_TTL_MS = 60_000;
export const OPEN_CONTROL = Object.freeze({ seq: 0, phase: 'open', accessTtlSeconds: 3600, revocation: 'available' });

const PHASES = new Set(['open', 'oauth']);
const REVOCATION = new Set(['available', 'unavailable']);
// P3-HD panel correction: what the trust-binding scene makes a fixture advertise instead of its own, in the OAuth
// phase only: `resource` (protected-resource metadata), `authorizationServer` (its one authorization server) and
// `issuer` (the issuer its metadata names, also served then as OpenID discovery metadata). Loopback URLs only.
const ADVERTISED = ['resource', 'authorizationServer', 'issuer'];
const ADVERTISED_MAX = 2048;
const advertisedUrl = (value) => typeof value === 'string' && value.length <= ADVERTISED_MAX && value.startsWith('http://127.0.0.1:');

// The override as given, or null when malformed (then the whole control is).
function parseAdvertise(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (!keys.every((key) => ADVERTISED.includes(key) && advertisedUrl(value[key]))) return null;
  return Object.fromEntries(ADVERTISED.filter((key) => key in value).map((key) => [key, value[key]]));
}

export function parseOAuthControl(text) {
  if (text === null) return OPEN_CONTROL;
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return OPEN_CONTROL;
  }
  const { seq, phase, accessTtlSeconds, revocation, advertise } = value ?? {};
  const valid = Number.isInteger(seq) && seq >= 0 && PHASES.has(phase) && Number.isInteger(accessTtlSeconds) && accessTtlSeconds >= 1 && accessTtlSeconds <= 86_400 && REVOCATION.has(revocation);
  const advertised = advertise === undefined ? undefined : parseAdvertise(advertise);
  if (!valid || advertised === null) return OPEN_CONTROL;
  return { seq, phase, accessTtlSeconds, revocation, ...(advertised !== undefined && { advertise: advertised }) };
}

export const tokenHash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 16);

const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const LOOPBACK_REDIRECT = /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/[A-Za-z0-9\-._~/]*$/;
// P4-AGG M1: engine mode's callbacks, the engine's own `localhost` listener and the `127.0.0.1` one a host passes it,
// both at `/callback` (the spec's fact 2).
const ENGINE_REDIRECT = /^http:\/\/(localhost|127\.0\.0\.1):[1-9][0-9]{0,4}\/callback$/;

function routeOf(path) {
  switch (path) {
    case '/mcp':
      return 'mcp';
    case '/.well-known/oauth-protected-resource':
    case '/.well-known/oauth-protected-resource/mcp':
      return 'resourceMetadata';
    case '/.well-known/oauth-authorization-server':
    case '/.well-known/openid-configuration':
      return 'serverMetadata';
    case '/register':
    case '/authorize':
    case '/token':
    case '/revoke':
      return path.slice(1);
    default:
      return 'other';
  }
}

// A parameter given once; null when absent or repeated (a repeat is never resolved to either value).
function single(params, name) {
  const values = params.getAll(name);
  return values.length === 1 ? values[0] : null;
}

const answer = (status, body, headers = {}) => ({ status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }, body: JSON.stringify(body) });
const empty = (status, headers = {}) => ({ status, headers, body: '' });

export function createOAuthFixtureCore({ id, origin, tools = ['read_series'], mode = 'maws', now, randomToken }) {
  const redirectAllowed = mode === 'engine' ? ENGINE_REDIRECT : LOOPBACK_REDIRECT; // P4-AGG M1
  const resource = `${origin}/mcp`;
  const resourceMetadataUrl = `${origin}/.well-known/oauth-protected-resource/mcp`;
  const clients = new Map(); // client_id → {ordinal, redirectUris}
  const codes = new Map(); // code → {clientId, redirectUri, challenge, expiresAt, used, family (once exchanged)}
  const families = []; // ordinal - 1 → {ordinal, clientId, generation, refresh, revoked}
  const access = new Map(); // token → {family, generation, expiresAt, superseded}
  const refreshes = new Map(); // token → {family, generation, rotated}
  let calls = 0;

  const resourceMetadata = { resource, authorization_servers: [origin], scopes_supported: [OAUTH_SCOPE], bearer_methods_supported: ['header'] };
  const serverMetadata = {
    issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register`, revocation_endpoint: `${origin}/revoke`,
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'], scopes_supported: [OAUTH_SCOPE], authorization_response_iss_parameter_supported: true,
  };

  // P3-HD panel correction: the documents as the control's overrides make them (unchanged without one)
  const advertisedResource = ({ resource: advertised, authorizationServer }) => ({
    ...resourceMetadata, ...(advertised !== undefined && { resource: advertised }), ...(authorizationServer !== undefined && { authorization_servers: [authorizationServer] }),
  });
  const advertisedServer = ({ issuer }) =>
    issuer === undefined ? serverMetadata : { ...serverMetadata, issuer, jwks_uri: `${origin}/jwks`, subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'] };

  function bearerOf(headers) {
    const header = headers.authorization;
    if (header === undefined) return { bearer: 'none' };
    const match = /^Bearer ([^\s]+)$/i.exec(header);
    if (!match) return { bearer: 'malformed' };
    const bearerHash = tokenHash(match[1]);
    const record = access.get(match[1]);
    if (record === undefined) return { bearer: 'unknown', bearerHash };
    const token = { family: record.family.ordinal, generation: record.generation, hash: bearerHash };
    if (record.family.revoked) return { bearer: 'revoked', bearerHash, token };
    if (record.superseded) return { bearer: 'superseded', bearerHash, token };
    if (now() >= record.expiresAt) return { bearer: 'expired', bearerHash, token };
    return { bearer: 'valid', bearerHash, token };
  }

  function mint(family, control, secrets) {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    family.generation += 1;
    for (const record of access.values()) if (record.family === family) record.superseded = true;
    access.set(accessToken, { family, generation: family.generation, expiresAt: now() + control.accessTtlSeconds * 1000, superseded: false });
    if (family.refresh !== null) refreshes.get(family.refresh).rotated = true;
    refreshes.set(refreshToken, { family, generation: family.generation, rotated: false });
    family.refresh = refreshToken;
    secrets.push({ kind: 'accessToken', value: accessToken }, { kind: 'refreshToken', value: refreshToken });
    return {
      body: { access_token: accessToken, token_type: 'Bearer', expires_in: control.accessTtlSeconds, refresh_token: refreshToken, scope: OAUTH_SCOPE },
      issued: { family: family.ordinal, generation: family.generation, access: tokenHash(accessToken), refresh: tokenHash(refreshToken) },
    };
  }

  // One JSON-RPC message, or null; what it asks is logged whether or not it is then answered.
  function messageOf(request, entry) {
    let message;
    try {
      message = JSON.parse(request.body);
    } catch {
      return null;
    }
    if (message === null || typeof message !== 'object' || Array.isArray(message)) return null;
    entry.method = typeof message.method === 'string' ? message.method : null;
    if (message.method === 'tools/call') {
      entry.tool = message.params?.name;
      entry.arguments = message.params?.arguments ?? {};
    }
    return message;
  }

  function mcp(request, message) {
    if (request.method !== 'POST') return empty(405, { allow: 'POST' }); // no standalone SSE stream
    if (message === null) return answer(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'one JSON-RPC message per request' } });
    if (message.id === undefined) return empty(202);
    const reply = (result) => answer(200, { jsonrpc: '2.0', id: message.id, ...result });
    switch (message.method) {
      case 'initialize':
        return reply({ result: { protocolVersion: message.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'maws-oauth-fixture', version: '0.0.1' } } });
      case 'ping':
        return reply({ result: {} });
      case 'tools/list':
        return reply({ result: { tools: tools.map((name) => ({ name, description: `Fixture tool ${name} of ${id}`, inputSchema: { type: 'object', properties: {}, additionalProperties: true }, annotations: { readOnlyHint: true } })) } });
      case 'tools/call': {
        if (!tools.includes(message.params?.name)) return reply({ error: { code: -32602, message: `unknown tool ${String(message.params?.name)}` } });
        calls += 1;
        const structuredContent = { server: id, tool: message.params.name, arguments: message.params.arguments ?? {}, n: calls };
        return reply({ result: { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent } });
      }
      default:
        return reply({ error: { code: -32601, message: `method not found: ${String(message.method)}` } });
    }
  }

  function register(request, entry) {
    if (request.method !== 'POST') return empty(405, { allow: 'POST' });
    let metadata;
    try {
      metadata = JSON.parse(request.body);
    } catch {
      metadata = null;
    }
    const refuse = (error) => {
      entry.error = error;
      return answer(400, { error });
    };
    if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return refuse('invalid_client_metadata');
    const { redirect_uris: redirectUris, token_endpoint_auth_method: authMethod, grant_types: grants = ['authorization_code'], response_types: responses = ['code'] } = metadata;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0 || !redirectUris.every((uri) => typeof uri === 'string' && redirectAllowed.test(uri))) return refuse('invalid_redirect_uri');
    if (authMethod !== 'none') return refuse('invalid_client_metadata'); // a public client only
    if (!Array.isArray(grants) || !grants.every((grant) => grant === 'authorization_code' || grant === 'refresh_token')) return refuse('invalid_client_metadata');
    if (!Array.isArray(responses) || !responses.every((type) => type === 'code')) return refuse('invalid_client_metadata');
    const clientId = randomToken();
    const ordinal = clients.size + 1;
    clients.set(clientId, { ordinal, redirectUris: [...redirectUris] });
    entry.client = ordinal;
    return answer(201, { ...metadata, client_id: clientId, client_id_issued_at: Math.floor(now() / 1000), token_endpoint_auth_method: 'none', grant_types: grants, response_types: responses });
  }

  function authorize(request, url, entry, secrets) {
    if (request.method !== 'GET') return empty(405, { allow: 'GET' });
    const params = url.searchParams;
    const state = single(params, 'state');
    if (state !== null) secrets.push({ kind: 'state', value: state });
    // the challenge is derived from the verifier but is PKCE data all the same: recorded before any refusal, so a
    // diagnostic carrying it alone still fails a scan
    for (const value of params.getAll('code_challenge')) if (value !== '') secrets.push({ kind: 'codeChallenge', value });
    const client = clients.get(single(params, 'client_id') ?? '');
    const redirectUri = single(params, 'redirect_uri');
    const refuse = (reason) => {
      entry.error = reason;
      return answer(400, { error: 'invalid_request', error_description: 'the fixture redirects only to a registered callback' });
    };
    if (client === undefined) return refuse('unknown_client');
    entry.client = client.ordinal;
    if (redirectUri === null || !client.redirectUris.includes(redirectUri)) return refuse('redirect_mismatch');
    const back = (fields, reason) => {
      const target = new URL(redirectUri);
      for (const [key, value] of Object.entries(fields)) target.searchParams.set(key, value);
      if (state !== null) target.searchParams.set('state', state);
      target.searchParams.set('iss', origin);
      if (reason !== undefined) entry.error = reason;
      return empty(302, { location: target.href, 'cache-control': 'no-store' });
    };
    const repeated = ['response_type', 'client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'resource', 'scope'].some((name) => params.getAll(name).length > 1);
    if (repeated) return back({ error: 'invalid_request' }, 'repeated');
    if (single(params, 'response_type') !== 'code') return back({ error: 'unsupported_response_type' }, 'response_type');
    const challenge = single(params, 'code_challenge');
    if (single(params, 'code_challenge_method') !== 'S256' || challenge === null || !CHALLENGE.test(challenge)) return back({ error: 'invalid_request' }, 'pkce');
    if (state === null || state === '') return back({ error: 'invalid_request' }, 'state_missing');
    if (single(params, 'resource') !== resource) return back({ error: 'invalid_target' }, 'resource_mismatch');
    const scope = single(params, 'scope');
    if (params.has('scope') && scope !== OAUTH_SCOPE) return back({ error: 'invalid_scope' }, 'scope');
    const code = randomToken();
    codes.set(code, { clientId: single(params, 'client_id'), redirectUri, challenge, expiresAt: now() + CODE_TTL_MS, used: false, family: null });
    secrets.push({ kind: 'code', value: code });
    return back({ code });
  }

  function token(request, control, entry, secrets) {
    if (request.method !== 'POST') return empty(405, { allow: 'POST' });
    const refuse = (error, reason) => {
      entry.error = reason;
      return answer(error === 'invalid_client' ? 401 : 400, { error });
    };
    if (!(request.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) return refuse('invalid_request', 'not_form');
    const params = new URLSearchParams(request.body);
    const grant = single(params, 'grant_type');
    if (grant !== 'authorization_code' && grant !== 'refresh_token') return refuse('unsupported_grant_type', 'grant_type');
    entry.grant = grant;
    if (params.has('client_secret') || request.headers.authorization !== undefined) return refuse('invalid_client', 'confidential_client');
    const clientId = single(params, 'client_id');
    const client = clients.get(clientId ?? '');
    if (client === undefined) return refuse('invalid_client', 'unknown_client');
    entry.client = client.ordinal;

    if (grant === 'authorization_code') {
      const verifier = single(params, 'code_verifier');
      if (verifier !== null) secrets.push({ kind: 'codeVerifier', value: verifier });
      const record = codes.get(single(params, 'code') ?? '');
      if (record === undefined) return refuse('invalid_grant', 'code_unknown');
      if (record.used) {
        if (record.family !== null) record.family.revoked = true; // a replayed code revokes what it issued
        return refuse('invalid_grant', 'code_replayed');
      }
      record.used = true;
      if (record.clientId !== clientId) return refuse('invalid_grant', 'client_mismatch');
      if (now() >= record.expiresAt) return refuse('invalid_grant', 'code_expired');
      if (single(params, 'redirect_uri') !== record.redirectUri) return refuse('invalid_grant', 'redirect_mismatch');
      if (single(params, 'resource') !== resource) return refuse('invalid_target', 'resource_mismatch');
      if (verifier === null || !VERIFIER.test(verifier) || createHash('sha256').update(verifier).digest('base64url') !== record.challenge) return refuse('invalid_grant', 'verifier_mismatch');
      const family = { ordinal: families.length + 1, clientId, generation: 0, refresh: null, revoked: false };
      families.push(family);
      record.family = family;
      const minted = mint(family, control, secrets);
      entry.issued = minted.issued;
      return answer(200, minted.body);
    }

    const presented = single(params, 'refresh_token') ?? '';
    const record = refreshes.get(presented);
    if (record === undefined) return refuse('invalid_grant', 'refresh_unknown');
    if (record.family.clientId !== clientId) return refuse('invalid_grant', 'client_mismatch');
    if (record.family.revoked) return refuse('invalid_grant', 'refresh_revoked');
    if (record.rotated) {
      record.family.revoked = true; // reuse of a rotated refresh token: the grant may be stolen (OAuth 2.1 §4.3.1)
      return refuse('invalid_grant', 'refresh_replayed');
    }
    if (single(params, 'resource') !== resource) return refuse('invalid_target', 'resource_mismatch');
    if (params.has('scope') && single(params, 'scope') !== OAUTH_SCOPE) return refuse('invalid_scope', 'scope');
    const minted = mint(record.family, control, secrets);
    entry.issued = minted.issued;
    return answer(200, minted.body);
  }

  function revoke(request, control, entry) {
    if (request.method !== 'POST') return empty(405, { allow: 'POST' });
    if (control.revocation === 'unavailable') {
      entry.error = 'unavailable';
      return answer(503, { error: 'temporarily_unavailable' });
    }
    const refuse = (reason) => {
      entry.error = reason;
      return answer(401, { error: 'invalid_client' });
    };
    const params = new URLSearchParams(request.body);
    const clientId = single(params, 'client_id');
    if (clientId === null) return refuse('client_missing');
    const presented = single(params, 'token') ?? '';
    const family = (access.get(presented) ?? refreshes.get(presented))?.family;
    if (family === undefined) {
      entry.error = 'unknown_token';
      return empty(200); // RFC 7009 §2.2: an unknown token is not an error
    }
    const client = clients.get(clientId);
    if (client === undefined) return refuse('unknown_client');
    entry.client = client.ordinal;
    if (family.clientId !== clientId) return refuse('client_mismatch');
    family.revoked = true; // the whole grant: its refresh token and every access token
    entry.revoked = { family: family.ordinal };
    return empty(200);
  }

  return {
    handle(request, control) {
      const url = new URL(request.url, origin);
      const route = routeOf(url.pathname);
      const secrets = [];
      const advertise = control.advertise ?? {}; // P3-HD panel correction
      const entry = { server: id, event: 'http', phase: control.phase, seq: control.seq, route, httpMethod: request.method, path: url.pathname, method: null, bearer: 'none', status: 0, advertised: false };
      let response;
      if (route === 'mcp') {
        const message = request.method === 'POST' ? messageOf(request, entry) : null;
        const presented = bearerOf(request.headers);
        entry.bearer = presented.bearer;
        if (presented.bearerHash !== undefined) entry.bearerHash = presented.bearerHash;
        if (presented.token !== undefined) entry.token = presented.token;
        if (control.phase === 'oauth' && presented.bearer !== 'valid') {
          const error = presented.bearer === 'none' ? '' : 'error="invalid_token", ';
          response = answer(401, { error: 'invalid_token' }, { 'www-authenticate': `Bearer ${error}resource_metadata="${resourceMetadataUrl}", scope="${OAUTH_SCOPE}"` });
          entry.advertised = true;
        } else response = mcp(request, message);
      } else if (control.phase === 'open' || route === 'other' || (url.pathname === '/.well-known/openid-configuration' && advertise.issuer === undefined)) {
        response = answer(404, { error: 'not_found' });
      } else if (route === 'resourceMetadata' || route === 'serverMetadata') {
        response = request.method === 'GET' ? answer(200, route === 'resourceMetadata' ? advertisedResource(advertise) : advertisedServer(advertise)) : empty(405, { allow: 'GET' });
        entry.advertised = response.status === 200;
      } else if (route === 'register') response = register(request, entry);
      else if (route === 'authorize') response = authorize(request, url, entry, secrets);
      else if (route === 'token') response = token(request, control, entry, secrets);
      else response = revoke(request, control, entry);
      entry.status = response.status;
      return { response, entry, secrets };
    },
  };
}
