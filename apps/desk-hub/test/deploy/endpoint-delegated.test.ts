// A delegated machine as the endpoint acceptance run meets it (P5 O10 M11, item 7 attempt 3): production's machine
// (dc-acceptance-7f80, B1 1b) holds no key in the org state, only a machine certificate under a delegation the state
// lists, which the hub serves beside the state. The run's device and its checks take the machine's keys from both, as
// a real client does (desk-web's org view): the channel opens, and the machine's listing and events verify.
import { acceptChannel, generateSigningKey, memoryOrgView, NO_CERTIFICATES, signEvent, type Certificates, type SignedOrgState, type SigningKey } from 'org-protocol';
import { duplexPair } from 'org-protocol/test-support';
import { beforeAll, describe, expect, it } from 'vitest';
import { readOrgState } from '../../deploy/endpoint-acceptance';
import { eventVerdict, listingVerdict } from '../../deploy/endpoint-items';
import { testDevice, type RunDevice } from '../../deploy/endpoint-remote';
import { certify, listing, mintRef, type DelegationKey } from '../../fake-machine/org';
import type { Person } from '../../deploy/hub';
import type { OrgStateView } from '../../src/protocol/identity';
import { genesis, memberId, newDevice, next, signedBy, type TestDevice } from '../support/org';

const ORG = 'org-delegated';
const PROJECT = '6f1c0a8e-3b2d-4c5e-9f70-000000000007';
const SESSION = '0f3e8a52-7c1d-4b9e-9a61-2d4f6b8c0e13';

let member: string;
let a1: TestDevice;
let chain: SignedOrgState[];
let certificates: Certificates;
let vm: { org: string; ref: string; name: string; key: SigningKey; use: number };
let owner: RunDevice;

beforeAll(async () => {
  member = memberId();
  a1 = await newDevice('a1');
  const v1 = await signedBy(await genesis(ORG, member, 'owner@delegated.invalid', a1, await generateSigningKey()), a1);
  const delegation: DelegationKey = { id: 'd'.repeat(32), key: await generateSigningKey() };
  const v2 = await signedBy(
    await next(v1, (s) => s.delegations.push({ id: delegation.id, pub: delegation.key.pub, prefix: 'vm-', expires: '2099-01-01T00:00:00.000Z', maxUses: 10, offlineRevokeS: 0, owners: 'org' })),
    a1,
  );
  chain = [v1, v2];
  vm = { org: ORG, ref: mintRef(delegation.id), name: 'vm-1', key: await generateSigningKey(), use: 1 };
  certificates = { certs: [await certify(vm, delegation)], retirements: [] };
  owner = { member, id: a1.device.id, clientClass: 'native-mac', channel: a1.channel, stepUp: a1.stepUp };
});

/** The run's device opening a channel to the delegated machine over an in-memory carrier: its outcome. */
async function open(view: { chain: SignedOrgState[]; certificates: Certificates }): Promise<string> {
  const io = duplexPair();
  const machine = acceptChannel(io[1], { ref: vm.ref, key: vm.key, build: 'mawsd-test', capabilities: [] }, memoryOrgView({ chain }), { timeoutMs: 5000 });
  // The endpoint speaks first once it has accepted (`caps`, as M4's does): the device's open completes on it.
  machine.then((accepted) => accepted.channel.send({ t: 'caps', member: accepted.peer.member }), () => {});
  try {
    const channel = await testDevice(ORG, owner, view).open(() => io[0], vm.ref, { timeoutMs: 5000 });
    channel.close('done');
    return 'opened';
  } catch (error) {
    return (error as { reason?: string }).reason ?? String(error);
  }
}

describe('a delegated machine, its keys under the certificates the hub serves', () => {
  it('opens the run device’s channel when the device holds the certificates, as a real client does', async () => {
    expect(await open({ chain, certificates })).toBe('opened');
  });

  it('is an unknown machine to a device that holds the state alone (attempt 3’s `unknown-machine`)', async () => {
    expect(await open({ chain, certificates: NO_CERTIFICATES })).toBe('unknown-machine');
  });

  it('verifies the machine’s listing and its events against the head and the certificates', async () => {
    const scene = { chain: () => chain, certificates: () => certificates, org: ORG, laneA: { project: PROJECT } };
    const signed = await listing(vm, SESSION, 1, { owners: [member], project: PROJECT, lane: 'A', state: 'idle', title: 'lane A' });
    expect(await listingVerdict(scene, signed)).toMatchObject({ ok: true });
    expect(await listingVerdict({ ...scene, certificates: () => NO_CERTIFICATES }, signed)).toMatchObject({ ok: false });
    const at = new Date().toISOString();
    const event = await signEvent({ org: ORG, project: PROJECT }, { ts: at, created: at, writer: `vm-1/${SESSION}`, seq: 1, kind: 'say', from: 'vm-1', to: '*', text: 'lane A' }, vm.key.privateKey, vm.key.pub);
    expect(await eventVerdict(scene, event)).toMatchObject({ ok: true });
    expect(await eventVerdict({ ...scene, certificates: () => NO_CERTIFICATES }, event)).toMatchObject({ ok: false, code: 'unknown-signer' });
  });
});

describe('the org state the run reads', () => {
  it('carries the delegated machines’ certificates the hub serves with the chain, from its last page', async () => {
    const pages: OrgStateView[] = [
      { head: chain[1], transitions: [], certificates: NO_CERTIFICATES, chain: [chain[0]], more: true },
      { head: chain[1], transitions: [], certificates, chain: [chain[1]], more: false },
    ];
    const asked: string[] = [];
    const person = { json: async (path: string) => (asked.push(path), pages[asked.length - 1]) } as unknown as Person;
    const read = await readOrgState(person);
    expect(read.chain).toEqual(chain);
    expect(read.certificates).toEqual(certificates);
    expect(asked).toEqual(['/api/org/state?since=0', `/api/org/state?since=${chain[0].state.version}`]);
  });
});
