// Delegated provisioning, retirement and the local unenroll against desk-hub's local runner (P5 O14 M1): `mawsd
// endpoint provision` end to end under a delegation the local OrgAdmin signs into the state; its refusals before any
// hub call and at redemption; the transaction's four states, each resumed by a fresh endpoint over the reopened state
// directory with nothing held in memory; `retire` and its reconciliation of a lost answer; `unenroll` on an attended and
// on a delegated endpoint; and the crash-recovery scene carried through to `retire`, after which no private key is left.
import * as fs from 'node:fs';
import { join } from 'node:path';
import { base64urlEncode, encodeProvisioningCodeV2, generateSigningKey, keyId, NO_CERTIFICATES, verifyEvent, type LogEventV2, type ProvisioningCodeV2 } from 'org-protocol';
import { delegationFor, type MachineView, type ProvisioningKeyIssued, type ProvisioningKeys } from 'desk-hub/protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEndpoint, type Endpoint } from '../../src/endpoint';
import { EndpointState } from '../../src/endpoint/state/store';
import { fakeServices, mintRef, type FakeServices } from './fake-services';
import { startLocalHub, type LocalHub, type Member } from './local-hub';
import { FakeSminos } from './rl10/fake-sminos';

let hub: LocalHub;
let member: Member;
/** The delegations the suite provisions under: `vm-` and `box-`. */
let vm: Delegation;
let box: Delegation;
const started: Array<{ endpoint: Endpoint; services: FakeServices }> = [];

type Delegation = { id: string; prefix: string; token: string; privateJwk: JsonWebKey };

beforeAll(async () => {
  hub = await startLocalHub();
  member = await hub.admin();
  vm = await delegation('vm-');
  box = await delegation('box-');
}, 120_000);
afterAll(async () => {
  for (const { endpoint, services } of started) {
    await endpoint.stop();
    services.cleanup();
  }
  await hub?.stop();
});

/** A provisioning key and the delegation the member signs into the state for it. */
async function delegation(prefix: string): Promise<Delegation> {
  const issued = await member.person.json<ProvisioningKeyIssued>('/api/provisioning-keys', { body: { label: prefix, prefix, max_uses: null, offline_revoke_s: null } }, 201);
  const key = await generateSigningKey(true);
  await member.amend(`the ${prefix} delegation`, (s) => void s.delegations.push(delegationFor(issued.key, key.pub, 'org')));
  return { id: issued.key.id, prefix, token: issued.token, privateJwk: (await crypto.subtle.exportKey('jwk', key.privateKey)) as JsonWebKey };
}

const LEGACY_KEY = base64urlEncode(new Uint8Array(32).fill(9));

/** The `smns-provision-v2.` code of `d`, the org's pins as the head holds them. */
async function code(d: Delegation, options: { legacy?: boolean; privateJwk?: JsonWebKey } = {}): Promise<string> {
  const { root } = (await member.head()).state;
  const fields: ProvisioningCodeV2 = {
    hub: hub.url,
    org: 'local',
    roots: root.keys,
    recoveryPub: root.recoveryPub,
    token: d.token,
    delegation: { id: d.id, prefix: d.prefix, privateJwk: options.privateJwk ?? d.privateJwk },
    ...(options.legacy ? { legacy: { org: 'local', key: LEGACY_KEY } } : {}),
  };
  return encodeProvisioningCodeV2(fields);
}

/** Every request the endpoint sent, as `METHOD path`; `fault` may answer or throw in the hub's place. */
type Traffic = { seen: string[]; fault?: (request: string, forward: () => Promise<Response>) => Promise<Response | undefined> | undefined };

/** A started endpoint on a scratch profile (or the one given, as a fresh process sees it), its requests recorded. */
async function endpointOn(options: { ref?: string; profileDir?: string; traffic?: Traffic } = {}) {
  const traffic = options.traffic ?? { seen: [] };
  const services = fakeServices({ ...(options.ref === undefined ? {} : { ref: options.ref as ReturnType<typeof mintRef> }), ...(options.profileDir === undefined ? {} : { profileDir: options.profileDir }) });
  const endpoint = createEndpoint({
    fetch: async (input, init) => {
      const request = `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`;
      traffic.seen.push(request);
      const forward = () => fetch(input, init);
      return (await traffic.fault?.(request, forward)) ?? forward();
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 50))),
  });
  await endpoint.start(services);
  const entry = { endpoint, services };
  started.push(entry);
  return { endpoint, services, traffic };
}

/** The endpoint stopped and another started over the same profile and ref, holding nothing of the first in memory. */
async function restart(from: { endpoint: Endpoint; services: FakeServices }, traffic?: Traffic) {
  await from.endpoint.stop();
  started.splice(started.indexOf(started.find((s) => s.endpoint === from.endpoint)!), 1);
  return endpointOn({ ref: from.services.machine.ref, profileDir: from.services.machine.profileDir, traffic });
}

