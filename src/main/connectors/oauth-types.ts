// P3-HD M3a: what MAWS's own OAuth grant for one HTTP connector is (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md
// M3 and Decision Log 13/18; P3 co-work Decision Log 98 (5)). Main-only: nothing here enters the engine host, a renderer
// or a log. The flow (./oauth-flow.ts) produces a grant, the sealed store (./oauth-store.ts) keeps it under a stable
// `connectionId`; the provider (M3c) orchestrates both.
//
// Two distinct addresses: the identity's `requestUrl` is the exact URL the configuration names (the MCP request URL, a
// query included), the grant's `resource` the exact RFC 8707 indicator the protected-resource metadata advertised, sent
// verbatim on authorization, exchange and refresh. Neither is derived from the other.
import type { AuthorizationServerMetadata, OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { DirectSource } from '@shared/ipc/schema/connectors';

// The configured entry a saved grant belongs to: the exact request URL plus where it is configured. Never a cwd, a
// session, a source id, a generation or a digest (Decision Log 18): those name one observation, not the entry.
export interface ConnectorOAuthIdentity {
  readonly requestUrl: string;
  readonly server: string;
  readonly scope: 'user' | 'local' | 'app';
  readonly configPath: string;
  readonly entryPath: readonly string[];
}

export interface ConnectorOAuthTokens {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly tokenType: 'Bearer';
  readonly grantedScope?: string;
  readonly expiresAt?: number; // epoch ms, from expires_in at receipt
  readonly obtainedAt: number; // epoch ms
}

export interface ConnectorOAuthGrant {
  readonly issuer: string; // the authorization server's validated issuer identifier
  readonly resource: string; // the exact resource indicator
  readonly redirectUri: string; // the loopback redirect the client was registered with
  readonly authorizationServer: AuthorizationServerMetadata; // as verified at Connect; the only endpoints ever used
  readonly client: OAuthClientInformationFull; // the dynamic registration, its secret and expiry if returned
  readonly tokens: ConnectorOAuthTokens;
}

export interface ConnectorOAuthRecord extends ConnectorOAuthGrant {
  readonly connectionId: string;
  readonly identity: ConnectorOAuthIdentity;
  readonly savedAt: number; // epoch ms
}

// The saved identity of a verified HTTP source, or null for a stdio source (it has no OAuth).
export function oauthIdentityOf(source: Pick<DirectSource, 'server' | 'scope' | 'path' | 'entryPath' | 'resourceUrl'>): ConnectorOAuthIdentity | null {
  if (source.resourceUrl === undefined) return null;
  return { requestUrl: source.resourceUrl, server: source.server, scope: source.scope, configPath: source.path, entryPath: [...source.entryPath] };
}

// Exact comparison: no URL or path normalization, so a differently spelled entry is a different identity.
export function sameOAuthIdentity(a: ConnectorOAuthIdentity, b: ConnectorOAuthIdentity): boolean {
  return a.requestUrl === b.requestUrl && a.server === b.server && a.scope === b.scope && a.configPath === b.configPath &&
    a.entryPath.length === b.entryPath.length && a.entryPath.every((part, i) => part === b.entryPath[i]);
}
