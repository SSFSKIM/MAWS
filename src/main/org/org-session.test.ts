// The production org session (P5 O8 M1, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M1's Decisions and
// Proves, Interfaces §A-§C): registration step by step and each refusal, the file order and a crash between files,
// startup from the files with no network, current()'s conditions, onChanged at each trigger, the token's end, `denied`,
// sign out and sign in, re-anchoring, and the fresh token's grace. Over an in-memory hub (an injected fetch) serving
// real signed org states and approving as the approving device would, the device's real keys in a temporary profile
// (backup exclusion stubbed), and a fake Registry feed the tests drive.
//
// M3 (the session as the org's signer; M3's Proves for this file): the signer composed over the session (settled at
// start and at each feed open, its registration flag, a post's credential answer), the status's `signer` part, `rekey`
// end to end, a cancel and a sign-out before and after the transaction's step 1, the replay at each boundary, and the
// retired key file's destruction. The state signer is a test one over the profile's own step-up key: no Touch ID, no
// Electron, no Keychain.
import { readFileSync } from 'node:fs';
import { chmod, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
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
  signTransition,
  SIGNING_DOMAINS,
  stateHash,
  verifyPairingMac,
  type Certificates,
  pairingMac,
  decodePairingCode,
  type Device,
  type OrgState,
  type PendingEntry as ProtocolPendingEntry,
  type RevokedKey,
  type RootTransition,
  type Signed,
  type SignedOrgState,
  type SigningKey,
} from '../../../apps/org-protocol/src/index.ts';
import { OrgStatusSchema, type OrgStatus } from '@shared/ipc/schema/org';
import { createNextDeviceKeys, deviceKeyIds, DeviceKeysError, loadDeviceKeys, promoteNextDeviceKeys, type DeviceKeys } from '../device/keys';
import type { StepUpPrompt } from '../device/step-up';
import { AccessLoginError, type AccessLogin, type HubCredential } from './access-login';
import { ACCESS_FILE, CHAIN_FILE, orgFiles, REGISTRATION_FILE, SIGNING_FILE, type OrgFiles, type RegistrationFile, type SigningFile } from './files';
import type { PendingEntry } from './hub-client';
import { createOrgSession, type DeviceKeyFiles, type OrgSessionDeps, type OrgSessionService, type OrgSigningDeps } from './org-session';
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
  /** M4a: other devices' pending entries per member, as H1's `GET /api/devices/pending[?member=]` serves them. */
  waiting = new Map<string, ProtocolPendingEntry[]>();
  /** M3: the states posted to `POST /api/org/state`, and an override of the hub's answer. */
  posted: SignedOrgState[] = [];
  postAnswer?: (signed: SignedOrgState) => Answer | undefined;

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
    if (method === 'POST' && url.pathname === '/api/org/state') {
      // The Worker's rule in brief: a successor of its head is kept (201), anything else is `409 not-head`.
      const signed = JSON.parse(String(init?.body)) as SignedOrgState;
      this.posted.push(signed);
      const override = this.postAnswer?.(signed);
      if (override !== undefined) return override;
      if (signed.state.version !== this.head.state.version + 1 || signed.state.prev !== (await stateHash(this.head.state))) return worker(409, { error: 'not-head' });
      this.chain.push(signed);
      // An accepted state drops the pending entries of the devices it lists, as the Registry's does.
      for (const m of signed.state.members) this.waiting.set(m.id, (this.waiting.get(m.id) ?? []).filter((e) => !m.devices.some((d) => d.id === e.deviceId)));
      return worker(201, { version: signed.state.version });
    }
    if (method === 'GET' && url.pathname === '/api/devices/pending') {
      const of = url.searchParams.get('member') ?? this.member.id;
      return worker(200, { pending: this.waiting.get(of) ?? [] });
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
let signing: ReturnType<typeof testSigning>;

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
  signing = testSigning();
});

