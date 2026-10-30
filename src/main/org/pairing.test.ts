// The app's pairing (P5 O8 M4a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4a's "Pairing" and Proves;
// Interfaces §M): the code this Mac makes for another device, the polling of H1's pending list, each entry judged with
// `judgeEntry`, the candidate frozen once found, and the approval bound to the candidate the person compared, through
// the signer, with its liveness guard read while Touch ID is open.
//
// Real signatures and the package's own verifiers throughout, composed as org-session.ts composes them: the held view
// is held.ts over real files in a temporary profile, the signer is signer.ts over signing-store.ts, the Touch ID step is
// step-up.ts's `createStateSigner` with an injected confirmation, and the hub is a small model that keeps pending entries
// per member and judges each post with `verifySuccessor`. No test raises a system prompt.
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  base64urlDecode,
  base64urlEncode,
  decodePairingCode,
  generateSigningKey,
  keyId,
  NO_CERTIFICATES,
  pairingFingerprint,
  pairingMac,
  signOrgState,
  verifySuccessor,
  type Device,
  type OrgState,
  type PendingEntry,
  type SignedOrgState,
  type SigningKey,
} from '../../../apps/org-protocol/src/index.ts';

vi.mock('electron', () => ({ systemPreferences: { promptTouchID: () => Promise.reject(new Error('no system prompt in the suites')) } }));

import { OrgPairingStatusSchema, type OrgPairingStatus, type SignResult } from '@shared/ipc/schema/org';
import { createStateSigner, type Confirmation, type StepUpPrompt } from '../device/step-up';
import { orgFiles, SIGNING_FILE, type SigningFile } from './files';
import { startHeldOrg, type HeldOrg } from './held';
import type { HubClient, HubResult, Served } from './hub-client';
import { createPairing, type Pairing } from './pairing';
import { heldOrgSession, type SignedIn } from './session';
import { createOrgSigner, type OrgSigner, type SignOutcome } from './signer';
import { createSigningStore } from './signing-store';

const ORG = 'org-pairing';
const HUB = 'https://hub.example.test';
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const memberId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

type TestDevice = { device: Device; channel: SigningKey; stepUp: SigningKey };
async function newDevice(id: string): Promise<TestDevice> {
  const channel = await generateSigningKey();
  const stepUp = await generateSigningKey();
  return { channel, stepUp, device: { id, class: 'native-mac', keyStorage: 'software', channelPub: channel.pub, stepUpPub: stepUp.pub } };
}

/** A new device's entry as it posts it: its id the channel key's id, as the app's own registration makes one. */
async function freshEntry(cls: 'native-mac' | 'web-cards' = 'native-mac'): Promise<Omit<Device, 'endorsement'>> {
  const channel = await generateSigningKey();
  const id = await keyId(channel.pub);
  if (cls === 'web-cards') return { id, class: 'web-cards', keyStorage: 'webcrypto', channelPub: channel.pub, passkey: { credentialId: base64urlEncode(crypto.getRandomValues(new Uint8Array(16))), publicKey: (await generateSigningKey()).pub, rpId: 'desk.example' } };
  return { id, class: 'native-mac', keyStorage: 'software', channelPub: channel.pub, stepUpPub: (await generateSigningKey()).pub };
}

/** The pending entry a device posts for `device` under the code, its MAC under the code's secret (or `k`, a wrong one). */
async function posted(code: string, device: Omit<Device, 'endorsement'>, k?: Uint8Array): Promise<PendingEntry> {
  const decoded = decodePairingCode(code)!;
  const mac = await pairingMac(k ?? base64urlDecode(decoded.k), { org: decoded.org, member: decoded.member, device });
  return { deviceId: device.id, class: device.class, keyStorage: device.keyStorage, channelPub: device.channelPub, ...(device.stepUpPub === undefined ? {} : { stepUpPub: device.stepUpPub }), ...(device.passkey === undefined ? {} : { passkey: device.passkey }), mac };
}

/**
 * The hub as the pairing and the signer meet it: pending entries per member (a device id posted again replaces its
 * entry, as the Registry's `INSERT OR REPLACE` does), H1's admin read, and a chain that takes a post `verifySuccessor`
 * accepts.
 */
