// `deployment admin`'s O14 verbs (P5 O14 M2, Interfaces §C) against the suites' local hub, beside O13's in
// admin.test.ts: `enroll` (the code to the terminal, the machine's key checked under its MAC, compared before listing;
// the anchor's lock held for its signing alone), `delegation create` (the provisioning code to a pipe alone),
// `delegation drop`, `machine drop` (an attended entry, a certificate, a phase-1 row), `provisioning revoke`, `show`,
// `abandon-pending`, and the local transforms `code inspect` and `code strip-legacy`. Against a deployment, every verb
// that signs, posts or deletes stops at /dev/tty when the shell has none, before any request; and nothing a verb prints
// on stdout or stderr holds a key, a token or a code, but the code on the two verbs whose stdout is a secret.
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  base64urlEncode,
  canonicalize,
  decodeProvisioningCodeV2,
  encodeProvisioningCodeV2,
  generateSigningKey,
  importSigningKey,
  keyId,
  signOrgState,
  stateHash,
  type ProvisioningCodeV2,
  type SignedOrgState,
} from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anchorFile, runAdmin, type AdminIo } from '../../deploy/admin.ts';
import { readAdminKeys, readText, volumeOf } from '../../deploy/admin-device.ts';
import { restoreLegacyKey, successor } from '../../deploy/org-admin.ts';
import { enrollDelegated, enrollV2, mintRef } from '../../fake-machine/org';
import { importOrgKey, keyAuth, keyCheck } from '../../src/protocol/codes';
import { decodeEnrollmentCodeV2, encodeEnrollmentCodeV2, encodeProvisioningCode, type MachineView, type ProvisioningKeyRecord } from '../../src/protocol/identity';
import { enroll as enrollV1, provisioningKey } from '../support/clients';
import { ADMIN, ORG, startLocalHub, type LocalHub } from '../support/local';

const APP = join(import.meta.dirname, '../..');
const BIN = join(APP, 'deploy/bin.ts');
const scratch = mkdtempSync(join(tmpdir(), 'deployment-admin-verbs-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let dirs = 0;
const dir = (name: string) => {
  const path = join(scratch, `${name}-${++dirs}`);
  mkdirSync(path, { recursive: true });
  return path;
};
const placement = { home: join(scratch, 'home'), tmpRoots: [join(scratch, 'swept')] };

type Fake = { io: AdminIo; out: string[]; err: string[]; term: string[]; stdout: string[]; execs: Array<{ command: string; args: string[]; input?: string }> };

/** Every fake a case made, for the redaction check at the end; and every secret a case handled. */
const fakes: Fake[] = [];
const secrets = new Set<string>();

/** The command's world, recorded: its lines, its terminal, its secret stdout; `answers` are typed at the terminal. */
function fake(answers: string[] = [], over: Partial<AdminIo> & { stdin?: string } = {}): Fake {
  const f: Fake = { out: [], err: [], term: [], stdout: [], execs: [], io: undefined as unknown as AdminIo };
  const { stdin = '', ...rest } = over;
  f.io = {
    out: (line) => f.out.push(line),
    err: (line) => f.err.push(line),
    openTerminal: () => ({ write: (text) => void f.term.push(text), readLine: async () => answers.shift() ?? '' }),
    secrets: async () => ({ DESK_ACCESS_TOKEN: 'eyJ.not-a-token' }),
    exec: async (command, args, input) => void f.execs.push({ command, args, input }),
    volumeOf,
    removableVolume: () => false,
    readText,
    placement,
    env: {},
    appDir: APP,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 50))),
    readStdin: async () => stdin,
    secretOut: async (text) => void f.stdout.push(text),
    stdoutIsTerminal: false,
    ...rest,
  };
  fakes.push(f);
  return f;
}

/**
 * What a printed key, token or code looks like: a `smns-…` code, a JWK's private `"d"`, or a JWT- or JWK-shaped token,
 * which is `eyJ` (base64url of `{"`) at a token boundary and then the rest of an encoded JSON object. A bare `eyJ`
 * would also match inside a hash or an id that is legitimately printed, about once per few thousand characters.
 */
const shaped = /smns-(enroll|provision|pair)-v\d\.|(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}|"d"\s*:/;

describe('the shape of a printed secret', () => {
  const jwt = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln';
  it('catches a token printed after a space, a quote or `=`', () => {
    for (const line of [`token ${jwt}`, `"${jwt}"`, `DESK_ACCESS_TOKEN=${jwt}`, jwt, `key: eyJrdHkiOiJFQyJ9`]) expect(line).toMatch(shaped);
  });
  it('catches a code and a JWK private part, as before', () => {
    expect('smns-enroll-v2.abc').toMatch(shaped);
    expect('{"d": "x"}').toMatch(shaped);
  });
  it('does not match `eyJ` inside a longer base64url run, such as a hash or an id', () => {
    for (const line of ['hash AbC9eyJx_k2', 'id=Zm9vYmFyeyJhbGciOiJFUzI1NiJ9AAAA', 'eyJ', 'eyJ.not-a-token', 'sha256:q-eyJabcdefghijklmnop']) expect(line).not.toMatch(shaped);
  });
});

/** No fake's stdout or stderr holds anything shaped like a key, a token or a code, or any secret a case handled. */
function nothingSecretPrinted(): void {
  for (const f of fakes) {
    const printed = [...f.out, ...f.err].join('\n');
    expect(printed).not.toMatch(shaped);
    for (const secret of secrets) expect(printed).not.toContain(secret);
  }
}

/** Waits for `probe` to answer, up to 15 s. */
async function until<T>(probe: () => T | undefined | null | false): Promise<T> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const got = probe();
    if (got) return got;
    if (Date.now() > deadline) throw new Error('not within 15 s');
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** The enrollment code a running `enroll` wrote to its terminal. */
const codeOn = (f: Fake) => until(() => /smns-enroll-v2\.[A-Za-z0-9_-]+/.exec(f.term.join(''))?.[0]);

