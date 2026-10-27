// The org state a Project verifies v2 log events against (O11 M5; RL8), apart from any Durable Object: a head cached
// from the Registry, refreshed on each announcement, on an unknown signer at most once a second, and when it is older
// than a minute at the moment it is needed; and a v2 event never accepted without a state, nor against one known old.
import { generateSigningKey, NO_CERTIFICATES, signEvent, type OrgState, type SigningKey } from 'org-protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { SignedEvents, STATE_MAX_AGE_MS } from '../src/objects/signed-events';
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

/** The Registry as the cache meets it: a head that can move, a reachability switch, and a count of reads. */
class FakeRegistry {
  head: OrgState | null = null;
  reachable = true;
  reads = 0;
  read = async (): Promise<OrgStateView> => {
    this.reads++;
    if (!this.reachable) throw new Error('the Registry is unreachable');
    return { head: this.head && { state: this.head, sigs: [] }, transitions: [], certificates: NO_CERTIFICATES };
  };
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
  events = new SignedEvents(registry.read, () => clock);
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

