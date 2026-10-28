// The app's RL2 link through the hub (P5 O7 M1, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Proves";
// acceptance 1): desk-hub's Worker in Miniflare (test/endpoint/miniflare-hub.ts), an endpoint enrolled and listed in a
// throwaway org as the endpoint's own local suites do, with the M8 harness's fake engine host behind it, and main's link
// with the profile's real device keys, listed as a second device of the org's admin. The listener reads a fake interface
// table and listens on 127.0.0.1 in its tailnet address's place; the link's direct dialler maps that address to the
// loopback port, and the test kills or revives it. The endpoint record comes from the hub, through the link's own cache.
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NetworkInterfaceInfo } from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { base64urlEncode, generateSigningKey, keyId, memoryOrgView, type SignedOrgState } from 'org-protocol';
import { encodeEnrollmentCodeV2, type EnrollmentIssued, type EnrollmentKey } from 'desk-hub/protocol';
import type { SessionEvent } from '@shared/graph/events';
import type { MachineRef } from '@shared/machine/ref';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEndpoint, type Endpoint } from '../../src/endpoint';
import { loadDeviceKeys } from '../../src/main/device/keys';
import { createStepUp } from '../../src/main/device/step-up';
import { dialDirect, openRelaySocket, type RelaySocket } from '../../src/main/machines/remote/carriers';
import { createEndpointRecords, ENDPOINT_RECORDS_FILE } from '../../src/main/machines/remote/endpoint-records';
import { createRemoteLink, type RemoteLink, type SubscriptionSink } from '../../src/main/machines/remote/link';
import { heldOrgSession, watchedView, type SignedIn } from '../../src/main/org/session';
import { fakeServices, type FakeServices } from '../endpoint/fake-services';
import { ADMIN, credentials, ORG, startMiniflareHub, type LocalHub } from '../endpoint/miniflare-hub';
import { endorsed, genesis, newDevice, successor, type TestDevice } from '../endpoint/org-fixtures';
import { cursorOf, FakeEngineHost, Records, sleep, until } from '../endpoint/sub-harness';

const TAILNET = '100.101.102.110';
const v4 = (address: string): NetworkInterfaceInfo => ({ address, family: 'IPv4', internal: false, netmask: '255.255.255.255', mac: '00:00:00:00:00:00', cidr: null });
const OPEN = { perSource: { burst: 1000, perMinute: 60_000 }, overall: { burst: 1000, perMinute: 60_000 } };

let hub: LocalHub;
let stopHub: () => Promise<void>;
let hubStopped = false;
let A: string;
let a1: TestDevice;
const chain: SignedOrgState[] = [];
let endpoint: Endpoint;
let services: FakeServices;
let host: FakeEngineHost;
let ref: MachineRef;
let port = 0;
let profile: string;
let signedIn: SignedIn;
const session = heldOrgSession();
/** The direct carrier: dead (refused at once) or alive. */
const direct = { dead: true };
const relays: RelaySocket[] = [];
const links: RemoteLink[] = [];
const logs: string[] = [];

async function publish(state: SignedOrgState): Promise<void> {
  const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: state });
  if (response.status !== 201) throw new Error(`state: ${response.status} ${await response.text()}`);
  chain.push(state);
}

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

