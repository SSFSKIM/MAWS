// The Access login transfer (P5 O8 M1, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §E), against
// a local HTTP server that plays Access (the hub's HEAD with its signed metadata, the team's certs) and the transfer
// service, which seals the tokens with tweetnacl as the real one does. The hub is `https://hub.example.com`, reached
// through an injected fetch that sends its requests to the local server; the certs and the transfer service are pointed
// at it through `certsOrigin` and `store`. The browser is a recorder.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { webcrypto } from 'node:crypto';
import nacl from 'tweetnacl';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AccessLoginError, cloudflareLoginTransfer, hubAdmission, hubHeaders, standinLogin, tokenClaims, type HubCredential } from './access-login';
import type { OrgTiming } from './timing';

const HUB = 'https://hub.example.com';
const AUD = 'a3f1c0de9b7e4d2f8c6a5b4e3d2c1b0a9f8e7d6c5b4a39281706f5e4d3c2b1a0';
const TEAM = 'team.cloudflareaccess.com';
const KID = 'kid-1';
const EXP = 1_793_000_000; // 2026-10-26T...Z, any fixed second
const EMAIL = 'owner@example.com';
const FAST: Partial<OrgTiming> = { LOGIN_WAIT_MS: 5_000, TRANSFER_POLL_MS: 2_000, TRANSFER_RETRY_MS: 20, FETCH_TIMEOUT_MS: 1_000 };

const b64url = (bytes: Uint8Array | string) => Buffer.from(bytes).toString('base64url');

type RsaKey = { privateKey: webcrypto.CryptoKey; jwk: webcrypto.JsonWebKey };
async function rsaKey(): Promise<RsaKey> {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  return { privateKey: pair.privateKey, jwk: await webcrypto.subtle.exportKey('jwk', pair.publicKey) };
}

async function signJwt(payload: Record<string, unknown>, key: webcrypto.CryptoKey, header: Record<string, unknown> = { alg: 'RS256', kid: KID, typ: 'JWT' }) {
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = new Uint8Array(await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input)));
  return `${input}.${b64url(signature)}`;
}

/** A token as Access issues it, for the payload's claims only (the app never verifies it). */
const accessToken = (claims: Record<string, unknown>) => `${b64url(JSON.stringify({ alg: 'RS256', kid: KID }))}.${b64url(JSON.stringify(claims))}.${b64url('signature')}`;
const APP_TOKEN = accessToken({ aud: [AUD], email: EMAIL, exp: EXP, iat: EXP - 3600, type: 'app' });
const ORG_TOKEN = accessToken({ aud: [TEAM], email: EMAIL, exp: EXP, iat: EXP - 3600, type: 'org' });

let teamKey: RsaKey;
let strangerKey: RsaKey;
beforeAll(async () => {
  [teamKey, strangerKey] = await Promise.all([rsaKey(), rsaKey()]);
});

/** One transfer poll's answer: a status, the sealed payload, or no answer at all. */
type Step = { status: number } | { seal: Record<string, unknown> | string; servicePublicKey?: Uint8Array } | 'hang';

type Fake = {
  origin: string;
  metadata: string | null;
  jwks: unknown;
  steps: Step[];
  heads: IncomingMessage['headers'][];
  certs: number;
  transfers: string[];
  close(): Promise<void>;
};

async function fakeAccess(): Promise<Fake> {
  const fake: Omit<Fake, 'origin' | 'close'> = { metadata: null, jwks: { keys: [{ ...teamKey.jwk, kid: KID, alg: 'RS256', use: 'sig' }] }, steps: [], heads: [], certs: 0, transfers: [] };
  const handle = (req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url ?? '/', 'http://local').pathname;
    if (req.method === 'HEAD' && path === '/') {
      fake.heads.push(req.headers);
      if (fake.metadata !== null && req.headers['cf-access-metadata-request'] === 'true') res.setHeader('cf-access-metadata', fake.metadata);
      res.writeHead(302, { location: `https://${TEAM}/cdn-cgi/access/login/hub.example.com` }).end();
      return;
    }
    if (req.method === 'GET' && path === '/cdn-cgi/access/certs') {
      fake.certs += 1;
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(fake.jwks));
      return;
    }
    if (req.method === 'GET' && path.startsWith('/transfer/')) {
      const id = decodeURIComponent(path.slice('/transfer/'.length));
      fake.transfers.push(id);
      const step = fake.steps.length > 1 ? fake.steps.shift()! : fake.steps[0];
      if (step === undefined || step === 'hang') return; // held open: the client's own bound ends it
      if ('status' in step) {
        res.writeHead(step.status).end('not yet');
        return;
      }
      // The service: a fresh key pair of its own, the tokens boxed to the transfer's public key (the id).
      const service = nacl.box.keyPair();
      const nonce = nacl.randomBytes(nacl.box.nonceLength);
      const message = new TextEncoder().encode(typeof step.seal === 'string' ? step.seal : JSON.stringify(step.seal));
      const box = nacl.box(message, nonce, new Uint8Array(Buffer.from(id, 'base64url')), service.secretKey);
      res.writeHead(200, { 'service-public-key': b64url(step.servicePublicKey ?? service.publicKey) }).end(Buffer.concat([nonce, box]).toString('base64'));
      return;
    }
    res.writeHead(404).end();
  };
  const server: Server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return Object.assign(fake, {
    origin,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  });
}

