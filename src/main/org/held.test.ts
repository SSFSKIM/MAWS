// The held org view (P5 O8 M1, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, "The held org view" and M1's
// Proves): registration pinned and anchored, each row of the adoption rules (the endpoint's org-sync cases carried
// over), chain.json and the anchor written before anyone is told, the load rule from the anchored genesis (never
// pinned again), a crash between the two files, and a damaged chain.json that only a served chain holding the anchored
// state reopens. Real files in a temporary profile, real signatures.
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  endorseDevice,
  generateSigningKey,
  keyId,
  NO_CERTIFICATES,
  signOrgState,
  signTransition,
  stateHash,
  verifyPinnedChain,
  type Certificates,
  type Device,
  type OrgState,
  type RevokedKey,
  type RootTransition,
  type Signed,
  type SignedOrgState,
  type SigningKey,
} from '../../../apps/org-protocol/src/index.ts';
import { CHAIN_FILE, orgFiles, type ChainFile, type OrgFiles } from './files';
import { startHeldOrg, type Anchor, type HeldOrg } from './held';

// The org's states, signed as an admin's app signs them (test/endpoint/org-fixtures.ts's, which src/ can't import).
type TestDevice = { device: Device; channel: SigningKey; stepUp: SigningKey };

async function newDevice(id: string): Promise<TestDevice> {
  const channel = await generateSigningKey();
  const stepUp = await generateSigningKey();
  return { channel, stepUp, device: { id, class: 'native-mac', keyStorage: 'software', channelPub: channel.pub, stepUpPub: stepUp.pub } };
}

const iso = (ms: number) => new Date(ms).toISOString();
const memberId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

async function genesis(admin: string, device: TestDevice, recovery: SigningKey): Promise<SignedOrgState> {
  const state: OrgState = {
    org: ORG,
    version: 1,
    prev: null,
    issued: iso(Date.now() - 10 * DAY),
    root: { keys: [await keyId(device.stepUp.pub)], recoveryPub: recovery.pub },
    members: [{ id: admin, email: 'owner@example.com', role: 'admin', devices: [device.device] }],
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

function transition(fromVersion: number, devices: TestDevice[], issued = iso(Date.now())): Promise<Signed<RootTransition>> {
  return signTransition({ org: ORG, fromVersion, newRootKeys: devices.map((d) => d.stepUp.pub), issued }, recovery.privateKey, recovery.pub);
}

async function revokedDevice(member: string, device: Device): Promise<RevokedKey[]> {
  const keys: Array<['channel' | 'step-up', string]> = [['channel', device.channelPub], ['step-up', device.stepUpPub!]];
  return Promise.all(keys.map(async ([key, pub]) => ({ keyId: await keyId(pub), holder: { member, device: device.id, class: device.class, key } })));
}

/** The first state under a recovery to `to`, from `base`: `to` the one root device, the stolen `lost` revoked. */
const recovered = (base: SignedOrgState, to: TestDevice, lost: TestDevice) =>
  successor(base, [to], async (s) => {
    s.members[0].devices = [to.device];
    s.root.keys = [await keyId(to.stepUp.pub)];
    s.revoked.push(...(await revokedDevice(A, lost.device)));
  });

const ORG = 'org-held';
const DAY = 86_400_000;
let userData: string;
let lines: string[];
let files: OrgFiles;
let failWrites: boolean;
let anchor: Anchor | null;
let saved: Anchor[];
let anchorFails: boolean;
let A: string;
let a1: TestDevice;
let recovery: SigningKey;
let s1: SignedOrgState;

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'maws-held-'));
  lines = [];
  const real = orgFiles({ userData, log: (l) => lines.push(l) });
  failWrites = false;
  // chain.json's writes, failing on demand as a full disk would, before the rename.
  files = { ...real, write: (name, value) => (failWrites ? Promise.reject(new Error('disk fault')) : real.write(name, value)) };
  expect(await files.ensure()).toEqual({ ok: true });
  anchor = null;
  saved = [];
  anchorFails = false;
  A = memberId();
  a1 = await newDevice('a1');
  recovery = await generateSigningKey();
  s1 = await genesis(A, a1, recovery);
});
afterEach(() => rm(userData, { recursive: true, force: true }));

