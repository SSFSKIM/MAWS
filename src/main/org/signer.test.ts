// The app as the org's signer (P5 O8 M3, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M3's "Who signs, and
// with what", "The signing file", "The pending slot" and Proves; Interfaces §K): who may sign, the composed successor,
// the checks before Touch ID and the package's verdict after it, and the durable pending slot with its delivery
// obligation, its exposure, its settling and its discard, all through the one signing store.
//
// Real signatures and the package's own verifiers throughout: the held view is held.ts over real files in a temporary
// profile, the store is signing-store.ts over the same files and a commit queue, the Touch ID step is step-up.ts's
// `createStateSigner` with an injected confirmation, and the hub is a small model that judges each post with
// `verifySuccessor` as the Registry does. No test raises a system prompt.
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canonicalize,
  generateSigningKey,
  keyId,
  NO_CERTIFICATES,
  signOrgState,
  signTransition,
  stateHash,
  verifySuccessor,
  type Device,
  type OrgState,
  type RevokedKey,
  type RootTransition,
  type Signed,
  type SignedOrgState,
  type SigningKey,
} from '../../../apps/org-protocol/src/index.ts';

vi.mock('electron', () => ({ systemPreferences: { promptTouchID: () => Promise.reject(new Error('no system prompt in the suites')) } }));

import { createStateSigner, type Confirmation, type StepUpPrompt } from '../device/step-up';
import { CHAIN_FILE, orgFiles, SIGNING_FILE, type Anchor, type Obligation, type OrgFiles, type SigningFile } from './files';
import { startHeldOrg, type HeldOrg } from './held';
import type { HubClient, HubResult, Served } from './hub-client';
import { heldOrgSession, type SignedIn } from './session';
import { createOrgSigner, noChangeEdit, type Edit, type OrgSigner, type SignerDeliveries } from './signer';
import { createSigningStore, type SigningStore } from './signing-store';

const ORG = 'org-signer';
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-28T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const memberId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

type TestDevice = { device: Device; channel: SigningKey; stepUp: SigningKey };
async function newDevice(id: string): Promise<TestDevice> {
  const channel = await generateSigningKey();
  const stepUp = await generateSigningKey();
  return { channel, stepUp, device: { id, class: 'native-mac', keyStorage: 'software', channelPub: channel.pub, stepUpPub: stepUp.pub } };
}

// The org: the deployment admin's device and this Mac's under the owner, two more devices a revocation can end, and
// the recovery key. Made once; each test signs its own genesis over them.
const OWNER = memberId();
let keys: { admin: TestDevice; app: TestDevice; old: TestDevice; older: TestDevice; recovery: SigningKey } | null = null;
async function org() {
  keys ??= { admin: await newDevice('dev-admin'), app: await newDevice('dev-app'), old: await newDevice('dev-old'), older: await newDevice('dev-older'), recovery: await generateSigningKey() };
  return keys;
}

async function genesis(options: { appRoot: boolean; issued: string }): Promise<SignedOrgState> {
  const { admin, app, old, older, recovery } = await org();
  const roots = [await keyId(admin.stepUp.pub), ...(options.appRoot ? [await keyId(app.stepUp.pub)] : [])];
  const state: OrgState = {
    org: ORG,
    version: 1,
    prev: null,
    issued: options.issued,
    root: { keys: roots, recoveryPub: recovery.pub },
    members: [{ id: OWNER, email: 'owner@example.com', role: 'admin', devices: [admin.device, app.device, old.device, older.device] }],
    machines: [],
    machineNames: [],
    retired: [],
    revoked: [],
    delegations: [],
    projects: [],
  };
  return signOrgState(state, [admin.stepUp]);
}

/**
 * The deployment admin's successor of `head` (a `refresh`, unless `edit` changes it), issued a minute before the app's
 * clock: the same no-change state at the same instant would be the app's own state, signed by another root.
 */
async function adminSuccessor(head: SignedOrgState, edit: (s: OrgState) => void = () => {}): Promise<SignedOrgState> {
  const state = structuredClone(head.state);
  state.version += 1;
  state.prev = await stateHash(head.state);
  state.issued = iso(Math.max(NOW - 60_000, Date.parse(head.state.issued)));
  edit(state);
  return signOrgState(state, [(await org()).admin.stepUp]);
}

