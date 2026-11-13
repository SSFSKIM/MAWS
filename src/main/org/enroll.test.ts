// The app's enrollment (P5 O8 M4b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4b's "The enrollment"
// and Proves; Interfaces §R): the code this Mac makes for a machine, the polling of its posted key, each answer judged
// with `verifyEnrollmentMac` under the code's secret and the name, the candidate frozen at its first good answer, and
// the approval bound to the candidate the person compared, signed through the signer with its liveness guard read while
// Touch ID is open.
//
// Composed as pairing.test.ts composes the pairing: the held view is held.ts over real files in a temporary profile,
// the signer is signer.ts over signing-store.ts, the Touch ID step is step-up.ts's `createStateSigner` with an injected
// confirmation, and the hub is a small model that mints enrollments, keeps each one's posted key, and judges each post
// with `verifySuccessor`. The machine's side is `enrollmentMac` under the code's own secret. No test raises a prompt.
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  base64urlDecode,
  base64urlEncode,
  decodeEnrollmentCodeV2,
  enrollmentMac,
  generateSigningKey,
  keyId,
  NO_CERTIFICATES,
  signOrgState,
  stateHash,
  verifySuccessor,
  type Device,
  type OrgState,
  type SignedOrgState,
  type SigningKey,
} from '../../../apps/org-protocol/src/index.ts';

vi.mock('electron', () => ({ systemPreferences: { promptTouchID: () => Promise.reject(new Error('no system prompt in the suites')) } }));

import type { ClientId } from '@shared/ipc/client';
import { OrgEnrollingStatusSchema, type OrgEnrollingStatus, type SignResult } from '@shared/ipc/schema/org';
import { createStateSigner, type Confirmation, type StepUpPrompt } from '../device/step-up';
import { createEnrollment, ENROLL_TTL_S, type Enrollment, type EnrollmentContext } from './enroll';
import { orgFiles, SIGNING_FILE, type SigningFile } from './files';
import { startHeldOrg, type HeldOrg } from './held';
import type { EnrollmentKey, HubClient, HubResult, MintedEnrollment, Served } from './hub-client';
import { heldOrgSession, type SignedIn } from './session';
import { createOrgSigner, type OrgSigner, type SignOutcome } from './signer';
import { createSigningStore } from './signing-store';

const ORG = 'org-enroll';
const HUB = 'https://hub.example.test';
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const hex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
const newRef = () => base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));

type TestDevice = { device: Device; channel: SigningKey; stepUp: SigningKey };
async function newDevice(id: string): Promise<TestDevice> {
  const channel = await generateSigningKey();
  const stepUp = await generateSigningKey();
  return { channel, stepUp, device: { id, class: 'native-mac', keyStorage: 'software', channelPub: channel.pub, stepUpPub: stepUp.pub } };
}

/** A machine's key as `mawsd enroll` posts it under the code: its MAC under the code's secret (or `k`, a wrong one). */
async function machineKey(code: string, id: string, input: { name: string; ref: string; pub: string; k?: Uint8Array }): Promise<EnrollmentKey> {
  const k = input.k ?? base64urlDecode(decodeEnrollmentCodeV2(code).k);
  return { machine: input.name, ref: input.ref, pub: input.pub, mac: await enrollmentMac(k, { name: input.name, machinePub: input.pub, ref: input.ref, tokenId: id }) };
}

/** The hub as the enrollment and the signer meet it: minted enrollments, each one's posted key, and the chain. */
class FakeHub implements HubClient {
  mints: Array<{ ttl_s: number; machine?: string }> = [];
  enrollments: MintedEnrollment[] = [];
  keys = new Map<string, EnrollmentKey>();
  reads: string[] = [];
  /** Answers the next key reads, one each, before the posted keys are served. */
  answers: Array<HubResult<EnrollmentKey>> = [];
  /** The next key read is held until the suite releases it. */
  hold: { armed: boolean; release: (() => void) | null } = { armed: false, release: null };
  mintAnswer: HubResult<MintedEnrollment> | null = null;
  posts: SignedOrgState[] = [];
  constructor(public states: SignedOrgState[]) {}

