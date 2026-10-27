// `deployment relay-measure` (O11 M8, U2) and the test device's admin guard it writes the org state under
// (deploy/org-admin.ts), against the local hub: the admin signs only onto a chain whose genesis the configuration pins,
// and only as a root device the head holds; the run lists a machine, measures sealed round trips and throughput through
// the Machine DO with every echo checked, gives the tailnet verdict, and leaves the machine out of the state, its key
// retired, and revoked.
import { join } from 'node:path';
import { keyId, stateHash, type SignedOrgState } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { deviceEntry, OrgAdmin, type AdminDevice } from '../../deploy/org-admin.ts';
import { Cleanup } from '../../deploy/proof.ts';
import { RelayApp } from 'org-protocol/test-support';
import { FakeEndpoint } from '../../fake-machine/endpoint.ts';
import { main, measure, percentile, relayMeasure, tailnetVerdict, VERDICT_P95_MS } from '../../deploy/relay-measure.ts';
import { frameSeq, SEALED_OVERHEAD, sealedFrame } from '../../deploy/rl1.ts';
import { ADMIN, ORG, startLocalHub, type LocalHub } from '../support/local';
import { adminKeysFile, LocalPerson } from '../support/local-person';
import { genesis, signedBy } from '../support/org';

// Where the commands find the app's files (bin.ts defines it when it bundles them).
process.env.DESK_HUB_APP ??= join(import.meta.dirname, '../..');
const STAGING = join(import.meta.dirname, '../../deploy/staging.json');

let hub: LocalHub;
let person: LocalPerson;
let device: AdminDevice;
let head: SignedOrgState;
let pinned: string;

beforeAll(async () => {
  hub = await startLocalHub();
  person = new LocalPerson(hub);
  device = (await adminKeysFile()).device;
});
afterAll(() => hub?.close());

const machines = async () => ((await person.json<{ machines: Array<{ name: string }> }>('/api/machines')).machines).map((m) => m.name);

describe('the test device as the org’s admin', () => {
  it('posts no genesis in the configuration’s own org, nor writes an org the deployment does not serve', async () => {
    await expect(OrgAdmin.open(person, { org: ORG, pinnedGenesis: 'anything' }, device, () => {})).rejects.toThrow(/serves no org state/);
    await expect(OrgAdmin.open(person, { org: 'staging-elsewhere', throwaway: true }, device, () => {})).rejects.toThrow(/serves the org org-local/);
    expect((await person.json<{ head: unknown }>('/api/org/state')).head).toBeNull();
  });

  it('signs only onto the genesis the configuration pins, as a root device the head holds', async () => {
    const A = (await person.json<{ member: { id: string } }>('/api/me')).member.id;
    const testDevice = { device: deviceEntry(device), channel: device.channel, stepUp: device.stepUp };
    head = await signedBy(await genesis(ORG, A, ADMIN, testDevice, device.recovery), testDevice);
    await person.json('/api/org/state', { body: head }, 201);
    pinned = await stateHash(head.state);

    await expect(OrgAdmin.open(person, { org: ORG, pinnedGenesis: undefined }, device, () => {})).rejects.toThrow(/pins no orgGenesis/);
    await expect(OrgAdmin.open(person, { org: ORG, pinnedGenesis: 'IYk7xTsTWsrPWYrfBSH6s5A5Fh4t11NtcuMnmrKreLc' }, device, () => {})).rejects.toThrow(/hashes to .*not the pinned/);
    const stranger = (await adminKeysFile()).device;
    await expect(OrgAdmin.open(person, { org: ORG, pinnedGenesis: pinned }, stranger, () => {})).rejects.toThrow(/does not hold device a1/);
    const admin = await OrgAdmin.open(person, { org: ORG, pinnedGenesis: pinned }, device, () => {});
    expect(admin.head.state.version).toBe(1);
  });
});

