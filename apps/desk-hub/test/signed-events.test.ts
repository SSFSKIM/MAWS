// The org state a Project verifies v2 log events against (O11 M5; RL8), apart from any Durable Object: a head cached
// from the Registry, refreshed on each announcement, on an unknown signer at most once a second, and when it is older
// than a minute at the moment it is needed; and a v2 event never accepted without a state, nor against one known old.
import { generateSigningKey, NO_CERTIFICATES, signEvent, type Certificates, type OrgState, type SigningKey } from 'org-protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { certify, mintRef, retirement, type DelegationKey } from '../fake-machine/org';
import { SignedEvents, STATE_MAX_AGE_MS, UNKNOWN_SIGNER_READ_MS } from '../src/objects/signed-events';
import type { OrgStateView } from '../src/protocol/identity';
import { genesis, memberId, newDevice, next, revokedDevice, type TestDevice } from './support/org';

const ORG = 'org-unit';
const PROJECT = '6f1c0a8e-3b2d-4c5e-9f70-000000000001';
const CTX = { org: ORG, project: PROJECT };

let member: string;
let d1: TestDevice;
let d2: TestDevice;
let recovery: SigningKey;
let v1: OrgState;

/**
 * The Registry as the cache meets it: a head that can move, a reachability switch, a count of reads, and reads that can
 * be held: a held read answers the head as it was when the read arrived, once released (or never, if never released).
 */
class FakeRegistry {
  head: OrgState | null = null;
  certificates: Certificates = NO_CERTIFICATES;
  reachable = true;
  reads = 0;
  private holding = false;
  private released: Array<() => void> = [];
  read = async (): Promise<OrgStateView> => {
    this.reads++;
    if (!this.reachable) throw new Error('the Registry is unreachable');
    const view = { head: this.head && { state: this.head, sigs: [] }, transitions: [], certificates: this.certificates };
    if (this.holding) await new Promise<void>((resolve) => this.released.push(resolve));
    return view;
  };
  hold() {
    this.holding = true;
  }
  release() {
    this.holding = false;
    for (const resolve of this.released.splice(0)) resolve();
  }
}

let registry: FakeRegistry;
let clock: number;
let events: SignedEvents;

beforeEach(async () => {
  member = memberId();
  d1 = await newDevice('d1');
  d2 = await newDevice('d2');
  recovery = await generateSigningKey();
  v1 = await genesis(ORG, member, 'm@example.com', d1, recovery);
  v1.members[0].devices.push(d2.device);
  registry = new FakeRegistry();
  registry.head = v1;
  clock = Date.parse('2026-10-27T06:00:00.000Z');
  events = new SignedEvents(registry.read, () => clock, () => 50);
});

/** A device's v2 `human`, positioned as the hub positions it. */
async function words(device: TestDevice, text = 'hello', seq = 1) {
  const draft = { kind: 'human', from: 'human', member, to: '*', text, created: new Date(clock).toISOString(), nonce: 'AAAAAAAAAAAAAAAAAAAAAA' };
  const signed = await signEvent(CTX, draft, device.channel.privateKey, device.channel.pub);
  return { ...signed, writer: `hub/${member}`, seq, ts: new Date(clock).toISOString() };
}

/** v1 with `device` gone from its member and its keys revoked. */
async function without(device: TestDevice): Promise<OrgState> {
  const revoked = await revokedDevice(member, device.device);
  return next(v1, (s) => {
    s.members[0].devices = s.members[0].devices.filter((d) => d.id !== device.device.id);
    s.revoked.push(...revoked);
  });
}

describe('checking a v2 event', () => {
  it("accepts an event signed by a key the state lists for its writer, reading the head once", async () => {
    expect(await events.check(CTX, await words(d1))).toEqual({ ok: true });
    expect(await events.check(CTX, await words(d2))).toEqual({ ok: true });
    expect(registry.reads).toBe(1);
  });

  it('refuses bad-signature an event whose signature fails, naming the package verdict', async () => {
    const event = await words(d1);
    const touched = { ...event, text: 'not what was signed' };
    expect(await events.check(CTX, touched)).toMatchObject({ ok: false, reason: 'bad-signature', message: expect.stringContaining('bad-signature') });
  });

  it('refuses bad-signature an event signed by a key the state does not list for its writer', async () => {
    const stranger = await newDevice('stranger');
    expect(await events.check(CTX, await words(stranger))).toMatchObject({ ok: false, reason: 'bad-signature', message: expect.stringContaining('unknown-signer') });
  });

  it('refuses bad-signature every v2 event while no org state exists', async () => {
    registry.head = null;
    expect(await events.check(CTX, await words(d1))).toMatchObject({ ok: false, reason: 'bad-signature' });
  });

  it('refuses state-unavailable when the Registry cannot be read and nothing is cached', async () => {
    registry.reachable = false;
    expect(await events.check(CTX, await words(d1))).toMatchObject({ ok: false, reason: 'state-unavailable' });
  });
});