/** registration.json's anchor: a crash (`anchorFails`) loses the write. */
async function saveAnchor(next: Anchor): Promise<void> {
  if (anchorFails) throw new Error('crash before registration.json');
  anchor = next;
  saved.push(next);
}

const log = (line: string) => void lines.push(line);
const pinsOf = async (device: TestDevice) => ({ roots: [await keyId(device.stepUp.pub)], recoveryPub: recovery.pub });
const anchorOf = async (genesisState: SignedOrgState, head: SignedOrgState): Promise<Anchor> => ({ genesis: await stateHash(genesisState.state), version: head.state.version, head: await stateHash(head.state) });
const onDisk = () => JSON.parse(readFileSync(join(files.dir, CHAIN_FILE), 'utf8')) as ChainFile;
const served = (chain: SignedOrgState[], transitions: Signed<RootTransition>[] = [], certificates: Certificates | null = NO_CERTIFICATES) => ({ chain, head: chain.at(-1) ?? null, transitions, certificates });

/** Registered on `chain`, pinned by `pinned`'s code. */
async function registered(chain: SignedOrgState[], transitions: Signed<RootTransition>[] = [], pinned = a1): Promise<HeldOrg> {
  const started = await startHeldOrg({ files, anchor: null, saveAnchor, pins: await pinsOf(pinned), first: { chain, transitions, certificates: NO_CERTIFICATES }, log });
  if (!started.ok) throw new Error(`registration refused: ${started.reason}`);
  return started.held;
}

/** A restart: chain.json under the anchor registration.json holds, with no network. */
async function restarted(): Promise<HeldOrg> {
  const started = await startHeldOrg({ files, anchor, saveAnchor, log });
  if (!started.ok) throw new Error(`load refused: ${started.reason}`);
  return started.held;
}

describe('registration', () => {
  it('pins the served chain, writes chain.json, then the anchor from its genesis and head', async () => {
    const s2 = await successor(s1, [a1]);
    let fileAtAnchor: ChainFile | null = null;
    const started = await startHeldOrg({
      files,
      anchor: null,
      saveAnchor: async (next) => {
        fileAtAnchor = onDisk();
        await saveAnchor(next);
      },
      pins: await pinsOf(a1),
      first: { chain: [s1, s2], transitions: [], certificates: NO_CERTIFICATES },
      log,
    });
    expect(started.ok).toBe(true);
    expect(fileAtAnchor).toMatchObject({ chain: [s1, s2], highWater: 2, superseded: [], accepted: [] });
    expect(saved).toEqual([await anchorOf(s1, s2)]);
    if (started.ok) expect(started.held.head()).toEqual(s2);
  });

  it('refuses an org no pinned root signed, and writes nothing', async () => {
    const stranger = await newDevice('x1');
    const started = await startHeldOrg({ files, anchor: null, saveAnchor, pins: await pinsOf(stranger), first: { chain: [s1], transitions: [], certificates: NO_CERTIFICATES }, log });
    expect(started).toEqual({ ok: false, reason: 'not-root-signed' });
    expect(await files.read(CHAIN_FILE)).toBeNull();
    expect(saved).toEqual([]);
  });

  it('takes the whole served run or nothing: a run that stops short is refused', async () => {
    const s2 = await successor(s1, [a1]);
    const unsigned = await successor(s2, [await newDevice('x')]);
    const started = await startHeldOrg({ files, anchor: null, saveAnchor, pins: await pinsOf(a1), first: { chain: [s1, s2, unsigned], transitions: [], certificates: NO_CERTIFICATES }, log });
    expect(started).toEqual({ ok: false, reason: 'not-root-signed' });
    expect(await files.read(CHAIN_FILE)).toBeNull();
    expect(saved).toEqual([]);
  });
});

