// What a running endpoint learns of the org state between its periodic reads (O10 M6): an arriving event held for a
// signer its head doesn't know asks for a read of the hub's state at once (a certificate stored or retired moves no
// version, so no `state` notice tells of it), once for a burst, and not again for a signer the read left unknown; and a
// revocation, which is a new version, arrives on the hub's `state` notice, after which the revoked key's events are
// refused at once. A started endpoint with a stand-in hub: its RL1 socket (fake-hub.ts) and its org state read (the
// endpoint's `fetch`), sminos connected over RL10.
import * as fs from 'node:fs';
import { join } from 'node:path';
import { MACHINE_ORG_STATE_PATH, type OrgStateView } from 'desk-hub/protocol';
import { generateSigningKey, keyId, NO_CERTIFICATES, signEvent, signRecord, SIGNING_DOMAINS, type Certificates, type SignedOrgState, type SigningKey } from 'org-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { createEndpoint, type Endpoint } from '../../../src/endpoint';
import { EndpointOrg } from '../../../src/endpoint/org-sync';
import { InboundIndex } from '../../../src/endpoint/rl10/inbound-index';
import { LegacyKey } from '../../../src/endpoint/rl10/legacy';
import { LogRelay } from '../../../src/endpoint/rl10/log-relay';
import { Members } from '../../../src/endpoint/rl10/members';
import { SignatureLedger } from '../../../src/endpoint/rl10/signature-ledger';
import { EndpointState } from '../../../src/endpoint/state/store';
import { FakeHub, until } from '../fake-hub';
import { fakeServices, mintRef, type FakeServices } from '../fake-services';
import { genesis, iso, memberId, newDevice, revokedDevice, successor, type TestDevice } from '../org-fixtures';
import { FakeSminos, type Frame } from './fake-sminos';

const ORG = 'org-held';
const P = '7d2b9c40-1f3e-4a6b-8c5d-9e0f1a2b3c4d';
const S = '22222222-2222-4222-8222-222222222222';
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

/** A machine a delegation certifies, as the hub stores its certificate: its key, its ref and the certificate. */
type Certified = { name: string; ref: string; key: SigningKey; kid: string; cert: Certificates['certs'][number] };

/**
 * An org of admin A (a1) and member B (b1, b2) with delegation D (`vm-`), the endpoint `mini` (A's) enrolled and
 * listed in it; the hub's view of the state (`chain`, `certificates`) is the test's to move, and every read of it is
 * counted. Started, with RL1 welcomed, sminos welcomed on RL10 and project P open on the log plane, and the reads the
 * start and the welcome asked for done.
 */
