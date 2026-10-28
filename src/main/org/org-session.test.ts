// The production org session (P5 O8 M1, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M1's Decisions and
// Proves, Interfaces §A-§C): registration step by step and each refusal, the file order and a crash between files,
// startup from the files with no network, current()'s conditions, onChanged at each trigger, the token's end, `denied`,
// sign out and sign in, re-anchoring, and the fresh token's grace. Over an in-memory hub (an injected fetch) serving
// real signed org states and approving as the approving device would, the device's real keys in a temporary profile
// (backup exclusion stubbed), and a fake Registry feed the tests drive.
import { readFileSync } from 'node:fs';
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  base64urlDecode,
  base64urlEncode,
  encodePairingCode,
  endorseDevice,
  generateSigningKey,
  keyId,
  NO_CERTIFICATES,
  pairingFingerprint,
  signOrgState,
  signRecord,
  SIGNING_DOMAINS,
  stateHash,
  verifyPairingMac,
  type Certificates,
  type Device,
  type OrgState,
  type RevokedKey,
  type RootTransition,
  type Signed,
  type SignedOrgState,
  type SigningKey,
} from '../../../apps/org-protocol/src/index.ts';
import type { OrgStatus } from '@shared/ipc/schema/org';
import { DeviceKeysError, loadDeviceKeys, type DeviceKeys } from '../device/keys';
import { AccessLoginError, type AccessLogin, type HubCredential } from './access-login';
import { ACCESS_FILE, CHAIN_FILE, orgFiles, REGISTRATION_FILE, type OrgFiles, type RegistrationFile } from './files';
import type { PendingEntry } from './hub-client';
import { createOrgSession, type OrgSessionDeps, type OrgSessionService } from './org-session';
import type { RegistryFeedHooks } from './registry-feed';

// ---- the org, signed as an admin's devices sign it (held.test.ts's helpers) ----

type TestDevice = { device: Device; channel: SigningKey; stepUp: SigningKey };

async function newDevice(id: string): Promise<TestDevice> {
  const channel = await generateSigningKey();
  const stepUp = await generateSigningKey();
  return { channel, stepUp, device: { id, class: 'native-mac', keyStorage: 'software', channelPub: channel.pub, stepUpPub: stepUp.pub } };
}

const iso = (ms: number) => new Date(ms).toISOString();
const memberId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

async function genesis(admin: string, device: TestDevice, recoveryKey: SigningKey, org = ORG): Promise<SignedOrgState> {
  const state: OrgState = {
    org,
    version: 1,
    prev: null,
    issued: iso(Date.now() - 10 * DAY),
    root: { keys: [await keyId(device.stepUp.pub)], recoveryPub: recoveryKey.pub },
    members: [{ id: admin, email: OWNER, role: 'admin', devices: [device.device] }],
    machines: [],
    machineNames: [],
    retired: [],
    revoked: [],
    delegations: [],
    projects: [],
  };
  return signOrgState(state, [device.stepUp]);
}

async function successor(head: SignedOrgState, signers: TestDevice[], edit: (s: OrgState) => void | Promise<void> = () => {}): Promise<SignedOrgState> {
  const state = structuredClone(head.state);
  state.version += 1;
  state.prev = await stateHash(head.state);
  const at = iso(Date.now());
  state.issued = at > head.state.issued ? at : head.state.issued;
  await edit(state);
  return signOrgState(state, signers.map((d) => d.stepUp));
}

async function revokedDevice(member: string, device: Omit<Device, 'endorsement'>): Promise<RevokedKey[]> {
  const keys: Array<['channel' | 'step-up', string]> = [
    ['channel', device.channelPub],
    ['step-up', device.stepUpPub!],
  ];
  return Promise.all(keys.map(async ([key, pub]) => ({ keyId: await keyId(pub), holder: { member, device: device.id, class: device.class, key } })));
}

/** The entry this profile's keys make, as the org state lists it. */
async function entryOf(keys: DeviceKeys): Promise<Omit<Device, 'endorsement'>> {
  return { id: await keyId(keys.channel.pub), class: 'native-mac', keyStorage: 'software', channelPub: keys.channel.pub, stepUpPub: keys.stepUp.pub };
}

/** A successor listing `device` under member A, endorsed by `by` (a1 unless another root signs). */
async function listing(head: SignedOrgState, device: Omit<Device, 'endorsement'>, by: TestDevice = a1): Promise<SignedOrgState> {
  const endorsement = await endorseDevice(head.state.org, A, device, by.stepUp.privateKey, by.stepUp.pub);
  return successor(head, [by], (s) => void s.members[0].devices.push({ ...device, endorsement }));
}

/** A successor dropping `device` from member A, its keys revoked. */
async function dropping(head: SignedOrgState, device: Omit<Device, 'endorsement'>): Promise<SignedOrgState> {
  return successor(head, [a1], async (s) => {
    s.members[0].devices = s.members[0].devices.filter((d) => d.id !== device.id);
    s.revoked.push(...(await revokedDevice(A, device)));
  });
}

// ---- the hub ----

type Answer = Response | 'unreachable';
const worker = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-desk-build': 'test 0.0.0' } });
/** Access's answer: no X-Desk-Build. */
const access = (status: number) => (status >= 300 && status < 400 ? new Response(null, { status, headers: { location: 'https://team.cloudflareaccess.com/login' } }) : new Response('<html>Access</html>', { status }));

/** An in-memory hub: `/api/me`, `/api/org/state[?since=]` paged, `POST /api/devices/pending`. Each route can be overridden. */
class FakeHub {
  chain: SignedOrgState[] = [];
  transitions: Signed<RootTransition>[] = [];
  certificates: Certificates = NO_CERTIFICATES;
  pageSize = 2;
  calls: Array<{ method: string; path: string; headers: Record<string, string> }> = [];
  pending: PendingEntry[] = [];
  pendingTtlMs = 60_000;
  member: { id: string; email: string };
  meAnswer?: (n: number) => Answer | undefined;
  stateAnswer?: (since: string | null) => Answer | undefined;
  pendingAnswer?: () => Answer | undefined;

  constructor(
    readonly url: string,
    member: { id: string; email: string },
  ) {
    this.member = member;
  }

  get head(): SignedOrgState {
    return this.chain[this.chain.length - 1];
  }

  count(path: string): number {
    return this.calls.filter((c) => c.path === path || c.path.startsWith(`${path}?`)).length;
  }

  readonly fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (init?.signal?.aborted) throw init.signal.reason;
    const url = new URL(String(input));
    if (url.origin !== this.url) throw new TypeError(`fetch failed: ${url.origin} is not the hub`);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const method = init?.method ?? 'GET';
    this.calls.push({ method, path: `${url.pathname}${url.search}`, headers });
    const answer = await this.route(method, url, headers, init);
    if (answer === 'unreachable') throw new TypeError('fetch failed');
    return answer;
  }) as typeof fetch;

  private async route(method: string, url: URL, headers: Record<string, string>, init?: RequestInit): Promise<Answer> {
    if (headers['cf-access-token'] === undefined && headers['x-desk-standin-user'] === undefined) return access(302);
    if (method === 'GET' && url.pathname === '/api/me') {
      return this.meAnswer?.(this.count('/api/me') - 1) ?? worker(200, { org: { id: ORG }, member: { ...this.member, role: 'admin' } });
    }
    if (method === 'GET' && url.pathname === '/api/org/state') {
      const since = url.searchParams.get('since');
      const override = this.stateAnswer?.(since);
      if (override !== undefined) return override;
      const view = { head: this.head ?? null, transitions: this.transitions, certificates: this.certificates };
      if (since === null) return worker(200, view);
      const after = this.chain.filter((s) => s.state.version > Number(since));
      return worker(200, { ...view, chain: after.slice(0, this.pageSize), ...(after.length > this.pageSize ? { more: true } : {}) });
    }
    if (method === 'POST' && url.pathname === '/api/devices/pending') {
      this.pending.push(JSON.parse(String(init?.body)) as PendingEntry);
      return this.pendingAnswer?.() ?? worker(200, { pending: { expires: iso(Date.now() + this.pendingTtlMs) } });
    }
    return worker(404, { error: 'not-found' });
  }

  /** The approving device: checks the entry's MAC under `k`, then signs a successor listing it under A. */
  async approve(k: string): Promise<Omit<Device, 'endorsement'>> {
    const entry = this.pending.at(-1)!;
    const device: Omit<Device, 'endorsement'> = { id: entry.deviceId, class: entry.class, keyStorage: entry.keyStorage, channelPub: entry.channelPub, stepUpPub: entry.stepUpPub };
    expect(await verifyPairingMac(base64urlDecode(k), { org: ORG, member: A, device }, entry.mac)).toBe(true);
    this.chain.push(await listing(this.head, device));
    return device;
  }
}