describe('relay-measure', () => {
  it('measures round trips and throughput through the Machine DO, gives the verdict, and undoes its machine', async () => {
    const lines: string[] = [];
    const cleanup = new Cleanup();
    const measured = await relayMeasure(person, { org: ORG, pinnedGenesis: pinned }, device, { samples: 10, seconds: 1, window: 2 }, cleanup, (line) => lines.push(line));
    expect(measured.opens.samples).toBe(10);
    expect(measured.roundTrips.map((t) => [t.plaintext, t.sealed, t.samples])).toEqual([
      [1024, 1024 + SEALED_OVERHEAD, 10],
      [65536, 65536 + SEALED_OVERHEAD, 20],
    ]);
    for (const t of measured.roundTrips) {
      expect(t.p50).toBeLessThanOrEqual(t.p95);
      expect(t.p95).toBeLessThanOrEqual(t.p99);
    }
    expect(measured.throughput).toMatchObject({ plaintext: 262144, window: 2 });
    expect(measured.throughput.frames).toBeGreaterThan(2);
    expect(lines.join('\n')).toMatch(/round trip, 1 KiB frames \(1048 B sealed\): 10 samples, p50 [\d.]+ ms, p95 [\d.]+ ms, p99 [\d.]+ ms/);
    expect(lines.join('\n')).toMatch(/round trip, 64 KiB frames \(65560 B sealed\): 20 samples/);
    expect(lines.join('\n')).toMatch(/throughput, 256 KiB frames \(262168 B sealed\), 2 in flight/);
    expect(lines.at(-1)).toMatch(/^tailnet verdict: /);

    const name = /machine (m8-rm-[a-z0-9]+)/.exec(lines.join('\n'))![1];
    const listed = (await person.json<{ head: SignedOrgState }>('/api/org/state')).head.state.machines.find((m) => m.name === name)!;
    expect(listed.owners).toEqual([(await person.json<{ member: { id: string } }>('/api/me')).member.id]);
    expect(await machines()).toContain(name);

    expect(await cleanup.run()).toEqual([]);
    const after = (await person.json<{ head: SignedOrgState }>('/api/org/state')).head.state;
    expect(after.machines.some((m) => m.name === name)).toBe(false);
    expect(after.machineNames).toContainEqual({ name, ref: listed.ref });
    expect(after.retired).toContainEqual(expect.objectContaining({ keyId: await keyId(listed.pub), holder: { machine: listed.ref } }));
    expect(await machines()).not.toContain(name);
  });

  it('fails when an echo comes back altered', async () => {
    const cleanup = new Cleanup();
    try {
      const admin = await OrgAdmin.open(person, { org: ORG, pinnedGenesis: pinned }, device, () => {});
      const machine = await admin.listedMachine('m8-rm-altering', cleanup);
      // An endpoint that flips the last byte of every 64 KiB frame it echoes.
      const endpoint: FakeEndpoint = new FakeEndpoint({
        hub: person.hub,
        credentials: machine.credentials,
        ref: machine.ref,
        channels: { data: (channel, payload) => endpoint.sendData(channel, payload.length > 2048 ? payload.map((b, i) => (i === payload.length - 1 ? b ^ 1 : b)) : payload) },
      });
      cleanup.add('close', async () => endpoint.close());
      await endpoint.connect();
      const app = await RelayApp.open(person.hub, machine.ref, person.headers);
      cleanup.add('close the app', async () => app.close());
      await expect(measure(app, { samples: 2, seconds: 1, window: 1 }, () => {})).rejects.toThrow(/\(65560 B\) came back altered or out of order/);
    } finally {
      expect(await cleanup.run()).toEqual([]);
    }
  });

  it('refuses to run without the admin device, before reading a credential', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await main(['--config', STAGING])).toBe(2);
    expect(await main(['--config', STAGING, '--device-keys', 'x', '--samples', '0'])).toBe(2);
    expect(quiet.mock.calls.flat().join('\n')).toMatch(/--device-keys <file> is required[\s\S]*positive integers/);
    quiet.mockRestore();
  });
});

describe('the measurement’s parts', () => {
  it('takes nearest-rank percentiles', () => {
    const values = Array.from({ length: 100 }, (_, i) => 100 - i);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile([7], 95)).toBe(7);
    expect(() => percentile([], 50)).toThrow(/no samples/);
  });

  it('makes RL2-sized frames: a sequence number, then random bytes for the ciphertext and tag', () => {
    const frame = sealedFrame(1024, 2 ** 40 + 3);
    expect(frame.length).toBe(1024 + 24);
    expect(frameSeq(frame)).toBe(2 ** 40 + 3);
    expect(Buffer.from(sealedFrame(1024, 1)).equals(Buffer.from(sealedFrame(1024, 1)))).toBe(false);
  });

  it('recommends the tailnet as the default only past the 150 ms line', () => {
    expect(tailnetVerdict(VERDICT_P95_MS)).toMatch(/hub stays the default/);
    expect(tailnetVerdict(VERDICT_P95_MS + 0.1)).toMatch(/tailnet carrier the default/);
  });
});
