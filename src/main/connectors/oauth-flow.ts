// P3-HD M3a: MAWS's own OAuth for one HTTP connector (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md M3 and
// Decision Log 13; P3 co-work Decision Log 98 (5)): the owner's Connect, a demand refresh and best-effort revocation,
// over the pinned SDK 1.32.1's lower-level helpers. Never the SDK's `auth()`: it swallows discovery failures into a
// guessed authorization server, may register again, and retries an authorization code after `invalid_grant`.
//
// Connect is one explicit pass, each external step taken once and only while the owner's signal stands:
//   protected-resource metadata of the request URL (no fallback to a guessed server) → its resource must cover the
//   request URL (`checkResourceAllowed`) and is kept verbatim → the first advertised authorization server's metadata,
//   whose issuer must name that server → HTTPS endpoints (127.0.0.1 HTTP for fixtures), dynamic registration and S256
//   required → the 127.0.0.1 listener is bound → registration for exactly its redirect URI → authorization URL with
//   state, PKCE and the resource → the system browser → one callback (exact path, GET, single-valued state, iss when
//   advertised or present) → one code exchange → a Bearer token answer.
// The listener closes on every exit; a cancelled flow sends nothing further and returns no tokens.
//
// Refresh is one POST to the stored token endpoint with the stored client and resource; no discovery, browser or
// retry. Its failures say what the provider (M3c) should do: `rejected` needs a Reconnect, `transient` keeps the refresh
// token. Revocation (RFC 7009, which the SDK lacks) uses only the stored metadata and never throws.
//
// Errors are `ConnectorOAuthError` with closed codes: no SDK message (it can carry a raw response body), URL or token.
import { randomBytes } from 'node:crypto';
import {
  discoverAuthorizationServerMetadata, discoverOAuthProtectedResourceMetadata, exchangeAuthorization, refreshAuthorization, registerClient,
  selectClientAuthMethod, startAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type { AuthorizationServerMetadata, OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { checkResourceAllowed, resourceUrlFromServerUrl } from '@modelcontextprotocol/sdk/shared/auth-utils.js';
import { OAUTH_CALLBACK_HOST, type ListenLoopback, type LoopbackReply, type LoopbackRequest } from './oauth-callback';
import { boundedOAuthFetch, isPermittedOAuthUrl, OAuthTransportError, type OAuthFetch } from './oauth-http';
import type { ConnectorOAuthGrant, ConnectorOAuthTokens } from './oauth-types';

export const CONNECT_CALLBACK_TIMEOUT_MS = 120_000;
export const OAUTH_CALLBACK_PATH = '/callback';
const TOKEN_LIMIT = 16_384; // the host's transient credential bound (DirectCredentialSchema)
const SCOPE_LIMIT = 8_192;

export const CONNECTOR_OAUTH_FAILURES = [
  'cancelled', 'timeout', 'network', 'insecure', // the request itself
  'discovery', 'resource', 'issuer', 'unsupported', // what the servers advertise
  'listener', 'registration', 'browser', 'denied', 'state', 'exchange', 'token', // Connect's steps
  'rejected', 'transient', // a refresh: reconnect, or keep the refresh token and try on a later demand
] as const;
export type ConnectorOAuthFailure = (typeof CONNECTOR_OAUTH_FAILURES)[number];
export class ConnectorOAuthError extends Error {
  constructor(readonly code: ConnectorOAuthFailure) {
    super(`connector OAuth ${code}`);
    this.name = 'ConnectorOAuthError';
  }
}

export interface ConnectorOAuthFlowDeps {
  fetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
  listen: ListenLoopback;
  openBrowser(url: string): Promise<void>; // only ever an owner's Connect or Reconnect
  now?: () => number;
  randomState?: () => string;
}

export interface ConnectorOAuthFlow {
  // The owner's Connect or Reconnect: a fresh registration and grant for the request URL. The caller binds the result
  // to its identity and saves it under its own claim.
  connect(input: { requestUrl: string; signal: AbortSignal }): Promise<ConnectorOAuthGrant>;
  // The rotated tokens (the old refresh token kept when none was returned). Saving them is the caller's.
  refresh(grant: ConnectorOAuthGrant, signal: AbortSignal): Promise<ConnectorOAuthTokens>;
  revoke(grant: ConnectorOAuthGrant, signal: AbortSignal): Promise<'revoked' | 'unsupported' | 'failed'>;
}

const fail = (code: ConnectorOAuthFailure) => new ConnectorOAuthError(code);

// The code an SDK step's failure becomes: the request's own failure, else the step's word.
function stepFailure(error: unknown, signal: AbortSignal, code: ConnectorOAuthFailure): ConnectorOAuthError {
  if (signal.aborted) return fail('cancelled');
  if (error instanceof ConnectorOAuthError) return error;
  if (error instanceof OAuthTransportError) return fail(error.code === 'tooLarge' ? code : error.code);
  return fail(code);
}

async function step<T>(signal: AbortSignal, code: ConnectorOAuthFailure, run: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw fail('cancelled');
  let value: T;
  try {
    value = await run();
  } catch (error) {
    throw stepFailure(error, signal, code);
  }
  if (signal.aborted) throw fail('cancelled');
  return value;
}

function secretExpired(client: OAuthClientInformationFull, now: number): boolean {
  const expiresAt = client.client_secret_expires_at;
  return client.client_secret !== undefined && expiresAt !== undefined && expiresAt !== 0 && expiresAt * 1000 <= now;
}

function acceptTokens(raw: OAuthTokens, now: number): ConnectorOAuthTokens {
  const { access_token: accessToken, refresh_token: refreshToken, token_type: tokenType, expires_in: expiresIn, scope } = raw;
  if (tokenType.toLowerCase() !== 'bearer') throw fail('token');
  if (accessToken.length === 0 || accessToken.length > TOKEN_LIMIT) throw fail('token');
  if (refreshToken !== undefined && (refreshToken.length === 0 || refreshToken.length > TOKEN_LIMIT)) throw fail('token');
  if (expiresIn !== undefined && !(Number.isFinite(expiresIn) && expiresIn > 0)) throw fail('token');
  if (scope !== undefined && scope.length > SCOPE_LIMIT) throw fail('token');
  return {
    accessToken,
    ...(refreshToken !== undefined && { refreshToken }),
    tokenType: 'Bearer',
    ...(scope !== undefined && scope !== '' && { grantedScope: scope }),
    ...(expiresIn !== undefined && { expiresAt: now + Math.round(expiresIn * 1000) }),
    obtainedAt: now,
  };
}

// One awaited authorization callback. Requests elsewhere are ignored; the first one on the callback path settles the
// flow, every later one is refused.
function callbackWaiter(issuer: string, issRequired: boolean) {
  let expectedState: string | null = null;
  let settled = false;
  let settle!: { resolve(code: string): void; reject(error: ConnectorOAuthError): void };
  const result = new Promise<string>((resolve, reject) => { settle = { resolve, reject }; });
  result.catch(() => {}); // a refusal before the flow awaits it is not unhandled
  const refuse = (code: ConnectorOAuthFailure, body: string): LoopbackReply => {
    settle.reject(fail(code));
    return { status: 400, body };
  };
  const handle = (request: LoopbackRequest): LoopbackReply => {
    let url: URL;
    try {
      url = new URL(request.url, `http://${OAUTH_CALLBACK_HOST}`);
    } catch {
      return { status: 400, body: 'Not a MAWS sign-in address.' };
    }
    if (url.pathname !== OAUTH_CALLBACK_PATH) return { status: 404, body: 'Not found.' };
    if (request.method !== 'GET') return { status: 405, body: 'Not a MAWS sign-in request.' };
    if (expectedState === null || settled) return { status: 400, body: 'This MAWS sign-in is not waiting for an answer.' };
    settled = true;
    // a parameter given twice is refused, never resolved to either value
    const single = (name: string): string | undefined | null => {
      const values = url.searchParams.getAll(name);
      return values.length === 0 ? undefined : values.length === 1 ? values[0]! : null;
    };
    if (single('state') !== expectedState) return refuse('state', 'MAWS did not start this sign-in.');
    const error = single('error');
    if (error === null) return refuse('state', 'MAWS could not read this sign-in answer.');
    if (error !== undefined) return refuse('denied', 'The sign-in was not completed. You can close this window.');
    const iss = single('iss');
    if (iss === null || (iss === undefined && issRequired) || (iss !== undefined && iss !== issuer)) return refuse('state', 'MAWS could not confirm who answered this sign-in.');
    const code = single('code');
    if (!code) return refuse('state', 'MAWS could not read this sign-in answer.');
    settle.resolve(code);
    return { status: 200, body: 'MAWS is connected. You can close this window.' };
  };
  return {
    handle,
    arm(state: string) { expectedState = state; },
    wait(signal: AbortSignal, timeoutMs: number): Promise<string> {
      return new Promise<string>((resolve, reject) => {
        const done = () => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); };
        const onAbort = () => { done(); reject(fail('cancelled')); };
        const timer = setTimeout(() => { done(); reject(fail('timeout')); }, timeoutMs);
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
        result.then((code) => { done(); resolve(code); }, (error: unknown) => { done(); reject(error); });
      });
    },
  };
}