const json = (out: string) => JSON.parse(out) as Record<string, unknown>;
const read = (dir: string, name: string) => JSON.parse(fs.readFileSync(join(dir, name), 'utf8')) as Record<string, unknown>;
const mode = (path: string) => fs.statSync(path).mode & 0o777;
const uses = async (d: Delegation) => (await member.person.json<ProvisioningKeys>('/api/provisioning-keys')).keys.find((k) => k.id === d.id)!.uses;
const machines = async () => (await member.person.json<{ machines: MachineView[] }>('/api/machines')).machines.map((m) => m.name);
const posts = (traffic: Traffic, path: string) => traffic.seen.filter((r) => r === `POST ${path}`).length;

async function provision(endpoint: Endpoint, text: string, name: string, wait = '30') {
  const result = await endpoint.cli('provision', ['--name', name, '--wait', wait, '--json'], text);
  return { ...result, view: result.out.startsWith('{') ? json(result.out) : {} };
}

/** Every `*.json` under `dir`, `stale-*\/` included, that holds a member `d` at any depth (a private JWK's). */
function privateKeyFiles(dir: string): string[] {
  const found: string[] = [];
  const holds = (value: unknown): boolean => typeof value === 'object' && value !== null && (Object.hasOwn(value, 'd') || Object.values(value).some(holds));
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const path = join(entry.parentPath, entry.name);
    if (holds(JSON.parse(fs.readFileSync(path, 'utf8')))) found.push(path);
  }
  return found;
}