describe('the cached head', () => {
  it('is used for a minute and read again once it is older, so a missed announcement costs at most that', async () => {
    const removed = await without(d2);
    expect(await events.check(CTX, await words(d1))).toEqual({ ok: true });
    registry.head = removed; // the announcement is lost
    clock += STATE_MAX_AGE_MS;
    expect(await events.check(CTX, await words(d2))).toEqual({ ok: true });
    expect(registry.reads).toBe(1);
    clock += 1;
    expect(await events.check(CTX, await words(d2))).toMatchObject({ ok: false, reason: 'bad-signature', message: expect.stringContaining('revoked') });
    expect(registry.reads).toBe(2);
  });

  it('is read again on an announcement of a newer version, and not on one it already holds', async () => {
    expect(await events.check(CTX, await words(d2))).toEqual({ ok: true });
    await events.advanced(1);
    expect(registry.reads).toBe(1);
    registry.head = await without(d2);
    await events.advanced(2);
    expect(registry.reads).toBe(2);
    // A revoked key reads `revoked`, never `unknown-signer`: no further read is taken for it.
    expect(await events.check(CTX, await words(d2))).toMatchObject({ ok: false, reason: 'bad-signature', message: expect.stringContaining('revoked') });
    expect(registry.reads).toBe(2);
  });

  it('is never used once an announcement says it is old: unreadable, the event is refused state-unavailable', async () => {
    expect(await events.check(CTX, await words(d2))).toEqual({ ok: true });
    registry.head = await without(d2);
    registry.reachable = false;
    await events.advanced(2);
    expect(await events.check(CTX, await words(d1))).toMatchObject({ ok: false, reason: 'state-unavailable' });
    registry.reachable = true;
    expect(await events.check(CTX, await words(d2))).toMatchObject({ ok: false, reason: 'bad-signature' });
  });

  it('older than a minute and unreadable refuses state-unavailable, never verifying against it', async () => {
    expect(await events.check(CTX, await words(d1))).toEqual({ ok: true });
    registry.reachable = false;
    clock += STATE_MAX_AGE_MS + 1;
    expect(await events.check(CTX, await words(d1))).toMatchObject({ ok: false, reason: 'state-unavailable' });
  });

  it('is read again for an unknown signer, at most once a second', async () => {
    expect(await events.check(CTX, await words(d1))).toEqual({ ok: true });
    const d3 = await newDevice('d3');
    registry.head = await next(v1, (s) => s.members[0].devices.push(d3.device)); // announced late, or not yet
    clock += 500;
    expect(await events.check(CTX, await words(d3))).toMatchObject({ ok: false, message: expect.stringContaining('unknown-signer') });
    expect(registry.reads).toBe(1);
    clock += 500;
    expect(await events.check(CTX, await words(d3))).toEqual({ ok: true });
    expect(registry.reads).toBe(2);
    const stranger = await newDevice('stranger');
    expect(await events.check(CTX, await words(stranger))).toMatchObject({ ok: false });
    expect(registry.reads).toBe(2);
  });

  it('is shared by concurrent checks: one read for many', async () => {
    const batch = await Promise.all([1, 2, 3, 4].map((n) => words(d1, `n${n}`, n)));
    expect(await Promise.all(batch.map((e) => events.check(CTX, e)))).toEqual(batch.map(() => ({ ok: true })));
    expect(registry.reads).toBe(1);
  });
});

