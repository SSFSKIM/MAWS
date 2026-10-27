// The endpoint's channels as its own standing changes (O10 M4's review): a new head that no longer lets this machine
// speak for its ref (its entry removed, its key rotated or revoked; for a certificate machine, its delegation dropped or
// its certificate's key revoked, RL §5.2) closes every channel `removed`, refuses new handshakes and shows the
// enrollment `hub-confirmed`; a `--replace` closes the channels authenticated under the old key with `restart`. An
// enrolled endpoint with no hub (its hub address refuses), its direct listener on a fake table listened on at loopback.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateSigningKey, keyId, memoryOrgView, NO_CERTIFICATES, signRecord, SIGNING_DOMAINS, type Certificates, type Channel, type MachineCert, type OrgState, type Signed, type SignedOrgState, type SigningKey } from 'org-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { TestDevice as Device } from '../../apps/org-protocol/test-support/test-device.ts';
import { createEndpoint, type Endpoint } from '../../src/endpoint';
import { EndpointOrg } from '../../src/endpoint/org-sync';
import { EndpointState } from '../../src/endpoint/state/store';
import { dialDirect } from './carriers';
import { fakeServices, mintRef, type FakeServices } from './fake-services';
import { genesis, memberId, newDevice, successor, type TestDevice } from './org-fixtures';

const ORG = 'org-standing';
const TAILNET = '100.101.102.103';
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Fixture = {
  endpoint: Endpoint;
  services: FakeServices;
  ref: string;
  key: SigningKey;
  a1: TestDevice;
  A: string;
  chain: SignedOrgState[];
  certificates: Certificates;
  port: () => number;
  delegation?: { id: string; key: SigningKey; cert: Signed<MachineCert> };
};
const started: Fixture[] = [];

afterEach(async () => {
  for (const f of started.splice(0)) {
    await f.endpoint.stop();
    f.services.cleanup();
  }
});

/** A started endpoint enrolled in ORG and listed (by its entry, or under `delegated` by its certificate), owned by A. */
async function enrolled(options: { delegated?: boolean } = {}): Promise<Fixture> {
  const A = memberId();
  const a1 = await newDevice('a1');
  const recovery = await generateSigningKey();
  const delegationKey = await generateSigningKey();
  const delegationId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  const services = fakeServices(options.delegated ? { ref: mintRef(delegationId) } : {});
  const ref = services.machine.ref;
  const name = options.delegated ? 'vm-one' : 'mini';
  const key = await generateSigningKey(true);
  const kid = await keyId(key.pub);
  const s1 = await genesis(ORG, A, a1, recovery);
  const s2 = await successor(s1, [a1], (s) => {
    if (options.delegated) {
      s.delegations.push({ id: delegationId, pub: delegationKey.pub, prefix: 'vm-', expires: new Date(Date.now() + 86_400_000).toISOString(), maxUses: 10, offlineRevokeS: 0, owners: [A] });
    } else {
      s.machines.push({ name, ref, pub: key.pub, owners: [A] });
      s.machineNames.push({ name, ref });
    }
  });
  const cert = options.delegated
    ? await signRecord(SIGNING_DOMAINS.machineCert, { org: ORG, machine: ref, name, pub: key.pub, delegation: delegationId, use: 1, issued: new Date().toISOString() }, delegationKey.privateKey, delegationKey.pub)
    : undefined;
  const certificates: Certificates = cert === undefined ? NO_CERTIFICATES : { certs: [cert], retirements: [] };
  const state = EndpointState.open(services.machine.stateDir);
  state.setMachineKey({ version: 1, keyId: kid, jwk: (await crypto.subtle.exportKey('jwk', key.privateKey)) as JsonWebKey, created: new Date().toISOString() });
  state.setLedger({ version: 1, heldKeys: [kid], grants: {}, highWater: {} });
  // The hub's address refuses (port 9): nothing here reaches a hub.
  state.setEnrollment({ version: 1, state: 'org-listed', name, ref, org: ORG, hub: 'http://127.0.0.1:9', enrollment: 'e'.repeat(32), credentials: { clientId: 'id', clientSecret: 'secret' }, at: new Date().toISOString(), ...(cert === undefined ? {} : { cert }) });
  state.setOrg({ version: 1, org: ORG, pinned: { roots: s1.state.root.keys, recoveryPub: recovery.pub }, head: null, chain: [], hashes: [], certificates, acceptedTransitions: [], highWater: 0 });
  await new EndpointOrg(state, { log: () => {} }).adopt([s1, s2], []);
  let port = 0;
  const listen = (server: Server) =>
    new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve((port = (server.address() as AddressInfo).port)));
    });
  const endpoint = createEndpoint({ sleep: (ms) => sleep(Math.min(ms, 50)), env: { MAWS_ENDPOINT_DIRECT: '1' }, direct: { interfaces: () => ({ utun4: [{ address: TAILNET, family: 'IPv4', internal: false, netmask: '255.255.255.255', mac: '00:00:00:00:00:00', cidr: null }] }), listen } });
  await endpoint.start(services);
  const f: Fixture = { endpoint, services, ref, key, a1, A, chain: [s1, s2], certificates, port: () => port, ...(cert === undefined ? {} : { delegation: { id: delegationId, key: delegationKey, cert } }) };
  started.push(f);
  for (let i = 0; port === 0; i++) {
    if (i > 200) throw new Error('the direct listener never bound');
    await sleep(10);
  }
  return f;
}

