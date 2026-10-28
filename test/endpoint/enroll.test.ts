// Enrollment against desk-hub's local runner (O10 M2): attended (`mawsd endpoint enroll`, the code as the CLI's secret)
// end to end, with the member's side done as the admin's app does it; a hub that substitutes the machine's key, which
// the member's MAC check refuses; `busy` answered on the second try; `--replace`; and `enrollDelegated` under a
// delegation the member signs into the state.
import * as fs from 'node:fs';
import { join } from 'node:path';
import { base64urlEncode, generateSigningKey, keyId, signRecord, SIGNING_DOMAINS, type Grant } from 'org-protocol';
import { delegationFor, type ProvisioningKeyIssued } from 'desk-hub/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEndpoint, enrollDelegated, type Endpoint } from '../../src/endpoint';
import { fakeServices, mintRef, type FakeServices } from './fake-services';
import { startLocalHub, type LocalHub, type Member } from './local-hub';

let hub: LocalHub;
let member: Member;
const started: Array<{ endpoint: Endpoint; services: FakeServices }> = [];
const sleeps: number[] = [];

beforeAll(async () => {
  hub = await startLocalHub();
  member = await hub.admin();
}, 120_000);
afterAll(async () => {
  for (const { endpoint, services } of started) {
    await endpoint.stop();
    services.cleanup();
  }
  await hub?.stop();
});

/** A started endpoint on a scratch profile; its waits are cut short (each recorded), its fetches through `fetch`. */
async function endpointOn(options: { fetch?: typeof fetch; services?: FakeServices } = {}) {
  const services = options.services ?? fakeServices();
  const endpoint = createEndpoint({
    fetch: options.fetch,
    sleep: (ms) => {
      sleeps.push(ms);
      return new Promise((r) => setTimeout(r, Math.min(ms, 50)));
    },
  });
  await endpoint.start(services);
  started.push({ endpoint, services });
  return { endpoint, services };
}

const mode = (path: string) => fs.statSync(path).mode & 0o777;
const json = (out: string) => JSON.parse(out) as Record<string, unknown>;