async function world(options: { certified?: string[] } = {}) {
  const A = memberId();
  const B = memberId();
  const [a1, b1, b2] = await Promise.all([newDevice('a1'), newDevice('b1'), newDevice('b2')]);
  const recovery = await generateSigningKey();
  const delegation = { id: memberId(), key: await generateSigningKey() };
  const services: FakeServices = fakeServices();
  closers.push(() => services.cleanup());
  const ref = services.machine.ref;
  const key = await generateSigningKey(true);
  const kid = await keyId(key.pub);
  const s1 = await genesis(ORG, A, a1, recovery);
  const s2 = await successor(s1, [a1], (s) => {
    s.members.push({ id: B, email: 'b@example.com', role: 'member', devices: [b1.device, b2.device] });
    s.machines.push({ name: 'mini', ref, pub: key.pub, owners: [A] });
    s.machineNames.push({ name: 'mini', ref });
    s.delegations.push({ id: delegation.id, pub: delegation.key.pub, prefix: 'vm-', expires: iso(Date.now() + 86_400_000), maxUses: 10, offlineRevokeS: 0, owners: [A] });
  });

  /** A machine under D: its key and its certificate (kept nowhere until the test puts it in the hub's view). */
  const certify = async (name: string, use: number): Promise<Certified> => {
    const machineKey = await generateSigningKey();
    const machine = mintRef(delegation.id);
    const cert = await signRecord(SIGNING_DOMAINS.machineCert, { org: ORG, machine, name, pub: machineKey.pub, delegation: delegation.id, use, issued: iso(Date.now() - 60_000) }, delegation.key.privateKey, delegation.key.pub);
    return { name, ref: machine, key: machineKey, kid: await keyId(machineKey.pub), cert };
  };
  const machines: Certified[] = [];
  for (const [i, name] of (options.certified ?? []).entries()) machines.push(await certify(name, i + 1));

  const hub = await new FakeHub().start();
  closers.push(() => hub.close());
  const view = { chain: [s1, s2] as SignedOrgState[], certificates: { certs: machines.map((m) => m.cert), retirements: [] } as Certificates };
  const reads: number[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname !== MACHINE_ORG_STATE_PATH) return new Response(JSON.stringify({ error: 'not-found' }), { status: 404 });
    const since = Number(url.searchParams.get('since'));
    reads.push(since);
    const body: OrgStateView = { head: view.chain[view.chain.length - 1], chain: view.chain.filter((s) => s.state.version > since), transitions: [], certificates: view.certificates, more: false };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;

  const state = EndpointState.open(services.machine.stateDir);
  state.setMachineKey({ version: 1, keyId: kid, jwk: (await crypto.subtle.exportKey('jwk', key.privateKey)) as JsonWebKey, created: new Date().toISOString() });
  state.setLedger({ version: 1, heldKeys: [kid], grants: {}, highWater: {} });
  state.setEnrollment({ version: 1, state: 'org-listed', name: 'mini', ref, org: ORG, hub: hub.url, enrollment: 'e'.repeat(32), credentials: { clientId: 'id', clientSecret: 'secret' }, at: new Date().toISOString() });
  state.setOrg({ version: 1, org: ORG, pinned: { roots: s1.state.root.keys, recoveryPub: recovery.pub }, head: null, chain: [], hashes: [], certificates: NO_CERTIFICATES, acceptedTransitions: [], highWater: 0 });
  await new EndpointOrg(state, { log: () => {} }).adopt([s1, s2], []);

  const endpoint: Endpoint = createEndpoint({ fetch, env: {}, sleep: (ms) => sleep(Math.min(ms, 50)) });
  await endpoint.start(services);
  closers.push(() => endpoint.stop());
  await until(() => endpoint.links.hub.connected, 'the RL1 welcome');
  const rl10 = join(services.machine.stateDir, 'rl10.json');
  await until(() => fs.existsSync(rl10), 'RL10 served');
  const info = JSON.parse(fs.readFileSync(rl10, 'utf8')) as { socket: string; token: string };
  const sminos = await FakeSminos.open(info.socket);
  closers.push(() => sminos.close());
  sminos.send({ t: 'hello', protocol: { major: 1, minor: 0 }, capabilities: [], token: info.token, sminos: { version: 'held-read' }, policy: { read_only: false, ceiling: 'settings' } });
  await sminos.next((f) => f.t === 'welcome', 'the RL10 welcome');
  sminos.send({ t: 'hello', project: P, name: 'mini', have: {} });
  await until(() => hub.frames('hello').some((r) => r.frame.project === P), 'the project opened on RL1');
  await endpoint.syncNow();

  /** The hub sends `events` down RL1 for P. */
  const down = (events: object[]) => hub.current.send(JSON.stringify({ t: 'events', project: P, events }));
  /** The seqs sminos was handed for `writer`, in the order it got them. */
  const delivered = (writer: string) =>
    sminos.received.flatMap((f) => (f.t === 'events' && f.project === P ? (f.events as Array<{ event: { writer: string; seq: number } }>).filter((w) => w.event.writer === writer).map((w) => w.event.seq) : []));
  return { endpoint, services, hub, sminos, view, reads, certify, machines, down, delivered, a1, b1, b2, A, B, delegation, s2 };
}

/** A machine's event at `seq`, signed by its key as sminos's endpoint signs it. */
async function said(machine: Certified, seq: number): Promise<Record<string, unknown>> {
  const created = iso(Date.now() - 1000);
  return signEvent({ org: ORG, project: P }, { ts: created, created, writer: `${machine.name}/human`, seq, kind: 'human', from: 'human', to: '*', text: `say ${seq}` }, machine.key.privateKey, machine.key.pub);
}

/** Words `device` signed into session S, as the hub posts them under `hub/<member>` at `seq`. */
async function words(device: TestDevice, member: string, seq: number): Promise<Record<string, unknown>> {
  const created = iso(Date.now() - 1000);
  const draft = { kind: 'human', from: 'human', member, to: [{ session: S, alias: 'bob' }], text: 'do it', created, nonce: 'AAAAAAAAAAAAAAAAAAAAAA' };
  const signed = await signEvent({ org: ORG, project: P }, draft, device.channel.privateKey, device.channel.pub);
  return { ...signed, writer: `hub/${member}`, seq, ts: created };
}

