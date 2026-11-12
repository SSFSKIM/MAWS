// `deployment hub-reads` (deploy/hub-reads.ts) against the local hub, set up as staging is (an org whose genesis the test
// device signed and the configuration pins): every claim passes on this build and the run leaves nothing; against a
// Registry of the build before projects records, and one before the key-bound removal (the suite's stubs), the claims
// that build lacks fail and the rest still pass, nothing left. Then what the command line refuses before it reads a
// credential, and `staging-run.sh hub-reads`'s hand-off: the token on the command's stdin alone, the log filtered.
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stateHash } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLAIMS, holdAnchorLock, main, runHubReads } from '../../deploy/hub-reads.ts';
import { deviceEntry, type AdminDevice } from '../../deploy/org-admin.ts';
import { Secrets } from '../../deploy/endpoint-verdicts.ts';
import { Cleanup, type InterruptOptions } from '../../deploy/proof.ts';
import { ADMIN, ORG, startLocalHub, type LocalHub } from '../support/local';
import { adminKeysFile, LocalPerson } from '../support/local-person';
import { genesis, signedBy } from '../support/org';

process.env.DESK_HUB_APP ??= join(import.meta.dirname, '../..');
const deploy = join(import.meta.dirname, '../../deploy');

let hub: LocalHub;
let device: AdminDevice;
let pinned: string;

beforeAll(async () => {
  hub = await startLocalHub();
  device = (await adminKeysFile()).device;
  const person = new LocalPerson(hub);
  const A = (await person.json<{ member: { id: string } }>('/api/me')).member.id;
  const root = { device: deviceEntry(device), channel: device.channel, stepUp: device.stepUp };
  const head = await signedBy(await genesis(ORG, A, ADMIN, root, device.recovery), root);
  await person.json('/api/org/state', { body: head }, 201);
  pinned = await stateHash(head.state);
});
afterAll(() => hub?.close());

/** One run on the local hub: its status, its lines, and the run's probes the head or the hub still names after it. */
async function run(
  o: { wrap?: (person: LocalPerson) => void; interrupt?: (lines: string[]) => InterruptOptions } = {},
): Promise<{ status: number; lines: string[]; verdicts: Record<string, string>; after: string[]; head: { state: { version: number } } }> {
  const lines: string[] = [];
  const cleanup = new Cleanup();
  const person = new LocalPerson(hub, ADMIN, () => cleanup.check());
  o.wrap?.(person);
  const status = await runHubReads({ person, scope: { org: ORG, pinnedGenesis: pinned }, device, cleanup, secrets: new Secrets(), print: (l) => lines.push(l), frameMs: 2_000 }, o.interrupt?.(lines));
  const verdicts = Object.fromEntries(lines.flatMap((l) => [/^(PASS|FAIL) ([a-z-]+): /.exec(l)].filter((m): m is RegExpExecArray => m !== null)).map((m) => [m[2], m[1]]));
  const tag = /tag ([0-9a-f]{6})/.exec(lines[0])![1];
  // Read back as the admin with no run's gate: the run's own refuses every request once it has ended.
  const reader = new LocalPerson(hub);
  const { head } = await reader.json<{ head: { state: { version: number; machines: Array<{ name: string }> } } }>('/api/org/state');
  const { machines } = await reader.json<{ machines: Array<{ name: string }> }>('/api/machines');
  const after = [...head.state.machines, ...machines].map((m) => m.name).filter((n) => n.endsWith(`-${tag}`));
  return { status, lines, verdicts, after, head };
}

/** `person`'s `n`th org-state POST answered with no answer: never sent (`lost`), or sent and its answer lost (`landed`). */
const dropStatePost = (n: number, how: 'lost' | 'landed') => (person: LocalPerson) => {
  const fetch = person.fetch.bind(person);
  let posts = 0;
  person.fetch = async (path, init = {}) => {
    if (path !== '/api/org/state' || init.body === undefined || ++posts !== n) return fetch(path, init);
    if (how === 'landed') await (await fetch(path, init)).text();
    throw new Error('POST /api/org/state: no answer within 30 s');
  };
};

