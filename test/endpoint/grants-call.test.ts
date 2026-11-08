// `endpoint.grants` and the local door's grant (P5 O8 M4b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4b
// "Touches" and Interfaces §R; the architect's Fork A), through a real RL2 channel to a started, enrolled endpoint and
// through its local door: the machine's grant ledger as each caller may read it, judged as the answer goes, and a signed
// grant taken at the door on its own signature.
//
// The org (sub-harness.ts): A, the admin, owns the machine (a1); B (b1) and C (c1, a web-cards device) are members.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { endorseDevice, keyId, signRecord, SIGNING_DOMAINS, type Action, type Grant, type OrgState, type Signed } from 'org-protocol';
import { GRANTS_READS, grantsAnswer, grantsView } from '../../src/endpoint/grants';
import { OFFERS } from '../../src/endpoint/offers';
import { iso, memberId, newDevice, revokedDevice, successor, type TestDevice } from './org-fixtures';
import { makeOrg, openRemote, ORG, sleep, startEndpoint, stopAll, until, type Fixture, type Org, type Remote, type StartOptions } from './sub-harness';

/**
 * Reads of the machine's owners (grants.ts' `machineOwnerMembers`) held open: after the next `pass` (a remote call's own
 * admission, which the gate reads once), the next `armed` wait for the suite's release.
 */
const ownersHold = vi.hoisted(() => ({ pass: 0, armed: 0, held: [] as Array<() => void> }));
vi.mock('../../src/endpoint/grants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/endpoint/grants')>();
  return {
    ...actual,
    machineOwnerMembers: async (...args: Parameters<typeof actual.machineOwnerMembers>) => {
      const read = actual.machineOwnerMembers(...args);
      if (ownersHold.pass > 0) {
        ownersHold.pass -= 1;
        return read;
      }
      if (ownersHold.armed === 0) return read;
      ownersHold.armed -= 1;
      await new Promise<void>((release) => ownersHold.held.push(release));
      return read;
    },
  };
});
const releaseOwners = () => ownersHold.held.splice(0).forEach((release) => release());

let org: Org;
const started: Fixture[] = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(async () => {
  ownersHold.pass = 0;
  ownersHold.armed = 0;
  releaseOwners();
  await stopAll(started);
});
afterAll(() => stopAll(started));

const machine = (options: StartOptions = {}) => startEndpoint(org, started, options);

/** A successor of the head, signed by `signers` (a1), delivered to the endpoint and adopted. */
async function deliver(f: Fixture, edit: (s: OrgState) => void | Promise<void>, signers: TestDevice[] = [org.a1]): Promise<void> {
  const next = await successor(f.chain.at(-1)!, signers, edit);
  const delivered = await f.endpoint.cli('revoke', ['-'], JSON.stringify(next));
  expect(delivered.code, delivered.out).toBe(0);
  f.chain.push(next);
}

/** A grant of `rights` on the machine to `member`, signed by `by`'s step-up key. */
async function signed(f: Fixture, member: string, edit: Partial<Grant> = {}, by: TestDevice = org.a1): Promise<Signed<Grant>> {
  const body: Grant = { org: ORG, machine: f.ref, machineKey: await keyId(f.key.pub), member, rights: ['spawn'], version: 1, issued: iso(Date.now()), ...edit };
  return signRecord(SIGNING_DOMAINS.grant, body, by.stepUp.privateKey, by.stepUp.pub);
}

/** `grant` kept by the ledger, out of band (`mawsd endpoint grant`, the same intake as `endpoint.grant`). */
async function keep(f: Fixture, grant: Signed<Grant>): Promise<void> {
  const out = await f.endpoint.cli('grant', ['-'], JSON.stringify(grant));
  expect(out.code, out.out).toBe(0);
}

/** A call's `result`, sent at once; its id. */
async function ask(r: Remote, name: string, input: unknown): Promise<string> {
  const id = `c-${Math.random().toString(36).slice(2)}`;
  await r.channel.send({ t: 'call', id, name, input });
  return id;
}
const resultOf = (r: Remote, id: string) => r.inbox.find((m) => m.t === 'result' && (m as { id?: string }).id === id) as Record<string, unknown> | undefined;
async function call(r: Remote, name: string, input: unknown): Promise<Record<string, unknown>> {
  const id = await ask(r, name, input);
  return until(() => resultOf(r, id), `the result of ${name}`);
}

