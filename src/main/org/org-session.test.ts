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
//
// M4b (machines): an enrollment end to end through the session's hub, one at a time beside a pairing and a rekey, a
// sign-out while its Touch ID is open and a close while its poll is out; the machine changes previewed and signed, a
// drop's hub row deleted and retried by the route alone; the view's certified machines. The grants: a non-root owner's
// Grant… and grant through a link or the local door, grants.json behind its mark, a sign-out during Touch ID, a close
// while the act is out, and grants.json failing closed.
import { readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
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
  decodeEnrollmentCodeV2,
  enrollmentMac,
  type Device,
  type OrgState,
  type PendingEntry as ProtocolPendingEntry,
  type RevokedKey,
  type RootTransition,
  type Signed,
  type SignedOrgState,
  type SigningKey,
  type Grant,
  verifyGrant,
} from '../../../apps/org-protocol/src/index.ts';
import type { ClientId } from '@shared/ipc/client';
import { OrgStatusSchema, type DelegationResult, type OrgStatus } from '@shared/ipc/schema/org';
import type { MachineRef } from '@shared/machine/ref';
import { fakeReach, fakeWake } from '../../../test/support/wake-reach';
import { createNextDeviceKeys, deviceKeyIds, DeviceKeysError, loadDeviceKeys, promoteNextDeviceKeys, type DeviceKeys } from '../device/keys';
import { createRecordSigner, type HeldOrgView, type StepUpPrompt } from '../device/step-up';
import { DEVICE_CAPABILITIES } from '../machines/remote/capabilities';
import { AccessLoginError, type AccessLogin, type HubCredential } from './access-login';
import { ACCESS_FILE, CHAIN_FILE, GRANTS_FILE, orgFiles, REGISTRATION_FILE, SIGNING_FILE, type GrantsFile, type OrgFiles, type RegistrationFile, type SigningFile } from './files';
import type { GrantDoor, GrantLink } from './grants';
import type { PendingEntry } from './hub-client';
import { createOrgSession, type DeviceKeyFiles, type OrgSessionDeps, type OrgSessionService, type OrgSigningDeps } from './org-session';
import { openProvisioningSecret, PROVISIONING_SECRET_FILE } from './provisioning-secret-store';
import type { RegistryFeedHooks } from './registry-feed';
import { resolveGcloud, secretStore } from './secret-store';

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
  /**
   * M4b: minted enrollments and each one's posted key; machine rows by name, each with its enrollment's posted key (null
   * for none: one re-enrolled in place and never listed, say); overrides of the row list's and the DELETE's answers.
   */
  enrollments: Array<{ id: string; token: string; body: unknown }> = [];
  enrollmentKeys = new Map<string, { enrollment: string; machine: string; pub: string; ref: string; mac: string; posted: string }>();
  rows = new Map<string, { ref: string; pub: string } | null>();
  listAnswer?: () => Answer | undefined;
  deleteAnswer?: (name: string) => Answer | Promise<Answer | undefined> | undefined;
  /** M4c: the provisioning keys, as the Worker lists them, each with its token; a mint waits on `mintGate` when set. */
  provisioningKeys: Array<{ id: string; label: string; prefix: string; created: string; expires: string; max_uses: number | null; uses: number; revoked: string | null; token: string }> = [];
  mintGate?: () => Promise<void>;
  /** M4c fix wave: the key list's answer, in place of the listing, when set. */
  keysAnswer?: () => Answer | undefined;
  revokeAnswer?: (id: string) => Answer | undefined;
  renewGate?: () => Promise<void>;

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
    if (method === 'POST' && url.pathname === '/api/enrollments') {
      const body = JSON.parse(String(init?.body)) as { ttl_s: number };
      const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
      const token = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
      this.enrollments.push({ id, token, body });
      return worker(201, { enrollment: { id, created_by: this.member.id, created: iso(Date.now()), expires: iso(Date.now() + body.ttl_s * 1000), state: 'open', machine: null }, token });
    }
    const keyPath = /^\/api\/enrollments\/([0-9a-f]{32})\/key$/.exec(url.pathname);
    if (method === 'GET' && keyPath !== null) {
      const key = this.enrollmentKeys.get(keyPath[1]);
      return key === undefined ? worker(404, { error: 'no-key' }) : worker(200, key);
    }
    if (method === 'GET' && url.pathname === '/api/machines') {
      const listed = [...this.rows].map(([name, key]) => ({ name, state: 'active', ...(key === null ? {} : { key: { ...key, listed: true } }) }));
      return this.listAnswer?.() ?? worker(200, { machines: listed });
    }
    const machinePath = /^\/api\/machines\/([^/]+)$/.exec(url.pathname);
    if (method === 'DELETE' && machinePath !== null) {
      const name = decodeURIComponent(machinePath[1]);
      const override = await this.deleteAnswer?.(name);
      if (override !== undefined) return override;
      if (!this.rows.has(name)) return worker(404, { error: 'unknown-machine' });
      // #538's precondition: both or neither; a row whose enrollment posted no key, or another, is left as it is.
      const [ref, pub] = [url.searchParams.get('ref'), url.searchParams.get('pub')];
      if ((ref === null) !== (pub === null)) return worker(400, { error: 'bad-shape' });
      const key = this.rows.get(name)!;
      if (ref === null || (key !== null && key.ref === ref && key.pub === pub)) this.rows.delete(name);
      return worker(200, { revoked: name });
    }
    // M4c: the provisioning keys, as the Worker answers them (201 {key, token}; GET with revoked keys; a soft DELETE;
    // renew from the held head's delegation, by §S)
    if (url.pathname === '/api/provisioning-keys' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { label: string; prefix: string; ttl_s: number; max_uses?: number };
      await this.mintGate?.();
      const key = { id: memberId(), label: body.label, prefix: body.prefix, created: iso(Date.now()), expires: iso(Date.now() + body.ttl_s * 1000), max_uses: body.max_uses ?? null, uses: 0, revoked: null, token: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) };
      this.provisioningKeys.push(key);
      return worker(201, { key: { ...listedKey(key), created_by: this.member.id, offline_revoke_s: null, machines: [] }, token: key.token });
    }
    if (url.pathname === '/api/provisioning-keys' && method === 'GET') return this.keysAnswer?.() ?? worker(200, { keys: this.provisioningKeys.map(listedKey) });
    const provisioning = /^\/api\/provisioning-keys\/([0-9a-f]{32})(\/renew)?$/.exec(url.pathname);
    if (provisioning !== null) {
      const key = this.provisioningKeys.find((k) => k.id === provisioning[1]);
      if (method === 'DELETE') {
        const override = this.revokeAnswer?.(provisioning[1]);
        if (override !== undefined) return override;
        if (key === undefined) return worker(404, { error: 'unknown-key' });
        key.revoked ??= iso(Date.now());
        return worker(200, { revoked: key.id });
      }
      if (method === 'POST' && provisioning[2] !== undefined) {
        await this.renewGate?.();
        if (key === undefined) return worker(404, { error: 'unknown-key' });
        if (key.revoked !== null) return worker(410, { error: 'key-revoked' });
        const d = this.head.state.delegations.find((x) => x.id === key.id);
        if (d === undefined || Date.parse(d.expires) <= Date.parse(key.expires)) return worker(409, { error: 'not-renewed' });
        key.expires = d.expires;
        return worker(200, listedKey(key));
      }
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

/** M4c: a provisioning key as the Worker lists it: its record, never its token. */
const listedKey = ({ id, label, prefix, created, expires, max_uses, uses, revoked }: FakeHub['provisioningKeys'][number]) => ({ id, label, prefix, created, expires, max_uses, uses, revoked });

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
    stepUp: () => ({ sign: () => Promise.reject(new Error('no step-up in these tests')), signActions: () => Promise.reject(new Error('no step-up in these tests')) }),
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
    expect(current.identity).toEqual({ org: ORG, member: A, device: entry.id, clientClass: 'native-mac', channelKey: keys.channel, build: 'maws-test 0.0.0', capabilities: [...DEVICE_CAPABILITIES] });
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

  // P5 O7 M10 B: the step-up judges an owned machine's spawn on the head the session holds, read when it signs
  it('hands the step-up the view it holds, read at each signature', async () => {
    const held: Array<HeldOrgView> = [];
    const { session } = await signedIn({ stepUp: (_keys, _device, org) => (held.push(org), { sign: () => Promise.reject(new Error('no step-up in these tests')), signActions: () => Promise.reject(new Error('no step-up in these tests')) }) });
    expect(held.length).toBeGreaterThan(0);
    expect(held.at(-1)!()).toBe(session.current()!.view);
    expect(held.at(-1)!()!.head().state.version).toBe(session.current()!.view.head().state.version);
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
    expect(signerOf(session).pending).toEqual({ version: before + 1, hash, fork: false, exposed: true, refused: '409 key-purged', delegation: null, held: false });

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

// ---- M4b: machines ----

/** A machine `name` listed under A, its name bound to its ref, and its hub row; the session following it. */
async function addMachine(session: OrgSessionService, feed: ReturnType<typeof fakeFeed>, name = 'mini'): Promise<{ ref: string; pub: string }> {
  const ref = base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
  const { pub } = await generateSigningKey();
  hub.chain.push(
    await successor(hub.head, [a1], (s) => {
      s.machines.push({ name, ref, pub, owners: [A] });
      s.machineNames.push({ name, ref });
    }),
  );
  hub.rows.set(name, { ref, pub });
  feed.state(hub.head.state.version);
  await until(() => headVersion(session) === hub.head.state.version, `${name} held`);
  return { ref, pub };
}

/** The machine posts its key under the session's last enrollment, its MAC under the code's secret. */
async function postKey(code: string, name: string, ref = base64urlEncode(crypto.getRandomValues(new Uint8Array(16)))) {
  const { id } = hub.enrollments.at(-1)!;
  const pub = (await generateSigningKey()).pub;
  const mac = await enrollmentMac(base64urlDecode(decodeEnrollmentCodeV2(code).k), { name, machinePub: pub, ref, tokenId: id });
  hub.enrollmentKeys.set(id, { enrollment: id, machine: name, pub, ref, mac, posted: iso(Date.now()) });
  return { ref, pub };
}

/** The window whose sheet enrolls here. */
const WINDOW = 'window-a' as ClientId;

/** An enrollment started on the session, its code, token and secret added to what no status may carry. */
async function enrollStarted(session: OrgSessionService, name: string, replace?: string) {
  const started = await session.enrollStart({ name, ...(replace === undefined ? {} : { replace }) }, WINDOW);
  if (!started.ok) throw new Error(JSON.stringify(started));
  const code = decodeEnrollmentCodeV2(started.code);
  secrets.push(started.code, code.k, code.token);
  return started;
}

const enrollTiming = { timing: { ENROLL_POLL_MS: 10, PAIR_POLL_MS: 10 } };

describe('M4b: org.enroll.*', () => {
  it("enrolls a machine: the code in the start's answer alone, the key compared on the status, listed under this member through the signer", async () => {
    const { session } = await signingRoot(enrollTiming);
    const started = await enrollStarted(session, 'box');
    expect(hub.enrollments.map((e) => e.body)).toEqual([{ ttl_s: 3600 }]);
    expect(decodeEnrollmentCodeV2(started.code)).toMatchObject({ hub: HUB, roots: hub.head.state.root.keys, machine: 'box' });
    expect(registered(session).enrolling).toEqual({ generation: 1, name: 'box', replace: null, expires: started.expires, candidate: null, problem: null });

    const key = await postKey(started.code, 'box');
    await until(() => registered(session).enrolling?.candidate != null, 'the candidate');
    const shown = registered(session).enrolling!;
    expect(shown.candidate).toMatchObject({ name: 'box', ref: key.ref, keyId: await keyId(key.pub) });

    const before = headVersion(session);
    expect(await session.enrollApprove({ generation: shown.generation, digest: shown.candidate!.digest })).toEqual({ ok: true, version: before + 1 });
    expect(signing.prompts.map((p) => p.summary)).toEqual(['enroll machine box']);
    expect(hub.head.state.machines).toEqual([{ name: 'box', ref: key.ref, pub: key.pub, owners: [A] }]);
    expect(registered(session).enrolling).toBeNull();
  });

  it('one enrollment at a time, none beside a pairing or a rekey; a sign-out ends it', async () => {
    const { session, feed } = await signingRoot(enrollTiming);
    const bea = await addMember(session, feed);
    await enrollStarted(session, 'box');
    expect(await session.enrollStart({ name: 'box2' }, WINDOW)).toMatchObject({ ok: false, reason: 'busy' });
    expect(session.pairStart({ member: bea, class: 'native-mac' })).toEqual({ ok: false, reason: 'busy', detail: 'another org attempt is under way' });
    expect(session.rekey((await pairing()).text)).toEqual({ ok: false, reason: { code: 'busy', detail: 'an enrollment is under way: cancel it first' } });
    expect(session.enrollCancel({ generation: registered(session).enrolling!.generation }, WINDOW)).toEqual({ ok: true });
    expect(registered(session).enrolling).toBeNull();

    const paired = session.pairStart({ member: bea, class: 'native-mac' });
    if (!paired.ok) throw new Error(JSON.stringify(paired));
    secrets.push(paired.code, decodePairingCode(paired.code)!.k);
    expect(await session.enrollStart({ name: 'box' }, WINDOW)).toEqual({ ok: false, reason: 'busy', detail: 'another org attempt is under way' });
    session.pairCancel();

    await enrollStarted(session, 'box');
    await session.signOut();
    expect(registered(session).enrolling).toBeNull();
    expect(await session.enrollStart({ name: 'box' }, WINDOW)).toMatchObject({ ok: false, reason: 'not-root' });
  });

  it("refuses an admin whose Mac can't sign, with the page's sentence", async () => {
    const { session } = await signedIn(enrollTiming);
    await until(() => signerOf(session) !== null, 'the signer part');
    expect(signerOf(session).maySign).toBe(false);
    expect(await session.enrollStart({ name: 'box' }, WINDOW)).toEqual({ ok: false, reason: 'not-root', detail: "This Mac can't sign: enroll from an admin's Mac that does" });
    expect(hub.enrollments).toEqual([]);
  });

  it('a sign-out while its Touch ID is open signs nothing that is kept or posted', async () => {
    const { session } = await signingRoot(enrollTiming);
    const started = await enrollStarted(session, 'box');
    await postKey(started.code, 'box');
    await until(() => registered(session).enrolling?.candidate != null, 'the candidate');
    const { generation, candidate } = registered(session).enrolling!;
    const before = headVersion(session);
    const kept = await readFile(join(orgDir(), SIGNING_FILE), 'utf8').catch(() => null);
    let out: Promise<void> | undefined;
    signing.during = () => void (out = session.signOut());
    const result = await session.enrollApprove({ generation, digest: candidate!.digest });
    await out;
    expect(result.ok).toBe(false);
    expect(signing.prompts).toHaveLength(1);
    expect(hub.posted).toEqual([]);
    expect(await readFile(join(orgDir(), SIGNING_FILE), 'utf8').catch(() => null)).toBe(kept);
    expect(hub.head.state.version).toBe(before);
  });

  it('close() while its poll is out resolves once the read ends, and nothing under org/ changes after it', async () => {
    const gate = { armed: false, release: null as (() => void) | null };
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (gate.armed && /\/api\/enrollments\/[0-9a-f]{32}\/key$/.test(new URL(String(input)).pathname)) {
        gate.armed = false;
        await new Promise<void>((resolve) => (gate.release = resolve));
      }
      return hub.fetch(input, init);
    }) as typeof globalThis.fetch;
    const { session } = await signingRoot({ ...enrollTiming, fetch });
    const started = await enrollStarted(session, 'box');
    gate.armed = true;
    await postKey(started.code, 'box');
    await until(() => gate.release !== null, 'the held key read');
    // signingRoot's root-add adoption exposes its in-memory head before saving the anchor. Baseline only once that
    // registration.json write has landed and no atomic-write temp remains, so close itself must change nothing too.
    await until(
      async () => (await readJson<RegistrationFile>(REGISTRATION_FILE)).anchor.version === headVersion(session) && (await readdir(orgDir())).every((name) => !name.startsWith('.')),
      'the root-add anchor saved and org/ at rest',
    );
    const before = await orgSnapshot();
    let closed = false;
    const closing = session.close().then(() => (closed = true));
    await pause(30);
    expect(closed, 'the read is still out').toBe(false);
    gate.release!();
    await closing;
    await pause(30);
    expect(await orgSnapshot()).toEqual(before);
    expect(signing.prompts).toEqual([]);
  });
});

describe('M4b: the machine changes', () => {
  it('a machine is listed only through an enrollment: machine.add and machine.replace from the page are refused before anything composes', async () => {
    const { session, feed } = await signingRoot();
    const { ref } = await addMachine(session, feed);
    const pub = (await generateSigningKey()).pub;
    expect(await session.preview({ kind: 'machine.add', name: 'box', ref: base64urlEncode(crypto.getRandomValues(new Uint8Array(16))), pub, owners: [A] })).toMatchObject({ ok: false, reason: 'invalid', findings: [] });
    expect(await session.preview({ kind: 'machine.replace', ref, pub })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await session.change({ kind: 'machine.replace', ref, pub }, 'A'.repeat(43))).toMatchObject({ ok: false, reason: 'invalid' });
    expect(signing.prompts).toEqual([]);
  });

  it("changes a machine's owners through preview and change", async () => {
    const { session, feed } = await signingRoot();
    const bea = await addMember(session, feed);
    const { ref } = await addMachine(session, feed);
    const preview = await session.preview({ kind: 'machine.owners', ref, owners: [A, bea] });
    if (!preview.ok) throw new Error(JSON.stringify(preview));
    expect(preview.lines).toEqual([`mini's owners become ${OWNER}, bea@example.com (were ${OWNER})`]);
    expect(await session.change(preview.change, preview.digest)).toMatchObject({ ok: true });
    expect(hub.head.state.machines[0].owners).toEqual([A, bea]);
    // a member who owns it is removed only once its owners changed
    expect(await session.preview({ kind: 'member.remove', member: bea })).toMatchObject({ ok: false, reason: 'refused', findings: [{ code: 'owners-unknown', detail: "bea@example.com owns mini: Change the machine's owners first" }] });
  });

  it("drops a machine, its key retired, then deletes its hub row; a delete that fails is offered again, and Retry calls the route alone", async () => {
    const { session, feed } = await signingRoot();
    const { ref, pub } = await addMachine(session, feed);
    const { ref: otherRef } = await addMachine(session, feed, 'studio');
    const preview = await session.preview({ kind: 'machine.drop', ref, revoke: false });
    if (!preview.ok) throw new Error(JSON.stringify(preview));
    expect(await session.change(preview.change, preview.digest)).toMatchObject({ ok: true });
    expect(hub.head.state.machines.map((m) => m.name)).toEqual(['studio']);
    expect(hub.head.state.retired).toEqual([{ keyId: await keyId(pub), pub, notAfter: hub.head.state.issued, holder: { machine: ref } }]);
    expect(hub.calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual([`/api/machines/mini?ref=${encodeURIComponent(ref)}&pub=${encodeURIComponent(pub)}`]);
    expect(hub.rows.has('mini')).toBe(false);
    expect(registered(session).hubRowsLeft).toEqual([]);

    let failing = true;
    hub.deleteAnswer = () => (failing ? worker(503, { error: 'hub-updating' }) : undefined);
    const revoke = await session.preview({ kind: 'machine.drop', ref: otherRef, revoke: true });
    if (!revoke.ok) throw new Error(JSON.stringify(revoke));
    expect(await session.change(revoke.change, revoke.digest)).toMatchObject({ ok: true });
    expect(hub.head.state.revoked.map((r) => r.holder)).toContainEqual({ machine: otherRef });
    expect(registered(session).hubRowsLeft).toEqual([{ name: 'studio', ref: otherRef }]);

    const posts = hub.posted.length;
    const prompts = signing.prompts.length;
    expect(await session.dropRetry('studio')).toMatchObject({ ok: false, reason: 'refused' });
    failing = false;
    expect(await session.dropRetry('mini')).toMatchObject({ ok: false, reason: 'none' });
    expect(await session.dropRetry('studio')).toEqual({ ok: true });
    expect(registered(session).hubRowsLeft).toEqual([]);
    expect(hub.rows.has('studio')).toBe(false);
    expect([hub.posted.length, signing.prompts.length], 'no state signed or posted by a retry').toEqual([posts, prompts]);
    expect(hub.calls.filter((c) => c.method === 'DELETE').map((c) => c.path.split('?')[0])).toEqual(['/api/machines/mini', '/api/machines/studio', '/api/machines/studio', '/api/machines/studio']);
  });

  it("refuses dropping this Mac's own machine", async () => {
    const machine = { ref: base64urlEncode(crypto.getRandomValues(new Uint8Array(16))) };
    const { session, feed } = await signingRoot({ local: machine.ref as never });
    hub.chain.push(
      await successor(hub.head, [a1], async (s) => {
        s.machines.push({ name: 'this-mac', ref: machine.ref, pub: (await generateSigningKey()).pub, owners: [A] });
        s.machineNames.push({ name: 'this-mac', ref: machine.ref });
      }),
    );
    feed.state(hub.head.state.version);
    await until(() => headVersion(session) === hub.head.state.version, 'this Mac listed');
    expect(await session.preview({ kind: 'machine.drop', ref: machine.ref, revoke: false })).toMatchObject({ ok: false, reason: 'refused', findings: [{ code: 'this-machine' }] });
  });

  it("the view lists a certified machine, its owners its delegation's, beside the listed ones with their key ids", async () => {
    const { session, feed } = await signingRoot();
    const bea = await addMember(session, feed);
    const { pub } = await addMachine(session, feed);
    const delegation = await generateSigningKey();
    const id = memberId();
    hub.chain.push(await successor(hub.head, [a1], (s) => void s.delegations.push({ id, pub: delegation.pub, prefix: 'dc-', expires: iso(Date.now() + 30 * DAY), maxUses: 10, offlineRevokeS: 0, owners: [bea] })));
    const vm = await generateSigningKey();
    const certRef = `${id}_${base64urlEncode(crypto.getRandomValues(new Uint8Array(16)))}`;
    hub.certificates = { certs: [await signRecord(SIGNING_DOMAINS.machineCert, { org: ORG, machine: certRef, name: 'dc-vm1', pub: vm.pub, delegation: id, use: 1, issued: iso(Date.now() - HOUR) }, delegation.privateKey, delegation.pub)], retirements: [] };
    feed.state(hub.head.state.version);
    await until(async () => (await session.view())?.machines.length === 2, 'the certified machine');
    expect((await session.view())!.machines).toEqual([
      // no grants' deps here: no Grant… anywhere (M4b's grants cases have them)
      { name: 'mini', ref: hub.head.state.machines[0].ref, owners: [A], keyId: await keyId(pub), certified: false, delegation: null, mayGrant: false },
      { name: 'dc-vm1', ref: certRef, owners: [bea], keyId: await keyId(vm.pub), certified: true, delegation: id, mayGrant: false },
    ]);
    expect(await session.preview({ kind: 'machine.owners', ref: certRef, owners: [A] })).toMatchObject({ ok: false, reason: 'refused', findings: [{ code: 'certified-machine' }] });
  });
});

describe('M4c: the delegation changes', () => {
  it('a delegation is created only through Create…: delegation.add from the page is refused before anything composes', async () => {
    const { session } = await signingRoot();
    const change = { kind: 'delegation.add' as const, id: memberId(), pub: (await generateSigningKey()).pub, prefix: 'dc-', expires: iso(Date.now() + 30 * DAY), maxUses: 10, offlineRevokeS: 0, owners: [A] };
    const [posts, prompts] = [hub.posted.length, signing.prompts.length];
    expect(await session.preview(change)).toMatchObject({ ok: false, reason: 'invalid', detail: expect.stringContaining('Create'), findings: [] });
    expect(await session.change(change, 'A'.repeat(43))).toMatchObject({ ok: false, reason: 'invalid', detail: expect.stringContaining('Create') });
    expect([hub.posted.length, signing.prompts.length]).toEqual([posts, prompts]);
  });

  it("a drop's preview names the machines the delegation certified, from the held certificates, in its lines and its warning", async () => {
    const { session, feed } = await signingRoot();
    const delegation = await generateSigningKey();
    const id = memberId();
    hub.chain.push(await successor(hub.head, [a1], (s) => void s.delegations.push({ id, pub: delegation.pub, prefix: 'dc-', expires: iso(Date.now() + 30 * DAY), maxUses: 10, offlineRevokeS: 0, owners: [A] })));
    const certRef = `${id}_${base64urlEncode(crypto.getRandomValues(new Uint8Array(16)))}`;
    hub.certificates = { certs: [await signRecord(SIGNING_DOMAINS.machineCert, { org: ORG, machine: certRef, name: 'dc-vm1', pub: (await generateSigningKey()).pub, delegation: id, use: 1, issued: iso(Date.now() - HOUR) }, delegation.privateKey, delegation.pub)], retirements: [] };
    feed.state(hub.head.state.version);
    await until(async () => (await session.view())?.machines.length === 1, 'the certified machine');
    const preview = await session.preview({ kind: 'delegation.drop', id });
    if (!preview.ok) throw new Error(JSON.stringify(preview));
    expect(preview.lines.join('\n')).toContain('dc-vm1');
    expect(preview.warnings).toHaveLength(1);
    expect(preview.warnings[0]).toContain('dc-vm1 (live)');
  });
});

describe('M4b: a drop that settles later (the fix wave)', () => {
  /** `mini` dropped while the hub answers its post `answer`: signed and kept, unsettled, its row untouched. */
  async function pendingDrop(over: Overrides = {}, answer: () => Answer = () => worker(503, { error: 'hub-updating' })) {
    const root = await signingRoot(over);
    const { ref, pub } = await addMachine(root.session, root.feed);
    hub.postAnswer = answer;
    const preview = await root.session.preview({ kind: 'machine.drop', ref, revoke: false });
    if (!preview.ok) throw new Error(JSON.stringify(preview));
    expect(await root.session.change(preview.change, preview.digest)).toMatchObject({ ok: false, reason: 'hub' });
    expect(signerOf(root.session).pending).not.toBeNull();
    expect(deletes()).toEqual([]);
    expect(registered(root.session).hubRowsLeft).toEqual([]);
    expect((await readJson<SigningFile>(SIGNING_FILE)).pending?.hubRow, 'the row is kept with the slot').toEqual({ name: 'mini', ref, pub });
    return { ...root, ref, pub };
  }
  const deleteCalls = () => hub.calls.filter((c) => c.method === 'DELETE').map((c) => new URL(c.path, LOCAL_HUB));
  const deletes = () => deleteCalls().map((u) => u.pathname);
  /** Each DELETE's precondition: the dropped machine's ref and pub (the hub leaves a row another key enrolled). */
  const preconditions = () => deleteCalls().map((u) => Object.fromEntries(u.searchParams));

  it('deletes the row once a later settle lands that very state', async () => {
    const { session, feed, ref, pub } = await pendingDrop();
    hub.postAnswer = undefined;
    feed.open();
    await until(() => signerOf(session).pending === null, 'settled');
    await until(() => !hub.rows.has('mini'), 'the row deleted');
    expect(deletes()).toEqual(['/api/machines/mini']);
    expect(preconditions()).toEqual([{ ref, pub }]);
    expect(registered(session).hubRowsLeft).toEqual([]);
  });

  it("a later settlement whose delete fails puts the row on Retry, which deletes it", async () => {
    const { session, feed, ref, pub } = await pendingDrop();
    hub.postAnswer = undefined;
    hub.deleteAnswer = () => worker(503, { error: 'hub-updating' });
    feed.open();
    await until(() => registered(session).hubRowsLeft.length === 1, 'the row left');
    expect(registered(session).hubRowsLeft, 'the status names the row, its pub kept inside').toEqual([{ name: 'mini', ref }]);
    hub.deleteAnswer = undefined;
    expect(await session.dropRetry('mini')).toEqual({ ok: true });
    expect(hub.rows.has('mini')).toBe(false);
    expect(preconditions(), "the settlement's delete and Retry's both carry the dropped machine's key").toEqual([{ ref, pub }, { ref, pub }]);
  });

  it('a relaunch with the drop still pending deletes the row when the next start settles it', async () => {
    await pendingDrop();
    hub.postAnswer = undefined;
    const again = await restart();
    await until(() => !hub.rows.has('mini'), 'the row deleted after the relaunch');
    expect(deletes()).toEqual(['/api/machines/mini']);
    expect(registered(again.session).hubRowsLeft).toEqual([]);
  });

  it('a discarded drop deletes nothing', async () => {
    const { session, feed } = await pendingDrop({}, () => worker(409, { error: 'key-purged' }));
    const { hash } = signerOf(session).pending!;
    expect(await session.discardPending(true, hash)).toMatchObject({ ok: true });
    hub.postAnswer = undefined;
    feed.open();
    await pause(50);
    expect(deletes()).toEqual([]);
    expect(hub.rows.has('mini')).toBe(true);
    expect(registered(session).hubRowsLeft).toEqual([]);
  });

  it('a drop another state forked deletes nothing, discarded or not', async () => {
    const { session, feed } = await pendingDrop();
    // another root's state takes the drop's version: the slot is a fork
    hub.chain.push(await successor(hub.head, [a1], (s) => void s.members.push({ id: memberId(), email: 'cal@example.com', role: 'member', devices: [] })));
    hub.postAnswer = undefined;
    feed.state(hub.head.state.version);
    await until(() => signerOf(session).pending?.fork === true, 'the fork');
    expect(deletes()).toEqual([]);
    expect(await session.discardPending(true, signerOf(session).pending!.hash)).toMatchObject({ ok: true });
    await pause(50);
    expect(deletes()).toEqual([]);
    expect(hub.rows.has('mini')).toBe(true);
  });

  it("a cancelled sign-in attempt while the delete is out leaves the sign-in's Retry standing", async () => {
    const { session, feed } = await signingRoot();
    const { ref } = await addMachine(session, feed);
    const gate = { open: () => {} };
    const held = new Promise<void>((resolve) => (gate.open = resolve));
    hub.deleteAnswer = async () => {
      await held;
      return worker(503, { error: 'hub-updating' });
    };
    const preview = await session.preview({ kind: 'machine.drop', ref, revoke: false });
    if (!preview.ok) throw new Error(JSON.stringify(preview));
    const changing = session.change(preview.change, preview.digest);
    await until(() => hub.calls.some((c) => c.method === 'DELETE'), 'the delete out');
    // an unrelated attempt, started and cancelled: the owning sign-in still stands
    expect(session.signIn()).toEqual({ ok: true });
    session.cancel();
    expect(isSignedIn(session)).toBe(true);
    gate.open();
    expect(await changing).toMatchObject({ ok: true });
    expect(registered(session).hubRowsLeft).toEqual([{ name: 'mini', ref }]);
    hub.deleteAnswer = undefined;
    expect(await session.dropRetry('mini')).toEqual({ ok: true });
  });

  /** `name` listed again under its bound ref (a new key), as another root's re-enrollment lands it. */
  const relisted = async (name: string, ref: string) =>
    successor(hub.head, [a1], async (s) => void s.machines.push({ name, ref, pub: (await generateSigningKey()).pub, owners: [A] }));

  it('a drop adopted in the same chain read as a re-enrollment of its name sends no delete: the row is the new listing\'s', async () => {
    const { session, feed, ref } = await pendingDrop();
    // the drop reached the hub another way, and another root re-enrolled mini after it: one read takes both
    hub.chain.push((await readJson<SigningFile>(SIGNING_FILE)).pending!.signed);
    hub.chain.push(await relisted('mini', ref));
    hub.postAnswer = undefined;
    feed.state(hub.head.state.version);
    await until(() => signerOf(session).pending === null && headVersion(session) === hub.head.state.version, 'settled under the re-listing');
    await pause(50);
    expect(deletes()).toEqual([]);
    expect(hub.rows.has('mini')).toBe(true);
    expect(registered(session).hubRowsLeft).toEqual([]);
  });

  it('a re-listing that lands while a settled drop\'s delete waits its turn sends no delete for it', async () => {
    const { session, feed } = await signingRoot();
    const { ref: studio } = await addMachine(session, feed, 'studio');
    const { ref } = await addMachine(session, feed);
    const gate = { open: () => {} };
    const held = new Promise<void>((resolve) => (gate.open = resolve));
    hub.deleteAnswer = async (name) => (name === 'studio' ? (await held, undefined) : undefined);
    const drop = async (target: string) => {
      const preview = await session.preview({ kind: 'machine.drop', ref: target, revoke: false });
      if (!preview.ok) throw new Error(JSON.stringify(preview));
      return session.change(preview.change, preview.digest);
    };
    const first = drop(studio);
    await until(() => deletes().length === 1, "studio's delete out");
    const second = drop(ref);
    await until(() => signerOf(session).pending === null && !hub.head.state.machines.some((m) => m.name === 'mini') && headVersion(session) === hub.head.state.version, "mini's drop settled, its delete queued");
    hub.chain.push(await relisted('mini', ref));
    feed.state(hub.head.state.version);
    await until(() => headVersion(session) === hub.head.state.version, 'the re-listing held');
    gate.open();
    expect(await first).toMatchObject({ ok: true });
    expect(await second).toMatchObject({ ok: true });
    expect(deletes()).toEqual(['/api/machines/studio']);
    expect(hub.rows.has('mini')).toBe(true);
    expect(registered(session).hubRowsLeft).toEqual([]);
  });

  it('the delete reads the hub rows first: a row its enrollment left with no posted key is deleted by name alone', async () => {
    const { session, feed } = await pendingDrop();
    hub.rows.set('mini', null); // re-enrolled in place, the new enrollment never listed
    hub.postAnswer = undefined;
    feed.open();
    await until(() => !hub.rows.has('mini'), 'the row deleted');
    expect(hub.calls.filter((c) => c.path.startsWith('/api/machines')).map((c) => `${c.method} ${c.path}`)).toEqual(['GET /api/machines', 'DELETE /api/machines/mini']);
    expect(registered(session).hubRowsLeft).toEqual([]);
  });

  it("a row that posted another machine's key is that machine's: nothing is sent, and nothing is offered again", async () => {
    const { session, feed, ref } = await pendingDrop();
    hub.rows.set('mini', { ref, pub: (await generateSigningKey()).pub });
    hub.postAnswer = undefined;
    feed.open();
    await until(() => signerOf(session).pending === null && hub.calls.some((c) => c.path === '/api/machines'), 'settled, the rows read');
    await pause(30);
    expect(deletes()).toEqual([]);
    expect(hub.rows.has('mini')).toBe(true);
    expect(registered(session).hubRowsLeft).toEqual([]);
  });

  it('a row absent from the list is already gone: settled, nothing sent, nothing offered again', async () => {
    const { session, feed } = await pendingDrop();
    hub.rows.delete('mini');
    hub.postAnswer = undefined;
    feed.open();
    await until(() => signerOf(session).pending === null && hub.calls.some((c) => c.path === '/api/machines'), 'settled, the rows read');
    await pause(30);
    expect(deletes()).toEqual([]);
    expect(registered(session).hubRowsLeft).toEqual([]);
  });

  it('a delete answered 404 unknown-machine is already gone: settled, nothing offered again', async () => {
    const { session, feed } = await pendingDrop();
    hub.deleteAnswer = () => worker(404, { error: 'unknown-machine' });
    hub.postAnswer = undefined;
    feed.open();
    await until(() => deletes().length === 1, 'the delete');
    await until(() => signerOf(session).pending === null, 'settled');
    await pause(30);
    expect(registered(session).hubRowsLeft).toEqual([]);
  });

  it('a keyed delete answered 503 hub-updating (a Registry mid-deploy) is never gone: offered again, on the settlement and on Retry', async () => {
    const { session, feed, ref, pub } = await pendingDrop();
    hub.deleteAnswer = () => worker(503, { error: 'hub-updating' });
    hub.postAnswer = undefined;
    feed.open();
    await until(() => registered(session).hubRowsLeft.length === 1, 'the row left');
    expect(registered(session).hubRowsLeft).toEqual([{ name: 'mini', ref }]);
    expect(await session.dropRetry('mini')).toEqual({ ok: false, reason: 'refused', detail: 'the hub answered 503 hub-updating' });
    expect(registered(session).hubRowsLeft).toEqual([{ name: 'mini', ref }]);
    expect(hub.rows.has('mini')).toBe(true);
    expect(preconditions(), 'both keyed').toEqual([{ ref, pub }, { ref, pub }]);
    hub.deleteAnswer = undefined;
    expect(await session.dropRetry('mini')).toEqual({ ok: true });
    expect(hub.rows.has('mini')).toBe(false);
  });

  it('a row list that fails offers the row again, and Retry reads it anew', async () => {
    const { session, feed, ref } = await pendingDrop();
    hub.listAnswer = () => worker(503, { error: 'hub-updating' });
    hub.postAnswer = undefined;
    feed.open();
    await until(() => registered(session).hubRowsLeft.length === 1, 'the row left');
    expect(registered(session).hubRowsLeft).toEqual([{ name: 'mini', ref }]);
    expect(deletes()).toEqual([]);
    hub.listAnswer = undefined;
    expect(await session.dropRetry('mini')).toEqual({ ok: true });
    expect(hub.rows.has('mini')).toBe(false);
  });

  it("a certified machine's drop is refused before anything is signed or sent", async () => {
    const { session, feed } = await signingRoot();
    const bea = await addMember(session, feed);
    const delegation = await generateSigningKey();
    const id = memberId();
    hub.chain.push(await successor(hub.head, [a1], (s) => void s.delegations.push({ id, pub: delegation.pub, prefix: 'dc-', expires: iso(Date.now() + 30 * DAY), maxUses: 10, offlineRevokeS: 0, owners: [bea] })));
    const vm = await generateSigningKey();
    const certRef = `${id}_${base64urlEncode(crypto.getRandomValues(new Uint8Array(16)))}`;
    hub.certificates = { certs: [await signRecord(SIGNING_DOMAINS.machineCert, { org: ORG, machine: certRef, name: 'dc-vm1', pub: vm.pub, delegation: id, use: 1, issued: iso(Date.now() - HOUR) }, delegation.privateKey, delegation.pub)], retirements: [] };
    hub.rows.set('dc-vm1', null);
    feed.state(hub.head.state.version);
    await until(async () => (await session.view())?.machines.length === 1, 'the certified machine');
    const [posts, prompts] = [hub.posted.length, signing.prompts.length];
    expect(await session.preview({ kind: 'machine.drop', ref: certRef, revoke: false })).toMatchObject({ ok: false, reason: 'refused', findings: [{ code: 'certified-machine' }] });
    expect([hub.posted.length, signing.prompts.length]).toEqual([posts, prompts]);
    expect(hub.calls.filter((c) => c.path.startsWith('/api/machines'))).toEqual([]);
    expect(hub.rows.has('dc-vm1')).toBe(true);
  });

  it('Retry on a name listed again sends nothing and takes the row off the status', async () => {
    const { session, feed, ref } = await pendingDrop();
    hub.postAnswer = undefined;
    hub.deleteAnswer = () => worker(503, { error: 'hub-updating' });
    feed.open();
    await until(() => registered(session).hubRowsLeft.length === 1, 'the row left');
    hub.chain.push(await relisted('mini', ref));
    feed.state(hub.head.state.version);
    await until(() => headVersion(session) === hub.head.state.version, 'the re-listing held');
    hub.deleteAnswer = undefined;
    expect(await session.dropRetry('mini')).toMatchObject({ ok: false, reason: 'none' });
    expect(registered(session).hubRowsLeft).toEqual([]);
    expect(deletes()).toEqual(['/api/machines/mini']); // the settlement's failed one alone
    expect(hub.rows.has('mini')).toBe(true);
  });

  it('a sign-out between the sign and the settlement: the row goes when the next sign-in settles the drop', async () => {
    const { session, feed } = await pendingDrop();
    await session.signOut();
    hub.postAnswer = undefined;
    await pause(30);
    expect(deletes()).toEqual([]);
    expect(session.signIn()).toEqual({ ok: true });
    await until(() => isSignedIn(session), 'signed in again');
    feed.open();
    await until(() => !hub.rows.has('mini'), 'the row deleted under the new sign-in');
    expect(deletes()).toEqual(['/api/machines/mini']);
    expect(registered(session).hubRowsLeft).toEqual([]);
  });
});

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

// M7a: the project channels composed over the session (Interfaces §N): a channel opened through the service reads the
// hub's Project socket with the session's hub headers, verifies each event against the held head, and its cache under
// org/channel/ is written through the commit queue, last at close(), which resolves only once that write landed.
describe('M7a: the project channels', () => {
  const PROJECT = '1f0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
  type Sent = Array<Record<string, unknown>>;
  function channelSockets() {
    const sockets: Array<{ url: string; headers: Record<string, string>; sent: Sent; closed: boolean; deliver(frame: unknown): void }> = [];
    const socket = (url: string, headers: Record<string, string>) => {
      const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
      const made = {
        url,
        headers,
        sent: [] as Sent,
        closed: false,
        deliver: (frame: unknown) => listeners.get('message')?.forEach((l) => l(JSON.stringify(frame))),
        on: (event: string, listener: (...args: unknown[]) => void) => void listeners.set(event, [...(listeners.get(event) ?? []), listener]),
        send: (text: string) => void made.sent.push(JSON.parse(text) as Record<string, unknown>),
        ping: () => {},
        terminate: () => void (made.closed = true), // the app's own end (P5 O15 M2b §G rule 5)
      };
      sockets.push(made);
      return made as never;
    };
    return { sockets, socket };
  }

  it("opens a project's channel on the session's hub, draws a member's words verified, and close() joins its cache write", async () => {
    const { sockets, socket } = channelSockets();
    const { session } = await signedIn({ channelSocket: socket, timing: { CHANNEL_WRITE_MS: 3_600_000 } });
    expect(await session.channelOpen(PROJECT)).toEqual({ ok: true, rev: expect.any(Number), events: [], sessions: [], pending: [], unverified: 0, asOf: null, live: false, reach: 'connecting' });
    await until(() => sockets.length === 1, 'a channel socket');
    expect(sockets[0].url).toBe(`wss://hub.example.test/api/projects/${PROJECT}/socket`);
    expect(Object.keys(sockets[0].headers)).toContain('cf-access-token');
    sockets[0].deliver({ t: 'welcome' });
    expect(sockets[0].sent).toEqual([{ t: 'resume', after: 0 }]);
    const draft = { kind: 'human', from: 'human', member: A, to: '*', text: 'from my other Mac', created: iso(Date.now()), nonce: base64urlEncode(crypto.getRandomValues(new Uint8Array(16))) };
    const { signEvent } = await import('../../../apps/org-protocol/src/index.ts');
    const words = { ts: iso(Date.now()), writer: `hub/${A}`, seq: 1, ...(await signEvent({ org: ORG, project: PROJECT }, draft, a1.channel.privateKey, a1.channel.pub)) };
    const changes: unknown[] = [];
    session.onChannel((changed) => changes.push(changed));
    sockets[0].deliver({ t: 'log', events: [{ offset: 1, event: words }] });
    sockets[0].deliver({ t: 'caught-up', offset: 1 });
    await until(() => changes.length > 0 && (changes.at(-1) as { live?: boolean }).live === true, 'the channel live');
    expect(changes.at(-1)).toMatchObject({ project: PROJECT, ok: true, live: true });
    // told as deltas after the open's answer: the one event, once
    expect(changes.flatMap((c) => (c as { upserts?: unknown[] }).upserts ?? [])).toMatchObject([{ offset: 1, label: 'verified', author: { id: A, email: OWNER } }]);
    expect(await session.channelSend(PROJECT, 'hello')).toMatchObject({ ok: true });
    expect(sockets[0].sent.at(-1)).toMatchObject({ t: 'human', event: { member: A, text: 'hello' } });
    await session.close();
    expect(sockets[0].closed).toBe(true);
    const file = JSON.parse(await readFile(join(orgDir(), 'channel', `${PROJECT}.json`), 'utf8')) as { after: number; events: Array<{ offset: number }> };
    expect(file.after).toBe(1);
    expect(file.events.map((e) => e.offset)).toEqual([1]);
    expect((await stat(join(orgDir(), 'channel'))).mode & 0o777).toBe(0o700);
  });

  // P5 O15 M2b §G: the session hands its wake source and reach to every channel's socket
  it('hands its wake source and reach to the channels: a wake of an hour drops a channel’s socket and opens the next behind the hub’s answer', async () => {
    const { sockets, socket } = channelSockets();
    const wake = fakeWake();
    const reach = fakeReach();
    const { session } = await signedIn({ channelSocket: socket, wake: wake.source, reach: reach.reach, timing: { CHANNEL_WRITE_MS: 3_600_000 } });
    await session.channelOpen(PROJECT);
    await until(() => sockets.length === 1, 'a channel socket');
    sockets[0].deliver({ t: 'welcome' });
    wake.wake(3_600_000);
    expect(sockets[0].closed).toBe(true);
    expect(reach.windows).toEqual(['wake']);
    await until(() => reach.waiting.length === 1, 'the wait on the hub');
    expect(reach.waiting[0].target).toBe('https://hub.example.test');
    reach.answer(true);
    await until(() => sockets.length === 2, 'the channel socket after the wake');
    await session.close();
    expect(sockets[1].closed).toBe(true);
    expect(wake.listeners()).toBe(0);
  });

  it('answers signed-out, and opens no socket, for a profile that never signed in', async () => {
    const { sockets, socket } = channelSockets();
    const { session } = make({ channelSocket: socket });
    await session.loaded;
    expect(await session.channelOpen(PROJECT)).toEqual({ ok: false, reason: 'signed-out', rev: expect.any(Number) });
    expect(await session.channelSend(PROJECT, 'hi')).toEqual({ ok: false, reason: 'signed-out' });
    expect(sockets).toEqual([]);
    await session.close();
    await expect(stat(orgDir())).rejects.toThrow();
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

// ---- M4b: the grants ----

const BEA = 'beadbeadbeadbeadbeadbeadbeadbead';

/** One machine's grant ledger behind a link and the door, kept by the endpoint's intake rule (src/endpoint/grants.ts). */
function grantMachine(heldKey: () => Promise<string>) {
  const ledger = { grants: {} as Record<string, Signed<Grant>>, highWater: {} as Record<string, number> };
  const answer = () => ({ members: hub.head.state.members.map((m) => ({ member: m.id, grant: ledger.grants[m.id] ?? null, highWater: ledger.highWater[m.id] ?? 0 })) });
  const intake = async (value: unknown): Promise<{ state: string; error?: { code: string } }> => {
    const g = value as Signed<Grant>;
    const verdict = await verifyGrant(hub.head.state, g, NO_CERTIFICATES, new Date());
    if (!verdict.ok) return { state: 'failed', error: { code: verdict.code } };
    if (g.body.machineKey !== (await heldKey())) return { state: 'failed', error: { code: 'not-held' } };
    if ((ledger.highWater[g.body.member] ?? 0) >= g.body.version) return { state: 'failed', error: { code: 'not-newer' } };
    ledger.grants[g.body.member] = g;
    ledger.highWater[g.body.member] = g.body.version;
    return { state: 'done' };
  };
  const acts: unknown[] = [];
  let holdAct: Promise<void> | null = null;
  // The machine follows the hub: the head pushed before a grant (deliveries.ts's `bringTo`) is the one it holds.
  const pushed = (version: number) => ({ opId: 'push', opCreated: new Date().toISOString(), progress: () => 'sent', onProgress: () => () => {}, outcome: Promise.resolve({ state: 'done', result: { version } }) });
  const link = {
    state: () => 'up',
    onState: () => () => {},
    caps: () => ({ member: A, device: 'dev', clientClass: 'native-mac', machine: { grades: [] }, stateVersion: hub.head.state.version }),
    call: async () => ({ ok: true, output: answer() }),
    act: (request: { action: string; args: unknown }) => {
      if (request.action === 'endpoint.state') return pushed(hub.head.state.version);
      acts.push(request);
      const hold = holdAct;
      return {
        opId: `op-${acts.length}-xxxxxxxxxxxxxxxx`,
        opCreated: new Date().toISOString(),
        progress: () => 'sent',
        onProgress: () => () => {},
        outcome: (async () => {
          await hold;
          return intake((request.args as { grant: unknown }).grant);
        })(),
      };
    },
  } as unknown as GrantLink;
  const door: GrantDoor = {
    act: async (action) => (acts.push(action), intake(action.args.grant)),
    grants: async () => ({ ok: true, output: answer() }),
  };
  return { ledger, link, door, acts, hold: (p: Promise<void> | null) => void (holdAct = p) };
}

/** The grants' deps for make(): a record signer over the profile's step-up key that records each prompt (no Touch ID). */
function testGrants(machine: ReturnType<typeof grantMachine>, ref: () => string | null) {
  const harness = { prompts: [] as StepUpPrompt[], during: null as (() => Promise<unknown> | unknown) | null };
  const deps: NonNullable<OrgSessionDeps['grants']> = {
    recordSigner: (k) =>
      createRecordSigner({
        key: k.stepUp,
        confirm: async (prompt) => {
          harness.prompts.push(prompt);
          await harness.during?.();
          return { ok: true };
        },
      }),
    door: machine.door,
    roster: () => (ref() === null ? [] : [ref() as MachineRef]),
    onRoster: () => () => {},
    link: (r) => (r === ref() ? machine.link : null),
  };
  return { harness, deps };
}

/** Signed in (not a root), the head listing BEA and a machine `mini` this member owns; its grants over a fake ledger. */
async function granting(local = false) {
  let ref: string | null = null;
  let pub = '';
  const machine = grantMachine(async () => keyId(pub));
  const grants = testGrants(machine, () => (local ? null : ref));
  const localRef = base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
  const made = await signedIn({ grants: grants.deps, ...(local ? { local: localRef as MachineRef } : {}) });
  const feed = fakeFeed();
  made.session.attach(feed.hooks);
  ref = local ? localRef : base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
  pub = (await generateSigningKey()).pub;
  hub.chain.push(
    await successor(hub.head, [a1], (s) => {
      s.members.push({ id: BEA, email: 'bea@example.com', role: 'member', devices: [] });
      s.machines.push({ name: 'mini', ref: ref!, pub, owners: [A] });
      s.machineNames.push({ name: 'mini', ref: ref! });
    }),
  );
  await followHub(made.session, feed);
  return { ...made, feed, machine, grants: grants.harness, ref: ref as string };
}

describe('M4b: the grants', () => {
  it('a signed-in owner who is no root sees Grant… on its machine, grants through its link, and grants.json is written after the mark', async () => {
    const { session, machine, grants, ref } = await granting();
    expect(signerOf(session).maySign).toBe(false);
    const view = await session.view();
    expect(view?.machines.find((m) => m.ref === ref)?.mayGrant).toBe(true);
    expect(await session.grantsSet({ ref, member: BEA, rights: ['spawn'] })).toEqual({ ok: true, version: 1, delivered: 'done' });
    expect(grants.prompts).toHaveLength(1);
    expect(machine.ledger.grants[BEA].body).toMatchObject({ machine: ref, member: BEA, rights: ['spawn'], version: 1 });
    expect((await readJson<RegistrationFile>(REGISTRATION_FILE)).grants).toBe(true);
    expect(((await stat(join(orgDir(), GRANTS_FILE))).mode & 0o777).toString(8)).toBe('600');
    expect(await readJson<GrantsFile>(GRANTS_FILE)).toMatchObject({ version: 1, issued: [{ delivered: 'done', signed: { body: { version: 1 } } }] });
    const grantsView = await session.grantsView({ ref });
    expect(grantsView).toMatchObject({ ok: true, live: true, grants: [{ member: BEA, rights: ['spawn'], version: 1, state: 'on-machine' }] });
  });

  it('goes through the local door for this Mac’s own machine', async () => {
    const { session, machine, ref } = await granting(true);
    expect(await session.grantsSet({ ref, member: BEA, rights: ['shell'] })).toMatchObject({ ok: true, delivered: 'done' });
    expect(machine.acts).toHaveLength(1);
    expect(machine.acts[0]).toMatchObject({ v: 1, machine: ref, action: 'endpoint.grant' });
  });

  it('a sign-out during the grant’s Touch ID keeps and sends nothing', async () => {
    const { session, machine, grants, ref } = await granting();
    grants.during = () => session.signOut();
    expect(await session.grantsSet({ ref, member: BEA, rights: ['spawn'] })).toMatchObject({ ok: false, reason: 'cancelled' });
    expect(machine.acts).toEqual([]);
    expect(await exists(join(orgDir(), GRANTS_FILE))).toBe(false);
    expect(await session.grantsView({ ref })).toEqual({ ok: false, ref, reason: 'signed-out' });
  });

  it('close() while the grant’s act is out joins it: its outcome is written before the close resolves, nothing after', async () => {
    const { session, machine, ref } = await granting();
    let release!: () => void;
    machine.hold(new Promise<void>((resolve) => (release = resolve)));
    const answer = session.grantsSet({ ref, member: BEA, rights: ['spawn'] });
    await until(() => machine.acts.length === 1, 'the act out');
    expect(await readJson<GrantsFile>(GRANTS_FILE)).toMatchObject({ issued: [{ delivered: 'sending' }] }); // the write-ahead
    let closed = false;
    const closing = session.close().then(() => void (closed = true));
    await pause(30);
    expect(closed).toBe(false);
    release();
    await closing;
    expect(await answer).toMatchObject({ ok: true, delivered: 'done' });
    expect(await readJson<GrantsFile>(GRANTS_FILE)).toMatchObject({ issued: [{ delivered: 'done' }] });
    const files = await orgSnapshot();
    await pause(30);
    expect(await orgSnapshot()).toEqual(files);
  });

  it('a grants.json gone after its mark is damaged: the page says so and no grant is signed', async () => {
    const { session, grants, ref } = await granting();
    await session.grantsSet({ ref, member: BEA, rights: ['spawn'] });
    await session.close();
    await rm(join(orgDir(), GRANTS_FILE));
    const { session: again } = await restart({ grants: testGrants(grantMachine(async () => ''), () => ref).deps });
    await until(() => isSignedIn(again), 'signed in after the restart');
    expect(await again.grantsView({ ref })).toEqual({ ok: false, ref, reason: 'damaged' });
    expect(await again.grantsSet({ ref, member: BEA, rights: ['shell'] })).toMatchObject({ ok: false, reason: 'damaged' });
    expect(grants.prompts).toHaveLength(1);
  });

  it('without the grants’ deps, no machine shows Grant… and every grant reads signed out', async () => {
    const { session, feed } = await signingRoot();
    const { ref } = await addMachine(session, feed);
    expect((await session.view())?.machines.every((m) => !m.mayGrant)).toBe(true);
    expect(await session.grantsView({ ref })).toEqual({ ok: false, ref, reason: 'signed-out' });
  });
});

// ---- M4c: delegations through the session ----

// Task 3's fake gcloud, trimmed: argv and stdin recorded; `act-<op>` holding `wait` holds that call until `release-<op>`,
// and `fail` fails it.
const FAKE_GCLOUD = `#!/bin/sh
dir=$(cd "$(dirname "$0")" && pwd)
{ printf 'gcloud'; for a in "$@"; do printf ' %s' "$a"; done; printf '\\n'; } >> "$dir/argv.log"
case "$1 $2 $3" in
  "auth print-access-token "*) op=auth ;;
  "secrets describe "*) op=describe ;;
  "secrets versions add") op=add ;;
  "secrets versions describe") op=version ;;
  *) op=other ;;
esac
cat >> "$dir/stdin.log"
act=$(cat "$dir/act-$op" 2>/dev/null || echo ok)
case "$act" in
  wait) : > "$dir/waiting-$op"; while [ ! -f "$dir/release-$op" ]; do sleep 0.02; done; rm -f "$dir/release-$op" "$dir/waiting-$op" ;;
  fail) printf 'ERROR: (gcloud.secrets.versions.add) INTERNAL: down\n' >&2; exit 1 ;;
esac
case "$op" in
  add) printf 'Created version [7] of the secret [%s].\\n' "$4" >&2 ;;
  version) printf '{"createTime": "2026-11-08T12:00:00.123456Z", "name": "projects/1/secrets/%s/versions/%s", "state": "ENABLED"}\\n' "$6" "$4" ;;
esac
exit 0
`;

describe('M4c: delegations through the session', () => {
  const DEST = { project: 'maws-example-prod', secret: 'desk-provisioning-v2', account: 'cli-owner@maws-example-prod.iam.gserviceaccount.com' };
  const CREATE = { label: 'devcloud VMs', prefix: 'dc-', ttlDays: 30, maxUses: null, owners: [] as string[] };
  let bin: string;
  beforeEach(async () => {
    bin = join(userData, 'scratch-bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'gcloud'), FAKE_GCLOUD);
    await chmod(join(bin, 'gcloud'), 0o755);
  });
  /** The session's custody over the fake gcloud, and its destination set. */
  function custody(logs: string[]): NonNullable<OrgSessionDeps['delegations']> {
    const destination = openProvisioningSecret(join(userData, PROVISIONING_SECRET_FILE));
    destination.write(DEST);
    return { destination, secrets: secretStore({ gcloud: () => resolveGcloud({ loginPath: async () => `${bin}:/usr/bin:/bin`, home: userData, fallbacks: [] }), log: (line) => void logs.push(line) }) };
  }
  const gcloudLogs: string[] = [];
  const delegationsDeps = () => ({ delegations: custody(gcloudLogs) });
  /** The codes gcloud received, which no status, view, answer or log may carry (afterEach checks every emitted status). */
  async function codes(): Promise<string[]> {
    const text = await readFile(join(bin, 'stdin.log'), 'utf8').catch(() => '');
    const found = text.split('\n').filter((line) => line.startsWith('smns-provision-v2.'));
    secrets.push(...found);
    return found;
  }
  const waitingFor = (op: string) => until(() => readFile(join(bin, `waiting-${op}`)).then(() => true, () => false), `gcloud's ${op} out`);

  it('creates a delegation end to end: one Touch ID, the code to the store alone, the delegation in effect and on the page', async () => {
    const { session, logs } = await signingRoot(delegationsDeps());
    const before = registered(session).delegations.rev;
    const answer = await session.delegationCreate({ ...CREATE, owners: [A] });
    expect(answer).toMatchObject({ ok: true, version: headVersion(session), secret: { version: '7', createTime: '2026-11-08T12:00:00.123Z' } });
    expect(signing.prompts.map((p) => p.summary)).toEqual(['create delegation dc-']);
    const id = hub.provisioningKeys[0].id;
    expect(hub.head.state.delegations.map((d) => d.id)).toEqual([id]);
    expect(registered(session).delegations).toMatchObject({ creating: false });
    expect(registered(session).delegations.rev).toBeGreaterThan(before);
    const view = await session.view();
    expect(view!.delegations).toMatchObject([{ id, prefix: 'dc-', state: 'in-effect', hubBehind: null }]);
    const found = await codes();
    expect(found).toHaveLength(1);
    const token = hub.provisioningKeys[0].token;
    for (const text of [JSON.stringify(answer), JSON.stringify(view), logs.join('\n'), gcloudLogs.join('\n')]) {
      expect(text).not.toContain(found[0]);
      expect(text).not.toContain(token);
    }
  });

  it('a sign-out while the mint is out signs nothing; signed in again, the minted key shows as a stray', async () => {
    let release!: () => void;
    hub.mintGate = () => new Promise<void>((resolve) => (release = resolve));
    const { session, feed } = await signingRoot(delegationsDeps());
    const creating = session.delegationCreate({ ...CREATE, owners: [A] });
    await until(() => registered(session).delegations.creating && hub.count('/api/provisioning-keys') === 1, 'the mint out');
    await session.signOut();
    expect(registered(session).delegations.creating).toBe(false);
    release();
    expect(await creating).toMatchObject({ ok: false });
    expect(signing.prompts).toEqual([]);
    hub.mintGate = undefined;
    expect(session.signIn()).toEqual({ ok: true });
    await until(() => isSignedIn(session), 'signed in again');
    feed.open();
    const view = await session.view();
    await until(async () => ((await session.view())?.strayKeys.length ?? 0) === 1, 'the stray key read');
    expect(view).not.toBeNull();
    expect((await session.view())!.strayKeys.map((k) => k.id)).toEqual([hub.provisioningKeys[0].id]);
  });

  it('close() while versions add is out publishes nothing; the next start offers only Discard, whose marker revokes the hub key', async () => {
    await writeFile(join(bin, 'act-add'), 'wait');
    const { session } = await signingRoot(delegationsDeps());
    const creating = session.delegationCreate({ ...CREATE, owners: [A] });
    await waitingFor('add');
    const id = hub.provisioningKeys[0].id;
    await session.close();
    expect(registered(session).delegations.creating, 'the close ends the run at once, not at its late answer').toBe(false);
    await writeFile(join(bin, 'release-add'), '');
    expect(await creating).toMatchObject({ ok: false });
    await writeFile(join(bin, 'act-add'), 'ok');
    expect(hub.posted).toEqual([]);
    const { session: again } = await restart(delegationsDeps());
    await until(() => signerOf(again).pending !== null, 'the held slot');
    await until(async () => ((await again.view())?.delegations.length ?? 0) === 1, 'the unsent row');
    expect((await again.view())!.delegations).toMatchObject([{ id, state: 'unsent', unsent: { rewrite: false } }]);
    expect(await again.delegationRewrite({ generation: 1, id, hash: 'the-hash-it-was-shown' })).toMatchObject({ ok: false, reason: 'stale' });
    expect(await again.discardPending(true, signerOf(again).pending!.hash)).toMatchObject({ ok: true, unsent: true });
    expect(hub.provisioningKeys[0].revoked).not.toBeNull();
    expect(hub.posted).toEqual([]);
    await codes();
  });

  it("org.change's renewal answers once its hub half ran: the hub key follows the head", async () => {
    const { session } = await signingRoot(delegationsDeps());
    expect(await session.delegationCreate({ ...CREATE, owners: [A] })).toMatchObject({ ok: true });
    const d = hub.head.state.delegations[0];
    const later = iso(Date.parse(d.expires) + 10 * DAY);
    const change = { kind: 'delegation.renew' as const, id: d.id, expires: later };
    const shown = await session.preview(change);
    if (!shown.ok) throw new Error(JSON.stringify(shown));
    hub.renewGate = () => new Promise((resolve) => setTimeout(resolve, 50)); // a hub half slower than the sign's answer
    expect(await session.change(change, shown.digest)).toMatchObject({ ok: true });
    expect(hub.provisioningKeys[0].expires).toBe(later);
    expect((await session.view())!.delegations[0]).toMatchObject({ expires: later, hub: { expires: later }, hubBehind: null });
    await codes();
  });

  it('a drop whose DELETE fails shows the dropped row; Retry revokes it, the route alone', async () => {
    const { session } = await signingRoot(delegationsDeps());
    expect(await session.delegationCreate({ ...CREATE, owners: [A] })).toMatchObject({ ok: true });
    const id = hub.head.state.delegations[0].id;
    hub.revokeAnswer = () => worker(503, { error: 'hub-updating' });
    const change = { kind: 'delegation.drop' as const, id };
    const shown = await session.preview(change);
    if (!shown.ok) throw new Error(JSON.stringify(shown));
    expect(await session.change(change, shown.digest)).toMatchObject({ ok: true });
    expect((await session.view())!.delegations).toMatchObject([{ id, state: 'dropped', hubBehind: 'revoke', hubProblem: { reason: 'updating' } }]);
    hub.revokeAnswer = undefined;
    const posts = hub.posted.length;
    expect(await session.delegationRevokeHub(id)).toEqual({ ok: true });
    expect(hub.posted).toHaveLength(posts);
    expect((await session.view())!.delegations).toEqual([]);
    await codes();
  });

  it('without custody every create refuses secret-store, minting nothing', async () => {
    const { session } = await signingRoot();
    expect(await session.delegationCreate({ ...CREATE, owners: [A] })).toMatchObject({ ok: false, reason: 'secret-store' });
    expect(hub.provisioningKeys).toEqual([]);
  });

  // Task 5's fix wave (I2): a row offers Discard only for the slot that holds its own delegation
  it("the status's pending slot names the delegation it holds: the unsent marker's while held, the one its state adds once published, none for another slot", async () => {
    await writeFile(join(bin, 'act-add'), 'wait');
    const { session } = await signingRoot(delegationsDeps());
    const creating = session.delegationCreate({ ...CREATE, owners: [A] });
    await waitingFor('add');
    const id = hub.provisioningKeys[0].id;
    await until(() => signerOf(session).pending !== null, 'the held slot');
    expect(signerOf(session).pending).toMatchObject({ delegation: id });
    await writeFile(join(bin, 'act-add'), 'ok');
    await writeFile(join(bin, 'release-add'), '');
    expect(await creating).toMatchObject({ ok: true, run: { id } });
    expect(signerOf(session).pending).toBeNull();
    await codes();
  });

  // Task 5's fix wave 2: the answer names the status revision covering its final slot, and the slot says whether it is held
  it("a held create's answer names the status revision whose publication holds its slot, held; published by a rewrite, the same slot reads not held", async () => {
    await writeFile(join(bin, 'act-add'), 'fail');
    const { session } = await signingRoot(delegationsDeps());
    const statuses: OrgStatus[] = [];
    session.onStatus((status) => void statuses.push(status));
    const answer = await session.delegationCreate({ ...CREATE, owners: [A] });
    expect(answer).toMatchObject({ ok: false, reason: 'unsent', phase: 'held' });
    const held = answer as Extract<DelegationResult, { ok: false }>;
    const { generation, id, hash } = held.run!;
    // the first status published at or past the answer's revision already holds its slot, held
    const covering = statuses.find((s) => s.state === 'registered' && s.delegations.rev >= held.rev);
    expect(covering).toBeDefined();
    expect((covering as Registered).signer?.pending).toMatchObject({ hash, delegation: id, held: true, exposed: false });
    expect(registered(session).delegations.rev).toBe(held.rev);
    // another window's Write again publishes it: the same id and hash, its marker cleared, are no longer held
    statuses.length = 0;
    await writeFile(join(bin, 'act-add'), 'ok');
    expect(await session.delegationRewrite({ generation, id: id!, hash: hash! })).toMatchObject({ ok: true, run: { id } });
    const published = statuses.map((s) => (s as Registered).signer?.pending).find((p) => p?.hash === hash && p.held === false);
    expect(published).toMatchObject({ hash, delegation: id, held: false });
    await codes();
  });

  // Task 5's fix wave (I3): Retry after a failed key read reads now, not once 30 s have passed
  it('org.delegation.readKeys reads the hub\'s key list again at once after a failure; the page\'s own read waits out the freshness', async () => {
    const { session } = await signingRoot(delegationsDeps());
    hub.keysAnswer = () => worker(503, { error: 'hub-updating' });
    expect(await session.delegationReadKeys()).toMatchObject({ failed: true });
    hub.keysAnswer = undefined;
    const reads = () => hub.calls.filter((c) => c.method === 'GET' && c.path === '/api/provisioning-keys').length;
    const before = reads();
    await session.view(); // the page shown again: within the freshness, no read
    await until(() => true, 'a turn');
    expect(reads()).toBe(before);
    const read = await session.delegationReadKeys();
    expect(reads()).toBe(before + 1);
    expect(read).toEqual({ at: expect.any(String), failed: false });
    expect((await session.view())!.hubKeys).toEqual(read);
  });
});
