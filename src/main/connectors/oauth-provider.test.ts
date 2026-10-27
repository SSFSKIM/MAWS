// P3-HD M3c1: MAWS's own OAuth provider (src/main/connectors/oauth-provider.ts): the grant lifecycle behind route D's
// credential preparation and the owner's Connect, Reconnect and Disconnect. The real sealed store runs over a scratch
// directory with a reversible stand-in sealer (no keychain); a scripted flow stands for the SDK requests and the
// browser, a scripted `closeHost` for the engine host's `connectors.directClose`. A second store over the same
// directory is what a relaunch would read. What the host would receive is the evidence: a credential, or nothing.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectSource } from '@shared/ipc/schema/connectors';
import type { DirectCredentialPrepared } from './direct-route';
import type { ConnectorOAuthFlow } from './oauth-flow';
import { ConnectorOAuthError } from './oauth-flow';
import { createConnectorOAuthProvider, OAUTH_FORGET_READ_TIMEOUT_MS, OAUTH_HOST_CLOSE_TIMEOUT_MS, type ConnectorOAuthProvider, type ConnectorOAuthProviderDeps } from './oauth-provider';
import { createConnectorOAuthStore, type ConnectorOAuthSealer, type ConnectorOAuthStore } from './oauth-store';
import { oauthIdentityOf, type ConnectorOAuthGrant, type ConnectorOAuthIdentity, type ConnectorOAuthTokens } from './oauth-types';

const SAVED = '11111111-1111-4111-8111-111111111111';
const FRESH = '33333333-3333-4333-8333-333333333333';
const FRESH2 = '55555555-5555-4555-8555-555555555555';
const OTHER = '22222222-2222-4222-8222-222222222222';
const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

const source = (patch: Partial<DirectSource> = {}): DirectSource => ({
  directory: '/repo', sourceId: '44444444-4444-4444-8444-444444444444', generation: 3, server: 'metrics', scope: 'user', transport: 'http',
  path: '/home/o/.claude.json', entryPath: ['mcpServers', 'metrics'], observedAt: '2026-10-17T00:00:00.000Z', resourceUrl: 'https://mcp.example.com/mcp?tenant=7', ...patch,
});
const IDENTITY = oauthIdentityOf(source())!;
const tokens = (n: number, patch: Partial<ConnectorOAuthTokens> = {}): ConnectorOAuthTokens => ({
  accessToken: `at-${n}`, refreshToken: `rt-${n}`, tokenType: 'Bearer', expiresAt: NOW + HOUR, obtainedAt: NOW, ...patch,
});
const grant = (t: ConnectorOAuthTokens = tokens(1)): ConnectorOAuthGrant => ({
  issuer: 'https://auth.example.com',
  resource: 'https://mcp.example.com',
  redirectUri: 'http://127.0.0.1:53100/callback',
  authorizationServer: {
    issuer: 'https://auth.example.com', authorization_endpoint: 'https://auth.example.com/authorize', token_endpoint: 'https://auth.example.com/token',
    registration_endpoint: 'https://auth.example.com/register', revocation_endpoint: 'https://auth.example.com/revoke', response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
  },
  client: { client_id: 'client-1', redirect_uris: ['http://127.0.0.1:53100/callback'], token_endpoint_auth_method: 'none' },
  tokens: t,
});

interface Deferred<T> { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let events: string[];

class FakeSealer implements ConnectorOAuthSealer {
  isAvailable = true;
  failOpen = false;
  openHangs = false; // a keychain prompt nobody answers
  readonly failOpenFor = new Set<string>(); // connection ids whose record no longer decrypts
  holdSeal: Deferred<void> | null = null; // the next encryption waits for it
  sealWaiting = false;
  holdOpen: Deferred<void> | null = null; // the next decryption waits for it
  openWaiting = false;
  async available() { return this.isAvailable; }
  async seal(text: string) {
    const gate = this.holdSeal;
    this.holdSeal = null;
    if (gate) {
      this.sealWaiting = true;
      await gate.promise;
    }
    events.push(`seal:${(JSON.parse(text) as { tokens: { accessToken: string } }).tokens.accessToken}`);
    return Buffer.from(Buffer.from(text, 'utf8').map((byte) => byte ^ 0x5a));
  }
  async open(sealed: Buffer) {
    if (this.openHangs) await new Promise(() => {});
    const gate = this.holdOpen;
    this.holdOpen = null;
    if (gate) {
      this.openWaiting = true;
      await gate.promise;
    }
    const text = Buffer.from(sealed.map((byte) => byte ^ 0x5a)).toString('utf8');
    if (this.failOpen || this.failOpenFor.has((JSON.parse(text) as { connectionId: string }).connectionId)) throw new Error('decrypt failed');
    return { text, reseal: false };
  }
}

// The SDK requests and the browser, answered by the test.
class FakeFlow implements ConnectorOAuthFlow {
  readonly connects: { requestUrl: string; signal: AbortSignal; client: unknown; answer: Deferred<ConnectorOAuthGrant> }[] = [];
  readonly refreshes: { grant: ConnectorOAuthGrant; signal: AbortSignal; answer: Deferred<ConnectorOAuthTokens> }[] = [];
  readonly revokes: ConnectorOAuthGrant[] = [];
  revokeAnswer: 'revoked' | 'unsupported' | 'failed' = 'revoked';
  connect: ConnectorOAuthFlow['connect'] = ({ requestUrl, signal, client = null }) => {
    events.push('consent');
    const answer = deferred<ConnectorOAuthGrant>();
    this.connects.push({ requestUrl, signal, client, answer });
    return answer.promise;
  };
  refresh: ConnectorOAuthFlow['refresh'] = (grantNow, signal) => {
    const answer = deferred<ConnectorOAuthTokens>();
    events.push(`refresh:${grantNow.tokens.refreshToken}`);
    this.refreshes.push({ grant: grantNow, signal, answer });
    return answer.promise;
  };
  revoke: ConnectorOAuthFlow['revoke'] = async (grantNow) => {
    this.revokes.push(grantNow);
    return this.revokeAnswer;
  };
}

let root: string;
let dir: string;
let sealer: FakeSealer;
let flow: FakeFlow;
let clock: number;
let closes: { connectionId: string; credentialEpoch?: number }[];
let closeAnswers: Deferred<boolean>[] | null; // null: every close is confirmed at once
let ids: string[];
let provider: ConnectorOAuthProvider;

const storeOf = (): ConnectorOAuthStore => createConnectorOAuthStore({ directory: dir, sealer, now: () => clock });
const closeHost: ConnectorOAuthProviderDeps['closeHost'] = (target) => {
  closes.push(target);
  events.push(`close:${target.connectionId === SAVED ? 'saved' : target.connectionId}:${target.credentialEpoch ?? 'all'}`);
  if (closeAnswers === null) return Promise.resolve(true);
  const answer = deferred<boolean>();
  closeAnswers.push(answer);
  return answer.promise;
};
function makeProvider(store = storeOf()): ConnectorOAuthProvider {
  return createConnectorOAuthProvider({ store, flow, closeHost, now: () => clock, newConnectionId: () => ids.shift()!, log: () => {} });
}
async function seed(t: ConnectorOAuthTokens = tokens(1), identity: ConnectorOAuthIdentity = IDENTITY, id = SAVED): Promise<void> {
  const store = storeOf();
  await store.save(store.claim(id), identity, grant(t));
}
const prepare = (signal = new AbortController().signal, s = source()) => provider.prepare({ source: s, purpose: 'call', signal });
const credentialOf = (prepared: DirectCredentialPrepared) => (prepared.ok ? prepared.credential : 'refused');
const onDisk = () => { try { return readdirSync(dir).filter((name) => name.endsWith('.sealed')); } catch { return []; } };
const reread = async (id = SAVED) => storeOf().read(id);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-oauth-provider-'));
  dir = join(root, 'connectors', 'oauth');
  sealer = new FakeSealer();
  flow = new FakeFlow();
  clock = NOW;
  events = [];
  closes = [];
  closeAnswers = null;
  ids = [FRESH, FRESH2];
  provider = makeProvider();
});
afterEach(() => {
  provider.stop();
  rmSync(root, { recursive: true, force: true });
});

