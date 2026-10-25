// P3-HD M4a: the types of the toy OAuth fixture's request logic (./connector-oauth-core.mjs), for the scenes' support
// (./connector-oauth.ts) and its tests.

export type OAuthPhase = 'open' | 'oauth';

// The scene's control file, read on every request; anything absent or invalid is OPEN_CONTROL.
export interface OAuthControl {
  readonly seq: number; // bumped by each write, so log entries name the phase window they fell in
  readonly phase: OAuthPhase;
  readonly accessTtlSeconds: number; // 1..86400, stamped on each access token as it is issued
  readonly revocation: 'available' | 'unavailable'; // unavailable: the revocation endpoint answers 503
  // P3-HD panel correction: in the OAuth phase, what the fixture advertises instead of its own (127.0.0.1 URLs only)
  readonly advertise?: OAuthAdvertise;
}
export interface OAuthAdvertise {
  readonly resource?: string; // protected-resource metadata's `resource`
  readonly authorizationServer?: string; // its one `authorization_servers` entry
  readonly issuer?: string; // the metadata's `issuer`, then also served as OpenID discovery metadata
}
export const OPEN_CONTROL: OAuthControl;
export function parseOAuthControl(text: string | null): OAuthControl;

export const OAUTH_SCOPE: 'series:read';
export const CODE_TTL_MS: number;
// A token's safe identity in logs: the first 16 hex digits of its SHA-256.
export function tokenHash(value: string): string;

export type OAuthRoute = 'mcp' | 'resourceMetadata' | 'serverMetadata' | 'register' | 'authorize' | 'token' | 'revoke' | 'other';
export type BearerState = 'none' | 'malformed' | 'unknown' | 'revoked' | 'superseded' | 'expired' | 'valid';
export interface OAuthTokenRef {
  readonly family: number; // one per code exchange: the grant
  readonly generation: number; // 1 at the exchange, +1 per refresh
  readonly hash: string;
}

// One request, as logged: never a query string, state, code, verifier, challenge or token value.
export interface OAuthLogEntry {
  server: string;
  event: 'http';
  phase: OAuthPhase;
  seq: number;
  route: OAuthRoute;
  httpMethod: string;
  path: string;
  status: number;
  advertised: boolean; // the answer advertised authorization: a 401 or a metadata document
  method: string | null; // the JSON-RPC method of an MCP request
  tool?: string;
  arguments?: Record<string, unknown>;
  bearer: BearerState; // what an MCP request presented
  bearerHash?: string; // the hash of a presented Bearer value, issued here or not
  token?: OAuthTokenRef;
  client?: number; // the registered client's ordinal
  grant?: 'authorization_code' | 'refresh_token';
  issued?: { family: number; generation: number; access: string; refresh: string };
  revoked?: { family: number };
  error?: string; // the fixture's closed reason for a refusal
}

export type OAuthSecretKind = 'state' | 'codeChallenge' | 'code' | 'codeVerifier' | 'accessToken' | 'refreshToken';
export interface OAuthSecret {
  kind: OAuthSecretKind;
  value: string;
}

export interface FixtureRequest {
  method: string;
  url: string; // the request target: path and query
  headers: Readonly<Record<string, string | undefined>>; // lower-case names
  body: string;
}
export interface FixtureResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface OAuthFixtureCore {
  handle(request: FixtureRequest, control: OAuthControl): { response: FixtureResponse; entry: OAuthLogEntry; secrets: OAuthSecret[] };
}
// mode: 'maws' (the default) registers exact `http://127.0.0.1:<port>/<path>` callbacks; 'engine' (P4-AGG M1) the engine's
// own, `http://localhost:<port>/callback` and `http://127.0.0.1:<port>/callback`.
export type OAuthFixtureMode = 'maws' | 'engine';
export function createOAuthFixtureCore(options: { id: string; origin: string; tools?: readonly string[]; mode?: OAuthFixtureMode; now: () => number; randomToken: () => string }): OAuthFixtureCore;
