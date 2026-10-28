// `status()` (O10 M2): `daemon.status`'s `endpoint.detail`, which a remote caller reads too, holds no path, no address, no
// key material and no credential. The walk allows the public `headHash` and fails on any other string that looks like a
// path, an IP address, or a base64url run of 43 characters or more (a P-256 point, a signature, a secret); a held
// delegation is said as `delegated` alone.
import * as fs from 'node:fs';
import { join } from 'node:path';
import { generateSigningKey, keyId, NO_CERTIFICATES, stateHash } from 'org-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { createEndpoint } from '../../src/endpoint';
import { EndpointOrg } from '../../src/endpoint/org-sync';
import { EndpointState } from '../../src/endpoint/state/store';
import { fakeServices, type FakeServices } from './fake-services';
import { genesis, memberId, newDevice, successor } from './org-fixtures';

const PATH = /[/\\]|^~/;
const IP = /\b\d{1,3}(?:\.\d{1,3}){3}\b|\b[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}\b/i;
const LONG_B64 = /[A-Za-z0-9_-]{43,}/;

/** Every string in `value` with its path, except the allowed `headHash`. */
function strings(value: unknown, at = '$'): Array<{ at: string; text: string }> {
  if (typeof value === 'string') return [{ at, text: value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${at}[${i}]`));
  if (typeof value === 'object' && value !== null) return Object.entries(value).flatMap(([k, v]) => (at === '$' && k === 'headHash' ? [] : strings(v, `${at}.${k}`)));
  return [];
}
const leaks = (status: unknown) => strings(status).filter(({ text }) => PATH.test(text) || IP.test(text) || LONG_B64.test(text));

let services: FakeServices | undefined;
afterEach(() => services?.cleanup());

describe('status()', () => {
  it('reports an unenrolled endpoint in the shape the seam names', async () => {
    services = fakeServices();
    const endpoint = createEndpoint();
    expect(endpoint.status()).toMatchObject({ enrollment: 'none' });
    await endpoint.start(services);
    expect(endpoint.status()).toEqual({
      enrollment: 'none',
      hub: { connected: false },
      channels: { relayed: 0, direct: 0 },
      rl10: { connected: false },
      listener: { bound: false },
      legacyKey: false,
      legacyRetired: false,
      delegated: false,
    });
    await endpoint.stop();
  });

  it('holds nothing but the public headHash that looks like a path, an address or key material, for a synced endpoint', async () => {
    services = fakeServices();
    // An enrolled state on disk, with a head and secrets that must not surface.
    const state = EndpointState.open(services.machine.stateDir);
    const key = await generateSigningKey(true);
    const id = await keyId(key.pub);
    state.setMachineKey({ version: 1, keyId: id, jwk: (await crypto.subtle.exportKey('jwk', key.privateKey)) as JsonWebKey, created: new Date().toISOString() });
    state.setLedger({ version: 1, heldKeys: [id], grants: {}, highWater: {} });
    state.setEnrollment({
      version: 1,
      state: 'org-listed',
      name: 'mini',
      ref: services.machine.ref,
      org: 'org-local',
      hub: 'https://hub.example.com',
      enrollment: 'e'.repeat(32),
      credentials: { clientId: 'c'.repeat(32), clientSecret: 's'.repeat(64) },
      at: new Date().toISOString(),
    });
    const a1 = await newDevice('a1');
    const recovery = await generateSigningKey();
    const A = memberId();
    const first = await genesis('org-local', A, a1, recovery);
    // The head lists the machine: the standing the enrollment's `org-listed` claims is judged from it at start.
    const ref = services.machine.ref;
    const head = await successor(first, [a1], (s) => {
      s.machines.push({ name: 'mini', ref, pub: key.pub, owners: [A] });
      s.machineNames.push({ name: 'mini', ref });
    });
    state.setOrg({ version: 1, org: 'org-local', pinned: { roots: first.state.root.keys, recoveryPub: recovery.pub }, head: null, chain: [], hashes: [], certificates: NO_CERTIFICATES, acceptedTransitions: [], highWater: 0 });
    await new EndpointOrg(state, { log: () => {} }).adopt([first, head], []);
    fs.writeFileSync(join(services.machine.stateDir, 'legacy.json'), JSON.stringify({ org: 'org-local', key: 'k'.repeat(43) }), { mode: 0o600 });
    // A delegation held (O14 M1): its private key is in no answer, only that the machine holds one.
    const delegationKey = await generateSigningKey(true);
    const privateJwk = (await crypto.subtle.exportKey('jwk', delegationKey.privateKey)) as JsonWebKey;
    state.setDelegation({ version: 1, id: '0d1e2a3b4c5d6e7f8091a2b3c4d5e6f7', prefix: 'vm-', privateJwk });

    const endpoint = createEndpoint();
    await endpoint.start(services);
    const status = endpoint.status() as Record<string, unknown>;
    expect(status).toMatchObject({ enrollment: 'org-listed', name: 'mini', org: 'org-local', stateVersion: 2, headHash: await stateHash(head.state), legacyKey: true, legacyRetired: false, delegated: true });
    expect(leaks(status)).toEqual([]);
    expect(JSON.stringify(status)).not.toContain(privateJwk.d);
    // The walk itself catches what it should.
    expect(leaks({ ...status, extra: { dir: services.machine.stateDir, ip: '100.64.1.2', pub: key.pub } }).map((l) => l.at)).toEqual(['$.extra.dir', '$.extra.ip', '$.extra.pub']);
    await endpoint.stop();
  });

  it('says why its state is refused, with no path', async () => {
    services = fakeServices();
    fs.chmodSync(services.machine.stateDir, 0o755);
    const endpoint = createEndpoint();
    await endpoint.start(services);
    expect(endpoint.status()).toMatchObject({ enrollment: 'none', refusing: 'state-mode' });
    expect(leaks(endpoint.status())).toEqual([]);
    expect(services.lines.join('\n')).toContain(services.machine.stateDir);
    await endpoint.stop();
  });
});