describe('adoption', () => {
  it('adopts a successor once chain.json and the anchor are written, and only then tells its listeners', async () => {
    const held = await registered([s1]);
    const s2 = await successor(s1, [a1], (s) => void s.projects.push({ id: 'p1', name: 'one' }));
    const seen: Array<{ file: SignedOrgState | undefined; anchor: Anchor | null }> = [];
    held.onAdopted(() => void seen.push({ file: onDisk().chain.at(-1), anchor }));
    expect(await held.adoptServed(served([s1, s2]))).toEqual({ adopted: 1, rewound: false, certificatesChanged: false });
    expect(seen).toEqual([{ file: s2, anchor: await anchorOf(s1, s2) }]);
    expect(held.head()).toEqual(s2);
    expect(held.highWater()).toBe(2);
    // Nothing newer: no write, no listener.
    expect(await held.adoptServed(served([s1, s2]))).toEqual({ adopted: 0, rewound: false, certificatesChanged: false });
    expect(seen).toHaveLength(1);
  });

  it('leaves the old head and tells no one when chain.json fails to write', async () => {
    const held = await registered([s1]);
    let told = 0;
    held.onAdopted(() => void told++);
    const s2 = await successor(s1, [a1]);
    failWrites = true;
    await expect(held.advance([s2], [])).rejects.toThrow('disk fault');
    expect(held.head()).toEqual(s1);
    expect(onDisk().chain).toEqual([s1]);
    expect(told).toBe(0);
    expect(saved).toHaveLength(1);
    failWrites = false;
    await held.advance([s2], []);
    expect(held.head()).toEqual(s2);
    expect(told).toBe(1);
  });

  it('refuses a fork and a rollback, logging each, and keeps its head', async () => {
    const s2 = await successor(s1, [a1]);
    const s3 = await successor(s2, [a1]);
    const held = await registered([s1, s2, s3]);
    // A version 4 that links to another version 3.
    const other3 = await successor(s2, [a1], (s) => void s.projects.push({ id: 'p2', name: 'fork' }));
    const fork4 = await successor(other3, [a1]);
    expect(await held.adoptServed(served([s1, s2, other3, fork4]))).toMatchObject({ adopted: 0, refused: 'fork' });
    // The hub's head alone at the held version, with another hash.
    expect(await held.adoptServed({ chain: [], head: other3, transitions: [], certificates: null })).toMatchObject({ adopted: 0, refused: 'fork' });
    expect(await held.adoptServed(served([s1, s2]))).toMatchObject({ adopted: 0, refused: 'rollback' });
    expect(held.head()).toEqual(s3);
    expect(onDisk()).toMatchObject({ highWater: 3 });
    expect(onDisk().chain.at(-1)).toEqual(s3);
    expect(lines.filter((l) => /refused/.test(l)).map((l) => l.match(/fork|rollback/)?.[0])).toEqual(['fork', 'fork', 'rollback']);
  });

  it('ignores a state that follows nothing held, logging it once', async () => {
    const held = await registered([s1]);
    const s2 = await successor(s1, [a1]);
    const s3 = await successor(s2, [a1]);
    expect(await held.adoptServed(served([s3]))).toEqual({ adopted: 0, rewound: false, certificatesChanged: false });
    expect(await held.advance([s3], [])).toBeUndefined();
    expect(held.head()).toEqual(s1);
    expect(lines.filter((l) => /follows nothing held/.test(l))).toHaveLength(1);
  });

  it('applies a root transition from its head and keeps it as accepted', async () => {
    const held = await registered([s1]);
    const a2 = await newDevice('a2');
    const t = await transition(1, [a2]);
    const s2 = await successor(s1, [a2], async (s) => {
      s.members[0].devices = [a1.device, a2.device];
      s.root.keys = [await keyId(a2.stepUp.pub)];
    });
    expect(await held.adoptServed(served([s1, s2], [t]))).toMatchObject({ adopted: 1 });
    expect(held.head()).toEqual(s2);
    expect(onDisk()).toMatchObject({ accepted: [t.body], transitions: [t] });
    expect(held.since(1)).toEqual({ states: [s2], transitions: [t] });
  });

  it('takes a recovery’s rewind from a forged head: the forged states superseded, the high-water mark following, a replay refused', async () => {
    const B = memberId();
    const b1 = await newDevice('b1');
    const s2 = await successor(s1, [a1], (s) => void s.members.push({ id: B, email: 'b@example.com', role: 'member', devices: [b1.device] }));
    // The stolen admin key forges versions 3 and 4: an attacker's device for A, endorsed by the same key.
    const evil = await newDevice('evil');
    const endorsement = await endorseDevice(ORG, A, evil.device, a1.stepUp.privateKey, a1.stepUp.pub);
    const forged3 = await successor(s2, [a1], (s) => void s.members[0].devices.push({ ...evil.device, endorsement }));
    const forged4 = await successor(forged3, [a1]);
    const held = await registered([s1, s2, forged3, forged4]);
    let told = 0;
    held.onAdopted(() => void told++);
    const a2 = await newDevice('a2');
    const t = await transition(2, [a2]);
    const r3 = await recovered(s2, a2, a1);
    // The hub's head (version 3) is below the high-water mark (4), and still the recovery is taken.
    expect(await held.adoptServed(served([s1, s2, r3], [t]))).toEqual({ adopted: 1, rewound: true, certificatesChanged: false });
    expect(held.head()).toEqual(r3);
    expect(held.highWater()).toBe(3);
    expect(held.superseded()).toEqual([forged3, forged4]);
    expect(held.since(0)).toEqual({ states: [s1, s2, r3], transitions: [t] });
    expect(onDisk()).toMatchObject({ highWater: 3, accepted: [t.body], superseded: [forged3, forged4] });
    expect(anchor).toEqual(await anchorOf(s1, r3));
    expect(told).toBe(1);
    // The same transition again is a replay, after a restart too.
    expect(await held.adoptServed(served([s1, s2, r3], [t]))).toMatchObject({ adopted: 0, rewound: false });
    const again = await restarted();
    expect(again.superseded()).toEqual([forged3, forged4]);
    expect(await again.advance([r3], [t])).toBeUndefined();
    expect(again.head()).toEqual(r3);
  });

  it('refuses a transition older than its recovery once the rewind brings that transition’s version back to the head', async () => {
    const s2 = await successor(s1, [a1]);
    const s3 = await successor(s2, [a1]);
    const held = await registered([s1, s2, s3]);
    // T, genuine, hands the root to a2 at version 3; the stolen a2 then forges.
    const a2 = await newDevice('a2');
    const t = await transition(3, [a2], iso(Date.now() - 2 * DAY));
    const s4 = await successor(s3, [a2], async (s) => {
      s.members[0].devices.push(a2.device);
      s.root.keys = [await keyId(a2.stepUp.pub)];
    });
    expect(await held.advance([s4], [t])).toBeUndefined();
    expect(held.head()).toEqual(s4);
    // The owner's recovery from version 2 to a3.
    const a3 = await newDevice('a3');
    const r = await transition(2, [a3], iso(Date.now() - DAY));
    const r3 = await recovered(s2, a3, a1);
    expect(await held.adoptServed(served([r3], [r], null))).toMatchObject({ adopted: 1, rewound: true });
    // T is from version 3 again, and authentic; a successor the displaced a2 signs under it is still refused.
    const x4 = await successor(r3, [a2], async (s) => {
      s.members[0].devices.push(a2.device);
      s.root.keys = [await keyId(a2.stepUp.pub)];
    });
    expect(await held.adoptServed(served([x4], [t], null))).toMatchObject({ adopted: 0 });
    expect(held.head()).toEqual(r3);
    expect(onDisk().accepted).toEqual([r.body]);
  });

  it('rewinds only onto the base it holds: a base the delivery carries is not taken', async () => {
    const s2 = await successor(s1, [a1]);
    const forged3 = await successor(s2, [a1]);
    const held = await registered([s1, s2, forged3]);
    // A genuine recovery from version 2 binds no base: the attacker supplies one naming their own root and recovery key.
    const a2 = await newDevice('a2');
    const r = await transition(2, [a2]);
    const x = await newDevice('x');
    const xRecovery = await generateSigningKey();
    const forgedBase = await signOrgState(
      { ...structuredClone(s2.state), root: { keys: [await keyId(x.stepUp.pub)], recoveryPub: xRecovery.pub }, members: [{ id: A, email: 'owner@example.com', role: 'admin', devices: [x.device] }] },
      [x.stepUp],
    );
    const x3 = await successor(forgedBase, [x]);
    expect(await held.adoptServed(served([s1, forgedBase, x3], [r]))).toMatchObject({ adopted: 0, rewound: false });
    expect(held.head()).toEqual(forged3);
    expect(onDisk()).toMatchObject({ highWater: 3 });
  });

  it('adopts concurrent pages one after another, each against the head the one before left', async () => {
    const held = await registered([s1]);
    const s2 = await successor(s1, [a1]);
    const s3 = await successor(s2, [a1]);
    const s4 = await successor(s3, [a1]);
    let told = 0;
    held.onAdopted(() => void told++);
    await Promise.all([held.advance([s2, s3, s4], []), held.advance([s2], [])]);
    expect(held.head()).toEqual(s4);
    expect(held.since(1).states).toEqual([s2, s3, s4]);
    expect(onDisk().chain).toEqual([s1, s2, s3, s4]);
    expect(told).toBe(1);
  });

  it('replaces the held certificates with a served set that differs, with no state adopted, and tells no listener', async () => {
    const held = await registered([s1]);
    let told = 0;
    held.onAdopted(() => void told++);
    const set = { certs: [{ body: { org: ORG }, sig: { kid: 'k', sig: 's' } }], retirements: [] } as unknown as Certificates;
    expect(await held.adoptServed(served([s1], [], set))).toEqual({ adopted: 0, rewound: false, certificatesChanged: true });
    expect(held.certificates()).toEqual(set);
    expect(onDisk().certificates).toEqual(set);
    expect(await held.adoptServed(served([s1], [], set))).toMatchObject({ certificatesChanged: false });
    // A link's handshake carries none: the held set stays.
    await held.advance([await successor(s1, [a1])], []);
    expect(held.certificates()).toEqual(set);
    expect(told).toBe(1);
    expect(saved).toHaveLength(2);
    expect((await restarted()).certificates()).toEqual(set);
  });

  it('answers `since` with the states after a version and the transitions from it', async () => {
    const a2 = await newDevice('a2');
    const t = await transition(2, [a2]);
    const s2 = await successor(s1, [a1]);
    const s3 = await successor(s2, [a2], async (s) => {
      s.members[0].devices = [a1.device, a2.device];
      s.root.keys = [await keyId(a2.stepUp.pub)];
    });
    const s4 = await successor(s3, [a2]);
    const held = await registered([s1, s2, s3, s4], [t]);
    expect(held.since(0)).toEqual({ states: [s1, s2, s3, s4], transitions: [t] });
    expect(held.since(2)).toEqual({ states: [s3, s4], transitions: [t] });
    expect(held.since(3)).toEqual({ states: [s4], transitions: [] });
    expect(held.since(4)).toEqual({ states: [], transitions: [] });
  });
});