describe('provision', () => {
  it('provisions end to end: certified, the certificate served beside the state, the legacy key kept and never asked for', async () => {
    const { endpoint, services, traffic } = await endpointOn({ ref: mintRef(vm.id) });
    const text = await code(vm, { legacy: true });
    const result = await provision(endpoint, text, 'vm-one');
    expect(result.code, result.out).toBe(0);
    expect(result.view).toMatchObject({ enrollment: 'org-listed', name: 'vm-one', org: 'local', ref: services.machine.ref, delegated: true });
    const dir = services.machine.stateDir;
    for (const name of ['delegation.json', 'legacy.json', 'machine-key.json', 'grants.json', 'enrollment.json', 'org.json']) expect(mode(join(dir, name)), name).toBe(0o600);
    expect(fs.existsSync(join(dir, 'provisioning.json'))).toBe(false);
    expect(read(dir, 'legacy.json')).toEqual({ org: 'local', key: LEGACY_KEY });
    expect(json((await endpoint.cli('keys', ['--json'])).out)).toMatchObject({ enrollment: 'org-listed', name: 'vm-one', delegated: true });
    expect(endpoint.status()).toMatchObject({ enrollment: 'org-listed', delegated: true, legacyKey: true });
    const view = await member.person.json<{ certificates: { certs: Array<{ body: { machine: string; name: string } }> } }>('/api/org/state');
    expect(view.certificates.certs.map((c) => c.body.machine)).toContain(services.machine.ref);

    // sminos is welcomed and never asked for the key the code carried.
    await expect.poll(() => fs.existsSync(join(dir, 'rl10.json'))).toBe(true);
    const info = read(dir, 'rl10.json') as { socket: string; token: string };
    const sminos = await FakeSminos.open(info.socket);
    sminos.send({ t: 'hello', protocol: { major: 1, minor: 0 }, capabilities: [], token: info.token, sminos: { version: 'test' }, policy: { read_only: false, ceiling: 'settings' } });
    await sminos.next((f) => f.t === 'welcome', 'welcome');
    sminos.send({ t: 'restated' });
    await new Promise((r) => setTimeout(r, 300));
    expect(sminos.received.map((f) => f.t)).not.toContain('legacy-key?');
    sminos.close();

    // Nothing secret is said: not the code, its token, the delegation's private half, nor the service token's secret.
    const enrollment = read(dir, 'enrollment.json') as { credentials: { clientSecret: string } };
    const said = [...services.lines, result.out, (await endpoint.cli('keys', [])).out, JSON.stringify(endpoint.status())].join('\n');
    for (const secret of [text, vm.token, vm.privateJwk.d!, enrollment.credentials.clientSecret, LEGACY_KEY]) expect(said).not.toContain(secret);

    // A listed machine's rerun posts nothing.
    const before = traffic.seen.length;
    expect((await provision(endpoint, text, 'vm-one')).code).toBe(0);
    expect(traffic.seen.slice(before).filter((r) => r.startsWith('POST '))).toEqual([]);
  });

  // O14 M5a's rule at an enrollment's first synced state, met by a provisioning: its code's legacy key was written
  // before the head was read, and is never the machine's in use, so the tombstone keeps no bytes.
  it('provisions under a head retiring the legacy org key: a tombstone without the code’s key', async () => {
    await member.amend('the legacy org key retired', (s) => void (s.legacyRetired = { version: s.version, at: s.issued }));
    try {
      const { endpoint, services } = await endpointOn({ ref: mintRef(vm.id) });
      const result = await provision(endpoint, await code(vm, { legacy: true }), 'vm-retired-born');
      expect(result.code, result.out).toBe(0);
      const at = (await member.head()).state.legacyRetired!.at;
      const legacyPath = join(services.machine.stateDir, 'legacy.json');
      expect(JSON.parse(fs.readFileSync(legacyPath, 'utf8'))).toEqual({ org: 'local', retired: at });
      expect(fs.readFileSync(legacyPath, 'utf8')).not.toContain(LEGACY_KEY);
      expect(endpoint.status()).toMatchObject({ enrollment: 'org-listed', delegated: true, legacyKey: false, legacyRetired: true });
      expect((await endpoint.cli('legacy', ['status'])).out).toBe('purged');
      // A restart reads the same: the start's follow keeps no bytes it never had.
      const again = await restart({ endpoint, services });
      expect(JSON.parse(fs.readFileSync(legacyPath, 'utf8'))).toEqual({ org: 'local', retired: at });
      expect(again.endpoint.status()).toMatchObject({ legacyKey: false, legacyRetired: true });
    } finally {
      await member.amend('the legacy org key back in use', (s) => void delete s.legacyRetired);
    }
  });

  it('refuses a ref minted under no delegation and a name outside the prefix before any hub call', async () => {
    const used = await uses(vm);
    const stray = await endpointOn();
    const strayRun = await stray.endpoint.cli('provision', ['--name', 'vm-stray'], await code(vm));
    expect(strayRun).toMatchObject({ code: 1 });
    expect(strayRun.out).toMatch(/^ref-prefix: /);
    const outside = await endpointOn({ ref: mintRef(vm.id) });
    const outsideRun = await outside.endpoint.cli('provision', ['--name', 'box-elsewhere'], await code(vm));
    expect(outsideRun).toMatchObject({ code: 1 });
    expect(outsideRun.out).toMatch(/^name-prefix: /);
    expect([...stray.traffic.seen, ...outside.traffic.seen]).toEqual([]);
    expect(await uses(vm)).toBe(used);
    expect(fs.existsSync(join(stray.services.machine.stateDir, 'delegation.json'))).toBe(false);
    // Neither an argument nor nothing is a code.
    expect((await outside.endpoint.cli('provision', ['--name', 'vm-x'])).out).toMatch(/stdin/);
    expect((await outside.endpoint.cli('provision', ['--name', 'vm-x'], 'smns-provision-v1.e30')).out).toBe('not a provisioning code: not smns-provision-v2');
  });

  it('refuses a code whose key is not the delegation’s in the state at its redemption, posting nothing; retire frees the row', async () => {
    const stranger = (await crypto.subtle.exportKey('jwk', (await generateSigningKey(true)).privateKey)) as JsonWebKey;
    const { endpoint, traffic } = await endpointOn({ ref: mintRef(vm.id) });
    const result = await provision(endpoint, await code(vm, { privateJwk: stranger }), 'vm-forged');
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/^delegation-key: /);
    expect(posts(traffic, '/machine/cert')).toBe(0);
    expect(await machines()).toContain('vm-forged');
    // The redemption's row is the machine's to remove: its certificate was never held, so the row alone goes.
    const retired = await endpoint.cli('retire', []);
    expect(retired.code, retired.out).toBe(0);
    expect(retired.out).toMatch(/never held/);
    expect(await machines()).not.toContain('vm-forged');
    expect(privateKeyFiles(endpoint.parts!.state.dir)).toEqual([]);
  });

  it('fences an unenroll run while a provisioning awaits its certificate’s answer: the unenroll is not undone', async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    const t: Traffic = {
      seen: [],
      fault: async (r, forward) => {
        if (r !== 'POST /machine/cert') return undefined;
        const answer = await forward();
        await held;
        return answer;
      },
    };
    const { endpoint, services } = await endpointOn({ ref: mintRef(vm.id), traffic: t });
    const dir = services.machine.stateDir;
    const provisioning = provision(endpoint, await code(vm), 'vm-raced');
    await expect.poll(() => t.seen.includes('POST /machine/cert')).toBe(true);
    let unenrolled = false;
    const unenrolling = endpoint.cli('unenroll', []).then((r) => ((unenrolled = true), r));
    await new Promise((r) => setTimeout(r, 300));
    expect(unenrolled).toBe(false);
    release();
    const [provisioned, undone] = await Promise.all([provisioning, unenrolling]);
    expect(undone.code, undone.out).toBe(0);
    expect([0, 1]).toContain(provisioned.code);
    // Whatever the provisioning answered, the unenroll that reported done stands.
    for (const name of ['machine-key.json', 'delegation.json', 'provisioning.json', 'enrollment.json']) expect(fs.existsSync(join(dir, name)), name).toBe(false);
    expect(json((await endpoint.cli('keys', ['--json'])).out)).toMatchObject({ enrollment: 'none', delegated: false });
    expect(endpoint.status()).toMatchObject({ enrollment: 'none', delegated: false });
    expect(privateKeyFiles(dir)).toEqual([]);
  });

  it('refuses a code under another delegation than the one held', async () => {
    const { endpoint } = await endpointOn({ ref: mintRef(vm.id) });
    expect((await provision(endpoint, await code(vm), 'vm-held')).code).toBe(0);
    const other = await endpoint.cli('provision', ['--name', 'box-held'], await code(box));
    expect(other.code).toBe(1);
    expect(other.out).toMatch(/^other-delegation: /);
  });
});

