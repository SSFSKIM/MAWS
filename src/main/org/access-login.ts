// The hub credential and how the app gets one (P5 O8 M1, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md,
// "The Access login transfer" and Interfaces §E). In production it is Cloudflare Access's app token for the hub, got by
// the transfer `cloudflared access login` uses (P5 Decision Log 38): the hub's signed metadata names the Access
// application, the system browser signs the person in, and the token comes back sealed to a key pair made for this
// login, through Cloudflare's transfer service. The app keeps the app token and drops the org token, which would admit
// the person to every Access application of the team. A development build against the suites' local hub uses the
// stand-in's identity header instead, and opens no browser.
//
// Nothing here logs, prints or puts in an error a token, a nonce, a key or the payload; a log line names the hub's host
// and statuses. Electron-free: the browser opener is injected from src/main/index.ts.
import { webcrypto } from 'node:crypto';
import nacl from 'tweetnacl';
import { isHubOrigin } from '../../../apps/org-protocol/src/index.ts';
import { orgTiming, type OrgTiming } from './timing';

export type HubCredential =
  /** `expires`: ISO, from the token's JWT `exp`, read and not verified (the app only schedules by it). */
  | { kind: 'access'; token: string; expires: string; email: string | null }
  | { kind: 'standin'; user: string };

export type AccessLogin = (hub: string, options: { signal: AbortSignal }) => Promise<HubCredential>;

// The suites' stand-in for Access admits this header (apps/desk-hub/local/standin.ts), as O7's development session sends it.
import { STANDIN_HEADER } from './dev-session';
export { STANDIN_HEADER };

export const TRANSFER_STORE = 'https://login.cloudflareaccess.org/';

export class AccessLoginError extends Error {
  constructor(
    readonly reason: 'metadata' | 'browser' | 'transfer' | 'payload' | 'timeout' | 'cancelled',
    message: string,
  ) {
    super(message);
    this.name = 'AccessLoginError';
  }
}

/** What an authenticated member's request to the hub carries. */
export function hubHeaders(credential: HubCredential): Record<string, string> {
  return credential.kind === 'access' ? { 'cf-access-token': credential.token } : { [STANDIN_HEADER]: credential.user };
}

/**
 * How a pairing code's hub is admitted: 'access' for an https: origin; 'standin' (with the user) for a loopback
 * http://127.0.0.1:<port> origin only when the build is unpackaged and MAWS_DEV_STANDIN_USER is non-empty; null
 * otherwise (the caller refuses 'bad-code').
 */
export function hubAdmission(hub: string, input: { packaged: boolean; env: NodeJS.ProcessEnv }): { kind: 'access' } | { kind: 'standin'; user: string } | null {
  if (!isHubOrigin(hub)) return null;
  const url = new URL(hub);
  if (url.protocol === 'https:') return { kind: 'access' };
  const user = input.env.MAWS_DEV_STANDIN_USER;
  if (url.hostname === '127.0.0.1' && url.port !== '' && !input.packaged && typeof user === 'string' && user !== '') return { kind: 'standin', user };
  return null;
}

/** The stand-in's login: the identity it was given, with no browser and no request. */
export function standinLogin(user: string): AccessLogin {
  return async (_hub, { signal }) => {
    if (signal.aborted) throw new AccessLoginError('cancelled', 'the login was cancelled');
    return { kind: 'standin', user };
  };
}

/** The token's JWT payload claims, decoded and NOT verified (the app only schedules by them); null when it isn't a JWT. */
export function tokenClaims(token: string): { exp: number | null; email: string | null } | null {
  const payload = decodeJwt(token)?.payload;
  if (!payload) return null;
  return {
    exp: typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp : null,
    email: typeof payload.email === 'string' && payload.email !== '' ? payload.email : null,
  };
}

type Deps = {
  openExternal(url: string): boolean;
  fetch?: typeof fetch;
  /** The transfer service, ending in a slash. */
  store?: string;
  /** Where `auth_domain`'s certs are served (the tests' local server); default `https://<auth_domain's host>`. */
  certsOrigin?(authDomain: string): string;
  now?(): number;
  timing?: Partial<OrgTiming>;
  log(line: string): void;
};

/** Thrown inside a bounded step when its own bound (not the login's) elapsed. */
class StepElapsed extends Error {}