beforeAll(async () => {
  ({ hub, stop: stopHub } = await startMiniflareHub());
  A = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
  a1 = await newDevice('a1');
  const recovery = await generateSigningKey();
  await publish(await genesis(ORG, A, a1, recovery));

  services = fakeServices();
  host = new FakeEngineHost();
  host.serve(services);
  const records = new Records();
  endpoint = createEndpoint({
    build: 'o7-m1-carriers',
    sleep: (ms) => sleep(Math.min(ms, 50)),
    env: { MAWS_ENDPOINT_DIRECT: '1' },
    direct: {
      interfaces: () => ({ utun4: [v4(TAILNET)] }),
      listen: (server: Server) =>
        new Promise<number>((resolve, reject) => {
          server.once('error', reject);
          server.listen(0, '127.0.0.1', () => resolve((port = (server.address() as AddressInfo).port)));
        }),
      limits: OPEN,
    },
    authorization: { records, checkouts: { known: (path) => endpoint.rl10.members.known(path) }, settingsMode: () => 'default' },
  });
  records.bindLaneA(endpoint.rl10.members);
  await endpoint.start(services);
  ref = services.machine.ref;
  const issued = (await (await hub.fetchAs(ADMIN, '/api/enrollments', { body: {} })).json()) as EnrollmentIssued;
  const code = encodeEnrollmentCodeV2({ hub: hub.url, token: issued.token, roots: [await keyId(a1.stepUp.pub)], recoveryPub: recovery.pub, k: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) });
  const enrolling = endpoint.cli('enroll', ['--name', 'o7-mini', '--wait', '30', '--json'], code);
  const key = await postedKey(issued.enrollment.id);
  await publish(
    await successor(chain[chain.length - 1], [a1], (state) => {
      state.machines.push({ name: 'o7-mini', ref, pub: key.pub, owners: [A] });
      state.machineNames.push({ name: 'o7-mini', ref });
    }),
  );
  expect((await enrolling).code).toBe(0);

  // This profile's device: its real keys, listed as the admin's second device.
  profile = mkdtempSync(join(tmpdir(), 'maws-o7-local-'));
  const keys = await loadDeviceKeys(profile, { excludeFromBackup: async () => true });
  const mac = await endorsed(ORG, A, { device: { id: 'mac1', class: 'native-mac', keyStorage: 'software', channelPub: keys.channel.pub, stepUpPub: keys.stepUp.pub }, channel: keys.channel, stepUp: keys.stepUp }, a1);
  await publish(await successor(chain[chain.length - 1], [a1], (state) => void state.members.find((m) => m.id === A)!.devices.push(mac.device)));
  await until(() => endpoint.hub.connected, 'the hub link’s welcome', 15_000);
  await until(() => endpoint.status().listener.bound && port !== 0, 'the direct listener bound', 15_000);
  await until(() => (endpoint.status().stateVersion ?? 0) >= chain.length, 'the endpoint at the head', 15_000);
  await until(async () => (await hub.fetchAs(ADMIN, `/api/machines/${ref}/endpoint`)).status === 200, 'the endpoint record at the hub', 15_000);

  const s = host.add('app-1');
  records.set({ lane: 'B', session: s.engineSessionId!, owners: ['@machine'] }, 'app-1');
  host.attach(true);
  signedIn = {
    identity: { org: ORG, member: A, device: 'mac1', clientClass: 'native-mac', channelKey: keys.channel, build: 'o7-m1', capabilities: [] },
    view: watchedView(memoryOrgView({ chain: [...chain] }), () => session.changed()),
    stepUp: createStepUp({ device: { org: ORG, device: 'mac1' }, key: keys.stepUp, confirm: async () => ({ ok: true }) }),
    hub: { url: hub.url, headers: async () => credentials(ADMIN) },
  };
  session.set(signedIn);
}, 120_000);

afterAll(async () => {
  for (const link of links.splice(0)) link.close();
  await endpoint?.stop();
  services?.cleanup();
  if (!hubStopped) await stopHub?.();
  if (profile !== undefined) rmSync(profile, { recursive: true, force: true });
});

/** Main's link to the endpoint, its records cached in the profile, its direct dial at loopback while `direct` lives. */
function connect(): RemoteLink {
  const link = createRemoteLink({
    machine: { ref, name: 'o7-mini' },
    session,
    records: createEndpointRecords({ file: join(profile, ENDPOINT_RECORDS_FILE), log: (line) => void logs.push(line) }),
    dialDirect: async (url, timeoutMs) => {
      const target = new URL(url);
      if (direct.dead || target.hostname !== TAILNET) throw new Error(`${url} refused`);
      return dialDirect(`ws://127.0.0.1:${port}`, timeoutMs);
    },
    openRelay: async (url, headers) => {
      const socket = await openRelaySocket(url, headers);
      relays.push(socket);
      return socket;
    },
    timing: { DIRECT_BUCKET: OPEN.perSource },
    log: (line) => void logs.push(line),
  });
  links.push(link);
  return link;
}