const metadataClaims = (overrides: Record<string, unknown> = {}) => ({
  aud: AUD,
  auth_domain: TEAM,
  hostname: 'hub.example.com',
  type: 'match',
  iat: Math.floor(Date.now() / 1000),
  ...overrides,
});

let fake: Fake;
afterEach(async () => {
  await fake?.close();
});

/** A login against the fake: the hub's requests (and any other https origin's) go to the local server. */
function harness(options: { timing?: Partial<OrgTiming>; opens?: boolean; certsOrigin?: false } = {}) {
  const opened: string[] = [];
  const lines: string[] = [];
  const certsAsked: string[] = [];
  const login = cloudflareLoginTransfer({
    openExternal: (url) => {
      opened.push(url);
      return options.opens ?? true;
    },
    fetch: (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      return fetch(url.protocol === 'https:' ? `${fake.origin}${url.pathname}${url.search}` : url, init);
    },
    store: `${fake.origin}/`,
    ...(options.certsOrigin === false
      ? {}
      : {
          certsOrigin: (authDomain: string) => {
            certsAsked.push(authDomain);
            return fake.origin;
          },
        }),
    timing: { ...FAST, ...options.timing },
    log: (line) => lines.push(line),
  });
  return { login, opened, lines, certsAsked };
}

async function refusal(promise: Promise<unknown>): Promise<AccessLoginError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AccessLoginError);
  return error as AccessLoginError;
}

const signal = () => new AbortController().signal;

