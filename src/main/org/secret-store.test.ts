// The provisioning code's custody (P5 O8 M4c, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4c's "The
// create transaction" steps 1, 4 and 5, "gcloud", and the refresh's item 14): gcloud resolved from the login shell's
// PATH and the usual install places; the preflight's two checks, each failure naming what's missing; the code on a
// child's stdin alone; the version read from gcloud's own words and confirmed by its metadata, never its value; each
// answer one of not attempted, failed, or may have succeeded. The real gcloud never runs: a fake `gcloud` script in a
// scratch directory, first on the injected PATH, records its argv, environment and stdin to files the tests read, and
// answers as each case sets it.
import { inspect } from 'node:util';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProvisioningSecret } from '@shared/ipc/schema/org';
import { gcloudFallbacks, ProvisioningCode, resolveGcloud, secretStore, type Gcloud, type StoreResult } from './secret-store';

const DEST: ProvisioningSecret = { project: 'maws-example-prod', secret: 'desk-provisioning-v2', account: 'cli-owner@maws-example-prod.iam.gserviceaccount.com' };
const CODE = `smns-provision-v2.${'Q29kZS1zZWNyZXQ'.repeat(12)}\n`;
const ACCESS_TOKEN = 'ya29.FAKE-ACCESS-TOKEN-never-kept';

// The fake: one line of argv per call (`gcloud a b c`), the environment and stdin appended to their logs. What it does
// is read from `act-<op>` beside it: `ok` (the default), `fail:<stderr line>` (after reading stdin), `early:<stderr
// line>` (before reading it), `created-fail` (announces version 7, then fails), `hang` (after reading stdin), `silent`
// (exit 0, no words), `die` (killed by a signal after reading stdin) or `linger` (answers as `ok`, leaving a helper that
// holds its pipes for 8 s, its pid in `linger.pid`) or `hold` (its stdin left unread, its pid in `hold.pid`, until it
// is killed); a version's state from `state`.
const FAKE = `#!/bin/sh
dir=$(cd "$(dirname "$0")" && pwd)
{ printf 'gcloud'; for a in "$@"; do printf ' %s' "$a"; done; printf '\\n'; } >> "$dir/argv.log"
env >> "$dir/env.log"
case "$1 $2 $3" in
  "auth print-access-token "*) op=auth ;;
  "secrets describe "*) op=describe ;;
  "secrets versions add") op=add ;;
  "secrets versions describe") op=version ;;
  "secrets versions access") op=access ;;
  *) op=other ;;
esac
act=$(cat "$dir/act-$op" 2>/dev/null || echo ok)
case "$act" in
  early:*) printf 'ERROR: (gcloud.%s) %s\\n' "$op" "\${act#early:}" >&2; exit 1 ;;
  hold) echo $$ > "$dir/hold.pid"; exec sleep 30 ;;
esac
cat >> "$dir/stdin.log"
case "$act" in
  created-fail) printf 'Created version [7] of the secret [%s].\\n' "$4" >&2
    printf 'ERROR: (gcloud.secrets.versions.add) Secret version was created, but the data checksum could not be confirmed.\\n' >&2; exit 1 ;;
  hang) exec sleep 30 ;;
  die) kill -9 $$ ;;
  silent) exit 0 ;;
  linger) sleep 8 & echo $! > "$dir/linger.pid" ;;
  fail:*) printf 'ERROR: (gcloud.%s) %s\\n' "$op" "\${act#fail:}" >&2; exit 1 ;;
esac
case "$op" in
  auth) printf '${ACCESS_TOKEN}\\n' ;;
  describe) printf 'name: projects/123456/secrets/%s\\n' "$3" ;;
  add) printf 'Created version [7] of the secret [%s].\\n' "$4" >&2 ;;
  version) state=$(cat "$dir/state" 2>/dev/null || echo ENABLED)
    printf '{\\n  "createTime": "2026-11-08T12:00:00.123456Z",\\n  "name": "projects/123456/secrets/%s/versions/%s",\\n  "state": "%s"\\n}\\n' "$6" "$4" "$state" ;;
esac
exit 0
`;

let scratch: string;
let bin: string;
let lines: string[];

