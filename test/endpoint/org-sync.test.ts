// The endpoint's org state (O10 M2): the first sync anchored to the enrollment's pins, successors verified against the
// head and adopted only once on disk, forks and rollbacks refused, root transitions and a recovery's rewind applied,
// the 30-day backstop, and the chain window the endpoint's `h2` pages a device's catch-up from.
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { endorseDevice, generateSigningKey, keyId, NO_CERTIFICATES, stateHash, type RootTransition, type Signed, type SignedOrgState, type SigningKey } from 'org-protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EndpointOrg, type OrgChange, type OrgStateView } from '../../src/endpoint/org-sync';
import { EndpointState } from '../../src/endpoint/state/store';
import { genesis, iso, memberId, newDevice, retiredDevice, revokedDevice, successor, transition, type TestDevice } from './org-fixtures';

const beforeRename = vi.hoisted(() => ({ hook: null as null | ((to: string) => void) }));
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  const renameSync: typeof real.renameSync = (from, to) => {
    const hook = beforeRename.hook;
    beforeRename.hook = null;
    hook?.(String(to));
    real.renameSync(from, to);
  };
  return { ...real, default: { ...real, renameSync }, renameSync };
});

const ORG = 'org-sync';
const DAY = 86_400_000;
let root: string;
let lines: string[];
let A: string;
let a1: TestDevice;
let recovery: SigningKey;
let s1: SignedOrgState;

beforeEach(async () => {
  root = fs.mkdtempSync(join(tmpdir(), 'endpoint-org-'));
  lines = [];
  A = memberId();
  a1 = await newDevice('a1');
  recovery = await generateSigningKey();
  s1 = await genesis(ORG, A, a1, recovery);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

/** An endpoint state enrolled into ORG with the pins a code from `pinned` names, and its org view. */
async function enrolled(pinned: TestDevice = a1, now = () => Date.now()) {
  const state = EndpointState.open(join(root, 'endpoint'), { log: (l) => lines.push(l) });
  if (state.org === null) {
    state.setOrg({ version: 1, org: ORG, pinned: { roots: [await keyId(pinned.stepUp.pub)], recoveryPub: recovery.pub }, head: null, certificates: NO_CERTIFICATES, acceptedTransitions: [], highWater: 0 });
  }
  const org = new EndpointOrg(state, { log: (l) => lines.push(l), now });
  const changes: OrgChange[] = [];
  org.onAdopted((change) => void changes.push(change));
  return { state, org, changes };
}

/** A hub serving `chain` (oldest first) and `transitions`, a page of `page` states at a time. */
function hub(chain: SignedOrgState[], transitions: Signed<RootTransition>[] = [], page = 100) {
  return async (since: number): Promise<OrgStateView> => {
    const after = chain.filter((s) => s.state.version > since);
    return { head: chain.at(-1) ?? null, transitions, certificates: NO_CERTIFICATES, chain: after.slice(0, page), more: after.length > page };
  };
}

const onDisk = () => JSON.parse(fs.readFileSync(join(root, 'endpoint', 'org.json'), 'utf8')) as { head: SignedOrgState | null; highWater: number; acceptedTransitions: unknown[] };

describe('the first sync', () => {
  it('adopts the chain from its genesis, a page at a time, when a pinned root signed it', async () => {
    const s2 = await successor(s1, [a1]);
    const s3 = await successor(s2, [a1]);
    const { org, changes } = await enrolled();
    expect(await org.sync(hub([s1, s2, s3], [], 1))).toMatchObject({ adopted: 3 });
    expect(org.head()).toEqual(s3);
    expect(onDisk()).toMatchObject({ head: s3, highWater: 3 });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ previous: null, head: s3 });
    // The view kept what the endpoint's h2 pages from, across a restart too.
    const again = await enrolled();
    expect(again.org.since(1).states).toEqual([s2, s3]);
  });

  it('refuses an org no pinned root key signed, and adopts nothing', async () => {
    const stranger = await newDevice('x1');
    const { org, changes } = await enrolled(stranger);
    expect(await org.sync(hub([s1]))).toMatchObject({ adopted: 0, refused: 'not-root-signed' });
    expect(org.ready).toBe(false);
    expect(onDisk().head).toBeNull();
    expect(changes).toEqual([]);
    expect(lines.join('\n')).toContain('not-root-signed');
  });
});

