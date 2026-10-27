// P3-HD M3a: MAWS's own OAuth for one HTTP connector (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md M3 and
// Decision Log 13; P3 co-work Decision Log 98 (5)): the owner's Connect, a demand refresh and best-effort revocation,
// over the pinned SDK 1.32.1's lower-level helpers. Never the SDK's `auth()`: it swallows discovery failures into a
// guessed authorization server, may register again, and retries an authorization code after `invalid_grant`.
//
// Connect is one explicit pass, each external step taken once and only while the owner's signal stands:
//   protected-resource metadata of the request URL (no fallback to a guessed server) → its resource must cover the
//   request URL (`resourceCovers`: same origin; exact with a query on either side, else `checkResourceAllowed`) and is
//   kept verbatim → the first advertised authorization server's metadata, every discovery request on its origin, whose
//   issuer must name that server → HTTPS endpoints (127.0.0.1 HTTP for fixtures), dynamic registration and S256
//   required → the 127.0.0.1 listener is bound → registration for exactly its redirect URI → authorization URL with
//   state, PKCE and the resource → the system browser → one callback (exact path, GET, single-valued state, iss when
//   advertised or present) → one code exchange → a Bearer token answer.
// From binding on, the flow is bounded by `CONNECT_CALLBACK_TIMEOUT_MS` as well as the owner's signal: a binding, a
// browser opener or a callback that never answers settles the flow, and a listener bound too late is closed at once.
// The listener closes on every exit; a cancelled flow sends nothing further and returns no tokens.
//
// SDK 1.32.1 parses an OpenID discovery document (its fallback when RFC 8414 metadata is absent) with a schema that
// drops members it does not declare, among them `authorization_response_iss_parameter_supported` and the revocation
// fields. The policy fields are therefore read from the same bounded document the SDK parsed, validated, and kept.
//
// Refresh is one POST to the stored token endpoint with the stored client and resource; no discovery, browser or
// retry. Its failures say what the provider (M3c) should do: `rejected` needs a Reconnect, `transient` keeps the refresh
// token. Revocation (RFC 7009, which the SDK lacks) uses only the stored metadata and never throws.
//
// Errors are `ConnectorOAuthError` with closed codes: no SDK message (it can carry a raw response body), URL or token.
import { randomBytes } from 'node:crypto';
import {
  discoverAuthorizationServerMetadata, discoverOAuthProtectedResourceMetadata, exchangeAuthorization, refreshAuthorization, registerClient,
  selectClientAuthMethod, startAuthorization, type AddClientAuthentication,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type { AuthorizationServerMetadata, OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { checkResourceAllowed, resourceUrlFromServerUrl } from '@modelcontextprotocol/sdk/shared/auth-utils.js';
import type { ClientRef } from '@shared/ipc/client';
import * as z from 'zod';
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
  openBrowser(url: string, client: ClientRef | null): Promise<void>; // only ever an owner's Connect or Reconnect, on the client that asked
  now?: () => number;
  randomState?: () => string;
}

export interface ConnectorOAuthFlow {
  // The owner's Connect or Reconnect: a fresh registration and grant for the request URL. The caller binds the result
  // to its identity and saves it under its own claim.
  connect(input: { requestUrl: string; signal: AbortSignal; client?: ClientRef | null }): Promise<ConnectorOAuthGrant>;
  // The rotated tokens (the old refresh token kept when none was returned). Saving them is the caller's.
  refresh(grant: ConnectorOAuthGrant, signal: AbortSignal): Promise<ConnectorOAuthTokens>;
  revoke(grant: ConnectorOAuthGrant, signal: AbortSignal): Promise<'revoked' | 'unsupported' | 'failed'>;
}

const fail = (code: ConnectorOAuthFailure) => new ConnectorOAuthError(code);

// The reason Connect's own bound aborts with; any other abort is the owner's cancellation.
const DEADLINE = Object.freeze({ deadline: true });
const ended = (signal: AbortSignal) => fail(signal.reason === DEADLINE ? 'timeout' : 'cancelled');

// The code an SDK step's failure becomes: the request's own failure, else the step's word.
function stepFailure(error: unknown, signal: AbortSignal, code: ConnectorOAuthFailure): ConnectorOAuthError {
  if (signal.aborted) return ended(signal);
  if (error instanceof ConnectorOAuthError) return error;
  if (error instanceof OAuthTransportError) return fail(error.code === 'tooLarge' ? code : error.code);
  return fail(code);
}

async function step<T>(signal: AbortSignal, code: ConnectorOAuthFailure, run: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw ended(signal);
  let value: T;
  try {
    value = await run();
  } catch (error) {
    throw stepFailure(error, signal, code);
  }
  if (signal.aborted) throw ended(signal);
  return value;
}

// A wait that is not a request (binding, the browser opener): it ends with the signal even if it never answers. The
// call itself is deferred a microtask, so it checks the signal once more right before it is made (P3-F L270): an abort
// queued into that gap never opens a browser. Exported for that regression.
export function untilEnded<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(ended(signal));
  const pending = Promise.resolve().then(() => {
    if (signal.aborted) throw ended(signal);
    return work();
  });
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(ended(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error: unknown) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

// The policy members of the parsed metadata document that the SDK's OpenID schema drops; malformed values refuse.
const AdvertisedPolicySchema = z.object({
  authorization_response_iss_parameter_supported: z.boolean().optional(),
  revocation_endpoint: z.string().max(8_192).optional(),
  revocation_endpoint_auth_methods_supported: z.array(z.string().max(256)).max(32).optional(),
});

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
    wait(signal: AbortSignal): Promise<string> {
      return untilEnded(() => result, signal);
    },
  };
}