// ---- the login and the secrets no status may carry ----

const secrets: string[] = [];
const b64json = (value: unknown) => base64urlEncode(new TextEncoder().encode(JSON.stringify(value)));

/** An Access app token as the login keeps it: a JWT whose `exp` and `email` the session reads unverified. */
function token(email: string, expiresMs: number): HubCredential {
  const text = [b64json({ alg: 'RS256' }), b64json({ exp: Math.floor(expiresMs / 1000), email, n: memberId() }), `sig${memberId()}`].join('.');
  secrets.push(text);
  return { kind: 'access', token: text, expires: iso(expiresMs), email };
}

const rejectOnAbort = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => {
    const abort = () => reject(new AccessLoginError('cancelled', 'the login was cancelled'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });

/** The Access login: a fresh token for `email` living `ttl()` ms; `hold()` keeps the next logins waiting in the browser. */
function testLogin(email = OWNER, ttl: () => number = () => HOUR) {
  let held: Promise<void> | null = null;
  const fn = vi.fn<AccessLogin>(async (_hub, { signal }) => {
    if (held !== null) await Promise.race([held, rejectOnAbort(signal)]);
    if (signal.aborted) throw new AccessLoginError('cancelled', 'the login was cancelled');
    return token(email, Date.now() + ttl());
  });
  return Object.assign(fn, {
    hold(): () => void {
      let release!: () => void;
      held = new Promise((resolve) => (release = resolve));
      return () => {
        held = null;
        release();
      };
    },
  });
}

async function pairing(input: { hub?: string; org?: string; member?: string; root?: TestDevice; recoveryPub?: string } = {}): Promise<{ text: string; k: string }> {
  const k = base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
  const text = encodePairingCode({
    hub: input.hub ?? HUB,
    org: input.org ?? ORG,
    member: input.member ?? A,
    roots: [await keyId((input.root ?? a1).stepUp.pub)],
    recoveryPub: input.recoveryPub ?? recovery.pub,
    k,
  });
  secrets.push(text, k);
  return { text, k };
}

// ---- the session under test ----

const ORG = 'org-session-test';
const HUB = 'https://hub.example.test';
const LOCAL_HUB = 'http://127.0.0.1:8787';
const OWNER = 'owner@example.com';
const DAY = 86_400_000;
const HOUR = 3_600_000;
const TIMING = { APPROVAL_POLL_MS: 10, FETCH_TIMEOUT_MS: 2_000, FRESH_TOKEN_GRACE_MS: 300, FRESH_TOKEN_RETRY_MS: [10], TOKEN_SKEW_MS: 1_000, CERTS_REFRESH_MS: 3_600_000 };

let userData: string;
let A: string;
let a1: TestDevice;
let recovery: SigningKey;
let s1: SignedOrgState;
let hub: FakeHub;
let opened: OrgSessionService[];
let emitted: string[];

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'maws-org-session-'));
  A = memberId();
  a1 = await newDevice('a1');
  recovery = await generateSigningKey();
  s1 = await genesis(A, a1, recovery);
  hub = new FakeHub(HUB, { id: A, email: OWNER });
  hub.chain = [s1];
  opened = [];
  emitted = [];
  secrets.length = 0;
});

afterEach(async () => {
  for (const session of opened) await session.close();
  // No status ever emitted carries a token, a pairing code or its secret.
  for (const text of emitted) for (const secret of secrets) expect(text).not.toContain(secret);
  await chmod(join(userData, 'org'), 0o700).catch(() => {});
  await rm(userData, { recursive: true, force: true });
});

type Overrides = Partial<Omit<OrgSessionDeps, 'timing'>> & { timing?: Partial<typeof TIMING> & OrgSessionDeps['timing'] };

/** A session over `userData` and `hub`, its statuses, onChanged calls, key loads and log kept. */
function make(over: Overrides = {}) {
  const logs: string[] = [];
  const statuses: OrgStatus[] = [];
  let changes = 0;
  let keyLoads = 0;
  const { timing, ...rest } = over;
  const session = createOrgSession({
    userData,
    build: 'maws-test 0.0.0',
    packaged: false,
    env: {},
    openExternal: () => {
      throw new Error('the tests open no browser');
    },
    stepUp: () => ({ sign: () => Promise.reject(new Error('no step-up in these tests')) }),
    loadKeys: (profile, deps) => {
      keyLoads++;
      return loadDeviceKeys(profile, { ...deps, excludeFromBackup: async () => true });
    },
    excludeFromBackup: async () => true,
    login: testLogin(),
    fetch: hub.fetch,
    log: (line) => void logs.push(line),
    ...rest,
    timing: { ...TIMING, ...timing },
  });
  session.onStatus((status) => {
    statuses.push(status);
    emitted.push(JSON.stringify(status));
  });
  session.onChanged(() => void changes++);
  opened.push(session);
  return { session, statuses, logs, changes: () => changes, keyLoads: () => keyLoads };
}

/** The feed's notices, driven by the test. */
function fakeFeed() {
  const sets = { open: new Set<() => void>(), close: new Set<() => void>(), state: new Set<(v: number) => void>(), removed: new Set<() => void>(), ended: new Set<() => void>() };
  const on =
    <T>(set: Set<T>) =>
    (listener: T) => {
      set.add(listener);
      return () => void set.delete(listener);
    };
  const hooks: RegistryFeedHooks = { onOpen: on(sets.open), onClose: on(sets.close), onState: on(sets.state), onRemoved: on(sets.removed), onCredentialsEnded: on(sets.ended) };
  return {
    hooks,
    open: () => sets.open.forEach((l) => l()),
    close: () => sets.close.forEach((l) => l()),
    state: (version: number) => sets.state.forEach((l) => l(version)),
    removed: () => sets.removed.forEach((l) => l()),
    credentialsEnded: () => sets.ended.forEach((l) => l()),
  };
}