describe('the Access login transfer', () => {
  it('keeps the app token with its exp and email, drops the org token, and logs no secret', async () => {
    fake = await fakeAccess();
    fake.metadata = await signJwt(metadataClaims(), teamKey.privateKey);
    fake.steps = [{ seal: { app_token: APP_TOKEN, org_token: ORG_TOKEN } }];
    const { login, opened, lines, certsAsked } = harness();

    const credential = await login(HUB, { signal: signal() });

    expect(credential).toEqual({ kind: 'access', token: APP_TOKEN, expires: new Date(EXP * 1000).toISOString(), email: EMAIL });
    expect(JSON.stringify(credential)).not.toContain(ORG_TOKEN);
    expect(fake.heads).toHaveLength(1);
    expect(fake.heads[0]!['cf-access-metadata-request']).toBe('true');
    expect(certsAsked).toEqual([TEAM]);
    expect(opened).toHaveLength(1);
    const id = new URL(opened[0]!).searchParams.get('token')!;
    expect(fake.transfers).toEqual([id]);
    const logged = lines.join('\n');
    for (const secret of [APP_TOKEN, ORG_TOKEN, id, fake.metadata]) expect(logged).not.toContain(secret);
    expect(logged).toContain('hub.example.com');
  });

  it('opens the browser at the hub’s Access CLI page with every parameter exactly, in key order', async () => {
    fake = await fakeAccess();
    fake.metadata = await signJwt(metadataClaims(), teamKey.privateKey);
    fake.steps = [{ seal: { app_token: APP_TOKEN, org_token: ORG_TOKEN } }];
    const { login, opened } = harness();
    await login(HUB, { signal: signal() });

    const url = new URL(opened[0]!);
    expect(`${url.origin}${url.pathname}`).toBe('https://hub.example.com/cdn-cgi/access/cli');
    const id = url.searchParams.get('token')!;
    // The transfer id: the login's public key in base64url with padding (Go's base64.URLEncoding).
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}=$/);
    expect(Buffer.from(id, 'base64url')).toHaveLength(nacl.box.publicKeyLength);
    expect([...url.searchParams.keys()]).toEqual(['aud', 'close_interstitial', 'edge_token_transfer', 'redirect_url', 'send_org_token', 'token']);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      aud: AUD,
      close_interstitial: 'true',
      edge_token_transfer: 'true',
      redirect_url: `https://hub.example.com?aud=${AUD}&token=${id.replace('=', '%3D')}`,
      send_org_token: 'true',
      token: id,
    });
    // The bytes, as Go's url.Values.Encode writes them: the redirect's own query escaped once more.
    const escapedId = id.replace('=', '%3D');
    expect(url.search).toBe(
      `?aud=${AUD}&close_interstitial=true&edge_token_transfer=true&redirect_url=${encodeURIComponent(`https://hub.example.com?aud=${AUD}&token=${escapedId}`)}&send_org_token=true&token=${escapedId}`,
    );
  });

  describe('the metadata', () => {
    it('is verified against the published JWKS, with the hostname compared case-insensitively', async () => {
      fake = await fakeAccess();
      fake.metadata = await signJwt(metadataClaims({ hostname: 'HUB.Example.COM' }), teamKey.privateKey);
      fake.steps = [{ seal: { app_token: APP_TOKEN, org_token: ORG_TOKEN } }];
      const { login } = harness();
      await expect(login(HUB, { signal: signal() })).resolves.toMatchObject({ kind: 'access' });
      expect(fake.certs).toBe(1);
    });

    it('fetches the certs over https from auth_domain’s host, with or without a scheme', async () => {
      for (const authDomain of [TEAM, `https://${TEAM}`]) {
        fake = await fakeAccess();
        fake.metadata = await signJwt(metadataClaims({ auth_domain: authDomain }), teamKey.privateKey);
        fake.steps = [{ seal: { app_token: APP_TOKEN, org_token: ORG_TOKEN } }];
        const { login } = harness({ certsOrigin: false });
        await expect(login(HUB, { signal: signal() })).resolves.toMatchObject({ kind: 'access' });
        expect(fake.certs).toBe(1);
        await fake.close();
      }
    });

    const refused: [string, (fake: Fake) => Promise<void>][] = [
      ['no metadata header', async () => {}],
      ['a bad signature', async (f) => void (f.metadata = await signJwt(metadataClaims(), strangerKey.privateKey))],
      ['a key the team does not publish', async (f) => void (f.metadata = await signJwt(metadataClaims(), teamKey.privateKey, { alg: 'RS256', kid: 'kid-2' }))],
      ['another algorithm', async (f) => void (f.metadata = await signJwt(metadataClaims(), teamKey.privateKey, { alg: 'RS512', kid: KID }))],
      ['a tampered payload', async (f) => {
        const [header, , signature] = (await signJwt(metadataClaims(), teamKey.privateKey)).split('.');
        f.metadata = `${header}.${b64url(JSON.stringify(metadataClaims({ aud: 'another-app' })))}.${signature}`;
      }],
      ['another hostname', async (f) => void (f.metadata = await signJwt(metadataClaims({ hostname: 'evil.example.com' }), teamKey.privateKey))],
      ['a type other than match', async (f) => void (f.metadata = await signJwt(metadataClaims({ type: 'mismatch' }), teamKey.privateKey))],
      ['no aud', async (f) => void (f.metadata = await signJwt(metadataClaims({ aud: undefined }), teamKey.privateKey))],
      ['not a JWT', async (f) => void (f.metadata = 'not-a-jwt')],
      ['certs that are not a JWKS', async (f) => {
        f.metadata = await signJwt(metadataClaims(), teamKey.privateKey);
        f.jwks = { keys: 'none' };
      }],
    ];
    for (const [name, arrange] of refused) {
      it(`refuses ${name}, and opens nothing`, async () => {
        fake = await fakeAccess();
        await arrange(fake);
        const { login, opened } = harness();
        expect((await refusal(login(HUB, { signal: signal() }))).reason).toBe('metadata');
        expect(opened).toEqual([]);
        expect(fake.transfers).toEqual([]);
      });
    }
  });

  describe('the long poll', () => {
    const ready = async () => {
      fake = await fakeAccess();
      fake.metadata = await signJwt(metadataClaims(), teamKey.privateKey);
    };

    it('waits after an answer below 500 that is not 200, and polls again', async () => {
      await ready();
      fake.steps = [{ status: 404 }, { status: 401 }, { status: 404 }, { seal: { app_token: APP_TOKEN, org_token: ORG_TOKEN } }];
      const { login } = harness({ timing: { TRANSFER_RETRY_MS: 60 } });
      const started = Date.now();
      await expect(login(HUB, { signal: signal() })).resolves.toMatchObject({ kind: 'access', token: APP_TOKEN });
      expect(fake.transfers).toHaveLength(4);
      expect(Date.now() - started).toBeGreaterThanOrEqual(3 * 60 - 5);
    });

    it('asks again when a long poll runs out its own bound', async () => {
      await ready();
      fake.steps = ['hang', { seal: { app_token: APP_TOKEN, org_token: ORG_TOKEN } }];
      const { login } = harness({ timing: { TRANSFER_POLL_MS: 100 } });
      await expect(login(HUB, { signal: signal() })).resolves.toMatchObject({ kind: 'access' });
      expect(fake.transfers).toHaveLength(2);
    });

    it('fails on a 5xx', async () => {
      await ready();
      fake.steps = [{ status: 404 }, { status: 502 }, { seal: { app_token: APP_TOKEN, org_token: ORG_TOKEN } }];
      const { login } = harness();
      expect((await refusal(login(HUB, { signal: signal() }))).reason).toBe('transfer');
      expect(fake.transfers).toHaveLength(2);
    });

    it('fails a payload that does not open with the service-public-key', async () => {
      await ready();
      fake.steps = [{ seal: { app_token: APP_TOKEN, org_token: ORG_TOKEN }, servicePublicKey: nacl.box.keyPair().publicKey }];
      const { login } = harness();
      expect((await refusal(login(HUB, { signal: signal() }))).reason).toBe('payload');
    });

    for (const [name, seal] of [
      ['is not JSON', 'not json'],
      ['holds no app token', { org_token: ORG_TOKEN }],
      ['holds an app token with no exp', { app_token: accessToken({ email: EMAIL }), org_token: ORG_TOKEN }],
    ] as const) {
      it(`fails a payload that ${name}`, async () => {
        await ready();
        fake.steps = [{ seal }];
        const { login, lines } = harness();
        const error = await refusal(login(HUB, { signal: signal() }));
        expect(error.reason).toBe('payload');
        expect(`${error.message}\n${lines.join('\n')}`).not.toContain(ORG_TOKEN);
      });
    }
  });

  describe('its ends', () => {
    it('fails when the browser does not open, and polls nothing', async () => {
      fake = await fakeAccess();
      fake.metadata = await signJwt(metadataClaims(), teamKey.privateKey);
      const { login } = harness({ opens: false });
      expect((await refusal(login(HUB, { signal: signal() }))).reason).toBe('browser');
      expect(fake.transfers).toEqual([]);
    });

    it('times out at LOGIN_WAIT_MS while the transfer keeps answering not yet', async () => {
      fake = await fakeAccess();
      fake.metadata = await signJwt(metadataClaims(), teamKey.privateKey);
      fake.steps = [{ status: 404 }];
      const { login } = harness({ timing: { LOGIN_WAIT_MS: 400 } });
      const started = Date.now();
      expect((await refusal(login(HUB, { signal: signal() }))).reason).toBe('timeout');
      expect(Date.now() - started).toBeLessThan(1_500);
      expect(fake.transfers.length).toBeGreaterThan(1);
    });

    it('times out at LOGIN_WAIT_MS within a long poll that would run longer', async () => {
      fake = await fakeAccess();
      fake.metadata = await signJwt(metadataClaims(), teamKey.privateKey);
      fake.steps = ['hang'];
      const { login } = harness({ timing: { LOGIN_WAIT_MS: 300, TRANSFER_POLL_MS: 60_000 } });
      const started = Date.now();
      expect((await refusal(login(HUB, { signal: signal() }))).reason).toBe('timeout');
      expect(Date.now() - started).toBeLessThan(1_500);
      expect(fake.transfers).toHaveLength(1);
    });

    it('stops at once when cancelled mid-poll, and polls no more', async () => {
      fake = await fakeAccess();
      fake.metadata = await signJwt(metadataClaims(), teamKey.privateKey);
      fake.steps = ['hang'];
      const { login } = harness({ timing: { TRANSFER_POLL_MS: 60_000 } });
      const controller = new AbortController();
      const pending = login(HUB, { signal: controller.signal });
      while (fake.transfers.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
      const started = Date.now();
      controller.abort();
      expect((await refusal(pending)).reason).toBe('cancelled');
      expect(Date.now() - started).toBeLessThan(200);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(fake.transfers).toHaveLength(1);
    });

    it('stops at once when cancelled in the wait between polls', async () => {
      fake = await fakeAccess();
      fake.metadata = await signJwt(metadataClaims(), teamKey.privateKey);
      fake.steps = [{ status: 404 }];
      const { login } = harness({ timing: { TRANSFER_RETRY_MS: 60_000 } });
      const controller = new AbortController();
      const pending = login(HUB, { signal: controller.signal });
      while (fake.transfers.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
      await new Promise((resolve) => setTimeout(resolve, 20));
      controller.abort();
      expect((await refusal(pending)).reason).toBe('cancelled');
      expect(fake.transfers).toHaveLength(1);
    });

    it('does nothing when cancelled before it starts', async () => {
      fake = await fakeAccess();
      const { login, opened } = harness();
      const controller = new AbortController();
      controller.abort();
      expect((await refusal(login(HUB, { signal: controller.signal }))).reason).toBe('cancelled');
      expect(fake.heads).toEqual([]);
      expect(opened).toEqual([]);
    });
  });
});