function applyClientAuthentication(method: string, client: OAuthClientInformationFull, headers: Headers, params: URLSearchParams): void {
  if (method === 'client_secret_basic' && client.client_secret !== undefined) {
    headers.set('Authorization', `Basic ${btoa(`${client.client_id}:${client.client_secret}`)}`);
    return;
  }
  params.set('client_id', client.client_id);
  if (method === 'client_secret_post' && client.client_secret !== undefined) params.set('client_secret', client.client_secret);
}

// RFC 7009's fields as RFC 8414 metadata declares them; OpenID discovery metadata carries them only as extra members.
function revocationOf(metadata: AuthorizationServerMetadata): { endpoint?: string; methods?: string[] } {
  const { revocation_endpoint: endpoint, revocation_endpoint_auth_methods_supported: methods } = metadata as { revocation_endpoint?: unknown; revocation_endpoint_auth_methods_supported?: unknown };
  return {
    ...(typeof endpoint === 'string' && { endpoint }),
    ...(Array.isArray(methods) && methods.every((method) => typeof method === 'string') && { methods: methods as string[] }),
  };
}

const endpointsOf = (metadata: AuthorizationServerMetadata) =>
  [metadata.authorization_endpoint, metadata.token_endpoint, metadata.registration_endpoint, revocationOf(metadata).endpoint].filter((url): url is string => url !== undefined);