describe('a head read', () => {
  it('for an unknown signer that answers below an announcement made meanwhile is read again, never trusted', async () => {
    expect(await events.check(CTX, await words(d1))).toEqual({ ok: true });
    const d3 = await newDevice('d3');
    const v2 = await next(v1, (s) => s.members[0].devices.push(d3.device));
    const revoked = await revokedDevice(member, d3.device);
    const v3 = await next(v2, (s) => {
      s.members[0].devices = s.members[0].devices.filter((d) => d.id !== d3.device.id);
      s.revoked.push(...revoked);
    });
    clock += UNKNOWN_SIGNER_READ_MS;
    registry.head = v2;
    registry.hold(); // the unknown signer's read is sent while v2 is the head
    const checked = events.check(CTX, await words(d3));
    await new Promise((resolve) => setTimeout(resolve, 5));
    registry.head = v3;
    const announced = events.advanced(3); // v3 is accepted and announced while that read is out
    registry.release();
    await announced;
    expect(await checked).toMatchObject({ ok: false, reason: 'bad-signature', message: expect.stringContaining('revoked') });
  });

  it('for an unknown signer that cannot complete refuses state-unavailable, not bad-signature', async () => {
    expect(await events.check(CTX, await words(d1))).toEqual({ ok: true });
    const d3 = await newDevice('d3');
    registry.head = await next(v1, (s) => s.members[0].devices.push(d3.device));
    clock += UNKNOWN_SIGNER_READ_MS;
    registry.hold(); // the re-read stalls past the bound
    expect(await events.check(CTX, await words(d3))).toEqual({ ok: false, reason: 'state-unavailable', message: expect.any(String) });
    registry.reachable = false; // or fails outright
    registry.release();
    clock += UNKNOWN_SIGNER_READ_MS;
    expect(await events.check(CTX, await words(d3))).toMatchObject({ ok: false, reason: 'state-unavailable' });
    // A head read that completes and still lacks the signer refuses the signature.
    registry.reachable = true;
    registry.head = v1;
    clock += UNKNOWN_SIGNER_READ_MS;
    expect(await events.check(CTX, await words(d3))).toMatchObject({ ok: false, reason: 'bad-signature', message: expect.stringContaining('unknown-signer') });
  });

  it('that stalls fails closed within the bound, and the next check reads again', async () => {
    expect(await events.check(CTX, await words(d1))).toEqual({ ok: true });
    clock += STATE_MAX_AGE_MS + 1;
    registry.hold(); // never released while the check waits
    expect(await events.check(CTX, await words(d1))).toMatchObject({ ok: false, reason: 'state-unavailable' });
    expect(registry.reads).toBe(2);
    registry.release();
    expect(await events.check(CTX, await words(d1))).toEqual({ ok: true });
    expect(registry.reads).toBe(3);
  });
});

describe('a batch', () => {
  it('is judged against one head: an event checked before a later read brought in its key’s revocation is checked again', async () => {
    expect(await events.check(CTX, await words(d1))).toEqual({ ok: true }); // v1 held: d2 current
    const d3 = await newDevice('d3');
    const revoked = await revokedDevice(member, d2.device);
    registry.head = await next(v1, (s) => {
      s.members[0].devices = [d1.device, d3.device];
      s.revoked.push(...revoked);
    });
    clock += UNKNOWN_SIGNER_READ_MS; // d3's unknown signer may read the head again
    const checks = await events.checkAll(CTX, [await words(d2, 'by d2', 1), await words(d3, 'by d3', 2)]);
    expect(checks).toEqual([{ ok: false, reason: 'bad-signature', message: expect.stringContaining('revoked') }, { ok: true }]);
  });

  it('is judged against one certificate set: an event checked before a read at the same version retired its key is checked again', async () => {
    const delegation: DelegationKey = { id: 'd'.repeat(32), key: await generateSigningKey() };
    const vm = { org: ORG, ref: mintRef(delegation.id), name: 'vm-1', key: await generateSigningKey(), use: 1 };
    registry.head = v1 = await next(v1, (s) =>
      s.delegations.push({ id: delegation.id, pub: delegation.key.pub, prefix: 'vm-', expires: '2027-10-27T00:00:00.000Z', maxUses: 10, offlineRevokeS: 0, owners: 'org' }),
    );
    registry.certificates = { certs: [await certify(vm, delegation)], retirements: [] };
    const said = async (seq: number) => {
      const at = new Date(clock).toISOString();
      const draft = { ts: at, created: at, writer: `vm-1/${PROJECT}`, seq, kind: 'say', from: 'vm-1', to: '*', text: `say ${seq}` };
      return signEvent(CTX, draft, vm.key.privateKey, vm.key.pub);
    };
    expect(await events.check(CTX, await said(1))).toEqual({ ok: true }); // the certificate held, not yet retired
    // Retired at a moment before the next event's signed time, with the state's version unchanged.
    const cutoff = new Date(clock).toISOString();
    clock += UNKNOWN_SIGNER_READ_MS;
    registry.certificates = { ...registry.certificates, retirements: [await retirement(ORG, vm.key, delegation, cutoff)] };
    const checks = await events.checkAll(CTX, [await said(2), await words(await newDevice('d3'), 'by d3', 3)]);
    expect(checks[0]).toEqual({ ok: false, reason: 'bad-signature', message: expect.stringContaining('expired') });
    expect(checks[1]).toMatchObject({ ok: false, reason: 'bad-signature', message: expect.stringContaining('unknown-signer') });
  });

  it('checked while an announcement outruns its head is checked again against the announced one', async () => {
    expect(await events.check(CTX, await words(d1))).toEqual({ ok: true });
    registry.head = await without(d2);
    const batch = events.checkAll(CTX, [await words(d2, 'one', 1), await words(d2, 'two', 2)]);
    void events.advanced(2); // arrives while the batch is being checked
    expect(await batch).toEqual([
      { ok: false, reason: 'bad-signature', message: expect.stringContaining('revoked') },
      { ok: false, reason: 'bad-signature', message: expect.stringContaining('revoked') },
    ]);
  });
});