async function fakeIn(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'gcloud'), FAKE);
  await chmod(join(dir, 'gcloud'), 0o755);
}
const act = (op: string, what: string) => writeFile(join(bin, `act-${op}`), what);
const recorded = async (name: string) => readFile(join(bin, name), 'utf8').catch(() => '');
/** Whether `pid` is gone within a second (reaped, or a zombie no longer signalable). */
async function gone(pid: number): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}
const argv = async () => (await recorded('argv.log')).split('\n').filter((l) => l !== '');
const gcloud = (): Promise<StoreResult<Gcloud>> => resolveGcloud({ loginPath: async () => `${bin}:/usr/bin:/bin`, home: scratch, fallbacks: [] });
const store = (timeoutMs = 10_000) => secretStore({ gcloud, log: (line) => void lines.push(line), timeoutMs });

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'maws-secret-store-'));
  bin = join(scratch, 'bin');
  await fakeIn(bin);
  lines = [];
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('resolveGcloud', () => {
  it("takes the login shell's PATH first, then /opt/homebrew/bin, /usr/local/bin and ~/google-cloud-sdk/bin, in order", async () => {
    expect(gcloudFallbacks('/Users/someone')).toEqual(['/opt/homebrew/bin', '/usr/local/bin', '/Users/someone/google-cloud-sdk/bin']);
    const [first, second, third] = [join(scratch, 'one'), join(scratch, 'two'), join(scratch, 'three')];
    await fakeIn(second);
    await fakeIn(third);
    // on the login PATH: the first directory holding it, and the child runs with that PATH
    expect(await resolveGcloud({ loginPath: async () => `${first}:${bin}:${second}`, home: scratch, fallbacks: [third] })).toEqual({
      ok: true,
      value: { path: join(bin, 'gcloud'), PATH: `${first}:${bin}:${second}` },
    });
    // none there (or no login PATH at all): the fallbacks in order, the found directory put first on the child's PATH
    expect(await resolveGcloud({ loginPath: async () => first, home: scratch, fallbacks: [join(scratch, 'none'), third, second] })).toEqual({
      ok: true,
      value: { path: join(third, 'gcloud'), PATH: `${third}:${first}` },
    });
    const none = await resolveGcloud({ loginPath: async () => null, home: scratch, fallbacks: [second] });
    expect(none.ok && none.value.path).toBe(join(second, 'gcloud'));
  });

  it('refuses `secret-store: gcloud not found`, not attempted, when no directory holds an executable gcloud', async () => {
    const plain = join(scratch, 'plain');
    await mkdir(plain);
    await writeFile(join(plain, 'gcloud'), FAKE); // not executable
    await mkdir(join(scratch, 'dir', 'gcloud'), { recursive: true }); // a directory named gcloud
    expect(await resolveGcloud({ loginPath: async () => `${plain}:${join(scratch, 'dir')}`, home: scratch, fallbacks: [join(scratch, 'nowhere')] })).toEqual({
      ok: false,
      outcome: 'not-attempted',
      detail: 'secret-store: gcloud not found',
    });
    // a store with no gcloud runs nothing and says so
    const missing = secretStore({ gcloud: async () => ({ ok: false, outcome: 'not-attempted', detail: 'secret-store: gcloud not found' }), log: () => {} });
    expect(await missing.preflight(DEST)).toEqual({ ok: false, outcome: 'not-attempted', detail: 'secret-store: gcloud not found' });
    expect(await missing.addVersion(DEST, new ProvisioningCode(CODE))).toEqual({ ok: false, outcome: 'not-attempted', detail: 'secret-store: gcloud not found' });
  });
});