describe('hub-reads on the local hub', () => {
  it('passes every claim on this build, a line each, and leaves neither probe', async () => {
    const r = await run();
    expect(r.verdicts, r.lines.join('\n')).toEqual(Object.fromEntries(CLAIMS.map((c) => [c, 'PASS'])));
    expect(r.lines.filter((l) => /^(PASS|FAIL) /.test(l))).toHaveLength(CLAIMS.length);
    expect(r.lines.join('\n')).toMatch(/PASS keyed-wrong-refused: DELETE hr-p-\w+ bound to its ref and another key answered 200 .*still holds/);
    expect(r.lines.filter((l) => l.startsWith('LEFT'))).toEqual([]);
    expect(r.lines.at(-1)).toBe('hub-reads: PASS');
    expect(r.status).toBe(0);
    expect(r.after).toEqual([]);
  }, 60_000);

  it('fails the registry’s three claims against a Registry before projects records; the removals still pass, nothing left', async () => {
    await hub.registryLacks('projects');
    try {
      const r = await run();
      expect(r.verdicts, r.lines.join('\n')).toEqual({ 'welcome-projects': 'FAIL', 'snapshot-last': 'FAIL', 'record-live': 'FAIL', 'keyed-wrong-refused': 'PASS', 'keyed-removed': 'PASS', 'plain-removed': 'PASS' });
      expect(r.lines.join('\n')).toMatch(/FAIL record-live: hr-p-\w+'s record was refused 503 hub-updating/);
      expect(r.lines.filter((l) => l.startsWith('LEFT'))).toEqual([]);
      expect([r.status, r.after]).toEqual([1, []]);
    } finally {
      await hub.registryLacks(null);
    }
  }, 60_000);

  it('fails both keyed claims against a Registry before the keyed removal, the code reported; the cleanup removes P', async () => {
    await hub.registryLacks('revokeKeyed');
    try {
      const r = await run();
      expect(r.verdicts, r.lines.join('\n')).toEqual({ 'welcome-projects': 'PASS', 'snapshot-last': 'PASS', 'record-live': 'PASS', 'keyed-wrong-refused': 'FAIL', 'keyed-removed': 'FAIL', 'plain-removed': 'PASS' });
      expect(r.lines.join('\n')).toMatch(/FAIL keyed-wrong-refused: .* answered 503 .*hub-updating/);
      expect(r.lines.filter((l) => l.startsWith('LEFT'))).toEqual([]);
      expect([r.status, r.after]).toEqual([1, []]);
    } finally {
      await hub.registryLacks(null);
    }
  }, 60_000);
});

describe('hub-reads when the hub leaves a question open', () => {
  it('runs its cleanup on SIGHUP as on SIGINT, with nothing left', async () => {
    const signals = new EventEmitter();
    const r = await run({
      interrupt: (lines) => {
        const push = lines.push.bind(lines);
        lines.push = (...l: string[]) => {
          const n = push(...l);
          if (l.some((x) => x.startsWith('PASS welcome-projects'))) setImmediate(() => signals.emit('SIGHUP'));
          return n;
        };
        return { signals, hangup: true, settleMs: 200, exit: () => {} };
      },
    });
    expect(r.status, r.lines.join('\n')).toBe(129);
    expect(r.lines.join('\n')).toMatch(/FAIL [a-z-]+: not reached: the run was interrupted \(129\)/);
    expect(r.lines.filter((l) => l.startsWith('LEFT'))).toEqual([]);
    expect(r.after).toEqual([]);
  }, 60_000);

  it('signs nothing after a listing POST with no answer, and says the listing is LEFT', async () => {
    const before = (await new LocalPerson(hub).json<{ head: { state: { version: number } } }>('/api/org/state')).head.state.version;
    // The 1st POST lists P; the 2nd, Q's listing, is never sent.
    const r = await run({ wrap: dropStatePost(2, 'lost') });
    const tag = /tag ([0-9a-f]{6})/.exec(r.lines[0])![1];
    expect(r.status).toBe(1);
    expect(r.lines, r.lines.join('\n')).toContain(`LEFT hr-q-${tag}: its listing POST had no answer; it may still land — run sweep-leftovers hr-q-${tag} once it has, or check the head`);
    // P's listing stands, unsigned out (that would sit beside Q's, which may land), its hub credential revoked all the same.
    expect(r.head.state.version).toBe(before + 1);
    expect(r.lines).toContain(`LEFT the state still lists hr-p-${tag}`);
    expect(r.after).toEqual([`hr-p-${tag}`]);
    expect(r.lines.at(-1)).toBe('hub-reads: FAIL');
  }, 60_000);

  it('settles a listing POST whose answer was lost once the head holds it, and cleans up as usual', async () => {
    const r = await run({ wrap: dropStatePost(2, 'landed') });
    const tag = /tag ([0-9a-f]{6})/.exec(r.lines[0])![1];
    expect(r.lines.join('\n')).toMatch(new RegExp(`settled: the successor version \\d+ listing hr-q-${tag}, whose POST had no answer, is the hub's`));
    expect(r.lines.filter((l) => l.startsWith('LEFT')), r.lines.join('\n')).toEqual([]);
    expect([r.status, r.after]).toEqual([1, []]);
  }, 60_000);
});

describe('the command line', () => {
  it('refuses production and a run without the device’s keys, before a credential is read', async () => {
    expect(await main(['--config', join(deploy, 'config.json'), '--device-keys', '/k.json'])).toBe(2);
    expect(await main(['--config', join(deploy, 'staging.json')])).toBe(2);
  });

  it('takes the anchor lock, refused while another run holds it or the anchor holds a pending successor', () => {
    const keys = join(mkdtempSync(join(tmpdir(), 'hub-reads-lock-')), 'keys.json');
    const lock = `${keys}.org.json.lock`;
    const taken = holdAnchorLock(keys);
    expect(existsSync(lock)).toBe(true);
    expect(holdAnchorLock(keys)).toEqual({ refused: expect.stringMatching(/^another run holds /) });
    if ('release' in taken) taken.release();
    expect(existsSync(lock)).toBe(false);
    // An admin verb's successor not yet seen at the hub: refused, and the lock let go.
    writeFileSync(`${keys}.org.json`, JSON.stringify({ hub: 'h', org: 'o', version: 3, pending: { state: {}, sigs: [] } }));
    expect(holdAnchorLock(keys)).toEqual({ refused: expect.stringMatching(/holds a pending successor/) });
    expect(existsSync(lock)).toBe(false);
    writeFileSync(`${keys}.org.json`, JSON.stringify({ hub: 'h', org: 'o', version: 3 }));
    const settled = holdAnchorLock(keys);
    expect('release' in settled).toBe(true);
    if ('release' in settled) settled.release();
  });
});

const zsh = spawnSync('zsh', ['-c', 'true']).status === 0;
describe('staging-run.sh hub-reads', () => {
  const token = `eyJ${'s'.repeat(20)}.synthetic`;
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), 'staging-hub-reads-'));
    const device = join(dir, 'device');
    mkdirSync(device);
    writeFileSync(join(device, 'keys.json'), '{}', { mode: 0o600 });
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'cloudflared'), `#!/bin/sh\nprintf '%s' '${token}'\n`, { mode: 0o755 });
    writeFileSync(join(bin, 'pnpm'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${dir}/args'\ncat > '${dir}/stdin'\necho 'PASS welcome-projects: listed'\necho 'a line naming a secret'\necho 'hub-reads: PASS'\nexit 0\n`, { mode: 0o755 });
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DESK_STAGING_DIR: join(dir, 'state'), DESK_STAGING_DEVICE: device, DESK_STAGING_SECRETS: join(dir, 'secrets') };
    return { dir, device, env };
  };

  it.skipIf(!zsh)('runs the command on staging with the device’s keys and its scan list, the token on its stdin alone, the log filtered', () => {
    const { dir, device, env } = setup();
    const r = spawnSync('zsh', [join(deploy, 'staging-run.sh'), 'hub-reads'], { encoding: 'utf8', env });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const args = readFileSync(join(dir, 'args'), 'utf8').trim().split('\n');
    const given = args.slice(args.indexOf('deployment'));
    expect(given.slice(0, -1)).toEqual(['deployment', 'hub-reads', '--config', 'deploy/staging.json', '--device-keys', `${device}/keys.json`, '--scan']);
    expect(given.at(-1)).toMatch(new RegExp(`^${join(dir, 'state', 'hub-reads.scan.')}\\w{6}$`));
    expect(readFileSync(join(dir, 'stdin'), 'utf8')).toBe(`DESK_ACCESS_TOKEN=${token}\n`);
    const logs = readdirSync(join(dir, 'state')).filter((n) => n.startsWith('hub-reads-'));
    expect(logs).toHaveLength(1);
    const log = readFileSync(join(dir, 'state', logs[0]), 'utf8');
    expect(log).toMatch(/^PASS welcome-projects: listed\nhub-reads: PASS\nhub-reads exit 0\nfiles holding the Access token or a secret the run handled: 0; /);
    expect(r.stdout + r.stderr + log).not.toContain(token);
    // The scan list is gone once the step ends.
    expect(readdirSync(join(dir, 'state')).filter((n) => n.startsWith('hub-reads.scan'))).toEqual([]);
  });

  it.skipIf(!zsh)('fails the audit when the scan list cannot be read, never counting it as no finding', () => {
    const { dir, env } = setup();
    // The command's stand-in makes its scan list unreadable (the last argument) and passes.
    writeFileSync(join(dir, 'bin', 'pnpm'), `#!/bin/sh\nfor a; do last=$a; done\ncat > /dev/null\nchmod 000 "$last"\necho 'hub-reads: PASS'\nexit 0\n`, { mode: 0o755 });
    const r = spawnSync('zsh', [join(deploy, 'staging-run.sh'), 'hub-reads'], { encoding: 'utf8', env });
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toMatch(/files holding the Access token or a secret the run handled: unknown \(the scan list .* could not be read\)/);
    expect(readdirSync(join(dir, 'state')).filter((n) => n.startsWith('hub-reads.scan'))).toEqual([]);
  });

  it.skipIf(!zsh)('takes no arguments, and stops with nothing run', () => {
    const { dir, env } = setup();
    const r = spawnSync('zsh', [join(deploy, 'staging-run.sh'), 'hub-reads', '--config', 'deploy/config.json'], { encoding: 'utf8', env });
    expect([r.status, r.stdout]).toEqual([2, expect.stringMatching(/hub-reads takes no arguments .*Nothing was changed/)]);
    expect(readdirSync(dir)).not.toContain('args');
  });
});