  async mintEnrollment(body: { ttl_s: number; machine?: string }): Promise<HubResult<MintedEnrollment>> {
    this.mints.push(body);
    if (this.mintAnswer !== null) return this.mintAnswer;
    const minted = { id: hex(16), expires: iso(Date.now() + body.ttl_s * 1000), token: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) };
    this.enrollments.push(minted);
    return { ok: true, value: minted };
  }

  async enrollmentKey(id: string): Promise<HubResult<EnrollmentKey>> {
    this.reads.push(id);
    if (this.hold.armed) {
      this.hold.armed = false;
      await new Promise<void>((release) => (this.hold.release = release));
    }
    const answer = this.answers.shift();
    if (answer !== undefined) return answer;
    const key = this.keys.get(id);
    return key === undefined ? { ok: false, kind: 'status', status: 404, error: 'no-key' } : { ok: true, value: structuredClone(key) };
  }

  async postState(signed: SignedOrgState): Promise<HubResult<{ version: number }>> {
    this.posts.push(signed);
    const verdict = await verifySuccessor(this.states.at(-1)!, signed, []);
    if (!verdict.ok) return { ok: false, kind: 'status', status: 409, error: verdict.code };
    this.states.push(signed);
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
  pendingOf(): never {
    throw new Error('unused');
  }
  machines(): never {
    throw new Error('unused');
  }
  deleteMachine(): never {
    throw new Error('unused');
  }
}

const OWNER = hex(16);
const BEA = hex(16);
const MINI = newRef();
const GONE = newRef();