describe('preflight', () => {
  it('checks the account is signed in, its token discarded, then that the secret exists', async () => {
    expect(await store().preflight(DEST)).toEqual({ ok: true, value: null });
    expect(await argv()).toEqual([
      `gcloud auth print-access-token --account ${DEST.account}`,
      `gcloud secrets describe ${DEST.secret} --project ${DEST.project} --account ${DEST.account}`,
    ]);
    expect(lines.join('\n')).not.toContain(ACCESS_TOKEN);
  });

  it('names an account not signed in, and stops there', async () => {
    await act('auth', 'fail:There was a problem refreshing your current auth tokens: Reauthentication failed.');
    const answer = await store().preflight(DEST);
    expect(answer).toEqual({ ok: false, outcome: 'failed', detail: `secret-store: gcloud is not signed in as ${DEST.account} (gcloud auth login ${DEST.account})` });
    expect(await argv()).toHaveLength(1);
  });

  it('names a secret that does not exist, and one the account may not read, each in one line', async () => {
    await act('describe', `fail:NOT_FOUND: Secret [projects/123456/secrets/${DEST.secret}] not found or has no versions.`);
    expect(await store().preflight(DEST)).toEqual({ ok: false, outcome: 'failed', detail: `secret-store: no secret ${DEST.secret} in project ${DEST.project}` });
    await act('describe', `fail:PERMISSION_DENIED: Permission 'secretmanager.secrets.get' denied for resource 'projects/${DEST.project}/secrets/${DEST.secret}' (or it may not exist).`);
    expect(await store().preflight(DEST)).toEqual({ ok: false, outcome: 'failed', detail: `secret-store: ${DEST.account} may not read secret ${DEST.secret} in project ${DEST.project}` });
    await act('describe', 'fail:something else\nand a second line');
    const other = await store().preflight(DEST);
    expect(other).toEqual({ ok: false, outcome: 'failed', detail: 'secret-store: gcloud secrets describe failed: ERROR: (gcloud.describe) something else' });
  });

  it('refuses a destination out of its grammar before anything runs', async () => {
    for (const dest of [{ ...DEST, secret: '--impersonate-service-account=x' }, { ...DEST, project: 'Not A Project' }, { ...DEST, account: '-x@example.com' }]) {
      expect(await store().preflight(dest)).toMatchObject({ ok: false, outcome: 'not-attempted' });
    }
    expect(await argv()).toEqual([]);
  });
});