describe('a synced endpoint', () => {
  it('adopts a successor once it is on disk', async () => {
    const { org, changes } = await enrolled();
    await org.sync(hub([s1]));
    const s2 = await successor(s1, [a1], (s) => void s.projects.push({ id: 'p1', name: 'one' }));
    let seen: SignedOrgState | null = null;
    org.onAdopted(() => void (seen = onDisk().head));
    expect(await org.sync(hub([s1, s2]))).toMatchObject({ adopted: 1 });
    expect(seen).toEqual(s2);
    expect(changes.at(-1)).toMatchObject({ previous: s1, head: s2, rewound: false });
  });

  it('refuses a fork at the next version and a rollback below the high-water mark, logging each', async () => {
    const { org } = await enrolled();
    const s2 = await successor(s1, [a1]);
    const s3 = await successor(s2, [a1]);
    await org.sync(hub([s1, s2, s3]));
    // A state at version 4 that links to another version 3.
    const other3 = await successor(s2, [a1], (s) => void s.projects.push({ id: 'p2', name: 'fork' }));
    const fork4 = await successor(other3, [a1]);
    expect(await org.sync(hub([s1, s2, other3, fork4]))).toMatchObject({ adopted: 0, refused: 'fork' });
    expect(await org.sync(hub([s1, s2]))).toMatchObject({ adopted: 0, refused: 'rollback' });
    expect(org.head()).toEqual(s3);
    expect(onDisk()).toMatchObject({ head: s3, highWater: 3 });
    expect(lines.filter((l) => /refused/.test(l)).map((l) => l.match(/fork|rollback/)?.[0])).toEqual(['fork', 'rollback']);
  });

  it('applies a root transition from its head and keeps it as accepted', async () => {
    const { org } = await enrolled();
    await org.sync(hub([s1]));
    const a2 = await newDevice('a2');
    const t = await transition(ORG, 1, [a2], recovery);
    const s2 = await successor(s1, [a2], async (s) => {
      s.members[0].devices = [a1.device, a2.device];
      s.root.keys = [await keyId(a2.stepUp.pub)];
    });
    expect(await org.sync(hub([s1, s2], [t]))).toMatchObject({ adopted: 1 });
    expect(org.head()).toEqual(s2);
    expect(onDisk().acceptedTransitions).toEqual([t.body]);
    expect(org.since(1).transitions).toEqual([t]);
  });

  it('takes a recovery’s rewind from a forged head, drops the states after it, and reports what the rewind removed', async () => {
    const { org, changes } = await enrolled();
    const B = memberId();
    const b1 = await newDevice('b1');
    const s2 = await successor(s1, [a1], (s) => void s.members.push({ id: B, email: 'b@example.com', role: 'member', devices: [b1.device] }));
    // The stolen admin key forges version 3: an attacker's device for A, endorsed by the same stolen key.
    const evil = await newDevice('evil');
    const endorsement = await endorseDevice(ORG, A, evil.device, a1.stepUp.privateKey, a1.stepUp.pub);
    const forged3 = await successor(s2, [a1], (s) => void s.members[0].devices.push({ ...evil.device, endorsement }));
    await org.sync(hub([s1, s2, forged3]));
    expect(org.head()).toEqual(forged3);
    // The owner's recovery: a new root a2 from version 2, the stolen a1 revoked.
    const a2 = await newDevice('a2');
    const t = await transition(ORG, 2, [a2], recovery);
    const recovered3 = await successor(s2, [a2], async (s) => {
      s.members[0].devices = [a2.device];
      s.root.keys = [await keyId(a2.stepUp.pub)];
      s.revoked.push(...(await revokedDevice(A, a1.device)));
    });
    expect(await org.adopt([recovered3], [t])).toMatchObject({ adopted: 1, rewound: true });
    expect(org.head()).toEqual(recovered3);
    expect(onDisk()).toMatchObject({ head: recovered3, highWater: 3, acceptedTransitions: [t.body] });
    expect(org.since(0).states).toEqual([s1, s2, recovered3]);
    expect(changes.at(-1)).toMatchObject({ previous: forged3, head: recovered3, rewound: true });
    expect(changes.at(-1)!.removed.devices).toEqual([{ member: A, device: 'a1' }, { member: A, device: 'evil' }]);
    expect(changes.at(-1)!.removed.keys).toEqual(expect.arrayContaining([await keyId(a1.stepUp.pub), await keyId(a1.channel.pub)]));
    // The same transition again is a replay: nothing moves.
    expect(await org.adopt([recovered3], [t])).toMatchObject({ adopted: 0, rewound: false });
  });

  it('applies a revocation only after it is on disk: a fault before the rename leaves the old head and tells no one', async () => {
    const { org, changes } = await enrolled();
    const B = memberId();
    const b1 = await newDevice('b1');
    const s2 = await successor(s1, [a1], (s) => void s.members.push({ id: B, email: 'b@example.com', role: 'member', devices: [b1.device] }));
    await org.sync(hub([s1, s2]));
    const s3 = await successor(s2, [a1], async (s) => {
      s.members[1].devices = [];
      s.revoked.push(...(await revokedDevice(B, b1.device)));
    });
    const before = changes.length;
    // The chain is written before the head; the fault hits the head's rename.
    let renames = 0;
    beforeRename.hook = function fault(to) {
      renames++;
      if (!to.endsWith('org.json')) {
        beforeRename.hook = fault;
        return;
      }
      throw new Error('disk fault');
    };
    await expect(org.adopt([s3], [])).rejects.toThrow('disk fault');
    expect(renames).toBeGreaterThan(0);
    expect(org.head()).toEqual(s2);
    expect(onDisk().head).toEqual(s2);
    expect(changes).toHaveLength(before);
    expect(await org.adopt([s3], [])).toMatchObject({ adopted: 1 });
    expect(changes.at(-1)!.removed).toMatchObject({ devices: [{ member: B, device: 'b1' }] });
  });

  it('stops remote actions while its head is more than 30 days old, until a newer state arrives', async () => {
    let now = Date.now();
    const old = await genesis(ORG, A, a1, recovery, iso(now - 31 * DAY));
    const { org } = await enrolled(a1, () => now);
    await org.sync(hub([old]));
    expect(org.actionsRefusal()).toBe('state-too-old');
    now += 1000;
    await org.sync(hub([old, await successor(old, [a1], () => {}, iso(now))]));
    expect(org.actionsRefusal()).toBeNull();
  });

  it('keeps the states issued in the last 30 days, and its head always', async () => {
    const now = Date.now();
    const v1 = await genesis(ORG, A, a1, recovery, iso(now - 40 * DAY));
    const v2 = await successor(v1, [a1], () => {}, iso(now - 35 * DAY));
    const { org, state } = await enrolled(a1, () => now);
    await org.sync(hub([v1, v2]));
    expect(org.since(0).states).toEqual([v2]);
    const v3 = await successor(v2, [a1], () => {}, iso(now - DAY));
    await org.sync(hub([v1, v2, v3]));
    expect(org.since(0).states).toEqual([v3]);
    expect(state.chain).toEqual([{ state: v3 }]);
  });

  it('adopts concurrent pages one after another, each against the head the one before left', async () => {
    const { org } = await enrolled();
    await org.sync(hub([s1]));
    const s2 = await successor(s1, [a1]);
    const s3 = await successor(s2, [a1]);
    const s4 = await successor(s3, [a1]);
    await Promise.all([org.advance([s2, s3, s4], []), org.advance([s2], [])]);
    expect(org.head()).toEqual(s4);
    expect(org.since(1).states.map((s) => s.state.version)).toEqual([2, 3, 4]);
    expect(onDisk().head).toEqual(s4);
    expect(await stateHash(org.head().state)).toBe(await stateHash(s4.state));
  });

  it('records a retired key as removed only when it leaves as revoked', async () => {
    const { org, changes } = await enrolled();
    const a2 = await newDevice('a2');
    await org.sync(hub([s1]));
    // a2 is new to a member who had devices: a1 endorses it.
    const endorsement = await endorseDevice(ORG, A, a2.device, a1.stepUp.privateKey, a1.stepUp.pub);
    const s2e = await successor(s1, [a1], (s) => void (s.members[0].devices = [a1.device, { ...a2.device, endorsement }]));
    await org.sync(hub([s1, s2e]));
    const s3 = await successor(s2e, [a1], async (s) => {
      s.members[0].devices = [a1.device];
      s.retired.push(...(await retiredDevice(A, a2.device, s.issued)));
    });
    await org.sync(hub([s1, s2e, s3]));
    expect(changes.at(-1)!.removed).toEqual({ members: [], devices: [{ member: A, device: 'a2' }], keys: [] });
  });
});