describe('the load rule', () => {
  it('loads after a recovery rewound below the state the pinned root first signed, without pinning again', async () => {
    // The pairing code's root is a2, which first signs at version 2.
    const a2 = await newDevice('a2');
    const endorsement = await endorseDevice(ORG, A, a2.device, a1.stepUp.privateKey, a1.stepUp.pub);
    const s2 = await successor(s1, [a1, a2], async (s) => {
      s.members[0].devices.push({ ...a2.device, endorsement });
      s.root.keys = [await keyId(a1.stepUp.pub), await keyId(a2.stepUp.pub)];
    });
    const s3 = await successor(s2, [a1]);
    const held = await registered([s1, s2, s3], [], a2);
    // The recovery from version 1, below version 2.
    const a3 = await newDevice('a3');
    const t = await transition(1, [a3]);
    const r2 = await recovered(s1, a3, a1);
    expect(await held.adoptServed(served([s1, r2], [t]))).toMatchObject({ adopted: 1, rewound: true });
    // The code's pins no longer reach the chain the recovery left.
    expect(await verifyPinnedChain([s1, r2], [t], await pinsOf(a2))).toEqual({ ok: false, code: 'not-root-signed' });
    // An offline restart loads it from the anchored genesis; pins passed beside an anchor are not read.
    const started = await startHeldOrg({ files, anchor, saveAnchor, pins: await pinsOf(await newDevice('stranger')), log });
    expect(started.ok).toBe(true);
    if (started.ok) {
      expect(started.held.head()).toEqual(r2);
      expect(started.held.since(0)).toEqual({ states: [s1, r2], transitions: [t] });
      expect(started.held.superseded()).toEqual([s2, s3]);
    }
  });

  it('moves the anchor up at load after a crash between chain.json and the anchor in a forward adoption', async () => {
    const held = await registered([s1]);
    const s2 = await successor(s1, [a1]);
    const s3 = await successor(s2, [a1]);
    anchorFails = true;
    await held.advance([s2, s3], []);
    expect(held.head()).toEqual(s3);
    expect(anchor).toEqual(await anchorOf(s1, s1));
    anchorFails = false;
    const again = await restarted();
    expect(again.head()).toEqual(s3);
    expect(anchor).toEqual(await anchorOf(s1, s3));
    // Loaded again with the anchor already at the head: nothing to move.
    const count = saved.length;
    await restarted();
    expect(saved).toHaveLength(count);
  });

  it('moves the anchor up at load after a crash between chain.json and the anchor in a rewind to a lower version', async () => {
    const s2 = await successor(s1, [a1]);
    const forged3 = await successor(s2, [a1]);
    const forged4 = await successor(forged3, [a1]);
    const held = await registered([s1, s2, forged3, forged4]);
    const a2 = await newDevice('a2');
    const r = await transition(2, [a2]);
    const r3 = await recovered(s2, a2, a1);
    anchorFails = true;
    expect(await held.adoptServed(served([s1, s2, r3], [r]))).toMatchObject({ adopted: 1, rewound: true });
    // The anchor still names forged4, version 4, above the held head.
    expect(anchor).toEqual(await anchorOf(s1, forged4));
    anchorFails = false;
    const again = await restarted();
    expect(again.head()).toEqual(r3);
    expect(again.superseded()).toEqual([forged3, forged4]);
    expect(anchor).toEqual(await anchorOf(s1, r3));
  });

  it('fails closed when the anchored state is neither held nor superseded by a verified rewind', async () => {
    const s2 = await successor(s1, [a1]);
    await registered([s1, s2]);
    const other2 = await successor(s1, [a1], (s) => void s.projects.push({ id: 'p', name: 'other' }));
    // An anchor on another line at version 2.
    anchor = await anchorOf(s1, other2);
    expect(await startHeldOrg({ files, anchor, saveAnchor, log })).toEqual({ ok: false, reason: 'held-chain' });
    // An anchor above the held head, superseded by nothing.
    anchor = await anchorOf(s1, await successor(s2, [a1]));
    expect(await startHeldOrg({ files, anchor, saveAnchor, log })).toEqual({ ok: false, reason: 'held-chain' });
    // A superseded anchored state counts only when the superseded states hash-chain from the rewind's base to it.
    const forged3 = await successor(s2, [a1]);
    const forged4 = await successor(forged3, [a1]);
    const a2 = await newDevice('a2');
    const r = await transition(2, [a2]);
    const r3 = await recovered(s2, a2, a1);
    const rewound = { ...onDisk(), chain: [s1, s2, r3], transitions: [r], accepted: [r.body], highWater: 3 };
    writeFileSync(join(files.dir, CHAIN_FILE), JSON.stringify({ ...rewound, superseded: [forged4] }), { mode: 0o600 });
    anchor = await anchorOf(s1, forged4);
    expect(await startHeldOrg({ files, anchor, saveAnchor, log })).toEqual({ ok: false, reason: 'held-chain' });
    writeFileSync(join(files.dir, CHAIN_FILE), JSON.stringify({ ...rewound, superseded: [forged3, forged4] }), { mode: 0o600 });
    expect((await startHeldOrg({ files, anchor, saveAnchor, log })).ok).toBe(true);
    expect(anchor).toEqual(await anchorOf(s1, r3));
    // Nor without the recovery among the transitions it was accepted from.
    writeFileSync(join(files.dir, CHAIN_FILE), JSON.stringify({ ...rewound, transitions: [], superseded: [forged3, forged4] }), { mode: 0o600 });
    anchor = await anchorOf(s1, forged4);
    expect(await startHeldOrg({ files, anchor, saveAnchor, log })).toEqual({ ok: false, reason: 'held-chain' });
  });

  it('fails closed on a chain.json whose genesis is not the anchored one, or whose states don’t verify', async () => {
    const s2 = await successor(s1, [a1]);
    await registered([s1, s2]);
    const good = anchor!;
    anchor = { ...good, genesis: await stateHash(s2.state) };
    expect(await startHeldOrg({ files, anchor, saveAnchor, log })).toEqual({ ok: false, reason: 'held-chain' });
    anchor = good;
    const tampered = structuredClone(s2);
    tampered.state.projects.push({ id: 'p', name: 'tampered' });
    writeFileSync(join(files.dir, CHAIN_FILE), JSON.stringify({ ...onDisk(), chain: [s1, tampered] }), { mode: 0o600 });
    expect(await startHeldOrg({ files, anchor, saveAnchor, log })).toEqual({ ok: false, reason: 'held-chain' });
    expect(lines.some((l) => /fails the load rule/.test(l))).toBe(true);
  });
});