describe('on the local hub', () => {
  let hub: LocalHub;
  let member: string;
  const keys = join(scratch, 'owner', 'keys.json');
  const asLocal = (...extra: string[]) => ['--hub', hub.url, '--user', ADMIN, '--keys', keys, ...extra];
  const served = async () => (await hub.fetchAs(ADMIN, '/api/org/state?since=0').then((r) => r.json())) as { head: SignedOrgState; chain: SignedOrgState[]; certificates: { certs: Array<{ body: { name: string; machine: string; pub: string } }> } };
  const head = async () => (await served()).head;
  const hubRows = async () => ((await hub.fetchAs(ADMIN, '/api/machines').then((r) => r.json())) as { machines: MachineView[] }).machines;
  const anchor = () => JSON.parse(readFileSync(anchorFile(keys), 'utf8')) as { version: number; pending?: SignedOrgState; unsent?: true };

  beforeAll(async () => {
    hub = await startLocalHub();
    expect(await runAdmin(['init', '--keys', keys], fake().io)).toBe(0);
    expect(await runAdmin(['genesis', '--recovery', join(dir('volume'), 'recovery.json'), ...asLocal('--yes')], fake().io)).toBe(0);
    member = ((await hub.fetchAs(ADMIN, '/api/me').then((r) => r.json())) as { member: { id: string } }).member.id;
  });
  afterAll(() => hub?.close());

  it('shows a fresh org: the age line, the members and their devices, no machine and no delegation', async () => {
    const f = fake();
    expect(await runAdmin(['show', ...asLocal()], f.io)).toBe(0);
    const admin = (await readAdminKeys(keys)).id;
    expect(f.out[0]).toBe('head version 1, issued 0 days ago');
    expect(f.out).toContain(`member ${member} ${ADMIN} admin`);
    expect(f.out).toContain(`  device ${admin} native-mac software rpId - (this admin device)`);
    expect(f.out).toContain('machines: none');
    expect(f.out).toContain('delegations: none');
  });

  /** `enroll NAME` running, its code once shown, and the machine the test plays. */
  async function enrolling(name: string, extra: string[] = ['--yes'], answers: string[] = []) {
    const f = fake(answers);
    const running = runAdmin(['enroll', name, '--wait', '20', ...asLocal(...extra)], f.io);
    const code = await codeOn(f);
    secrets.add(code);
    const decoded = decodeEnrollmentCodeV2(code);
    secrets.add(decoded.token);
    secrets.add(decoded.k);
    return { f, running, code, decoded };
  }

  let m1: Awaited<ReturnType<typeof enrollV2>>;

  it('enrolls a machine by a code on the terminal, checks its key under the MAC, shows what to compare, and lists it', async () => {
    const before = await head();
    const { f, running, code, decoded } = await enrolling('m1');
    expect(decoded).toEqual({ hub: hub.url, token: expect.any(String), roots: before.state.root.keys, recoveryPub: before.state.root.recoveryPub, k: expect.any(String), machine: 'm1' });
    // Nothing of the code on stdout or stderr; on the terminal, and (against a deployment only) the clipboard.
    expect([...f.out, ...f.err].join('\n')).not.toContain(code);
    expect(f.execs).toEqual([]);
    m1 = await enrollV2(code, 'm1');
    expect(await running).toBe(0);
    const kid = await keyId(m1.key.pub);
    expect(f.out).toContain(`machine m1 ref ${m1.ref} key ${kid}`);
    expect(f.out).toContain('compare with mawsd keys --json on m1, then list it? [y/N] yes (--yes)');
    expect(f.out.at(-1)).toBe(`listed: version ${before.state.version + 1}`);
    const after = await head();
    expect(after.state.machines).toEqual([{ name: 'm1', ref: m1.ref, pub: m1.key.pub, owners: [member] }]);
    expect(after.state.machineNames).toEqual([{ name: 'm1', ref: m1.ref }]);
    expect(anchor().pending).toBeUndefined();
  });

  it('refuses a key whose MAC is not under the code\'s secret, and signs nothing', async () => {
    const before = await head();
    const { f, running, code } = await enrolling('m2');
    // The key posted under another pairing secret, as a substitution on the way would be.
    const decoded = decodeEnrollmentCodeV2(code);
    await enrollV2(encodeEnrollmentCodeV2({ ...decoded, k: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) }), 'm2');
    expect(await running).toBe(1);
    expect(f.err.join('\n')).toMatch(/its MAC is not under this code's secret: nothing was signed/);
    expect((await head()).state.version).toBe(before.state.version);
  });

  it('shows a leaked code\'s other machine with its own ref and key, which the owner, comparing, declines', async () => {
    const before = await head();
    const { f, running, code } = await enrolling('m3', [], ['n']);
    // The intended machine's ref and key, as its `mawsd keys --json` would print them; another process redeemed first.
    const intended = { ref: mintRef(), key: await generateSigningKey() };
    const thief = await enrollV2(code, 'm3');
    expect(await running).toBe(1);
    const shown = f.out.find((l) => l.startsWith('machine m3 '))!;
    expect(shown).toBe(`machine m3 ref ${thief.ref} key ${await keyId(thief.key.pub)}`);
    expect(shown).not.toContain(intended.ref);
    expect(shown).not.toContain(await keyId(intended.key.pub));
    // Locally the values are on stdout and the question alone at the terminal; against a deployment both are there.
    expect(f.term.join('')).toMatch(/compare with mawsd keys --json on m3, then list it\? \[y\/N\] $/);
    expect(f.err.join('\n')).toMatch(/not listed: nothing was signed/);
    expect((await head()).state.version).toBe(before.state.version);
  });

  it('refuses a name the head lists unless --replace, and with it lists the new key under the same ref, the old one retired', async () => {
    const plain = fake();
    expect(await runAdmin(['enroll', 'm1', '--wait', '5', ...asLocal('--yes')], plain.io)).toBe(1);
    expect(plain.err.join('\n')).toMatch(/m1 is listed \(ref .*\): re-enroll it with --replace/);
    expect(plain.term).toEqual([]);
    // m2's row: redeemed, its key posted, never listed.
    const row = fake();
    expect(await runAdmin(['enroll', 'm2', '--wait', '5', ...asLocal('--yes')], row.io)).toBe(1);
    expect(row.err.join('\n')).toMatch(/the hub holds a row named m2 .*: re-enroll it in place with --replace, or drop the row first \(machine drop m2\)/);
    expect(row.term).toEqual([]);

    const before = await head();
    const { running, code } = await enrolling('m1', ['--replace', '--yes']);
    const again = await enrollV2(code, 'm1', { ref: m1.ref });
    expect(await running).toBe(0);
    const after = await head();
    expect(after.state.version).toBe(before.state.version + 1);
    expect(after.state.machines).toEqual([{ name: 'm1', ref: m1.ref, pub: again.key.pub, owners: [member] }]);
    expect(after.state.retired).toEqual([{ keyId: await keyId(m1.key.pub), pub: m1.key.pub, notAfter: expect.any(String), holder: { machine: m1.ref } }]);
    m1 = again;
  });

  it('refuses a re-enrollment under another ref, since the name is bound to its ref for the life of the org', async () => {
    const before = await head();
    const { f, running, code } = await enrolling('m1', ['--replace', '--yes']);
    await enrollV2(code, 'm1');
    expect(await running).toBe(1);
    expect(f.err.join('\n')).toMatch(/m1 is bound to ref .* for the life of the org, and this machine posted ref .*: nothing was signed/);
    expect((await head()).state.version).toBe(before.state.version);
  });

  it('holds the anchor\'s lock for its signing alone: a refresh during its wait signs, and it signs next on the head it reads again', async () => {
    const before = await head();
    const { f, running, code } = await enrolling('m4');
    const refreshed = fake();
    expect(await runAdmin(['refresh', ...asLocal()], refreshed.io)).toBe(0);
    expect(refreshed.out.at(-1)).toBe(`refreshed: version ${before.state.version + 1} (no change)`);
    await enrollV2(code, 'm4');
    expect(await running).toBe(0);
    expect(f.out.at(-1)).toBe(`listed: version ${before.state.version + 2}`);
    const { chain } = await served();
    expect(chain.slice(-3).map((s) => s.state.version)).toEqual([before.state.version, before.state.version + 1, before.state.version + 2]);
    expect(chain.at(-1)!.state.prev).toBe(await stateHash(chain.at(-2)!.state));
    expect(anchor()).toMatchObject({ version: before.state.version + 2 });
    expect(anchor().pending).toBeUndefined();
  });

  it('serializes two signers started at once: the second is refused, naming the first, with nothing signed', async () => {
    const before = await head();
    const [a, b] = [fake(), fake()];
    const codes = await Promise.all([runAdmin(['refresh', ...asLocal()], a.io), runAdmin(['refresh', ...asLocal()], b.io)]);
    expect(codes.sort()).toEqual([0, 1]);
    expect([...a.err, ...b.err].join('\n')).toMatch(/another run holds .*keys\.json\.org\.json\.lock/);
    expect((await head()).state.version).toBe(before.state.version + 1);
  });

  it('refuses every verb but publish while an unsent delegation is pending: an enroll waiting across a create resumes and posts nothing', async () => {
    const before = await head();
    const { f, running, code } = await enrolling('m6');
    const created = fake();
    expect(await runAdmin(['delegation', 'create', '--label', 'cc', '--prefix', 'cc-', '--code-to-stdout', ...asLocal('--yes')], created.io)).toBe(0);
    const issued = decodeProvisioningCodeV2(created.stdout[0].trim());
    secrets.add(created.stdout[0].trim());
    secrets.add(issued.token);
    secrets.add(issued.delegation.privateJwk.d!);
    const id = issued.delegation.id;
    const n = before.state.version + 1;
    await enrollV2(code, 'm6');
    expect(await running).toBe(1);
    const refusal = new RegExp(`version ${n} lists delegation ${id} \\(prefix cc-\\), signed by delegation create and unsent in .*: nothing was signed or sent\\. Once its stored code decodes under code inspect, admin delegation publish sends it; if the store failed, admin abandon-pending, then admin provisioning revoke ${id}`);
    expect(f.err.join('\n')).toMatch(refusal);
    for (const verb of [['refresh'], ['machine', 'drop', 'm6'], ['provisioning', 'revoke', id]]) {
      const other = fake();
      expect(await runAdmin([...verb, ...asLocal('--yes')], other.io), verb.join(' ')).toBe(1);
      expect(other.err.join('\n'), verb.join(' ')).toMatch(refusal);
    }
    // Nothing reached the hub: no delegation, no machine, the head where it was.
    const after = await head();
    expect(after.state.version).toBe(before.state.version);
    expect(after.state.delegations.map((d) => d.prefix)).not.toContain('cc-');
    expect(after.state.machines.map((m) => m.name)).not.toContain('m6');
    expect(anchor()).toMatchObject({ unsent: true, pending: { state: { version: n } } });
    // Abandoned, the device signs again; its key revoked.
    const hash = await stateHash(anchor().pending!.state);
    const abandoned = fake(['y']);
    expect(await runAdmin(['abandon-pending', ...asLocal()], abandoned.io)).toBe(0);
    expect(abandoned.out).toContain(`pending version ${n} ${hash} was never sent: nothing was posted`);
    expect(anchor()).not.toHaveProperty('pending');
    expect(await runAdmin(['provisioning', 'revoke', id, ...asLocal('--yes')], fake().io)).toBe(0);
    expect(await runAdmin(['machine', 'drop', 'm6', ...asLocal('--yes')], fake().io)).toBe(0);
  });

  let delegation: ProvisioningCodeV2;

  it('creates a delegation: confirmed first, the provisioning key minted, the delegation signed into pending, the code on stdout alone; publish alone sends it', async () => {
    const before = await head();
    const keysBefore = ((await hub.fetchAs(ADMIN, '/api/provisioning-keys').then((r) => r.json())) as { keys: ProvisioningKeyRecord[] }).keys.length;
    const f = fake();
    expect(await runAdmin(['delegation', 'create', '--label', 'devcloud', '--prefix', 'vm-', '--code-to-stdout', ...asLocal('--yes')], f.io)).toBe(0);
    expect(f.out).toEqual([]);
    expect(f.stdout).toHaveLength(1);
    expect(f.stdout[0]).toMatch(/^smns-provision-v2\.[A-Za-z0-9_-]+\n$/);
    delegation = decodeProvisioningCodeV2(f.stdout[0].trim());
    secrets.add(f.stdout[0].trim());
    secrets.add(delegation.token);
    secrets.add(delegation.delegation.privateJwk.d!);
    expect(f.err).toContain('delegate vm- for 7776000 s? [y/N] yes (--yes)');
    // Nothing is posted: the hub's head stays, and the anchor holds the signed successor, never sent.
    const n = before.state.version + 1;
    const id = delegation.delegation.id;
    expect((await head()).state.version).toBe(before.state.version);
    expect(anchor()).toMatchObject({ unsent: true, pending: { state: { version: n } } });
    expect(anchor().pending!.state.delegations.map((d) => d.id)).toEqual([id]);
    const said = f.err.join('\n');
    expect(said).toContain(`version ${n} lists delegation ${id} (prefix vm-, expires ${anchor().pending!.state.delegations[0].expires}), signed and pending in ${anchorFile(keys)}: nothing was posted`);
    expect(said).toMatch(new RegExp(`next: the store \\(gcloud secrets create\\) takes the code once this command exits; check the stored code with code inspect; then admin delegation publish sends version ${n}, and delegation ${id} is in effect`));
    expect(said).toContain(`if the store failed or the stored code does not decode: admin abandon-pending (nothing was posted), then admin provisioning revoke ${id}`);
    // `show` reads: it names the unsent delegation and sends nothing.
    const shown = fake();
    expect(await runAdmin(['show', ...asLocal()], shown.io)).toBe(0);
    expect(shown.out).toContain(`pending version ${n} lists delegation ${id} (prefix vm-), unsent: admin delegation publish sends it once its stored code decodes under code inspect`);
    expect(shown.out.join('\n')).not.toMatch(/sent$|in effect/m);
    expect((await head()).state.version).toBe(before.state.version);
    expect(anchor()).toMatchObject({ unsent: true });
    // `delegation publish`, confirmed, sends it.
    const published = fake();
    expect(await runAdmin(['delegation', 'publish', ...asLocal('--yes')], published.io)).toBe(0);
    expect(published.out).toContain(`publish delegation ${id}? [y/N] yes (--yes)`);
    expect(published.out).toContain(`delegation ${id} prefix vm- in effect from version ${n}`);
    expect(published.out.at(-1)).toBe(`published: version ${n}`);
    expect(anchor().pending).toBeUndefined();
    expect(anchor()).not.toHaveProperty('unsent');
    const after = await head();
    expect(after.state.version).toBe(n);
    const pub = (await importSigningKey(delegation.delegation.privateJwk)).pub;
    expect(after.state.delegations).toEqual([expect.objectContaining({ id: delegation.delegation.id, prefix: 'vm-', pub, owners: [member] })]);
    expect(delegation).toEqual({ hub: hub.url, org: ORG, roots: after.state.root.keys, recoveryPub: after.state.root.recoveryPub, token: expect.any(String), delegation: { id: expect.stringMatching(/^[0-9a-f]{32}$/), prefix: 'vm-', privateJwk: expect.any(Object) } });
    const listed = ((await hub.fetchAs(ADMIN, '/api/provisioning-keys').then((r) => r.json())) as { keys: ProvisioningKeyRecord[] }).keys;
    expect(listed).toHaveLength(keysBefore + 1);
    expect(listed.find((k) => k.id === delegation.delegation.id)?.delegation).toEqual({ pub, owners: [member] });
  });

  it('refuses a stdout that is a terminal, and a prefix the head already holds or nests, before anything is minted', async () => {
    const count = async () => ((await hub.fetchAs(ADMIN, '/api/provisioning-keys').then((r) => r.json())) as { keys: ProvisioningKeyRecord[] }).keys.length;
    const before = await count();
    const version = (await head()).state.version;
    const terminal = fake([], { stdoutIsTerminal: true });
    expect(await runAdmin(['delegation', 'create', '--label', 'x', '--prefix', 'dc-', '--code-to-stdout', ...asLocal('--yes')], terminal.io)).toBe(1);
    expect(terminal.err.join('\n')).toMatch(/stdout is a terminal: the code goes only to a pipe \(into Secret Manager\)/);
    const unnamed = fake();
    expect(await runAdmin(['delegation', 'create', '--label', 'x', '--prefix', 'dc-', ...asLocal('--yes')], unnamed.io)).toBe(1);
    expect(unnamed.err.join('\n')).toMatch(/--code-to-stdout/);
    for (const [prefix, why] of [
      ['vm-', /the prefix vm- is delegation .*'s/],
      ['vm-a', /the prefix vm-a nests with delegation .*'s vm-/],
      ['v', /the prefix v nests with delegation .*'s vm-/],
      ['m', /the machine m1 is named under the prefix m/],
    ] as const) {
      const f = fake();
      expect(await runAdmin(['delegation', 'create', '--label', 'x', '--prefix', prefix, '--code-to-stdout', ...asLocal('--yes')], f.io), prefix).toBe(1);
      expect(f.err.join('\n'), prefix).toMatch(why);
      expect(f.stdout).toEqual([]);
    }
    expect(await count()).toBe(before);
    expect((await head()).state.version).toBe(version);
  });

  let legacyKey: string;
  let legacyDelegation: ProvisioningCodeV2;

  it('copies the org key from a v1 provisioning code on stdin into the code\'s legacy, and from nothing else', async () => {
    legacyKey = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
    secrets.add(legacyKey);
    const v1 = encodeProvisioningCode({ hub: hub.url, org: ORG, token: 'v1-provisioning-secret', prefix: 'old-', key: legacyKey });
    secrets.add(v1);
    const f = fake([], { stdin: `${v1}\n` });
    expect(await runAdmin(['delegation', 'create', '--label', 'legacy', '--prefix', 'lg-', '--code-to-stdout', '--legacy-from-v1-code', '--ttl', '3600', '--max-uses', '5', ...asLocal('--yes')], f.io)).toBe(0);
    legacyDelegation = decodeProvisioningCodeV2(f.stdout[0].trim());
    secrets.add(f.stdout[0].trim());
    secrets.add(legacyDelegation.token);
    secrets.add(legacyDelegation.delegation.privateJwk.d!);
    expect(legacyDelegation.legacy).toEqual({ org: ORG, key: legacyKey });
    expect(f.err).toContain('delegate lg- for 3600 s? [y/N] yes (--yes)');
    expect(await runAdmin(['delegation', 'publish', ...asLocal('--yes')], fake().io)).toBe(0);
    expect((await head()).state.delegations.find((d) => d.prefix === 'lg-')).toMatchObject({ maxUses: 5 });

    const other = fake([], { stdin: encodeProvisioningCode({ hub: 'https://elsewhere.example', org: ORG, token: 't', prefix: 'old-', key: legacyKey }) });
    expect(await runAdmin(['delegation', 'create', '--label', 'x', '--prefix', 'lh-', '--code-to-stdout', '--legacy-from-v1-code', ...asLocal('--yes')], other.io)).toBe(1);
    expect(other.err.join('\n')).toMatch(/the v1 code is for https:\/\/elsewhere\.example, not /);
    const none = fake([], { stdin: 'not a code' });
    expect(await runAdmin(['delegation', 'create', '--label', 'x', '--prefix', 'lh-', '--code-to-stdout', '--legacy-from-v1-code', ...asLocal('--yes')], none.io)).toBe(1);
    expect(none.err.join('\n')).toMatch(/stdin holds no v1 provisioning code/);
  });

  let vm: Awaited<ReturnType<typeof enrollDelegated>>;

  it('makes a code a VM certifies itself with: its token redeems under the prefix and its key signs a certificate the hub keeps', async () => {
    const key = { id: delegation.delegation.id, key: await importSigningKey(delegation.delegation.privateJwk) };
    vm = await enrollDelegated(hub.url, delegation.token, 'vm-x1', key);
    expect((await served()).certificates.certs.map((c) => c.body.name)).toEqual(['vm-x1']);
  });

  it('drops a certificate machine: its key retired with its ref as holder, its row deleted, so a recreated VM takes the name', async () => {
    const f = fake();
    expect(await runAdmin(['machine', 'drop', 'vm-x1', ...asLocal('--yes')], f.io)).toBe(0);
    const kid = await keyId(vm.key.pub);
    expect(f.out).toContain(`drop vm-x1 (a certificate of delegation ${delegation.delegation.id}, ref ${vm.ref}, key ${kid}: retired)? [y/N] yes (--yes)`);
    const after = await head();
    expect(after.state.retired).toContainEqual({ keyId: kid, pub: vm.key.pub, notAfter: expect.any(String), holder: { machine: vm.ref } });
    expect((await hubRows()).map((m) => m.name)).not.toContain('vm-x1');
    const key = { id: delegation.delegation.id, key: await importSigningKey(delegation.delegation.privateJwk) };
    const recreated = await enrollDelegated(hub.url, delegation.token, 'vm-x1', key);
    expect(recreated.ref).not.toBe(vm.ref);
  });

  it('drops an attended machine: its key retired (or with --revoke revoked) and its row deleted', async () => {
    const f = fake();
    expect(await runAdmin(['machine', 'drop', 'm1', ...asLocal('--yes')], f.io)).toBe(0);
    const after = await head();
    expect(after.state.machines.map((m) => m.name)).toEqual(['m4']);
    expect(after.state.retired).toContainEqual({ keyId: await keyId(m1.key.pub), pub: m1.key.pub, notAfter: expect.any(String), holder: { machine: m1.ref } });
    expect((await hubRows()).map((m) => m.name)).not.toContain('m1');

    const revoked = fake();
    const m4 = after.state.machines[0];
    expect(await runAdmin(['machine', 'drop', 'M4', '--revoke', ...asLocal('--yes')], revoked.io)).toBe(0);
    const next = await head();
    expect(next.state.machines).toEqual([]);
    expect(next.state.revoked).toContainEqual({ keyId: await keyId(m4.pub), holder: { machine: m4.ref } });
    expect((await hubRows()).map((m) => m.name)).not.toContain('m4');
  });

  it('drops a phase-1 row with the DELETE alone, signing nothing; and refuses a name nothing holds', async () => {
    await enrollV1(hub, ADMIN, 'old-mac');
    const version = (await head()).state.version;
    const f = fake();
    expect(await runAdmin(['machine', 'drop', 'old-mac', ...asLocal('--yes')], f.io)).toBe(0);
    expect(f.out).toContain('drop old-mac (a hub row with no key in the head: deleted)? [y/N] yes (--yes)');
    expect((await head()).state.version).toBe(version);
    expect((await hubRows()).map((m) => m.name)).not.toContain('old-mac');
    const none = fake();
    expect(await runAdmin(['machine', 'drop', 'nothing-here', ...asLocal('--yes')], none.io)).toBe(1);
    expect(none.err.join('\n')).toMatch(/nothing is named nothing-here: not in the head, no live certificate, no hub row/);
  });

  it('revokes a phase-1 provisioning key, and refuses a live delegation\'s', async () => {
    const v1 = await provisioningKey(hub, ADMIN, { label: 'phase 1', prefix: 'old-' });
    const f = fake();
    expect(await runAdmin(['provisioning', 'revoke', v1.id, ...asLocal('--yes')], f.io)).toBe(0);
    expect(f.out.at(-1)).toBe(`revoked: provisioning key ${v1.id}`);
    const listed = ((await hub.fetchAs(ADMIN, '/api/provisioning-keys').then((r) => r.json())) as { keys: ProvisioningKeyRecord[] }).keys;
    expect(listed.find((k) => k.id === v1.id)?.revoked).toEqual(expect.any(String));
    const live = fake();
    expect(await runAdmin(['provisioning', 'revoke', delegation.delegation.id, ...asLocal('--yes')], live.io)).toBe(1);
    expect(live.err.join('\n')).toMatch(/is delegation vm-'s: delegation drop .* revokes it with the delegation/);
  });

  it('shows the machines as tables: an attended machine listed, a certificate machine certified, a retired one with its notAfter, and the delegations', async () => {
    const { running, code } = await enrolling('m5');
    const m5 = await enrollV2(code, 'm5');
    expect(await running).toBe(0);
    const f = fake();
    expect(await runAdmin(['show', ...asLocal()], f.io)).toBe(0);
    const text = f.out.join('\n');
    expect(text).toMatch(/^NAME +STATE +REF +KEY +ONLINE +SEEN$/m);
    // The DX2 presence as the hub reports it (O14 M5a): an RL10 machine never opens DX2, so offline, never seen.
    expect(text).toMatch(new RegExp(`^m5 +listed +${m5.ref} +${await keyId(m5.key.pub)} +false +-$`, 'm'));
    expect(text).toMatch(/^m2 +unlisted +[^ ]+ +[^ ]+ +false +-$/m);
    expect(text).toMatch(new RegExp(`^vm-x1 +retired ${'\\d{4}-[^ ]+'} +${vm.ref} +${await keyId(vm.key.pub)} +- +-$`, 'm'));
    expect(text).toMatch(/^vm-x1 +certified +[^ ]+_[^ ]+ +[^ ]+ +false +-$/m);
    expect(text).toMatch(new RegExp(`^delegation ${delegation.delegation.id} prefix vm- expires [^ ]+ owners ${member}$`, 'm'));
    expect(text).toMatch(/ prefix lg- expires [^ ]+ max-uses 5 owners /);
  });

  it('drops a delegation: its key revoked by its id and prefix, its certificates\' retirements moved to revoked, its key at the hub revoked', async () => {
    const f = fake();
    const id = delegation.delegation.id;
    expect(await runAdmin(['delegation', 'drop', id, ...asLocal('--yes')], f.io)).toBe(0);
    expect(f.out).toContain(`drop ${id} (its prefix vm- stays reserved)? [y/N] yes (--yes)`);
    const after = await head();
    const pub = (await importSigningKey(delegation.delegation.privateJwk)).pub;
    expect(after.state.delegations.map((d) => d.prefix)).toEqual(['lg-']);
    expect(after.state.revoked).toContainEqual({ keyId: await keyId(pub), holder: { delegation: id, prefix: 'vm-' } });
    expect(after.state.retired.some((r) => 'machine' in r.holder && r.holder.machine.startsWith(`${id}_`))).toBe(false);
    expect(after.state.revoked).toContainEqual({ keyId: await keyId(vm.key.pub), holder: { machine: vm.ref } });
    const listed = ((await hub.fetchAs(ADMIN, '/api/provisioning-keys').then((r) => r.json())) as { keys: ProvisioningKeyRecord[] }).keys;
    expect(listed.find((k) => k.id === id)?.revoked).toEqual(expect.any(String));
    // Its prefix stays reserved: a new delegation under it is refused before anything is minted.
    const again = fake();
    expect(await runAdmin(['delegation', 'create', '--label', 'x', '--prefix', 'vm-', '--code-to-stdout', ...asLocal('--yes')], again.io)).toBe(1);
    expect(again.err.join('\n')).toMatch(/the prefix vm- is the dropped delegation .*'s, reserved for the life of the org/);
  });

  describe('a pending proposal', () => {
    /** A signed successor of the hub's head, written into the anchor as pending as if its POST had failed. */
    async function pendingOf(edit: Parameters<typeof successor>[1] = () => {}) {
      const admin = await readAdminKeys(keys);
      const proposal = await signOrgState(await successor((await head()).state, edit), [admin.stepUp]);
      writeFileSync(anchorFile(keys), JSON.stringify({ ...anchor(), pending: proposal }), { mode: 0o600 });
      return proposal;
    }

    it('is settled by any verb first, O14\'s included', async () => {
      const proposal = await pendingOf();
      const f = fake();
      expect(await runAdmin(['show', ...asLocal()], f.io)).toBe(0);
      expect(f.out).toContain(`pending version ${proposal.state.version} is not at the hub: sent again`);
      expect(anchor().pending).toBeUndefined();
      expect((await head()).state.version).toBe(proposal.state.version);
      // A signing verb settles a sent proposal the same way before it signs its own.
      const again = await pendingOf();
      const refreshed = fake();
      expect(await runAdmin(['refresh', ...asLocal()], refreshed.io)).toBe(0);
      expect(refreshed.out).toContain(`pending version ${again.state.version} is not at the hub: sent again`);
      expect(refreshed.out.at(-1)).toBe(`refreshed: version ${again.state.version + 1} (no change)`);
    });

    it('is abandoned only on the owner\'s word, after it says the consequence; declined, it stays', async () => {
      const nothing = fake();
      expect(await runAdmin(['abandon-pending', ...asLocal()], nothing.io)).toBe(0);
      expect(nothing.out.at(-1)).toBe('nothing pending');

      const proposal = await pendingOf((s) => void s.projects.push({ id: 'p-refused', name: 'refused' }));
      const hash = await stateHash(proposal.state);
      const declined = fake(['n']);
      expect(await runAdmin(['abandon-pending', ...asLocal()], declined.io)).toBe(1);
      expect(declined.term.join('')).toMatch(new RegExp(`abandon version ${proposal.state.version} ${hash}\\? A later verb may sign another successor of version ${proposal.state.version - 1}`));
      expect(canonicalOf(anchor().pending)).toBe(canonicalOf(proposal));

      const f = fake(['y']);
      expect(await runAdmin(['abandon-pending', ...asLocal()], f.io)).toBe(0);
      expect(f.out).toContain(`the hub's head is version ${proposal.state.version - 1}; pending version ${proposal.state.version} ${hash} is not at the hub`);
      expect(f.out.at(-1)).toBe(`abandoned: version ${proposal.state.version} ${hash}`);
      expect(anchor().pending).toBeUndefined();
      // The next verb signs a successor of the same parent, as the owner chose.
      const refreshed = fake();
      expect(await runAdmin(['refresh', ...asLocal()], refreshed.io)).toBe(0);
      expect((await head()).state.version).toBe(proposal.state.version);
      expect((await head()).state.projects).toEqual([]);
    });

    it('is not abandoned when the hub holds it: the next run adopts it', async () => {
      const proposal = await pendingOf();
      expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: proposal })).status).toBe(201);
      const f = fake(['y']);
      expect(await runAdmin(['abandon-pending', ...asLocal()], f.io)).toBe(1);
      expect(f.err.join('\n')).toMatch(new RegExp(`the hub holds pending version ${proposal.state.version}: the next run adopts it; nothing was abandoned`));
      expect(canonicalOf(anchor().pending)).toBe(canonicalOf(proposal));
      expect(await runAdmin(['show', ...asLocal()], fake().io)).toBe(0);
      expect(anchor().pending).toBeUndefined();
    });
  });

  it('refuses every hub-touching verb with no anchor, a chain of another genesis, or a head older than the anchor has seen', async () => {
    const verbs = [['show'], ['enroll', 'mx'], ['delegation', 'create', '--label', 'x', '--prefix', 'zz-', '--code-to-stdout'], ['delegation', 'drop', 'f'.repeat(32)], ['delegation', 'publish'], ['machine', 'drop', 'mx'], ['provisioning', 'revoke', 'f'.repeat(32)], ['keys', 'retire'], ['keys', 'purge'], ['abandon-pending']];
    const unanchored = join(dir('unanchored'), 'keys.json');
    for (const verb of verbs) {
      const f = fake();
      expect(await runAdmin([...verb, '--hub', hub.url, '--user', ADMIN, '--keys', unanchored, '--yes'], f.io), verb.join(' ')).toBe(1);
      expect(f.err.join('\n'), verb.join(' ')).toMatch(/no anchor: run genesis or adopt/);
    }
    const held = readFileSync(anchorFile(keys), 'utf8');
    try {
      for (const [change, why] of [
        [{ version: 999 }, /older than the version 999 this device has seen/],
        [{ genesis: 'x'.repeat(43) }, /not the anchor's x{43}: not this org's chain/],
      ] as const) {
        writeFileSync(anchorFile(keys), JSON.stringify({ ...JSON.parse(held), ...change }));
        for (const verb of verbs) {
          const f = fake();
          expect(await runAdmin([...verb, ...asLocal('--yes')], f.io), verb.join(' ')).toBe(1);
          expect(f.err.join('\n'), verb.join(' ')).toMatch(why);
          expect(f.term, verb.join(' ')).toEqual([]);
          expect(f.stdout, verb.join(' ')).toEqual([]);
        }
      }
    } finally {
      writeFileSync(anchorFile(keys), held);
    }
  });

  it('prints nothing shaped like a key, a token or a code on any verb\'s stdout or stderr, but the two secret stdouts', () => {
    expect(secrets.size).toBeGreaterThan(10);
    nothingSecretPrinted();
  });
});

const canonicalOf = (value: unknown) => canonicalize(value);

describe('delegation create against a hub that misbehaves', () => {
  // A proxy between the command and the local hub: `mint` rewrites the provisioning key's answer, and `statePosts`
  // counts the state POSTs that reached it.
  let hub: LocalHub;
  let proxy: Server;
  let proxyUrl: string;
  let mint: ((key: ProvisioningKeyRecord) => ProvisioningKeyRecord) | null = null;
  let statePosts = 0;
  const keys = join(scratch, 'misbehaving', 'keys.json');
  const via = (...extra: string[]) => ['--hub', proxyUrl, '--user', ADMIN, '--keys', keys, ...extra];
  const head = async () => ((await hub.fetchAs(ADMIN, '/api/org/state').then((r) => r.json())) as { head: SignedOrgState }).head;
  const anchor = () => JSON.parse(readFileSync(anchorFile(keys), 'utf8')) as { version: number; pending?: SignedOrgState; unsent?: true };
  const create = (prefix: string, ...extra: string[]) => ['delegation', 'create', '--label', 'devcloud', '--prefix', prefix, '--code-to-stdout', ...extra, ...via('--yes')];

  beforeAll(async () => {
    hub = await startLocalHub();
    proxy = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', async () => {
        const body = Buffer.concat(chunks);
        if (req.method === 'POST' && req.url === '/api/org/state') statePosts += 1;
        const headers: Record<string, string> = {};
        for (const name of ['x-desk-standin-user', 'content-type']) if (typeof req.headers[name] === 'string') headers[name] = req.headers[name] as string;
        const upstream = await fetch(`${hub.url}${req.url}`, { method: req.method, headers, body: body.length ? body : undefined });
        let answer = Buffer.from(await upstream.arrayBuffer());
        if (req.method === 'POST' && req.url === '/api/provisioning-keys' && upstream.status === 201 && mint) {
          const issued = JSON.parse(answer.toString()) as { key: ProvisioningKeyRecord; token: string };
          answer = Buffer.from(JSON.stringify({ ...issued, key: mint(issued.key) }));
        }
        res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
        res.end(answer);
      });
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    proxyUrl = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
    expect(await runAdmin(['init', '--keys', keys], fake().io)).toBe(0);
    expect(await runAdmin(['genesis', '--recovery', join(dir('volume'), 'recovery.json'), ...via('--yes')], fake().io)).toBe(0);
  });
  afterAll(async () => {
    await new Promise((resolve) => proxy?.close(resolve));
    await hub?.close();
  });

  it('signs the policy the owner approved, and refuses a mint answer that disagrees with it before signing anything', async () => {
    const version = (await head()).state.version;
    for (const [substitute, why] of [
      [(k: ProvisioningKeyRecord) => ({ ...k, prefix: 'd' }), /its prefix d, not the dc- you approved/],
      [(k: ProvisioningKeyRecord) => ({ ...k, expires: '2099-01-01T00:00:00.000Z' }), /it expires at 2099-01-01T00:00:00.000Z, not within 60 s of /],
      [(k: ProvisioningKeyRecord) => ({ ...k, max_uses: null }), /no use limit, not the 1 you approved/],
      [(k: ProvisioningKeyRecord) => ({ ...k, id: 'not-an-id' }), /its id not-an-id is not 32 hex/],
    ] as const) {
      mint = substitute;
      const f = fake();
      expect(await runAdmin(create('dc-', '--ttl', '3600', '--max-uses', '1'), f.io), String(why)).toBe(1);
      expect(f.err.join('\n'), String(why)).toMatch(why);
      expect(f.err.join('\n'), String(why)).toMatch(/the hub's answer to the mint disagrees with what you approved .*: nothing was signed; revoke the key it minted \(provisioning revoke /);
      expect(f.stdout, String(why)).toEqual([]);
      expect((await head()).state.version, String(why)).toBe(version);
      expect(anchor().pending, String(why)).toBeUndefined();
    }
    mint = null;
    const f = fake();
    expect(await runAdmin(create('dc-', '--ttl', '3600', '--max-uses', '1'), f.io)).toBe(0);
    expect(await runAdmin(['delegation', 'publish', ...via('--yes')], fake().io)).toBe(0);
    const [delegation] = (await head()).state.delegations;
    expect(delegation).toMatchObject({ prefix: 'dc-', maxUses: 1 });
    expect(Math.abs(Date.parse(delegation.expires) - (Date.now() + 3600_000))).toBeLessThan(60_000);
  });

  it('posts nothing: a run killed while it writes the code leaves the hub as it was and the proposal pending, never sent', async () => {
    const version = (await head()).state.version;
    const posts = statePosts;
    let written!: (code: string) => void;
    const writing = new Promise<string>((resolve) => (written = resolve));
    let finish!: () => void;
    const f = fake([], { secretOut: (text) => (written(text), new Promise<void>((resolve) => (finish = resolve))) });
    const running = runAdmin(create('lg-'), f.io);
    // The code is in the pipe and the pipe still open, which is where a Ctrl-C finds a stalled store: what the run
    // has done by now is what a kill leaves.
    const code = decodeProvisioningCodeV2((await writing).trim());
    secrets.add(code.token);
    secrets.add(code.delegation.privateJwk.d!);
    expect(statePosts).toBe(posts);
    expect((await head()).state.version).toBe(version);
    expect(anchor()).toMatchObject({ unsent: true, pending: { state: { version: version + 1 } } });
    expect(anchor().pending!.state.delegations.map((d) => d.id)).toContain(code.delegation.id);
    finish();
    expect(await running).toBe(0);
    expect(statePosts).toBe(posts);
    expect((await head()).state.version).toBe(version);
  });

  it('abandons such a proposal with no fork to fear, since nothing was posted, even once another successor took its version', async () => {
    const proposal = anchor().pending!;
    const id = proposal.state.delegations.find((d) => d.prefix === 'lg-')!.id;
    const n = proposal.state.version;
    // Another successor of the same parent reaches the hub first: the unsent proposal is stale, not a fork.
    const admin = await readAdminKeys(keys);
    const theirs = await signOrgState(await successor((await head()).state, (s) => void s.projects.push({ id: 'p-other', name: 'other' })), [admin.stepUp]);
    expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: theirs })).status).toBe(201);
    const stale = fake();
    expect(await runAdmin(['delegation', 'publish', ...via('--yes')], stale.io)).toBe(1);
    expect(stale.err.join('\n')).toMatch(new RegExp(`the hub holds version ${n} .* where this device's unsent version ${n} .* was signed \\(pending in .*\\): nothing was posted, and no fork exists; admin abandon-pending drops it`));
    expect(stale.err.join('\n')).not.toMatch(/Two successors/);
    const shown = fake();
    expect(await runAdmin(['show', ...via()], shown.io)).toBe(0);
    expect(shown.out.join('\n')).toMatch(new RegExp(`pending version ${n} lists delegation ${id} \\(prefix lg-\\), unsent and stale \\(the hub holds version ${n} [^ ]+\\): admin abandon-pending drops it`));

    const hash = await stateHash(proposal.state);
    const f = fake(['y']);
    expect(await runAdmin(['abandon-pending', ...via()], f.io)).toBe(0);
    expect(f.out).toContain(`pending version ${n} ${hash} was never sent: nothing was posted`);
    expect(f.term.join('')).toContain(`abandon version ${n} ${hash}? It was never posted, so nothing can show it as a fork [y/N]`);
    expect(f.term.join('')).not.toMatch(/A later verb may sign/);
    expect(f.out).toContain(`the abandoned proposal held delegation ${id} (prefix lg-), never posted: its provisioning key is minted at the hub; run provisioning revoke ${id}, and delete its code if it was stored`);
    expect(anchor().pending).toBeUndefined();
    expect(anchor()).not.toHaveProperty('unsent');
    const revoked = fake();
    expect(await runAdmin(['provisioning', 'revoke', id, ...via('--yes')], revoked.io)).toBe(0);
    expect(revoked.out.at(-1)).toBe(`revoked: provisioning key ${id}`);
  });

  it('drops its proposal when the code cannot be written (the pipe closed), and names the minted key for revoking', async () => {
    const version = (await head()).state.version;
    const posts = statePosts;
    const f = fake([], { secretOut: async () => Promise.reject(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })) });
    expect(await runAdmin(create('cl-'), f.io)).toBe(1);
    const id = /provisioning revoke ([0-9a-f]{32})/.exec(f.err.join('\n'))?.[1];
    expect(f.err.join('\n')).toMatch(new RegExp(`the code could not be written to stdout \\(write EPIPE\\): the proposal was dropped and nothing was posted; run provisioning revoke ${id}`));
    expect(statePosts).toBe(posts);
    expect((await head()).state.version).toBe(version);
    expect(anchor().pending).toBeUndefined();
    expect(await runAdmin(['provisioning', 'revoke', id!, ...via('--yes')], fake().io)).toBe(0);
  });
});