describe('the stand-in', () => {
  const env = (user?: string): NodeJS.ProcessEnv => (user === undefined ? {} : { MAWS_DEV_STANDIN_USER: user });

  it('is honoured only for a loopback hub in an unpackaged build with MAWS_DEV_STANDIN_USER', () => {
    expect(hubAdmission('http://127.0.0.1:8787', { packaged: false, env: env('dev@example.com') })).toEqual({ kind: 'standin', user: 'dev@example.com' });
    expect(hubAdmission('http://127.0.0.1:8787', { packaged: true, env: env('dev@example.com') })).toBeNull();
    expect(hubAdmission('http://127.0.0.1:8787', { packaged: false, env: env() })).toBeNull();
    expect(hubAdmission('http://127.0.0.1:8787', { packaged: false, env: env('') })).toBeNull();
    for (const hub of ['http://localhost:8787', 'http://[::1]:8787', 'http://127.0.0.1', 'http://hub.example.com', 'http://127.0.0.1:8787/api', 'http://127.0.0.1:8787/']) {
      expect(hubAdmission(hub, { packaged: false, env: env('dev@example.com') }), hub).toBeNull();
    }
  });

  it('admits an https origin to Access, whatever the build', () => {
    expect(hubAdmission(HUB, { packaged: true, env: env() })).toEqual({ kind: 'access' });
    expect(hubAdmission(HUB, { packaged: false, env: env('dev@example.com') })).toEqual({ kind: 'access' });
    for (const hub of [`${HUB}/`, `${HUB}/api`, 'not a url', 'ftp://hub.example.com']) expect(hubAdmission(hub, { packaged: false, env: env() }), hub).toBeNull();
  });

  it('logs in with no browser and no request', async () => {
    await expect(standinLogin('dev@example.com')('http://127.0.0.1:8787', { signal: signal() })).resolves.toEqual({ kind: 'standin', user: 'dev@example.com' });
  });
});

describe('the credential', () => {
  it('rides on the hub requests as Access’s header or the stand-in’s', () => {
    const access: HubCredential = { kind: 'access', token: APP_TOKEN, expires: new Date(EXP * 1000).toISOString(), email: EMAIL };
    expect(hubHeaders(access)).toEqual({ 'cf-access-token': APP_TOKEN });
    expect(hubHeaders({ kind: 'standin', user: 'dev@example.com' })).toEqual({ 'x-desk-standin-user': 'dev@example.com' });
  });

  it('reads a token’s exp and email unverified, and nothing from a token that is not a JWT', () => {
    expect(tokenClaims(APP_TOKEN)).toEqual({ exp: EXP, email: EMAIL });
    expect(tokenClaims(accessToken({ sub: 'x' }))).toEqual({ exp: null, email: null });
    expect(tokenClaims('opaque')).toBeNull();
    expect(tokenClaims('a.b')).toBeNull();
    expect(tokenClaims(`${b64url('{}')}.${b64url('[1]')}.${b64url('s')}`)).toBeNull();
  });
});
