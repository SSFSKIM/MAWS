// `mawsd endpoint` commands that need no hub (O10 M2): the policy, a state delivered by hand (`revoke`), a grant kept
// out of band by the ledger's rule, the legacy key following the head's retirement, and the refusals around them; and
// O14 M1's local `unenroll` and `retire`'s refusal of an attended enrollment.
import * as fs from 'node:fs';
import { join } from 'node:path';
import { endorseDevice, generateSigningKey, keyId, NO_CERTIFICATES, SIGNING_DOMAINS, signRecord, type Grant, type SignedOrgState, type SigningKey } from 'org-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { encodeEnrollmentCodeV2 } from 'desk-hub/protocol';
import { createEndpoint, type Endpoint } from '../../src/endpoint';
import { EndpointOrg } from '../../src/endpoint/org-sync';
import { EndpointState } from '../../src/endpoint/state/store';
import { fakeServices, type FakeServices } from './fake-services';
import { genesis, memberId, newDevice, revokedDevice, successor, type TestDevice } from './org-fixtures';

let services: FakeServices;
afterEach(() => services?.cleanup());

const ORG = 'org-cli';
type Enrolled = { endpoint: Endpoint; head: SignedOrgState; a1: TestDevice; A: string; machineKey: string; recovery: SigningKey };

/** A started endpoint enrolled in ORG, whose head lists the machine owned by A. */
async function enrolled(): Promise<Enrolled> {
  services = fakeServices();
  const ref = services.machine.ref;
  const state = EndpointState.open(services.machine.stateDir);
  const key = await generateSigningKey(true);
  const machineKey = await keyId(key.pub);
  state.setMachineKey({ version: 1, keyId: machineKey, jwk: (await crypto.subtle.exportKey('jwk', key.privateKey)) as JsonWebKey, created: new Date().toISOString() });
  state.setLedger({ version: 1, heldKeys: [machineKey], grants: {}, highWater: {} });
  state.setEnrollment({ version: 1, state: 'org-listed', name: 'mini', ref, org: ORG, hub: 'http://127.0.0.1:9', enrollment: 'e'.repeat(32), credentials: { clientId: 'id', clientSecret: 'secret' }, at: new Date().toISOString() });
  const A = memberId();
  const a1 = await newDevice('a1');
  const recovery = await generateSigningKey();
  const s1 = await genesis(ORG, A, a1, recovery);
  const s2 = await successor(s1, [a1], (s) => {
    s.machines.push({ name: 'mini', ref, pub: key.pub, owners: [A] });
    s.machineNames.push({ name: 'mini', ref });
  });
  state.setOrg({ version: 1, org: ORG, pinned: { roots: s1.state.root.keys, recoveryPub: recovery.pub }, head: null, chain: [], hashes: [], certificates: NO_CERTIFICATES, acceptedTransitions: [], highWater: 0 });
  await new EndpointOrg(state, { log: () => {} }).adopt([s1, s2], []);
  const endpoint = createEndpoint();
  await endpoint.start(services);
  return { endpoint, head: s2, a1, A, machineKey, recovery };
}

const file = (name: string, value: unknown) => {
  const path = join(services.machine.profileDir, name);
  fs.writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  return path;
};