describe('a damaged chain.json', () => {
  /** Registered at s1, s2 (B joins), then s3 removing B adopted: the anchor at version 3. */
  async function afterRemoval() {
    const B = memberId();
    const b1 = await newDevice('b1');
    const s2 = await successor(s1, [a1], (s) => void s.members.push({ id: B, email: 'b@example.com', role: 'member', devices: [b1.device] }));
    const held = await registered([s1, s2]);
    const s3 = await successor(s2, [a1], async (s) => {
      s.members[1].devices = [];
      s.revoked.push(...(await revokedDevice(B, b1.device)));
    });
    await held.advance([s3], []);
    expect(anchor).toEqual(await anchorOf(s1, s3));
    writeFileSync(join(files.dir, CHAIN_FILE), '{"version": 1, "chain": [', { mode: 0o600 });
    expect(await startHeldOrg({ files, anchor, saveAnchor, log })).toEqual({ ok: false, reason: 'held-chain' });
    return { s2, s3 };
  }

  const fromHub = (chain: SignedOrgState[], transitions: Signed<RootTransition>[] = []) =>
    startHeldOrg({ files, anchor, saveAnchor, first: { chain, transitions, certificates: NO_CERTIFICATES }, log });

  it('stays closed when the hub serves an authentic chain from before a removal the app had adopted', async () => {
    const { s2 } = await afterRemoval();
    expect(await fromHub([s1, s2])).toEqual({ ok: false, reason: 'held-chain' });
    expect(saved.at(-1)!.version).toBe(3);
  });

  it('loads when the hub serves a chain holding the anchored state, and moves the anchor to its head', async () => {
    const { s2, s3 } = await afterRemoval();
    const s4 = await successor(s3, [a1]);
    const started = await fromHub([s1, s2, s3, s4]);
    expect(started.ok).toBe(true);
    if (started.ok) {
      expect(started.held.head()).toEqual(s4);
      expect(started.held.superseded()).toEqual([]);
    }
    expect(anchor).toEqual(await anchorOf(s1, s4));
    expect(onDisk()).toMatchObject({ highWater: 4, superseded: [], accepted: [] });
    // And it loads from the file from then on.
    expect((await restarted()).head()).toEqual(s4);
  });

  it('stays closed when the hub serves a chain an old, genuine recovery rewound below the anchor', async () => {
    const { s2 } = await afterRemoval();
    // A recovery from version 1, genuine and issued long ago; under it the removed member's device is back.
    const a2 = await newDevice('a2');
    const old = await transition(1, [a2], iso(Date.now() - 5 * DAY));
    const x2 = await recovered(s1, a2, a1);
    const x3 = await successor(x2, [a2], (s) => void s.members.push(...s2.state.members.slice(1)));
    const x4 = await successor(x3, [a2]);
    expect(await fromHub([s1, x2, x3, x4], [old])).toEqual({ ok: false, reason: 'held-chain' });
    expect(anchor!.version).toBe(3);
  });
});
