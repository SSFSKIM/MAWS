// `deployment acceptance` (O11 M8) against the local hub, set up as staging is: an org whose genesis the test device
// signed and the configuration pins. Every item passes (2: a delegated VM's certificate served beside the state; 3: the
// frames and the 1 MiB refusal; 4: the three event codings stored, bad signatures refused, the resend and the
// re-signing told apart, from the machine and the device; 5: the owner-only push read with the subscription's keys;
// 6: the reference client's three sockets), and once its cleanup runs the head lists none of what it made, with the
// delegation's key revoked and the machine's retired.
import { join } from 'node:path';
import { keyId, stateHash, type SignedOrgState } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { acceptance, afterCleanup, main } from '../../deploy/acceptance.ts';
import { deviceEntry, type AdminDevice } from '../../deploy/org-admin.ts';
import { Cleanup } from '../../deploy/proof.ts';
import type { PushSink } from '../../deploy/push-sink.ts';
import { ADMIN, ORG, startLocalHub, type LocalHub } from '../support/local';
import { adminKeysFile, LocalPerson } from '../support/local-person';
import { genesis, next, signedBy } from '../support/org';

process.env.DESK_HUB_APP ??= join(import.meta.dirname, '../..');
const STAGING = join(import.meta.dirname, '../../deploy/staging.json');

let hub: LocalHub;
let person: LocalPerson;
let device: AdminDevice;
let pinned: string;

/** The local runtime's outbound pushes, as a push service would receive them. */
const localSink = (): PushSink => ({
  endpoint: (name) => `https://push.test/${name}`,
  received: (endpoint) => hub.pushes.filter((p) => p.endpoint === endpoint).map((p) => p.body),
  close: async () => {},
});

beforeAll(async () => {
  hub = await startLocalHub();
  person = new LocalPerson(hub);
  device = (await adminKeysFile()).device;
  const A = (await person.json<{ member: { id: string } }>('/api/me')).member.id;
  const testDevice = { device: deviceEntry(device), channel: device.channel, stepUp: device.stepUp };
  const head = await signedBy(await genesis(ORG, A, ADMIN, testDevice, device.recovery), testDevice);
  await person.json('/api/org/state', { body: head }, 201);
  pinned = await stateHash(head.state);
  // As staging's chain, past its genesis: so an older version can be posted.
  await person.json('/api/org/state', { body: await signedBy(await next(head), testDevice) }, 201);
});
afterAll(() => hub?.close());

const headState = async () => (await person.json<{ head: SignedOrgState }>('/api/org/state')).head.state;

describe('acceptance', () => {
  it('passes every item against the hub, and its cleanup leaves none of what it made current', async () => {
    const printed: string[] = [];
    const cleanup = new Cleanup();
    const before = (await headState()).version;
    const { report, made } = await acceptance(person, { org: ORG, pinnedGenesis: pinned }, device, { items: ['2', '3', '4', '5', '6'], frames: 200, sink: localSink() }, cleanup, (line) => printed.push(line));
    const failed = report.lines.filter((l) => l.status !== 'pass');
    expect(failed).toEqual([]);
    const checks = (item: string) => report.lines.filter((l) => l.item === item).map((l) => l.check);
    expect(checks('2')).toEqual(['a successor off the head, and an older version', 'a member added', 'a second device', 're-issued as a delegation', 'a delegated VM enrolls', 'the certificate is served beside the state']);
    expect(checks('3')).toEqual(['frames', 'over 1 MiB']);
    expect(checks('4')).toHaveLength(9);
    expect(checks('5')).toEqual(['a subscription bound to the device', 'the owner’s session reaches the owner’s device', 'another member’s session reaches none of the owner’s devices']);
    expect(checks('6')).toEqual(['admitted', 'sockets', 'registry', 'project', 'machine', 'push', 'held']);
    expect(printed.join('\n')).toMatch(/PASS 3 frames: 200 frames of 1 B to 256 KiB \(\d+ B\) came back byte-identical and in order/);
    expect(printed.join('\n')).toMatch(/PASS 3 over 1 MiB: .* closed the app's socket 1009 too-large/);
    expect(printed.join('\n')).toMatch(/PASS 5 the owner’s session reaches the owner’s device: one notice, .*exactly \{"kind":"waiting","machine":"[\w-]+","project":"[0-9a-f-]+","session":"[0-9a-f-]+"\}/);

    // While it ran: the delegation and the machine were current.
    const during = await headState();
    expect(during.delegations.map((d) => d.id)).toEqual(made.delegations);
    expect(during.machines.map((m) => m.name)).toEqual(made.machines.filter((n) => n.startsWith('m8-ep-')));

    expect(await cleanup.run()).toEqual([]);
    expect(await afterCleanup(person, made)).toEqual([]);
    const after = await headState();
    expect(after.version).toBeGreaterThan(before);
    expect(after.machines).toEqual([]);
    expect(after.delegations).toEqual([]);
    expect(after.members.map((m) => m.email)).toEqual([ADMIN]);
    expect(after.revoked.filter((r) => 'member' in r.holder && r.holder.member === made.members[0])).toHaveLength(4);
    const delegationKid = after.revoked.find((r) => 'delegation' in r.holder && r.holder.delegation === made.delegations[0]);
    expect(delegationKid?.holder).toEqual({ delegation: made.delegations[0], prefix: expect.stringMatching(/^m8-vm-[a-z0-9]+-$/) });
    const machine = during.machines[0];
    expect(after.retired).toContainEqual(expect.objectContaining({ keyId: await keyId(machine.pub), holder: { machine: machine.ref } }));
    expect((await person.json<{ subscriptions: unknown[] }>('/api/push/subscriptions')).subscriptions).toEqual([]);
    const certs = (await person.json<{ certificates: { certs: unknown[]; retirements: unknown[] } }>('/api/org/state')).certificates;
    expect(certs.retirements).toHaveLength(1);
  }, 180_000);

  it('skips the push without a sink, and the rest still passes', async () => {
    const cleanup = new Cleanup();
    const { report, made } = await acceptance(person, { org: ORG, pinnedGenesis: pinned }, device, { items: ['5'], frames: 2 }, cleanup, () => {});
    expect(report.lines.map((l) => [l.item, l.status])).toEqual([
      ['3-6', 'pass'],
      ['5', 'skip'],
    ]);
    expect(report.ok).toBe(true);
    expect(await cleanup.run()).toEqual([]);
    expect(await afterCleanup(person, made)).toEqual([]);
  });

  it('refuses a deployment whose genesis is not the pinned one before it makes anything', async () => {
    const cleanup = new Cleanup();
    await expect(acceptance(person, { org: ORG, pinnedGenesis: 'not-the-genesis' }, device, { items: ['3'], frames: 2 }, cleanup, () => {})).rejects.toThrow(/not the pinned/);
    expect(await cleanup.run()).toEqual([]);
  });

  it('refuses bad options before reading a credential', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await main(['--config', STAGING])).toBe(2);
    expect(await main(['--config', STAGING, '--device-keys', 'x', '--items', '1,2'])).toBe(2);
    expect(await main(['--config', STAGING, '--device-keys', 'x', '--push-url', 'https://sink.example'])).toBe(2);
    expect(await main(['--config', STAGING, '--device-keys', 'x', '--test-org', 'staging-ssfskim'])).toBe(2);
    expect(quiet.mock.calls.flat().join('\n')).toMatch(/--device-keys <file> is required[\s\S]*--items names items[\s\S]*--push-url and --push-port go together[\s\S]*configuration's own org/);
    quiet.mockRestore();
  });
});