describe('an event held for a signer the head does not know', () => {
  it('is delivered after the read it asks for, not at the next periodic one', async () => {
    const w = await world();
    const before = w.reads.length;
    // The hub stores vm-two's certificate (no version moves, so no notice); vm-two cuts over and says something.
    const vm = await w.certify('vm-two', 1);
    w.view.certificates = { certs: [vm.cert], retirements: [] };
    const event = await said(vm, 1);
    w.down([event]);
    const got = await w.sminos.next((f) => f.t === 'events' && f.project === P, 'the event delivered', 3000);
    expect(got.events).toEqual([{ event, signer: { kind: 'machine', ref: vm.ref, name: 'vm-two', keyId: vm.kid } }]);
    expect(w.reads.length).toBe(before + 1);
    expect(w.services.lines.some((l) => l.includes('vm-two/human:1') && l.includes('its signer is not in the head'))).toBe(true);
    expect(w.endpoint.rl10.relay.holding).toBe(0);
  });

  it('asks for one read for a burst of a new signer’s events, across frames', async () => {
    const w = await world();
    const before = w.reads.length;
    const vm = await w.certify('vm-two', 1);
    w.view.certificates = { certs: [vm.cert], retirements: [] };
    for (let frame = 0; frame < 4; frame++) w.down(await Promise.all([1, 2, 3].map((n) => said(vm, frame * 3 + n))));
    await until(() => w.delivered('vm-two/human').length === 12, 'all twelve delivered', 3000);
    expect(new Set(w.delivered('vm-two/human'))).toEqual(new Set(Array.from({ length: 12 }, (_, i) => i + 1)));
    await sleep(200);
    expect(w.reads.length).toBe(before + 1);
  });

  it('asks no more for a signer the read left unknown, though the read moved the head and its events were judged again', async () => {
    const w = await world();
    const before = w.reads.length;
    // vm-three's certificate never reaches the hub's view; the read brings a new head, so the held events are judged
    // again under it, and held again.
    const vm = await w.certify('vm-three', 1);
    w.view.chain.push(await successor(w.s2, [w.a1]));
    w.down([await said(vm, 1), await said(vm, 2)]);
    w.down([await said(vm, 3)]);
    await until(() => w.endpoint.parts!.org.head().state.version === 3, 'the read’s head adopted', 3000);
    await sleep(300);
    w.down([await said(vm, 4)]);
    await sleep(300);
    expect(w.reads.length).toBe(before + 1);
    expect(w.endpoint.rl10.relay.holding).toBe(4);
    expect(w.delivered('vm-three/human')).toEqual([]);
    expect(w.hub.frames('rejected')).toEqual([]);
  });
});

describe('a hold judged while the head moved', () => {
  const Q = '88888888-8888-4888-8888-888888888888';

  /** vm-two under delegation D, and a relay for P and Q whose head's certificates the test moves (`certify`). */
  async function race() {
    const a1 = await newDevice('a1');
    const A = memberId();
    const delegation = { id: memberId(), key: await generateSigningKey() };
    const s1 = await genesis(ORG, A, a1, await generateSigningKey());
    const s2 = await successor(s1, [a1], (s) => {
      s.delegations.push({ id: delegation.id, pub: delegation.key.pub, prefix: 'vm-', expires: iso(Date.now() + 86_400_000), maxUses: 10, offlineRevokeS: 0, owners: [A] });
    });
    const key = await generateSigningKey();
    const machine = mintRef(delegation.id);
    const cert = await signRecord(SIGNING_DOMAINS.machineCert, { org: ORG, machine, name: 'vm-two', pub: key.pub, delegation: delegation.id, use: 1, issued: iso(Date.now() - 60_000) }, delegation.key.privateKey, delegation.key.pub);
    const vm: Certified = { name: 'vm-two', ref: machine, key, kid: await keyId(key.pub), cert };
    const signer = { kind: 'machine', ref: machine, name: 'vm-two', keyId: vm.kid };
    const relay = () => {
      const services = fakeServices();
      closers.push(() => services.cleanup());
      const state = EndpointState.open(services.machine.stateDir);
      let current = { head: s2.state, certificates: NO_CERTIFICATES as Certificates, ref: mintRef(), name: 'mini' };
      const down: Frame[] = [];
      const counts = { asked: 0 };
      const r = new LogRelay({
        org: () => current,
        key: () => null,
        members: new Members({ dispatch: () => Promise.reject(new Error('none')), listings: { report: async () => {}, gone: async () => {} }, listed: () => [], forget: () => {}, log: () => {}, now: Date.now }),
        ledger: new SignatureLedger(() => state.subdirectory('signatures')),
        index: new InboundIndex(() => state.subdirectory('inbound'), Date.now),
        legacy: new LegacyKey(() => state, () => ORG),
        hub: { openProject: () => () => {}, send: () => true },
        toSminos: (f) => void down.push(f),
        opened: () => {},
        behind: () => void counts.asked++,
        now: Date.now,
        log: () => {},
      });
      for (const project of [P, Q]) r.hello({ t: 'hello', project, name: 'mini', have: {} });
      /** The read's certificate installed, and the retry it causes begun. */
      const certify = () => {
        current = { ...current, certificates: { certs: [cert], retirements: [] } };
        return r.retry();
      };
      return { r, down, counts, certify };
    };
    return { vm, key, signer, relay };
  }

  it('is judged again under the new head when a retry began meanwhile, which passed it before it was held', async () => {
    const { vm, signer, relay } = await race();
    const { r, down, counts, certify } = relay();
    const event = await said(vm, 1);
    // The event is verified under the head without vm-two's certificate; before the verdict, a read installs it and
    // the retry it causes runs over a hold set that doesn't hold the event yet.
    const arriving = r.fromHub({ t: 'events', project: P, events: [event] });
    await certify();
    await arriving;
    expect(down).toEqual([{ t: 'events', project: P, events: [{ event, signer }] }]);
    expect(r.holding).toBe(0);
    expect(counts.asked).toBe(0);
  });

  it('strands no event of another project whose key asked already, wherever between its verdict and its hold the retry begins', async () => {
    const { vm, key, signer, relay } = await race();
    const first = await said(vm, 1);
    const draft = { ...first };
    delete draft.sig;
    const second = await signEvent({ org: ORG, project: Q }, draft, key.privateKey, key.pub);
    // The retry begins `n` microtasks after Q's event arrives: across the range, once in the gap between the verdict
    // under the old certificates and the hold (review round 2 on f4d399f47 found one such gap).
    for (let n = 1; n <= 24; n++) {
      const { r, down, counts, certify } = relay();
      await r.fromHub({ t: 'events', project: P, events: [first] });
      expect(counts.asked).toBe(1);
      const arriving = r.fromHub({ t: 'events', project: Q, events: [second] });
      const moving = new Promise<void>((resolve, reject) => {
        let left = n;
        const step = () => (--left > 0 ? queueMicrotask(step) : void certify().then(resolve, reject));
        queueMicrotask(step);
      });
      await Promise.all([arriving, moving]);
      expect({ n, down, holding: r.holding }).toEqual({
        n,
        down: expect.arrayContaining([
          { t: 'events', project: P, events: [{ event: first, signer }] },
          { t: 'events', project: Q, events: [{ event: second, signer }] },
        ]),
        holding: 0,
      });
      expect(counts.asked).toBe(1);
    }
  });
});

