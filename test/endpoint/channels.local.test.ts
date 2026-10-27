// The endpoint's channels against the hub itself (O10 M4's Proves): desk-hub's Worker in Miniflare (miniflare-hub.ts),
// an endpoint enrolled and listed in a throwaway org, and one channel suite (channel-suite.ts) run unchanged over the
// hub's multiplex and over the direct listener. The listener reads a fake interface table and listens on 127.0.0.1 in
// its tailnet address's place, so nothing binds a real tailnet or wildcard address; its record's addresses, changed,
// reach the hub.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NetworkInterfaceInfo } from 'node:os';
import { base64urlEncode, generateSigningKey, memoryOrgView, keyId, verifyEndpointRecord, NO_CERTIFICATES, type OrgState, type SignedOrgState, type SigningKey } from 'org-protocol';
import { encodeEnrollmentCodeV2, type EnrollmentIssued, type EnrollmentKey, type MachineEndpoint } from 'desk-hub/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestDevice as Device } from '../../apps/org-protocol/test-support/test-device.ts';
import { createEndpoint, type Endpoint } from '../../src/endpoint';
import type { InterfaceTable } from '../../src/endpoint/tailnet';
import { RelayDialer, dialDirect } from './carriers';
import { channelSuite, type SuiteContext } from './channel-suite';
import { fakeServices, type FakeServices } from './fake-services';
import { ADMIN, credentials, ORG, startMiniflareHub, type LocalHub } from './miniflare-hub';
import { genesis, memberId, newDevice, successor, type TestDevice } from './org-fixtures';

const TAILNET = '100.101.102.103';
const v4 = (address: string): NetworkInterfaceInfo => ({ address, family: 'IPv4', internal: false, netmask: '255.255.255.255', mac: '00:00:00:00:00:00', cidr: null });
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let hub: LocalHub;
let stopHub: () => Promise<void>;
let a1: TestDevice;
let recovery: SigningKey;
let A: string;
const B = memberId();
let b1: TestDevice;
const chain: SignedOrgState[] = [];
let endpoint: Endpoint;
let services: FakeServices;
let ref: string;
let relay: RelayDialer;
const table: { current: InterfaceTable } = { current: { utun4: [v4(TAILNET)], en0: [v4('192.168.1.20')] } };
/** Each tailnet address's loopback port, listened on in its place. */
const ports = new Map<string, number>();
const requested: string[] = [];

async function until<T>(check: () => T | Promise<T>, what: string, ms = 15_000): Promise<NonNullable<T>> {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = await check();
    if (found) return found as NonNullable<T>;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await sleep(25);
  }
}

const next = (edit: (s: OrgState) => void | Promise<void>, after?: SignedOrgState) => successor(after ?? chain[chain.length - 1], [a1], edit);

async function publish(state: SignedOrgState): Promise<void> {
  const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: state });
  if (response.status !== 201) throw new Error(`state: ${response.status} ${await response.text()}`);
  chain.push(state);
}

function loopback(server: Server, address: string): Promise<number> {
  requested.push(address);
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      ports.set(address, port);
      resolve(port);
    });
  });
}

beforeAll(async () => {
  ({ hub, stop: stopHub } = await startMiniflareHub());
  A = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
  a1 = await newDevice('a1');
  b1 = await newDevice('b1');
  recovery = await generateSigningKey();
  const g = await genesis(ORG, A, a1, recovery);
  expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: g })).status).toBe(201);
  chain.push(g);
  await publish(await next((s) => void s.members.push({ id: B, email: 'b@example.com', role: 'member', devices: [b1.device] })));

  // A private daemon binds the listener only under MAWS_ENDPOINT_DIRECT=1, which is what this one is told.
  services = fakeServices();
  endpoint = createEndpoint({
    build: 'm4-suite',
    sleep: (ms) => sleep(Math.min(ms, 50)),
    env: { MAWS_ENDPOINT_DIRECT: '1' },
    direct: {
      interfaces: () => table.current,
      listen: loopback,
      limits: { perSource: { burst: 1000, perMinute: 60_000 }, overall: { burst: 1000, perMinute: 60_000 } },
    },
  });
  await endpoint.start(services);
  ref = services.machine.ref;
  const issued = (await (await hub.fetchAs(ADMIN, '/api/enrollments', { body: {} })).json()) as EnrollmentIssued;
  const code = encodeEnrollmentCodeV2({ hub: hub.url, token: issued.token, roots: [await keyId(a1.stepUp.pub)], recoveryPub: recovery.pub, k: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) });
  const enrolling = endpoint.cli('enroll', ['--name', 'm4-mini', '--wait', '30', '--json'], code);
  const key = await until(async () => {
    const response = await hub.fetchAs(ADMIN, `/api/enrollments/${issued.enrollment.id}/key`);
    return response.status === 200 ? ((await response.json()) as EnrollmentKey) : (await response.body?.cancel(), null);
  }, 'the posted key');
  await publish(await next((s) => {
    s.machines.push({ name: 'm4-mini', ref, pub: key.pub, owners: [A] });
    s.machineNames.push({ name: 'm4-mini', ref });
  }));
  expect((await enrolling).code).toBe(0);
  await until(() => endpoint.hub.connected, 'the hub link’s welcome');
  await until(() => endpoint.status().listener.bound, 'the direct listener bound');
  relay = await RelayDialer.open(hub.url, ref, credentials(ADMIN));
}, 120_000);