export function cloudflareLoginTransfer(deps: Deps): AccessLogin {
  const doFetch = deps.fetch ?? fetch;
  const store = deps.store ?? TRANSFER_STORE;
  const certsOrigin = deps.certsOrigin ?? defaultCertsOrigin;
  const now = deps.now ?? Date.now;
  const timing = orgTiming(deps.timing);

  return async (hub, { signal }) => {
    const deadline = now() + timing.LOGIN_WAIT_MS;
    const hubUrl = new URL(hub);
    const host = hubUrl.host;
    const fail = (reason: AccessLoginError['reason'], message: string): never => {
      deps.log(`access login: ${host}: ${reason}: ${message}`);
      throw new AccessLoginError(reason, message);
    };

    // One step bounded by `limit` and by what is left of the login; the caller's signal stops it at once.
    const bounded = async <T>(limit: number, run: (stepSignal: AbortSignal) => Promise<T>): Promise<T> => {
      if (signal.aborted) return fail('cancelled', 'the login was cancelled');
      const left = deadline - now();
      if (left <= 0) return fail('timeout', 'the login was not finished in time');
      const byDeadline = left <= limit;
      const timer = new AbortController();
      const handle = setTimeout(() => timer.abort(), Math.min(limit, left));
      try {
        return await run(AbortSignal.any([signal, timer.signal]));
      } catch (error) {
        if (signal.aborted) return fail('cancelled', 'the login was cancelled');
        if (timer.signal.aborted) {
          if (byDeadline) return fail('timeout', 'the login was not finished in time');
          throw new StepElapsed();
        }
        throw error;
      } finally {
        clearTimeout(handle);
      }
    };
    const wait = (ms: number) =>
      bounded(ms, (stepSignal) => new Promise<never>((_, reject) => stepSignal.addEventListener('abort', () => reject(new StepElapsed()), { once: true }))).catch(
        (error: unknown) => {
          if (!(error instanceof StepElapsed)) throw error;
        },
      );

    // 1. Discover: the hub's signed metadata names the Access application.
    const metadataStep = async <T>(what: string, run: (stepSignal: AbortSignal) => Promise<T>): Promise<T> => {
      try {
        return await bounded(timing.FETCH_TIMEOUT_MS, run);
      } catch (error) {
        if (error instanceof AccessLoginError) throw error;
        return fail('metadata', error instanceof StepElapsed ? `${what} timed out` : `${what} failed`);
      }
    };
    const metadataJwt = await metadataStep('the metadata request', async (stepSignal) => {
      const answer = await doFetch(hub, { method: 'HEAD', redirect: 'manual', headers: { 'cf-access-metadata-request': 'true' }, signal: stepSignal });
      return answer.headers.get('cf-access-metadata');
    });
    if (!metadataJwt) return fail('metadata', 'the hub answered with no Access metadata');
    const decoded = decodeJwt(metadataJwt);
    if (!decoded) return fail('metadata', 'the Access metadata is not a JWT');
    const authDomain = decoded.payload.auth_domain;
    if (typeof authDomain !== 'string' || authDomain === '') return fail('metadata', 'the Access metadata names no auth domain');
    let certsUrl: URL;
    try {
      certsUrl = new URL('/cdn-cgi/access/certs', certsOrigin(authDomain));
    } catch {
      return fail('metadata', 'the Access metadata names an unusable auth domain');
    }
    const jwks = await metadataStep('the certs request', async (stepSignal) => {
      const answer = await doFetch(certsUrl, { redirect: 'error', signal: stepSignal });
      if (answer.status !== 200) throw new Error(`status ${answer.status}`);
      return (await answer.json()) as unknown;
    });
    const key = await importPublishedKey(jwks, decoded.header.kid);
    if (!key) return fail('metadata', 'the Access metadata is signed by a key the team does not publish');
    if (decoded.header.alg !== 'RS256' || !(await webcrypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decoded.signature, decoded.signingInput))) {
      return fail('metadata', 'the Access metadata signature does not verify');
    }
    const { hostname, type, aud } = decoded.payload;
    if (typeof hostname !== 'string' || hostname.toLowerCase() !== hubUrl.hostname.toLowerCase()) return fail('metadata', 'the Access metadata names another host');
    if (type !== 'match') return fail('metadata', 'the Access metadata is not a match');
    if (typeof aud !== 'string' || aud === '') return fail('metadata', 'the Access metadata names no application');
    deps.log(`access login: ${host}: metadata verified`);

    // 2. Seal: a key pair for this login alone; its public key, base64url with padding (Go's URLEncoding), names the transfer.
    const pair = nacl.box.keyPair.fromSecretKey(webcrypto.getRandomValues(new Uint8Array(nacl.box.secretKeyLength)));
    try {
      const id = Buffer.from(pair.publicKey).toString('base64').replaceAll('+', '-').replaceAll('/', '_');

      // 3. The browser, at the hub's Access CLI page, the query in key order (as Go's url.Values encodes it).
      const redirect = `${hubUrl.protocol}//${hubUrl.host}?${new URLSearchParams([
        ['aud', aud],
        ['token', id],
      ]).toString()}`;
      const query = new URLSearchParams([
        ['aud', aud],
        ['close_interstitial', 'true'],
        ['edge_token_transfer', 'true'],
        ['redirect_url', redirect],
        ['send_org_token', 'true'],
        ['token', id],
      ]);
      if (signal.aborted) return fail('cancelled', 'the login was cancelled');
      if (!deps.openExternal(`https://${hubUrl.host}/cdn-cgi/access/cli?${query.toString()}`)) return fail('browser', 'the browser did not open');
      deps.log(`access login: ${host}: browser opened, waiting for the transfer`);

      // 4. Long-poll the transfer service until the sealed payload is there.
      const transferUrl = new URL(`transfer/${id}`, store);
      type Poll = { ready: true; body: string; servicePublicKey: string | null } | { ready: false; status: number | null };
      const poll = async (): Promise<Poll> => {
        try {
          return await bounded(timing.TRANSFER_POLL_MS, async (stepSignal): Promise<Poll> => {
            const response = await doFetch(transferUrl, { redirect: 'error', signal: stepSignal });
            if (response.status === 200) return { ready: true, body: await response.text(), servicePublicKey: response.headers.get('service-public-key') };
            await response.arrayBuffer().catch(() => undefined);
            return { ready: false, status: response.status };
          });
        } catch (error) {
          if (error instanceof StepElapsed) return { ready: false, status: null }; // the long poll ran its course: ask again
          if (error instanceof AccessLoginError) throw error;
          return fail('transfer', 'the transfer service could not be reached');
        }
      };
      let answer = await poll();
      let lastStatus: number | null = null;
      while (!answer.ready) {
        if (answer.status !== null) {
          if (answer.status >= 500) return fail('transfer', `the transfer service answered ${answer.status}`);
          if (answer.status !== lastStatus) deps.log(`access login: ${host}: transfer not ready (${answer.status})`);
          lastStatus = answer.status;
          await wait(timing.TRANSFER_RETRY_MS);
        }
        answer = await poll();
      }
      const { body, servicePublicKey } = answer;
      deps.log(`access login: ${host}: transfer received`);

      // 5. Open the payload: standard base64 of nonce || box, from the service's key to this login's.
      const sealed = Buffer.from(body.trim(), 'base64');
      const serviceKey = servicePublicKey === null ? null : Buffer.from(servicePublicKey.trim(), 'base64url');
      if (!serviceKey || serviceKey.length !== nacl.box.publicKeyLength) return fail('payload', 'the transfer came without a usable service key');
      if (sealed.length < nacl.box.nonceLength + nacl.box.overheadLength) return fail('payload', 'the transfer payload is too short');
      const opened = nacl.box.open(
        sealed.subarray(nacl.box.nonceLength),
        sealed.subarray(0, nacl.box.nonceLength),
        new Uint8Array(serviceKey),
        pair.secretKey,
      );
      if (!opened) return fail('payload', 'the transfer payload does not open');
      let appToken: unknown;
      try {
        // 6. Keep the app token; the org token is never read out of the parse.
        appToken = (JSON.parse(Buffer.from(opened).toString('utf8')) as { app_token?: unknown } | null)?.app_token;
      } catch {
        return fail('payload', 'the transfer payload is not JSON');
      } finally {
        opened.fill(0);
      }
      if (typeof appToken !== 'string' || appToken === '') return fail('payload', 'the transfer payload holds no app token');
      const claims = tokenClaims(appToken);
      if (!claims || claims.exp === null) return fail('payload', 'the app token carries no expiry');
      deps.log(`access login: ${host}: signed in`);
      return { kind: 'access', token: appToken, expires: new Date(claims.exp * 1000).toISOString(), email: claims.email };
    } finally {
      pair.secretKey.fill(0);
    }
  };
}