class FakeHub implements HubClient {
  pending = new Map<string, PendingEntry[]>();
  reads: Array<string | null> = [];
  posts: SignedOrgState[] = [];
  /** Answers the next reads, one each, before the entries are served. */
  answers: Array<HubResult<PendingEntry[]>> = [];
  constructor(public states: SignedOrgState[]) {}

  post(member: string, entry: PendingEntry): void {
    const list = (this.pending.get(member) ?? []).filter((e) => e.deviceId !== entry.deviceId);
    this.pending.set(member, [...list, entry]);
  }

  async pendingOf(member: string | null): Promise<HubResult<PendingEntry[]>> {
    this.reads.push(member);
    const answer = this.answers.shift();
    if (answer !== undefined) return answer;
    return { ok: true, value: structuredClone(this.pending.get(member ?? OWNER) ?? []) };
  }

  async postState(signed: SignedOrgState): Promise<HubResult<{ version: number }>> {
    this.posts.push(signed);
    const verdict = await verifySuccessor(this.states.at(-1)!, signed, []);
    if (!verdict.ok) return { ok: false, kind: 'status', status: 409, error: verdict.code };
    this.states.push(signed);
    for (const m of signed.state.members) this.pending.set(m.id, (this.pending.get(m.id) ?? []).filter((e) => !m.devices.some((d) => d.id === e.deviceId)));
    return { ok: true, value: { version: signed.state.version } };
  }

  async chain(since: number): Promise<HubResult<Served>> {
    return { ok: true, value: { chain: this.states.filter((s) => s.state.version > since), head: this.states.at(-1)!, transitions: [], certificates: NO_CERTIFICATES } };
  }

  me(): never {
    throw new Error('unused');
  }
  state(): never {
    throw new Error('unused');
  }
  postPending(): never {
    throw new Error('unused');
  }
}

const OWNER = memberId();
const BEA = memberId();
const CAL = memberId();

