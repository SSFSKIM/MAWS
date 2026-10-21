// The local stand-in for Cloudflare Access and its service-token API (the DC3 plan's M2): what Access and Cloudflare do
// for the hub, done locally so the same Worker code runs here and deployed. It
//   - signs the assertion Access adds (`Cf-Access-Jwt-Assertion`, RS256) for a test identity or a service token it
//     minted, and serves the certificate endpoint the Worker verifies it against;
//   - answers Cloudflare's service-token API (create, list, delete) for the Worker's enrollment;
//   - lets the enrollment-redeem path through with no assertion, as Access's Bypass policy will;
//   - refuses a service token it does not hold as production Access does (401 and a page naming Cloudflare Access, the
//     deploy probe's A4), so a machine reads a dead credential here as it will deployed.
// It runs in Node (the local command's proxy, the suites), on WebCrypto and the Fetch API. Written so Node can run it
// with its own type stripping: no TypeScript-only runtime syntax, and no import of the Worker's modules.
import { createHash, randomBytes, randomUUID, webcrypto } from 'node:crypto';

/** The path Access does not guard: the one-time token, or a provisioning key's secret, guards it (DX7). */
export const REDEEM_PATH = '/machine/enroll';
/** The stand-in's own paths; everything else is the hub's. */
export const STANDIN_PREFIX = '/standin/';
export const IDENTITY_COOKIE = 'desk_standin_user';
/** A test client's way to name its person without a cookie (a browser signs in at /standin/login instead). */
export const IDENTITY_HEADER = 'x-desk-standin-user';

export type ServiceToken = {
  id: string;
  client_id: string;
  client_secret: string;
  name: string;
  duration: string;
  created_at: string;
};

export type StandinState = { kid: string; privateJwk: JsonWebKey; publicJwk: JsonWebKey; apiToken: string; tokens: ServiceToken[] };

export type StandinOptions = {
  /** The assertion's `iss`; the Worker's `ACCESS_ISSUER`. */
  issuer: string;
  /** The Access application's AUD; the Worker's `ACCESS_AUD`. */
  audience: string;
  /** The account id in the API's paths; the Worker's `CF_ACCOUNT_ID`. */
  account: string;
  /** Whom a request with no other identity is signed in as; none means such a request is refused, as Access does. */
  defaultUser?: string;
  /** A state to resume (the local command keeps one across restarts, so enrolled machines stay enrolled). */
  state?: StandinState;
  /** Called with the whole state after every change. */
  persist?: (state: StandinState) => void;
};

/** A refusal is answered with `body` as `contentType`. */
export type Admission = { kind: 'bypass' } | { kind: 'assert'; assertion: string } | { kind: 'refuse'; status: number; contentType: string; body: string };

/** Access's answer to a service token it does not hold (`service_auth_401_redirect`): 401 with its own HTML page, which
 * names Cloudflare Access. A machine tells it from the Worker's JSON refusals by that mark. */
const SERVICE_TOKEN_REFUSED: Admission = {
  kind: 'refuse',
  status: 401,
  contentType: 'text/html; charset=utf-8',
  body: '<!DOCTYPE html><html><head><title>Unauthorized · Cloudflare Access</title></head><body><h1>Unauthorized</h1><p>Cloudflare Access did not admit this request: the service token is not one it holds. (The local stand-in for Access, answering as Access does.)</p></body></html>',
};

type Headers = Record<string, string | string[] | undefined>;

const subtle = webcrypto.subtle;
const RSA = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;
const b64url = (bytes: Uint8Array | string) => Buffer.from(bytes).toString('base64url');
const header = (headers: Headers, name: string) => {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
};