/** `auth_domain` comes with or without a scheme; its certs are always fetched over https from its host. */
function defaultCertsOrigin(authDomain: string): string {
  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(authDomain) ? authDomain : `https://${authDomain}`);
  return `https://${url.host}`;
}

type DecodedJwt = { header: Record<string, unknown>; payload: Record<string, unknown>; signingInput: Uint8Array; signature: Uint8Array };

const B64URL = /^[A-Za-z0-9_-]+$/;

function decodeJwt(jwt: string): DecodedJwt | null {
  const parts = jwt.split('.');
  if (parts.length !== 3 || !parts.every((part) => B64URL.test(part))) return null;
  const header = parseObject(parts[0]!);
  const payload = parseObject(parts[1]!);
  if (!header || !payload) return null;
  return { header, payload, signingInput: new TextEncoder().encode(`${parts[0]}.${parts[1]}`), signature: new Uint8Array(Buffer.from(parts[2]!, 'base64url')) };
}

function parseObject(part: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The team's RSA key named `kid` in the certs endpoint's JWKS, imported for RS256; null when it publishes none. */
async function importPublishedKey(jwks: unknown, kid: unknown): Promise<webcrypto.CryptoKey | null> {
  if (typeof kid !== 'string' || typeof jwks !== 'object' || jwks === null) return null;
  const keys = (jwks as { keys?: unknown }).keys;
  if (!Array.isArray(keys)) return null;
  const jwk = keys.find((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null && (entry as { kid?: unknown }).kid === kid);
  if (!jwk || jwk.kty !== 'RSA' || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') return null;
  if (jwk.alg !== undefined && jwk.alg !== 'RS256') return null;
  try {
    return await webcrypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  } catch {
    return null;
  }
}