describe('addVersion', () => {
  it('puts the code on stdin and nowhere else: not in argv, the environment or the log; the version read from stderr', async () => {
    const answer = await store().addVersion(DEST, new ProvisioningCode(CODE));
    expect(answer).toEqual({ ok: true, value: { version: '7' } });
    expect(await argv()).toEqual([`gcloud secrets versions add ${DEST.secret} --project ${DEST.project} --account ${DEST.account} --data-file=-`]);
    expect(await recorded('stdin.log')).toBe(CODE);
    const secretPart = CODE.slice(20, 60);
    expect(await recorded('argv.log')).not.toContain(secretPart);
    expect(await recorded('env.log')).not.toContain(secretPart);
    expect(await recorded('env.log')).toContain('CLOUDSDK_CORE_DISABLE_PROMPTS=1');
    expect(lines.join('\n')).not.toContain(secretPart);
    expect(JSON.stringify(answer)).not.toContain(secretPart);
  });

  it("reads gcloud's failure as failed, its one error line kept and the code withheld from it", async () => {
    await act('add', 'fail:PERMISSION_DENIED: Permission secretmanager.versions.add denied.');
    expect(await store().addVersion(DEST, new ProvisioningCode(CODE))).toEqual({
      ok: false,
      outcome: 'failed',
      detail: 'secret-store: gcloud secrets versions add failed: ERROR: (gcloud.add) PERMISSION_DENIED: Permission secretmanager.versions.add denied.',
    });
    await act('add', `fail:bad data ${CODE.trim()}`);
    const echoed = await store().addVersion(DEST, new ProvisioningCode(CODE));
    expect(echoed).toMatchObject({ ok: false, outcome: 'may-have-succeeded' });
    expect(JSON.stringify(echoed)).not.toContain(CODE.slice(20, 60));
    expect(lines.join('\n')).not.toContain(CODE.slice(20, 60));
    // a fragment of it, too: gcloud quoting part of what it read
    const fragment = CODE.slice(30, 70);
    await act('add', `fail:could not parse payload starting ${fragment}`);
    const quoted = await store().addVersion(DEST, new ProvisioningCode(CODE));
    expect(quoted).toMatchObject({ ok: false, outcome: 'may-have-succeeded' });
    expect(JSON.stringify(quoted)).not.toContain(fragment.slice(0, 24));
    expect(lines.join('\n')).not.toContain(fragment.slice(0, 24));
  });

  // I2 (the fix wave): a non-zero exit is no proof that nothing was stored. Only a refusal gcloud names before any
  // creation (or a stdin never written whole) is `failed`; any other ending may have stored it, with the version when
  // gcloud announced one.
  it('reads a refusal before any creation as failed, and any other non-zero exit as may have succeeded, with an announced version', async () => {
    await act('add', 'early:PERMISSION_DENIED: Permission secretmanager.versions.add denied.');
    expect(await store().addVersion(DEST, new ProvisioningCode(CODE))).toMatchObject({ ok: false, outcome: 'failed' });
    expect(await recorded('stdin.log')).toBe(''); // refused before it read a byte
    for (const code of ['NOT_FOUND', 'INVALID_ARGUMENT']) {
      await act('add', `fail:${code}: refused.`);
      expect(await store().addVersion(DEST, new ProvisioningCode(CODE)), code).toMatchObject({ ok: false, outcome: 'failed' });
    }
    await act('add', 'created-fail');
    const created = await store().addVersion(DEST, new ProvisioningCode(CODE));
    expect(created).toMatchObject({ ok: false, outcome: 'may-have-succeeded', version: '7' });
    await act('add', 'fail:There was a problem reading the response: connection reset by peer');
    const lost = await store().addVersion(DEST, new ProvisioningCode(CODE));
    expect(lost).toMatchObject({ ok: false, outcome: 'may-have-succeeded' });
    expect(lost).not.toHaveProperty('version');
  });

  it("answers once gcloud exits, its words read whole, though a helper it left behind still holds the pipes", async () => {
    await act('add', 'linger');
    const started = Date.now();
    expect(await store().addVersion(DEST, new ProvisioningCode(CODE))).toEqual({ ok: true, value: { version: '7' } });
    expect(Date.now() - started).toBeLessThan(4_000);
    // M1 (the fix wave): the helper doesn't outlive the call
    const pid = Number((await recorded('linger.pid')).trim());
    expect(pid).toBeGreaterThan(0);
    expect(await gone(pid)).toBe(true);
  });

  // I1 (the fix wave): gcloud's own logging could persist the request body, the code with it, so every child runs with
  // HTTP logging and file logging forced off, over whatever the machine's config or this process's environment says.
  it("runs every gcloud with HTTP and file logging off, overriding the environment's", async () => {
    const saved = { http: process.env.CLOUDSDK_CORE_LOG_HTTP, file: process.env.CLOUDSDK_CORE_DISABLE_FILE_LOGGING };
    process.env.CLOUDSDK_CORE_LOG_HTTP = 'true';
    process.env.CLOUDSDK_CORE_DISABLE_FILE_LOGGING = 'false';
    try {
      const s = store();
      await s.preflight(DEST);
      await s.addVersion(DEST, new ProvisioningCode(CODE));
      await s.describeVersion(DEST, '7');
    } finally {
      for (const [name, value] of [['CLOUDSDK_CORE_LOG_HTTP', saved.http], ['CLOUDSDK_CORE_DISABLE_FILE_LOGGING', saved.file]] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
    const env = (await recorded('env.log')).split('\n');
    expect(await argv()).toHaveLength(4);
    expect(env.filter((l) => l === 'CLOUDSDK_CORE_LOG_HTTP=false')).toHaveLength(4);
    expect(env.filter((l) => l === 'CLOUDSDK_CORE_DISABLE_FILE_LOGGING=true')).toHaveLength(4);
    expect(env.filter((l) => l.startsWith('CLOUDSDK_CORE_LOG_HTTP=') || l.startsWith('CLOUDSDK_CORE_DISABLE_FILE_LOGGING='))).toHaveLength(8);
  });

  it('reports a timeout, a death after stdin closed, and an exit naming no version as "may have succeeded"', async () => {
    await act('add', 'hang');
    const timedOut = await store(500).addVersion(DEST, new ProvisioningCode(CODE));
    expect(timedOut).toMatchObject({ ok: false, outcome: 'may-have-succeeded' });
    expect(await recorded('stdin.log')).toBe(CODE);
    await act('add', 'die');
    expect(await store().addVersion(DEST, new ProvisioningCode(CODE))).toMatchObject({ ok: false, outcome: 'may-have-succeeded' });
    await act('add', 'silent');
    expect(await store().addVersion(DEST, new ProvisioningCode(CODE))).toMatchObject({ ok: false, outcome: 'may-have-succeeded' });
  });

  it('reads a gcloud that could not start as not attempted', async () => {
    const gone = secretStore({ gcloud: async () => ({ ok: true, value: { path: join(scratch, 'no-such-gcloud'), PATH: '/usr/bin:/bin' } }), log: () => {} });
    expect(await gone.addVersion(DEST, new ProvisioningCode(CODE))).toMatchObject({ ok: false, outcome: 'not-attempted' });
  });
});

// The fix wave's I1: a run that ends takes its gcloud with it. The holder dropped while the resolver is out runs nothing;
// an aborted call kills its child, even one that has not read its stdin yet.
describe('an ended caller', () => {
  it('a holder dropped while the resolver is out runs nothing: not attempted', async () => {
    let resolveFound!: () => void;
    const found = new Promise<void>((resolve) => (resolveFound = resolve));
    const held = secretStore({ gcloud: async () => (await found, gcloud()), log: (line) => void lines.push(line), timeoutMs: 10_000 });
    const code = new ProvisioningCode(CODE);
    const adding = held.addVersion(DEST, code, new AbortController().signal);
    code.drop();
    resolveFound();
    expect(await adding).toMatchObject({ ok: false, outcome: 'not-attempted' });
    expect(await argv()).toEqual([]);
  });

  it('an abort while the child holds its stdin unread kills it, and answers at once', async () => {
    await act('add', 'hold');
    const ended = new AbortController();
    const adding = store().addVersion(DEST, new ProvisioningCode(CODE), ended.signal);
    let pid = 0;
    for (let i = 0; i < 100 && pid === 0; i++) {
      pid = Number((await recorded('hold.pid')).trim()) || 0;
      if (pid === 0) await new Promise((r) => setTimeout(r, 20));
    }
    expect(pid).toBeGreaterThan(0);
    const started = Date.now();
    ended.abort();
    expect(await adding).toMatchObject({ ok: false });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(await gone(pid)).toBe(true);
    expect(await recorded('stdin.log')).toBe('');
  });

  it('an abort before the call runs nothing, for every step', async () => {
    const ended = new AbortController();
    ended.abort();
    const s = store();
    expect(await s.preflight(DEST, ended.signal)).toMatchObject({ ok: false, outcome: 'not-attempted' });
    expect(await s.addVersion(DEST, new ProvisioningCode(CODE), ended.signal)).toMatchObject({ ok: false, outcome: 'not-attempted' });
    expect(await s.describeVersion(DEST, '7', ended.signal)).toMatchObject({ ok: false, outcome: 'not-attempted' });
    expect(await argv()).toEqual([]);
  });
});

describe('describeVersion', () => {
  it("reads the version's name, state and creation from its metadata, and never calls access", async () => {
    expect(await store().describeVersion(DEST, '7')).toEqual({
      ok: true,
      value: { name: `projects/123456/secrets/${DEST.secret}/versions/7`, state: 'ENABLED', createTime: '2026-11-08T12:00:00.123456Z' },
    });
    expect(await argv()).toEqual([`gcloud secrets versions describe 7 --secret ${DEST.secret} --project ${DEST.project} --account ${DEST.account} --format=json`]);
    expect((await argv()).some((call) => call.includes(' access'))).toBe(false);
  });

  it('refuses a version that is not ENABLED, and a version name out of grammar before anything runs', async () => {
    await writeFile(join(bin, 'state'), 'DISABLED');
    expect(await store().describeVersion(DEST, '7')).toEqual({ ok: false, outcome: 'failed', detail: `secret-store: version 7 of secret ${DEST.secret} is DISABLED, not ENABLED` });
    expect(await store().describeVersion(DEST, '7 --verbosity=debug')).toMatchObject({ ok: false, outcome: 'not-attempted' });
    expect(await argv()).toHaveLength(1);
  });

  it('reads a timeout or an answer that is not the metadata as failed: nothing it changes', async () => {
    await act('version', 'hang');
    expect(await store(500).describeVersion(DEST, '7')).toMatchObject({ ok: false, outcome: 'failed' });
    await act('version', 'silent');
    expect(await store().describeVersion(DEST, '7')).toMatchObject({ ok: false, outcome: 'failed' });
  });
});

describe('ProvisioningCode', () => {
  it('prints a placeholder through every stray path: String, a template, JSON and inspect', () => {
    const code = new ProvisioningCode(CODE);
    const secretPart = CODE.slice(20, 60);
    for (const shown of [String(code), `${code}`, JSON.stringify({ code }), inspect(code), inspect({ nested: [code] })]) expect(shown).not.toContain(secretPart);
    expect(code.reveal()).toBe(CODE);
  });

  it('once dropped, holds nothing: reveal throws (the fix wave, I1)', () => {
    const code = new ProvisioningCode(CODE);
    expect(code.dropped).toBe(false);
    code.drop();
    expect(code.dropped).toBe(true);
    expect(() => code.reveal()).toThrow(/dropped/);
    expect(String(code)).not.toContain(CODE.slice(20, 60));
  });
});