const profiles: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(profiles.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

type Harness = {
  hub: FakeHub;
  held: HeldOrg;
  signer: OrgSigner;
  pairing: Pairing;
  app: TestDevice;
  admin: TestDevice;
  /** Every status the pairing announced, as JSON: none may carry the code or its secret. */
  statuses: string[];
  prompts: StepUpPrompt[];
  answer: Confirmation;
  during: (() => Promise<void> | void) | null;
  online: boolean;
  maySign: boolean;
  disk(): SigningFile | null;
};

async function harness(timing: { PAIR_TTL_MS?: number; PAIR_POLL_MS?: number } = {}): Promise<Harness> {
  const admin = await newDevice('dev-admin');
  const app = await newDevice('dev-app');
  const cal = await newDevice('dev-cal');
  const recovery = await generateSigningKey();
  const state: OrgState = {
    org: ORG,
    version: 1,
    prev: null,
    issued: iso(Date.now() - 10 * DAY),
    root: { keys: [await keyId(admin.stepUp.pub), await keyId(app.stepUp.pub)], recoveryPub: recovery.pub },
    members: [
      { id: OWNER, email: 'owner@example.com', role: 'admin', devices: [admin.device, app.device] },
      { id: BEA, email: 'bea@example.com', role: 'member', devices: [] },
      { id: CAL, email: 'cal@example.com', role: 'member', devices: [cal.device] },
    ],
    machines: [],
    machineNames: [],
    retired: [],
    revoked: [],
    delegations: [],
    projects: [],
  };
  const g = await signOrgState(state, [admin.stepUp]);
  const dir = await mkdtemp(join(tmpdir(), 'maws-pairing-'));
  profiles.push(dir);
  const files = orgFiles({ userData: dir, log: () => {} });
  expect(await files.ensure()).toEqual({ ok: true });
  const started = await startHeldOrg({ files, anchor: null, saveAnchor: async () => {}, pins: { roots: state.root.keys, recoveryPub: recovery.pub }, first: { chain: [g], transitions: [], certificates: NO_CERTIFICATES }, log: () => {} });
  if (!started.ok) throw new Error(started.reason);
  const held = started.held;
  let commits: Promise<unknown> = Promise.resolve();
  const commit = <T>(body: () => Promise<T>): Promise<T> => {
    const turn = commits.then(body);
    commits = turn.catch(() => {});
    return turn;
  };
  const registration: { signing?: true } = {};
  const store = await createSigningStore({
    files,
    commit,
    registration: () => registration,
    markRegistration: async () => {
      await files.write('registration.json', { signing: true });
      registration.signing = true;
    },
  });
  const session = heldOrgSession({} as SignedIn);
  held.onAdopted(() => session.changed());
  const hub = new FakeHub([g]);
  const h = {
    hub,
    held,
    app,
    admin,
    statuses: [] as string[],
    prompts: [] as StepUpPrompt[],
    answer: { ok: true } as Confirmation,
    during: null as Harness['during'],
    online: true,
    maySign: true,
    disk: () => {
      try {
        return JSON.parse(readFileSync(join(dir, 'org', SIGNING_FILE), 'utf8')) as SigningFile;
      } catch {
        return null;
      }
    },
  } as Harness;
  const stateSigner = await createStateSigner({
    key: app.stepUp,
    confirm: async (prompt) => {
      h.prompts.push(prompt);
      await h.during?.();
      return h.answer;
    },
  });
  h.signer = createOrgSigner({
    session,
    held: () => held,
    signer: () => stateSigner,
    marked: () => true,
    hub: () => (h.online ? hub : null),
    store,
    deliveries: { obligation: () => null, send: async () => {} },
    log: () => {},
  });
  const result = (outcome: SignOutcome): SignResult =>
    outcome.ok ? outcome : outcome.reason === 'refused' ? { ok: false, reason: 'refused', detail: outcome.findings.map((f) => f.detail).join('; ') } : { ok: false, reason: outcome.reason, ...(outcome.detail === undefined ? {} : { detail: outcome.detail }) };
  h.pairing = createPairing({
    context: () => ({ hub: HUB, self: { member: OWNER, device: app.device.id }, head: held.head(), maySign: h.maySign && h.signer.maySign(), client: h.online ? hub : null }),
    busy: () => false,
    sign: async (edit) => result(await h.signer.sign(edit)),
    changed: () => void h.statuses.push(JSON.stringify(h.pairing.status())),
    timing: { PAIR_POLL_MS: 10, ...timing },
    log: () => {},
  });
  return h;
}

async function until(check: () => boolean | Promise<boolean>, what: string, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A pairing started for `member`, its code and secret checked against every status announced from then on. */
function started(h: Harness, member: string, cls: 'native-mac' | 'web-cards' = 'native-mac') {
  const answer = h.pairing.start({ member, class: cls });
  if (!answer.ok) throw new Error(`refused: ${JSON.stringify(answer)}`);
  const k = decodePairingCode(answer.code)!.k;
  const clean = () => {
    for (const text of [...h.statuses, JSON.stringify(h.pairing.status())]) {
      expect(text).not.toContain(answer.code);
      expect(text).not.toContain(k);
      // Each is what `org.changed` carries as the status's `pairing`.
      OrgPairingStatusSchema.parse(JSON.parse(text));
    }
  };
  return { ...answer, k, clean };
}

const status = (h: Harness): NonNullable<OrgPairingStatus> => {
  const s = h.pairing.status();
  if (s === null) throw new Error('no pairing');
  return s;
};

describe('starting a pairing', () => {
  it('makes a code that decodes to the target member with this head\'s roots and recovery key, shown once and never in a status', async () => {
    const h = await harness();
    const before = Date.now();
    const pair = started(h, BEA);
    const code = decodePairingCode(pair.code)!;
    const head = h.held.head().state;
    expect(code).toEqual({ hub: HUB, org: ORG, member: BEA, roots: head.root.keys, recoveryPub: head.root.recoveryPub, k: pair.k });
    expect(base64urlDecode(code.k)).toHaveLength(16);
    expect(Date.parse(pair.expires)).toBeGreaterThanOrEqual(before + 600_000);
    expect(status(h)).toEqual({ generation: 1, member: BEA, class: 'native-mac', expires: pair.expires, entry: null, problem: null });
    await pause(30);
    pair.clean();
    h.pairing.cancel();
    expect(h.pairing.status()).toBeNull();
  });

  it('refuses while this Mac can\'t sign, for a later device of another member, for a member the head doesn\'t list, while one runs, and with no hub', async () => {
    const h = await harness();
    h.maySign = false;
    expect(h.pairing.start({ member: BEA, class: 'native-mac' })).toMatchObject({ ok: false, reason: 'not-root' });
    h.maySign = true;
    expect(h.pairing.start({ member: CAL, class: 'native-mac' })).toEqual({
      ok: false,
      reason: 'later-device',
      detail: 'Their next device is paired from one of their own devices, a flow not built yet',
    });
    expect(h.pairing.start({ member: memberId(), class: 'native-mac' })).toMatchObject({ ok: false, reason: 'no-member' });
    h.online = false;
    expect(h.pairing.start({ member: BEA, class: 'native-mac' })).toMatchObject({ ok: false, reason: 'hub' });
    h.online = true;
    expect(h.pairing.start({ member: BEA, class: 'native-mac' })).toMatchObject({ ok: true });
    expect(h.pairing.start({ member: OWNER, class: 'native-mac' })).toMatchObject({ ok: false, reason: 'busy' });
    expect(h.pairing.status()).toMatchObject({ generation: 1, member: BEA });
    expect(h.hub.reads).toEqual(h.hub.reads.filter((m) => m === BEA));
    // Your own later device is yours to pair; a start after the last one ended is a new generation.
    h.pairing.cancel();
    expect(h.pairing.start({ member: OWNER, class: 'native-mac' })).toMatchObject({ ok: true });
    expect(status(h).generation).toBe(2);
    h.pairing.cancel();
  });
});

describe('the polling', () => {
  it('reads H1 for another member and the plain list for yourself', async () => {
    const h = await harness();
    started(h, BEA);
    await until(() => h.hub.reads.length >= 1, 'a read');
    h.pairing.cancel();
    started(h, OWNER);
    await until(() => h.hub.reads.includes(null), 'the plain read');
    h.pairing.cancel();
    expect(new Set(h.hub.reads)).toEqual(new Set([BEA, null]));
  });

  it('an entry with a wrong MAC, of another class, or with an id the head lists is not this pairing\'s; the one that answers is frozen with its fingerprint', async () => {
    const h = await harness();
    const pair = started(h, BEA);
    h.hub.post(BEA, await posted(pair.code, await freshEntry(), crypto.getRandomValues(new Uint8Array(16))));
    h.hub.post(BEA, await posted(pair.code, await freshEntry('web-cards')));
    h.hub.post(BEA, await posted(pair.code, { ...(await freshEntry()), id: h.app.device.id }));
    await until(() => h.hub.reads.length >= 3, 'three reads');
    expect(status(h)).toMatchObject({ entry: null, problem: null });

    const device = await freshEntry();
    h.hub.post(BEA, await posted(pair.code, device));
    await until(() => status(h).entry !== null, 'the candidate');
    const entry = status(h).entry!;
    expect(entry).toMatchObject({ id: device.id, class: 'native-mac', keyStorage: 'software', fingerprint: await pairingFingerprint(ORG, BEA, device) });
    expect(entry.digest).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(status(h).problem).toBeNull();
    pair.clean();
    h.pairing.cancel();
  });

  it('a web-cards pairing takes a passkey device and not a Mac', async () => {
    const h = await harness();
    const pair = started(h, BEA, 'web-cards');
    h.hub.post(BEA, await posted(pair.code, await freshEntry('native-mac')));
    await until(() => h.hub.reads.length >= 2, 'two reads');
    expect(status(h).entry).toBeNull();
    const phone = await freshEntry('web-cards');
    h.hub.post(BEA, await posted(pair.code, phone));
    await until(() => status(h).entry !== null, 'the candidate');
    expect(status(h).entry).toMatchObject({ id: phone.id, class: 'web-cards', keyStorage: 'webcrypto' });
    h.pairing.cancel();
  });

  it('two entries answering the code end it: start over', async () => {
    const h = await harness();
    const pair = started(h, BEA);
    h.hub.post(BEA, await posted(pair.code, await freshEntry()));
    h.hub.post(BEA, await posted(pair.code, await freshEntry()));
    await until(() => status(h).problem !== null, 'the end');
    expect(status(h)).toMatchObject({ problem: 'two-entries', entry: null });
    const reads = h.hub.reads.length;
    await pause(40);
    expect(h.hub.reads.length).toBe(reads);
  });

  it('a second entry answering after the candidate was frozen ends it as `two-entries`', async () => {
    const h = await harness();
    const pair = started(h, BEA);
    h.hub.post(BEA, await posted(pair.code, await freshEntry()));
    await until(() => status(h).entry !== null, 'the candidate');
    h.hub.post(BEA, await posted(pair.code, await freshEntry()));
    await until(() => status(h).problem !== null, 'the end');
    expect(status(h).problem).toBe('two-entries');
  });

  it('`503 hub-updating` and no answer keep polling; `403 not-admin` and `404 no-member` end it', async () => {
    const h = await harness();
    started(h, BEA);
    h.hub.answers.push({ ok: false, kind: 'status', status: 503, error: 'hub-updating' }, { ok: false, kind: 'unreachable', detail: 'down' });
    await until(() => h.hub.reads.length >= 3, 'polling past both');
    expect(status(h).problem).toBeNull();
    h.hub.answers.push({ ok: false, kind: 'status', status: 403, error: 'not-admin' });
    await until(() => status(h).problem !== null, 'the end');
    expect(status(h).problem).toBe('not-admin');
    h.pairing.cancel();

    started(h, BEA);
    h.hub.answers.push({ ok: false, kind: 'status', status: 404, error: 'no-member' });
    await until(() => status(h).problem !== null, 'the end');
    expect(status(h)).toMatchObject({ generation: 2, problem: 'no-member' });
  });

  it('a same-id entry reposted with other keys between display and approval ends it as `entry-changed`, and the approval reads `stale`', async () => {
    const h = await harness();
    const pair = started(h, BEA);
    const device = await freshEntry();
    h.hub.post(BEA, await posted(pair.code, device));
    await until(() => status(h).entry !== null, 'the candidate');
    const shown = status(h);
    // Another device that learned the id and the code's secret reposts under it with its own keys.
    const swapped = { ...(await freshEntry()), id: device.id };
    h.hub.post(BEA, await posted(pair.code, swapped));
    await until(() => status(h).problem !== null, 'the end');
    expect(status(h)).toMatchObject({ problem: 'entry-changed', entry: { id: device.id, digest: shown.entry!.digest } });
    expect(await h.pairing.approve({ generation: shown.generation, digest: shown.entry!.digest })).toMatchObject({ ok: false, reason: 'stale' });
    expect(h.prompts).toEqual([]);
    expect(h.hub.posts).toEqual([]);
  });

  it('expiry ends it', async () => {
    const h = await harness({ PAIR_TTL_MS: 80 });
    const pair = started(h, BEA);
    h.hub.post(BEA, await posted(pair.code, await freshEntry()));
    await until(() => status(h).entry !== null, 'the candidate');
    await until(() => status(h).problem !== null, 'the end');
    expect(status(h).problem).toBe('expired');
    expect(await h.pairing.approve({ generation: 1, digest: status(h).entry!.digest })).toMatchObject({ ok: false, reason: 'stale' });
    expect(h.prompts).toEqual([]);
  });
});

describe('approving', () => {
  it('another member\'s first device: signed unendorsed, accepted, held; the pairing done', async () => {
    const h = await harness();
    const pair = started(h, BEA);
    const device = await freshEntry();
    h.hub.post(BEA, await posted(pair.code, device));
    await until(() => status(h).entry !== null, 'the candidate');
    const { generation, entry } = status(h);
    expect(await h.pairing.approve({ generation, digest: entry!.digest })).toEqual({ ok: true, version: 2 });
    expect(h.prompts).toHaveLength(1);
    const listed = h.held.head().state.members.find((m) => m.id === BEA)!.devices;
    expect(listed).toEqual([device]);
    expect(h.pairing.status()).toBeNull();
    pair.clean();
  });

  it('your own device: endorsed by this Mac\'s step-up key inside the same Touch ID, and the hub accepts it', async () => {
    const h = await harness();
    const pair = started(h, OWNER);
    const device = await freshEntry();
    h.hub.post(OWNER, await posted(pair.code, device));
    await until(() => status(h).entry !== null, 'the candidate');
    const { generation, entry } = status(h);
    expect(await h.pairing.approve({ generation, digest: entry!.digest })).toEqual({ ok: true, version: 2 });
    expect(h.prompts).toHaveLength(1);
    const listed = h.hub.states.at(-1)!.state.members.find((m) => m.id === OWNER)!.devices.find((d) => d.id === device.id)!;
    // Exactly the device compared, endorsed by this Mac's step-up key; the hub took the state through `verifySuccessor`,
    // which verifies that endorsement under one of the member's own step-up keys.
    const { endorsement, ...plain } = listed;
    expect(plain).toEqual(device);
    expect(endorsement?.kid).toBe(await keyId(h.app.stepUp.pub));
    expect(h.hub.posts).toHaveLength(1);
  });

  it('re-reads the pending list, and refuses an entry changed since it was shown', async () => {
    const h = await harness({ PAIR_POLL_MS: 300 });
    const pair = started(h, BEA);
    const device = await freshEntry();
    h.hub.post(BEA, await posted(pair.code, device));
    await until(() => status(h).entry !== null, 'the candidate', 5_000);
    const { generation, entry } = status(h);
    const reads = h.hub.reads.length;
    h.hub.post(BEA, await posted(pair.code, { ...(await freshEntry()), id: device.id }));
    expect(await h.pairing.approve({ generation, digest: entry!.digest })).toMatchObject({ ok: false, reason: 'stale', detail: expect.stringContaining('changed after it was shown') });
    expect(h.hub.reads.length).toBe(reads + 1);
    expect(status(h).problem).toBe('entry-changed');
    expect(h.prompts).toEqual([]);
    expect(h.hub.posts).toEqual([]);
  });

  it('naming an old generation or another digest reads `stale`', async () => {
    const h = await harness();
    const first = started(h, BEA);
    h.hub.post(BEA, await posted(first.code, await freshEntry()));
    await until(() => status(h).entry !== null, 'the candidate');
    const old = status(h);
    expect(await h.pairing.approve({ generation: old.generation, digest: 'A'.repeat(43) })).toMatchObject({ ok: false, reason: 'stale' });
    h.pairing.cancel();
    const second = started(h, BEA);
    h.hub.post(BEA, await posted(second.code, await freshEntry()));
    await until(() => status(h).entry !== null, 'the second candidate');
    expect(await h.pairing.approve({ generation: old.generation, digest: status(h).entry!.digest })).toMatchObject({ ok: false, reason: 'stale' });
    expect(h.prompts).toEqual([]);
    expect(h.hub.posts).toEqual([]);
  });

  for (const ending of ['a cancel', 'an expiry'] as const) {
    it(`${ending} while the confirmation is held open, then answered yes: no endorsement, no state signature, no slot, no post`, async () => {
      const h = await harness(ending === 'an expiry' ? { PAIR_TTL_MS: 400 } : {});
      const pair = started(h, OWNER);
      h.hub.post(OWNER, await posted(pair.code, await freshEntry()));
      await until(() => status(h).entry !== null, 'the candidate');
      const { generation, entry } = status(h);
      const sign = vi.spyOn(crypto.subtle, 'sign');
      let signsAtYes = -1;
      h.during = async () => {
        if (ending === 'a cancel') h.pairing.cancel();
        else await until(() => Date.now() > Date.parse(pair.expires), 'the expiry');
        signsAtYes = sign.mock.calls.length;
      };
      const result = await h.pairing.approve({ generation, digest: entry!.digest });
      expect(result).toMatchObject({ ok: false, reason: 'cancelled' });
      expect(h.prompts).toHaveLength(1);
      expect(signsAtYes).toBeGreaterThanOrEqual(0);
      expect(sign.mock.calls.length).toBe(signsAtYes);
      expect(h.disk()?.pending ?? null).toBeNull();
      expect(h.hub.posts).toEqual([]);
      expect(h.held.head().state.version).toBe(1);
    });
  }
});