function open(f: Fixture): Promise<Channel> {
  const device = new Device({ identity: { org: ORG, member: f.A, device: 'a1', clientClass: 'native-mac', channelKey: f.a1.channel, build: 'standing', capabilities: [] }, org: memoryOrgView({ chain: [...f.chain], certificates: f.certificates }) });
  return device.open(() => dialDirect(`ws://127.0.0.1:${f.port()}`), f.ref);
}

/** Delivers `next` by hand (`mawsd endpoint revoke -`), as an admin would. */
async function deliver(f: Fixture, edit: (s: OrgState) => void | Promise<void>): Promise<void> {
  const next = await successor(f.chain[f.chain.length - 1], [f.a1], edit);
  const answer = await f.endpoint.cli('revoke', ['-'], JSON.stringify(next));
  expect(answer.code, answer.out).toBe(0);
  f.chain.push(next);
}

/** The channel's close, and whether it was told anything after the delivery. */
function watched(channel: Channel): { closed: Promise<string> } {
  return { closed: new Promise<string>((resolve) => channel.onClose((reason) => resolve(reason))) };
}

async function expectStoodDown(f: Fixture, closed: Promise<string>): Promise<void> {
  expect(await closed).toBe('removed');
  expect(f.endpoint.status().channels).toEqual({ relayed: 0, direct: 0 });
  expect(f.endpoint.status().enrollment).toBe('hub-confirmed');
  await expect(open(f)).rejects.toThrow();
  expect(f.services.lines).toContain('endpoint: a direct channel was refused: unavailable');
}

describe('a head that takes the machine’s own standing away', () => {
  it('closes every channel `removed`, refuses new ones and shows `hub-confirmed` when it removes the machine', async () => {
    const f = await enrolled();
    const { closed } = watched(await open(f));
    await deliver(f, async (s) => {
      s.machines = s.machines.filter((m) => m.ref !== f.ref);
      s.retired.push({ keyId: await keyId(f.key.pub), pub: f.key.pub, notAfter: s.issued, holder: { machine: f.ref } });
    });
    await expectStoodDown(f, closed);
  });

  it('does the same when it rotates the machine to another key', async () => {
    const f = await enrolled();
    const { closed } = watched(await open(f));
    const rotated = await generateSigningKey();
    await deliver(f, async (s) => {
      s.machines.find((m) => m.ref === f.ref)!.pub = rotated.pub;
      s.retired.push({ keyId: await keyId(f.key.pub), pub: f.key.pub, notAfter: s.issued, holder: { machine: f.ref } });
    });
    await expectStoodDown(f, closed);
  });

  it('does the same for a certificate machine whose delegation it drops', async () => {
    const f = await enrolled({ delegated: true });
    const { closed } = watched(await open(f));
    const { id, key } = f.delegation!;
    await deliver(f, async (s) => {
      s.delegations = s.delegations.filter((d) => d.id !== id);
      s.revoked.push({ keyId: await keyId(key.pub), holder: { delegation: id, prefix: 'vm-' } });
    });
    await expectStoodDown(f, closed);
  });

  it('does the same for a certificate machine whose certificate’s key it revokes', async () => {
    const f = await enrolled({ delegated: true });
    const { closed } = watched(await open(f));
    await deliver(f, async (s) => void s.revoked.push({ keyId: await keyId(f.key.pub), holder: { machine: f.ref } }));
    await expectStoodDown(f, closed);
  });

  it('leaves the channels alone on a head that keeps the machine as it is', async () => {
    const f = await enrolled();
    const channel = await open(f);
    await deliver(f, () => {});
    await sleep(100);
    expect(channel.closed).toBe(false);
    expect(f.endpoint.status().enrollment).toBe('org-listed');
    expect(f.endpoint.status().channels.direct).toBe(1);
  });
});

describe('a re-enrollment under a new key (`--replace`)', () => {
  it('closes the channels authenticated under the old key with `restart`', async () => {
    const f = await enrolled();
    const { closed } = watched(await open(f));
    f.endpoint.enrollContext().keyChanged(await generateSigningKey());
    expect(await closed).toBe('restart');
    expect(f.endpoint.status().channels.direct).toBe(0);
  });
});