afterAll(async () => {
  relay?.close();
  await endpoint?.stop();
  services?.cleanup();
  await stopHub?.();
});

const base = (): Omit<SuiteContext, 'carrier' | 'dial'> => ({
  endpoint,
  services,
  ref,
  org: ORG,
  admin: { member: A, device: a1 },
  member: B,
  memberDevice: b1,
  chain: () => [...chain],
  next,
  publish,
});

channelSuite('over the hub’s multiplex', () => ({ ...base(), carrier: 'relayed', dial: () => relay.dial() }));
channelSuite('over the direct listener', () => ({ ...base(), carrier: 'direct', dial: () => dialDirect(`ws://127.0.0.1:${ports.get(TAILNET)}`) }));

describe('the direct listener', () => {
  it('bound only the tailnet address the table names', () => {
    expect(requested[0]).toBe(TAILNET);
    expect(requested).not.toContain('192.168.1.20');
    for (const address of requested) expect(['0.0.0.0', '::', '127.0.0.1']).not.toContain(address);
  });

  it('rebinds when the tailnet address changes, and the hub serves the endpoint record that names the new one', async () => {
    const first = (await (await hub.fetchAs(ADMIN, `/api/machines/${ref}/endpoint`)).json()) as MachineEndpoint;
    expect(first.record.body.addresses).toEqual([`ws://${TAILNET}:${ports.get(TAILNET)}`]);
    const moved = '100.90.1.2';
    table.current = { utun4: [v4(moved)] };
    await endpoint.direct!.rescan();
    const url = `ws://${moved}:${ports.get(moved)}`;
    const served = await until(async () => {
      const response = await hub.fetchAs(ADMIN, `/api/machines/${ref}/endpoint`);
      if (response.status !== 200) return void (await response.body?.cancel());
      const { record } = (await response.json()) as MachineEndpoint;
      return record.body.addresses.length === 1 && record.body.addresses[0] === url ? record : null;
    }, 'the new endpoint record served');
    expect(await verifyEndpointRecord(chain[chain.length - 1].state, served, NO_CERTIFICATES, new Date())).toEqual({ ok: true });
    expect(endpoint.status().listener).toEqual({ bound: true });
    const status = JSON.stringify(endpoint.status());
    expect(status).not.toContain(moved);
    expect(status).not.toContain(TAILNET);
  });
});

describe('stopping', () => {
  it('closes every channel, over either carrier, with a sealed `restart` before the carriers end', async () => {
    const admin = new Device({ identity: { org: ORG, member: A, device: 'a1', clientClass: 'native-mac', channelKey: a1.channel, build: 'stop', capabilities: [] }, org: memoryOrgView({ chain: [...chain] }) });
    const relayed = await admin.open(() => relay.dial(), ref);
    const direct = await admin.open(() => dialDirect(`ws://127.0.0.1:${ports.get('100.90.1.2')}`), ref);
    const reasons = Promise.all([relayed, direct].map((channel) => new Promise<string>((resolve) => channel.onClose(resolve))));
    expect(endpoint.status().channels).toEqual({ relayed: 1, direct: 1 });
    await endpoint.stop();
    expect(await reasons).toEqual(['restart', 'restart']);
    expect(endpoint.status().channels).toEqual({ relayed: 0, direct: 0 });
    expect(endpoint.status().listener).toEqual({ bound: false });
    expect(services.holds.size).toBe(0);
  });
});