function sink() {
  const heard: Array<[string, ...unknown[]]> = [];
  const s: SubscriptionSink = {
    subbed: (mode, at) => void heard.push(['subbed', mode, at]),
    snapshot: (at, value) => void heard.push(['snapshot', at, value]),
    event: (at, body) => void heard.push(['event', at, body]),
    paused: (reason) => void heard.push(['paused', reason]),
    resumed: () => void heard.push(['resumed']),
    ended: (reason) => void heard.push(['ended', reason]),
  };
  const events = () => heard.filter((x) => x[0] === 'event').map((x) => ({ at: x[1] as { epoch: string; seq: number; idx?: number }, body: x[2] as SessionEvent }));
  return { s, heard, events };
}

const ups = (carrier: string) => logs.filter((line) => line.includes(`: up over the ${carrier} carrier`)).length;

describe('the link through the hub', { timeout: 60_000 }, () => {
  let link: RemoteLink;
  let watch: ReturnType<typeof sink>;
  const seen: SessionEvent[] = [];

  it('comes up over the relay while the direct address is dead', async () => {
    link = connect();
    await until(() => link.carrier() === 'relay', 'the link up over the relay', 20_000);
    expect(link.state()).toBe('up');
    expect(ups('relay')).toBe(1);
    expect(await link.call('session.status', { appSessionId: 'app-1' })).toMatchObject({ ok: true, output: { appSessionId: 'app-1' } });
  });

  it('keeps a subscription and a pending act across a forced relay drop: the act runs once, no event is lost or repeated', async () => {
    watch = sink();
    link.subscribe({ session: { lane: 'B', id: 'app-1' } }, watch.s);
    seen.push(...host.row('app-1', 2));
    await until(() => watch.events().length === 2, 'the first events');
    host.hold('session.status');
    const calls = host.calls.length;
    const s = host.session('app-1');
    const handle = link.act({ action: 'session.send', session: 'app-1', context: { lane: 'B', launchId: s.launchId, engineSessionId: s.engineSessionId! }, args: { appSessionId: 'app-1', content: 'over the relay' } });
    await until(() => host.calls.slice(calls).some((c) => c.name === 'session.status'), 'the endpoint checking the act’s context');
    const before = relays.length;
    relays.at(-1)!.close(); // the app socket cut: every channel on it ends
    host.release('session.status');
    expect(await handle.outcome).toMatchObject({ state: 'done' });
    expect(host.runs.map((r) => r.content)).toEqual(['over the relay']);
    seen.push(...host.session('app-1').rows.at(-1)!); // the send's own row
    seen.push(...host.row('app-1', 3));
    await until(() => watch.events().length === seen.length, 'every event after the drop', 20_000);
    expect(relays.length).toBeGreaterThan(before);
    expect(watch.events().map((e) => [e.at.epoch, e.at.seq, e.at.idx])).toEqual(seen.map((e) => Object.values(cursorOf(e))));
    expect(watch.events().map((e) => e.body.id)).toEqual(seen.map((e) => e.id));
  });

  it('switches to direct on a probe once the direct address answers, the subscription going on without loss or repeat', async () => {
    direct.dead = false;
    seen.push(...host.row('app-1', 2));
    link.probe('network');
    await until(() => link.carrier() === 'direct', 'the switch to direct', 20_000);
    expect(ups('direct')).toBe(1);
    expect(link.state()).toBe('up');
    seen.push(...host.row('app-1', 2));
    await until(() => watch.events().length === seen.length, 'every event across the switch', 20_000);
    expect(watch.events().map((e) => e.body.id)).toEqual(seen.map((e) => e.id));
    await until(() => endpoint.status().channels.relayed === 0, 'the relay channel closed');
  });

  it('still dials direct from its cached record when the hub is away, a relaunch included', async () => {
    expect(existsSync(join(profile, ENDPOINT_RECORDS_FILE))).toBe(true);
    hubStopped = true;
    await stopHub();
    link.close();
    const relaunched = connect(); // a fresh link and a fresh cache, read from the profile's file
    await until(() => relaunched.carrier() === 'direct', 'up over direct with the hub away', 20_000);
    expect(await relaunched.call('session.status', { appSessionId: 'app-1' })).toMatchObject({ ok: true });
  });
});