describe('policy', () => {
  it('prints the default, sets read-only and the ceiling as sminos does, and tells its listeners', async () => {
    const { endpoint } = await enrolled();
    expect((await endpoint.cli('policy', [])).out).toMatch(/^read-only: no\nceiling: settings .*\n\(the default/);
    const told: unknown[] = [];
    endpoint.policy.onChange((p) => told.push(p));
    const set = await endpoint.cli('policy', ['--read-only', 'on', '--ceiling', 'acceptEdits']);
    expect(set.code).toBe(0);
    expect(set.out).toBe('read-only: yes — no remote request above view is served, and nothing written outside this machine is delivered as words\nceiling: acceptEdits (set here)');
    expect(told).toEqual([{ read_only: true, ceiling: 'acceptEdits' }]);
    expect(JSON.parse(fs.readFileSync(join(services.machine.stateDir, 'policy.json'), 'utf8'))).toEqual({ read_only: true, ceiling: 'acceptEdits' });
    expect(JSON.parse((await endpoint.cli('policy', ['--ceiling', 'settings', '--json'])).out)).toEqual({ read_only: true, ceiling: 'settings', source: 'set' });
    expect((await endpoint.cli('policy', ['--ceiling', 'yolo'])).code).toBe(1);
    expect((await endpoint.cli('policy', ['--read-only', 'maybe'])).code).toBe(1);
  });

  it('takes sminos’s policy while none is set, and its own once one is', async () => {
    const { endpoint } = await enrolled();
    endpoint.policy.fromSminos({ read_only: true, ceiling: 'plan' });
    expect(endpoint.policy.current()).toEqual({ read_only: true, ceiling: 'plan', source: 'sminos' });
    await endpoint.cli('policy', ['--read-only', 'off']);
    expect(endpoint.policy.current()).toEqual({ read_only: false, ceiling: 'plan', source: 'set' });
  });
});

describe('revoke: a state delivered by hand', () => {
  it('adopts a successor that removes a device, and refuses one no root signed', async () => {
    const { endpoint, head, a1, A } = await enrolled();
    const B = memberId();
    const b1 = await newDevice('b1');
    const s3 = await successor(head, [a1], (s) => void s.members.push({ id: B, email: 'b@example.com', role: 'member', devices: [b1.device] }));
    const s4 = await successor(s3, [a1], async (s) => {
      s.members[1].devices = [];
      s.revoked.push(...(await revokedDevice(B, b1.device)));
    });
    expect(await endpoint.cli('revoke', [file('s3.json', { states: [s3] })])).toEqual({ code: 0, out: 'adopted: the org state is at version 3' });
    expect(await endpoint.cli('revoke', [file('s4.json', { states: [s4], transitions: [] })])).toEqual({ code: 0, out: 'adopted: the org state is at version 4' });
    expect(endpoint.status()).toMatchObject({ stateVersion: 4 });
    expect(services.lines.join('\n')).toMatch(/removed 0 member\(s\), 1 device\(s\), revoked 2 key\(s\)/);
    // Again: already held. From stdin: the same.
    expect(await endpoint.cli('revoke', ['-'], JSON.stringify(s4))).toEqual({ code: 0, out: 'already held: the org state is at version 4' });
    const forged = await successor(s4, [await newDevice('x1')]);
    expect(await endpoint.cli('revoke', ['-'], JSON.stringify([forged]))).toEqual({ code: 1, out: 'refused: not-root-signed' });
    expect(A).toBeTruthy();
  });
});

describe('grant: kept by the ledger’s rule', () => {
  const grantOf = (e: Enrolled, edit: Partial<Grant> = {}): Grant => ({ org: ORG, machine: services.machine.ref, machineKey: e.machineKey, member: e.A, rights: ['spawn'], version: 1, issued: new Date().toISOString(), ...edit });

  it('keeps an owner’s grant for the held key, then only a higher version', async () => {
    const e = await enrolled();
    const sign = (g: Grant, by = e.a1) => signRecord(SIGNING_DOMAINS.grant, g, by.stepUp.privateKey, by.stepUp.pub);
    expect(await e.endpoint.cli('grant', [file('g1.json', await sign(grantOf(e)))])).toEqual({ code: 0, out: `kept: version 1 for member ${e.A}, spawn` });
    expect((await e.endpoint.cli('grant', [file('g1b.json', await sign(grantOf(e)))])).out).toBe('refused: not-newer');
    expect((await e.endpoint.cli('grant', ['-'], JSON.stringify(await sign(grantOf(e, { version: 2, rights: ['spawn', 'shell'] }))))).code).toBe(0);
    const ledger = JSON.parse(fs.readFileSync(join(services.machine.stateDir, 'grants.json'), 'utf8')) as { grants: Record<string, { body: Grant }> };
    expect(ledger.grants[e.A].body).toMatchObject({ version: 2, rights: ['spawn', 'shell'] });
  });

  it('refuses a grant for another machine, for a key it doesn’t speak with, or signed by no owner', async () => {
    const e = await enrolled();
    const sign = (g: Grant, by = e.a1) => signRecord(SIGNING_DOMAINS.grant, g, by.stepUp.privateKey, by.stepUp.pub);
    expect((await e.endpoint.cli('grant', ['-'], JSON.stringify(await sign(grantOf(e, { machine: 'Z'.repeat(22) }))))).out).toBe('refused: other-machine');
    expect((await e.endpoint.cli('grant', ['-'], JSON.stringify(await sign(grantOf(e, { machineKey: await keyId((await generateSigningKey()).pub) }))))).out).toBe('refused: not-listed');
    expect((await e.endpoint.cli('grant', ['-'], JSON.stringify(await sign(grantOf(e), await newDevice('x1'))))).out).toBe('refused: unknown-signer');
    expect((await e.endpoint.cli('grant', ['-'], '{"body": 1}')).out).toBe('refused: malformed');
  });

  it('ends a grant when a new head revokes its signer’s key', async () => {
    const e = await enrolled();
    const a2 = await newDevice('a2');
    const endorsement = await endorseDevice(ORG, e.A, a2.device, e.a1.stepUp.privateKey, e.a1.stepUp.pub);
    const s3 = await successor(e.head, [e.a1], async (s) => {
      s.members[0].devices.push({ ...a2.device, endorsement });
      s.root.keys.push(await keyId(a2.stepUp.pub));
    });
    await e.endpoint.cli('revoke', ['-'], JSON.stringify(s3));
    const signed = await signRecord(SIGNING_DOMAINS.grant, grantOf(e), a2.stepUp.privateKey, a2.stepUp.pub);
    expect((await e.endpoint.cli('grant', ['-'], JSON.stringify(signed))).code).toBe(0);
    const s4 = await successor(s3, [e.a1], async (s) => {
      s.members[0].devices = s.members[0].devices.filter((d) => d.id !== 'a2');
      s.root.keys = [await keyId(e.a1.stepUp.pub)];
      s.revoked.push(...(await revokedDevice(e.A, a2.device)));
    });
    expect((await e.endpoint.cli('revoke', ['-'], JSON.stringify(s4))).code).toBe(0);
    const ledger = JSON.parse(fs.readFileSync(join(services.machine.stateDir, 'grants.json'), 'utf8')) as { grants: Record<string, unknown> };
    expect(ledger.grants).toEqual({});
  });

  /** A second device of the owner, a2, joins as a root (delivered by hand), and member B with it. */
  async function joinA2(e: Enrolled) {
    const a2 = await newDevice('a2');
    const B = memberId();
    const endorsement = await endorseDevice(ORG, e.A, a2.device, e.a1.stepUp.privateKey, e.a1.stepUp.pub);
    const s3 = await successor(e.head, [e.a1], async (s) => {
      s.members[0].devices.push({ ...a2.device, endorsement });
      s.root.keys.push(await keyId(a2.stepUp.pub));
      s.members.push({ id: B, email: 'b@example.com', role: 'member', devices: [] });
    });
    expect((await e.endpoint.cli('revoke', ['-'], JSON.stringify(s3))).code).toBe(0);
    const s4 = await successor(s3, [e.a1], async (s) => {
      s.members[0].devices = s.members[0].devices.filter((d) => d.id !== 'a2');
      s.root.keys = [await keyId(e.a1.stepUp.pub)];
      s.revoked.push(...(await revokedDevice(e.A, a2.device)));
    });
    return { a2, B, s3, s4 };
  }
  const ledgerOnDisk = () => JSON.parse(fs.readFileSync(join(services.machine.stateDir, 'grants.json'), 'utf8')) as { grants: Record<string, { body: Grant }>; highWater: Record<string, number> };

  it('keeps a member’s version when its grant ends, so an older grant replayed is still refused', async () => {
    const e = await enrolled();
    const { a2, s4 } = await joinA2(e);
    const v1 = await signRecord(SIGNING_DOMAINS.grant, grantOf(e, { rights: ['spawn', 'shell'] }), e.a1.stepUp.privateKey, e.a1.stepUp.pub);
    const v2 = await signRecord(SIGNING_DOMAINS.grant, grantOf(e, { version: 2 }), a2.stepUp.privateKey, a2.stepUp.pub);
    expect((await e.endpoint.cli('grant', ['-'], JSON.stringify(v1))).code).toBe(0);
    expect((await e.endpoint.cli('grant', ['-'], JSON.stringify(v2))).code).toBe(0);
    expect((await e.endpoint.cli('revoke', ['-'], JSON.stringify(s4))).code).toBe(0);
    expect(ledgerOnDisk().grants).toEqual({});
    expect((await e.endpoint.cli('grant', ['-'], JSON.stringify(v1))).out).toBe('refused: not-newer');
    expect(ledgerOnDisk().grants).toEqual({});
  });

  it('takes grants arriving together one at a time: the higher version stands, and another member’s isn’t lost', async () => {
    const e = await enrolled();
    const { B } = await joinA2(e);
    const sign = (g: Grant) => signRecord(SIGNING_DOMAINS.grant, g, e.a1.stepUp.privateKey, e.a1.stepUp.pub);
    const [v4, v3, forB] = await Promise.all([sign(grantOf(e, { version: 4 })), sign(grantOf(e, { version: 3 })), sign(grantOf(e, { member: B }))]);
    const results = await Promise.all([v4, v3, forB].map((g) => e.endpoint.cli('grant', ['-'], JSON.stringify(g))));
    expect(results.map((r) => r.out)).toEqual([`kept: version 4 for member ${e.A}, spawn`, 'refused: not-newer', `kept: version 1 for member ${B}, spawn`]);
    const grants = ledgerOnDisk().grants;
    expect(grants[e.A].body.version).toBe(4);
    expect(grants[B].body.version).toBe(1);
  });

  it('ends at start a grant whose signer the head on disk revokes, when a crash came between the two writes', async () => {
    const e = await enrolled();
    const { a2, s4 } = await joinA2(e);
    const v1 = await signRecord(SIGNING_DOMAINS.grant, grantOf(e), a2.stepUp.privateKey, a2.stepUp.pub);
    expect((await e.endpoint.cli('grant', ['-'], JSON.stringify(v1))).code).toBe(0);
    await e.endpoint.stop();
    // The revoking head reaches org.json, and the process dies before the ledger is re-read against it.
    const state = EndpointState.open(services.machine.stateDir);
    expect(await new EndpointOrg(state, { log: () => {} }).adopt([s4], [])).toMatchObject({ adopted: 1 });
    expect(Object.keys(ledgerOnDisk().grants)).toEqual([e.A]);
    const restarted = createEndpoint();
    await restarted.start(services);
    expect(ledgerOnDisk().grants).toEqual({});
    expect(services.lines.join('\n')).toMatch(/grant\(s\) ended/);
    expect(ledgerOnDisk().highWater).toEqual({ [e.A]: 1 });
    await restarted.stop();
  });
});

describe('enroll --wait', () => {
  it('refuses a wait that is not a non-negative number before it reaches the hub', async () => {
    services = fakeServices();
    const calls: string[] = [];
    const endpoint = createEndpoint({ fetch: async (input) => (calls.push(String(input)), Response.json({ error: 'refused' }, { status: 500 })) });
    await endpoint.start(services);
    const recovery = await generateSigningKey();
    const code = encodeEnrollmentCodeV2({ hub: 'https://hub.example.com', token: 't'.repeat(32), roots: [await keyId((await generateSigningKey()).pub)], recoveryPub: recovery.pub, k: 'k'.repeat(43) });
    for (const wait of ['--wait=soon', '--wait=-5', '--wait=Infinity']) {
      const refused = await endpoint.cli('enroll', ['--name', 'mini', wait], code);
      expect(refused.code).toBe(1);
      expect(refused.out).toMatch(/--wait/);
    }
    expect(calls).toEqual([]);
    expect(fs.existsSync(join(services.machine.stateDir, 'machine-key.json'))).toBe(false);
  });
});

describe('the rest', () => {
  it('follows the head’s retirement of the legacy key, keeps its bytes until purged, and has no verb of its own to retire it', async () => {
    const { endpoint, head, a1 } = await enrolled();
    const dir = services.machine.stateDir;
    const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    fs.writeFileSync(join(dir, 'legacy.json'), JSON.stringify({ org: ORG, key }), { mode: 0o600 });
    await endpoint.stop();
    let current = createEndpoint();
    await current.start(services);
    const legacyFile = () => JSON.parse(fs.readFileSync(join(dir, 'legacy.json'), 'utf8')) as Record<string, unknown>;
    expect(current.status()).toMatchObject({ legacyKey: true, legacyRetired: false });
    expect((await current.cli('legacy', ['status'])).out).toBe('held');
    expect(await current.cli('legacy', ['purge'])).toMatchObject({ code: 1, out: expect.stringMatching(/not retired by the org state/) as string });
    const retire = await successor(head, [a1], (s) => void (s.legacyRetired = { version: s.version, at: s.issued }));
    expect((await current.cli('revoke', ['-'], JSON.stringify(retire))).code).toBe(0);
    expect(current.status()).toMatchObject({ legacyKey: false, legacyRetired: true });
    expect(legacyFile()).toEqual({ org: ORG, retired: retire.state.legacyRetired!.at, key });
    expect((await current.cli('legacy', ['status'])).out).toBe('retired (bytes kept)');
    // The retirement undone by a successor: the bytes are the key again.
    const undo = await successor(retire, [a1], (s) => void delete s.legacyRetired);
    expect((await current.cli('revoke', ['-'], JSON.stringify(undo))).code).toBe(0);
    expect(current.status()).toMatchObject({ legacyKey: true, legacyRetired: false });
    expect(legacyFile()).toEqual({ org: ORG, key });
    const again = await successor(undo, [a1], (s) => void (s.legacyRetired = { version: s.version, at: s.issued }));
    expect((await current.cli('revoke', ['-'], JSON.stringify(again))).code).toBe(0);
    // An undo's copy moved aside (M1's unenroll) is the key's bytes too.
    const aside = join(dir, 'stale-2026-10-28T00-00-00.000Z');
    fs.mkdirSync(aside, { mode: 0o700 });
    fs.writeFileSync(join(aside, 'legacy.json'), JSON.stringify({ org: ORG, key }), { mode: 0o600 });
    const purged = await current.cli('legacy', ['purge']);
    expect(purged).toEqual({ code: 0, out: "purged: the legacy org key's bytes are deleted from legacy.json, stale-2026-10-28T00-00-00.000Z/legacy.json" });
    expect(purged.out).not.toContain(key);
    expect(legacyFile()).toEqual({ org: ORG, retired: again.state.legacyRetired!.at });
    expect(fs.existsSync(join(aside, 'legacy.json'))).toBe(false);
    expect((await current.cli('legacy', ['status'])).out).toBe('purged');
    expect((await current.cli('legacy', ['purge'])).out).toBe('nothing to purge: no bytes of the legacy org key are held');
    // A restart keeps the tombstone and what it says.
    await current.stop();
    current = createEndpoint();
    await current.start(services);
    expect(current.status()).toMatchObject({ legacyKey: false, legacyRetired: true });
    expect((await current.cli('legacy', ['status'])).out).toBe('purged');
    const retired = await current.cli('legacy', ['retire']);
    expect(retired.code).toBe(1);
    expect(retired.out).toMatch(/the org state retires the legacy org key/);
    await current.stop();
  });

  it('answers not running before start, the usage for an unknown command, and never takes the code as an argument', async () => {
    expect((await createEndpoint().cli('status', [])).code).toBe(3);
    services = fakeServices();
    const endpoint = createEndpoint();
    await endpoint.start(services);
    expect((await endpoint.cli('frobnicate', [])).out).toMatch(/^usage:/);
    expect(await endpoint.cli('enroll', ['--name', 'mini'])).toMatchObject({ code: 1, out: expect.stringMatching(/stdin/) });
    const garbage = 'smns-enroll-v2.bm90LWEtY29kZQ';
    const refused = await endpoint.cli('enroll', ['--name', 'mini'], garbage);
    expect(refused.code).toBe(1);
    expect(refused.out).not.toContain(garbage);
    expect((await endpoint.cli('keys', ['--json'])).out).toBe(JSON.stringify({ enrollment: 'none', ref: services.machine.ref, delegated: false }));
  });
});

describe('unenroll and retire, with no hub (O14 M1)', () => {
  it('unenrolls a listed machine locally: RL10 unserved, every private key destroyed with its id kept, the rest aside', async () => {
    const { endpoint, machineKey } = await enrolled();
    const dir = services.machine.stateDir;
    await expect.poll(() => fs.existsSync(join(dir, 'rl10.json'))).toBe(true);
    // An earlier stale directory still holding private keys: the key-without-ledger rule's, or an earlier unenroll's.
    const earlier = join(dir, 'stale-2026-10-01T00-00-00.000Z');
    fs.mkdirSync(earlier, { mode: 0o700 });
    const orphan = await generateSigningKey(true);
    const delegation = await generateSigningKey(true);
    fs.writeFileSync(join(earlier, 'machine-key.json'), JSON.stringify({ version: 1, keyId: await keyId(orphan.pub), jwk: await crypto.subtle.exportKey('jwk', orphan.privateKey), created: new Date().toISOString() }), { mode: 0o600 });
    fs.writeFileSync(join(earlier, 'delegation.json'), JSON.stringify({ version: 1, id: 'a'.repeat(32), prefix: 'vm-', privateJwk: await crypto.subtle.exportKey('jwk', delegation.privateKey) }), { mode: 0o600 });
    fs.writeFileSync(join(dir, 'legacy.json'), JSON.stringify({ org: ORG, key: 'k'.repeat(43) }), { mode: 0o600 });
    // The signatures made and the replay index stay where a later enrollment under the same ref reads them.
    const signatures = endpoint.parts!.state.subdirectory('signatures');
    const inbound = endpoint.parts!.state.subdirectory('inbound');
    fs.writeFileSync(join(signatures, 'p1.jsonl'), '{"writer":"mini/s","seq":1}\n', { mode: 0o600 });
    fs.writeFileSync(join(inbound, 'p1.jsonl'), '{"writer":"hub/x","seq":1}\n', { mode: 0o600 });

    const undone = await endpoint.cli('unenroll', ['--json']);
    expect(undone.code, undone.out).toBe(0);
    const view = JSON.parse(undone.out) as { enrollment: string; destroyed: string[]; aside: string };
    expect(view.enrollment).toBe('none');
    expect(new Set(view.destroyed)).toEqual(new Set([machineKey, await keyId(orphan.pub), await keyId(delegation.pub)]));
    expect(fs.existsSync(join(dir, 'rl10.json'))).toBe(false);
    for (const gone of [join(dir, 'machine-key.json'), join(earlier, 'machine-key.json'), join(earlier, 'delegation.json')]) expect(fs.existsSync(gone), gone).toBe(false);
    const aside = join(dir, view.aside);
    expect(JSON.parse(fs.readFileSync(join(aside, 'keys.json'), 'utf8'))).toEqual({ keyIds: view.destroyed });
    for (const moved of ['grants.json', 'enrollment.json', 'org.json', 'legacy.json']) {
      expect(fs.existsSync(join(aside, moved)), moved).toBe(true);
      expect(fs.existsSync(join(dir, moved)), moved).toBe(false);
    }
    for (const kept of ['signatures/p1.jsonl', 'inbound/p1.jsonl']) {
      expect(fs.existsSync(join(dir, kept)), kept).toBe(true);
      expect(fs.existsSync(join(aside, kept)), kept).toBe(false);
    }
    expect(endpoint.status()).toMatchObject({ enrollment: 'none', legacyKey: false, delegated: false });
    // A fresh process over the directory is unenrolled, refusing nothing.
    const again = createEndpoint();
    await again.start(services);
    expect(again.status()).toMatchObject({ enrollment: 'none' });
    expect(again.status().refusing).toBeUndefined();
    await again.stop();
    await endpoint.stop();
  });

  it('refuses to retire an attended enrollment, touching nothing, and has nothing to retire once unenrolled', async () => {
    const { endpoint } = await enrolled();
    const refused = await endpoint.cli('retire', []);
    expect(refused.code).toBe(1);
    expect(refused.out).toMatch(/^not-delegated: /);
    expect(endpoint.status()).toMatchObject({ enrollment: 'org-listed' });
    expect((await endpoint.cli('retire', ['--not-after', 'tomorrow'])).code).toBe(1);
    expect((await endpoint.cli('unenroll', [])).code).toBe(0);
    expect(await endpoint.cli('retire', [])).toEqual({ code: 0, out: 'nothing to retire: this machine holds no certificate and no credential' });
    await endpoint.stop();
  });
});