describe('a saved grant, without a browser', () => {
  it('delivers the saved access token under one epoch, bound to its connection, across demands', async () => {
    await seed();
    const first = await prepare();
    expect(first).toEqual({ ok: true, credential: { connectionId: SAVED, credentialEpoch: expect.any(Number), accessToken: 'at-1', expiresAt: NOW + HOUR } });
    expect(credentialOf(await prepare())).toEqual(credentialOf(first));
    expect(flow.connects).toEqual([]);
    expect(flow.refreshes).toEqual([]);
  });

  it('delivers no credential where nothing is saved, and none for a stdio source without reading the store', async () => {
    expect(await prepare()).toEqual({ ok: true, credential: null });
    await seed();
    sealer.isAvailable = false; // reading the store now would refuse
    expect(await prepare(undefined, source({ transport: 'stdio', resourceUrl: undefined }))).toEqual({ ok: true, credential: null });
  });

  it('never hands a grant saved for another identity to this source', async () => {
    for (const other of [{ ...IDENTITY, requestUrl: 'https://mcp.example.com/mcp?tenant=8' }, { ...IDENTITY, entryPath: ['projects', '/repo', 'mcpServers', 'metrics'] }, { ...IDENTITY, configPath: '/home/o/.claude/.claude.json' }]) {
      rmSync(dir, { recursive: true, force: true });
      await seed(tokens(1), other, OTHER);
      provider.stop();
      provider = makeProvider();
      expect(await prepare()).toEqual({ ok: true, credential: null });
    }
  });

  it('owner Connect reuses a usable saved grant without a browser', async () => {
    await seed();
    expect(await provider.connect(source())).toEqual({ ok: true, connectionId: SAVED, reused: true });
    expect(flow.connects).toEqual([]);
    expect(await provider.state(IDENTITY)).toEqual({ state: 'connected', connectionId: SAVED, refreshable: true, expiresAt: NOW + HOUR });
  });
});

describe('demand refresh', () => {
  it('refreshes once for concurrent demands, persists the rotation, confirms the old epoch closed, then releases a new epoch', async () => {
    await seed(tokens(1, { expiresAt: NOW + HOUR }));
    const before = credentialOf(await prepare()) as { credentialEpoch: number };
    clock = NOW + HOUR - 1_000; // within the refresh margin
    const a = prepare();
    const b = prepare();
    await vi.waitFor(() => expect(flow.refreshes).toHaveLength(1));
    flow.refreshes[0]!.answer.resolve(tokens(2, { expiresAt: clock + HOUR, obtainedAt: clock }));
    const [first, second] = await Promise.all([a, b]);
    events.push('released');
    expect(flow.refreshes).toHaveLength(1);
    expect(credentialOf(first)).toEqual({ connectionId: SAVED, credentialEpoch: expect.any(Number), accessToken: 'at-2', expiresAt: clock + HOUR });
    expect(credentialOf(second)).toEqual(credentialOf(first));
    expect((credentialOf(first) as { credentialEpoch: number }).credentialEpoch).toBeGreaterThan(before.credentialEpoch);
    expect(events.slice(events.indexOf('refresh:rt-1'))).toEqual(['refresh:rt-1', 'seal:at-2', `close:saved:${before.credentialEpoch}`, 'released']);
    expect((await reread())?.tokens).toMatchObject({ accessToken: 'at-2', refreshToken: 'rt-2' });
  });

  it('holds the replacement until the host confirms the old epoch closed; an unconfirmed close is retried, never refreshed again', async () => {
    await seed(tokens(1, { expiresAt: NOW + 120_000 }));
    const old = credentialOf(await prepare()) as { credentialEpoch: number };
    clock = NOW + 120_000;
    closeAnswers = [];
    const pending = prepare();
    await vi.waitFor(() => expect(flow.refreshes).toHaveLength(1));
    flow.refreshes[0]!.answer.resolve(tokens(2, { expiresAt: clock + HOUR }));
    await vi.waitFor(() => expect(closes).toHaveLength(1));
    expect((await reread())?.tokens.accessToken).toBe('at-2'); // persisted before the close answers
    closeAnswers[0]!.resolve(false);
    expect(await pending).toEqual({ ok: false });
    const retry = prepare();
    await vi.waitFor(() => expect(closes).toHaveLength(2));
    expect(closes[1]).toEqual({ connectionId: SAVED, credentialEpoch: old.credentialEpoch });
    closeAnswers[1]!.resolve(true);
    expect(credentialOf(await retry)).toMatchObject({ accessToken: 'at-2' });
    expect(flow.refreshes).toHaveLength(1);
  });

  // P3-F F-connectors 4: the old epoch's pending close is retried before the replacement, now within the margin, is
  // refreshed again, so a transient refresh failure leaves the still-valid replacement deliverable once the close confirms
  it('retries a pending old-epoch close before refreshing again: a transient failure still delivers the valid replacement', async () => {
    await seed(tokens(1, { expiresAt: NOW + 120_000 }));
    await prepare();
    clock = NOW + 120_000;
    closeAnswers = [];
    const first = prepare();
    await vi.waitFor(() => expect(flow.refreshes).toHaveLength(1));
    flow.refreshes[0]!.answer.resolve(tokens(2, { expiresAt: clock + 110_000 }));
    await vi.waitFor(() => expect(closes).toHaveLength(1));
    closeAnswers[0]!.resolve(false);
    expect(await first).toEqual({ ok: false });
    clock += 60_000; // the replacement has 50 s left: within the refresh margin, still valid
    closeAnswers = null; // the host confirms closes again
    const second = prepare();
    await vi.waitFor(() => expect(flow.refreshes).toHaveLength(2));
    expect(closes).toHaveLength(2); // the pending close went first
    flow.refreshes[1]!.answer.reject(new ConnectorOAuthError('transient'));
    expect(credentialOf(await second)).toMatchObject({ accessToken: 'at-2' });
  });

  it('a host whose attachment ended needs no close of an old epoch; its waiting demand ends, the next is served', async () => {
    await seed(tokens(1, { expiresAt: NOW + 120_000 }));
    await prepare();
    clock = NOW + 120_000;
    closeAnswers = [];
    const pending = prepare();
    await vi.waitFor(() => expect(flow.refreshes).toHaveLength(1));
    flow.refreshes[0]!.answer.resolve(tokens(2, { expiresAt: clock + HOUR }));
    await vi.waitFor(() => expect(closes).toHaveLength(1));
    provider.hostLost();
    expect(await pending).toEqual({ ok: false });
    closeAnswers[0]!.resolve(false);
    expect(credentialOf(await prepare())).toMatchObject({ accessToken: 'at-2' });
    expect(closes).toHaveLength(1);
  });

  it('an epoch delivered only to an attachment that has ended is replaced without a host close', async () => {
    await seed(tokens(1, { expiresAt: NOW + 120_000 }));
    await prepare();
    provider.hostLost();
    clock = NOW + 120_000;
    const next = prepare();
    await vi.waitFor(() => expect(flow.refreshes).toHaveLength(1));
    flow.refreshes[0]!.answer.resolve(tokens(2));
    expect(credentialOf(await next)).toMatchObject({ accessToken: 'at-2' });
    expect(closes).toEqual([]);
  });

  it('a cancelled caller leaves at once and dispatches nothing; the shared refresh still completes for the others', async () => {
    await seed(tokens(1, { expiresAt: NOW }));
    const cancelled = new AbortController();
    const leaving = prepare(cancelled.signal);
    const staying = prepare();
    await vi.waitFor(() => expect(flow.refreshes).toHaveLength(1));
    cancelled.abort();
    expect(await leaving).toEqual({ ok: false });
    expect(flow.refreshes[0]!.signal.aborted).toBe(false);
    flow.refreshes[0]!.answer.resolve(tokens(2));
    expect(credentialOf(await staying)).toMatchObject({ accessToken: 'at-2' });
  });

  it('a transient failure keeps the grant for a later demand; a still-valid token is used meanwhile, an expired one is not', async () => {
    await seed(tokens(1, { expiresAt: NOW + 30_000 }));
    const within = prepare();
    await vi.waitFor(() => expect(flow.refreshes).toHaveLength(1));
    flow.refreshes[0]!.answer.reject(new ConnectorOAuthError('transient'));
    expect(credentialOf(await within)).toMatchObject({ accessToken: 'at-1' });
    clock = NOW + 30_000;
    const expired = prepare();
    await vi.waitFor(() => expect(flow.refreshes).toHaveLength(2));
    flow.refreshes[1]!.answer.reject(new ConnectorOAuthError('timeout'));
    expect(await expired).toEqual({ ok: false });
    expect(await provider.state(IDENTITY)).toMatchObject({ state: 'connected' });
    expect((await reread())?.tokens.refreshToken).toBe('rt-1');
  });

  it('a rejected refresh needs a Reconnect: nothing is delivered, no browser opens, the record stays for the owner', async () => {
    await seed(tokens(1, { expiresAt: NOW }));
    const pending = prepare();
    await vi.waitFor(() => expect(flow.refreshes).toHaveLength(1));
    flow.refreshes[0]!.answer.reject(new ConnectorOAuthError('rejected'));
    expect(await pending).toEqual({ ok: false });
    expect(await prepare()).toEqual({ ok: false });
    expect(flow.refreshes).toHaveLength(1);
    expect(flow.connects).toEqual([]);
    expect(await provider.state(IDENTITY)).toEqual({ state: 'needsReconnect', connectionId: SAVED });
    expect(onDisk()).toEqual([`${SAVED}.sealed`]);
  });

  it('an expired token without a refresh token needs a Reconnect, never a fallback to no credential', async () => {
    await seed(tokens(1, { expiresAt: NOW, refreshToken: undefined }));
    expect(await prepare()).toEqual({ ok: false });
    expect(await provider.state(IDENTITY)).toEqual({ state: 'needsReconnect', connectionId: SAVED });
  });

  it('a rotation that cannot be saved is never released, and the consumed refresh token is never sent again', async () => {
    await seed(tokens(1, { expiresAt: NOW }));
    const pending = prepare();
    await vi.waitFor(() => expect(flow.refreshes).toHaveLength(1));
    sealer.isAvailable = false;
    flow.refreshes[0]!.answer.resolve(tokens(2));
    expect(await pending).toEqual({ ok: false });
    expect(closes).toEqual([]);
    sealer.isAvailable = true;
    expect(credentialOf(await prepare())).toMatchObject({ accessToken: 'at-2' });
    expect(flow.refreshes).toHaveLength(1);
    expect((await reread())?.tokens.refreshToken).toBe('rt-2');
  });
});