/** `endpoint.grants`' answer to `r`, which must be one. */
async function grantsOf(r: Remote): Promise<unknown> {
  const result = await call(r, 'endpoint.grants', null);
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  return result.output;
}

/** B leaves the org: their member entry gone, b1's keys revoked. */
const removeB = (f: Fixture) =>
  deliver(f, async (s) => {
    s.members = s.members.filter((m) => m.id !== org.B);
    s.revoked.push(...(await revokedDevice(org.B, org.b1.device)));
  });

const entry = (member: string, grant: Signed<Grant> | null = null, highWater = grant?.body.version ?? 0) => ({ member, grant, highWater });

describe('the offer', () => {
  it('is a `list` call on the machine the endpoint answers, with no sminos gate, taking no input', () => {
    const row = OFFERS.commands['endpoint.grants'];
    expect(row).toMatchObject({ kind: 'call', executor: 'endpoint', target: 'machine', grade: 'list' });
    expect(row).not.toHaveProperty('sminos');
    expect(row.accepts!(null)).toBe(true);
    expect(row.accepts!(undefined)).toBe(true);
    expect(row.accepts!({}), 'an empty object is still input').toBe(false);
    expect(row.accepts!({ member: 'x' })).toBe(false);
  });
});

describe('endpoint.grants', () => {
  it('1. an owner of the machine sees every member, in the head’s order, a grantless one included, with no sminos connected', async () => {
    const f = await machine();
    const forB = await signed(f, org.B, { rights: ['spawn', 'shell'], version: 4 });
    await keep(f, forB);
    const a = await openRemote(f, org.a1, org.A);
    expect(f.endpoint.rl10.sminosCapabilities(), 'no sminos').toBeNull();
    expect(f.chain.at(-1)!.state.members.map((m) => m.id), 'the head’s order').toEqual([org.A, org.B, org.C]);
    expect(await grantsOf(a)).toEqual({ members: [entry(org.A), entry(org.B, forB), entry(org.C)] });
  });

  it('2. a non-owner sees their own entry only, as the ledger holds it', async () => {
    const f = await machine();
    const forB = await signed(f, org.B);
    await keep(f, forB);
    await keep(f, await signed(f, org.C));
    const b = await openRemote(f, org.b1, org.B);
    expect(await grantsOf(b)).toEqual({ members: [entry(org.B, forB)] });
    expect(await call(b, 'endpoint.grants', { member: org.C }), 'no input names another member').toMatchObject({ ok: false, error: { code: 'malformed' } });
  });

  it('3. a non-member sees []: no channel at admission, and no answer once removed while their read was out', async () => {
    const f = await machine();
    await keep(f, await signed(f, org.B));
    await expect(openRemote(f, await newDevice('x1'), org.B), 'a device no member holds').rejects.toThrow();
    expect(grantsView(f.endpoint.parts!.state.ledger!, f.chain.at(-1)!.state, [org.A], { member: memberId() }), 'an id the head doesn’t list').toEqual([]);

    const b = await openRemote(f, org.b1, org.B);
    ownersHold.pass = 1;
    ownersHold.armed = 1;
    const id = await ask(b, 'endpoint.grants', null);
    await until(() => ownersHold.held.length === 1 || null, 'B’s read of the owners held');
    await removeB(f);
    releaseOwners();
    await until(() => b.channel.closed || null, 'B’s channel closed');
    await sleep(100);
    expect(resultOf(b, id), 'no answer reached B').toBeUndefined();
  });

  it('4. a member the ledger holds a grant for but the head no longer lists isn’t listed', async () => {
    const f = await machine();
    const forB = await signed(f, org.B);
    await keep(f, forB);
    await removeB(f);
    expect(f.endpoint.parts!.state.ledger!.grants[org.B], 'B’s grant outlives B in the ledger').toEqual(forB);
    const a = await openRemote(f, org.a1, org.A);
    expect(await grantsOf(a)).toEqual({ members: [entry(org.A), entry(org.C)] });
  });

  it('5. after its signer’s key is revoked, a member’s grant reads null and their high-water mark is kept', async () => {
    const f = await machine();
    // a2, A's second device, joins as a root, signs B's grant at version 3, and leaves revoked
    const a2 = await newDevice('a2');
    await deliver(f, async (s) => {
      s.members[0].devices.push({ ...a2.device, endorsement: await endorseDevice(ORG, org.A, a2.device, org.a1.stepUp.privateKey, org.a1.stepUp.pub) });
      s.root.keys.push(await keyId(a2.stepUp.pub));
    });
    await keep(f, await signed(f, org.B, { version: 3 }, a2));
    await deliver(f, async (s) => {
      s.members[0].devices = s.members[0].devices.filter((d) => d.id !== 'a2');
      s.root.keys = [await keyId(org.a1.stepUp.pub)];
      s.revoked.push(...(await revokedDevice(org.A, a2.device)));
    });
    expect(f.endpoint.parts!.state.ledger!.grants, 'the grant ended').toEqual({});
    const a = await openRemote(f, org.a1, org.A);
    const b = await openRemote(f, org.b1, org.B);
    expect(await grantsOf(a)).toEqual({ members: [entry(org.A), entry(org.B, null, 3), entry(org.C)] });
    expect(await grantsOf(b)).toEqual({ members: [entry(org.B, null, 3)] });
  });

  it('6. on an org-owned machine an admin sees every member, and a member their own entry', async () => {
    const f = await machine({ amend: (s) => void (s.machines.find((m) => m.name === 'mini')!.owners = 'org') });
    const forB = await signed(f, org.B);
    await keep(f, forB);
    const a = await openRemote(f, org.a1, org.A);
    const b = await openRemote(f, org.b1, org.B);
    expect(await grantsOf(a)).toEqual({ members: [entry(org.A), entry(org.B, forB), entry(org.C)] });
    expect(await grantsOf(b)).toEqual({ members: [entry(org.B, forB)] });
  });

  it('7. answers `unavailable`, and says so in the log, once the head moved under each of its three reads', async () => {
    const f = await machine();
    const a = await openRemote(f, org.a1, org.A);
    ownersHold.pass = 1;
    ownersHold.armed = GRANTS_READS;
    const id = await ask(a, 'endpoint.grants', null);
    for (const owners of [[org.B], [org.A], [org.B]]) {
      await until(() => ownersHold.held.length > 0 || null, 'a held read of the owners');
      await deliver(f, (s) => void (s.machines.find((m) => m.name === 'mini')!.owners = owners));
      releaseOwners();
    }
    expect(await until(() => resultOf(a, id), 'A’s answer')).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(ownersHold.armed).toBe(0);
    expect(f.services.lines).toContain("endpoint: an endpoint.grants read found the machine's owners moved under each of 3 reads; answered unavailable");
  });

  it('answers by the owners of the head it answers under: the machine moved to B while A’s read was out, A sees their own alone', async () => {
    const f = await machine();
    const forB = await signed(f, org.B);
    await keep(f, forB);
    const a = await openRemote(f, org.a1, org.A);
    ownersHold.pass = 1;
    ownersHold.armed = 1;
    const id = await ask(a, 'endpoint.grants', null);
    await until(() => ownersHold.held.length === 1 || null, 'A’s read of the owners held');
    await deliver(f, (s) => void (s.machines.find((m) => m.name === 'mini')!.owners = [org.B]));
    releaseOwners();
    expect(await until(() => resultOf(a, id), 'A’s answer')).toMatchObject({ ok: true, output: { members: [entry(org.A)] } });
    const b = await openRemote(f, org.b1, org.B);
    expect(await grantsOf(b), 'B, the owner now').toEqual({ members: [entry(org.A), entry(org.B, forB), entry(org.C)] });
  });
});