export function createConnectorOAuthFlow(deps: ConnectorOAuthFlowDeps): ConnectorOAuthFlow {
  const now = deps.now ?? Date.now;
  const randomState = deps.randomState ?? (() => randomBytes(32).toString('base64url'));

  async function discover(requestUrl: string, signal: AbortSignal, fetchFn: OAuthFetch) {
    const prm = await step(signal, 'discovery', () => discoverOAuthProtectedResourceMetadata(requestUrl, undefined, fetchFn));
    let covers: boolean;
    try {
      covers = checkResourceAllowed({ requestedResource: resourceUrlFromServerUrl(requestUrl), configuredResource: prm.resource });
    } catch {
      covers = false;
    }
    if (!covers) throw fail('resource');
    const server = prm.authorization_servers?.[0];
    if (server === undefined) throw fail('discovery');
    if (!isPermittedOAuthUrl(server)) throw fail('insecure');
    const metadata = await step(signal, 'discovery', () => discoverAuthorizationServerMetadata(server, { fetchFn }));
    if (metadata === undefined) throw fail('discovery');
    // RFC 8414 §3.3: identical to the identifier it was discovered from, compared as written (no URL normalization)
    if (metadata.issuer !== server) throw fail('issuer');
    if (!endpointsOf(metadata).every((url) => isPermittedOAuthUrl(url))) throw fail('insecure');
    if (metadata.registration_endpoint === undefined || !metadata.code_challenge_methods_supported?.includes('S256') || !metadata.response_types_supported.includes('code')) throw fail('unsupported');
    const scope = prm.scopes_supported !== undefined && prm.scopes_supported.length > 0 ? prm.scopes_supported.join(' ') : undefined;
    const issRequired = (metadata as Record<string, unknown>).authorization_response_iss_parameter_supported === true;
    return { resource: prm.resource, server, metadata, scope, issRequired };
  }

  return {
    async connect({ requestUrl, signal }) {
      if (!isPermittedOAuthUrl(requestUrl)) throw fail('insecure');
      const fetchFn = boundedOAuthFetch(deps.fetch, signal);
      const { resource, server, metadata, scope, issRequired } = await discover(requestUrl, signal, fetchFn);
      const callback = callbackWaiter(metadata.issuer, issRequired);
      const listener = await step(signal, 'listener', () => deps.listen(callback.handle));
      try {
        if (signal.aborted) throw fail('cancelled');
        const redirectUri = `http://${OAUTH_CALLBACK_HOST}:${listener.port}${OAUTH_CALLBACK_PATH}`;
        const client = await step(signal, 'registration', () => registerClient(server, {
          metadata,
          clientMetadata: { redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_name: 'MAWS' },
          ...(scope !== undefined && { scope }),
          fetchFn,
        }));
        if (secretExpired(client, now())) throw fail('registration');
        const state = randomState();
        const { authorizationUrl, codeVerifier } = await step(signal, 'unsupported', () => startAuthorization(server, { metadata, clientInformation: client, redirectUrl: redirectUri, ...(scope !== undefined && { scope }), state, resource }));
        if (!isPermittedOAuthUrl(authorizationUrl)) throw fail('insecure');
        callback.arm(state);
        await step(signal, 'browser', () => deps.openBrowser(authorizationUrl.href));
        const code = await callback.wait(signal, CONNECT_CALLBACK_TIMEOUT_MS);
        const raw = await step(signal, 'exchange', () => exchangeAuthorization(server, { metadata, clientInformation: client, authorizationCode: code, codeVerifier, redirectUri, resource, fetchFn }));
        return { issuer: metadata.issuer, resource, redirectUri, authorizationServer: metadata, client, tokens: acceptTokens(raw, now()) };
      } finally {
        await listener.close().catch(() => {});
      }
    },

    async refresh(grant, signal) {
      const refreshToken = grant.tokens.refreshToken;
      if (refreshToken === undefined || secretExpired(grant.client, now())) throw fail('rejected');
      if (signal.aborted) throw fail('cancelled');
      const fetchFn = boundedOAuthFetch(deps.fetch, signal);
      let raw: OAuthTokens;
      try {
        raw = await refreshAuthorization(grant.issuer, { metadata: grant.authorizationServer, clientInformation: grant.client, refreshToken, resource: grant.resource, fetchFn });
      } catch (error) {
        if (signal.aborted) throw fail('cancelled');
        if (error instanceof OAuthTransportError) throw fail(error.code === 'timeout' ? 'timeout' : error.code === 'insecure' ? 'rejected' : 'transient');
        const errorCode = (error as { errorCode?: unknown } | null)?.errorCode;
        if (typeof errorCode !== 'string') throw fail('token'); // an answer that was not a token response
        throw fail(['server_error', 'temporarily_unavailable', 'too_many_requests'].includes(errorCode) ? 'transient' : 'rejected');
      }
      if (signal.aborted) throw fail('cancelled');
      return acceptTokens(raw, now());
    },

    async revoke(grant, signal) {
      const metadata = grant.authorizationServer;
      const { endpoint, methods } = revocationOf(metadata);
      if (endpoint === undefined) return 'unsupported';
      if (!isPermittedOAuthUrl(endpoint)) return 'failed';
      const fetchFn = boundedOAuthFetch(deps.fetch, signal);
      const method = selectClientAuthMethod(grant.client, methods ?? metadata.token_endpoint_auth_methods_supported ?? []);
      const tokens: Array<[string, string]> = [];
      if (grant.tokens.refreshToken !== undefined) tokens.push([grant.tokens.refreshToken, 'refresh_token']);
      tokens.push([grant.tokens.accessToken, 'access_token']);
      let revoked = true;
      for (const [token, hint] of tokens) {
        if (signal.aborted) return 'failed';
        const params = new URLSearchParams({ token, token_type_hint: hint });
        const headers = new Headers({ 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' });
        applyClientAuthentication(method, grant.client, headers, params);
        try {
          const response = await fetchFn(endpoint, { method: 'POST', headers, body: params });
          if (response.status !== 200) revoked = false;
        } catch {
          revoked = false;
        }
      }
      return revoked ? 'revoked' : 'failed';
    },
  };
}