describe('unauthorized answers', () => {
  it('marks the rejected epoch unusable for the next demand, which refreshes; nothing is retried by the report itself', async () => {
    await seed();
    const used = credentialOf(await prepare()) as { connectionId: string; credentialEpoch: number };
    provider.unauthorized({ source: source(), purpose: 'call', credential: { connectionId: used.connectionId, credentialEpoch: used.credentialEpoch } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(flow.refreshes).toEqual([]);
    const next = prepare();
    await vi.waitFor(() => expect(flow.refreshes).toHaveLength(1));
    flow.refreshes[0]!.answer.resolve(tokens(2));
    const replaced = credentialOf(await next) as { credentialEpoch: number; accessToken: string };
    expect(replaced.accessToken).toBe('at-2');
    expect(replaced.credentialEpoch).toBeGreaterThan(used.credentialEpoch);
    expect(closes).toContainEqual({ connectionId: SAVED, credentialEpoch: used.credentialEpoch });
  });

  it('ignores a late report for an epoch already replaced', async () => {
    await seed(tokens(1, { expiresAt: NOW }));
    const refreshing = prepare();
    await vi.waitFor(() => expect(flow.refreshes).toHaveLength(1));
    flow.refreshes[0]!.answer.resolve(tokens(2));
    const current = credentialOf(await refreshing) as { credentialEpoch: number };
    provider.unauthorized({ source: source(), purpose: 'call', credential: { connectionId: SAVED, credentialEpoch: current.credentialEpoch - 1 } });
    expect(credentialOf(await prepare())).toEqual(credentialOf(await prepare()));
    expect(flow.refreshes).toHaveLength(1);
  });

  it('a credential-less 401 (no owned grant) parks the source until the owner connects', async () => {
    expect(await prepare()).toEqual({ ok: true, credential: null });
    provider.unauthorized({ source: source(), purpose: 'call', credential: null });
    expect(await prepare()).toEqual({ ok: false });
    expect(await provider.state(IDENTITY)).toEqual({ state: 'needsConnect' });
    const connecting = provider.connect(source());
    await vi.waitFor(() => expect(flow.connects).toHaveLength(1));
    flow.connects[0]!.answer.resolve(grant(tokens(5)));
    expect(await connecting).toEqual({ ok: true, connectionId: FRESH, reused: false });
    expect(credentialOf(await prepare())).toMatchObject({ connectionId: FRESH, accessToken: 'at-5' });
  });
});

describe('owner Connect and Reconnect', () => {
  // P5 O1 M3: the consent opens on the client that asked; a Connect while it runs is busy, so the flow has one asker
  it('hands the flow the asking client, for Connect and for Reconnect', async () => {
    const asker = { id: 'page:1.1', onGone: () => () => {} } as never;
    const connecting = provider.connect(source(), undefined, asker);
    await vi.waitFor(() => expect(flow.connects).toHaveLength(1));
    expect(flow.connects[0]!.client).toBe(asker);
    expect(await provider.connect(source(), undefined, { id: 'page:2.1', onGone: () => () => {} } as never)).toEqual({ ok: false, why: 'busy' });
    flow.connects[0]!.answer.resolve(grant(tokens(5)));
    await connecting;
    const replacing = provider.reconnect(source(), undefined, asker);
    await vi.waitFor(() => expect(flow.connects).toHaveLength(2));
    expect(flow.connects[1]!.client).toBe(asker);
    flow.connects[1]!.answer.resolve(grant(tokens(6)));
    await replacing;
  });

  it('runs one flow for the exact request URL under a connection id known while connecting, then saves and delivers it', async () => {
    const connecting = provider.connect(source());
    await vi.waitFor(() => expect(flow.connects).toHaveLength(1));
    expect(flow.connects[0]!.requestUrl).toBe('https://mcp.example.com/mcp?tenant=7');
    expect(await provider.state(IDENTITY)).toEqual({ state: 'connecting', connectionId: FRESH });
    expect(await prepare()).toEqual({ ok: false }); // no literal-header fallback while the owner connects
    expect(await provider.connect(source())).toEqual({ ok: false, why: 'busy' });
    flow.connects[0]!.answer.resolve(grant(tokens(5)));
    expect(await connecting).toEqual({ ok: true, connectionId: FRESH, reused: false });
    expect(onDisk()).toEqual([`${FRESH}.sealed`]);
    expect((await storeOf().read(FRESH))?.identity).toEqual(IDENTITY);
    expect(credentialOf(await prepare())).toMatchObject({ connectionId: FRESH, accessToken: 'at-5' });
  });

  it('a failed or cancelled Connect returns to disconnected and saves nothing', async () => {
    const failing = provider.connect(source());
    await vi.waitFor(() => expect(flow.connects).toHaveLength(1));
    flow.connects[0]!.answer.reject(new ConnectorOAuthError('state'));
    expect(await failing).toEqual({ ok: false, why: 'state' });
    const owner = new AbortController();
    const cancelled = provider.connect(source(), owner.signal);
    await vi.waitFor(() => expect(flow.connects).toHaveLength(2));
    owner.abort();
    expect(flow.connects[1]!.signal.aborted).toBe(true);
    flow.connects[1]!.answer.reject(new ConnectorOAuthError('cancelled'));
    expect(await cancelled).toEqual({ ok: false, why: 'cancelled' });
    expect(onDisk()).toEqual([]);
    expect(await provider.state(IDENTITY)).toEqual({ state: 'disconnected' });
    expect(await prepare()).toEqual({ ok: true, credential: null });
  });

  it('Disconnect during Connect cancels it; a grant answered late is neither saved nor delivered, and is revoked', async () => {
    const connecting = provider.connect(source());
    await vi.waitFor(() => expect(flow.connects).toHaveLength(1));
    const disconnected = await provider.disconnect(FRESH);
    expect(flow.connects[0]!.signal.aborted).toBe(true);
    flow.connects[0]!.answer.resolve(grant(tokens(5)));
    expect(await connecting).toEqual({ ok: false, why: 'cancelled' });
    expect(disconnected).toMatchObject({ local: 'absent', host: 'confirmed' });
    await vi.waitFor(() => expect(flow.revokes.map((g) => g.tokens.accessToken)).toEqual(['at-5']));
    expect(onDisk()).toEqual([]);
    expect(await prepare()).toEqual({ ok: false });
    expect(await provider.state(IDENTITY)).toEqual({ state: 'withdrawn' });
  });

  it('Reconnect withdraws the old grant before its flow and registers a new connection; failure revives nothing', async () => {
    await seed();
    const old = credentialOf(await prepare()) as { credentialEpoch: number };
    const replacing = provider.reconnect(source());
    await vi.waitFor(() => expect(flow.connects).toHaveLength(1));
    expect(onDisk()).toEqual([]);
    expect(closes).toContainEqual({ connectionId: SAVED, credentialEpoch: old.credentialEpoch });
    expect(await prepare()).toEqual({ ok: false });
    flow.connects[0]!.answer.reject(new ConnectorOAuthError('timeout'));
    expect(await replacing).toEqual({ ok: false, why: 'timeout' });
    expect(await prepare()).toEqual({ ok: false });
    expect(await provider.state(IDENTITY)).toEqual({ state: 'withdrawn' });
    expect(old.credentialEpoch).toBeGreaterThan(0);
    provider.stop();
    provider = makeProvider(); // a relaunch reads no old grant back
    expect(await prepare()).toEqual({ ok: true, credential: null });
    expect(flow.revokes.map((g) => g.tokens.accessToken)).toEqual(['at-1']);
  });

  it('a successful Reconnect delivers the replacement under its new connection id', async () => {
    await seed();
    await prepare();
    const replacing = provider.reconnect(source());
    await vi.waitFor(() => expect(flow.connects).toHaveLength(1));
    flow.connects[0]!.answer.resolve(grant(tokens(9)));
    expect(await replacing).toEqual({ ok: true, connectionId: FRESH, reused: false });
    expect(credentialOf(await prepare())).toMatchObject({ connectionId: FRESH, accessToken: 'at-9' });
    expect(onDisk()).toEqual([`${FRESH}.sealed`]);
  });

  it('Connect over a saved grant that needs reconnection says so: no registration, no browser', async () => {
    await seed(tokens(1, { expiresAt: NOW, refreshToken: undefined }));
    expect(await provider.connect(source())).toEqual({ ok: false, why: 'needsReconnect' });
    await seed(tokens(1, { expiresAt: NOW }));
    provider.stop();
    provider = makeProvider();
    const pending = prepare();
    await vi.waitFor(() => expect(flow.refreshes).toHaveLength(1));
    flow.refreshes[0]!.answer.reject(new ConnectorOAuthError('rejected'));
    await pending;
    expect(await provider.connect(source())).toEqual({ ok: false, why: 'needsReconnect' });
    expect(flow.connects).toEqual([]);
    expect(onDisk()).toEqual([`${SAVED}.sealed`]);
  });

  it('Connect over an expired refreshable grant reuses it; the next demand refreshes without a browser', async () => {
    await seed(tokens(1, { expiresAt: NOW }));
    expect(await provider.connect(source())).toEqual({ ok: true, connectionId: SAVED, reused: true });
    const pending = prepare();
    await vi.waitFor(() => expect(flow.refreshes).toHaveLength(1));
    flow.refreshes[0]!.answer.resolve(tokens(2));
    expect(credentialOf(await pending)).toMatchObject({ connectionId: SAVED, accessToken: 'at-2' });
    expect(flow.connects).toEqual([]);
  });

  it('Connect after Disconnect runs a new flow (the withdrawn identity has no owned grant), never the forgotten one', async () => {
    await seed();
    await prepare(); // main holds the grant it then forgets
    await provider.disconnect(SAVED);
    const connecting = provider.connect(source());
    await vi.waitFor(() => expect(flow.connects).toHaveLength(1));
    flow.connects[0]!.answer.resolve(grant(tokens(4)));
    expect(await connecting).toEqual({ ok: true, connectionId: FRESH, reused: false });
    expect(credentialOf(await prepare())).toMatchObject({ connectionId: FRESH, accessToken: 'at-4' });
  });

  it('refuses a stdio source', async () => {
    expect(await provider.connect(source({ transport: 'stdio', resourceUrl: undefined }))).toEqual({ ok: false, why: 'notHttp' });
  });
});

describe('Disconnect', () => {
  it('blocks at once, closes every epoch in the host, forgets locally, revokes, and stays withdrawn until Connect', async () => {
    await seed();
    const used = credentialOf(await prepare()) as { credentialEpoch: number };
    closeAnswers = [];
    const disconnecting = provider.disconnect(SAVED);
    expect(provider.disconnecting(SAVED)).toBe('pending');
    expect(await prepare()).toEqual({ ok: false });
    await vi.waitFor(() => expect(closes).toContainEqual({ connectionId: SAVED, credentialEpoch: used.credentialEpoch }));
    closeAnswers.at(-1)!.resolve(true);
    expect(await disconnecting).toEqual({ local: 'forgotten', host: 'confirmed', revocation: 'revoked' });
    expect(provider.disconnecting(SAVED)).toBeNull();
    expect(flow.revokes.map((g) => g.tokens.refreshToken)).toEqual(['rt-1']);
    expect(onDisk()).toEqual([]);
    expect(await prepare()).toEqual({ ok: false });
    expect(await provider.state(IDENTITY)).toEqual({ state: 'withdrawn' });
  });

  it('reports an unanswered host close as unconfirmed until the host’s attachment ends', async () => {
    await seed();
    closeAnswers = [];
    const disconnecting = provider.disconnect(SAVED);
    await vi.waitFor(() => expect(closeAnswers).toHaveLength(1));
    closeAnswers[0]!.resolve(false);
    expect(await disconnecting).toMatchObject({ local: 'forgotten', host: 'unconfirmed' });
    expect(provider.disconnecting(SAVED)).toBe('unconfirmed');
    provider.hostLost();
    expect(provider.disconnecting(SAVED)).toBeNull();
  });

  it('a keychain read that never answers does not hold back forgetting (no revocation without the record)', async () => {
    await seed();
    sealer.openHangs = true;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const disconnecting = provider.disconnect(SAVED);
      await vi.advanceTimersByTimeAsync(OAUTH_FORGET_READ_TIMEOUT_MS);
      expect(await disconnecting).toEqual({ local: 'forgotten', host: 'confirmed', revocation: 'none' });
    } finally {
      vi.useRealTimers();
    }
    expect(onDisk()).toEqual([]);
    sealer.openHangs = false;
    expect(await prepare()).toEqual({ ok: false }); // unattributed: never a silent switch of authentication
  });

  it('a cold Disconnect still reading its record is no proof of absence: a concurrent demand is refused, never sent without', async () => {
    await seed();
    sealer.holdOpen = deferred();
    const release = sealer.holdOpen;
    const disconnecting = provider.disconnect(SAVED);
    await vi.waitFor(() => expect(sealer.openWaiting).toBe(true));
    expect(await prepare()).toEqual({ ok: false }); // its listing finished while the Disconnect's read waits
    release.resolve();
    expect(await disconnecting).toMatchObject({ local: 'forgotten', revocation: 'revoked' });
    expect(await prepare()).toEqual({ ok: false });
    expect(await provider.state(IDENTITY)).toEqual({ state: 'withdrawn' });
  });

  it('a Connect whose lookup a Disconnect overtakes is cancelled, not run', async () => {
    await seed();
    const store = storeOf();
    const list = store.list.bind(store);
    const gate = deferred<void>();
    vi.spyOn(store, 'list').mockImplementationOnce(async () => { const listed = await list(); await gate.promise; return listed; });
    provider.stop();
    provider = makeProvider(store);
    const connecting = provider.connect(source());
    await provider.disconnect(SAVED); // the lookup has listed the record, and waits
    gate.resolve();
    expect(await connecting).toEqual({ ok: false, why: 'cancelled' });
    expect(flow.connects).toEqual([]);
    expect(await provider.state(IDENTITY)).toEqual({ state: 'withdrawn' });
  });

  it('forgets the grant even when revocation fails', async () => {
    await seed();
    flow.revokeAnswer = 'failed';
    expect(await provider.disconnect(SAVED)).toEqual({ local: 'forgotten', host: 'confirmed', revocation: 'failed' });
    expect(onDisk()).toEqual([]);
  });

  it('a disconnect racing a refresh: the late rotation is neither saved nor delivered', async () => {
    await seed(tokens(1, { expiresAt: NOW }));
    const pending = prepare();
    await vi.waitFor(() => expect(flow.refreshes).toHaveLength(1));
    const disconnected = provider.disconnect(SAVED);
    expect(flow.refreshes[0]!.signal.aborted).toBe(true);
    flow.refreshes[0]!.answer.resolve(tokens(2));
    expect(await pending).toEqual({ ok: false });
    await disconnected;
    expect(onDisk()).toEqual([]);
    expect(events.filter((event) => event === 'seal:at-2')).toEqual([]);
  });

  it('forgets a stale saved grant with no current source after a cold start, then blocks its identity', async () => {
    await seed();
    expect(await provider.saved()).toEqual([{ state: 'sealed', connectionId: SAVED, identity: IDENTITY, issuer: 'https://auth.example.com', resource: 'https://mcp.example.com', savedAt: NOW, expiresAt: NOW + HOUR, refreshable: true }]);
    expect(await provider.disconnect(SAVED)).toEqual({ local: 'forgotten', host: 'confirmed', revocation: 'revoked' });
    expect(await provider.saved()).toEqual([]);
    expect(await prepare()).toEqual({ ok: false });
  });

  it('forgets an unreadable record by id without decrypting it; until then no HTTP source is served without proof', async () => {
    await seed();
    sealer.failOpen = true;
    provider.stop();
    provider = makeProvider();
    expect(await provider.saved()).toEqual([{ state: 'unreadable', connectionId: SAVED }]);
    expect(await prepare()).toEqual({ ok: false });
    expect(await provider.state(IDENTITY)).toEqual({ state: 'unavailable', why: 'unknown' });
    expect(await provider.connect(source())).toEqual({ ok: false, why: 'unavailable' });
    expect(flow.connects).toEqual([]);
    expect(await provider.disconnect(SAVED)).toEqual({ local: 'forgotten', host: 'confirmed', revocation: 'none' });
    // whose grant it was is unknown: no source switches to its own configuration or none in this main's lifetime
    expect(await prepare()).toEqual({ ok: false });
    expect(await provider.state(IDENTITY)).toEqual({ state: 'withdrawn' });
  });

  it('after an unattributed forget, an explicit Connect recovers a source through its own new flow; automatic use stays refused', async () => {
    await seed();
    sealer.failOpen = true;
    provider.stop();
    provider = makeProvider();
    await provider.disconnect(SAVED);
    sealer.failOpen = false;
    const unrelated = source({ server: 'second', entryPath: ['mcpServers', 'second'] });
    expect(await prepare(undefined, unrelated)).toEqual({ ok: false });
    const connecting = provider.connect(source());
    await vi.waitFor(() => expect(flow.connects).toHaveLength(1));
    flow.connects[0]!.answer.resolve(grant(tokens(6)));
    expect(await connecting).toEqual({ ok: true, connectionId: FRESH, reused: false });
    expect(credentialOf(await prepare())).toMatchObject({ connectionId: FRESH, accessToken: 'at-6' });
    expect(await prepare(undefined, unrelated)).toEqual({ ok: false }); // its own Connect is its way back
    const second = provider.reconnect(unrelated);
    await vi.waitFor(() => expect(flow.connects).toHaveLength(2));
    flow.connects[1]!.answer.resolve(grant(tokens(7)));
    expect(await second).toEqual({ ok: true, connectionId: FRESH2, reused: false });
    expect(credentialOf(await prepare(undefined, unrelated))).toMatchObject({ connectionId: FRESH2, accessToken: 'at-7' });
  });

  it('after an unattributed forget, explicit consent still does not bypass a record that remains unreadable', async () => {
    await seed(tokens(1), IDENTITY, SAVED);
    await seed(tokens(2), { ...IDENTITY, server: 'other' }, OTHER);
    sealer.failOpen = true;
    provider.stop();
    provider = makeProvider();
    await provider.disconnect(SAVED);
    expect(await provider.connect(source())).toEqual({ ok: false, why: 'unavailable' });
    expect(await provider.reconnect(source())).toEqual({ ok: false, why: 'unavailable' });
    expect(flow.connects).toEqual([]);
    expect(await provider.state(IDENTITY)).toEqual({ state: 'unavailable', why: 'unknown' });
  });

  it('a readable exact match is served even beside an unrelated unreadable record', async () => {
    await seed(tokens(1), { ...IDENTITY, server: 'other' }, OTHER);
    await seed();
    sealer.failOpenFor.add(OTHER);
    expect(credentialOf(await prepare())).toMatchObject({ connectionId: SAVED, accessToken: 'at-1' });
  });

  it('two saved grants for the exact identity are not ranked: unavailable, both ids listed for the owner', async () => {
    await seed(tokens(1), IDENTITY, SAVED);
    await seed(tokens(2), IDENTITY, OTHER);
    expect(await prepare()).toEqual({ ok: false });
    expect(await provider.state(IDENTITY)).toEqual({ state: 'unavailable', why: 'duplicate' });
    expect(await provider.connect(source())).toEqual({ ok: false, why: 'unavailable' });
    expect((await provider.saved())?.map((entry) => entry.connectionId).sort()).toEqual([SAVED, OTHER].sort());
    await provider.disconnect(OTHER);
    // the forgotten one withdrew the identity: a new Connect is the owner's way back
    expect(await prepare()).toEqual({ ok: false });
  });

  it('with safeStorage unavailable and a record saved, nothing is delivered and no fallback is taken', async () => {
    await seed();
    sealer.isAvailable = false;
    provider.stop();
    provider = makeProvider();
    expect(await prepare()).toEqual({ ok: false });
    expect(await provider.state(IDENTITY)).toEqual({ state: 'unavailable', why: 'store' });
  });

  it('with safeStorage unavailable, saved records are still listed by id alone, without the sealer, and can be forgotten', async () => {
    await seed();
    sealer.isAvailable = false;
    provider.stop();
    provider = makeProvider();
    const listed = await provider.saved();
    expect(listed).toEqual([{ state: 'unreadable', connectionId: SAVED }]);
    expect(await provider.disconnect(SAVED)).toMatchObject({ local: 'forgotten', host: 'confirmed' });
    expect(onDisk()).toEqual([]);
  });
});

describe('owner actions keep their own lifetime', () => {
  const gatedList = async () => {
    const store = storeOf();
    const list = store.list.bind(store);
    const gate = deferred<void>();
    const listed = deferred<void>();
    vi.spyOn(store, 'list').mockImplementationOnce(async () => { const answer = await list(); listed.resolve(); await gate.promise; return answer; });
    provider.stop();
    provider = makeProvider(store);
    return { gate, listed };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

  for (const action of ['connect', 'reconnect'] as const) {
    it(`${action}: the host’s attachment ending during its lookup ends it; no browser opens`, async () => {
      const { gate, listed } = await gatedList();
      const pending = provider[action](source());
      await listed.promise;
      provider.hostLost();
      gate.resolve();
      await settle();
      expect(flow.connects).toEqual([]);
      expect(await pending).toEqual({ ok: false, why: 'cancelled' });
    });

    it(`${action}: a Disconnect after its held-grant lookup ends it, never read as a fresh Connect`, async () => {
      await seed();
      await prepare(); // main holds the grant: the lookup answers at once
      const pending = provider[action](source());
      const disconnected = provider.disconnect(SAVED);
      await settle();
      expect(flow.connects).toEqual([]);
      expect(await pending).toEqual({ ok: false, why: 'cancelled' });
      await disconnected;
      expect(await provider.state(IDENTITY)).toEqual({ state: 'withdrawn' });
    });
  }

  for (const end of ['owner', 'hostLost', 'stop', 'disconnect'] as const) {
    it(`a grant whose save is still encrypting when the ${end} ends the flow is not installed, delivered or kept`, async () => {
      const owner = new AbortController();
      const connecting = provider.connect(source(), owner.signal);
      await vi.waitFor(() => expect(flow.connects).toHaveLength(1));
      sealer.holdSeal = deferred();
      const release = sealer.holdSeal;
      flow.connects[0]!.answer.resolve(grant(tokens(5)));
      await vi.waitFor(() => expect(sealer.sealWaiting).toBe(true));
      if (end === 'owner') owner.abort();
      else if (end === 'hostLost') provider.hostLost();
      else if (end === 'stop') provider.stop();
      else void provider.disconnect(FRESH);
      release.resolve();
      expect(await connecting).toEqual({ ok: false, why: 'cancelled' });
      await vi.waitFor(() => expect(onDisk()).toEqual([]));
      expect(flow.revokes.map((g) => g.tokens.accessToken)).toContain('at-5');
      if (end === 'stop') provider = makeProvider();
      expect(credentialOf(await prepare())).not.toMatchObject({ connectionId: FRESH });
      expect(await storeOf().read(FRESH)).toBeNull();
    });
  }
});

// P3-HD panel correction: a lifetime's end is not held hostage by an encryption still pending
describe('work outliving its generation or its flow', () => {
  const settled = <T>(promise: Promise<T>, ms = 200) => Promise.race([promise, new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), ms))]);

  it('a refresh whose rotation is still encrypting when Reconnect replaces it does not hold the new connection; its late save lands nowhere', async () => {
    await seed(tokens(1, { expiresAt: NOW }));
    const demand = prepare();
    await vi.waitFor(() => expect(flow.refreshes).toHaveLength(1));
    sealer.holdSeal = deferred();
    const release = sealer.holdSeal;
    flow.refreshes[0]!.answer.resolve(tokens(2));
    await vi.waitFor(() => expect(sealer.sealWaiting).toBe(true)); // the rotation's save, outside the store's lock
    const replacing = provider.reconnect(source());
    await vi.waitFor(() => expect(flow.connects).toHaveLength(1));
    flow.connects[0]!.answer.resolve(grant(tokens(9)));
    expect(await settled(replacing)).toEqual({ ok: true, connectionId: FRESH, reused: false });
    // the withdrawn generation's demand is refused at the withdrawal, not when its stalled save answers
    expect(await settled(demand)).toEqual({ ok: false });
    const next = await settled(prepare());
    expect(next === 'pending' ? next : credentialOf(next)).toMatchObject({ connectionId: FRESH, accessToken: 'at-9' });
    release.resolve();
    await vi.waitFor(() => expect(onDisk()).toEqual([`${FRESH}.sealed`]));
    expect(await storeOf().read(SAVED)).toBeNull();
    expect(credentialOf(await prepare())).toMatchObject({ connectionId: FRESH, accessToken: 'at-9' });
    expect(closes.filter((close) => close.connectionId === FRESH)).toEqual([]);
  });

  it('a demand whose grant lookup is still decrypting when Disconnect withdraws the identity is refused at once', async () => {
    await seed();
    sealer.holdOpen = deferred();
    const release = sealer.holdOpen;
    const demand = prepare();
    await vi.waitFor(() => expect(sealer.openWaiting).toBe(true)); // the adoption's read, held in decryption
    const disconnected = provider.disconnect(SAVED);
    expect(await settled(demand)).toEqual({ ok: false });
    release.resolve();
    expect(await disconnected).toMatchObject({ local: 'forgotten' });
    expect(await prepare()).toEqual({ ok: false }); // withdrawn until the owner connects
    expect(onDisk()).toEqual([]);
  });

  for (const end of ['owner', 'hostLost'] as const) {
    it(`a flow whose save is still encrypting when the ${end} ends it frees its slot at once; the late save lands nothing`, async () => {
      const owner = new AbortController();
      const connecting = provider.connect(source(), owner.signal);
      await vi.waitFor(() => expect(flow.connects).toHaveLength(1));
      sealer.holdSeal = deferred();
      const release = sealer.holdSeal;
      flow.connects[0]!.answer.resolve(grant(tokens(5)));
      await vi.waitFor(() => expect(sealer.sealWaiting).toBe(true));
      if (end === 'owner') owner.abort();
      else provider.hostLost();
      expect(await settled(connecting)).toEqual({ ok: false, why: 'cancelled' }); // the save still unanswered
      expect(await provider.state(IDENTITY)).toEqual({ state: 'disconnected' });
      expect(await settled(prepare())).toEqual({ ok: true, credential: null });
      const again = provider.connect(source());
      await vi.waitFor(() => expect(flow.connects).toHaveLength(2)); // not busy
      expect(flow.revokes.map((g) => g.tokens.accessToken)).toContain('at-5');
      release.resolve();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(await storeOf().read(FRESH)).toBeNull();
      flow.connects[1]!.answer.resolve(grant(tokens(6)));
      expect(await again).toEqual({ ok: true, connectionId: FRESH2, reused: false });
      expect(onDisk()).toEqual([`${FRESH2}.sealed`]);
      expect(credentialOf(await prepare())).toMatchObject({ connectionId: FRESH2, accessToken: 'at-6' });
    });
  }
});

