// Subscriptions over both carriers (O10 M8; acceptance 2's last case): no event lost or doubled across a forced channel
// drop, over the hub's multiplex (desk-hub's Worker in Miniflare) and over the direct listener. One endpoint, enrolled
// and listed in a throwaway org as the channel suite's is, with the M8 harness's fake engine host (lane B) and fake
// sminos (lane A) behind it; each carrier runs the same two cases: a lane B channel dropped between two events of one
// journal row, every event's full cursor checked against the producer's own numbering, and a lane A channel dropped
// while sminos goes on sending, resumed inside the endpoint's ring.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NetworkInterfaceInfo } from 'node:os';
import { base64urlEncode, generateSigningKey, keyId, type ByteDuplex, type SignedOrgState } from 'org-protocol';
import { encodeEnrollmentCodeV2, type EnrollmentIssued, type EnrollmentKey } from 'desk-hub/protocol';
import type { SessionEvent } from '@shared/graph/events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEndpoint, type Endpoint } from '../../src/endpoint';
import { RelayDialer, dialDirect } from './carriers';
import { fakeServices, type FakeServices } from './fake-services';
import { ADMIN, credentials, ORG, startMiniflareHub, type LocalHub } from './miniflare-hub';
import { genesis, newDevice, successor, type TestDevice } from './org-fixtures';
import type { FakeSminos } from './rl10/fake-sminos';
import { counter, cursorOf, drop, evs, FakeEngineHost, laneAMember, openRemote, Records, serve, sleep, sminos, subscribe, until, type Fixture, type Remote } from './sub-harness';

const TAILNET = '100.101.102.109';
const v4 = (address: string): NetworkInterfaceInfo => ({ address, family: 'IPv4', internal: false, netmask: '255.255.255.255', mac: '00:00:00:00:00:00', cidr: null });

let hub: LocalHub;
let stopHub: () => Promise<void>;
let A: string;
let a1: TestDevice;
const chain: SignedOrgState[] = [];
let endpoint: Endpoint;
let services: FakeServices;
let relay: RelayDialer;
let f: Fixture;
let s: FakeSminos;
let port = 0;

async function publish(state: SignedOrgState): Promise<void> {
  const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: state });
  if (response.status !== 201) throw new Error(`state: ${response.status} ${await response.text()}`);
  chain.push(state);
}

beforeAll(async () => {
  ({ hub, stop: stopHub } = await startMiniflareHub());
  A = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
  a1 = await newDevice('a1');
  const recovery = await generateSigningKey();
  const g = await genesis(ORG, A, a1, recovery);
  await publish(g);

  services = fakeServices();
  const host = new FakeEngineHost();
  host.serve(services);
  const records = new Records();
  endpoint = createEndpoint({
    build: 'm8-carriers',
    sleep: (ms) => sleep(Math.min(ms, 50)),
    env: { MAWS_ENDPOINT_DIRECT: '1' },
    direct: {
      interfaces: () => ({ utun4: [v4(TAILNET)] }),
      listen: (server: Server) =>
        new Promise<number>((resolve, reject) => {
          server.once('error', reject);
          server.listen(0, '127.0.0.1', () => resolve((port = (server.address() as AddressInfo).port)));
        }),
      limits: { perSource: { burst: 1000, perMinute: 60_000 }, overall: { burst: 1000, perMinute: 60_000 } },
    },
    authorization: { records, checkouts: { known: (path) => endpoint.rl10.members.known(path) }, settingsMode: () => 'default' },
  });
  records.bindLaneA(endpoint.rl10.members);
  await endpoint.start(services);
  const ref = services.machine.ref;
  const issued = (await (await hub.fetchAs(ADMIN, '/api/enrollments', { body: {} })).json()) as EnrollmentIssued;
  const code = encodeEnrollmentCodeV2({ hub: hub.url, token: issued.token, roots: [await keyId(a1.stepUp.pub)], recoveryPub: recovery.pub, k: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) });
  const enrolling = endpoint.cli('enroll', ['--name', 'm8-mini', '--wait', '30', '--json'], code);
  const key = await postedKey(issued.enrollment.id);
  await publish(
    await successor(chain[chain.length - 1], [a1], (state) => {
      state.machines.push({ name: 'm8-mini', ref, pub: key.pub, owners: [A] });
      state.machineNames.push({ name: 'm8-mini', ref });
    }),
  );
  expect((await enrolling).code).toBe(0);
  await until(() => endpoint.hub.connected, 'the hub link’s welcome', 15_000);
  await until(() => endpoint.status().listener.bound && port !== 0, 'the direct listener bound', 15_000);
  relay = await RelayDialer.open(hub.url, ref, credentials(ADMIN));
  f = { org: ORG, endpoint, services, host, records, ref, key: await generateSigningKey(), chain, port: () => port, interest: [] };
  s = await sminos(f, [laneAMember({ session: 'la-relayed' }), laneAMember({ session: 'la-direct' })]);
}, 120_000);