// P3-F F-connectors 3: RFC 6749 §2.3.1: the client id and secret are each application/x-www-form-urlencoded before
// they are joined and Base64-encoded, so a conforming endpoint decodes a '+', '/', '=' or '%' in either as itself.
const formEncoded = (value: string): string => new URLSearchParams([['', value]]).toString().slice(1);

function applyClientAuthentication(method: string, client: OAuthClientInformationFull, headers: Headers, params: URLSearchParams): void {
  if (method === 'client_secret_basic' && client.client_secret !== undefined) {
    headers.set('Authorization', `Basic ${btoa(`${formEncoded(client.client_id)}:${formEncoded(client.client_secret)}`)}`);
    return;
  }
  params.set('client_id', client.client_id);
  if (method === 'client_secret_post' && client.client_secret !== undefined) params.set('client_secret', client.client_secret);
}

// P3-F F-connectors 3 sibling: the SDK's token requests (Connect's code exchange and the refresh) authenticate the
// client here, the method chosen as the SDK chooses it, so a Basic credential is form-encoded there too (the SDK's own
// is not); passed through the SDK's public `addClientAuthentication`.
function tokenClientAuthentication(client: OAuthClientInformationFull, metadata: Pick<AuthorizationServerMetadata, 'token_endpoint_auth_methods_supported'> | undefined): AddClientAuthentication {
  return (headers, params) => applyClientAuthentication(selectClientAuthMethod(client, metadata?.token_endpoint_auth_methods_supported ?? []), client, headers, params);
}

// RFC 7009's fields as RFC 8414 metadata declares them; OpenID discovery metadata carries them only as extra members.
function revocationOf(metadata: AuthorizationServerMetadata): { endpoint?: string; methods?: string[] } {
  const { revocation_endpoint: endpoint, revocation_endpoint_auth_methods_supported: methods } = metadata as { revocation_endpoint?: unknown; revocation_endpoint_auth_methods_supported?: unknown };
  return {
    ...(typeof endpoint === 'string' && { endpoint }),
    ...(Array.isArray(methods) && methods.every((method) => typeof method === 'string') && { methods: methods as string[] }),
  };
}