describe('attended enrollment', () => {
  it('redeems the code, posts its key under the pairing MAC, and is org-listed once the member lists it', async () => {
    const { endpoint, services } = await endpointOn();
    const issued = await member.code();
    const enrolling = endpoint.cli('enroll', ['--name', 'mini', '--wait', '30', '--json'], issued.code);
    expect((await member.awaitPosted(issued.enrollment))?.ref).toBe(services.machine.ref);
    await member.list(issued.enrollment, issued.k);
    const result = await enrolling;
    expect(result.code).toBe(0);
    expect(json(result.out)).toMatchObject({ enrollment: 'org-listed', name: 'mini', org: 'local' });
    const dir = services.machine.stateDir;
    expect(mode(dir)).toBe(0o700);
    for (const name of ['machine-key.json', 'grants.json', 'enrollment.json', 'org.json']) expect(mode(join(dir, name))).toBe(0o600);
    const keys = await endpoint.cli('keys', ['--json']);
    expect(keys.code).toBe(0);
    expect(json(keys.out)).toMatchObject({ enrollment: 'org-listed', name: 'mini', org: 'local', ref: services.machine.ref });
    expect(endpoint.status()).toMatchObject({ enrollment: 'org-listed', name: 'mini', org: 'local', stateVersion: (await member.head()).state.version });
    // Neither the code, its pairing secret nor the service token's secret is written anywhere it could be read back.
    const enrollment = JSON.parse(fs.readFileSync(join(dir, 'enrollment.json'), 'utf8')) as { credentials: { clientSecret: string } };
    const said = [...services.lines, result.out, keys.out, JSON.stringify(endpoint.status())].join('\n');
    for (const secret of [issued.code, issued.token, base64urlEncode(issued.k), enrollment.credentials.clientSecret]) expect(said).not.toContain(secret);
    for (const name of fs.readdirSync(dir)) {
      if (fs.statSync(join(dir, name)).isFile()) expect(fs.readFileSync(join(dir, name), 'utf8')).not.toContain(base64urlEncode(issued.k));
    }
    // Enrolling again needs --replace.
    const again = await endpoint.cli('enroll', ['--name', 'mini'], (await member.code()).code);
    expect(again.code).toBe(1);
    expect(again.out).toMatch(/--replace/);
  });

  it('is never listed when the hub substitutes its key: the member’s MAC check refuses it', async () => {
    const attacker = await generateSigningKey();
    const substituting: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/machine/key') && typeof init?.body === 'string') {
        return fetch(input, { ...init, body: JSON.stringify({ ...(JSON.parse(init.body) as object), pub: attacker.pub }) });
      }
      return fetch(input, init);
    };
    const { endpoint } = await endpointOn({ fetch: substituting });
    const issued = await member.code();
    const result = await endpoint.cli('enroll', ['--name', 'swapped', '--json'], issued.code);
    expect(result.code).toBe(4);
    expect(json(result.out)).toMatchObject({ enrollment: 'hub-confirmed', name: 'swapped' });
    const { key, macOk } = await member.posted(issued.enrollment, issued.k);
    expect(key.pub).toBe(attacker.pub);
    expect(macOk).toBe(false);
    await expect(member.list(issued.enrollment, issued.k)).rejects.toThrow(/pairing secret/);
  });

  it('retries a busy redemption and is answered on the second try', async () => {
    let refusals = 0;
    const busyOnce: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/machine/enroll') && refusals === 0) {
        refusals++;
        return Response.json({ error: 'busy', message: 'a redemption of this token is in flight' }, { status: 409 });
      }
      return fetch(input, init);
    };
    const { endpoint } = await endpointOn({ fetch: busyOnce });
    sleeps.length = 0;
    const issued = await member.code();
    const result = await endpoint.cli('enroll', ['--name', 'busy-one', '--json'], issued.code);
    expect(refusals).toBe(1);
    expect(sleeps[0]).toBe(2000);
    expect(json(result.out)).toMatchObject({ enrollment: 'hub-confirmed' });
    expect(await member.awaitPosted(issued.enrollment, 0)).not.toBeNull();
  });

  it('re-enrolls with --replace: the same ref, a new key added to the held keys, a grant in force kept', async () => {
    const { endpoint, services } = await endpointOn();
    const first = await member.code();
    const enrolling = endpoint.cli('enroll', ['--name', 'studio', '--wait', '30'], first.code);
    await member.awaitPosted(first.enrollment);
    await member.list(first.enrollment, first.k);
    expect((await enrolling).code).toBe(0);
    const ledger = () => JSON.parse(fs.readFileSync(join(services.machine.stateDir, 'grants.json'), 'utf8')) as { heldKeys: string[]; grants: Record<string, unknown> };
    const [oldKey] = ledger().heldKeys;

    // The owner grants their own member `shell` on this machine's key, out of band.
    const grant: Grant = { org: 'local', machine: services.machine.ref, machineKey: oldKey, member: member.id, rights: ['shell'], version: 1, issued: new Date().toISOString() };
    const signed = await signRecord(SIGNING_DOMAINS.grant, grant, member.device.stepUp.privateKey, member.device.stepUp.pub);
    const file = join(services.machine.profileDir, 'grant.json');
    fs.writeFileSync(file, JSON.stringify(signed), { mode: 0o600 });
    expect((await endpoint.cli('grant', [file])).code).toBe(0);

    const again = await member.code('studio');
    // Re-enrolled, it is the hub's at once, but listed only once a state lists the new key: the old key's listing doesn't count.
    const replaced = await endpoint.cli('enroll', ['--replace', '--json'], again.code);
    expect(replaced.code).toBe(4);
    expect(json(replaced.out)).toMatchObject({ enrollment: 'hub-confirmed', name: 'studio', ref: services.machine.ref });
    const posted = await member.awaitPosted(again.enrollment, 0);
    expect(posted?.ref).toBe(services.machine.ref);
    await member.list(again.enrollment, again.k);
    // A read already in flight may predate the listing; the one after it doesn't.
    await endpoint.syncNow();
    await endpoint.syncNow();
    expect(endpoint.status()).toMatchObject({ enrollment: 'org-listed', name: 'studio' });
    const newKey = await keyId(posted!.pub);
    expect(ledger().heldKeys).toEqual([oldKey, newKey]);
    expect(Object.keys(ledger().grants)).toEqual([member.id]);
  });

  it('refuses a re-enrollment the hub answers with another org under the same pins, and keeps its high-water mark', async () => {
    let renaming = false;
    const renamingHub: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      if (!renaming || !String(input).endsWith('/machine/enroll') || response.status !== 200) return response;
      return Response.json({ ...((await response.json()) as object), org: 'elsewhere' });
    };
    const { endpoint, services } = await endpointOn({ fetch: renamingHub });
    const first = await member.code();
    const enrolling = endpoint.cli('enroll', ['--name', 'kept', '--wait', '30'], first.code);
    await member.awaitPosted(first.enrollment);
    await member.list(first.enrollment, first.k);
    expect((await enrolling).code).toBe(0);
    const orgFile = () => JSON.parse(fs.readFileSync(join(services.machine.stateDir, 'org.json'), 'utf8')) as { org: string; highWater: number; head: { state: { version: number } } | null };
    const before = orgFile();
    expect(before.highWater).toBeGreaterThan(1);

    renaming = true;
    const replaced = await endpoint.cli('enroll', ['--replace'], (await member.code('kept')).code);
    expect(replaced.code).toBe(1);
    expect(replaced.out).toMatch(/elsewhere/);
    expect(orgFile()).toMatchObject({ org: 'local', highWater: before.highWater, head: { state: { version: before.head!.state.version } } });
  });
});