describe('a flow ended just after its save committed', () => {
  for (const end of ['owner', 'hostLost'] as const) {
    it(`the ${end}: the committed grant is unlinked and revoked, never installed or delivered`, async () => {
      const store = storeOf();
      const save = store.save.bind(store);
      const owner = new AbortController();
      vi.spyOn(store, 'save').mockImplementationOnce(async (...args) => {
        const saved = await save(...args);
        expect(onDisk()).toEqual([`${FRESH}.sealed`]); // committed
        if (end === 'owner') owner.abort();
        else provider.hostLost();
        return saved;
      });
      provider.stop();
      provider = makeProvider(store);
      const connecting = provider.connect(source(), owner.signal);
      await vi.waitFor(() => expect(flow.connects).toHaveLength(1));
      flow.connects[0]!.answer.resolve(grant(tokens(5)));
      expect(await connecting).toEqual({ ok: false, why: 'cancelled' });
      await vi.waitFor(() => expect(onDisk()).toEqual([]));
      expect(flow.revokes.map((g) => g.tokens.accessToken)).toContain('at-5');
      expect(await prepare()).toEqual({ ok: true, credential: null });
    });
  }
});

describe('an owner action’s final lifetime proof, at its side effect', () => {
  // consent after the end is allowed only for an action admitted before it (its withdrawal of the old grant came first)
  const admittedBeforeEnd = () => {
    const end = events.indexOf('end');
    const consent = events.indexOf('consent');
    return consent === -1 || consent < end || events.slice(0, end).some((event) => event.startsWith('close:saved'));
  };
  for (const action of ['connect', 'reconnect'] as const) {
    for (const end of ['disconnect', 'hostLost'] as const) {
      for (const depth of [0, 1, 2, 3]) {
        it(`${action}: a ${end} queued ${depth} microtask(s) after the call starts no consent for an ended action`, async () => {
          await seed();
          await prepare(); // main holds the grant: the lookup answers without the store
          const pending = provider[action](source());
          let hop = () => {
            events.push('end');
            if (end === 'disconnect') void provider.disconnect(SAVED);
            else provider.hostLost();
          };
          for (let i = 0; i < depth; i += 1) { const inner = hop; hop = () => queueMicrotask(inner); }
          queueMicrotask(hop);
          await Promise.race([pending, new Promise((resolve) => setTimeout(resolve, 50))]);
          expect(events).toContain('end');
          expect(admittedBeforeEnd()).toBe(true);
          if (action === 'connect') expect(flow.connects).toEqual([]); // a held grant is reused, never consented again
        });
      }
    }
  }
});