describe('provision, resumed', () => {
  it('times out hub-confirmed (exit 4), and a rerun lists it without a second redemption', async () => {
    // Once the certificate is posted, the hub serves no org state: the listing can't be seen.
    let posted = false;
    const t: Traffic = {
      seen: [],
      fault: (r) => {
        if (r === 'POST /machine/cert') posted = true;
        else if (posted && r === 'GET /machine/org/state') return Promise.resolve(Response.json({ error: 'unavailable' }, { status: 503 }));
        return undefined;
      },
    };
    const first = await endpointOn({ ref: mintRef(vm.id), traffic: t });
    const used = await uses(vm);
    const timedOut = await provision(first.endpoint, await code(vm), 'vm-slow', '1');
    expect(timedOut.code, timedOut.out).toBe(4);
    expect(timedOut.view).toMatchObject({ enrollment: 'hub-confirmed', name: 'vm-slow' });
    expect(await uses(vm)).toBe(used + 1);
    const again = await restart(first);
    const rerun = await provision(again.endpoint, await code(vm), 'vm-slow');
    expect(rerun.code, rerun.out).toBe(0);
    expect(posts(again.traffic, '/machine/enroll')).toBe(0);
    expect(await uses(vm)).toBe(used + 1);
  });

  it('redeems once after a kill between delegation.json and the redemption', async () => {
    const t: Traffic = { seen: [], fault: (r) => (r === 'POST /machine/enroll' ? Promise.reject(new Error('killed')) : undefined) };
    const first = await endpointOn({ ref: mintRef(vm.id), traffic: t });
    const used = await uses(vm);
    expect((await provision(first.endpoint, await code(vm), 'vm-early')).code).toBe(1);
    expect(fs.existsSync(join(first.services.machine.stateDir, 'delegation.json'))).toBe(true);
    expect(fs.existsSync(join(first.services.machine.stateDir, 'provisioning.json'))).toBe(false);
    const again = await restart(first);
    expect((await provision(again.endpoint, await code(vm), 'vm-early')).code).toBe(0);
    expect(posts(again.traffic, '/machine/enroll')).toBe(1);
    expect(await uses(vm)).toBe(used + 1);
  });

  it('posts once after a kill between provisioning.json and the certificate’s post', async () => {
    const t: Traffic = { seen: [], fault: (r) => (r === 'POST /machine/cert' ? Promise.reject(new Error('killed')) : undefined) };
    const first = await endpointOn({ ref: mintRef(vm.id), traffic: t });
    const used = await uses(vm);
    const cut = await provision(first.endpoint, await code(vm), 'vm-cut');
    expect(cut.code, cut.out).toBe(4);
    expect(fs.existsSync(join(first.services.machine.stateDir, 'provisioning.json'))).toBe(true);
    // A redemption still pending is the hub's: shown hub-confirmed and delegated, so a departure retires it.
    expect(json((await first.endpoint.cli('keys', ['--json'])).out)).toMatchObject({ enrollment: 'hub-confirmed', name: 'vm-cut', org: 'local', delegated: true });
    expect(first.endpoint.status()).toMatchObject({ enrollment: 'hub-confirmed', name: 'vm-cut', org: 'local', delegated: true });
    const again = await restart(first);
    const rerun = await provision(again.endpoint, await code(vm), 'vm-cut');
    expect(rerun.code, rerun.out).toBe(0);
    expect(rerun.view).toMatchObject({ enrollment: 'org-listed' });
    expect(posts(again.traffic, '/machine/enroll')).toBe(0);
    expect(posts(again.traffic, '/machine/cert')).toBe(1);
    expect(await uses(vm)).toBe(used + 1);
  });

  for (const [at, method] of [
    ['before machine-key.json', 'setMachineKey'],
    ['between machine-key.json and grants.json', 'setLedger'],
    ['between grants.json and enrollment.json', 'setEnrollment'],
    ['between the set and the record’s removal', 'removeProvisioning'],
  ] as const) {
    it(`completes the set after a kill ${at}, the hub answering the second post as held`, async () => {
      const first = await endpointOn({ ref: mintRef(vm.id) });
      const dir = first.services.machine.stateDir;
      const name = `vm-set-${method.toLowerCase()}`;
      const used = await uses(vm);
      const original = EndpointState.prototype[method] as (...args: unknown[]) => void;
      let fired = false;
      const spy = vi.spyOn(EndpointState.prototype, method).mockImplementation(function (this: EndpointState, ...args: unknown[]) {
        if (this.dir === dir && this.provisioning !== null && !fired) {
          fired = true;
          throw new Error('killed');
        }
        return original.apply(this, args);
      } as never);
      try {
        const killed = await provision(first.endpoint, await code(vm), name);
        expect(killed.code).toBe(1);
        expect(killed.out).toMatch(/killed/);
      } finally {
        spy.mockRestore();
      }
      const record = read(dir, 'provisioning.json') as { redeemed: { enrollment: string }; machineKey: { keyId: string }; pins: unknown };
      const again = await restart(first);
      // The start completed the set from the record: nothing was moved aside as a key without its ledger.
      expect(fs.readdirSync(dir).filter((n) => n.startsWith('stale-'))).toEqual([]);
      const rerun = await provision(again.endpoint, await code(vm), name);
      expect(rerun.code, rerun.out).toBe(0);
      expect(posts(again.traffic, '/machine/cert')).toBe(1);
      expect(posts(again.traffic, '/machine/enroll')).toBe(0);
      expect(await uses(vm)).toBe(used + 1);
      expect(fs.existsSync(join(dir, 'provisioning.json'))).toBe(false);
      expect(read(dir, 'enrollment.json')).toMatchObject({ enrollment: record.redeemed.enrollment, state: 'org-listed' });
      expect(read(dir, 'grants.json')).toMatchObject({ heldKeys: [record.machineKey.keyId] });
      expect(read(dir, 'org.json')).toMatchObject({ pinned: record.pins });
    });
  }
});