afterEach(async () => {
  for (const session of opened) await session.close();
  // No status ever emitted carries a token, a pairing code or its secret.
  for (const text of emitted) for (const secret of secrets) expect(text).not.toContain(secret);
  // Every status emitted is one org.changed carries: it parses as the schema says (M3: the signer part included).
  for (const text of emitted) OrgStatusSchema.parse(JSON.parse(text));
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
    signing: signing.deps,
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

/**
 * M3's signer deps: a state signer over the profile's own step-up key that records each prompt and signs unless told to
 * decline (no Touch ID), focus the test drives, notifications kept, and no RL2 machine.
 */
function testSigning() {
  const focus = new Set<() => void>();
  const harness = {
    prompts: [] as StepUpPrompt[],
    decline: false,
    /** Runs while the person is asked, before the answer. */
    during: null as (() => Promise<unknown> | unknown) | null,
    focused: false,
    notes: [] as string[],
    focus: () => focus.forEach((listener) => listener()),
    deps: undefined as unknown as OrgSigningDeps,
  };
  harness.deps = {
    stateSigner: async (k) => ({
      kid: await keyId(k.stepUp.pub),
      sign: async (state, prompt) => {
        harness.prompts.push(prompt);
        await harness.during?.();
        if (harness.decline) return { ok: false, reason: 'cancelled' };
        return { ok: true, signed: await signOrgState(state, [k.stepUp]) };
      },
    }),
    focused: () => harness.focused,
    onFocus: (listener) => {
      focus.add(listener);
      return () => void focus.delete(listener);
    },
    notify: (text) => void harness.notes.push(text),
    roster: () => [],
    onRoster: () => () => {},
    link: () => null,
  };
  return harness;
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
async function signedIn(over: Overrides = {}, keysFirst: () => Promise<DeviceKeys> = preKeys) {
  const keys = await keysFirst();
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
    await until(() => hub.pending.length === 1 && session.status().state === 'registering' && (session.status() as { step: string }).step === 'approval', 'the wait for approval');
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
    // M4a: the refusal names the attempt it ended, so the Org page shows it under the control that sent it.
    const { attempt, ...refused } = (made.session.status() as { refused?: Record<string, unknown> }).refused ?? {};
    expect(attempt).toBe('register');
    return { ...made, refused };
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

  /**
   * A held head the hub never had (a link's handshake brought it: a state an admin delivered straight to the machines),
   * and the hub's own state at that version: a recovery's first state, or with no recovery behind it, a fork.
   */
  async function siblingAtHead(session: OrgSessionService, recovered: boolean): Promise<{ ours: SignedOrgState; theirs: SignedOrgState }> {
    const base = hub.head;
    const ours = await successor(base, [a1], (s) => void s.members.push({ id: memberId(), email: 'direct@example.com', role: 'member', devices: [] }));
    await session.current()!.view.advance([ours], []);
    expect(headVersion(session)).toBe(3);
    const theirs = await successor(base, [a1]);
    if (recovered) hub.transitions = [await signTransition({ org: ORG, fromVersion: 2, newRootKeys: [a1.stepUp.pub], issued: iso(Date.now()) }, recovery.privateKey, recovery.pub)];
    hub.chain.push(theirs);
    return { ours, theirs };
  }
  const holds = async (session: OrgSessionService, s: SignedOrgState) => (await stateHash(session.current()!.view.head().state)) === (await stateHash(s.state));

  it('follows a recovery whose first state is at the held head\'s version, announced at that version', async () => {
    const { session } = await signedIn();
    const feed = fakeFeed();
    session.attach(feed.hooks);
    await followHub(session, feed);
    const { theirs } = await siblingAtHead(session, true);
    feed.state(3);
    await until(() => holds(session, theirs), 'the recovered state adopted');
    expect(registered(session).problem).toBeNull();
    expect(session.current()!.view.head().state.version).toBe(3);
  });

  it('reads a sibling at the held head\'s version with no recovery behind it as a fork, adopting nothing', async () => {
    const { session } = await signedIn();
    const feed = fakeFeed();
    session.attach(feed.hooks);
    await followHub(session, feed);
    const { ours } = await siblingAtHead(session, false);
    feed.state(3);
    await until(() => registered(session).problem === 'fork', 'the fork refused');
    expect(await holds(session, ours)).toBe(true);
  });

  it('the certificate poll follows such a recovery itself, and reads no fork once it has', async () => {
    const { session } = await signedIn({ timing: { CERTS_REFRESH_MS: 30 } });
    const { theirs } = await siblingAtHead(session, true);
    await until(() => holds(session, theirs), 'the recovered state adopted by the poll');
    await pause(150);
    expect(registered(session).problem).toBeNull();
    expect(await holds(session, theirs)).toBe(true);
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
    expect(session.status()).toEqual({ state: 'none', refused: { code: 'access', detail: 'Access refused the sign-in (302)', attempt: 'register' } });
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

// ---- M3: the session as the org's signer ----

/** Keys made where the exclusion failed: a key file without the backup mark. */
const unmarkedKeys = () => loadDeviceKeys(userData, { excludeFromBackup: async () => false });
const deviceFile = (name: string) => join(userData, 'device', name);
type SignerPart = NonNullable<Registered['signer']>;
const signerOf = (session: OrgSessionService): SignerPart => {
  const part = registered(session).signer;
  if (part === null) throw new Error('no signer part in the status');
  return part;
};
const headVersion = (session: OrgSessionService) => registered(session).head?.version ?? 0;

/** A successor making this profile's device a root, as `deployment admin root add` does. */
async function rootAdd(keys: DeviceKeys): Promise<void> {
  const kid = await keyId(keys.stepUp.pub);
  hub.chain.push(await successor(hub.head, [a1], (s) => void s.root.keys.push(kid)));
}

/** The session follows the hub to its head (the feed's open reads the chain since the held head). */
async function followHub(session: OrgSessionService, feed: ReturnType<typeof fakeFeed>): Promise<void> {
  feed.open();
  await until(() => headVersion(session) === hub.head.state.version, `version ${hub.head.state.version} held`);
}

/** Signed in, a root, following a fake feed; the composed signer up. */
async function signingRoot(over: Overrides = {}) {
  const made = await signedIn(over);
  const feed = fakeFeed();
  made.session.attach(feed.hooks);
  await rootAdd(made.keys);
  await followHub(made.session, feed);
  await until(() => signerOf(made.session).maySign, 'the signer up');
  return { ...made, feed };
}

describe('M3: the signer composed over the session', () => {
  it('the status\'s signer part: the fingerprint and step-up kid for `root add`, a root once the head lists the kid, signing only while signed in', async () => {
    const { session, keys, entry } = await signedIn();
    await until(() => registered(session).signer !== null, 'the signer part');
    expect(signerOf(session)).toEqual({
      root: false,
      maySign: false,
      fingerprint: await pairingFingerprint(ORG, A, entry),
      stepUpKid: await keyId(keys.stepUp.pub),
      due: false,
      ageDays: 0,
      pending: null,
      offer: null,
      owing: [],
      abandoned: [],
      rekey: null,
      rekeying: null,
      oldDevice: null,
    });
    const feed = fakeFeed();
    session.attach(feed.hooks);
    await rootAdd(keys);
    await followHub(session, feed);
    await until(() => signerOf(session).maySign, 'may sign');
    expect(signerOf(session)).toMatchObject({ root: true, maySign: true, due: false });

    await session.signOut();
    expect(signerOf(session)).toMatchObject({ root: true, maySign: false });
    expect(await session.resign()).toMatchObject({ ok: false, reason: 'not-root' });
    expect(signing.prompts).toEqual([]);
  });

  it('an unmarked key file is offered new keys, and signs nothing even as a root', async () => {
    const { session, keys } = await signedIn({}, unmarkedKeys);
    const feed = fakeFeed();
    session.attach(feed.hooks);
    await rootAdd(keys);
    await followHub(session, feed);
    await until(() => signerOf(session).root, 'a root');
    expect(signerOf(session)).toMatchObject({ root: true, maySign: false, rekey: 'unmarked' });
    expect(await session.resign()).toMatchObject({ ok: false, reason: 'unmarked' });
    expect(signing.prompts).toEqual([]);
  });

  it('a focus whose window is gone by the time Touch ID would ask asks nothing, and the next focus asks', async () => {
    // The signer's read of the hub's chain, before Touch ID, is held open while the person switches apps.
    let armed = false;
    let release!: () => void;
    let holding!: () => void;
    const held = new Promise<void>((resolve) => (holding = resolve));
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (armed && String(input).includes('/api/org/state?since=')) {
        armed = false;
        await new Promise<void>((resolve) => ((release = resolve), holding()));
      }
      return hub.fetch(input, init);
    }) as typeof globalThis.fetch;
    const { session } = await signingRoot({ fetch, timing: { WEEKLY_DUE_DAYS: 0 } });
    await until(() => signerOf(session).due, 'due');
    const before = headVersion(session);
    signing.focused = true;
    armed = true;
    signing.focus();
    await held;
    signing.focused = false;
    release();
    await pause(50);
    expect(signing.prompts).toEqual([]);
    expect(hub.posted).toEqual([]);
    expect((await exists(join(orgDir(), SIGNING_FILE))) ? (await readJson<SigningFile>(SIGNING_FILE)).lastAsked : null).toBeNull();

    signing.focused = true;
    signing.focus();
    await until(() => headVersion(session) === before + 1, 'the weekly successor adopted at the next focus');
    expect(signing.prompts).toHaveLength(1);
  });

  it('re-sign now: the no-change successor signed, posted and adopted, registration.json flagged before signing.json\'s first write', async () => {
    const { session } = await signingRoot();
    const before = headVersion(session);
    expect(await exists(join(orgDir(), SIGNING_FILE))).toBe(false);
    expect(await session.resign()).toEqual({ ok: true, version: before + 1 });
    expect(signing.prompts.map((p) => p.summary)).toEqual(['re-sign the org state (no change)']);
    expect(hub.head.state.version).toBe(before + 1);
    expect(headVersion(session)).toBe(before + 1);
    expect((await readJson<RegistrationFile>(REGISTRATION_FILE)).signing).toBe(true);
    expect(await readJson<SigningFile>(SIGNING_FILE)).toMatchObject({ pending: null });
    expect(signerOf(session).pending).toBeNull();
  });

  it('asks at a window\'s focus once the weekly successor is due', async () => {
    const { session } = await signingRoot({ timing: { WEEKLY_DUE_DAYS: 0 } });
    await until(() => signerOf(session).due, 'due');
    const before = headVersion(session);
    signing.focused = true;
    signing.focus();
    await until(() => headVersion(session) === before + 1, 'the weekly successor adopted');
    expect(signing.prompts).toHaveLength(1);
    // Asked once a day: another focus asks nothing.
    signing.focus();
    await pause(30);
    expect(signing.prompts).toHaveLength(1);
  });

  it('a post Access answers ends the hub sign-in and leaves the state pending; signed in again, the feed\'s open settles it with the same bytes', async () => {
    const { session, feed } = await signingRoot();
    const before = headVersion(session);
    hub.postAnswer = () => access(401);
    expect(await session.resign()).toMatchObject({ ok: false, reason: 'hub' });
    expect(registered(session).hubAccess).toBe('expired');
    expect(session.current()?.hub).toBeNull();
    expect(session.current()).not.toBeNull();
    expect(signerOf(session).pending).toMatchObject({ version: before + 1, fork: false, exposed: true });
    expect(signerOf(session).pending?.refused).not.toBeNull();

    hub.postAnswer = undefined;
    expect(session.signIn()).toEqual({ ok: true });
    await until(() => isSignedIn(session) && registered(session).hubAccess === 'connecting', 'signed in again');
    feed.open();
    await until(() => signerOf(session).pending === null, 'settled');
    expect(hub.posted).toHaveLength(2);
    expect(hub.posted[1]).toEqual(hub.posted[0]);
    expect(headVersion(session)).toBe(before + 1);
  });

  it('settles at start: a state kept and never answered is posted again, the same bytes, at the next start', async () => {
    const { session } = await signingRoot();
    const before = headVersion(session);
    hub.postAnswer = () => 'unreachable';
    expect(await session.resign()).toMatchObject({ ok: false, reason: 'hub' });
    expect(signerOf(session).pending).toMatchObject({ version: before + 1 });
    hub.postAnswer = undefined;

    const again = await restart();
    await until(() => registered(again.session).signer?.pending === null && headVersion(again.session) === before + 1, 'settled at start');
    expect(hub.posted).toHaveLength(2);
    expect(hub.posted[1]).toEqual(hub.posted[0]);
  });

  it('a sign-out while Touch ID is up keeps and sends nothing, so signing in again posts nothing', async () => {
    const { session, feed } = await signingRoot();
    const before = headVersion(session);
    let out: Promise<void> | null = null;
    signing.during = () => void (out = session.signOut());
    expect(await session.resign()).toMatchObject({ ok: false, reason: 'not-root' });
    await out;
    expect(hub.posted).toEqual([]);
    expect(signerOf(session).pending).toBeNull();
    expect((await exists(join(orgDir(), SIGNING_FILE))) ? (await readJson<SigningFile>(SIGNING_FILE)).pending : null).toBeNull();

    signing.during = null;
    expect(session.signIn()).toEqual({ ok: true });
    await until(() => isSignedIn(session), 'signed in again');
    feed.open();
    await pause(50);
    expect(hub.posted).toEqual([]);
    expect(headVersion(session)).toBe(before);
  });

  it('a sign-out while the exposure is written posts nothing with the hub client it had; the slot settles at the next sign-in', async () => {
    const real = realFiles();
    let release!: () => void;
    let holding!: () => void;
    const held = new Promise<void>((resolve) => (holding = resolve));
    let armed = false;
    const files: OrgFiles = {
      ...real,
      write: async (name, value) => {
        if (armed && name === SIGNING_FILE && (value as SigningFile).pending?.exposed.hub === true) {
          armed = false;
          await new Promise<void>((resolve) => ((release = resolve), holding()));
        }
        return real.write(name, value);
      },
    };
    const { session, feed } = await signingRoot({ files });
    const before = headVersion(session);
    armed = true;
    const signed = session.resign();
    await held;
    const out = session.signOut();
    release();
    expect(await signed).toMatchObject({ ok: false, reason: 'not-root' });
    await out;
    expect(hub.posted).toEqual([]);
    expect((await readJson<SigningFile>(SIGNING_FILE)).pending).toMatchObject({ exposed: { hub: true } });

    expect(session.signIn()).toEqual({ ok: true });
    await until(() => isSignedIn(session), 'signed in again');
    feed.open();
    await until(() => signerOf(session).pending === null && headVersion(session) === before + 1, 'settled at the sign-in');
    expect(hub.posted).toHaveLength(1);
  });

  it('discards a state the hub keeps refusing, on confirmation, in abandon-pending\'s words, the abandoned proposal on the status', async () => {
    const { session } = await signingRoot();
    const before = headVersion(session);
    hub.postAnswer = () => worker(409, { error: 'key-purged' });
    expect(await session.resign()).toMatchObject({ ok: false, reason: 'hub', detail: '409 key-purged' });
    const hash = await stateHash(hub.posted[0]!.state);
    expect(signerOf(session).pending).toEqual({ version: before + 1, hash, fork: false, exposed: true, refused: '409 key-purged' });

    // A confirmation of another proposal than the slot holds discards nothing.
    expect(await session.discardPending(true, `${hash.slice(1)}x`)).toEqual({ ok: false, reason: 'stale' });
    expect(signerOf(session).pending).toMatchObject({ version: before + 1, hash });
    expect(signerOf(session).abandoned).toEqual([]);

    expect(await session.discardPending(true, hash)).toEqual({ ok: true, unsent: false, hubVersion: before });
    expect(signerOf(session)).toMatchObject({ pending: null, abandoned: [{ hash, version: before + 1, hub: true, machines: [] }] });
    expect(await session.discardPending(true, hash)).toEqual({ ok: false, reason: 'none' });
  });

  it('a restart with a slot the hub keeps refusing reads `refused` once settling posts it again, so Discard is offered', async () => {
    const { session } = await signingRoot();
    const before = headVersion(session);
    hub.postAnswer = () => worker(409, { error: 'key-purged' });
    expect(await session.resign()).toMatchObject({ ok: false, reason: 'hub', detail: '409 key-purged' });

    const again = await restart();
    const feed = fakeFeed();
    again.session.attach(feed.hooks);
    feed.open();
    await until(() => hub.posted.length === 2, 'settled again at the feed\'s open');
    await until(() => registered(again.session).signer?.pending?.refused === '409 key-purged', 'the refusal on the status');
    // The Org section's rule for Discard (OrgSection.test.tsx): a fork, or a refused slot that isn't one.
    const slot = signerOf(again.session).pending!;
    expect(slot).toMatchObject({ version: before + 1, fork: false, exposed: true });
    expect(await again.session.discardPending(true, slot.hash)).toEqual({ ok: true, unsent: false, hubVersion: before });
  });

  it('a signing.json lost after its first write reads problem `signing` and signs nothing until the owner resets it', async () => {
    const { session } = await signingRoot();
    expect((await session.resign()).ok).toBe(true);
    await rm(join(orgDir(), SIGNING_FILE));
    const again = await restart();
    await until(() => registered(again.session).problem === 'signing', 'problem signing');
    expect(signerOf(again.session).maySign).toBe(false);
    expect(await again.session.resign()).toMatchObject({ ok: false, reason: 'signing' });

    await again.session.resetSigning(true);
    expect(registered(again.session).problem).toBeNull();
    await until(() => signerOf(again.session).maySign, 'may sign again');
    expect((await again.session.resign()).ok).toBe(true);
  });

  /**
   * A recovery that drops revocations: version 3 lists member B's device b1 and makes this device a root beside a1;
   * version 4, the branch the recovery discards, removes b1 and this device and revokes their keys; the recovery from
   * version 3 makes this device the one root. The offer: b1's two keys (this device's own two withheld).
   */
  async function recoveryOffer(over: Overrides = {}) {
    const { session, keys, entry } = await signedIn(over);
    const feed = fakeFeed();
    session.attach(feed.hooks);
    const self: TestDevice = { device: entry as Device, channel: keys.channel, stepUp: keys.stepUp };
    const selfKid = await keyId(keys.stepUp.pub);
    const B = memberId();
    const b1 = await newDevice('b1');
    hub.chain.push(
      await successor(hub.head, [a1], (s) => {
        s.members.push({ id: B, email: 'b@example.com', role: 'member', devices: [b1.device] });
        s.root.keys.push(selfKid);
      }),
    );
    const base = hub.head;
    const discarded = await successor(base, [a1], async (s) => {
      s.members = s.members.filter((m) => m.id !== B);
      s.members[0].devices = s.members[0].devices.filter((d) => d.id !== entry.id);
      s.root.keys = s.root.keys.filter((k) => k !== selfKid);
      s.revoked.push(...(await revokedDevice(B, b1.device)), ...(await revokedDevice(A, entry)));
    });
    hub.chain.push(discarded);
    await followHub(session, feed);
    expect(registered(session).session).toBe('removed');

    // The recovery from version 3 to this device alone: a1 (whose key signed the branch) removed and revoked.
    const t = await signTransition({ org: ORG, fromVersion: 3, newRootKeys: [keys.stepUp.pub], issued: iso(Date.now()) }, recovery.privateKey, recovery.pub);
    const recovered = await successor(base, [self], async (s) => {
      s.members[0].devices = s.members[0].devices.filter((d) => d.id !== 'a1');
      s.root.keys = [selfKid];
      s.revoked.push(...(await revokedDevice(A, a1.device)));
    });
    hub.chain = [...hub.chain.slice(0, 3), recovered];
    hub.transitions = [t];
    feed.open();
    await until(() => registered(session).session === 'signed-in' && signerOf(session).offer !== null, 'the offer');
    await until(() => signerOf(session).maySign, 'may sign');
    return { session, entry, self, B, b1 };
  }

  it('offers the superseded states\' revocations after a recovery, withholds this device\'s own, and signs the offer the owner confirmed', async () => {
    const { session, entry, B, b1 } = await recoveryOffer();
    const offer = signerOf(session).offer!;
    expect(offer.superseded).toBe(2);
    expect(offer.withheld).toHaveLength(2);
    for (const line of offer.withheld) expect(line).toContain(entry.id);
    // What the Org section shows before it signs: each revocation and consequence, and the checks' warnings (here the
    // two withheld keys the successor doesn't revoke).
    expect(offer.lines.length).toBeGreaterThan(0);
    expect(offer.lines.join('\n')).toContain(await keyId(b1.channel.pub));
    expect(offer.lines.join('\n')).toContain(await keyId(b1.stepUp.pub));
    expect(offer.warnings).toHaveLength(2);
    for (const warning of offer.warnings) expect(warning).toContain(entry.id);

    // A confirmation of other words than the offer holds now signs nothing and asks nothing.
    expect(await session.revokeSuperseded(`${offer.digest.slice(1)}x`)).toMatchObject({ ok: false, reason: 'stale' });
    expect(signing.prompts).toEqual([]);

    expect(await session.revokeSuperseded(offer.digest)).toEqual({ ok: true, version: 5 });
    expect(signing.prompts.at(-1)?.summary).toBe('revoke the keys a recovery left current, with 2 warnings shown in Settings › Org');
    const revoked = new Set(hub.head.state.revoked.map((r) => r.keyId));
    expect(revoked.has(await keyId(b1.channel.pub)) && revoked.has(await keyId(b1.stepUp.pub))).toBe(true);
    expect(hub.head.state.members.some((m) => m.id === B && m.devices.length > 0)).toBe(false);
    await until(() => signerOf(session).offer?.superseded === 0, 'the offer signed');
    const left = signerOf(session).offer!;
    expect(left).toMatchObject({ lines: [], warnings: [] });
    expect(left.withheld).toHaveLength(2);
    expect(await session.revokeSuperseded(left.digest)).toMatchObject({ ok: false, reason: 'invalid' });

    // The weekly no-change successor's Touch ID line counts the withheld keys' warnings, which it would leave unsaid.
    expect(await session.resign()).toEqual({ ok: true, version: 6 });
    expect(signing.prompts.at(-1)?.summary).toBe('re-sign the org state (no change), with 2 warnings shown in Settings › Org');
  });

  it('refuses `stale`, asking nothing, when the offer changes between the confirmation and the signing', async () => {
    // The sign's read of the hub's chain is held open while another state lands that revokes b1 already.
    let armed = false;
    let release!: () => void;
    let holding!: () => void;
    const held = new Promise<void>((resolve) => (holding = resolve));
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (armed && String(input).includes('/api/org/state?since=')) {
        armed = false;
        await new Promise<void>((resolve) => ((release = resolve), holding()));
      }
      return hub.fetch(input, init);
    }) as typeof globalThis.fetch;
    const { session, self, B, b1 } = await recoveryOffer({ fetch });
    const offer = signerOf(session).offer!;
    armed = true;
    const signed = session.revokeSuperseded(offer.digest);
    await held;
    hub.chain.push(
      await successor(hub.head, [self], async (s) => {
        s.members = s.members.filter((m) => m.id !== B);
        s.revoked.push(...(await revokedDevice(B, b1.device)));
      }),
    );
    release();
    expect(await signed).toMatchObject({ ok: false, reason: 'stale' });
    expect(signing.prompts).toEqual([]);
    expect(hub.posted).toEqual([]);
    await until(() => signerOf(session).offer?.digest !== offer.digest, 'the offer composed again');
  });
});

describe('M3: rekey', () => {
  /** A rekey under way to the approval step: the fresh code, the new device's id from the posted entry. */
  async function toApproval(session: OrgSessionService) {
    const code = await pairing();
    expect(session.rekey(code.text)).toEqual({ ok: true });
    await until(() => signerOf(session).rekeying?.step === 'approval', 'approval');
    const posted = hub.pending.at(-1)!;
    return { code, newId: posted.deviceId };
  }
  const readRegistration = () => readJson<RegistrationFile>(REGISTRATION_FILE);
  const currentKeyId = async () => (await deviceKeyIds(userData, 'current'))?.device;

  it('end to end: the old device answers current() until the new entry is listed; then promoted, signed in as the new device; the retired file destroyed once the head drops the old one', async () => {
    const { session, entry, changes } = await signedIn({}, unmarkedKeys);
    const feed = fakeFeed();
    session.attach(feed.hooks);
    await until(() => registered(session).signer !== null, 'the signer part');
    expect(signerOf(session).rekey).toBe('unmarked');

    const { code, newId } = await toApproval(session);
    expect(newId).not.toBe(entry.id);
    expect(signerOf(session).rekeying).toMatchObject({ step: 'approval', expires: expect.any(String) });
    const nextIds = await deviceKeyIds(userData, 'next');
    expect(nextIds?.device).toBe(newId);
    expect(signerOf(session).rekeying?.fingerprint).toBe(await pairingFingerprint(ORG, A, { id: newId, class: 'native-mac', keyStorage: 'software', channelPub: nextIds!.channelPub, stepUpPub: nextIds!.stepUpPub }));
    expect(session.current()?.identity.device).toBe(entry.id);
    await pause(30);
    expect(session.current()?.identity.device).toBe(entry.id);

    const c = changes();
    const approved = await hub.approve(code.k);
    await until(() => session.current()?.identity.device === newId, 'the new device signed in');
    expect(changes()).toBeGreaterThan(c);
    expect(await readRegistration()).not.toHaveProperty('rekey');
    expect((await readRegistration()).device).toBe(newId);
    expect(await currentKeyId()).toBe(newId);
    expect((await deviceKeyIds(userData, 'retired'))?.device).toBe(entry.id);
    expect(await exists(deviceFile('keys.next.json'))).toBe(false);
    await until(() => signerOf(session).oldDevice === entry.id, 'the old device named');
    expect(signerOf(session)).toMatchObject({ rekey: null, rekeying: null, fingerprint: await pairingFingerprint(ORG, A, approved) });
    expect(registered(session)).toMatchObject({ device: newId, session: 'signed-in' });

    // A root removes the old device: its retired key file goes.
    hub.chain.push(await dropping(hub.head, entry));
    await followHub(session, feed);
    await until(() => signerOf(session).oldDevice === null, 'the old device gone');
    expect(await exists(deviceFile('keys.retired.json'))).toBe(false);
    expect(session.current()?.identity.device).toBe(newId);
  });

  it('is offered to a device the org removed, which signs in again as the new device, its old keys destroyed at once', async () => {
    const { session, entry } = await signedIn();
    const feed = fakeFeed();
    session.attach(feed.hooks);
    hub.chain.push(await dropping(hub.head, entry));
    await followHub(session, feed);
    expect(registered(session).session).toBe('removed');
    const { code, newId } = await toApproval(session);
    await hub.approve(code.k);
    await until(() => session.current()?.identity.device === newId, 'the new device signed in');
    await until(async () => !(await exists(deviceFile('keys.retired.json'))), 'the retired keys destroyed');
    expect(signerOf(session).oldDevice).toBeNull();
  });

  it('is refused for marked keys the head lists, and for a code of another member', async () => {
    const { session } = await signedIn();
    expect(session.rekey((await pairing()).text)).toMatchObject({ ok: false, reason: { code: 'busy' } });
    expect(session.rekey((await pairing({ member: memberId() })).text)).toEqual({ ok: false, reason: { code: 'other-org' } });
    expect(await exists(deviceFile('keys.next.json'))).toBe(false);
  });

  it('refuses `keys` and writes nothing when the next keys can\'t be excluded from backup', async () => {
    await signedIn({}, unmarkedKeys);
    const again = await restart({ excludeFromBackup: async () => false });
    await until(() => registered(again.session).signer !== null, 'the signer part');
    expect(again.session.rekey((await pairing()).text)).toEqual({ ok: true });
    await until(() => registered(again.session).refused?.code === 'keys', 'refused keys');
    expect(await exists(deviceFile('keys.next.json'))).toBe(false);
    expect(hub.pending).toHaveLength(0);
  });

  for (const act of ['cancel', 'sign-out'] as const) {
    it(`a ${act} during the approval leaves the old registration and no next keys`, async () => {
      const { session, entry } = await signedIn({}, unmarkedKeys);
      const { code } = await toApproval(session);
      if (act === 'cancel') session.cancel();
      else await session.signOut();
      await until(async () => !(await exists(deviceFile('keys.next.json'))), 'the next keys removed');
      await hub.approve(code.k);
      await pause(50);
      const reg = await readRegistration();
      expect(reg.device).toBe(entry.id);
      expect(reg).not.toHaveProperty('rekey');
      expect(await currentKeyId()).toBe(entry.id);
      expect(await exists(deviceFile('keys.retired.json'))).toBe(false);
      expect(signerOf(session).rekeying).toBeNull();
      if (act === 'cancel') expect(session.current()?.identity.device).toBe(entry.id);
      else expect(reg.signedOut).toBe(true);
    });
  }

  /** The key files' promotion, held at `stage` until released. */
  function heldPromotion(stage: 'after step 1' | 'after the first rename' | 'after both renames') {
    let reached!: () => void;
    let release!: () => void;
    const atStage = new Promise<void>((resolve) => (reached = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    const promote: DeviceKeyFiles['promote'] = async (profile) => {
      if (stage === 'after the first rename') await rename(join(profile, 'device', 'keys.json'), join(profile, 'device', 'keys.retired.json'));
      if (stage === 'after both renames') await promoteNextDeviceKeys(profile);
      reached();
      await released;
      await promoteNextDeviceKeys(profile);
    };
    return { keyFiles: { promote }, atStage, release };
  }

  for (const stage of ['after step 1', 'after the first rename', 'after both renames'] as const) {
    for (const act of ['cancel', 'sign-out'] as const) {
      it(`a ${act} ${stage} no longer stops it: the promotion completes${act === 'sign-out' ? ', and the sign-out\'s marker stays' : ''}`, async () => {
        const held = heldPromotion(stage);
        const { session, entry } = await signedIn({ keyFiles: held.keyFiles }, unmarkedKeys);
        const { code, newId } = await toApproval(session);
        await hub.approve(code.k);
        await held.atStage;
        expect((await readRegistration()).rekey).toEqual({ device: newId });
        if (act === 'cancel') session.cancel();
        const signedOut = act === 'sign-out' ? session.signOut() : Promise.resolve();
        held.release();
        await signedOut;
        await until(async () => (await readRegistration()).device === newId, 'step 4 written');
        const reg = await readRegistration();
        expect(reg).not.toHaveProperty('rekey');
        expect(await currentKeyId()).toBe(newId);
        expect((await deviceKeyIds(userData, 'retired'))?.device).toBe(entry.id);
        expect(await exists(deviceFile('keys.next.json'))).toBe(false);
        if (act === 'cancel') {
          await until(() => session.current()?.identity.device === newId, 'the new device signed in');
        } else {
          expect(reg.signedOut).toBe(true);
          expect(await exists(join(orgDir(), ACCESS_FILE))).toBe(false);
          expect(session.current()).toBeNull();
          expect(registered(session)).toMatchObject({ device: newId, session: 'signed-out' });
        }
      });
    }
  }

  /** Signed in with next keys the head lists, then the session closed: the files as a crash during the rekey left them. */
  async function crashedRekey() {
    const { session, entry } = await signedIn();
    const next = await createNextDeviceKeys(userData, { excludeFromBackup: async () => true });
    const nextEntry = await entryOf(next);
    hub.chain.push(await listing(hub.head, nextEntry));
    const feed = fakeFeed();
    session.attach(feed.hooks);
    await followHub(session, feed);
    // The crash's files are written behind the session's back, once it is closed: nothing is written after that.
    for (const s of opened) await s.close();
    const reg = await readRegistration();
    await realFiles().write(REGISTRATION_FILE, { ...reg, rekey: { device: nextEntry.id } });
    return { old: entry, next: nextEntry };
  }

  const boundaries: Record<string, () => Promise<void>> = {
    'after step 1': async () => {},
    'after the first rename': () => rename(deviceFile('keys.json'), deviceFile('keys.retired.json')),
    'after both renames, the registration still old': async () => {
      await rename(deviceFile('keys.json'), deviceFile('keys.retired.json'));
      await rename(deviceFile('keys.next.json'), deviceFile('keys.json'));
    },
  };
  for (const [boundary, crash] of Object.entries(boundaries)) {
    it(`the replay at load, a crash ${boundary}, reaches the new device signed in`, async () => {
      const { old, next } = await crashedRekey();
      await crash();
      const { session } = await restart();
      expect(session.current()?.identity.device).toBe(next.id);
      expect(registered(session)).toMatchObject({ device: next.id, session: 'signed-in' });
      const reg = await readRegistration();
      expect(reg.device).toBe(next.id);
      expect(reg).not.toHaveProperty('rekey');
      expect(await currentKeyId()).toBe(next.id);
      expect((await deviceKeyIds(userData, 'retired'))?.device).toBe(old.id);
      expect(await exists(deviceFile('keys.next.json'))).toBe(false);
    });
  }

  it('the replay at load drops a rekey whose next keys were lost before step 2: the old registration stands', async () => {
    const { old } = await crashedRekey();
    await rm(deviceFile('keys.next.json'));
    const { session } = await restart();
    expect(session.current()?.identity.device).toBe(old.id);
    const reg = await readRegistration();
    expect(reg.device).toBe(old.id);
    expect(reg).not.toHaveProperty('rekey');
    expect(await currentKeyId()).toBe(old.id);
  });

  /** orgFiles whose first registration.json write matching `which` waits inside the write until released. */
  function pausedRegistrationWrite(which: (value: RegistrationFile) => boolean) {
    const real = realFiles();
    let reached!: () => void;
    let release!: () => void;
    const atWrite = new Promise<void>((resolve) => (reached = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    let armed = true;
    const files: OrgFiles = {
      ...real,
      write: async (name, value) => {
        if (armed && name === REGISTRATION_FILE && which(value as RegistrationFile)) {
          armed = false;
          reached();
          await released;
        }
        return real.write(name, value);
      },
    };
    return { files, atWrite, release };
  }

  it('a sign-out while step 4\'s registration write is in flight stays signed out, in memory as on disk', async () => {
    const keys = await unmarkedKeys();
    const oldId = (await entryOf(keys)).id;
    const paused = pausedRegistrationWrite((reg) => reg.rekey === undefined && reg.device !== oldId);
    const { session } = await signedIn({ files: paused.files }, async () => keys);
    const { code, newId } = await toApproval(session);
    await hub.approve(code.k);
    await paused.atWrite;
    const signedOut = session.signOut();
    paused.release();
    await signedOut;
    expect(session.current()).toBeNull();
    expect(registered(session)).toMatchObject({ device: newId, session: 'signed-out' });
    const reg = await readRegistration();
    expect(reg).toMatchObject({ device: newId, signedOut: true });
    expect(reg).not.toHaveProperty('rekey');
    expect(await exists(join(orgDir(), ACCESS_FILE))).toBe(false);
  });

  it('a rekey queued behind a recorded intent whose promotion failed creates no next keys: the replay finishes the first', async () => {
    const paused = pausedRegistrationWrite((reg) => reg.rekey !== undefined);
    let created = 0;
    let promotions = 0;
    const keyFiles: Partial<DeviceKeyFiles> = {
      createNext: (profile, deps) => (created++, createNextDeviceKeys(profile, deps)),
      promote: async (profile) => {
        if (promotions++ === 0) throw new Error('disk full before the first rename');
        return promoteNextDeviceKeys(profile);
      },
    };
    const { session, entry } = await signedIn({ files: paused.files, keyFiles }, unmarkedKeys);
    const { code, newId } = await toApproval(session);
    await hub.approve(code.k);
    // The first attempt is inside its step-1 write; a cancel there no longer stops it, and a second attempt starts.
    await paused.atWrite;
    session.cancel();
    expect(session.rekey((await pairing()).text)).toEqual({ ok: true });
    paused.release();
    await until(() => registered(session).refused?.code === 'busy', 'the second attempt refused');
    expect(created).toBe(1);
    expect((await deviceKeyIds(userData, 'next'))?.device).toBe(newId);
    expect((await readRegistration()).rekey).toEqual({ device: newId });
    expect(session.current()?.identity.device).toBe(entry.id);

    // The next start's replay finishes the recorded transaction.
    const again = await restart();
    expect(again.session.current()?.identity.device).toBe(newId);
    expect(await currentKeyId()).toBe(newId);
  });
});

// ---- M4a: the session's surface for the Org page ----

/** A member with no devices, added by the deployment admin's successor and followed through the feed. */
async function addMember(session: OrgSessionService, feed: ReturnType<typeof fakeFeed>, email = 'bea@example.com'): Promise<string> {
  const id = memberId();
  hub.chain.push(await successor(hub.head, [a1], (s) => void s.members.push({ id, email, role: 'member', devices: [] })));
  feed.state(hub.head.state.version);
  await until(() => headVersion(session) === hub.head.state.version, 'the new member held');
  return id;
}

/** The entry a device posts for the code: its id its channel key's, its MAC under the code's secret. */
async function answering(code: string): Promise<{ device: Omit<Device, 'endorsement'>; entry: ProtocolPendingEntry }> {
  const decoded = decodePairingCode(code)!;
  const channel = await generateSigningKey();
  const device: Omit<Device, 'endorsement'> = { id: await keyId(channel.pub), class: 'native-mac', keyStorage: 'software', channelPub: channel.pub, stepUpPub: (await generateSigningKey()).pub };
  const mac = await pairingMac(base64urlDecode(decoded.k), { org: decoded.org, member: decoded.member, device });
  return { device, entry: { deviceId: device.id, class: 'native-mac', keyStorage: 'software', channelPub: device.channelPub, stepUpPub: device.stepUpPub, mac } };
}

describe('M4a: refused.attempt', () => {
  it('names each attempt a status\'s refusal ended: register (every registration refusal above), signIn, reanchor', async () => {
    // signIn
    const { session } = await signedIn();
    await session.signOut();
    hub.member = { id: memberId(), email: 'other@example.com' };
    expect(session.signIn()).toEqual({ ok: true });
    await until(() => registered(session).refused !== undefined, 'the sign-in refused');
    expect(registered(session).refused).toEqual({ code: 'not-member', detail: 'other@example.com', attempt: 'signIn' });
    hub.member = { id: A, email: OWNER };
    expect(session.signIn()).toEqual({ ok: true });
    await until(() => isSignedIn(session), 'signed in');
    expect(registered(session).refused).toBeUndefined();

    // reanchor: the held chain closed, the hub's chain not taken meanwhile, /api/me refusing the member
    await writeFile(join(orgDir(), CHAIN_FILE), '{"version":1}\n');
    hub.stateAnswer = () => worker(503, { error: 'busy' });
    const again = await restart();
    await until(() => registered(again.session).problem === 'held-chain', 'held-chain');
    hub.meAnswer = () => worker(403, { error: 'not-a-member' });
    expect(again.session.reanchor((await pairing()).text)).toEqual({ ok: true });
    await until(() => registered(again.session).refused !== undefined, 'the re-anchor refused');
    expect(registered(again.session).refused).toMatchObject({ code: 'not-member', attempt: 'reanchor' });
  });

  it('names rekey', async () => {
    const { session } = await signedIn({}, unmarkedKeys);
    hub.meAnswer = () => worker(403, { error: 'not-a-member' });
    expect(session.rekey((await pairing()).text)).toEqual({ ok: true });
    await until(() => registered(session).refused !== undefined, 'the rekey refused');
    expect(registered(session).refused).toMatchObject({ code: 'not-member', attempt: 'rekey' });
  });

  it('a refusal made at load ended no attempt and names none', async () => {
    await signedIn();
    await rm(join(userData, 'device', 'keys.json'));
    const { session } = await restart();
    expect(registered(session).refused).toEqual({ code: 'keys', detail: expect.stringContaining('keys.json is gone') });
  });
});

describe('M4a: org.view', () => {
  it('is null for a profile that never signed in', async () => {
    const { session } = make();
    await session.loaded;
    expect(await session.view()).toBeNull();
  });

  it('follows the head: members, this Mac and the roots, read again after each adopted head; maySign as the signer says', async () => {
    const { session, feed, entry, keys } = await signingRoot();
    const first = (await session.view())!;
    expect(first).toMatchObject({ version: headVersion(session), maySign: true, recoveryKid: await keyId(recovery.pub), machines: [] });
    expect(first.members).toEqual([
      {
        id: A,
        email: OWNER,
        name: 'Owner',
        role: 'admin',
        you: true,
        devices: [
          { id: 'a1', class: 'native-mac', keyStorage: 'software', root: true, thisMac: false, fingerprint: await pairingFingerprint(ORG, A, a1.device) },
          { id: entry.id, class: 'native-mac', keyStorage: 'software', root: true, thisMac: true, fingerprint: await pairingFingerprint(ORG, A, entry) },
        ],
      },
    ]);
    expect(first.roots).toEqual([
      { kid: await keyId(a1.stepUp.pub), member: A, device: 'a1' },
      { kid: await keyId(keys.stepUp.pub), member: A, device: entry.id },
    ]);

    const bea = await addMember(session, feed);
    const next = (await session.view())!;
    expect(next.version).toBe(first.version + 1);
    expect(next.members.map((m) => [m.id, m.you])).toEqual([
      [A, true],
      [bea, false],
    ]);

    await session.signOut();
    expect((await session.view())!.maySign).toBe(false);
  });
});

describe('M4a: org.preview and org.change', () => {
  it('previews a change with its lines, warnings and digest; signs it only with that digest, and the id previewed is the id signed', async () => {
    const { session } = await signingRoot();
    const before = headVersion(session);
    const preview = await session.preview({ kind: 'member.add', email: '  Bea@Example.com ', role: 'member' });
    if (!preview.ok) throw new Error(JSON.stringify(preview));
    expect(preview.change).toEqual({ kind: 'member.add', email: 'bea@example.com', role: 'member', id: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(preview.lines[0]).toBe('Add bea@example.com as a member, with no devices yet: their first device is paired next');
    expect(preview.warnings).toEqual([]);
    expect(preview.digest).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(signing.prompts).toEqual([]);

    // Another digest, or the change without the id the preview gave it: `stale`, nothing asked or signed.
    expect(await session.change(preview.change, 'A'.repeat(43))).toMatchObject({ ok: false, reason: 'stale' });
    expect(await session.change({ kind: 'member.add', email: 'bea@example.com', role: 'member' }, preview.digest)).toMatchObject({ ok: false, reason: 'stale' });
    expect(signing.prompts).toEqual([]);
    expect(hub.posted).toEqual([]);

    expect(await session.change(preview.change, preview.digest)).toEqual({ ok: true, version: before + 1 });
    expect(signing.prompts.map((p) => p.summary)).toEqual(['add bea@example.com to the org']);
    expect(hub.head.state.members.find((m) => m.email === 'bea@example.com')?.id).toBe((preview.change as { id: string }).id);
  });

  it('a head that moved under the sheet so the words differ reads `stale` before Touch ID', async () => {
    const { session, feed } = await signingRoot();
    const bea = await addMember(session, feed);
    const preview = await session.preview({ kind: 'member.remove', member: bea });
    if (!preview.ok) throw new Error(JSON.stringify(preview));
    // Bea's first device is listed meanwhile: removing her now would also revoke it, which the sheet never said.
    const phone = await newDevice('bea-1');
    hub.chain.push(await successor(hub.head, [a1], (s) => void s.members.find((m) => m.id === bea)!.devices.push(phone.device)));
    feed.state(hub.head.state.version);
    await until(() => headVersion(session) === hub.head.state.version, 'the device held');
    expect(await session.change(preview.change, preview.digest)).toMatchObject({ ok: false, reason: 'stale' });
    expect(signing.prompts).toEqual([]);
  });

  it('a refused change names its findings and has no digest; not signing, it is refused before anything composes', async () => {
    const { session } = await signingRoot();
    expect(await session.preview({ kind: 'member.remove', member: A })).toMatchObject({ ok: false, reason: 'refused', findings: [{ level: 'refuse', code: 'self' }] });
    expect(await session.preview({ kind: 'member.email', member: A, email: 'not an email' })).toMatchObject({ ok: false, reason: 'refused', findings: [{ code: 'bad-email' }] });
    expect(await session.preview({ kind: 'member.remove', member: memberId() })).toMatchObject({ ok: false, reason: 'stale', findings: [] });

    await session.signOut();
    expect(await session.preview({ kind: 'member.add', email: 'cal@example.com', role: 'member' })).toMatchObject({ ok: false, reason: 'not-root', findings: [] });
    expect(await session.change({ kind: 'member.add', email: 'cal@example.com', role: 'member', id: memberId() }, 'A'.repeat(43))).toMatchObject({ ok: false, reason: 'not-root' });
    expect(signing.prompts).toEqual([]);
  });
});

describe('M4a: org.pair.*', () => {
  it('pairs another member\'s first device: the code in the start\'s answer alone, the entry\'s fingerprint in the status, approved through the signer', async () => {
    const { session, feed } = await signingRoot();
    const bea = await addMember(session, feed);
    const started = session.pairStart({ member: bea, class: 'native-mac' });
    if (!started.ok) throw new Error(JSON.stringify(started));
    // The suites' secret check (afterEach) covers the code and its secret in every status emitted.
    secrets.push(started.code, decodePairingCode(started.code)!.k);
    expect(decodePairingCode(started.code)).toMatchObject({ hub: HUB, org: ORG, member: bea, roots: hub.head.state.root.keys });
    expect(registered(session).pairing).toEqual({ generation: 1, member: bea, class: 'native-mac', expires: started.expires, entry: null, problem: null });

    const { device, entry } = await answering(started.code);
    hub.waiting.set(bea, [entry]);
    await until(() => registered(session).pairing?.entry != null, 'the candidate');
    expect(hub.calls.some((c) => c.method === 'GET' && c.path === `/api/devices/pending?member=${bea}`)).toBe(true);
    const shown = registered(session).pairing!;
    expect(shown.entry).toMatchObject({ id: device.id, fingerprint: await pairingFingerprint(ORG, bea, device) });

    const before = headVersion(session);
    expect(await session.pairApprove({ generation: shown.generation, digest: shown.entry!.digest })).toEqual({ ok: true, version: before + 1 });
    expect(signing.prompts.map((p) => p.summary)).toEqual([`pair device ${device.id.slice(0, 8)} to bea@example.com`]);
    expect(hub.head.state.members.find((m) => m.id === bea)!.devices).toEqual([device]);
    expect(registered(session).pairing).toBeNull();
  });

  it('one pairing at a time, none beside a rekey; a sign-out ends it', async () => {
    const { session, feed } = await signingRoot();
    const bea = await addMember(session, feed);
    const first = session.pairStart({ member: bea, class: 'native-mac' });
    if (!first.ok) throw new Error(JSON.stringify(first));
    secrets.push(first.code, decodePairingCode(first.code)!.k);
    expect(session.pairStart({ member: A, class: 'native-mac' })).toMatchObject({ ok: false, reason: 'busy' });
    expect(session.rekey((await pairing()).text)).toEqual({ ok: false, reason: { code: 'busy', detail: 'a pairing is under way: cancel it first' } });
    session.pairCancel();
    expect(registered(session).pairing).toBeNull();

    const second = session.pairStart({ member: A, class: 'native-mac' });
    if (!second.ok) throw new Error(JSON.stringify(second));
    secrets.push(second.code, decodePairingCode(second.code)!.k);
    expect(registered(session).pairing).toMatchObject({ generation: 2, member: A });
    await session.signOut();
    expect(registered(session).pairing).toBeNull();
    expect(session.pairStart({ member: A, class: 'native-mac' })).toMatchObject({ ok: false, reason: 'not-root' });
  });

  it('is refused while a rekey waits for its approval', async () => {
    const { session } = await signedIn({}, unmarkedKeys);
    expect(session.rekey((await pairing()).text)).toEqual({ ok: true });
    await until(() => signerOf(session).rekeying?.step === 'approval', 'the rekey waiting');
    expect(session.pairStart({ member: A, class: 'native-mac' })).toEqual({ ok: false, reason: 'busy', detail: 'another org attempt is under way' });
    session.cancel();
  });

  it('a later device of a member who isn\'t you is the page\'s stated rule, not a pairing', async () => {
    const { session, feed } = await signingRoot();
    const bea = await addMember(session, feed);
    const phone = await newDevice('bea-1');
    hub.chain.push(await successor(hub.head, [a1], (s) => void s.members.find((m) => m.id === bea)!.devices.push(phone.device)));
    feed.state(hub.head.state.version);
    await until(() => headVersion(session) === hub.head.state.version, 'her device held');
    expect(session.pairStart({ member: bea, class: 'native-mac' })).toEqual({
      ok: false,
      reason: 'later-device',
      detail: 'Their next device is paired from one of their own devices, a flow not built yet',
    });
    expect(registered(session).pairing).toBeNull();
  });
});

/** Every file under org/ as it stands: its name, its inode and mtime (a rename-over shows), and its bytes. */
async function orgSnapshot(): Promise<string[]> {
  const names = (await readdir(orgDir())).sort();
  return Promise.all(
    names.map(async (name) => {
      const path = join(orgDir(), name);
      const s = await stat(path);
      return `${name} ${s.ino} ${s.mtimeMs} ${await readFile(path, 'utf8')}`;
    }),
  );
}

/** The hub's fetch, whose next `GET /api/org/state` waits for `release`; `arm` resolves once that read is held. */
function heldStateRead() {
  let armed: (() => void) | null = null;
  let release: () => void = () => {};
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (armed !== null && new URL(String(input)).pathname === '/api/org/state' && (init?.method ?? 'GET') === 'GET') {
      const held = armed;
      armed = null;
      await new Promise<void>((resolve) => {
        release = resolve;
        held();
      });
    }
    return hub.fetch(input, init);
  }) as typeof globalThis.fetch;
  return { fetch, arm: () => new Promise<void>((resolve) => (armed = resolve)), release: () => release() };
}

describe('M4a: close()', () => {
  it('resolves only after a queued anchor write lands', async () => {
    const gate = gatedFiles();
    const { session } = await signedIn({ files: gate.files });
    const anchorHeld = gate.arm(REGISTRATION_FILE);
    const s3 = await successor(hub.head, [a1]);
    const adopted = session.current()!.view.advance([s3], []);
    await anchorHeld;
    let closed = false;
    const closing = session.close().then(() => void (closed = true));
    await pause(30);
    expect(closed).toBe(false);
    gate.release();
    await closing;
    expect((await readJson<RegistrationFile>(REGISTRATION_FILE)).anchor).toEqual({ genesis: await stateHash(s1.state), version: 3, head: await stateHash(s3.state) });
    await adopted;
  });

  it('a signer hub read released after close() writes nothing: no file under org/ changes', async () => {
    const read = heldStateRead();
    const { session } = await signingRoot({ fetch: read.fetch });
    const before = headVersion(session);
    const reading = read.arm();
    const resigned = session.resign();
    await reading;
    // The hub now serves a successor the signer would adopt (chain.json, then the anchor) if nothing fenced it.
    hub.chain.push(await successor(hub.head, [a1]));
    let closed = false;
    const closing = session.close().then(() => void (closed = true));
    await pause(30);
    expect(closed).toBe(false); // close() joins the signer's operation in flight
    read.release();
    await closing;
    const files = await orgSnapshot();
    expect(await resigned).toMatchObject({ ok: false, reason: 'not-root' });
    await pause(50);
    expect(await orgSnapshot()).toEqual(files);
    // Nothing read after close() was adopted: not in memory, not in chain.json.
    expect(headVersion(session)).toBe(before);
    expect((await readJson<{ chain: SignedOrgState[] }>(CHAIN_FILE)).chain).toHaveLength(before);
    expect(signing.prompts).toEqual([]);
  });

  it('waits for a link\'s direct view.advance whose chain.json write is under way; the anchor it misses moves up at the next load', async () => {
    const gate = gatedFiles();
    const { session } = await signedIn({ files: gate.files });
    const chainHeld = gate.arm(CHAIN_FILE);
    const s3 = await successor(hub.head, [a1]);
    // As a link does (remote/link.ts): not awaited.
    void session.current()!.view.advance([s3], []);
    await chainHeld;
    let closed = false;
    const closing = session.close().then(() => void (closed = true));
    await pause(30);
    expect(closed).toBe(false);
    gate.release();
    await closing;
    expect((await readJson<{ chain: SignedOrgState[] }>(CHAIN_FILE)).chain.at(-1)).toEqual(s3);
    // The session closed while chain.json was written: the anchor's write was refused, as a crash between the two.
    expect((await readJson<RegistrationFile>(REGISTRATION_FILE)).anchor.version).toBe(2);
    const files = await orgSnapshot();
    await pause(50);
    expect(await orgSnapshot()).toEqual(files);
    const { session: again } = await restart();
    expect(headVersion(again)).toBe(3);
    expect((await readJson<RegistrationFile>(REGISTRATION_FILE)).anchor.version).toBe(3);
  });

  // Review fix: a command whose queued write meets the closed commit queue answers as stopped, never as a failure.
  it('a reset asked for just before close() answers quietly and writes nothing', async () => {
    const { session } = await signingRoot();
    expect((await session.resign()).ok).toBe(true);
    await rm(join(orgDir(), SIGNING_FILE));
    const { session: again, logs } = await restart();
    await until(() => registered(again).problem === 'signing', 'problem signing');
    const resetting = again.resetSigning(true);
    const closing = again.close();
    await expect(resetting).resolves.toBeUndefined();
    await closing;
    expect(await exists(join(orgDir(), SIGNING_FILE))).toBe(false);
    expect(logs.filter((l) => l.includes('closed'))).toEqual([]);
  });

  it('a close during Touch ID reads as a stopped sign, not a signing-storage failure; nothing is kept', async () => {
    const { session, logs } = await signingRoot();
    const signingFile = () => readFile(join(orgDir(), SIGNING_FILE), 'utf8').catch(() => null);
    const kept = await signingFile();
    let closing: Promise<void> | undefined;
    signing.during = () => void (closing = session.close());
    expect(await session.resign()).toMatchObject({ ok: false, reason: 'not-root' });
    await closing;
    expect(await signingFile()).toBe(kept);
    expect(hub.posted).toEqual([]);
    expect(logs.filter((l) => l.includes('closed'))).toEqual([]);
  });

  it('a close during a discard\'s hub read discards nothing and answers quietly', async () => {
    const read = heldStateRead();
    const { session, logs } = await signingRoot({ fetch: read.fetch });
    hub.postAnswer = () => worker(409, { error: 'key-purged' });
    expect(await session.resign()).toMatchObject({ ok: false, reason: 'hub' });
    const slot = (await readJson<SigningFile>(SIGNING_FILE)).pending;
    const reading = read.arm();
    const discarding = session.discardPending(true, signerOf(session).pending!.hash);
    await reading;
    const closing = session.close();
    read.release();
    expect(await discarding).toEqual({ ok: false });
    await closing;
    expect((await readJson<SigningFile>(SIGNING_FILE)).pending).toEqual(slot);
    expect(logs.filter((l) => l.includes('closed'))).toEqual([]);
  });
});

describe('M4a: a sign-out after a post the hub took (Task 5, Decision 4)', () => {
  it('reads not-root, adopts nothing late, keeps the slot\'s bytes, and the next sign-in settles it with no new confirmation', async () => {
    const read = heldStateRead();
    const { session, feed } = await signingRoot({ fetch: read.fetch });
    const before = headVersion(session);
    let reading: Promise<void> | undefined;
    // The hub takes the post; the signer's read of the hub's chain after it is held.
    hub.postAnswer = () => {
      hub.postAnswer = undefined;
      reading = read.arm();
      return undefined;
    };
    const signed = session.resign();
    await until(() => reading !== undefined, 'posted');
    await reading;
    const slot = await readFile(join(orgDir(), SIGNING_FILE), 'utf8');
    const prompts = signing.prompts.length;
    await session.signOut();
    read.release();
    expect(await signed).toMatchObject({ ok: false, reason: 'not-root' });
    await pause(50);
    expect(headVersion(session)).toBe(before);
    expect((await readJson<{ chain: SignedOrgState[] }>(CHAIN_FILE)).chain).toHaveLength(before);
    expect(await readFile(join(orgDir(), SIGNING_FILE), 'utf8')).toBe(slot);

    expect(session.signIn()).toEqual({ ok: true });
    await until(() => isSignedIn(session), 'signed in again');
    feed.open();
    await until(() => signerOf(session).pending === null && headVersion(session) === before + 1, 'settled at the sign-in');
    expect(signing.prompts).toHaveLength(prompts);
    expect(hub.posted).toHaveLength(1);
  });
});