describe('a revocation', () => {
  it('reaches the endpoint on the hub’s state notice, and the revoked keys’ events are refused at once after it', async () => {
    const w = await world({ certified: ['vm-two'] });
    const [vm] = w.machines;
    // Before: both keys speak.
    w.down([await words(w.b1, w.B, 1), await said(vm, 1)]);
    await until(() => w.delivered(`hub/${w.B}`).length === 1 && w.delivered('vm-two/human').length === 1, 'both delivered before the revocation', 3000);
    const before = w.reads.length;
    // B's device b1 is lost and revoked (B keeps b2), and delegation D revoked with its certificates.
    const s3 = await successor(w.s2, [w.a1], async (s) => {
      s.members.find((m) => m.id === w.B)!.devices = [w.b2.device];
      s.revoked.push(...(await revokedDevice(w.B, w.b1.device)));
      s.delegations = [];
      s.revoked.push({ keyId: await keyId(w.delegation.key.pub), holder: { delegation: w.delegation.id, prefix: 'vm-' } });
    });
    w.view.chain.push(s3);
    w.hub.current.send(JSON.stringify({ t: 'state', version: 3 }));
    await until(() => w.endpoint.parts!.org.head().state.version === 3, 'the revoking head adopted on the notice', 3000);
    expect(w.reads.length).toBe(before + 1);
    const revoked = await w.sminos.next((f) => f.t === 'revoked' && f.version === 3, 'the revocation set restated to sminos');
    expect(revoked.keys).toEqual(expect.arrayContaining([await keyId(w.b1.device.channelPub), vm.kid]));

    w.down([await words(w.b1, w.B, 2), await said(vm, 2)]);
    const spent = [await w.sminos.next((f) => f.t === 'spent', 'the first spent'), await w.sminos.next((f) => f.t === 'spent', 'the second spent')];
    expect(spent).toEqual([
      { t: 'spent', project: P, writer: `hub/${w.B}`, seq: 2, reason: 'revoked' },
      { t: 'spent', project: P, writer: 'vm-two/human', seq: 2, reason: 'revoked' },
    ]);
    await until(() => w.hub.frames('rejected').length === 2, 'both rejected up');
    expect(w.hub.frames('rejected').map((r) => [(r.frame.event as Frame | null)?.writer, r.frame.reason])).toEqual([
      [`hub/${w.B}`, 'bad-code'],
      ['vm-two/human', 'bad-code'],
    ]);
    expect(w.delivered(`hub/${w.B}`)).toEqual([1]);
    expect(w.delivered('vm-two/human')).toEqual([1]);
    expect(w.endpoint.rl10.relay.holding).toBe(0);
    expect(w.reads.length).toBe(before + 1);
  });
});