describe('delegated enrollment', () => {
  it('redeems the provisioning token, certifies its own key with the delegation’s, and is live once the state accepts it', async () => {
    const issued = await member.person.json<ProvisioningKeyIssued>('/api/provisioning-keys', { body: { label: 'devcloud', prefix: 'vm-', max_uses: null, offline_revoke_s: null } }, 201);
    const delegationKey = await generateSigningKey(true);
    await member.amend('the devcloud delegation', (s) => void s.delegations.push(delegationFor(issued.key, delegationKey.pub, 'org')));
    const head = await member.head();
    const privateJwk = (await crypto.subtle.exportKey('jwk', delegationKey.privateKey)) as JsonWebKey;
    const input = { hub: hub.url, org: 'local', roots: head.state.root.keys, recoveryPub: head.state.root.recoveryPub, token: issued.token, delegation: { id: issued.key.id, prefix: issued.key.prefix, privateJwk }, name: 'vm-one' };

    // A ref minted under no delegation is refused before anything is redeemed.
    const stray = await endpointOn();
    await expect(enrollDelegated(input, stray.endpoint)).rejects.toThrow(/delegation/);

    const { endpoint, services } = await endpointOn({ services: fakeServices({ ref: mintRef(issued.key.id) }) });
    const state = await enrollDelegated(input, endpoint);
    expect(state).toMatchObject({ state: 'org-listed', name: 'vm-one', org: 'local', ref: services.machine.ref });
    expect(endpoint.status()).toMatchObject({ enrollment: 'org-listed', name: 'vm-one' });
    const view = await member.person.json<{ certificates: { certs: Array<{ body: { machine: string } }> } }>('/api/org/state');
    expect(view.certificates.certs.map((c) => c.body.machine)).toContain(services.machine.ref);
  });
});

// O14 M5a: a machine enrolled under a head that already retires the DX1 org key never held it in use, so the tombstone
// its first sync writes keeps no bytes, whatever legacy.json held before (as a provisioning code's would).
describe('an enrollment under a retired legacy key', () => {
  it('writes a tombstone without bytes at its first sync, asks sminos for nothing, and codes nothing', async () => {
    await member.amend('the legacy org key retired', (s) => void (s.legacyRetired = { version: s.version, at: s.issued }));
    const services = fakeServices();
    const legacyPath = join(services.machine.stateDir, 'legacy.json');
    const key = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
    fs.writeFileSync(legacyPath, JSON.stringify({ org: 'local', key }), { mode: 0o600 });
    const { endpoint } = await endpointOn({ services });
    try {
      const issued = await member.code();
      const enrolling = endpoint.cli('enroll', ['--name', 'retired-born', '--wait', '30', '--json'], issued.code);
      await member.awaitPosted(issued.enrollment);
      await member.list(issued.enrollment, issued.k);
      expect((await enrolling).code).toBe(0);
      const at = (await member.head()).state.legacyRetired!.at;
      expect(JSON.parse(fs.readFileSync(legacyPath, 'utf8'))).toEqual({ org: 'local', retired: at });
      expect(mode(legacyPath)).toBe(0o600);
      expect(endpoint.status()).toMatchObject({ enrollment: 'org-listed', legacyKey: false, legacyRetired: true });
      expect((await endpoint.cli('legacy', ['status'])).out).toBe('purged');
    } finally {
      await member.amend('the legacy org key back in use', (s) => void delete s.legacyRetired);
    }
  });
});