describe('a withdrawn connection’s retirement', () => {
  for (const first of ['false', 'timeout'] as const) {
    it(`an old close first ${first === 'false' ? 'unconfirmed' : 'timed out'}, a responsive host then clears it for a short-lived access-only replacement`, async () => {
      await seed();
      await prepare();
      closeAnswers = [];
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const replacing = provider.reconnect(source());
        await vi.waitFor(() => expect(closeAnswers).toHaveLength(1));
        if (first === 'false') closeAnswers[0]!.resolve(false);
        else await vi.advanceTimersByTimeAsync(OAUTH_HOST_CLOSE_TIMEOUT_MS);
        await vi.waitFor(() => expect(provider.disconnecting(SAVED)).toBe('unconfirmed'));
        await vi.waitFor(() => expect(flow.connects).toHaveLength(1));
        flow.connects[0]!.answer.resolve(grant(tokens(9, { expiresAt: clock + 30_000, refreshToken: undefined })));
        expect(await replacing).toMatchObject({ ok: true, connectionId: FRESH });
      } finally {
        vi.useRealTimers();
      }
      closeAnswers = null; // the host answers again
      expect(credentialOf(await prepare())).toMatchObject({ connectionId: FRESH, accessToken: 'at-9' });
      expect(flow.refreshes).toEqual([]);
      expect(flow.connects).toHaveLength(1);
      expect(provider.disconnecting(SAVED)).toBeNull();
    });
  }

  it('a transient refresh failure does not hold back the retirement: a still-valid replacement is delivered once the close confirms', async () => {
    await seed();
    await prepare();
    closeAnswers = [];
    const replacing = provider.reconnect(source());
    await vi.waitFor(() => expect(closeAnswers).toHaveLength(1));
    closeAnswers[0]!.resolve(false);
    await vi.waitFor(() => expect(flow.connects).toHaveLength(1));
    flow.connects[0]!.answer.resolve(grant(tokens(9, { expiresAt: clock + 30_000 })));
    expect(await replacing).toMatchObject({ ok: true });
    closeAnswers = null;
    const pending = prepare();
    await vi.waitFor(() => expect(flow.refreshes).toHaveLength(1));
    flow.refreshes[0]!.answer.reject(new ConnectorOAuthError('transient'));
    expect(credentialOf(await pending)).toMatchObject({ connectionId: FRESH, accessToken: 'at-9' });
  });

  it('Reconnect: the replacement is not delivered until the old connection’s close is confirmed', async () => {
    await seed();
    const old = credentialOf(await prepare()) as { credentialEpoch: number };
    closeAnswers = [];
    const replacing = provider.reconnect(source());
    await vi.waitFor(() => expect(closeAnswers).toHaveLength(1));
    expect(closes[0]).toEqual({ connectionId: SAVED, credentialEpoch: old.credentialEpoch });
    closeAnswers[0]!.resolve(false);
    await vi.waitFor(() => expect(flow.connects).toHaveLength(1));
    flow.connects[0]!.answer.resolve(grant(tokens(9)));
    expect(await replacing).toEqual({ ok: true, connectionId: FRESH, reused: false });
    expect(provider.disconnecting(SAVED)).toBe('unconfirmed');
    expect(provider.retirements()).toEqual([SAVED]); // P3-F F-connectors 7: the replaced record's retirement, for the owner's row
    const held = prepare();
    await vi.waitFor(() => expect(closeAnswers).toHaveLength(2)); // retried for the old connection, the same floor
    expect(closes[1]).toEqual({ connectionId: SAVED, credentialEpoch: old.credentialEpoch });
    closeAnswers[1]!.resolve(false);
    expect(await held).toEqual({ ok: false });
    closeAnswers = null;
    expect(credentialOf(await prepare())).toMatchObject({ connectionId: FRESH, accessToken: 'at-9' });
    expect(provider.disconnecting(SAVED)).toBeNull();
    expect(provider.retirements()).toEqual([]);
  });

  it('an unanswered old close times out as unconfirmed and holds the replacement', async () => {
    await seed();
    await prepare();
    closeAnswers = [];
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const replacing = provider.reconnect(source());
      await vi.waitFor(() => expect(flow.connects).toHaveLength(1));
      await vi.advanceTimersByTimeAsync(OAUTH_HOST_CLOSE_TIMEOUT_MS);
      expect(provider.disconnecting(SAVED)).toBe('unconfirmed');
      flow.connects[0]!.answer.resolve(grant(tokens(9)));
      expect(await replacing).toMatchObject({ ok: true });
      const held = prepare();
      await vi.waitFor(() => expect(closeAnswers).toHaveLength(2));
      await vi.advanceTimersByTimeAsync(OAUTH_HOST_CLOSE_TIMEOUT_MS);
      expect(await held).toEqual({ ok: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a failed Reconnect keeps the retirement through a later Connect: nothing new is delivered before the old close confirms', async () => {
    await seed();
    await prepare();
    closeAnswers = [];
    const replacing = provider.reconnect(source());
    await vi.waitFor(() => expect(closeAnswers).toHaveLength(1));
    closeAnswers[0]!.resolve(false);
    await vi.waitFor(() => expect(flow.connects).toHaveLength(1));
    flow.connects[0]!.answer.reject(new ConnectorOAuthError('denied'));
    expect(await replacing).toEqual({ ok: false, why: 'denied' });
    const connecting = provider.connect(source());
    await vi.waitFor(() => expect(flow.connects).toHaveLength(2));
    flow.connects[1]!.answer.resolve(grant(tokens(4)));
    expect(await connecting).toEqual({ ok: true, connectionId: FRESH2, reused: false });
    const held = prepare();
    await vi.waitFor(() => expect(closeAnswers).toHaveLength(2));
    closeAnswers[1]!.resolve(false);
    expect(await held).toEqual({ ok: false });
    expect(provider.disconnecting(SAVED)).toBe('unconfirmed');
    closeAnswers = null;
    expect(credentialOf(await prepare())).toMatchObject({ connectionId: FRESH2, accessToken: 'at-4' });
  });
});

describe('lifetime', () => {
  it('stop ends a demand waiting on a refresh and refuses later work', async () => {
    await seed(tokens(1, { expiresAt: NOW }));
    const pending = prepare();
    await vi.waitFor(() => expect(flow.refreshes).toHaveLength(1));
    provider.stop();
    expect(flow.refreshes[0]!.signal.aborted).toBe(true);
    flow.refreshes[0]!.answer.resolve(tokens(2));
    expect(await pending).toEqual({ ok: false });
    expect(await prepare()).toEqual({ ok: false });
    expect(await provider.connect(source())).toEqual({ ok: false, why: 'stopped' });
    expect(events).not.toContain('seal:at-2');
  });

  it('stop cancels an owner flow; its late grant is not saved', async () => {
    const connecting = provider.connect(source());
    await vi.waitFor(() => expect(flow.connects).toHaveLength(1));
    provider.stop();
    expect(flow.connects[0]!.signal.aborted).toBe(true);
    flow.connects[0]!.answer.resolve(grant(tokens(5)));
    expect(await connecting).toEqual({ ok: false, why: 'cancelled' });
    expect(onDisk()).toEqual([]);
  });

  it('the host’s attachment ending ends its waiting demands and owner flows; a rotation in flight is still saved, guarded, for the next attachment', async () => {
    await seed(tokens(1, { expiresAt: NOW }));
    const waiting = prepare();
    await vi.waitFor(() => expect(flow.refreshes).toHaveLength(1));
    const other = source({ server: 'second', entryPath: ['mcpServers', 'second'] });
    const connecting = provider.connect(other);
    await vi.waitFor(() => expect(flow.connects).toHaveLength(1));
    provider.hostLost();
    expect(await waiting).toEqual({ ok: false });
    expect(flow.connects[0]!.signal.aborted).toBe(true);
    flow.connects[0]!.answer.resolve(grant(tokens(7)));
    expect(await connecting).toEqual({ ok: false, why: 'cancelled' });
    flow.refreshes[0]!.answer.resolve(tokens(2));
    await vi.waitFor(async () => expect((await reread())?.tokens.accessToken).toBe('at-2'));
    expect(onDisk()).toEqual([`${SAVED}.sealed`]);
    expect(credentialOf(await prepare())).toMatchObject({ connectionId: SAVED, accessToken: 'at-2' });
    expect(flow.refreshes).toHaveLength(1);
  });

  it('touches the store only on demand', async () => {
    const store = storeOf();
    const list = vi.spyOn(store, 'list');
    const read = vi.spyOn(store, 'read');
    provider.stop();
    provider = makeProvider(store);
    provider.hostLost();
    expect(list).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
});

// P3-HD M3c2 correction: the owner's seam, main-only. A notice carries nothing; the owner reads the state again. The
// provider's authority and fences are unchanged: these only announce what an owner's row would show differently.
describe('owner notifications and the unattributed snapshot', () => {
  it('announces an owner flow’s creation and its end, with no payload', async () => {
    const heard: unknown[][] = [];
    provider.onChange((...args: unknown[]) => void heard.push(args));
    const connecting = provider.connect(source());
    await vi.waitFor(() => expect(flow.connects).toHaveLength(1));
    expect(heard.length).toBeGreaterThan(0); // the flow (and its connection id) exists now
    expect(await provider.state(IDENTITY)).toEqual({ state: 'connecting', connectionId: FRESH });
    const before = heard.length;
    flow.connects[0]!.answer.resolve(grant());
    expect(await connecting).toEqual({ ok: true, connectionId: FRESH, reused: false });
    expect(heard.length).toBeGreaterThan(before);
    expect(heard.every((args) => args.length === 0)).toBe(true);
  });

  it('announces a cold 401’s parking and a demand’s rejected refresh', async () => {
    const heard = vi.fn();
    provider.onChange(heard);
    provider.unauthorized({ source: source(), purpose: 'call', credential: null });
    expect(heard).toHaveBeenCalled();
    expect(await provider.state(IDENTITY)).toEqual({ state: 'needsConnect' });
    provider.stop();
    provider = makeProvider();
    await seed(tokens(1, { expiresAt: NOW + 30_000 }));
    const later = vi.fn();
    provider.onChange(later);
    const demand = prepare();
    await vi.waitFor(() => expect(flow.refreshes).toHaveLength(1));
    later.mockClear();
    flow.refreshes[0]!.answer.reject(new ConnectorOAuthError('rejected'));
    expect(await demand).toEqual({ ok: false });
    expect(later).toHaveBeenCalled();
    expect(await provider.state(IDENTITY)).toEqual({ state: 'needsReconnect', connectionId: SAVED });
  });

  // P3-HD panel correction: closes the access-only-401 status debt; an open sheet re-reads on the notice
  it('announces a 401 for an access-only token at once: its state turns needsReconnect without another demand', async () => {
    await seed(tokens(1, { refreshToken: undefined }));
    const used = credentialOf(await prepare()) as { connectionId: string; credentialEpoch: number };
    expect(await provider.state(IDENTITY)).toMatchObject({ state: 'connected' });
    const heard = vi.fn();
    provider.onChange(heard);
    provider.unauthorized({ source: source(), purpose: 'call', credential: { connectionId: used.connectionId, credentialEpoch: used.credentialEpoch } });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(await provider.state(IDENTITY)).toEqual({ state: 'needsReconnect', connectionId: SAVED });
    provider.unauthorized({ source: source(), purpose: 'call', credential: { connectionId: used.connectionId, credentialEpoch: used.credentialEpoch } });
    expect(heard).toHaveBeenCalledTimes(1); // the same rejection again changes nothing
  });

  it('announces a retirement while it is pending, unconfirmed and cleared', async () => {
    await seed();
    await prepare();
    const heard = vi.fn();
    provider.onChange(heard);
    closeAnswers = [];
    const disconnecting = provider.disconnect(SAVED);
    expect(heard).toHaveBeenCalled();
    await vi.waitFor(() => expect(closeAnswers).toHaveLength(1));
    heard.mockClear();
    closeAnswers[0]!.resolve(false);
    await disconnecting;
    expect(provider.disconnecting(SAVED)).toBe('unconfirmed');
    expect(heard).toHaveBeenCalled();
    heard.mockClear();
    provider.hostLost();
    expect(heard).toHaveBeenCalled();
  });

  it('says when a forgotten connection’s identity was never learned, even a readable record whose read timed out', async () => {
    await seed();
    expect(provider.withdrawnUnattributed()).toBe(false);
    sealer.openHangs = true;
    const heard = vi.fn();
    provider.onChange(heard);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const disconnecting = provider.disconnect(SAVED);
      await vi.advanceTimersByTimeAsync(OAUTH_FORGET_READ_TIMEOUT_MS);
      await disconnecting;
    } finally {
      vi.useRealTimers();
    }
    expect(provider.withdrawnUnattributed()).toBe(true);
    expect(heard).toHaveBeenCalled();
  });

  it('a forget whose record was read is attributed: the snapshot stays false', async () => {
    await seed();
    await provider.disconnect(SAVED);
    expect(provider.withdrawnUnattributed()).toBe(false);
  });

  it('stops announcing once unsubscribed, and a listener that throws harms nothing', async () => {
    const heard = vi.fn();
    const off = provider.onChange(heard);
    provider.onChange(() => {
      throw new Error('a listener failed');
    });
    off();
    provider.unauthorized({ source: source(), purpose: 'call', credential: null });
    expect(heard).not.toHaveBeenCalled();
    expect(await provider.state(IDENTITY)).toEqual({ state: 'needsConnect' });
  });
});