describe('the legacy org key: keys retire and keys purge', () => {
  let hub: LocalHub;
  const keys = join(scratch, 'legacy', 'keys.json');
  const asLocal = (...extra: string[]) => ['--hub', hub.url, '--user', ADMIN, '--keys', keys, ...extra];
  const head = async () => ((await hub.fetchAs(ADMIN, '/api/org/state').then((r) => r.json())) as { head: SignedOrgState }).head;
  const anchor = () => JSON.parse(readFileSync(anchorFile(keys), 'utf8')) as { version: number; pending?: SignedOrgState };
  const copies = () => hub.fetchAs(ADMIN, '/api/org/keys');

  beforeAll(async () => {
    hub = await startLocalHub();
    // Two wrapped copies of an org key at the hub, as DX1 left them.
    const key = await importOrgKey(crypto.getRandomValues(new Uint8Array(32)));
    const [check, auth] = [await keyCheck(key), await keyAuth(key)];
    secrets.add(auth);
    for (let i = 0; i < 2; i++) {
      const wrapped = base64urlEncode(crypto.getRandomValues(new Uint8Array(48)));
      secrets.add(wrapped);
      const body = { method: 'passphrase', label: `copy ${i}`, kdf: { name: 'argon2id', salt: base64urlEncode(crypto.getRandomValues(new Uint8Array(16))) }, iv: base64urlEncode(crypto.getRandomValues(new Uint8Array(12))), wrapped, check, auth };
      expect((await hub.fetchAs(ADMIN, '/api/org/keys', { body })).status).toBe(201);
    }
    expect(await runAdmin(['init', '--keys', keys], fake().io)).toBe(0);
    expect(await runAdmin(['genesis', '--recovery', join(dir('volume'), 'recovery.json'), ...asLocal('--yes')], fake().io)).toBe(0);
  });
  afterAll(() => hub?.close());

  it('retires the key in a signed successor, which show prints, and undoes it; each a no-op when already so', async () => {
    const before = (await head()).state.version;
    const f = fake();
    expect(await runAdmin(['keys', 'retire', ...asLocal('--yes')], f.io)).toBe(0);
    expect(f.out).toContain('retire the legacy org key? Machines stop using it; until keys purge, keys retire --undo takes it back [y/N] yes (--yes)');
    expect(f.out.at(-1)).toBe(`retired: the legacy org key, at version ${before + 1}`);
    const retired = (await head()).state;
    expect(retired.legacyRetired).toEqual({ version: before + 1, at: retired.issued });
    const shown = fake();
    expect(await runAdmin(['show', ...asLocal()], shown.io)).toBe(0);
    expect(shown.out).toContain(`legacyRetired version ${before + 1} at ${retired.issued}`);
    const again = fake();
    expect(await runAdmin(['keys', 'retire', ...asLocal('--yes')], again.io)).toBe(0);
    expect(again.out.at(-1)).toBe(`the head (version ${before + 1}) retires the legacy org key already: nothing was signed`);

    const undone = fake();
    expect(await runAdmin(['keys', 'retire', '--undo', ...asLocal('--yes')], undone.io)).toBe(0);
    expect(undone.out).toContain(`undo the legacy org key's retirement (version ${before + 1})? [y/N] yes (--yes)`);
    expect(undone.out.at(-1)).toBe(`restored: the legacy org key in use again, at version ${before + 2}`);
    expect((await head()).state).not.toHaveProperty('legacyRetired');
    const plain = fake();
    expect(await runAdmin(['show', ...asLocal()], plain.io)).toBe(0);
    expect(plain.out.join('\n')).not.toMatch(/legacyRetired/);
    const none = fake();
    expect(await runAdmin(['keys', 'retire', '--undo', ...asLocal('--yes')], none.io)).toBe(0);
    expect(none.out.at(-1)).toBe(`the head (version ${before + 2}) retires no legacy org key: nothing was signed`);
    expect(anchor().pending).toBeUndefined();
  });

  it('refuses keys purge before the head retires the key, then, retired and confirmed, purges every copy for good', async () => {
    const early = fake();
    expect(await runAdmin(['keys', 'purge', ...asLocal('--yes')], early.io)).toBe(1);
    expect(early.err.join('\n')).toMatch(/the head \(version \d+\) does not retire the legacy org key \(legacyRetired\): keys retire first; nothing was purged/);
    expect(((await (await copies()).json()) as { keys: unknown[] }).keys).toHaveLength(2);

    expect(await runAdmin(['keys', 'retire', ...asLocal('--yes')], fake().io)).toBe(0);
    const version = (await head()).state.version;
    const declined = fake(['n']);
    expect(await runAdmin(['keys', 'purge', ...asLocal()], declined.io)).toBe(1);
    expect(declined.term.join('')).toContain(`purge the 2 wrapped copies of the org key at ${hub.url}? This cannot be undone: the hub keeps no copy, and the retirement can never be taken back [y/N]`);
    expect(declined.err.join('\n')).toMatch(/not purged: the copies stay/);
    expect(((await (await copies()).json()) as { keys: unknown[] }).keys).toHaveLength(2);

    const f = fake();
    expect(await runAdmin(['keys', 'purge', ...asLocal('--yes')], f.io)).toBe(0);
    expect(f.out.at(-1)).toMatch(new RegExp(`^purged: 2 wrapped copies of the org key, under version ${version} at \\d{4}-`));
    expect((await copies()).status).toBe(410);
    const again = fake();
    expect(await runAdmin(['keys', 'purge', ...asLocal('--yes')], again.io)).toBe(0);
    expect(again.out.at(-1)).toBe('the hub holds no wrapped copy of the org key: purged already');
  });

  it('once purged, refuses keys retire --undo before signing, and the hub refuses a successor dropping the mark 409 key-purged', async () => {
    const version = (await head()).state.version;
    const f = fake();
    expect(await runAdmin(['keys', 'retire', '--undo', ...asLocal('--yes')], f.io)).toBe(1);
    expect(f.err.join('\n')).toMatch(/the hub purged the org key's wrapped copies: the retirement stands \(a successor without legacyRetired is refused 409 key-purged\); nothing was signed/);
    expect((await head()).state.version).toBe(version);
    expect(anchor().pending).toBeUndefined();
    // The hub's own check, met by a successor signed without the local one.
    const admin = await readAdminKeys(keys);
    const dropped = await signOrgState(await successor((await head()).state, restoreLegacyKey), [admin.stepUp]);
    const answer = await hub.fetchAs(ADMIN, '/api/org/state', { body: dropped });
    expect(answer.status).toBe(409);
    expect(await answer.text()).toMatch(/key-purged/);
  });

  it('prints nothing shaped like a key, a token or a code', () => nothingSecretPrinted());
});

describe('the local transforms', () => {
  // No keys, no anchor, no credential and no hub: not even --keys is needed.
  const sample = async (legacy = true): Promise<ProvisioningCodeV2> => {
    const key = await generateSigningKey(true);
    const jwk = (await crypto.subtle.exportKey('jwk', key.privateKey)) as JsonWebKey;
    return {
      hub: 'https://desk-hub.example',
      org: 'org-x',
      roots: [base64urlEncode(crypto.getRandomValues(new Uint8Array(16)))],
      recoveryPub: (await generateSigningKey()).pub,
      token: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))),
      delegation: { id: 'a'.repeat(32), prefix: 'dc-', privateJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d } },
      ...(legacy ? { legacy: { org: 'org-x', key: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) } } : {}),
    };
  };

  it('inspects a code: its fields, every key and token elided', async () => {
    const code = await sample();
    const text = encodeProvisioningCodeV2(code);
    const f = fake([], { stdin: `${text}\n`, secrets: async () => expect.unreachable('no credential is read') as never });
    expect(await runAdmin(['code', 'inspect'], f.io)).toBe(0);
    expect(f.out).toEqual([
      'smns-provision-v2 code',
      `hub ${code.hub}`,
      `org ${code.org}`,
      `roots ${code.roots.join(', ')}`,
      `recoveryPub ${code.recoveryPub}`,
      'token (elided)',
      `delegation ${code.delegation.id} prefix dc- privateJwk (elided)`,
      'legacy org org-x key (elided)',
    ]);
    for (const secret of [text, code.token, code.delegation.privateJwk.d!, code.legacy!.key]) expect([...f.out, ...f.err].join('\n')).not.toContain(secret);
    const without = fake([], { stdin: encodeProvisioningCodeV2(await sample(false)) });
    expect(await runAdmin(['code', 'inspect'], without.io)).toBe(0);
    expect(without.out.at(-1)).toBe('legacy none');
    // The package's codec (org-protocol, O14 M1) judges it, and its named refusal is what the owner reads.
    for (const [stdin, why] of [
      ['smns-provision-v1.e30', 'not smns-provision-v2'],
      ['smns-provision-v2.!!', 'damaged'],
      [encodeV2Raw({ ...code, token: undefined }), 'no token'],
      [encodeV2Raw({ ...code, extra: 1 }), 'unknown field extra'],
      [encodeV2Raw({ ...code, delegation: { ...code.delegation, extra: 1 } }), 'unknown field delegation.extra'],
    ] as const) {
      const bad = fake([], { stdin });
      expect(await runAdmin(['code', 'inspect'], bad.io), why).toBe(1);
      expect(bad.err, why).toEqual([`admin: stdin: provisioning code: ${why}`]);
    }
    // A private JWK as WebCrypto exports it, `ext` and `key_ops` included, is a code's.
    const exported = (await crypto.subtle.exportKey('jwk', (await generateSigningKey(true)).privateKey)) as JsonWebKey;
    expect(exported).toHaveProperty('key_ops');
    secrets.add(exported.d!);
    const webcrypto = fake([], { stdin: encodeV2Raw({ ...code, delegation: { ...code.delegation, privateJwk: exported } }) });
    expect(await runAdmin(['code', 'inspect'], webcrypto.io)).toBe(0);
  });

  it('strips the legacy field and nothing else, to a pipe alone', async () => {
    const code = await sample();
    // Its fields in another order than canonical JSON's: the stripped code is the package's encoding, byte for byte.
    const reordered = Object.fromEntries(Object.entries(code).reverse());
    const f = fake([], { stdin: `${encodeV2Raw(reordered)}\n` });
    expect(await runAdmin(['code', 'strip-legacy'], f.io)).toBe(0);
    expect(f.out).toEqual([]);
    expect(f.stdout).toHaveLength(1);
    const { legacy, ...rest } = code;
    expect(legacy).toBeDefined();
    expect(f.stdout[0]).toBe(`${encodeProvisioningCodeV2(rest)}\n`);
    expect(decodeProvisioningCodeV2(f.stdout[0].trim())).toEqual(rest);
    expect(f.err).toEqual(['strip-legacy: the legacy field is dropped']);
    const terminal = fake([], { stdin: encodeProvisioningCodeV2(code), stdoutIsTerminal: true });
    expect(await runAdmin(['code', 'strip-legacy'], terminal.io)).toBe(1);
    expect(terminal.err.join('\n')).toMatch(/stdout is a terminal/);
    expect(terminal.stdout).toEqual([]);
  });
});