describe('grantsAnswer and grantsView', () => {
  it('8. answers `unavailable` when the head moved between the read and the send, with no read again', async () => {
    const f = await machine();
    const head = f.chain.at(-1)!.state;
    let standing = true;
    let reads = 0;
    const read = () => (reads++, { head, owners: Promise.resolve([org.A]), stands: () => standing });
    const ledger = () => f.endpoint.parts!.state.ledger;
    const step = await grantsAnswer(read, ledger, { member: org.A }, () => {});
    standing = false;
    expect(step()).toEqual({ ok: false, code: 'unavailable' });
    expect(reads).toBe(1);
    standing = true;
    expect(step(), 'the same step, its head standing').toEqual({ ok: true, output: { members: [entry(org.A), entry(org.B), entry(org.C)] } });
  });

  it('9. gives the machine’s owners as one reader (the local door) every member, and [] when the head names no owner', async () => {
    const f = await machine();
    const head = f.chain.at(-1)!.state;
    const forB = await signed(f, org.B);
    const ledger = { version: 1 as const, heldKeys: [], grants: { [org.B]: forB }, highWater: { [org.B]: 1 } };
    expect(grantsView(ledger, head, [org.A], 'owners')).toEqual([entry(org.A), entry(org.B, forB), entry(org.C)]);
    expect(grantsView(ledger, head, [], 'owners')).toEqual([]);
  });
});