// P3-HD panel correction (Decision Log 45 and 46): whether the advertised resource indicator may stand for the request
// URL. Always the same origin. With a query on either side, exactly the requested resource (origin, path and query: a
// query names a tenant, which the SDK's path-prefix check ignores); with none, the SDK's path-prefix coverage, so a
// parent path or the origin may be advertised for a deeper request.
function resourceCovers(requestUrl: string, advertised: string): boolean {
  let requested: URL;
  let resource: URL;
  try {
    requested = resourceUrlFromServerUrl(requestUrl);
    resource = new URL(advertised);
  } catch {
    return false;
  }
  if (requested.origin !== resource.origin) return false;
  if (requested.search !== '' || resource.search !== '') return requested.pathname === resource.pathname && requested.search === resource.search;
  try {
    return checkResourceAllowed({ requestedResource: requested, configuredResource: resource });
  } catch {
    return false;
  }
}

const endpointsOf = (metadata: AuthorizationServerMetadata) =>
  [metadata.authorization_endpoint, metadata.token_endpoint, metadata.registration_endpoint, revocationOf(metadata).endpoint].filter((url): url is string => url !== undefined);

export function createConnectorOAuthFlow(deps: ConnectorOAuthFlowDeps): ConnectorOAuthFlow {
  const now = deps.now ?? Date.now;
  const randomState = deps.randomState ?? (() => randomBytes(32).toString('base64url'));

  // The listener, owned by the caller once this resolves. A binding that completes only after the flow ended is
  // closed here, since no caller will.
  async function bind(handle: (request: LoopbackRequest) => LoopbackReply, signal: AbortSignal) {
    if (signal.aborted) throw ended(signal);
    const binding = Promise.resolve().then(() => deps.listen(handle));
    try {
      return await untilEnded(() => binding, signal);
    } catch (error) {
      binding.then((late) => late.close().catch(() => {}), () => {});
      throw error instanceof ConnectorOAuthError ? error : fail('listener');
    }
  }

  async function discover(requestUrl: string, signal: AbortSignal, fetchFn: OAuthFetch) {
    const prm = await step(signal, 'discovery', () => discoverOAuthProtectedResourceMetadata(requestUrl, undefined, fetchFn));
    if (!resourceCovers(requestUrl, prm.resource)) throw fail('resource');
    const server = prm.authorization_servers?.[0];
    if (server === undefined) throw fail('discovery');
    if (!isPermittedOAuthUrl(server)) throw fail('insecure');
    // P3-HD panel correction (Decision Log 45): every discovery candidate, and any redirect the SDK follows through
    // this fetch, stays on the advertised issuer's origin, checked before the request; the SDK's last OpenID candidate
    // for an issuer path beginning `//` would otherwise resolve to another origin
    const issuerOrigin = new URL(server).origin;
    let document: unknown; // the last document the discovery answered, which is the one the SDK parsed
    const capturing: OAuthFetch = async (url, init) => {
      if (new URL(url).origin !== issuerOrigin) throw fail('issuer');
      const response = await fetchFn(url, init);
      document = response.ok ? await response.clone().json().catch(() => undefined) : document;
      return response;
    };
    const parsed = await step(signal, 'discovery', () => discoverAuthorizationServerMetadata(server, { fetchFn: capturing }));
    if (parsed === undefined) throw fail('discovery');
    const policy = AdvertisedPolicySchema.safeParse(document);
    if (!policy.success) throw fail('discovery');
    const { authorization_response_iss_parameter_supported: iss, revocation_endpoint: revocation, revocation_endpoint_auth_methods_supported: revocationMethods } = policy.data;
    const metadata: AuthorizationServerMetadata = {
      ...parsed,
      ...(iss !== undefined && { authorization_response_iss_parameter_supported: iss }),
      ...(revocation !== undefined && { revocation_endpoint: revocation }),
      ...(revocationMethods !== undefined && { revocation_endpoint_auth_methods_supported: revocationMethods }),
    };
    // RFC 8414 §3.3: identical to the identifier it was discovered from, compared as written (no URL normalization)
    if (metadata.issuer !== server) throw fail('issuer');
    if (!endpointsOf(metadata).every((url) => isPermittedOAuthUrl(url))) throw fail('insecure');
    if (metadata.registration_endpoint === undefined || !metadata.code_challenge_methods_supported?.includes('S256') || !metadata.response_types_supported.includes('code')) throw fail('unsupported');
    const scope = prm.scopes_supported !== undefined && prm.scopes_supported.length > 0 ? prm.scopes_supported.join(' ') : undefined;
    const issRequired = (metadata as Record<string, unknown>).authorization_response_iss_parameter_supported === true;
    return { resource: prm.resource, server, metadata, scope, issRequired };
  }

  return {
    async connect({ requestUrl, signal, client: asker = null }) { // asker: the ClientRef whose Connect this is (P5 O1 M3)
      if (!isPermittedOAuthUrl(requestUrl)) throw fail('insecure');
      const fetchFn = boundedOAuthFetch(deps.fetch, signal);
      const { resource, server, metadata, scope, issRequired } = await discover(requestUrl, signal, fetchFn);
      const callback = callbackWaiter(metadata.issuer, issRequired);
      const bound = new AbortController(); // the owner's signal or the deadline, from binding on
      const onCancel = () => bound.abort(signal.reason);
      signal.addEventListener('abort', onCancel, { once: true });
      const deadline = setTimeout(() => bound.abort(DEADLINE), CONNECT_CALLBACK_TIMEOUT_MS);
      if (signal.aborted) onCancel();
      const flow = bound.signal;
      const flowFetch = boundedOAuthFetch(deps.fetch, flow);
      try {
        const listener = await bind(callback.handle, flow);
        try {
          if (flow.aborted) throw ended(flow);
          const redirectUri = `http://${OAUTH_CALLBACK_HOST}:${listener.port}${OAUTH_CALLBACK_PATH}`;
          const client = await step(flow, 'registration', () => registerClient(server, {
            metadata,
            clientMetadata: { redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_name: 'MAWS' },
            ...(scope !== undefined && { scope }),
            fetchFn: flowFetch,
          }));
          if (secretExpired(client, now())) throw fail('registration');
          const state = randomState();
          const { authorizationUrl, codeVerifier } = await step(flow, 'unsupported', () => startAuthorization(server, { metadata, clientInformation: client, redirectUrl: redirectUri, ...(scope !== undefined && { scope }), state, resource }));
          if (!isPermittedOAuthUrl(authorizationUrl)) throw fail('insecure');
          callback.arm(state);
          await step(flow, 'browser', () => untilEnded(() => deps.openBrowser(authorizationUrl.href, asker), flow));
          const code = await callback.wait(flow);
          const raw = await step(flow, 'exchange', () => exchangeAuthorization(server, { metadata, clientInformation: client, authorizationCode: code, codeVerifier, redirectUri, resource, addClientAuthentication: tokenClientAuthentication(client, metadata), fetchFn: flowFetch }));
          return { issuer: metadata.issuer, resource, redirectUri, authorizationServer: metadata, client, tokens: acceptTokens(raw, now()) };
        } finally {
          await listener.close().catch(() => {});
        }
      } finally {
        clearTimeout(deadline);
        signal.removeEventListener('abort', onCancel);
      }
    },

    async refresh(grant, signal) {
      const refreshToken = grant.tokens.refreshToken;
      if (refreshToken === undefined || secretExpired(grant.client, now())) throw fail('rejected');
      if (signal.aborted) throw fail('cancelled');
      const fetchFn = boundedOAuthFetch(deps.fetch, signal);
      let raw: OAuthTokens;
      try {
        raw = await refreshAuthorization(grant.issuer, { metadata: grant.authorizationServer, clientInformation: grant.client, refreshToken, resource: grant.resource, addClientAuthentication: tokenClientAuthentication(grant.client, grant.authorizationServer), fetchFn });
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
