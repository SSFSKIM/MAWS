// The RL2 links' source (P5 O7 M1, "The roster and the manager"): the roster a handshake can succeed with, recomputed on
// every change of the org session, and the network watch.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { NetworkInterfaceInfo } from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSigningKey, keyId, memoryOrgView, signRecord, SIGNING_DOMAINS, type Certificates, type SigningKey } from 'org-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { MachineRef } from '@shared/machine/ref';
import { genesis, memberId, newDevice, successor } from '../../../../test/endpoint/org-fixtures';
import { heldOrgSession, watchedView, type SignedIn } from '../../org/session';
import { createRemoteSource, rosterOf } from './source';

const dirs: string[] = [];
const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ref = (prefix?: string) => `${prefix === undefined ? '' : `${prefix}_`}${randomBytes(16).toString('base64url')}` as MachineRef;
const until = async (check: () => boolean, ms = 3000) => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

async function org(expiresInMs = 86_400_000) {
  const a1 = await newDevice('a1');
  const A = memberId();
  const delegation = { id: randomBytes(16).toString('hex'), key: await generateSigningKey() };
  const LOCAL = ref();
  const MINI = ref();
  const LIVE = ref(delegation.id);
  const RETIRED = ref(delegation.id);
  const CONTESTED = ref(delegation.id);
  const s1 = await genesis('org-s', A, a1, await generateSigningKey());
  const keys = { mini: await generateSigningKey(), local: await generateSigningKey() };
  const head = await successor(s1, [a1], (s) => {
    s.machines.push({ name: 'mini', ref: MINI, pub: keys.mini.pub, owners: [A] }, { name: 'this-mac', ref: LOCAL, pub: keys.local.pub, owners: [A] });
    s.machineNames.push({ name: 'mini', ref: MINI }, { name: 'this-mac', ref: LOCAL });
    s.delegations.push({ id: delegation.id, pub: delegation.key.pub, prefix: 'vm-', expires: new Date(Date.now() + expiresInMs).toISOString(), maxUses: 10, offlineRevokeS: 0, owners: [A] });
  });
  const cert = async (machine: MachineRef, name: string, key: SigningKey) =>
    signRecord(SIGNING_DOMAINS.machineCert, { org: 'org-s', machine, name, pub: key.pub, delegation: delegation.id, use: 1, issued: new Date().toISOString() }, delegation.key.privateKey, delegation.key.pub);
  const retiredKey = await generateSigningKey();
  const certificates: Certificates = {
    certs: [
      await cert(LIVE, 'vm-one', await generateSigningKey()),
      await cert(RETIRED, 'vm-two', retiredKey),
      await cert(CONTESTED, 'vm-three', await generateSigningKey()),
      await cert(CONTESTED, 'vm-three', await generateSigningKey()),
    ],
    retirements: [await signRecord(SIGNING_DOMAINS.certRetire, { org: 'org-s', keyId: await keyId(retiredKey.pub), notAfter: new Date().toISOString() }, delegation.key.privateKey, delegation.key.pub)],
  };
  return { a1, A, s1, head, certificates, LOCAL, MINI, LIVE, keys };
}

async function signedIn(o: Awaited<ReturnType<typeof org>>, onAdopted: () => void = () => {}): Promise<SignedIn> {
  return {
    identity: { org: 'org-s', member: o.A, device: 'a1', clientClass: 'native-mac', channelKey: o.a1.channel, build: 't', capabilities: [] },
    view: watchedView(memoryOrgView({ chain: [o.s1, o.head], certificates: o.certificates }), onAdopted),
    stepUp: { sign: async () => ({ ok: false, reason: 'cancelled' }) },
    hub: null,
  };
}

describe('the roster', () => {
  it('lists the head’s machines and live certificates, leaving out this machine, a retired certificate and a contested ref', async () => {
    const o = await org();
    expect(await rosterOf(await signedIn(o), o.LOCAL, new Date())).toEqual(
      [
        { ref: o.MINI, name: 'mini' },
        { ref: o.LIVE, name: 'vm-one' },
      ].sort((a, b) => a.ref.localeCompare(b.ref)),
    );
    expect(await rosterOf(null, o.LOCAL, new Date())).toEqual([]);
  });

  it('is recomputed at each change of the session, renames included, and empty signed out', async () => {
    const o = await org();
    const dir = mkdtempSync(join(tmpdir(), 'maws-source-'));
    dirs.push(dir);
    const session = heldOrgSession();
    const held = await signedIn(o, () => session.changed());
    session.set(held);
    const source = createRemoteSource({ session, local: o.LOCAL, userData: dir, log: () => {}, linkDeps: { records: { resolve: async () => null } } });
    closers.push(() => source.close());
    let heard = 0;
    source.onChanged(() => void (heard += 1));
    await until(() => source.machines().length === 2);
    const renamed = await successor(o.head, [o.a1], (s) => {
      s.machines[0].name = 'mini-renamed';
      s.machineNames.push({ name: 'mini-renamed', ref: o.MINI });
    });
    await held.view.advance([renamed], []);
    await until(() => source.machines().some((m) => m.name === 'mini-renamed'));
    session.set(null);
    await until(() => source.machines().length === 0);
    expect(heard).toBeGreaterThanOrEqual(2);
  });

  it('drops a delegated machine when its delegation expires, with no change to the session', async () => {
    const o = await org(2000);
    const dir = mkdtempSync(join(tmpdir(), 'maws-source-'));
    dirs.push(dir);
    const session = heldOrgSession(await signedIn(o));
    const source = createRemoteSource({ session, local: o.LOCAL, userData: dir, log: () => {}, linkDeps: { records: { resolve: async () => null } } });
    closers.push(() => source.close());
    await until(() => source.machines().some((m) => m.ref === o.LIVE));
    await until(() => !source.machines().some((m) => m.ref === o.LIVE), 4000);
    expect(source.machines()).toEqual([{ ref: o.MINI, name: 'mini' }]);
  });
});

describe('the network watch', () => {
  it('probes every link when the set of non-internal addresses changes', async () => {
    const o = await org();
    const dir = mkdtempSync(join(tmpdir(), 'maws-source-'));
    dirs.push(dir);
    const session = heldOrgSession(await signedIn(o));
    const v4 = (address: string, internal = false): NetworkInterfaceInfo => ({ address, family: 'IPv4', internal, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: null });
    const table: { current: NodeJS.Dict<NetworkInterfaceInfo[]> } = { current: { lo0: [v4('127.0.0.1', true)], en0: [v4('192.168.1.2')] } };
    const logs: string[] = [];
    const source = createRemoteSource({ session, local: o.LOCAL, userData: dir, log: (l) => void logs.push(l), networkPollMs: 10, interfaces: () => table.current, linkDeps: { records: { resolve: async () => null } } });
    closers.push(() => source.close());
    await until(() => source.machines().length === 2);
    const link = source.connect(source.machines()[0]);
    closers.push(() => link.close());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(logs.filter((l) => l.includes('network changed'))).toEqual([]);
    table.current = { lo0: [v4('127.0.0.2', true)], en0: [v4('192.168.1.2')] }; // an internal change is not one
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(logs.filter((l) => l.includes('network changed'))).toEqual([]);
    table.current = { en0: [v4('10.0.0.7')] };
    await until(() => logs.some((l) => l.includes('network changed')));
    expect(source.link(source.machines()[0].ref)).toBe(link);
  });
});