describe('retire', () => {
  it('destroys the keys only once both hub calls are marked; the same record on the rerun; the name free after', async () => {
    let failDelete = true;
    const t: Traffic = { seen: [], fault: (r) => (failDelete && r === 'DELETE /machine/enrollment' ? Promise.resolve(Response.json({ error: 'unavailable' }, { status: 503 })) : undefined) };
    const first = await endpointOn({ ref: mintRef(vm.id), traffic: t });
    const dir = first.services.machine.stateDir;
    expect((await provision(first.endpoint, await code(vm), 'vm-leaving')).code).toBe(0);
    const certKey = await keyId((read(dir, 'enrollment.json') as { cert: { body: { pub: string } } }).cert.body.pub);
    const failed = await first.endpoint.cli('retire', ['--json']);
    expect(failed.code).toBe(1);
    const record = read(dir, 'retirement.json') as { record: { body: { notAfter: string }; sig: unknown }; posted: boolean; deleted: boolean };
    expect(record).toMatchObject({ posted: true, deleted: false });
    for (const name of ['machine-key.json', 'delegation.json']) expect(fs.existsSync(join(dir, name)), name).toBe(true);
    failDelete = false;
    const again = await restart(first, { seen: [], fault: t.fault });
    const retired = await again.endpoint.cli('retire', ['--json']);
    expect(retired.code, retired.out).toBe(0);
    expect(json(retired.out)).toEqual({ kind: 'retired', name: 'vm-leaving', keyId: certKey, notAfter: record.record.body.notAfter });
    expect(posts(again.traffic, '/machine/cert-retirements')).toBe(0);
    const stored = await member.person.json<{ certificates: { retirements: Array<{ body: { keyId: string; notAfter: string }; sig: unknown }> } }>('/api/org/state');
    expect(stored.certificates.retirements.find((r) => r.body.keyId === certKey)).toEqual(record.record);
    expect(await machines()).not.toContain('vm-leaving');
    expect(privateKeyFiles(dir)).toEqual([]);
    expect(json((await again.endpoint.cli('keys', ['--json'])).out)).toMatchObject({ enrollment: 'none', delegated: false });
    // Idempotent: nothing is held, and it says so.
    expect(await again.endpoint.cli('retire', [])).toEqual({ code: 0, out: 'nothing to retire: this machine holds no certificate and no credential' });
    // A recreated VM under the same delegation takes the name.
    const recreated = await endpointOn({ ref: mintRef(vm.id) });
    expect((await provision(recreated.endpoint, await code(vm), 'vm-leaving')).code).toBe(0);
  });

  it('reconciles a DELETE the hub completed whose answer was lost, from the 401 that follows', async () => {
    let drop = true;
    const t: Traffic = {
      seen: [],
      fault: async (r, forward) => {
        if (!drop || r !== 'DELETE /machine/enrollment') return undefined;
        await (await forward()).body?.cancel();
        throw new Error('the answer was lost');
      },
    };
    const first = await endpointOn({ ref: mintRef(vm.id), traffic: t });
    expect((await provision(first.endpoint, await code(vm), 'vm-lost')).code).toBe(0);
    expect((await first.endpoint.cli('retire', [])).code).toBe(1);
    expect(await machines()).not.toContain('vm-lost');
    drop = false;
    const again = await restart(first, { seen: [], fault: t.fault });
    const retired = await again.endpoint.cli('retire', []);
    expect(retired.code, retired.out).toBe(0);
    expect(retired.out).toMatch(/^retired: vm-lost \(certificate .+ not after .+\); the hub row is gone; the keys are destroyed$/);
    expect(privateKeyFiles(again.services.machine.stateDir)).toEqual([]);
  });

  it('is refused on an attended enrollment', async () => {
    const { endpoint } = await endpointOn();
    const issued = await member.code();
    const enrolling = endpoint.cli('enroll', ['--name', 'attended-one', '--wait', '30'], issued.code);
    await member.awaitPosted(issued.enrollment);
    await member.list(issued.enrollment, issued.k);
    expect((await enrolling).code).toBe(0);
    const refused = await endpoint.cli('retire', []);
    expect(refused.code).toBe(1);
    expect(refused.out).toMatch(/^not-delegated: /);
    expect(endpoint.status()).toMatchObject({ enrollment: 'org-listed' });
  });

  it('carries a provisioning killed between machine-key.json and grants.json through its restart and listing to retire, leaving no private key', async () => {
    const first = await endpointOn({ ref: mintRef(vm.id) });
    const dir = first.services.machine.stateDir;
    const original = EndpointState.prototype.setLedger;
    let fired = false;
    const spy = vi.spyOn(EndpointState.prototype, 'setLedger').mockImplementation(function (this: EndpointState, value) {
      if (this.dir === dir && !fired) {
        fired = true;
        throw new Error('killed');
      }
      return original.call(this, value);
    });
    try {
      expect((await provision(first.endpoint, await code(vm), 'vm-phoenix')).code).toBe(1);
    } finally {
      spy.mockRestore();
    }
    expect(fs.existsSync(join(dir, 'machine-key.json'))).toBe(true);
    expect(fs.existsSync(join(dir, 'grants.json'))).toBe(false);
    const again = await restart(first);
    // The pending record was completed before the key-without-ledger rule, and the certificate it posted is live.
    expect(fs.readdirSync(dir).filter((n) => n.startsWith('stale-'))).toEqual([]);
    await again.endpoint.syncNow();
    await expect.poll(() => again.endpoint.status().enrollment).toBe('org-listed');
    const retired = await again.endpoint.cli('retire', []);
    expect(retired.code, retired.out).toBe(0);
    expect(privateKeyFiles(dir)).toEqual([]);
    expect(await machines()).not.toContain('vm-phoenix');
  });
});