/** The edit that removes `device` and revokes both its keys: a state that ends keys, so it carries an obligation. */
async function removeDevice(which: 'old' | 'older'): Promise<Edit> {
  const { device } = (await org())[which];
  const revoked: RevokedKey[] = [
    { keyId: await keyId(device.channelPub), holder: { member: OWNER, device: device.id, class: device.class, key: 'channel' } },
    { keyId: await keyId(device.stepUpPub!), holder: { member: OWNER, device: device.id, class: device.class, key: 'step-up' } },
  ];
  return {
    summary: `remove device ${device.id}`,
    lines: [`Remove ${device.id} of owner@example.com and revoke its keys`],
    apply(draft) {
      for (const m of draft.members) m.devices = m.devices.filter((d) => d.id !== device.id);
      draft.revoked.push(...revoked);
    },
  };
}

/**
 * The hub, as far as the signer meets it: a chain that takes a post the package's `verifySuccessor` accepts against its
 * head (409 with the verdict otherwise, as `OrgChain.submit` answers), and serves its chain after a version.
 */
class FakeHub implements HubClient {
  states: SignedOrgState[];
  posts: SignedOrgState[] = [];
  reads = 0;
  /** Root transitions the hub keeps beside its chain, served with every read. */
  transitions: Signed<RootTransition>[] = [];
  /**
   * `unreachable`: no answer, nothing taken; `lost-answer`: taken, and its answer lost; `purged`: a courtesy refusal;
   * `lying`: a 201 for a post it never kept.
   */
  mode: 'accept' | 'unreachable' | 'lost-answer' | 'purged' | 'lying' = 'accept';
  /** Runs at each post before it is judged (an admin's state landing first, a look at the profile's files). */
  beforePost: ((signed: SignedOrgState) => Promise<void> | void) | null = null;

  constructor(states: SignedOrgState[]) {
    this.states = [...states];
  }

  async postState(signed: SignedOrgState): Promise<HubResult<{ version: number }>> {
    this.posts.push(signed);
    await this.beforePost?.(signed);
    if (this.mode === 'unreachable') return { ok: false, kind: 'unreachable', detail: 'the hub is down' };
    if (this.mode === 'purged') return { ok: false, kind: 'status', status: 409, error: 'key-purged' };
    if (this.mode === 'lying') return { ok: true, value: { version: signed.state.version } };
    const verdict = await verifySuccessor(this.states.at(-1)!, signed, this.transitions);
    if (!verdict.ok) return { ok: false, kind: 'status', status: 409, error: verdict.code };
    this.states.push(signed);
    if (this.mode === 'lost-answer') return { ok: false, kind: 'unreachable', detail: 'the answer was lost' };
    return { ok: true, value: { version: signed.state.version } };
  }