const profiles: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(profiles.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

type Harness = {
  hub: FakeHub;
  held: HeldOrg;
  signer: OrgSigner;
  enrollment: Enrollment;
  admin: TestDevice;
  miniKey: SigningKey;
  /** Every status the enrollment announced, as JSON: none may carry the code, its token or its secret. */
  statuses: string[];
  prompts: StepUpPrompt[];
  answer: Confirmation;
  during: (() => Promise<void> | void) | null;
  online: boolean;
  maySign: boolean;
  self: EnrollmentContext['self'];
  signedIn: boolean;
  busy: boolean;
  disk(): SigningFile | null;
};

// The org: OWNER, an admin, with the admin's device and this app's (both roots); BEA, a member. `mini` is OWNER's
// machine; the name `gone` stays bound to GONE's ref, a machine dropped before; `dc-` is a delegation's prefix.
async function harness(timing: { ENROLL_POLL_MS?: number } = {}): Promise<Harness> {
  const admin = await newDevice('dev-admin');
  const app = await newDevice('dev-app');
  const bea = await newDevice('dev-bea');
  const recovery = await generateSigningKey();
  const miniKey = await generateSigningKey();
  const delegation = await generateSigningKey();
  const state: OrgState = {
    org: ORG,
    version: 1,
    prev: null,
    issued: iso(Date.now() - 10 * DAY),
    root: { keys: [await keyId(admin.stepUp.pub), await keyId(app.stepUp.pub)], recoveryPub: recovery.pub },
    members: [
      { id: OWNER, email: 'owner@example.com', role: 'admin', devices: [admin.device, app.device] },
      { id: BEA, email: 'bea@example.com', role: 'member', devices: [bea.device] },
    ],
    machines: [{ name: 'mini', ref: MINI, pub: miniKey.pub, owners: [OWNER] }],
    machineNames: [{ name: 'mini', ref: MINI }],
    retired: [],
    revoked: [],
    delegations: [{ id: hex(16), pub: delegation.pub, prefix: 'dc-', expires: iso(Date.now() + 30 * DAY), maxUses: 10, offlineRevokeS: 0, owners: 'org' }],
    projects: [],
  };
  const g = await signOrgState(state, [admin.stepUp]);
  // `gone` enrolled at version 2, dropped (its key retired) at 3: its name stays bound to GONE
  const goneKey = await generateSigningKey();
  const successor = async (parent: SignedOrgState, edit: (s: OrgState) => void | Promise<void>) => {
    const next = structuredClone(parent.state);
    next.version += 1;
    next.prev = await stateHash(parent.state);
    await edit(next);
    return signOrgState(next, [admin.stepUp]);
  };
  const v2 = await successor(g, (s) => {
    s.machines.push({ name: 'gone', ref: GONE, pub: goneKey.pub, owners: [OWNER] });
    s.machineNames.push({ name: 'gone', ref: GONE });
  });
  const v3 = await successor(v2, async (s) => {
    s.machines = s.machines.filter((m) => m.ref !== GONE);
    s.retired.push({ keyId: await keyId(goneKey.pub), pub: goneKey.pub, notAfter: s.issued, holder: { machine: GONE } });
  });
  const dir = await mkdtemp(join(tmpdir(), 'maws-enroll-'));
  profiles.push(dir);
  const files = orgFiles({ userData: dir, log: () => {} });
  expect(await files.ensure()).toEqual({ ok: true });
  const started = await startHeldOrg({ files, anchor: null, saveAnchor: async () => {}, pins: { roots: state.root.keys, recoveryPub: recovery.pub }, first: { chain: [g, v2, v3], transitions: [], certificates: NO_CERTIFICATES }, log: () => {} });
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
  const hub = new FakeHub([g, v2, v3]);
  const h = {
    hub,
    held,
    admin,
    miniKey,
    statuses: [] as string[],
    prompts: [] as StepUpPrompt[],
    answer: { ok: true } as Confirmation,
    during: null as Harness['during'],
    online: true,
    maySign: true,
    self: { member: OWNER, device: app.device.id },
    signedIn: true,
    busy: false,
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
  h.enrollment = createEnrollment({
    context: () => (h.signedIn ? { hub: HUB, self: h.self, head: held.head(), certificates: held.certificates(), maySign: h.maySign && h.signer.maySign(), client: h.online ? hub : null } : null),
    busy: () => h.busy,
    sign: async (edit) => result(await h.signer.sign(edit)),
    changed: () => void h.statuses.push(JSON.stringify(h.enrollment.status())),
    timing: { ENROLL_POLL_MS: 10, ...timing },
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

/** An enrollment started, its code, token and secret checked against every status announced from then on. */
// The windows that ask: the one whose sheet starts each enrollment here, and two others.
const WINDOW = 'window-a' as ClientId;
const OTHER = 'window-b' as ClientId;
const THIRD = 'window-c' as ClientId;

async function started(h: Harness, name: string, replace?: string) {
  const answer = await h.enrollment.start({ name, ...(replace === undefined ? {} : { replace }) }, WINDOW);
  if (!answer.ok) throw new Error(`refused: ${JSON.stringify(answer)}`);
  const code = decodeEnrollmentCodeV2(answer.code);
  const id = h.hub.enrollments.at(-1)!.id;
  const clean = () => {
    for (const text of [...h.statuses, JSON.stringify(h.enrollment.status())]) {
      expect(text).not.toContain(answer.code);
      expect(text).not.toContain(code.k);
      expect(text).not.toContain(code.token);
      // Each is what `org.changed` carries as the status's `enrolling`.
      OrgEnrollingStatusSchema.parse(JSON.parse(text));
    }
  };
  /** The machine posts its key under this enrollment. */
  const post = async (input: { name?: string; ref?: string; pub?: string; k?: Uint8Array } = {}) => {
    const key = await machineKey(answer.code, id, { name: input.name ?? name, ref: input.ref ?? newRef(), pub: input.pub ?? (await generateSigningKey()).pub, ...(input.k === undefined ? {} : { k: input.k }) });
    h.hub.keys.set(id, key);
    return key;
  };
  return { ...answer, code, text: answer.code, id, clean, post };
}

const status = (h: Harness): NonNullable<OrgEnrollingStatus> => {
  const s = h.enrollment.status();
  if (s === null) throw new Error('no enrollment');
  return s;
};

/** A successor of the hub's head signed by the admin's device, adopted here as a link's or another root's would be. */
async function moveHead(h: Harness, edit: (s: OrgState) => void): Promise<void> {
  const parent = h.hub.states.at(-1)!;
  const next = structuredClone(parent.state);
  next.version += 1;
  next.prev = await stateHash(parent.state);
  next.issued = iso(Math.max(Date.now(), Date.parse(parent.state.issued)));
  edit(next);
  const signed = await signOrgState(next, [h.admin.stepUp]);
  h.hub.states.push(signed);
  expect(await h.held.adoptServed({ chain: [signed], head: null, transitions: [], certificates: null })).toMatchObject({ adopted: 1 });
}

describe('starting an enrollment', () => {
  it("mints a token for an hour and makes a code that decodes with this head's roots, its recovery key, the name and 32 random bytes, shown once and never in a status", async () => {
    const h = await harness();
    const enroll = await started(h, 'box');
    const head = h.held.head().state;
    expect(h.hub.mints).toEqual([{ ttl_s: ENROLL_TTL_S }]);
    expect(ENROLL_TTL_S).toBe(3600);
    expect(enroll.code).toEqual({ hub: HUB, token: h.hub.enrollments[0].token, roots: head.root.keys, recoveryPub: head.root.recoveryPub, k: enroll.code.k, machine: 'box' });
    expect(base64urlDecode(enroll.code.k)).toHaveLength(32);
    expect(enroll.expires).toBe(h.hub.enrollments[0].expires);
    expect(status(h)).toEqual({ generation: 1, name: 'box', replace: null, expires: enroll.expires, candidate: null, problem: null });
    await pause(30);
    enroll.clean();
    h.enrollment.cancel();
    expect(h.enrollment.status()).toBeNull();
  });

  it("a start's answer names the run it made: its generation is the one the status publishes", async () => {
    const h = await harness();
    const first = await h.enrollment.start({ name: 'box' }, WINDOW);
    expect(first).toMatchObject({ ok: true, generation: 1 });
    expect(status(h).generation).toBe(1);
    h.enrollment.cancel();
    const second = await h.enrollment.start({ name: 'box' }, WINDOW);
    expect(second).toMatchObject({ ok: true, generation: 2 });
    expect(status(h).generation).toBe(2);
    h.enrollment.cancel();
  });

  it("a re-enrollment names the machine it replaces: the mint's `machine` is its name, the code's too", async () => {
    const h = await harness();
    const enroll = await started(h, 'mini', MINI);
    expect(h.hub.mints).toEqual([{ ttl_s: 3600, machine: 'mini' }]);
    expect(enroll.code.machine).toBe('mini');
    expect(status(h)).toMatchObject({ name: 'mini', replace: MINI });
    h.enrollment.cancel();
  });

  it("refuses before any mint: a non-admin, a Mac that can't sign, a name out of grammar, listed, or under a prefix, a re-enrollment of no machine, while one runs, while another attempt runs, and with no hub", async () => {
    const h = await harness();
    h.self = { member: BEA, device: 'dev-bea' };
    expect(await h.enrollment.start({ name: 'box' }, WINDOW)).toMatchObject({ ok: false, reason: 'not-admin' });
    h.self = { member: OWNER, device: 'dev-app' };
    h.maySign = false;
    expect(await h.enrollment.start({ name: 'box' }, WINDOW)).toEqual({ ok: false, reason: 'not-root', detail: "This Mac can't sign: enroll from an admin's Mac that does" });
    h.maySign = true;
    expect(await h.enrollment.start({ name: 'hub' }, WINDOW)).toMatchObject({ ok: false, reason: 'shape' });
    expect(await h.enrollment.start({ name: 'a/b' }, WINDOW)).toMatchObject({ ok: false, reason: 'shape' });
    expect(await h.enrollment.start({ name: 'Mini' }, WINDOW)).toMatchObject({ ok: false, reason: 'machine-name-taken' });
    expect(await h.enrollment.start({ name: 'DC-vm9' }, WINDOW)).toEqual({ ok: false, reason: 'prefix-names-machine', detail: 'DC-vm9 falls under the delegation prefix dc-' }); // the sheet's line says the rest (U11a board 540)
    expect(await h.enrollment.start({ name: 'box', replace: newRef() }, WINDOW)).toMatchObject({ ok: false, reason: 'no-machine' });
    expect(await h.enrollment.start({ name: 'other', replace: MINI }, WINDOW)).toMatchObject({ ok: false, reason: 'shape' });
    h.busy = true;
    expect(await h.enrollment.start({ name: 'box' }, WINDOW)).toMatchObject({ ok: false, reason: 'busy' });
    h.busy = false;
    h.online = false;
    expect(await h.enrollment.start({ name: 'box' }, WINDOW)).toEqual({ ok: false, reason: 'hub', detail: 'the hub sign-in has ended' }); // the sheet's line says to sign in again
    h.signedIn = false;
    expect(await h.enrollment.start({ name: 'box' }, WINDOW)).toMatchObject({ ok: false, reason: 'not-root' });
    expect(h.hub.mints).toEqual([]);
    h.signedIn = true;
    h.online = true;
    await started(h, 'box');
    expect(await h.enrollment.start({ name: 'box2' }, WINDOW)).toMatchObject({ ok: false, reason: 'busy' });
    expect(h.hub.mints).toHaveLength(1);
    h.enrollment.cancel();
    // a start after the last one ended is a new generation
    await started(h, 'box');
    expect(status(h).generation).toBe(2);
    h.enrollment.cancel();
  });

  it("the hub's refusal of the mint is the start's, and an enrollment cancelled while its token was minted never starts", async () => {
    const h = await harness();
    h.hub.mintAnswer = { ok: false, kind: 'status', status: 403, error: 'not-admin' };
    expect(await h.enrollment.start({ name: 'box' }, WINDOW)).toEqual({ ok: false, reason: 'refused', detail: '403 not-admin' }); // the hub's status and code: the sheet's line says it refused
    h.hub.mintAnswer = { ok: false, kind: 'unreachable', detail: 'down' };
    expect(await h.enrollment.start({ name: 'box' }, WINDOW)).toEqual({ ok: false, reason: 'hub', detail: 'the hub was not reached: down' });
    h.hub.mintAnswer = null;
    const pending = h.enrollment.start({ name: 'box' }, WINDOW);
    const second = h.enrollment.start({ name: 'box2' }, WINDOW);
    h.enrollment.cancel();
    expect(await second, 'one at a time, the mint included').toMatchObject({ ok: false, reason: 'busy' });
    expect(await pending).toMatchObject({ ok: false, reason: 'cancelled' });
    expect(h.enrollment.status()).toBeNull();
    expect(h.enrollment.running()).toBe(false);
  });
  it("a window's cancel names the run it owns: a stale generation cancels nothing and says why, the current one cancels; null names only that window's own start or the run it made", async () => {
    const h = await harness();
    await started(h, 'box');
    expect(h.enrollment.cancelRun({ generation: 2 }, WINDOW)).toEqual({ ok: false, reason: 'not-current', detail: 'enrollment 2 is not the one running (1 is): nothing was cancelled' });
    expect(h.enrollment.cancelRun({ generation: null }, OTHER)).toEqual({ ok: false, reason: 'not-current', detail: 'no start of this window’s is under way: nothing was cancelled' });
    expect(status(h).generation).toBe(1);
    expect(h.enrollment.cancelRun({ generation: 1 }, OTHER)).toEqual({ ok: true }); // a numbered cancel names its run exactly, whoever sends it
    expect(h.enrollment.status()).toBeNull();
    expect(h.enrollment.cancelRun({ generation: 1 }, WINDOW)).toEqual({ ok: false, reason: 'not-current', detail: 'enrollment 1 is not the one running (none is): nothing was cancelled' });

    // a start being minted: its window's null cancels it, and it never starts; a generation never cancels a mint
    h.hub.mintAnswer = null;
    const pending = h.enrollment.start({ name: 'box' }, WINDOW);
    expect(h.enrollment.cancelRun({ generation: 1 }, WINDOW)).toMatchObject({ ok: false, reason: 'not-current' });
    expect(h.enrollment.cancelRun({ generation: null }, WINDOW)).toEqual({ ok: true });
    expect(await pending).toMatchObject({ ok: false, reason: 'cancelled' });
    expect(h.enrollment.status()).toBeNull();
    expect(h.enrollment.running()).toBe(false);
  });

  // The re-review's cancel-ownership probes (fix wave 3): a null cancel is its sender's own, never the slot's.
  it("a window refused busy cancels nothing with its null: the other window's mint goes on", async () => {
    const h = await harness();
    const first = h.enrollment.start({ name: 'box' }, WINDOW);
    const second = h.enrollment.start({ name: 'box2' }, OTHER); // refused at once: the first's mint holds the slot
    // its window closes before that answer shows, while the first's token is still being minted
    expect(h.enrollment.cancelRun({ generation: null }, OTHER)).toMatchObject({ ok: false, reason: 'not-current' });
    expect(await second).toMatchObject({ ok: false, reason: 'busy' });
    expect(await first).toMatchObject({ ok: true });
    expect(status(h)).toMatchObject({ generation: 1, name: 'box' });
    h.enrollment.cancel();
  });

  it("a window's null after its run was published cancels that run, while it is still the current one", async () => {
    const h = await harness();
    await started(h, 'box'); // main has answered and published generation 1; the sheet hasn't shown it yet
    expect(h.enrollment.cancelRun({ generation: null }, WINDOW)).toEqual({ ok: true });
    expect(h.enrollment.status()).toBeNull();
    expect(h.enrollment.running()).toBe(false);
    // once another run is the current one, the first window's null reaches nothing
    expect((await h.enrollment.start({ name: 'box' }, OTHER)).ok).toBe(true);
    expect(h.enrollment.cancelRun({ generation: null }, WINDOW)).toMatchObject({ ok: false, reason: 'not-current' });
    expect(status(h).generation).toBe(2);
    h.enrollment.cancel();
  });

  it('a null from a window that started nothing cancels nothing: neither a mint nor a run', async () => {
    const h = await harness();
    const first = h.enrollment.start({ name: 'box' }, WINDOW);
    expect(h.enrollment.cancelRun({ generation: null }, THIRD)).toMatchObject({ ok: false, reason: 'not-current' });
    expect(await first).toMatchObject({ ok: true });
    expect(h.enrollment.cancelRun({ generation: null }, THIRD)).toMatchObject({ ok: false, reason: 'not-current' });
    expect(status(h).generation).toBe(1);
    h.enrollment.cancel();
  });
});

describe('the polling', () => {
  it("`404 no-key` keeps polling; a key whose MAC isn't under the code's secret, or posted under another name, is not this enrollment's; the first good one is frozen with its key id", async () => {
    const h = await harness();
    const enroll = await started(h, 'box');
    await until(() => h.hub.reads.length >= 2, 'two reads of no key');
    expect(status(h)).toMatchObject({ candidate: null, problem: null });
    await enroll.post({ k: crypto.getRandomValues(new Uint8Array(32)) });
    const reads = h.hub.reads.length;
    await until(() => h.hub.reads.length >= reads + 2, 'two reads of a wrong MAC');
    await enroll.post({ name: 'other' });
    const more = h.hub.reads.length;
    await until(() => h.hub.reads.length >= more + 2, 'two reads of another name');
    expect(status(h)).toMatchObject({ candidate: null, problem: null });

    const key = await enroll.post({ name: 'BOX' });
    await until(() => status(h).candidate !== null, 'the candidate');
    const candidate = status(h).candidate!;
    expect(candidate).toMatchObject({ name: 'BOX', ref: key.ref, keyId: await keyId(key.pub) });
    expect(candidate.digest).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(status(h).problem).toBeNull();
    expect(new Set(h.hub.reads)).toEqual(new Set([enroll.id]));
    enroll.clean();
    h.enrollment.cancel();
  });

  it('another key posted after the candidate was frozen ends it `key-changed`, and the approval reads `stale`', async () => {
    const h = await harness();
    const enroll = await started(h, 'box');
    const key = await enroll.post();
    await until(() => status(h).candidate !== null, 'the candidate');
    const shown = status(h);
    // the same ref and a valid MAC, another key: the machine (or one that learned the code) posted again
    await enroll.post({ ref: key.ref });
    await until(() => status(h).problem !== null, 'the end');
    expect(status(h)).toMatchObject({ problem: 'key-changed', candidate: shown.candidate });
    expect(await h.enrollment.approve({ generation: shown.generation, digest: shown.candidate!.digest })).toMatchObject({ ok: false, reason: 'stale' });
    expect(h.prompts).toEqual([]);
    expect(h.hub.posts).toEqual([]);
  });

  it('`503 hub-updating` and no answer keep polling; `403 not-yours` and `404 unknown-enrollment` end it', async () => {
    const h = await harness();
    await started(h, 'box');
    h.hub.answers.push({ ok: false, kind: 'status', status: 503, error: 'hub-updating' }, { ok: false, kind: 'unreachable', detail: 'down' });
    await until(() => h.hub.reads.length >= 3, 'polling past both');
    expect(status(h).problem).toBeNull();
    h.hub.answers.push({ ok: false, kind: 'status', status: 403, error: 'not-yours' });
    await until(() => status(h).problem !== null, 'the end');
    expect(status(h).problem).toBe('not-yours');
    const reads = h.hub.reads.length;
    await pause(40);
    expect(h.hub.reads.length, 'no read after the end').toBe(reads);
    h.enrollment.cancel();

    await started(h, 'box');
    h.hub.answers.push({ ok: false, kind: 'status', status: 404, error: 'unknown-enrollment' });
    await until(() => status(h).problem !== null, 'the end');
    expect(status(h)).toMatchObject({ generation: 2, problem: 'unknown-enrollment' });
  });

  it("a name the state binds to another ref ends it at the candidate (`machine-names`); a name bound to the key's own ref is enrolled again", async () => {
    const h = await harness();
    const wrong = await started(h, 'gone');
    await wrong.post();
    await until(() => status(h).problem !== null, 'the end');
    expect(status(h)).toMatchObject({ problem: 'machine-names', candidate: null });
    h.enrollment.cancel();

    const right = await started(h, 'gone');
    await right.post({ ref: GONE });
    await until(() => status(h).candidate !== null, 'the candidate');
    expect(await h.enrollment.approve({ generation: status(h).generation, digest: status(h).candidate!.digest })).toEqual({ ok: true, version: 4 });
    expect(h.held.head().state.machineNames.filter((n) => n.name === 'gone')).toEqual([{ name: 'gone', ref: GONE }]);
  });

  it("a re-enrollment's key under another ref than the machine's ends it `machine-names`", async () => {
    const h = await harness();
    const enroll = await started(h, 'mini', MINI);
    await enroll.post();
    await until(() => status(h).problem !== null, 'the end');
    expect(status(h).problem).toBe('machine-names');
  });

  it('expiry ends it, and its approval reads `stale`', async () => {
    const h = await harness();
    const now = { at: Date.now() };
    h.enrollment = createEnrollment({
      context: () => ({ hub: HUB, self: h.self, head: h.held.head(), certificates: h.held.certificates(), maySign: true, client: h.hub }),
      busy: () => false,
      sign: async () => ({ ok: true, version: 99 }),
      changed: () => {},
      timing: { ENROLL_POLL_MS: 10 },
      now: () => now.at,
      log: () => {},
    });
    const enroll = await started(h, 'box');
    await enroll.post();
    await until(() => status(h).candidate !== null, 'the candidate');
    now.at = Date.parse(enroll.expires);
    await until(() => status(h).problem !== null, 'the end');
    expect(status(h).problem).toBe('expired');
    expect(await h.enrollment.approve({ generation: 1, digest: status(h).candidate!.digest })).toMatchObject({ ok: false, reason: 'stale' });
    // a start after it, its token being minted: the ended run's window clears that run alone, never the new start
    const next = h.enrollment.start({ name: 'box' }, WINDOW);
    expect(h.enrollment.cancelRun({ generation: 1 }, WINDOW)).toEqual({ ok: true });
    expect(await next).toMatchObject({ ok: true });
    expect(status(h)).toMatchObject({ generation: 2, problem: null });
  });

  it('a poll in flight when the sign-in ends sets no candidate, and reads no more', async () => {
    const h = await harness();
    const enroll = await started(h, 'box');
    h.hub.hold.armed = true;
    await enroll.post();
    await until(() => h.hub.hold.release !== null, 'the held read');
    h.signedIn = false;
    h.hub.hold.release!();
    await pause(40);
    expect(h.enrollment.status()?.candidate ?? null).toBeNull();
    const reads = h.hub.reads.length;
    await pause(40);
    expect(h.hub.reads.length).toBe(reads);
    expect(h.enrollment.running()).toBe(false);
  });

  it('close cancels it and resolves once the poll in flight has ended', async () => {
    const h = await harness();
    const enroll = await started(h, 'box');
    h.hub.hold.armed = true;
    await enroll.post();
    await until(() => h.hub.hold.release !== null, 'the held read');
    let closed = false;
    const closing = h.enrollment.close().then(() => (closed = true));
    await pause(20);
    expect(closed, 'the read is still out').toBe(false);
    expect(h.enrollment.status()).toBeNull();
    h.hub.hold.release!();
    await closing;
    expect(h.enrollment.status()).toBeNull();
    expect(await h.enrollment.start({ name: 'box' }, WINDOW)).toMatchObject({ ok: false, reason: 'busy' });
  });
});

describe('approving', () => {
  it('a new machine: listed under the enrolling member, its name bound to its ref, signed once, accepted, held; the enrollment done', async () => {
    const h = await harness();
    const enroll = await started(h, 'box');
    const key = await enroll.post();
    await until(() => status(h).candidate !== null, 'the candidate');
    const { generation, candidate } = status(h);
    expect(await h.enrollment.approve({ generation, digest: candidate!.digest })).toEqual({ ok: true, version: 4 });
    expect(h.prompts).toHaveLength(1);
    const head = h.held.head().state;
    expect(head.machines.find((m) => m.name === 'box')).toEqual({ name: 'box', ref: key.ref, pub: key.pub, owners: [OWNER] });
    expect(head.machineNames).toContainEqual({ name: 'box', ref: key.ref });
    expect(h.hub.posts).toHaveLength(1);
    expect(h.enrollment.status()).toBeNull();
    enroll.clean();
  });

  it("a re-enrollment: the machine's new key under its ref, the old one retired, its owners kept", async () => {
    const h = await harness();
    const enroll = await started(h, 'mini', MINI);
    const key = await enroll.post({ ref: MINI });
    await until(() => status(h).candidate !== null, 'the candidate');
    const { generation, candidate } = status(h);
    expect(await h.enrollment.approve({ generation, digest: candidate!.digest })).toEqual({ ok: true, version: 4 });
    const head = h.held.head().state;
    expect(head.machines).toEqual([{ name: 'mini', ref: MINI, pub: key.pub, owners: [OWNER] }]);
    expect(head.retired.filter((r) => 'machine' in r.holder && r.holder.machine === MINI)).toEqual([{ keyId: await keyId(h.miniKey.pub), pub: h.miniKey.pub, notAfter: head.issued, holder: { machine: MINI } }]);
  });

  it('naming an old generation or another digest reads `stale`', async () => {
    const h = await harness();
    const first = await started(h, 'box');
    await first.post();
    await until(() => status(h).candidate !== null, 'the candidate');
    const old = status(h);
    expect(await h.enrollment.approve({ generation: old.generation, digest: 'A'.repeat(43) })).toMatchObject({ ok: false, reason: 'stale' });
    h.enrollment.cancel();
    const second = await started(h, 'box');
    await second.post();
    await until(() => status(h).candidate !== null, 'the second candidate');
    expect(await h.enrollment.approve({ generation: old.generation, digest: status(h).candidate!.digest })).toMatchObject({ ok: false, reason: 'stale' });
    expect(h.prompts).toEqual([]);
    expect(h.hub.posts).toEqual([]);
  });

  it('reads the key again at approval, and refuses one changed since it was shown', async () => {
    const h = await harness({ ENROLL_POLL_MS: 300 });
    const enroll = await started(h, 'box');
    const key = await enroll.post();
    await until(() => status(h).candidate !== null, 'the candidate', 5_000);
    const { generation, candidate } = status(h);
    const reads = h.hub.reads.length;
    await enroll.post({ ref: key.ref });
    expect(await h.enrollment.approve({ generation, digest: candidate!.digest })).toMatchObject({ ok: false, reason: 'stale' });
    expect(h.hub.reads.length).toBe(reads + 1);
    expect(status(h).problem).toBe('key-changed');
    expect(h.prompts).toEqual([]);
  });

  it('a name bound to another ref after the candidate was shown is refused at approval, before Touch ID', async () => {
    const h = await harness({ ENROLL_POLL_MS: 300 });
    const enroll = await started(h, 'box');
    await enroll.post();
    await until(() => status(h).candidate !== null, 'the candidate', 5_000);
    const { generation, candidate } = status(h);
    const other = { name: 'box', ref: newRef(), pub: (await generateSigningKey()).pub, owners: [BEA] };
    await moveHead(h, (s) => {
      s.machines.push(other);
      s.machineNames.push({ name: other.name, ref: other.ref });
    });
    expect(await h.enrollment.approve({ generation, digest: candidate!.digest })).toMatchObject({ ok: false, reason: 'refused' });
    expect(status(h).problem).toBe('machine-names');
    expect(h.prompts).toEqual([]);
    expect(h.hub.posts).toEqual([]);
  });

  for (const ending of ['a cancel', 'an expiry', 'the sign-in ending'] as const) {
    it(`${ending} while the confirmation is held open, then answered yes: no state signature, no slot, no post`, async () => {
      const h = await harness();
      const now = { at: Date.now() };
      h.enrollment = createEnrollment({
        context: () => (h.signedIn ? { hub: HUB, self: h.self, head: h.held.head(), certificates: h.held.certificates(), maySign: h.signer.maySign(), client: h.hub } : null),
        busy: () => false,
        sign: async (edit) => {
          const outcome = await h.signer.sign(edit);
          return outcome.ok ? outcome : { ok: false, reason: outcome.reason };
        },
        changed: () => {},
        timing: { ENROLL_POLL_MS: 10 },
        now: () => now.at,
        log: () => {},
      });
      const enroll = await started(h, 'box');
      await enroll.post();
      await until(() => status(h).candidate !== null, 'the candidate');
      const { generation, candidate } = status(h);
      const sign = vi.spyOn(crypto.subtle, 'sign');
      let signsAtYes = -1;
      h.during = () => {
        if (ending === 'a cancel') h.enrollment.cancel();
        else if (ending === 'an expiry') now.at = Date.parse(enroll.expires);
        else h.signedIn = false;
        signsAtYes = sign.mock.calls.length;
      };
      const result = await h.enrollment.approve({ generation, digest: candidate!.digest });
      expect(result).toMatchObject({ ok: false, reason: 'cancelled' });
      expect(h.prompts).toHaveLength(1);
      expect(signsAtYes).toBeGreaterThanOrEqual(0);
      expect(sign.mock.calls.length).toBe(signsAtYes);
      expect(h.disk()?.pending ?? null).toBeNull();
      expect(h.hub.posts).toEqual([]);
      expect(h.held.head().state.version).toBe(3);
    });
  }

  it('the head moving while the confirmation is held open: what was signed is neither kept nor posted', async () => {
    const h = await harness();
    const enroll = await started(h, 'box');
    await enroll.post();
    await until(() => status(h).candidate !== null, 'the candidate');
    const { generation, candidate } = status(h);
    h.during = () => moveHead(h, (s) => void (s.machines[0].owners = [OWNER, BEA]));
    const result = await h.enrollment.approve({ generation, digest: candidate!.digest });
    expect(result).toMatchObject({ ok: false });
    expect(result.ok).toBe(false);
    expect(h.disk()?.pending ?? null).toBeNull();
    expect(h.hub.posts).toEqual([]);
    expect(h.held.head().state.machines.some((m) => m.name === 'box')).toBe(false);
  });
});