/** The machine key the enrolling endpoint posted to the hub. */
async function postedKey(enrollment: string): Promise<EnrollmentKey> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const response = await hub.fetchAs(ADMIN, `/api/enrollments/${enrollment}/key`);
    if (response.status === 200) return (await response.json()) as EnrollmentKey;
    await response.body?.cancel();
    if (Date.now() > deadline) throw new Error('no posted key within 15000 ms');
    await sleep(25);
  }
}

afterAll(async () => {
  s?.close();
  relay?.close();
  await endpoint?.stop();
  services?.cleanup();
  await stopHub?.();
});

const carriers: Array<[name: 'relayed' | 'direct', dial: () => Promise<ByteDuplex>]> = [
  ['relayed', () => relay.dial()],
  ['direct', () => dialDirect(`ws://127.0.0.1:${port}`)],
];

/** The device saw exactly `expected`, in order, each `ev` at its producer's cursor. */
function sawExactly(r: Remote, sub: string, expected: SessionEvent[]): void {
  const got = evs(r, sub);
  expect(got.map((e) => [e.epoch, e.seq, e.idx])).toEqual(expected.map((e) => Object.values(cursorOf(e))));
  expect(got.map((e) => (e.body as SessionEvent).id)).toEqual(expected.map((e) => e.id));
}

for (const [carrier, dial] of carriers) {
  describe(`over the ${carrier === 'relayed' ? 'hub’s multiplex' : 'direct listener'}`, () => {
    it('loses and doubles no lane B event across a forced drop between two events of one row', async () => {
      const app = `app-${carrier}`;
      const session = f.host.add(app);
      f.records.set({ lane: 'B', session: session.engineSessionId!, owners: ['@machine'] }, app);
      f.host.attach(true);
      const before = f.host.row(app, 2, { live: false });
      const a = await openRemote(f, a1, A, { dial });
      expect(await subscribe(a, 's1', { lane: 'B', id: app })).toMatchObject({ mode: 'snapshot', epoch: session.launchId });
      await until(() => evs(a, 's1').length === 2, 'the launch’s first row', 10_000);
      // Row 2 has four events; only its first two reach the device before its carrier is cut.
      const row = Array.from({ length: 4 }, (_, i) => f.host.event(session, 2, i, { kind: 'note', text: `split ${i}` }));
      session.rows.push(row);
      f.host.batches(app, row.slice(0, 2));
      await until(() => evs(a, 's1').length === 4, 'the row’s first half', 10_000);
      const last = evs(a, 's1').at(-1)!;
      const cursor = { epoch: last.epoch as string, seq: last.seq as number, idx: last.idx as number };
      expect(cursor).toEqual({ epoch: session.launchId, seq: 2, idx: 1 });
      drop(a);
      f.host.batches(app, row.slice(2));
      const after = f.host.row(app, 1, { live: false });
      const b = await openRemote(f, a1, A, { dial });
      expect(await subscribe(b, 's1', { lane: 'B', id: app }, { cursor })).toMatchObject({ mode: 'replay', ...cursor });
      await until(() => evs(b, 's1').length === 3, 'the rest', 10_000);
      const live = f.host.row(app, 1);
      await until(() => evs(b, 's1').length === 4, 'the live event', 10_000);
      sawExactly(a, 's1', [...before, row[0], row[1]]);
      sawExactly(b, 's1', [row[2], row[3], ...after, ...live]);
    });

    it('loses and doubles no lane A message across a forced drop, resumed inside the ring', async () => {
      const session = `la-${carrier}`;
      const a = await openRemote(f, a1, A, { dial });
      const ask = subscribe(a, 's1', { lane: 'A', id: session });
      const up = await serve(s, session);
      await ask;
      const next = counter(session);
      for (let i = 0; i < 3; i++) s.send(next(up.sub as string, 'row', { row: { uuid: `a${i}` } }));
      await until(() => evs(a, 's1').length === 3, 'the first rows', 10_000);
      const cursor = { epoch: up.sub as string, seq: evs(a, 's1').at(-1)!.seq as number };
      drop(a);
      for (let i = 0; i < 2; i++) s.send(next(up.sub as string, 'row', { row: { uuid: `b${i}` } }));
      const b = await openRemote(f, a1, A, { dial });
      expect(await subscribe(b, 's1', { lane: 'A', id: session }, { cursor })).toMatchObject({ mode: 'replay', epoch: up.sub, seq: cursor.seq });
      s.send(next(up.sub as string, 'row', { row: { uuid: 'c0' } }));
      await until(() => evs(b, 's1').length === 3, 'the replay and the live row', 10_000);
      const uuids = (r: Remote) => evs(r, 's1').map((e) => (e.body as { body: { row: { uuid: string } } }).body.row.uuid);
      expect(uuids(a)).toEqual(['a0', 'a1', 'a2']);
      expect(uuids(b)).toEqual(['b0', 'b1', 'c0']);
      expect(evs(b, 's1').map((e) => e.seq)).toEqual([4, 5, 6]);
      expect(s.received.filter((x) => x.t === 'subscribe' && x.session === session)).toHaveLength(1);
    });
  });
}