  async chain(since: number): Promise<HubResult<Served>> {
    this.reads++;
    if (this.mode === 'unreachable') return { ok: false, kind: 'unreachable', detail: 'the hub is down' };
    return { ok: true, value: { chain: this.states.filter((s) => s.state.version > since), head: this.states.at(-1)!, transitions: this.transitions, certificates: NO_CERTIFICATES } };
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

/** Task 5's deliveries as the signer meets them: an obligation for each state that ends keys, owed to two machines. */
function fakeDeliveries(onObligation: () => void = () => {}): SignerDeliveries & { sends: number } {
  return {
    sends: 0,
    async obligation(signed, parent): Promise<Obligation | null> {
      onObligation();
      const ended = (s: OrgState) => new Set([...s.revoked, ...s.retired].map((r) => r.keyId));
      const before = ended(parent);
      if (![...ended(signed.state)].some((kid) => !before.has(kid))) return null;
      return { hash: await stateHash(signed.state), signed, owed: ['m-one', 'm-two'], known: {}, probed: {}, tooLarge: [] };
    },
    async send() {
      this.sends++;
    },
  };
}

const profiles: string[] = [];
afterEach(async () => {
  await Promise.all(profiles.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

type Options = { appRoot?: boolean; marked?: boolean; issued?: string; hub?: boolean };

/** Everything one profile's signer is composed of, as org-session.ts composes it (Task 6). */
type Harness = {
  dir: string;
  files: OrgFiles;
  /** Every write to the profile's org files, in order: the store's and the registration flag's. */
  writes: Array<{ name: string; value: unknown }>;
  /** `chain`: every chain.json write fails (a full disk under the held view's adoption). */
  faults: { chain: boolean };
  hub: FakeHub;
  /** The hub the signer is given: `null` while `hub` is false. */
  online: boolean;
  held: HeldOrg;
  store: SigningStore;
  signer: OrgSigner;
  deliveries: ReturnType<typeof fakeDeliveries>;
  prompts: StepUpPrompt[];
  /** What the person answers; `during` runs while they are asked. */
  answer: Confirmation;
  during: (() => Promise<void> | void) | null;
  registration: { signing?: true };
  genesis: SignedOrgState;
  /** A next start of the same profile: the files read again, a new held view, store and signer. */
  restart(): Promise<Harness>;
  disk(): SigningFile | null;
};

async function harness(options: Options = {}): Promise<Harness> {
  const g = await genesis({ appRoot: options.appRoot ?? true, issued: options.issued ?? iso(NOW - 10 * DAY) });
  const dir = await mkdtemp(join(tmpdir(), 'maws-signer-'));
  profiles.push(dir);
  const base = orgFiles({ userData: dir, log: () => {} });
  expect(await base.ensure()).toEqual({ ok: true });
  const writes: Harness['writes'] = [];
  const faults = { chain: false };
  const files: OrgFiles = {
    ...base,
    write: async (name, value) => {
      if (faults.chain && name === CHAIN_FILE) throw new Error('disk full');
      writes.push({ name, value: structuredClone(value) });
      return base.write(name, value);
    },
  };
  let anchor: Anchor | null = null;
  const saveAnchor = async (next: Anchor) => void (anchor = next);
  const started = await startHeldOrg({ files, anchor: null, saveAnchor, pins: { roots: g.state.root.keys, recoveryPub: g.state.root.recoveryPub }, first: { chain: [g], transitions: [], certificates: NO_CERTIFICATES }, log: () => {} });
  if (!started.ok) throw new Error(started.reason);
  const hub = new FakeHub([g]);
  const registration: { signing?: true } = {};
  const shared = { dir, files, writes, faults, hub, registration, genesis: g, prompts: [] as StepUpPrompt[] };

  async function compose(held: HeldOrg, online: boolean): Promise<Harness> {
    let commits: Promise<unknown> = Promise.resolve();
    const commit = <T>(body: () => Promise<T>): Promise<T> => {
      const turn = commits.then(body);
      commits = turn.catch(() => {});
      return turn;
    };
    const store = await createSigningStore({
      files,
      commit,
      registration: () => registration,
      // In the commit queue's turn, as the session's is: registration.json read, changed and written.
      markRegistration: async () => {
        await files.write('registration.json', { signing: true });
        registration.signing = true;
      },
    });
    const session = heldOrgSession({} as SignedIn);
    held.onAdopted(() => session.changed());
    const h: Harness = {
      ...shared,
      online,
      held,
      store,
      deliveries: fakeDeliveries(),
      answer: { ok: true },
      during: null,
      signer: null as unknown as OrgSigner,
      async restart() {
        const again = await startHeldOrg({ files, anchor, saveAnchor, log: () => {} });
        if (!again.ok) throw new Error(again.reason);
        return compose(again.held, h.online);
      },
      disk: () => {
        try {
          return JSON.parse(readFileSync(join(dir, 'org', SIGNING_FILE), 'utf8')) as SigningFile;
        } catch {
          return null;
        }
      },
    };
    const stateSigner = await createStateSigner({
      key: (await org()).app.stepUp,
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
      marked: () => options.marked ?? true,
      hub: () => (h.online ? hub : null),
      store,
      deliveries: { obligation: (signed, parent) => h.deliveries.obligation(signed, parent), send: () => h.deliveries.send() },
      now: () => NOW,
      log: () => {},
    });
    return h;
  }
  return compose(started.held, options.hub ?? true);
}

describe('who signs', () => {
  it('refuses `not-root` without a root key, and `unmarked` for an unmarked device the head lists as a root, signing nothing in either', async () => {
    const outsider = await harness({ appRoot: false });
    expect(outsider.signer.isRoot()).toBe(false);
    expect(outsider.signer.maySign()).toBe(false);
    expect(await outsider.signer.sign(noChangeEdit())).toMatchObject({ ok: false, reason: 'not-root' });

    const unmarked = await harness({ marked: false });
    expect(unmarked.signer.isRoot()).toBe(true);
    expect(unmarked.signer.maySign()).toBe(false);
    expect(await unmarked.signer.sign(noChangeEdit())).toMatchObject({ ok: false, reason: 'unmarked' });

    for (const h of [outsider, unmarked]) {
      expect(h.prompts).toEqual([]);
      expect(h.hub.posts).toEqual([]);
      expect(h.disk()).toBeNull();
    }
  });
});

describe('following a recovery before a sign', () => {
  it('takes a recovery from below the held head before anything is shown, so a root the recovery removed is refused `not-root`', async () => {
    const h = await harness();
    expect(await h.signer.sign(noChangeEdit())).toEqual({ ok: true, version: 2 });
    expect(await h.signer.sign(noChangeEdit())).toEqual({ ok: true, version: 3 });
    const { admin, recovery } = await org();
    // The recovery key rewinds the org to version 1 with the deployment admin the one root: the app's key is no longer.
    const t = await signTransition({ org: ORG, fromVersion: 1, newRootKeys: [admin.stepUp.pub], issued: iso(NOW) }, recovery.privateKey, recovery.pub);
    const recovered = await adminSuccessor(h.genesis, (s) => void (s.root.keys = s.root.keys.slice(0, 1)));
    h.hub.states = [h.genesis, recovered];
    h.hub.transitions = [t];

    expect(await h.signer.sign(noChangeEdit())).toEqual({ ok: false, reason: 'not-root' });
    expect(h.prompts).toHaveLength(2);
    expect(h.hub.posts).toHaveLength(2);
    expect(h.held.head()).toEqual(recovered);
    expect(h.signer.isRoot()).toBe(false);
  });
});

describe('the composed successor', () => {
  it('is the head plus one: its version, prev the head\'s hash, and issued now', async () => {
    const h = await harness();
    expect(h.signer.maySign()).toBe(true);
    expect(await h.signer.sign(noChangeEdit())).toEqual({ ok: true, version: 2 });
    const [posted] = h.hub.posts;
    expect(posted.state.version).toBe(2);
    expect(posted.state.prev).toBe(await stateHash(h.genesis.state));
    expect(posted.state.issued).toBe(iso(NOW));
    expect(canonicalize({ ...posted.state, version: 1, prev: null, issued: h.genesis.state.issued })).toBe(canonicalize(h.genesis.state));
    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0].summary).toBe('re-sign the org state (no change)');
    // Accepted and adopted: the held head is the signed state, and nothing is pending.
    expect(h.held.head()).toEqual(posted);
    expect(h.signer.pending()).toBeNull();
  });

  it('is never issued before a head issued in the future', async () => {
    const ahead = iso(NOW + DAY);
    const h = await harness({ issued: ahead });
    expect(await h.signer.sign(noChangeEdit())).toEqual({ ok: true, version: 2 });
    expect(h.hub.posts[0].state.issued).toBe(ahead);
  });

  it('is signed on the hub\'s head when the hub moved past the held one, so no fork is made', async () => {
    const h = await harness();
    h.hub.states.push(await adminSuccessor(h.genesis));
    expect(await h.signer.sign(noChangeEdit())).toEqual({ ok: true, version: 3 });
    expect(h.held.head().state.version).toBe(3);
  });
});

describe('the checks and the verdict', () => {
  it('runs the checks before Touch ID: a refusal ends the attempt with its findings and no prompt', async () => {
    const h = await harness();
    const emptied: Edit = { summary: 'empty the roots', lines: [], apply: (draft) => void (draft.root.keys = []) };
    const outcome = await h.signer.sign(emptied);
    expect(outcome).toMatchObject({ ok: false, reason: 'refused', findings: [{ level: 'refuse', code: 'empty-roots' }] });
    expect(h.prompts).toEqual([]);
    expect(h.hub.posts).toEqual([]);
    expect(h.disk()).toBeNull();
  });

  it('refuses `invalid` when the signed state fails verifySuccessor, keeping and sending nothing', async () => {
    const h = await harness();
    const other = await generateSigningKey();
    // No check names a changed recovery key; the package refuses it (`malformed`) once it is signed.
    const recovery: Edit = { summary: 'change the recovery key', lines: [], apply: (draft) => void (draft.root.recoveryPub = other.pub) };
    expect(await h.signer.sign(recovery)).toEqual({ ok: false, reason: 'invalid', detail: 'malformed' });
    expect(h.prompts).toHaveLength(1);
    expect(h.hub.posts).toEqual([]);
    expect(h.disk()).toBeNull();
    expect(h.signer.pending()).toBeNull();
  });

  it('keeps nothing when the head moved while the person was asked', async () => {
    const h = await harness();
    h.during = async () => void (await h.held.adoptServed({ chain: [await adminSuccessor(h.genesis)], head: null, transitions: [], certificates: null }));
    expect(await h.signer.sign(noChangeEdit())).toEqual({ ok: false, reason: 'invalid', detail: 'not-head' });
    expect(h.hub.posts).toEqual([]);
    expect(h.disk()).toBeNull();
  });

  it('refuses `cancelled` when the person declines, keeping nothing', async () => {
    const h = await harness();
    h.answer = { ok: false, reason: 'cancelled' };
    expect(await h.signer.sign(noChangeEdit())).toEqual({ ok: false, reason: 'cancelled' });
    expect(h.hub.posts).toEqual([]);
    expect(h.disk()).toBeNull();
  });
});

describe('the pending slot', () => {
  it('writes the slot and its delivery obligation in one write before any send, exposure before the post, and clears the slot at 201', async () => {
    const h = await harness();
    const atPost: Array<SigningFile | null> = [];
    h.hub.beforePost = () => void atPost.push(h.disk());
    const edit = await removeDevice('old');
    expect(await h.signer.sign(edit)).toEqual({ ok: true, version: 2 });
    const signed = h.hub.posts[0];
    const hash = await stateHash(signed.state);

    // The registration's flag first, then the slot and the obligation together in signing.json's first write.
    const names = h.writes.map((w) => w.name).filter((n) => n === 'registration.json' || n === SIGNING_FILE);
    expect(names.slice(0, 2)).toEqual(['registration.json', SIGNING_FILE]);
    const first = h.writes.find((w) => w.name === SIGNING_FILE)!.value as SigningFile;
    expect(first.pending).toEqual({ signed, parent: await stateHash(h.genesis.state), hash: await stateHash(signed.state), exposed: { hub: false, machines: [] } });
    expect(first.deliveries).toEqual([{ hash, signed, owed: ['m-one', 'm-two'], known: {}, probed: {}, tooLarge: [] }]);

    // At the post, the file on disk already says the hub may hold it.
    expect(atPost).toHaveLength(1);
    expect(atPost[0]!.pending!.exposed.hub).toBe(true);

    // At 201 the slot clears; the obligation settles apart (its machines haven't acknowledged), and its sending starts.
    expect(h.disk()!.pending).toBeNull();
    expect(h.disk()!.deliveries.map((o) => o.hash)).toEqual([hash]);
    await vi.waitFor(() => expect(h.deliveries.sends).toBeGreaterThan(0));
  });

  it('reports no success when the hub took the state but the held view could not adopt it, and settles it once it can', async () => {
    const h = await harness();
    h.hub.beforePost = () => void (h.faults.chain = true);
    const outcome = await h.signer.sign(noChangeEdit());
    expect(outcome).toMatchObject({ ok: false, reason: 'hub' });
    expect((outcome as { detail: string }).detail).toContain('not adopted');
    expect(h.held.head().state.version).toBe(1);
    expect(h.signer.pending()).toMatchObject({ version: 2, exposed: true, fork: false });

    h.faults.chain = false;
    await h.signer.settle();
    expect(h.held.head().state.version).toBe(2);
    expect(h.disk()!.pending).toBeNull();
  });

  it('reports no success for a 201 whose hub then serves another state at that version', async () => {
    const h = await harness();
    const theirs = await adminSuccessor(h.genesis);
    h.hub.mode = 'lying';
    h.hub.beforePost = () => void (h.hub.states.length === 1 && h.hub.states.push(theirs));
    expect(await h.signer.sign(noChangeEdit())).toMatchObject({ ok: false, reason: 'hub' });
    expect(h.held.head()).toEqual(theirs);
    expect(h.signer.pending()).toMatchObject({ version: 2, exposed: true, fork: true });
  });

  it('signs nothing while a state is pending', async () => {
    const h = await harness({ hub: false });
    expect(await h.signer.sign(noChangeEdit())).toMatchObject({ ok: false, reason: 'hub' });
    expect(h.signer.pending()).toMatchObject({ version: 2, exposed: false, fork: false });
    expect(await h.signer.sign(noChangeEdit())).toEqual({ ok: false, reason: 'pending' });
    expect(h.prompts).toHaveLength(1);
  });

  it('refuses `busy` while another sign is in flight', async () => {
    const h = await harness();
    let release!: () => void;
    h.during = () => new Promise<void>((resolve) => (release = resolve));
    const first = h.signer.sign(noChangeEdit());
    await vi.waitFor(() => expect(h.prompts).toHaveLength(1));
    expect(await h.signer.sign(noChangeEdit())).toEqual({ ok: false, reason: 'busy' });
    release();
    expect(await first).toEqual({ ok: true, version: 2 });
  });

  it('settles a slot a crash left before its post at the next start: the hub holds no successor, so the same bytes are posted again', async () => {
    const h = await harness({ hub: false });
    expect(await h.signer.sign(noChangeEdit())).toMatchObject({ ok: false, reason: 'hub' });
    const kept = h.disk()!.pending!;
    expect(kept.exposed.hub).toBe(false);

    h.online = true;
    const next = await h.restart();
    await next.signer.settle();
    expect(next.hub.posts.map((s) => canonicalize(s))).toEqual([canonicalize(kept.signed)]);
    expect(next.held.head().state.version).toBe(2);
    expect(next.disk()!.pending).toBeNull();
    expect(next.signer.pending()).toBeNull();
  });

  it('settles a slot whose post was taken but whose answer was never recorded: the hub\'s chain holds it, so it is adopted and cleared', async () => {
    const h = await harness();
    h.hub.mode = 'lost-answer';
    expect(await h.signer.sign(noChangeEdit())).toMatchObject({ ok: false, reason: 'hub' });
    expect(h.signer.pending()).toMatchObject({ version: 2, exposed: true, fork: false });

    h.hub.mode = 'accept';
    const next = await h.restart();
    await next.signer.settle();
    expect(next.hub.posts).toHaveLength(1);
    expect(next.held.head().state.version).toBe(2);
    expect(next.disk()!.pending).toBeNull();
  });

  it('reads `pending-fork` when an exposed proposal meets `not-head`, and never clears it by itself', async () => {
    const h = await harness();
    const theirs = await adminSuccessor(h.genesis);
    h.hub.beforePost = () => void (h.hub.states.length === 1 && h.hub.states.push(theirs));
    expect(await h.signer.sign(noChangeEdit())).toEqual({ ok: false, reason: 'hub', detail: 'not-head' });
    expect(h.held.head()).toEqual(theirs);
    await vi.waitFor(() => expect(h.signer.pending()).toMatchObject({ version: 2, exposed: true, fork: true }));

    await h.signer.settle();
    await h.signer.settle();
    const next = await h.restart();
    await next.signer.settle();
    expect(next.signer.pending()).toMatchObject({ version: 2, exposed: true, fork: true });
    expect(next.hub.posts).toHaveLength(1);
    expect(await next.signer.sign(noChangeEdit())).toEqual({ ok: false, reason: 'pending' });
    expect(next.prompts).toHaveLength(1);
  });

  it('still names a rejected proposal the hub kept and serves later', async () => {
    const h = await harness();
    const theirs = await adminSuccessor(h.genesis);
    h.hub.beforePost = () => void (h.hub.states.length === 1 && h.hub.states.push(theirs));
    await h.signer.sign(noChangeEdit());
    const proposal = h.hub.posts[0];
    // The hub kept the bytes it refused, and serves them at their version now.
    h.hub.states[1] = proposal;
    await h.signer.settle();
    expect(h.held.head()).toEqual(theirs);
    expect(h.disk()!.pending!.signed).toEqual(proposal);
    await vi.waitFor(() => expect(h.signer.pending()).toMatchObject({ version: 2, fork: true }));
    expect(await h.signer.discardPending(true, h.signer.pending()!.hash)).toEqual({ ok: false, reason: 'held' });
    expect(h.disk()!.pending!.signed).toEqual(proposal);
  });
});

describe('discarding a pending proposal', () => {
  it('is refused while the hub\'s chain holds the state', async () => {
    const h = await harness();
    h.hub.mode = 'lost-answer';
    await h.signer.sign(noChangeEdit());
    h.hub.mode = 'accept';
    expect(await h.signer.discardPending(true, h.signer.pending()!.hash)).toEqual({ ok: false, reason: 'held' });
    expect(h.disk()!.abandoned).toEqual([]);
    // Held by the hub, so adopted: the slot settles as the hub's.
    expect(h.held.head().state.version).toBe(2);
    expect(h.disk()!.pending).toBeNull();
  });

  it('happens only on the owner\'s confirmation, and moves the obligation to `abandoned` with where it may be held', async () => {
    const h = await harness();
    const theirs = await adminSuccessor(h.genesis);
    h.hub.beforePost = () => void (h.hub.states.length === 1 && h.hub.states.push(theirs));
    await h.signer.sign(await removeDevice('old'));
    const hash = await stateHash(h.hub.posts[0].state);
    expect(h.disk()!.deliveries.map((o) => o.hash)).toEqual([hash]);

    expect(await h.signer.discardPending(false as unknown as true, h.signer.pending()!.hash)).toMatchObject({ ok: false });
    expect(h.disk()!.pending).not.toBeNull();

    // Exposed at the hub, which holds the admin's version 2: a fork the Org section words with its warning.
    expect(await h.signer.discardPending(true, h.signer.pending()!.hash)).toEqual({ ok: true, unsent: false, hubVersion: 2, forkAt: 2 });
    const file = h.disk()!;
    expect(file.pending).toBeNull();
    expect(file.deliveries).toEqual([]);
    expect(file.abandoned).toEqual([{ hash, version: 2, hub: true, machines: [] }]);
    expect(h.signer.pending()).toBeNull();
    // The next sign is a successor of the hub's head.
    expect(await h.signer.sign(noChangeEdit())).toEqual({ ok: true, version: 3 });
  });

  it('also clears a slot the hub keeps refusing for another reason, which settling would post forever', async () => {
    const h = await harness();
    h.hub.mode = 'purged';
    expect(await h.signer.sign(noChangeEdit())).toEqual({ ok: false, reason: 'hub', detail: '409 key-purged' });
    await h.signer.settle();
    expect(h.hub.posts).toHaveLength(2);
    expect(h.signer.pending()).toMatchObject({ version: 2, exposed: true, fork: false });
    expect(await h.signer.discardPending(true, h.signer.pending()!.hash)).toEqual({ ok: true, unsent: false, hubVersion: 1 });
    expect(h.disk()!.abandoned).toEqual([{ hash: await stateHash(h.hub.posts[0].state), version: 2, hub: true, machines: [] }]);
  });

  it('reads a slot never exposed as unsent, adopts the hub\'s chain first, and accepts no version below that floor after it', async () => {
    const h = await harness({ hub: false });
    expect(await h.signer.sign(noChangeEdit())).toMatchObject({ ok: false, reason: 'hub' });
    // Meanwhile the deployment admin signs versions 2 and 3 at the hub.
    const two = await adminSuccessor(h.genesis);
    const three = await adminSuccessor(two);
    h.hub.states.push(two, three);
    h.online = true;

    expect(await h.signer.discardPending(true, h.signer.pending()!.hash)).toEqual({ ok: true, unsent: true, hubVersion: 3, forkAt: 2 });
    expect(h.held.head()).toEqual(three);
    // The floor is max(the slot's parent version, the hub's head): an older chain is refused as a rollback.
    expect(await h.held.adoptServed({ chain: [], head: h.genesis, transitions: [], certificates: null })).toMatchObject({ adopted: 0, refused: 'rollback' });
    expect(await h.held.adoptServed({ chain: [], head: two, transitions: [], certificates: null })).toMatchObject({ adopted: 0, refused: 'rollback' });
    expect(h.held.head()).toEqual(three);
    expect(await h.signer.sign(noChangeEdit())).toEqual({ ok: true, version: 4 });
  });

  it('is refused `stale` when the confirmation named another proposal than the slot holds, and the slot stays', async () => {
    const h = await harness();
    h.hub.mode = 'purged';
    await h.signer.sign(noChangeEdit());
    const slot = h.disk()!.pending!;
    // The slot keeps its state's stateHash from its write; the status names it so, and the confirmation carries it back.
    expect(slot.hash).toBe(await stateHash(slot.signed.state));
    expect(h.signer.pending()!.hash).toBe(slot.hash);
    const reads = h.hub.reads;
    expect(await h.signer.discardPending(true, await stateHash(h.genesis.state))).toEqual({ ok: false, reason: 'stale' });
    expect(h.hub.reads).toBe(reads); // refused before the hub is read
    expect(h.disk()!.pending).toEqual(slot);
    expect(h.disk()!.abandoned).toEqual([]);
    expect(h.signer.pending()).toMatchObject({ version: 2 });
  });

  it('is refused while the hub can\'t be read, since only the hub says it doesn\'t hold the state', async () => {
    const h = await harness({ hub: false });
    await h.signer.sign(noChangeEdit());
    expect(await h.signer.discardPending(true, h.signer.pending()!.hash)).toEqual({ ok: false, reason: 'hub' });
    h.online = true;
    h.hub.mode = 'unreachable';
    expect(await h.signer.discardPending(true, h.signer.pending()!.hash)).toEqual({ ok: false, reason: 'hub' });
    expect(h.disk()!.pending).not.toBeNull();
  });
});

describe('the signing file', () => {
  it('fails closed once written: missing or unreadable, every sign is refused `signing` until resetSigning', async () => {
    const h = await harness();
    expect(await h.signer.sign(noChangeEdit())).toEqual({ ok: true, version: 2 });
    expect(h.registration.signing).toBe(true);

    await rm(join(h.dir, 'org', SIGNING_FILE));
    const missing = await h.restart();
    expect(missing.store.get()).toBe('damaged');
    expect(missing.signer.maySign()).toBe(false);
    expect(await missing.signer.sign(noChangeEdit())).toEqual({ ok: false, reason: 'signing' });
    expect(missing.prompts).toHaveLength(1);

    writeFileSync(join(h.dir, 'org', SIGNING_FILE), '{"version": 1, "pending": "half a wri', { mode: 0o600 });
    const unreadable = await h.restart();
    expect(unreadable.store.get()).toBe('damaged');
    expect(await unreadable.signer.sign(noChangeEdit())).toEqual({ ok: false, reason: 'signing' });

    await unreadable.signer.resetSigning(true);
    expect(unreadable.store.get()).toEqual({ version: 1, pending: null, deliveries: [], abandoned: [], lastAsked: null, lastNotified: null });
    expect(unreadable.signer.maySign()).toBe(true);
    expect(await unreadable.signer.sign(noChangeEdit())).toEqual({ ok: true, version: 3 });
  });

  it('keeps a weekly date written while a pending state is being written: one store, nothing lost', async () => {
    const h = await harness({ hub: false });
    let dated: Promise<void> | null = null;
    h.during = () => {
      dated = h.store.update((file) => ((file.lastAsked = iso(NOW)), { next: file, value: undefined }));
    };
    expect(await h.signer.sign(noChangeEdit())).toMatchObject({ ok: false, reason: 'hub' });
    await dated;
    const file = (await h.restart()).store.get() as SigningFile;
    expect(file.lastAsked).toBe(iso(NOW));
    expect(file.pending?.signed.state.version).toBe(2);
  });

  it('keeps an acknowledgement written while a new pending state is being written: one store, nothing lost', async () => {
    const h = await harness();
    expect(await h.signer.sign(await removeDevice('old'))).toEqual({ ok: true, version: 2 });
    const first = h.disk()!.deliveries[0].hash;

    // Machine one acknowledges the first state just as the second is slotted.
    h.online = false;
    let acked: Promise<void> | null = null;
    h.deliveries = fakeDeliveries(() => {
      acked = h.store.update((file) => {
        const o = file.deliveries.find((x) => x.hash === first)!;
        o.owed = o.owed.filter((ref) => ref !== 'm-one');
        return { next: file, value: undefined };
      });
    });
    expect(await h.signer.sign(await removeDevice('older'))).toMatchObject({ ok: false, reason: 'hub' });
    await acked;
    const file = (await h.restart()).store.get() as SigningFile;
    expect(file.deliveries.map((o) => [o.hash === first, o.owed])).toEqual([
      [true, ['m-two']],
      [false, ['m-one', 'm-two']],
    ]);
    expect(file.pending?.signed.state.version).toBe(3);
  });
});