function cookie(headers: Headers, name: string): string | undefined {
  for (const part of (header(headers, 'cookie') ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

/** A token as Cloudflare lists it: its secret is returned at creation only. */
function withoutSecret(token: ServiceToken): Omit<ServiceToken, 'client_secret'> {
  const out: Partial<ServiceToken> = { ...token };
  delete out.client_secret;
  return out as Omit<ServiceToken, 'client_secret'>;
}

/** DX7's enrollment code as the browser builds it (`smns-enroll-v1.` + base64url of the JSON), for the local command's
 * helper; written here without the protocol module, which Node's type stripping cannot load (extensionless imports). */
export function enrollmentCode(code: { hub: string; org: string; token: string; machine: string; key: string }): string {
  const { hub, org, token, machine, key } = code;
  return `smns-enroll-v1.${Buffer.from(JSON.stringify({ hub, org, token, machine, key })).toString('base64url')}`;
}

/** A provisioning key's code as the browser builds it (`smns-provision-v1.` + base64url of the JSON), likewise. */
export function provisioningCode(code: { hub: string; org: string; token: string; prefix: string; key: string }): string {
  const { hub, org, token, prefix, key } = code;
  return `smns-provision-v1.${Buffer.from(JSON.stringify({ hub, org, token, prefix, key })).toString('base64url')}`;
}

/** Cloudflare's v4 envelope; on an error, `result` is the message (the stand-in's error codes are its own). */
const envelope = (status: number, result: unknown, extra: object = {}) =>
  Response.json(
    { success: status < 400, errors: status < 400 ? [] : [{ code: 10000, message: String(result) }], messages: [], result: status < 400 ? result : null, ...extra },
    { status },
  );

export class AccessStandin {
  readonly issuer: string;
  readonly audience: string;
  readonly account: string;
  readonly defaultUser: string | undefined;
  private readonly state: StandinState;
  private readonly key: webcrypto.CryptoKey;
  private readonly persist: ((state: StandinState) => void) | undefined;

  private constructor(options: StandinOptions, state: StandinState, key: webcrypto.CryptoKey) {
    this.issuer = options.issuer;
    this.audience = options.audience;
    this.account = options.account;
    this.defaultUser = options.defaultUser;
    this.persist = options.persist;
    this.state = state;
    this.key = key;
  }

  static async create(options: StandinOptions): Promise<AccessStandin> {
    let state = options.state;
    if (!state) {
      const pair = (await subtle.generateKey({ ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify'])) as webcrypto.CryptoKeyPair;
      const kid = `standin-${randomBytes(6).toString('hex')}`;
      state = {
        kid,
        privateJwk: await subtle.exportKey('jwk', pair.privateKey),
        publicJwk: { ...(await subtle.exportKey('jwk', pair.publicKey)), kid, alg: 'RS256', use: 'sig' } as JsonWebKey,
        apiToken: randomBytes(24).toString('base64url'),
        tokens: [],
      };
    }
    const key = await subtle.importKey('jwk', state.privateJwk, RSA, false, ['sign']);
    const standin = new AccessStandin(options, state, key);
    if (!options.state) standin.save();
    return standin;
  }

  /** The bearer token the Worker presents to the service-token API (`CF_API_TOKEN`). */
  get apiToken(): string {
    return this.state.apiToken;
  }

  /** The service tokens minted and not deleted. */
  tokens(): readonly ServiceToken[] {
    return this.state.tokens;
  }

  /** An assertion as Access signs it, valid ten minutes. */
  async sign(claims: Record<string, unknown>): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: 'RS256', kid: this.state.kid, typ: 'JWT' }));
    const body = b64url(JSON.stringify({ aud: [this.audience], iss: this.issuer, iat: now, nbf: now, exp: now + 600, type: 'app', ...claims }));
    const signature = await subtle.sign(RSA, this.key, new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${b64url(new Uint8Array(signature))}`;
  }

  /** A person's assertion: `email`, and a `sub` stable for that email, as Access gives. */
  person(email: string): Promise<string> {
    const sub = createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 32);
    return this.sign({ email, sub, identity_nonce: 'standin', country: 'XX' });
  }

  /** What Access would do with a request for `path` carrying `headers`: let it through bare, sign it, or refuse it. */
  async admit(path: string, headers: Headers): Promise<Admission> {
    if (path === REDEEM_PATH) return { kind: 'bypass' };
    const clientId = header(headers, 'cf-access-client-id');
    const secret = header(headers, 'cf-access-client-secret');
    if (clientId !== undefined || secret !== undefined) {
      const token = this.state.tokens.find((t) => t.client_id === clientId);
      if (!token || token.client_secret !== secret) return SERVICE_TOKEN_REFUSED;
      // Access puts a service token's client id in `common_name`; its `sub` is empty.
      return { kind: 'assert', assertion: await this.sign({ common_name: token.client_id, sub: '' }) };
    }
    const user = header(headers, IDENTITY_HEADER) ?? cookie(headers, IDENTITY_COOKIE) ?? this.defaultUser;
    if (user) return { kind: 'assert', assertion: await this.person(user) };
    // Production sends a person to the team's login (302); the local runtime has no login page, so it says how to sign in.
    return { kind: 'refuse', status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'access-denied', message: `sign in first: GET ${STANDIN_PREFIX}login?email=<address>` }) };
  }

  /** Answers the stand-in's own paths (under /standin/); null for any other path. */
  async handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(STANDIN_PREFIX)) return null;
    const path = url.pathname.slice(STANDIN_PREFIX.length - 1);
    if (path === '/certs' && request.method === 'GET') return Response.json({ keys: [this.state.publicJwk] });
    if (path === '/login' && request.method === 'GET') {
      const email = url.searchParams.get('email');
      if (!email) return Response.json({ error: 'bad-shape', message: 'GET /standin/login?email=<address>' }, { status: 400 });
      return new Response(null, {
        status: 302,
        headers: { Location: url.searchParams.get('redirect') ?? '/', 'Set-Cookie': `${IDENTITY_COOKIE}=${encodeURIComponent(email)}; Path=/; HttpOnly; SameSite=Lax` },
      });
    }
    if (path === '/logout' && request.method === 'GET') {
      return new Response(null, { status: 302, headers: { Location: '/', 'Set-Cookie': `${IDENTITY_COOKIE}=; Path=/; Max-Age=0` } });
    }
    const api = /^\/client\/v4\/accounts\/([^/]+)\/access\/service_tokens(?:\/([^/]+))?$/.exec(path);
    if (api) return this.api(request, decodeURIComponent(api[1]), api[2] && decodeURIComponent(api[2]), url);
    return Response.json({ error: 'not-found' }, { status: 404 });
  }

  /** Cloudflare's service-token API, as its documentation gives it (create, list by name, delete by token id). */
  private async api(request: Request, account: string, id: string | undefined, url: URL): Promise<Response> {
    if (request.headers.get('authorization') !== `Bearer ${this.state.apiToken}`) return envelope(403, 'Authentication error');
    if (account !== this.account) return envelope(404, 'no such account');
    if (!id && request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as { name?: unknown; duration?: unknown } | null;
      if (!body || typeof body.name !== 'string' || body.name === '') return envelope(400, 'name is required');
      const token: ServiceToken = {
        id: randomUUID(),
        client_id: `${randomBytes(16).toString('hex')}.access`,
        client_secret: randomBytes(32).toString('hex'),
        name: body.name,
        duration: typeof body.duration === 'string' ? body.duration : '8760h',
        created_at: new Date().toISOString(),
      };
      this.state.tokens.push(token);
      this.save();
      return envelope(200, token);
    }
    if (!id && request.method === 'GET') {
      const name = url.searchParams.get('name');
      const found = this.state.tokens.filter((t) => name === null || t.name === name).map(withoutSecret);
      return envelope(200, found, { result_info: { page: 1, per_page: found.length, count: found.length, total_count: this.state.tokens.length } });
    }
    if (id && request.method === 'DELETE') {
      const index = this.state.tokens.findIndex((t) => t.id === id);
      if (index < 0) return envelope(404, 'service token not found');
      const [deleted] = this.state.tokens.splice(index, 1);
      this.save();
      return envelope(200, withoutSecret(deleted));
    }
    return envelope(405, 'method not allowed');
  }

  private save(): void {
    this.persist?.(this.state);
  }
}
