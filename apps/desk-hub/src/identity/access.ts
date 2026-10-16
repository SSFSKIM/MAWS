// Cloudflare Access's assertion (`Cf-Access-Jwt-Assertion`), verified on every request before anything behind the
// Worker sees it: RS256 against the team's certificate endpoint, the application's audience, the team's issuer, and
// the time window. A person is named by email; a service token by its client id, the assertion's `common_name`. Who
// they are to the hub — a member, an enrolled machine, or no one — is the Registry's answer, not this module's.
// Locally, a stand-in for Access signs with a test key from a stub endpoint; the same code verifies both.
import { base64urlDecode } from '../protocol/base64url';

export type AccessIdentity = { kind: 'human'; email: string; sub: string } | { kind: 'service'; clientId: string };

export type AccessFailure =
  | 'missing'
  | 'malformed'
  | 'algorithm'
  | 'unknown-key'
  | 'signature'
  | 'audience'
  | 'issuer'
  | 'expired'
  | 'not-yet-valid'
  | 'identity';

export class AccessError extends Error {
  constructor(readonly reason: AccessFailure) {
    super(`access assertion refused: ${reason}`);
    this.name = 'AccessError';
  }
}

export interface KeySource {
  key(kid: string): Promise<CryptoKey | undefined>;
}

export interface AccessVerifierConfig {
  /** `https://<team>.cloudflareaccess.com`, the assertion's `iss`. */
  issuer: string;
  /** The Access application's AUD tag. */
  audience: string;
  keys: KeySource;
  now?: () => number;
}

type Jwks = { keys?: Array<JsonWebKey & { kid?: string }> };

/**
 * The team's signing keys from its certificate endpoint (`<team>/cdn-cgi/access/certs`), cached; a key id it does not
 * hold makes it fetch again (Access rotates keys), at most once per `minRefreshMs`.
 */
export function certsKeySource(
  fetchCerts: () => Promise<unknown>,
  { minRefreshMs = 30_000, maxAgeMs = 3_600_000, now = Date.now }: { minRefreshMs?: number; maxAgeMs?: number; now?: () => number } = {},
): KeySource {
  let keys = new Map<string, CryptoKey>();
  let fetchedAt = -Infinity;
  let inflight: Promise<void> | undefined;

  const refresh = () =>
    (inflight ??= (async () => {
      try {
        const body = (await fetchCerts()) as Jwks;
        const next = new Map<string, CryptoKey>();
        for (const jwk of body.keys ?? []) {
          if (typeof jwk.kid !== 'string' || jwk.kty !== 'RSA') continue;
          const { kid, ...material } = jwk;
          next.set(kid, await crypto.subtle.importKey('jwk', material, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
        }
        keys = next;
        fetchedAt = now();
      } finally {
        inflight = undefined;
      }
    })());

  return {
    async key(kid) {
      const age = now() - fetchedAt;
      if (age > maxAgeMs || (!keys.has(kid) && age > minRefreshMs)) await refresh();
      return keys.get(kid);
    },
  };
}

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

function decodeJson(segment: string): Record<string, unknown> {
  const value = JSON.parse(decoder.decode(base64urlDecode(segment)));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('not an object');
  return value as Record<string, unknown>;
}

export async function verifyAccessAssertion(token: string | null | undefined, config: AccessVerifierConfig): Promise<AccessIdentity> {
  if (!token) throw new AccessError('missing');
  const segments = token.split('.');
  if (segments.length !== 3) throw new AccessError('malformed');
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  let signature: Uint8Array<ArrayBuffer>;
  try {
    header = decodeJson(segments[0]);
    claims = decodeJson(segments[1]);
    signature = base64urlDecode(segments[2]);
  } catch {
    throw new AccessError('malformed');
  }
  if (header.alg !== 'RS256') throw new AccessError('algorithm');
  if (typeof header.kid !== 'string') throw new AccessError('malformed');
  const key = await config.keys.key(header.kid);
  if (!key) throw new AccessError('unknown-key');
  const signed = new TextEncoder().encode(`${segments[0]}.${segments[1]}`);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signed))) throw new AccessError('signature');

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(config.audience)) throw new AccessError('audience');
  if (claims.iss !== config.issuer) throw new AccessError('issuer');
  const seconds = (config.now ?? Date.now)() / 1000;
  if (typeof claims.exp !== 'number' || claims.exp <= seconds) throw new AccessError('expired');
  if (typeof claims.nbf === 'number' && claims.nbf > seconds) throw new AccessError('not-yet-valid');

  if (typeof claims.common_name === 'string' && claims.common_name !== '') return { kind: 'service', clientId: claims.common_name };
  if (typeof claims.email === 'string' && claims.email !== '' && typeof claims.sub === 'string' && claims.sub !== '') {
    return { kind: 'human', email: claims.email, sub: claims.sub };
  }
  throw new AccessError('identity');
}
