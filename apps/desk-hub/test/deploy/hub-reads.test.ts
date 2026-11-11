// `deployment hub-reads` (deploy/hub-reads.ts) against the local hub, set up as staging is (an org whose genesis the test
// device signed and the configuration pins): every claim passes on this build and the run leaves nothing; against a
// Registry of the build before projects records, and one before the key-bound removal (the suite's stubs), the claims
// that build lacks fail and the rest still pass, nothing left. Then what the command line refuses before it reads a
// credential, and `staging-run.sh hub-reads`'s hand-off: the token on the command's stdin alone, the log filtered.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stateHash } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLAIMS, main, runHubReads } from '../../deploy/hub-reads.ts';
import { deviceEntry, type AdminDevice } from '../../deploy/org-admin.ts';
import { Secrets } from '../../deploy/endpoint-verdicts.ts';
import { Cleanup } from '../../deploy/proof.ts';
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
async function run(): Promise<{ status: number; lines: string[]; verdicts: Record<string, string>; after: string[] }> {
  const lines: string[] = [];
  const cleanup = new Cleanup();
  const person = new LocalPerson(hub, ADMIN, () => cleanup.check());
  const status = await runHubReads({ person, scope: { org: ORG, pinnedGenesis: pinned }, device, cleanup, secrets: new Secrets(), print: (l) => lines.push(l), frameMs: 2_000 });
  const verdicts = Object.fromEntries(lines.flatMap((l) => [/^(PASS|FAIL) ([a-z-]+): /.exec(l)].filter((m): m is RegExpExecArray => m !== null)).map((m) => [m[2], m[1]]));
  const tag = /tag ([0-9a-f]{6})/.exec(lines[0])![1];
  // Read back as the admin with no run's gate: the run's own refuses every request once it has ended.
  const reader = new LocalPerson(hub);
  const { head } = await reader.json<{ head: { state: { machines: Array<{ name: string }> } } }>('/api/org/state');
  const { machines } = await reader.json<{ machines: Array<{ name: string }> }>('/api/machines');
  const after = [...head.state.machines, ...machines].map((m) => m.name).filter((n) => n.endsWith(`-${tag}`));
  return { status, lines, verdicts, after };
}

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

describe('the command line', () => {
  it('refuses production, a run without the device’s keys, and a held anchor lock, before a credential is read', async () => {
    expect(await main(['--config', join(deploy, 'config.json'), '--device-keys', '/k.json'])).toBe(2);
    expect(await main(['--config', join(deploy, 'staging.json')])).toBe(2);
    const keys = join(mkdtempSync(join(tmpdir(), 'hub-reads-lock-')), 'keys.json');
    writeFileSync(`${keys}.org.json.lock`, JSON.stringify({ pid: 1, host: 'elsewhere', at: 'then', token: 't' }));
    expect(await main(['--config', join(deploy, 'staging.json'), '--device-keys', keys])).toBe(2);
    // The lock refused the run; it is left as it was, the other run's.
    expect(readFileSync(`${keys}.org.json.lock`, 'utf8')).toContain('"token":"t"');
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
    expect(args.slice(args.indexOf('deployment'))).toEqual(['deployment', 'hub-reads', '--config', 'deploy/staging.json', '--device-keys', `${device}/keys.json`, '--scan', join(dir, 'state', 'hub-reads.scan')]);
    expect(readFileSync(join(dir, 'stdin'), 'utf8')).toBe(`DESK_ACCESS_TOKEN=${token}\n`);
    const logs = readdirSync(join(dir, 'state')).filter((n) => n.startsWith('hub-reads-'));
    expect(logs).toHaveLength(1);
    const log = readFileSync(join(dir, 'state', logs[0]), 'utf8');
    expect(log).toMatch(/^PASS welcome-projects: listed\nhub-reads: PASS\nhub-reads exit 0\nfiles holding the Access token or a secret the run handled: 0; /);
    expect(r.stdout + r.stderr + log).not.toContain(token);
    // The scan list is gone once the step ends.
    expect(readdirSync(join(dir, 'state'))).not.toContain('hub-reads.scan');
  });

  it.skipIf(!zsh)('takes no arguments, and stops with nothing run', () => {
    const { dir, env } = setup();
    const r = spawnSync('zsh', [join(deploy, 'staging-run.sh'), 'hub-reads', '--config', 'deploy/config.json'], { encoding: 'utf8', env });
    expect([r.status, r.stdout]).toEqual([2, expect.stringMatching(/hub-reads takes no arguments .*Nothing was changed/)]);
    expect(readdirSync(dir)).not.toContain('args');
  });
});