describe('the local door', () => {
  /** A device of the org's sealing actions for this machine (no channel of its own is used). */
  const sealer = async (f: Fixture, who: TestDevice, member: string) => (await openRemote(f, who, member)).device;
  const grantAct = (device: Awaited<ReturnType<typeof sealer>>, f: Fixture, grant: unknown): Action => device.action({ machine: f.ref, action: 'endpoint.grant', args: { grant } });

  it('stores a valid grant on its own signature, with no step-up on the act, as a channel’s act does', async () => {
    const f = await machine();
    const a = await sealer(f, org.a1, org.A);
    const forB = await signed(f, org.B, { rights: ['spawn', 'shell'] });
    const act = grantAct(a, f, forB);
    expect(act.stepUp).toBeUndefined();
    expect(await f.endpoint.local.act(act)).toEqual({ state: 'done', result: { member: org.B, version: 1, rights: ['spawn', 'shell'] } });
    expect(f.endpoint.parts!.state.ledger!.grants[org.B]).toEqual(forB);
    expect(await f.endpoint.local.act(act), 'replayed').toEqual({ state: 'refused', reason: 'replayed' });
    // the ledger's own rule after the door, its refusal the act's `failed` outcome: an equal version is not newer
    expect(await f.endpoint.local.act(grantAct(a, f, forB))).toEqual({ state: 'failed', error: { code: 'not-newer' } });
  });

  it('refuses a forged grant at the door, before anything runs', async () => {
    const f = await machine();
    const a = await sealer(f, org.a1, org.A);
    const forB = await signed(f, org.B);
    const widened = { ...forB, body: { ...forB.body, rights: ['spawn', 'shell', 'machine-admin'] } };
    expect(await f.endpoint.local.act(grantAct(a, f, widened)), 'rights changed after signing').toEqual({ state: 'refused', reason: 'bad-signature' });
    expect(await f.endpoint.local.act(grantAct(a, f, { body: forB.body })), 'no signature').toEqual({ state: 'refused', reason: 'malformed' });
    expect(await f.endpoint.local.act(a.action({ machine: f.ref, action: 'endpoint.grant', args: {} })), 'no grant').toEqual({ state: 'refused', reason: 'malformed' });
    expect(f.endpoint.parts!.state.ledger!.grants).toEqual({});
  });

  it('refuses an ineligible grant at the door: one signed by a member who doesn’t own the machine, or for a member the head doesn’t list', async () => {
    const f = await machine();
    const b = await sealer(f, org.b1, org.B);
    expect(await f.endpoint.local.act(grantAct(b, f, await signed(f, org.B, {}, org.b1))), 'B signs their own').toEqual({ state: 'refused', reason: 'unknown-signer' });
    expect(await f.endpoint.local.act(grantAct(b, f, await signed(f, 'f'.repeat(32)))), 'no such member').toEqual({ state: 'refused', reason: 'not-listed' });
    expect(f.endpoint.parts!.state.ledger!.grants).toEqual({});
  });

  it('refuses a grant sealed by a device the head doesn’t list, and every other act outside record.*', async () => {
    const f = await machine();
    const a = await sealer(f, org.a1, org.A);
    const forB = await signed(f, org.B);
    expect(await f.endpoint.local.act({ ...grantAct(a, f, forB), device: 'x1' })).toEqual({ state: 'refused', reason: 'unknown-device' });
    const next = await successor(f.chain.at(-1)!, [org.a1]);
    expect(await f.endpoint.local.act(await a.stepUp(a.action({ machine: f.ref, action: 'endpoint.state', args: { states: [next], transitions: [] } })))).toEqual({ state: 'refused', reason: 'not-offered' });
    expect(f.endpoint.parts!.state.ledger!.grants).toEqual({});
  });

  it('answers endpoint.grants as the machine’s owners’ member, and still no other call', async () => {
    const f = await machine();
    const forB = await signed(f, org.B);
    await keep(f, forB);
    expect(await f.endpoint.local.call('endpoint.grants', null)).toEqual({ ok: true, output: { members: [entry(org.A), entry(org.B, forB), entry(org.C)] } });
    expect(await f.endpoint.local.call('endpoint.grants', { member: org.B })).toEqual({ ok: false, code: 'malformed' });
    expect(await f.endpoint.local.call('endpoint.listings', null)).toEqual({ ok: false, code: 'not-offered' });
  });
});