async function until(check: () => boolean | Promise<boolean>, what: string, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Registered = Extract<OrgStatus, { state: 'registered' }>;
function registered(session: OrgSessionService): Registered {
  const status = session.status();
  if (status.state !== 'registered') throw new Error(`the status is ${JSON.stringify(status)}`);
  return status;
}
const isSignedIn = (session: OrgSessionService) => {
  const status = session.status();
  return status.state === 'registered' && status.session === 'signed-in' && status.hubAccess !== 'signing-in';
};

const preKeys = () => loadDeviceKeys(userData, { excludeFromBackup: async () => true });
const orgDir = () => join(userData, 'org');
const readJson = async <T>(name: string): Promise<T> => JSON.parse(await readFile(join(orgDir(), name), 'utf8')) as T;
const exists = (path: string) =>
  readFile(path).then(
    () => true,
    () => false,
  );
const dirExists = (path: string) =>
  readdir(path).then(
    () => true,
    () => false,
  );
const realFiles = () => orgFiles({ userData, log: () => {} });

/** orgFiles whose next write of the armed name waits for `release`; `arm` resolves when that write is held. */
function gatedFiles() {
  const real = realFiles();
  let armed: { name: string; held: () => void } | null = null;
  let release: () => void = () => {};
  const files: OrgFiles = {
    ...real,
    write: async (name, value) => {
      if (armed !== null && armed.name === name) {
        const { held } = armed;
        armed = null;
        await new Promise<void>((resolve) => {
          release = resolve;
          held();
        });
      }
      return real.write(name, value);
    },
  };
  return { files, arm: (name: string) => new Promise<void>((resolve) => (armed = { name, held: resolve })), release: () => release() };
}

/** A profile signed in on [s1, s2 listing this device]: keys made first, so registration is done at `checking`. */
async function signedIn(over: Overrides = {}) {
  const keys = await preKeys();
  const entry = await entryOf(keys);
  hub.chain.push(await listing(hub.head, entry));
  const made = make(over);
  await made.session.loaded;
  const code = await pairing();
  expect(made.session.register(code.text)).toEqual({ ok: true });
  await until(() => isSignedIn(made.session), 'signed in');
  return { ...made, keys, entry, code };
}

/** The same profile started again: a new session over the files. */
async function restart(over: Overrides = {}) {
  for (const session of opened) await session.close();
  const made = make(over);
  await made.session.loaded;
  return made;
}

// ---- registration ----

describe('registration', () => {
  it('runs browser, checking and approval: keys made after /api/me, the MAC-bound entry posted with its fingerprint, signed in once the approving device lists it', async () => {
    const { session, statuses, changes, keyLoads } = make();
    await session.loaded;
    let keyLoadsAtMe = -1;
    hub.meAnswer = () => void (keyLoadsAtMe = keyLoads());
    const code = await pairing();
    expect(session.register(`  ${code.text}\n`)).toEqual({ ok: true });
    expect(session.status()).toEqual({ state: 'registering', step: 'browser', org: ORG, hub: HUB, fingerprint: null, expires: null });

    await until(() => session.status().state === 'registering' && (session.status() as { step: string }).step === 'approval', 'approval');
    expect(keyLoadsAtMe).toBe(0);
    expect(keyLoads()).toBe(1);
    expect(hub.pending).toHaveLength(1);
    const keys = await preKeys();
    const entry = await entryOf(keys);
    expect(hub.pending[0]).toMatchObject({ deviceId: entry.id, class: 'native-mac', keyStorage: 'software', channelPub: keys.channel.pub, stepUpPub: keys.stepUp.pub });
    const approval = session.status();
    expect(approval).toMatchObject({ state: 'registering', step: 'approval', fingerprint: await pairingFingerprint(ORG, A, entry) });
    expect(Date.parse((approval as { expires: string }).expires)).toBeGreaterThan(Date.now());
    expect(session.current()).toBeNull();
    expect(await dirExists(orgDir())).toBe(false);

    const before = changes();
    await hub.approve(code.k);
    await until(() => isSignedIn(session), 'signed in');
    expect(changes()).toBeGreaterThan(before);
    const steps = statuses.filter((s) => s.state === 'registering').map((s) => (s as { step: string }).step);
    expect([...new Set(steps)]).toEqual(['browser', 'checking', 'approval']);

    const current = session.current()!;
    expect(current.identity).toEqual({ org: ORG, member: A, device: entry.id, clientClass: 'native-mac', channelKey: keys.channel, build: 'maws-test 0.0.0', capabilities: [] });
    expect(current.view.head()).toEqual(hub.head);
    expect(current.hub?.url).toBe(HUB);
    expect(Object.keys(await current.hub!.headers())).toEqual(['cf-access-token']);
    expect(registered(session)).toMatchObject({ org: ORG, hub: HUB, member: { id: A, email: OWNER }, device: entry.id, session: 'signed-in', hubAccess: 'connecting', head: { version: 2 }, problem: null });
    const reg = await readJson<RegistrationFile>(REGISTRATION_FILE);
    expect(reg).toMatchObject({ version: 1, hub: HUB, org: ORG, member: { id: A, email: OWNER }, device: entry.id, pins: { roots: [await keyId(a1.stepUp.pub)], recoveryPub: recovery.pub }, signedOut: false });
    expect(reg.anchor).toEqual({ genesis: await stateHash(s1.state), version: 2, head: await stateHash(hub.head.state) });
  });

  it('is done at `checking` when the head already lists this device with these keys: nothing posted', async () => {
    const { session, entry } = await signedIn();
    expect(hub.count('/api/devices/pending')).toBe(0);
    expect(session.current()?.identity.device).toBe(entry.id);
  });

  it('reads the chain from genesis in every page', async () => {
    const keys = await preKeys();
    for (let i = 0; i < 4; i++) hub.chain.push(await successor(hub.head, [a1]));
    hub.chain.push(await listing(hub.head, await entryOf(keys)));
    hub.pageSize = 2;
    const { session } = make();
    await session.loaded;
    session.register((await pairing()).text);
    await until(() => isSignedIn(session), 'signed in');
    expect(hub.calls.filter((c) => c.path.startsWith('/api/org/state?since=')).map((c) => c.path)).toEqual(['/api/org/state?since=0', '/api/org/state?since=2', '/api/org/state?since=4']);
    expect(session.current()!.view.head().state.version).toBe(6);
  });

  it('registers through the stand-in on a loopback hub in an unpackaged build, with no browser', async () => {
    hub = new FakeHub(LOCAL_HUB, { id: A, email: OWNER });
    hub.chain = [s1];
    const keys = await preKeys();
    hub.chain.push(await listing(hub.head, await entryOf(keys)));
    const login = testLogin();
    const { session } = make({ env: { MAWS_DEV_STANDIN_USER: OWNER }, login, fetch: hub.fetch });
    await session.loaded;
    expect(session.register((await pairing({ hub: LOCAL_HUB })).text)).toEqual({ ok: true });
    await until(() => isSignedIn(session), 'signed in');
    expect(login).not.toHaveBeenCalled();
    expect(hub.calls.every((c) => c.headers['x-desk-standin-user'] === OWNER)).toBe(true);
    expect(await session.current()!.hub!.headers()).toEqual({ 'x-desk-standin-user': OWNER });
    expect(await readJson(ACCESS_FILE)).toEqual({ version: 1, hub: LOCAL_HUB, kind: 'standin', user: OWNER });
  });

  it('cancel stops the wait for approval, writes nothing and reads `none`', async () => {
    const { session } = make();
    await session.loaded;
    const code = await pairing();
    session.register(code.text);
    await until(() => hub.pending.length === 1, 'the entry posted');
    session.cancel();
    expect(session.status()).toEqual({ state: 'none' });
    await hub.approve(code.k);
    await pause(60);
    expect(session.status()).toEqual({ state: 'none' });
    expect(session.current()).toBeNull();
    expect(await dirExists(orgDir())).toBe(false);
  });

  it('logs an attempt\'s end at quit at once, even with its work still held', async () => {
    const login = testLogin();
    const { session, logs } = make({ login });
    await session.loaded;
    login.hold();
    session.register((await pairing()).text);
    await until(() => login.mock.calls.length === 1, 'the login');
    await session.close();
    expect(logs.filter((line) => /^\[org\] attempt \d+/.test(line)).map((line) => line.slice(6))).toEqual([
      `attempt 1: register (org ${ORG}), pid ${process.pid}`,
      'attempt 1: ended by quit',
    ]);
  });

  it('logs each attempt\'s start and its end, a cancel included, so two browser trips in a log always show why', async () => {
    const { session, logs } = make();
    await session.loaded;
    const code = await pairing();
    // The entry reaches the hub before the session moves to its approval step (the fingerprint is computed between
    // them), so each cancel waits for the step itself, not the hub's count.
    const awaiting = () => session.status().state === 'registering' && (session.status() as { step: string }).step === 'approval';
    session.register(code.text);
    await until(() => hub.pending.length === 1 && awaiting(), 'the entry posted');
    session.cancel();
    session.register(code.text);
    await until(() => hub.pending.length === 2 && awaiting(), 'the second entry posted');
    session.cancel();
    const attempts = logs.filter((line) => /^\[org\] attempt \d+/.test(line)).map((line) => line.slice(6));
    expect(attempts).toEqual([
      `attempt 1: register (org ${ORG}), pid ${process.pid}`,
      'attempt 1: cancelled at approval',
      `attempt 2: register (org ${ORG}), pid ${process.pid}`,
      'attempt 2: cancelled at approval',
    ]);
  });

  it('logs an attempt that completes and one that is refused', async () => {
    const { session, logs } = make();
    await session.loaded;
    const bad = await pairing();
    hub.pendingAnswer = () => worker(409, { error: 'too-many' });
    session.register(bad.text);
    await until(() => logs.includes('[org] attempt 1: refused hub'), 'refused');
    hub.pendingAnswer = undefined;
    const before = hub.pending.length;
    const code = await pairing();
    session.register(code.text);
    await until(() => hub.pending.length === before + 1 && session.status().state === 'registering' && (session.status() as { step: string }).step === 'approval', 'the entry posted');
    await hub.approve(code.k);
    await until(() => isSignedIn(session), 'signed in');
    expect(logs.filter((line) => /^\[org\] attempt \d+/.test(line)).map((line) => line.slice(6))).toEqual([
      `attempt 1: register (org ${ORG}), pid ${process.pid}`,
      'attempt 1: refused hub',
      `attempt 2: register (org ${ORG}), pid ${process.pid}`,
      'attempt 2: done',
    ]);
  });

  it('cancel in the browser aborts the login', async () => {
    const login = testLogin();
    const { session } = make({ login });
    await session.loaded;
    login.hold();
    session.register((await pairing()).text);
    await until(() => login.mock.calls.length === 1, 'the login');
    session.cancel();
    expect(login.mock.calls[0][1].signal.aborted).toBe(true);
    expect(session.status()).toEqual({ state: 'none' });
    expect(hub.calls).toEqual([]);
  });
});

describe('registration refusals', () => {
  /** Starts a registration on a fresh profile and waits for its end; nothing is written in `<userData>/org/`. */
  async function refusedWith(code: string, over: Overrides = {}) {
    const made = make(over);
    await made.session.loaded;
    expect(made.session.register(code)).toEqual({ ok: true });
    await until(() => made.session.status().state === 'none', 'the attempt to end');
    expect(await dirExists(orgDir())).toBe(false);
    return { ...made, refused: (made.session.status() as { refused?: unknown }).refused };
  }

  it('bad-code: not a code, a loopback hub with no stand-in, or a packaged build; nothing is asked of anyone', async () => {
    const login = testLogin();
    const { session } = make({ login });
    await session.loaded;
    expect(session.register('smns-pair-v1.garbage')).toEqual({ ok: false, reason: { code: 'bad-code' } });
    const local = (await pairing({ hub: LOCAL_HUB })).text;
    expect(session.register(local)).toEqual({ ok: false, reason: { code: 'bad-code' } });
    await session.close();
    const packaged = make({ login, packaged: true, env: { MAWS_DEV_STANDIN_USER: OWNER } });
    await packaged.session.loaded;
    expect(packaged.session.register(local)).toEqual({ ok: false, reason: { code: 'bad-code' } });
    expect(login).not.toHaveBeenCalled();
    expect(hub.calls).toEqual([]);
    expect(await readdir(userData)).toEqual([]);
  });

  it('access: the login fails', async () => {
    const login = vi.fn<AccessLogin>(async () => {
      throw new AccessLoginError('browser', 'the browser did not open');
    });
    const { refused } = await refusedWith((await pairing()).text, { login });
    expect(refused).toEqual({ code: 'access', detail: 'browser' });
    expect(hub.calls).toEqual([]);
  });

  it('not-member: a Worker `403 not-a-member` names the email Access signed in, and is never retried', async () => {
    hub.meAnswer = () => worker(403, { error: 'not-a-member' });
    const { refused, keyLoads } = await refusedWith((await pairing()).text, { login: testLogin('stranger@example.com') });
    expect(refused).toEqual({ code: 'not-member', detail: 'stranger@example.com' });
    expect(hub.count('/api/me')).toBe(1);
    expect(keyLoads()).toBe(0);
  });

  it('not-member: /api/me names another member', async () => {
    hub.member = { id: memberId(), email: 'other@example.com' };
    const { refused } = await refusedWith((await pairing()).text);
    expect(refused).toEqual({ code: 'not-member', detail: 'other@example.com' });
  });

  it('keys: the device keys do not load', async () => {
    const loadKeys = async () => {
      throw new DeviceKeysError('not-private', join(userData, 'device'), 'is mode 755, wider than 700');
    };
    const { refused } = await refusedWith((await pairing()).text, { loadKeys });
    expect(refused).toEqual({ code: 'keys', detail: 'not-private' });
  });

  it('chain: the served chain is not signed by the pinned roots', async () => {
    const stranger = await newDevice('x1');
    const { refused } = await refusedWith((await pairing({ root: stranger })).text);
    expect(refused).toEqual({ code: 'chain', detail: 'not-root-signed' });
    expect(hub.count('/api/devices/pending')).toBe(0);
  });

  it('chain: the served head is of another org', async () => {
    hub.chain = [await genesis(A, a1, recovery, 'another-org')];
    const { refused } = await refusedWith((await pairing()).text);
    expect(refused).toMatchObject({ code: 'chain' });
  });

  it('removed: the device is listed under another member', async () => {
    const entry = await entryOf(await preKeys());
    hub.chain.push(await successor(hub.head, [a1], (s) => void s.members.push({ id: memberId(), email: 'b@example.com', role: 'member', devices: [entry] })));
    const { refused } = await refusedWith((await pairing()).text);
    expect(refused).toEqual({ code: 'removed', detail: 'this device is listed under another member' });
    expect(hub.count('/api/devices/pending')).toBe(0);
  });

  it('removed: the device\'s keys were revoked', async () => {
    const entry = await entryOf(await preKeys());
    hub.chain.push(await listing(hub.head, entry));
    hub.chain.push(await dropping(hub.head, entry));
    const { refused } = await refusedWith((await pairing()).text);
    expect(refused).toEqual({ code: 'removed', detail: 'this device\'s keys were removed from the org' });
  });

  it('expired: no approval before the pending entry\'s end', async () => {
    hub.pendingTtlMs = 150;
    const { refused } = await refusedWith((await pairing()).text);
    expect(refused).toEqual({ code: 'expired' });
    expect(hub.pending).toHaveLength(1);
  });

  it('hub: the pending list answers 409 too-many', async () => {
    hub.pendingAnswer = () => worker(409, { error: 'too-many' });
    const { refused } = await refusedWith((await pairing()).text);
    expect(refused).toEqual({ code: 'hub', detail: '409 too-many' });
  });

  it('hub: an error that is no code reads `unrecognized`, so a token the hub reflects reaches neither the status nor the log', async () => {
    hub.pendingAnswer = () => worker(409, { error: `bad ${hub.calls.at(-1)!.headers['cf-access-token']}` });
    const { refused, logs } = await refusedWith((await pairing()).text);
    expect(refused).toEqual({ code: 'hub', detail: '409 unrecognized' });
    for (const secret of secrets) expect(logs.join('\n')).not.toContain(secret);
  });

  it('busy: a second register or sign-in while one runs', async () => {
    const login = testLogin();
    const { session } = make({ login });
    await session.loaded;
    login.hold();
    const code = (await pairing()).text;
    expect(session.register(code)).toEqual({ ok: true });
    expect(session.register(code)).toEqual({ ok: false, reason: { code: 'busy' } });
    expect(session.signIn()).toMatchObject({ ok: false, reason: { code: 'busy' } });
    session.cancel();
  });

  it('other-org: with a registration held, a code for another org or hub', async () => {
    const { session } = await signedIn();
    expect(session.register((await pairing({ org: 'another-org' })).text)).toEqual({ ok: false, reason: { code: 'other-org' } });
    expect(session.register((await pairing({ hub: 'https://another-hub.example.test' })).text)).toEqual({ ok: false, reason: { code: 'other-org' } });
  });
});

// ---- the files ----

describe('the files', () => {
  /** orgFiles with each write's name recorded, and the first write of `fail` failing as a crash would. */
  function recordingFiles(fail?: string) {
    const real = realFiles();
    const writes: string[] = [];
    let failing = fail;
    const files: OrgFiles = {
      ...real,
      write: async (name, value) => {
        if (name === failing) {
          failing = undefined;
          throw new Error('the process died here');
        }
        writes.push(name);
        return real.write(name, value);
      },
    };
    return { files, writes };
  }

  it('writes chain.json, access.json, then registration.json, each 0600 in a 0700 directory', async () => {
    const { files, writes } = recordingFiles();
    await signedIn({ files });
    expect(writes).toEqual([CHAIN_FILE, ACCESS_FILE, REGISTRATION_FILE]);
    expect((await stat(orgDir())).mode & 0o777).toBe(0o700);
    for (const name of writes) expect((await stat(join(orgDir(), name))).mode & 0o777).toBe(0o600);
  });

  for (const [after, failing] of [
    ['chain.json', ACCESS_FILE],
    ['access.json', REGISTRATION_FILE],
  ] as const) {
    it(`a crash after ${after} reads \`none\` with no request, and the next attempt rewrites the files`, async () => {
      const keys = await preKeys();
      hub.chain.push(await listing(hub.head, await entryOf(keys)));
      const { files } = recordingFiles(failing);
      const first = make({ files });
      await first.session.loaded;
      first.session.register((await pairing()).text);
      await until(() => first.session.status().state === 'none', 'the attempt to end');
      expect(await exists(join(orgDir(), CHAIN_FILE))).toBe(true);
      expect(await exists(join(orgDir(), REGISTRATION_FILE))).toBe(false);

      const calls = hub.calls.length;
      const login = testLogin();
      const second = await restart({ login });
      expect(second.session.status()).toEqual({ state: 'none' });
      expect(second.session.current()).toBeNull();
      expect(hub.calls.length).toBe(calls);
      expect(login).not.toHaveBeenCalled();

      hub.chain.push(await successor(hub.head, [a1]));
      second.session.register((await pairing()).text);
      await until(() => isSignedIn(second.session), 'signed in');
      const chain = await readJson<{ chain: SignedOrgState[] }>(CHAIN_FILE);
      expect(chain.chain.at(-1)).toEqual(hub.head);
      expect(await readJson(ACCESS_FILE)).toMatchObject({ hub: HUB, kind: 'access' });
      expect((await readJson<RegistrationFile>(REGISTRATION_FILE)).anchor.version).toBe(3);
    });
  }
});

// ---- startup ----

describe('startup', () => {
  it('starts signed in from the files with no network and no login', async () => {
    const { entry } = await signedIn();
    const calls = hub.calls.length;
    const login = testLogin();
    const { session, keyLoads } = await restart({ login });
    expect(isSignedIn(session)).toBe(true);
    const current = session.current()!;
    expect(current.identity.device).toBe(entry.id);
    expect(current.view.head()).toEqual(hub.head);
    expect(current.hub?.url).toBe(HUB);
    expect(keyLoads()).toBe(1);
    await pause(30);
    expect(hub.calls.length).toBe(calls);
    expect(login).not.toHaveBeenCalled();
  });

  it('a never-signed-in profile makes no keys, no files and no requests', async () => {
    const login = testLogin();
    const { session, keyLoads, statuses } = make({ login });
    await session.loaded;
    await pause(30);
    expect(session.status()).toEqual({ state: 'none' });
    expect(statuses).toEqual([{ state: 'none' }]);
    expect(session.current()).toBeNull();
    expect(keyLoads()).toBe(0);
    expect(await readdir(userData)).toEqual([]);
    expect(hub.calls).toEqual([]);
    expect(login).not.toHaveBeenCalled();
  });
});

// ---- current() ----

describe('current()', () => {
  it('is null once signed out (the registration held, marked signed out)', async () => {
    const { session } = await signedIn();
    await session.signOut();
    expect(session.current()).toBeNull();
    expect(registered(session).session).toBe('signed-out');
  });

  it('is null once the held head drops this device, the registration still held (`removed`)', async () => {
    const { session, entry } = await signedIn();
    await session.current()!.view.advance([await dropping(hub.head, entry)], []);
    expect(session.current()).toBeNull();
    expect(registered(session)).toMatchObject({ session: 'removed', head: { version: 3 } });
    expect(await exists(join(orgDir(), REGISTRATION_FILE))).toBe(true);
  });

  it('is null when the keys are gone at startup, and none are made in their place', async () => {
    await signedIn();
    await rm(join(userData, 'device', 'keys.json'));
    const { session, keyLoads } = await restart();
    expect(session.current()).toBeNull();
    expect(registered(session).refused).toMatchObject({ code: 'keys' });
    expect(keyLoads()).toBe(0);
    expect(await readdir(join(userData, 'device'))).toEqual([]);
  });

  it('is null when the keys are not the ones the head lists', async () => {
    await signedIn();
    await rm(join(userData, 'device', 'keys.json'));
    await preKeys();
    const { session } = await restart();
    expect(session.current()).toBeNull();
    expect(registered(session).session).toBe('removed');
  });

  it('is null when <userData>/org/ fails its checks (`directory`), and a sign-in is refused', async () => {
    const { code } = await signedIn();
    await chmod(orgDir(), 0o755);
    const { session } = await restart();
    expect(session.current()).toBeNull();
    expect(registered(session).problem).toBe('directory');
    expect(session.signIn()).toEqual({ ok: false, reason: { code: 'directory' } });
    expect(session.register(code.text)).toEqual({ ok: false, reason: { code: 'directory' } });
  });
});

// ---- following the hub, and onChanged ----

describe('following the hub', () => {
  it('reads the chain since the head at the feed\'s open and at each announced version, telling onChanged after the file is written', async () => {
    const { session, changes } = await signedIn();
    const feed = fakeFeed();
    session.attach(feed.hooks);
    hub.calls.length = 0;
    feed.open();
    await until(() => hub.count('/api/org/state') === 1, 'the read at open');
    expect(hub.calls[0].path).toBe('/api/org/state?since=2');
    expect(registered(session).hubAccess).toBe('connected');

    let c = changes();
    hub.chain.push(await successor(hub.head, [a1]));
    feed.state(1); // not above the head: nothing read
    await pause(20);
    expect(hub.count('/api/org/state')).toBe(1);
    feed.state(3);
    await until(() => session.current()!.view.head().state.version === 3, 'version 3 adopted');
    await until(() => changes() > c, 'onChanged');

    // A link's handshake `advance`: persisted before onChanged fires.
    c = changes();
    const s4 = await successor(session.current()!.view.head(), [a1]);
    let onDisk: number | undefined;
    const off = session.onChanged(() => {
      onDisk = (JSON.parse(readFileSync(join(orgDir(), CHAIN_FILE), 'utf8')) as { chain: SignedOrgState[] }).chain.at(-1)?.state.version;
    });
    await session.current()!.view.advance([s4], []);
    off();
    expect(changes()).toBe(c + 1);
    expect(onDisk).toBe(4);
    expect(registered(session).head?.version).toBe(4);
    expect((await readJson<RegistrationFile>(REGISTRATION_FILE)).anchor.version).toBe(4);

    feed.close();
    expect(registered(session).hubAccess).toBe('connecting');
  });

  it('fires onChanged when the certificates the hub serves change', async () => {
    const { session, changes } = await signedIn({ timing: { CERTS_REFRESH_MS: 30 } });
    const c = changes();
    const delegation = await generateSigningKey();
    const body = { org: ORG, machine: 'a'.repeat(32), name: 'vm-one', pub: (await generateSigningKey()).pub, delegation: 'b'.repeat(32), use: 1, issued: new Date().toISOString() };
    const certificates: Certificates = { certs: [await signRecord(SIGNING_DOMAINS.machineCert, body, delegation.privateKey, delegation.pub)], retirements: [] };
    hub.certificates = certificates;
    await until(() => changes() > c, 'onChanged');
    expect(session.current()!.view.certificates()).toEqual(certificates);
  });

  it('a feed-started adoption whose chain.json write fails is logged, keeps the held head, and rejects nothing unhandled', async () => {
    const real = realFiles();
    let failChain = false;
    let failed = 0;
    const files: OrgFiles = { ...real, write: (name, value) => (failChain && name === CHAIN_FILE ? (failed++, Promise.reject(new Error('disk full'))) : real.write(name, value)) };
    const { session, logs } = await signedIn({ files });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => void unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const feed = fakeFeed();
      session.attach(feed.hooks);
      hub.chain.push(await successor(hub.head, [a1]));
      failChain = true;
      feed.state(3);
      await until(() => failed === 1, 'the chain.json write');
      await pause(30);
      expect(unhandled).toEqual([]);
      expect(logs.some((l) => l.includes('following the hub failed: disk full'))).toBe(true);
      expect(session.current()!.view.head().state.version).toBe(2);
      expect((await readJson<{ chain: SignedOrgState[] }>(CHAIN_FILE)).chain).toHaveLength(2);
      failChain = false;
      feed.state(3);
      await until(() => session.current()!.view.head().state.version === 3, 'version 3 adopted once the disk takes it');
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('refuses a served rollback and says so on the status, the device still signed in', async () => {
    const { session } = await signedIn();
    const feed = fakeFeed();
    session.attach(feed.hooks);
    hub.chain = [s1];
    feed.open();
    await until(() => registered(session).problem === 'rollback', 'the rollback refused');
    expect(session.current()!.view.head().state.version).toBe(2);
  });
});

// ---- the token's end ----

describe('the token\'s end', () => {
  it('by its clock: hub null and onChanged, the device still signed in', async () => {
    const ttl = TIMING.TOKEN_SKEW_MS + 1_000;
    const { session, changes } = await signedIn({ login: testLogin(OWNER, () => ttl) });
    expect(session.current()!.hub).not.toBeNull();
    const c = changes();
    await until(() => session.current()?.hub === null, 'the hub to end', 4_000);
    expect(changes()).toBeGreaterThan(c);
    expect(session.current()).not.toBeNull();
    expect(registered(session)).toMatchObject({ session: 'signed-in', hubAccess: 'expired' });
  });

  it('already past its time at startup: expired, no request', async () => {
    await signedIn();
    const file = await readJson<Record<string, unknown>>(ACCESS_FILE);
    await realFiles().write(ACCESS_FILE, { ...file, expires: iso(Date.now() - 1_000) });
    const calls = hub.calls.length;
    const { session } = await restart();
    expect(session.current()).not.toBeNull();
    expect(session.current()!.hub).toBeNull();
    expect(registered(session).hubAccess).toBe('expired');
    expect(hub.calls.length).toBe(calls);
  });

  it('by an Access answer to a hub read, and by the feed\'s upgrade; sign in again restores it', async () => {
    const { session, changes } = await signedIn();
    const feed = fakeFeed();
    session.attach(feed.hooks);
    hub.stateAnswer = () => access(401);
    const c = changes();
    feed.open();
    await until(() => registered(session).hubAccess === 'expired', 'expired');
    expect(changes()).toBeGreaterThan(c);
    expect(session.current()).not.toBeNull();
    expect(session.current()!.hub).toBeNull();

    hub.stateAnswer = undefined;
    expect(session.signIn()).toEqual({ ok: true });
    await until(() => isSignedIn(session) && session.current()?.hub !== null, 'signed in again');
    feed.credentialsEnded();
    expect(registered(session).hubAccess).toBe('expired');
    expect(session.current()!.hub).toBeNull();
  });
});

// ---- denied ----

describe('denied', () => {
  it('a `403 not-a-member` on a hub read reads `denied`; current() is unchanged until a verified head drops the device', async () => {
    const { session, entry } = await signedIn();
    const identity = session.current()!.identity;
    const feed = fakeFeed();
    session.attach(feed.hooks);
    hub.stateAnswer = () => worker(403, { error: 'not-a-member' });
    feed.open();
    await until(() => registered(session).hubAccess === 'denied', 'denied');
    expect(session.current()?.identity).toEqual(identity);
    expect(session.current()!.hub).toBeNull();
    expect(registered(session).session).toBe('signed-in');

    // The removing state arrives through a link's handshake.
    await session.current()!.view.advance([await dropping(hub.head, entry)], []);
    expect(session.current()).toBeNull();
    expect(registered(session)).toMatchObject({ session: 'removed', hubAccess: 'denied' });
  });

  it('a feed close 4403 reads `denied`, and signing in again retries', async () => {
    const { session } = await signedIn();
    const feed = fakeFeed();
    session.attach(feed.hooks);
    feed.removed();
    expect(registered(session).hubAccess).toBe('denied');
    expect(session.current()).not.toBeNull();
    expect(session.current()!.hub).toBeNull();
    expect(session.signIn()).toEqual({ ok: true });
    await until(() => session.current()?.hub != null, 'the hub again');
    expect(registered(session).hubAccess).toBe('connecting');
  });
});

// ---- sign out and sign in ----

describe('sign out and sign in', () => {
  it('sign out marks the registration and removes the token; sign in is the login alone', async () => {
    const { session, changes, keyLoads } = await signedIn();
    const anchor = (await readJson<RegistrationFile>(REGISTRATION_FILE)).anchor;
    let c = changes();
    await session.signOut();
    expect(changes()).toBeGreaterThan(c);
    expect(session.current()).toBeNull();
    expect(registered(session)).toMatchObject({ session: 'signed-out' });
    expect((await readJson<RegistrationFile>(REGISTRATION_FILE)).signedOut).toBe(true);
    expect(await exists(join(orgDir(), ACCESS_FILE))).toBe(false);

    c = changes();
    const calls = hub.calls.length;
    expect(session.signIn()).toEqual({ ok: true });
    expect(registered(session).hubAccess).toBe('signing-in');
    await until(() => isSignedIn(session), 'signed in');
    expect(changes()).toBeGreaterThan(c);
    expect(session.current()!.hub).not.toBeNull();
    expect(hub.calls.slice(calls).map((x) => x.path)).toEqual(['/api/me']);
    const reg = await readJson<RegistrationFile>(REGISTRATION_FILE);
    expect(reg.signedOut).toBe(false);
    expect(reg.anchor).toEqual(anchor);
    expect(await exists(join(orgDir(), ACCESS_FILE))).toBe(true);
    expect(keyLoads()).toBe(1);
  });

  it('a sign-in whose /api/me names another member is refused `not-member`, the old state standing', async () => {
    const { session } = await signedIn();
    await session.signOut();
    hub.member = { id: memberId(), email: 'other@example.com' };
    session.signIn();
    await until(() => registered(session).refused !== undefined, 'the refusal');
    expect(registered(session)).toMatchObject({ session: 'signed-out', refused: { code: 'not-member', detail: 'other@example.com' } });
    expect(await exists(join(orgDir(), ACCESS_FILE))).toBe(false);
  });

  it('a crash after the marker, before access.json\'s removal, starts signed out with no token used', async () => {
    await signedIn();
    const reg = await readJson<RegistrationFile>(REGISTRATION_FILE);
    await realFiles().write(REGISTRATION_FILE, { ...reg, signedOut: true });
    expect(await exists(join(orgDir(), ACCESS_FILE))).toBe(true);
    const calls = hub.calls.length;
    const login = testLogin();
    const { session } = await restart({ login });
    expect(registered(session).session).toBe('signed-out');
    expect(session.current()).toBeNull();
    expect(await exists(join(orgDir(), ACCESS_FILE))).toBe(false);
    expect(hub.calls.length).toBe(calls);
    expect(login).not.toHaveBeenCalled();
  });

  it('a failed marker write still removes the token, and the profile starts signed out', async () => {
    const real = realFiles();
    let failMarker = false;
    const files: OrgFiles = { ...real, write: (name, value) => (failMarker && name === REGISTRATION_FILE ? Promise.reject(new Error('disk full')) : real.write(name, value)) };
    const { session } = await signedIn({ files });
    failMarker = true;
    await session.signOut();
    expect(session.current()).toBeNull();
    expect((await readJson<RegistrationFile>(REGISTRATION_FILE)).signedOut).toBe(false);
    expect(await exists(join(orgDir(), ACCESS_FILE))).toBe(false);
    const calls = hub.calls.length;
    const restarted = await restart();
    expect(registered(restarted.session).session).toBe('signed-out');
    expect(restarted.session.current()).toBeNull();
    expect(hub.calls.length).toBe(calls);
  });

  it('a sign-in that completes after a sign-out writes nothing', async () => {
    const login = testLogin();
    const { session } = await signedIn({ login });
    await session.signOut();
    const release = login.hold();
    expect(session.signIn()).toEqual({ ok: true });
    await until(() => login.mock.calls.length === 2, 'the login');
    await session.signOut();
    const calls = hub.calls.length;
    release();
    await pause(50);
    expect(hub.calls.length).toBe(calls);
    expect(await exists(join(orgDir(), ACCESS_FILE))).toBe(false);
    expect((await readJson<RegistrationFile>(REGISTRATION_FILE)).signedOut).toBe(true);
    expect(registered(session)).toMatchObject({ session: 'signed-out' });
    expect(registered(session).hubAccess).not.toBe('signing-in');
    expect(session.current()).toBeNull();
  });

  it('an adoption whose anchor write is in flight across a sign-out does not sign the session back in', async () => {
    const gate = gatedFiles();
    const { session } = await signedIn({ files: gate.files });
    const anchorHeld = gate.arm(REGISTRATION_FILE);
    const adopted = session.current()!.view.advance([await successor(hub.head, [a1])], []);
    await anchorHeld;
    const signingOut = session.signOut(); // its marker waits for the anchor write, queued first
    expect(registered(session).session).toBe('signed-out');
    gate.release();
    await signingOut;
    await adopted;
    expect(session.current()).toBeNull();
    expect(registered(session).session).toBe('signed-out');
    const restarted = await restart();
    expect(registered(restarted.session).session).toBe('signed-out');
  });

  it('a sign-in whose registration write is held across an adoption keeps the adoption\'s anchor, on disk and in memory', async () => {
    const gate = gatedFiles();
    const { session } = await signedIn({ files: gate.files });
    const markerHeld = gate.arm(REGISTRATION_FILE);
    expect(session.signIn()).toEqual({ ok: true });
    await markerHeld;
    const s3 = await successor(hub.head, [a1]);
    const adopted = session.current()!.view.advance([s3], []);
    await until(async () => (await readJson<{ chain: SignedOrgState[] }>(CHAIN_FILE)).chain.length === 3, 'chain.json at version 3');
    await pause(30);
    gate.release();
    await adopted;
    await until(() => isSignedIn(session), 'signed in');
    const anchor = { genesis: await stateHash(s1.state), version: 3, head: await stateHash(s3.state) };
    expect((await readJson<RegistrationFile>(REGISTRATION_FILE)).anchor).toEqual(anchor);
    await session.signOut(); // writes the registration memory holds
    expect(await readJson<RegistrationFile>(REGISTRATION_FILE)).toMatchObject({ anchor, signedOut: true });
  });

  it('a sign-in while a sign-out is still writing is refused `busy`, so its token is never removed under it', async () => {
    const gate = gatedFiles();
    const { session, code } = await signedIn({ files: gate.files });
    const markerHeld = gate.arm(REGISTRATION_FILE);
    const signingOut = session.signOut();
    await markerHeld;
    expect(registered(session).session).toBe('signed-out');
    expect(session.signIn()).toEqual({ ok: false, reason: { code: 'busy' } });
    expect(session.register(code.text)).toEqual({ ok: false, reason: { code: 'busy' } });
    gate.release();
    await signingOut;
    expect(session.signIn()).toEqual({ ok: true });
    await until(() => isSignedIn(session), 'signed in');
    expect(await exists(join(orgDir(), ACCESS_FILE))).toBe(true);
  });
});

// ---- re-anchoring ----

describe('re-anchoring', () => {
  it('is refused `busy` outside `held-chain`', async () => {
    const fresh = make();
    await fresh.session.loaded;
    const code = (await pairing()).text;
    expect(fresh.session.reanchor(code)).toEqual({ ok: false, reason: { code: 'busy' } });
    await fresh.session.close();
    const { session } = await signedIn();
    expect(session.reanchor(code)).toEqual({ ok: false, reason: { code: 'busy' } });
  });

  it('in `held-chain`, a code for the held org signs in without moving the anchor; reanchor takes a fresh code\'s pins', async () => {
    const { entry } = await signedIn();
    const anchor = (await readJson<RegistrationFile>(REGISTRATION_FILE)).anchor;
    await writeFile(join(orgDir(), CHAIN_FILE), '{"version":1}\n');
    // The hub now serves an org rebuilt from a new genesis, under new roots, listing this device.
    const b1 = await newDevice('b1');
    const recovery2 = await generateSigningKey();
    const g2 = await genesis(A, b1, recovery2);
    hub.chain = [g2, await listing(g2, entry, b1)];
    const { session, logs } = await restart();
    const failed = () => logs.filter((l) => l.includes('closed until a re-anchor')).length;
    await until(() => failed() === 1, 'the hub\'s chain refused');
    expect(session.current()).toBeNull();
    expect(registered(session)).toMatchObject({ problem: 'held-chain', head: null });

    const fresh = await pairing({ root: b1, recoveryPub: recovery2.pub });
    expect(session.reanchor((await pairing({ root: b1, recoveryPub: recovery2.pub, member: memberId() })).text)).toEqual({ ok: false, reason: { code: 'other-org' } });

    // `register` with the held org's code is a sign-in: the anchor and pins stay.
    await session.signOut();
    expect(session.register(fresh.text)).toEqual({ ok: true });
    await until(() => failed() === 2, 'signed in, the hub\'s chain refused again');
    const kept = await readJson<RegistrationFile>(REGISTRATION_FILE);
    expect(kept.anchor).toEqual(anchor);
    expect(kept.pins.roots).toEqual([await keyId(a1.stepUp.pub)]);
    expect(registered(session).problem).toBe('held-chain');

    expect(session.reanchor(fresh.text)).toEqual({ ok: true });
    await until(() => registered(session).problem === null, 're-anchored');
    expect(session.current()?.view.head()).toEqual(hub.head);
    const moved = await readJson<RegistrationFile>(REGISTRATION_FILE);
    expect(moved.anchor).toEqual({ genesis: await stateHash(g2.state), version: 2, head: await stateHash(hub.head.state) });
    expect(moved.pins).toEqual({ roots: [await keyId(b1.stepUp.pub)], recoveryPub: recovery2.pub });
    const again = await restart();
    expect(isSignedIn(again.session)).toBe(true);
  });

  /** A signed-in profile whose chain.json is damaged while the hub serves an org rebuilt under new roots listing this device. */
  async function heldChain(over: Overrides = {}) {
    const { entry } = await signedIn(over);
    const original = [...hub.chain];
    await writeFile(join(orgDir(), CHAIN_FILE), '{"version":1}\n');
    const b1 = await newDevice('b1');
    const recovery2 = await generateSigningKey();
    const g2 = await genesis(A, b1, recovery2);
    hub.chain = [g2, await listing(g2, entry, b1)];
    const made = await restart(over);
    await until(() => made.logs.some((l) => l.includes('closed until a re-anchor')), 'the hub\'s chain refused');
    return { ...made, original, g2, fresh: await pairing({ root: b1, recoveryPub: recovery2.pub }) };
  }

  it('a re-anchor whose access.json write is held across a sign-out leaves the profile signed out, with no token', async () => {
    const gate = gatedFiles();
    const { session, fresh } = await heldChain({ files: gate.files });
    await session.signOut();
    const tokenHeld = gate.arm(ACCESS_FILE);
    expect(session.reanchor(fresh.text)).toEqual({ ok: true });
    await tokenHeld;
    const signingOut = session.signOut();
    await Promise.race([signingOut, pause(50)]);
    gate.release();
    await signingOut;
    await pause(30);
    expect(await exists(join(orgDir(), ACCESS_FILE))).toBe(false);
    expect((await readJson<RegistrationFile>(REGISTRATION_FILE)).signedOut).toBe(true);
    const again = await restart();
    expect(registered(again.session).session).toBe('signed-out');
    expect(again.session.current()).toBeNull();
  });

  it('a recovery from the hub overlapping a re-anchor never replaces the re-anchored chain or anchor', async () => {
    const gate = gatedFiles();
    const { session, original, g2, fresh } = await heldChain({ files: gate.files, timing: { CERTS_REFRESH_MS: 20 } });
    const committing = gate.arm(REGISTRATION_FILE);
    expect(session.reanchor(fresh.text)).toEqual({ ok: true });
    await committing;
    // The hub serves the chain holding the old anchor again: a recovery now would take it.
    hub.chain = original;
    const reads = () => hub.calls.filter((c) => c.path === '/api/org/state?since=0').length;
    const before = reads();
    await until(() => reads() > before, 'a recovery reading the hub');
    await pause(50);
    gate.release();
    await until(() => registered(session).problem === null && !registered(session).hubAccess.startsWith('signing'), 're-anchored');
    await pause(50);
    const genesisHash = await stateHash(g2.state);
    expect((await readJson<{ chain: SignedOrgState[] }>(CHAIN_FILE)).chain[0]).toEqual(g2);
    expect((await readJson<RegistrationFile>(REGISTRATION_FILE)).anchor.genesis).toBe(genesisHash);
    expect(session.current()!.view.since(0).states[0]).toEqual(g2);
    const again = await restart();
    expect(isSignedIn(again.session)).toBe(true);
    expect(again.session.current()!.view.since(0).states[0]).toEqual(g2);
  });

  it('refuses `removed` when the fresh code\'s chain does not list this device', async () => {
    await signedIn();
    await writeFile(join(orgDir(), CHAIN_FILE), '{"version":1}\n');
    const b1 = await newDevice('b1');
    const recovery2 = await generateSigningKey();
    hub.chain = [await genesis(A, b1, recovery2)];
    const { session } = await restart();
    await until(() => registered(session).problem === 'held-chain', 'held-chain');
    session.reanchor((await pairing({ root: b1, recoveryPub: recovery2.pub })).text);
    await until(() => registered(session).refused !== undefined, 'the refusal');
    expect(registered(session)).toMatchObject({ problem: 'held-chain', refused: { code: 'removed' } });
  });
});

// ---- the fresh token's grace ----

describe('the fresh token\'s grace', () => {
  it('Access refusing a fresh token twice, then admitting it, signs in', async () => {
    const keys = await preKeys();
    hub.chain.push(await listing(hub.head, await entryOf(keys)));
    hub.meAnswer = (n) => (n < 2 ? access(401) : undefined);
    const { session } = make();
    await session.loaded;
    session.register((await pairing()).text);
    await until(() => isSignedIn(session), 'signed in');
    expect(hub.count('/api/me')).toBe(3);
  });

  it('past the grace, it is refused `access`', async () => {
    hub.meAnswer = () => access(302);
    const { session } = make({ timing: { FRESH_TOKEN_GRACE_MS: 80 } });
    await session.loaded;
    session.register((await pairing()).text);
    await until(() => session.status().state === 'none', 'the refusal');
    expect(session.status()).toEqual({ state: 'none', refused: { code: 'access', detail: 'Access refused the sign-in (302)' } });
    expect(hub.count('/api/me')).toBeGreaterThan(1);
  });

  it('cancel ends the wait at once', async () => {
    hub.meAnswer = () => access(401);
    const { session } = make({ timing: { FRESH_TOKEN_GRACE_MS: 60_000, FRESH_TOKEN_RETRY_MS: [10_000] } });
    await session.loaded;
    session.register((await pairing()).text);
    await until(() => hub.count('/api/me') === 1, 'the first refusal');
    await pause(10);
    session.cancel();
    expect(session.status()).toEqual({ state: 'none' });
    await pause(50);
    expect(hub.count('/api/me')).toBe(1);
    expect(session.status()).toEqual({ state: 'none' });
  });
});

// ---- the status ----

describe('the status', () => {
  it('never carries a token or the code, through a registration, a sign-out and a sign-in', async () => {
    const { session, statuses } = make();
    await session.loaded;
    const code = await pairing();
    session.register(code.text);
    await until(() => hub.pending.length === 1, 'the entry posted');
    await hub.approve(code.k);
    await until(() => isSignedIn(session), 'signed in');
    await session.signOut();
    session.signIn();
    await until(() => isSignedIn(session), 'signed in again');
    const token = (await readJson<{ token: string }>(ACCESS_FILE)).token;
    expect(statuses.length).toBeGreaterThan(4);
    for (const status of statuses) {
      const text = JSON.stringify(status);
      expect(text).not.toContain(token);
      expect(text).not.toContain(code.text);
      expect(text).not.toContain(code.k);
    }
  });
});