describe('unenroll', () => {
  it('on an attended endpoint: RL10 unserved at once, the key destroyed and its id kept, the state aside, machine.json kept; enroll works again', async () => {
    const { endpoint, services } = await endpointOn();
    const dir = services.machine.stateDir;
    const machineJson = join(services.machine.profileDir, 'machine.json');
    fs.writeFileSync(machineJson, JSON.stringify({ ref: services.machine.ref }), { mode: 0o600 });
    const issued = await member.code();
    const enrolling = endpoint.cli('enroll', ['--name', 'undone', '--wait', '30'], issued.code);
    await member.awaitPosted(issued.enrollment);
    await member.list(issued.enrollment, issued.k);
    expect((await enrolling).code).toBe(0);
    await expect.poll(() => fs.existsSync(join(dir, 'rl10.json'))).toBe(true);
    const info = read(dir, 'rl10.json') as { socket: string; token: string };
    const sminos = await FakeSminos.open(info.socket);
    sminos.send({ t: 'hello', protocol: { major: 1, minor: 0 }, capabilities: [], token: info.token, sminos: { version: 'test' }, policy: { read_only: false, ceiling: 'settings' } });
    await sminos.next((f) => f.t === 'welcome', 'welcome');
    const oldKey = (read(dir, 'machine-key.json') as { keyId: string }).keyId;

    const undone = await endpoint.cli('unenroll', ['--json']);
    expect(undone.code, undone.out).toBe(0);
    expect(json(undone.out)).toMatchObject({ enrollment: 'none', destroyed: [oldKey] });
    await expect.poll(() => sminos.closed).toBe(true);
    expect(fs.existsSync(join(dir, 'rl10.json'))).toBe(false);
    expect(fs.existsSync(info.socket)).toBe(false);
    const aside = join(dir, String(json(undone.out).aside));
    expect(read(aside, 'keys.json')).toEqual({ keyIds: [oldKey] });
    for (const name of ['grants.json', 'enrollment.json', 'org.json']) expect(fs.existsSync(join(aside, name)), name).toBe(true);
    for (const name of ['machine-key.json', 'grants.json', 'enrollment.json', 'org.json']) expect(fs.existsSync(join(dir, name)), name).toBe(false);
    expect(privateKeyFiles(dir)).toEqual([]);
    expect(fs.readFileSync(machineJson, 'utf8')).toBe(JSON.stringify({ ref: services.machine.ref }));
    expect(endpoint.status()).toMatchObject({ enrollment: 'none', delegated: false, rl10: { connected: false } });
    // Unenrolling an unenrolled endpoint refuses nothing.
    expect((await endpoint.cli('unenroll', [])).code).toBe(0);

    // The name re-enrolls in place under the same ref with a new key, which the hub takes under the recorded name.
    const again = await member.code('undone');
    const reenrolling = endpoint.cli('enroll', ['--name', 'undone', '--wait', '30', '--json'], again.code);
    const posted = await member.awaitPosted(again.enrollment);
    expect(posted).toMatchObject({ ref: services.machine.ref, machine: 'undone' });
    expect(await keyId(posted!.pub)).not.toBe(oldKey);
    await member.list(again.enrollment, again.k);
    expect(json((await reenrolling).out)).toMatchObject({ enrollment: 'org-listed', name: 'undone', ref: services.machine.ref });
  });

  it('on a delegated endpoint: RL10 unserved, both keys destroyed, the hub side left for its drop; provisions again under the same ref once dropped', async () => {
    const { endpoint, services } = await endpointOn({ ref: mintRef(box.id) });
    const dir = services.machine.stateDir;
    expect((await provision(endpoint, await code(box, { legacy: true }), 'box-undone')).code).toBe(0);
    await expect.poll(() => fs.existsSync(join(dir, 'rl10.json'))).toBe(true);
    const cert = (read(dir, 'enrollment.json') as { cert: { body: { pub: string } } }).cert.body;
    const undone = await endpoint.cli('unenroll', ['--json']);
    expect(undone.code, undone.out).toBe(0);
    expect((json(undone.out).destroyed as string[]).length).toBe(2);
    expect(fs.existsSync(join(dir, 'rl10.json'))).toBe(false);
    expect(privateKeyFiles(dir)).toEqual([]);
    const aside = join(dir, String(json(undone.out).aside));
    expect(fs.existsSync(join(aside, 'legacy.json'))).toBe(true);
    // The key moved aside is a stale copy to M5a's `legacy`: reported, and deleted by its purge.
    const legacyStatus = (await endpoint.cli('legacy', ['status'])).out;
    expect(legacyStatus).toMatch(/^none \(1 copy .*stale-<time>/);
    expect((await endpoint.cli('legacy', ['purge'])).out).toBe(`purged: the legacy org key's bytes are deleted from ${join(String(json(undone.out).aside), 'legacy.json')}`);
    expect(fs.existsSync(join(aside, 'legacy.json'))).toBe(false);
    expect(json((await endpoint.cli('keys', ['--json'])).out)).toMatchObject({ enrollment: 'none', delegated: false, ref: services.machine.ref });
    expect(await machines()).toContain('box-undone');

    // The hub side, as `machine drop` does it: the certificate's key retired in the state, the row deleted.
    const certKey = await keyId(cert.pub);
    await member.amend('box-undone dropped', (s) => void s.retired.push({ keyId: certKey, pub: cert.pub, notAfter: new Date().toISOString(), holder: { machine: services.machine.ref } }));
    await member.person.json('/api/machines/box-undone', { method: 'DELETE' });
    const again = await provision(endpoint, await code(box), 'box-undone');
    expect(again.code, again.out).toBe(0);
    expect(again.view).toMatchObject({ enrollment: 'org-listed', ref: services.machine.ref });
  });
});

describe('the kept records across an unenroll', () => {
  /** Enrolls `endpoint` as `name` by a code of `by`, attended, and waits for its listing. */
  async function enrollBy(by: Member, endpoint: Endpoint, name: string, reenroll = false) {
    const issued = await by.code(reenroll ? name : undefined);
    const enrolling = endpoint.cli('enroll', ['--name', name, '--wait', '30'], issued.code);
    await by.awaitPosted(issued.enrollment);
    await by.list(issued.enrollment, issued.k);
    expect((await enrolling).code).toBe(0);
  }

  /** The machine's own event `event` relayed up as RL10 hands it over; the signed copy the hub was sent. */
  async function upload(endpoint: Endpoint, project: string, event: Record<string, unknown>): Promise<LogEventV2> {
    const sent: Array<{ t: string; events?: LogEventV2[] }> = [];
    const spy = vi.spyOn(endpoint.hub, 'send').mockImplementation((frame) => (sent.push(frame as (typeof sent)[number]), true));
    try {
      await endpoint.rl10.relay.events({ t: 'events', project, events: [event] });
    } finally {
      spy.mockRestore();
    }
    const up = sent.find((f) => f.t === 'events')?.events?.[0];
    expect(up, 'an events frame went up').toBeDefined();
    return up!;
  }

  it('reuses its signatures when the same org enrolls the ref again', async () => {
    const first = await endpointOn();
    await enrollBy(member, first.endpoint, 'records-same');
    const event = { writer: 'records-same/human', seq: 1, kind: 'human', text: 'history', ts: new Date().toISOString() };
    const before = await upload(first.endpoint, 'project-same', event);
    expect((await first.endpoint.cli('unenroll', [])).code).toBe(0);
    const again = await restart(first);
    await enrollBy(member, again.endpoint, 'records-same', true);
    const resent = await upload(again.endpoint, 'project-same', event);
    // The position the hub holds is resent as it went up, never signed anew by the new key.
    expect(resent.sig).toEqual(before.sig);
  });

  it('puts unmarked records aside rather than take the new provisioning as their authority', async () => {
    const otherHub = await startLocalHub();
    try {
      const other = await otherHub.admin();
      const first = await endpointOn({ ref: mintRef(vm.id) });
      await enrollBy(other, first.endpoint, 'vm-unmarked');
      const event = { writer: 'vm-unmarked/human', seq: 1, kind: 'human', text: 'history', ts: new Date().toISOString() };
      const before = await upload(first.endpoint, 'project-unmarked', event);
      expect((await first.endpoint.cli('unenroll', [])).code).toBe(0);
      // Records kept with no marker naming their authority (an unenroll before the marker existed).
      const dir = first.services.machine.stateDir;
      fs.unlinkSync(join(dir, 'records-authority.json'));
      const again = await restart(first);
      expect((await provision(again.endpoint, await code(vm), 'vm-unmarked')).code).toBe(0);
      const resent = await upload(again.endpoint, 'project-unmarked', event);
      expect(resent.sig.value).not.toBe(before.sig.value);
      const org = again.endpoint.parts!.org;
      expect(await verifyEvent({ org: 'local', project: 'project-unmarked' }, org.head().state, resent, org.certificates(), new Date())).toEqual({ ok: true });
      expect(read(dir, 'records-authority.json')).toMatchObject({ org: 'local', hub: hub.url });
    } finally {
      await otherHub.stop();
    }
  }, 180_000);

  it('puts them aside when another org enrolls the ref: a resent event is signed anew and verifies under that org', async () => {
    const first = await endpointOn();
    await enrollBy(member, first.endpoint, 'records-moved');
    const event = { writer: 'records-moved/human', seq: 1, kind: 'human', text: 'history', ts: new Date().toISOString() };
    const before = await upload(first.endpoint, 'project-moved', event);
    expect((await first.endpoint.cli('unenroll', [])).code).toBe(0);
    const again = await restart(first);
    const otherHub = await startLocalHub();
    try {
      const other = await otherHub.admin();
      await enrollBy(other, again.endpoint, 'records-moved');
      const resent = await upload(again.endpoint, 'project-moved', event);
      expect(resent.sig.value).not.toBe(before.sig.value);
      expect(await verifyEvent({ org: 'local', project: 'project-moved' }, (await other.head()).state, resent, NO_CERTIFICATES, new Date())).toEqual({ ok: true });
      // The old org's records are kept aside, not lost.
      const dir = again.services.machine.stateDir;
      expect(fs.readdirSync(dir).some((n) => n.startsWith('stale-') && fs.existsSync(join(dir, n, 'signatures', 'project-moved.jsonl')))).toBe(true);
    } finally {
      await otherHub.stop();
    }
  }, 180_000);
});