/** A code's text around any object, unchecked: what a damaged or forged code could hold. */
const encodeV2Raw = (value: unknown) => `smns-provision-v2.${base64urlEncode(new TextEncoder().encode(JSON.stringify(value)))}`;

describe('against a deployment', () => {
  /** A deployment's config naming a host no request can reach (`.invalid`). */
  function unreachableConfig(): string {
    const file = join(dir('config'), 'config.json');
    writeFileSync(file, JSON.stringify({ account: 'acct', worker: 'admin-test', host: 'admin-test.example.invalid', ownerEmail: ADMIN, sessionDuration: '720h', org: { id: 'admin-test', name: 'admin test' } }));
    return file;
  }
  /** The command as the owner's shell runs it, but with no controlling terminal (a new session), as an agent's has none. */
  const detached = (args: string[]) =>
    new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', BIN, 'admin', ...args], {
        cwd: APP,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, DESK_ADMIN_KEYS: '', DESK_ACCESS_TOKEN: 'eyJ.not-a-token' },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += String(chunk)));
      child.stderr.on('data', (chunk) => (stderr += String(chunk)));
      child.stdin.end('');
      const timer = setTimeout(() => (child.kill('SIGKILL'), reject(new Error(`admin ${args[0]} still running after 60 s`))), 60_000);
      child.on('close', (code) => (clearTimeout(timer), resolve({ code, stdout, stderr })));
    });

  it('stops every verb that signs, posts or deletes at /dev/tty when the shell has none, before any request', async () => {
    const config = unreachableConfig();
    const keys = join(dir('keys'), 'keys.json');
    const verbs = [
      ['enroll', 'mx'],
      ['delegation', 'create', '--label', 'devcloud', '--prefix', 'dc-', '--code-to-stdout'],
      ['delegation', 'drop', 'f'.repeat(32)],
      ['delegation', 'publish'],
      ['keys', 'retire'],
      ['keys', 'retire', '--undo'],
      ['keys', 'purge'],
      ['machine', 'drop', 'mx'],
      ['provisioning', 'revoke', 'f'.repeat(32)],
      ['abandon-pending'],
    ];
    const runs = await Promise.all(verbs.map((verb) => detached([...verb, '--config', config, '--keys', keys])));
    runs.forEach((run, i) => {
      expect(run.code, verbs[i].join(' ')).toBe(1);
      expect(run.stderr, verbs[i].join(' ')).toMatch(/cannot open \/dev\/tty \(Device not configured: no controlling terminal\): .* asks the owner there before it signs anything; nothing was sent/);
      expect(run.stdout, verbs[i].join(' ')).toBe('');
    });
  }, 120_000);
});
