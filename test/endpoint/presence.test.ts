// The endpoint's presence entry (P5 O10 M10): what mawsd knows of the module without loading it, and what it answers
// for it, unenrolled, to a read-only command.
import * as fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createEndpoint } from '../../src/endpoint';
import { enrollmentOnDisk, ENROLLMENT_FILES, unloadedAnswer, UNENROLLED_STATUS } from '../../src/endpoint/presence';
import { FILES } from '../../src/endpoint/state/store';
import { fakeServices, type FakeServices } from './fake-services';

let dir: string | null = null;
let services: FakeServices | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
  services?.cleanup();
  services = null;
});

describe('the endpoint’s presence', () => {
  it('names state files the store has, and every one that holds or begins an enrollment', () => {
    const stored = new Set<string>(Object.values(FILES));
    for (const name of ENROLLMENT_FILES) expect(stored.has(name), name).toBe(true);
    expect([...ENROLLMENT_FILES].sort()).toEqual([FILES.machineKey, FILES.ledger, FILES.enrollment, FILES.org, FILES.delegation, FILES.provisioning, FILES.retirement].sort());
  });

  it('finds an enrollment by any of its files, a symlink included, and none in what an unenrolled endpoint keeps', () => {
    dir = mkdtempSync(join(tmpdir(), 'endpoint-presence-'));
    expect(enrollmentOnDisk(join(dir, 'absent'))).toBe(false);
    for (const name of ['policy.json', 'ops.jsonl', 'webauthn.json']) fs.writeFileSync(join(dir, name), '{}');
    fs.mkdirSync(join(dir, 'stale-2026-10-28T00-00-00.000Z'));
    expect(enrollmentOnDisk(dir)).toBe(false);
    for (const name of ENROLLMENT_FILES) {
      const path = join(dir, name);
      fs.writeFileSync(path, '{}');
      expect(enrollmentOnDisk(dir), name).toBe(true);
      fs.rmSync(path);
    }
    fs.symlinkSync('/nowhere', join(dir, 'machine-key.json'));
    expect(enrollmentOnDisk(dir)).toBe(true);
  });

  it('reports an unenrolled endpoint as the module itself does', () => {
    expect(UNENROLLED_STATUS).toEqual(createEndpoint().status());
  });
});

// The read-only commands and the arguments `mawsd` answers them with before it loads the module: everything else is the
// module's to answer, its refusals included.
const READ_ONLY: Array<[string, string[]]> = [
  ['status', []],
  ['status', ['--json']],
  ['keys', []],
  ['keys', ['--json']],
  ['policy', []],
  ['policy', ['--json']],
];

describe('the read-only commands, answered before the module is loaded', () => {
  it('answer over a state directory that holds nothing byte for byte as the module started on it does, writing nothing', async () => {
    services = fakeServices();
    const { stateDir } = services.machine;
    const unloaded = READ_ONLY.map(([command, args]) => unloadedAnswer(services!.machine, command, args));
    expect(fs.readdirSync(stateDir)).toEqual([]);
    const endpoint = createEndpoint();
    await endpoint.start(services);
    try {
      for (const [i, [command, args]] of READ_ONLY.entries()) expect(unloaded[i], `${command} ${args.join(' ')}`).toEqual(await endpoint.cli(command, args));
    } finally {
      await endpoint.stop();
    }
  });

  it('leave every other command and argument to the module, and every state directory that holds anything or is not private', async () => {
    services = fakeServices();
    const { machine } = services;
    const { stateDir } = machine;
    for (const command of ['enroll', 'provision', 'retire', 'unenroll', 'revoke', 'grant', 'legacy', 'attest-history', 'help']) {
      expect(unloadedAnswer(machine, command, []), command).toBeNull();
    }
    expect(unloadedAnswer(machine, 'legacy', ['status'])).toBeNull();
    for (const args of [['--bogus'], ['--json', '--json'], ['--json=true'], ['json']]) expect(unloadedAnswer(machine, 'status', args), args.join(' ')).toBeNull();
    expect(unloadedAnswer(machine, 'policy', ['--read-only', 'on'])).toBeNull();
    expect(unloadedAnswer(machine, 'policy', ['--ceiling', 'plan', '--json'])).toBeNull();
    expect(unloadedAnswer(machine, 'constructor', [])).toBeNull();
    expect(unloadedAnswer(machine, 'status', [])).not.toBeNull();

    // Anything at its top: a file the module would judge (its shape, its mode), a directory, a symlink.
    for (const make of [
      () => fs.writeFileSync(join(stateDir, 'policy.json'), '{}', { mode: 0o600 }),
      () => fs.writeFileSync(join(stateDir, 'notes.txt'), ''),
      () => fs.mkdirSync(join(stateDir, 'stale-2026-10-28T00-00-00.000Z')),
      () => fs.symlinkSync('/nowhere', join(stateDir, 'legacy.json')),
    ]) {
      make();
      expect(unloadedAnswer(machine, 'status', []), fs.readdirSync(stateDir).join(', ')).toBeNull();
      for (const name of fs.readdirSync(stateDir)) fs.rmSync(join(stateDir, name), { recursive: true, force: true });
    }
    expect(unloadedAnswer(machine, 'keys', [])).not.toBeNull();

    // A directory the store refuses (state-mode), or none at all.
    fs.chmodSync(stateDir, 0o750);
    expect(unloadedAnswer(machine, 'keys', [])).toBeNull();
    fs.chmodSync(stateDir, 0o700);

    // One the owner can read but not search passes the private check and lists as empty, yet the store cannot lstat
    // a file inside it: the module's start fails there, so its refusal is the answer. Mode bits alone don't decide
    // search permission (root searches any directory, and a macOS ACL inherited from the temporary directory can grant
    // it), so the assertions run only where the process is actually denied.
    fs.chmodSync(stateDir, 0o600);
    try {
      let denied = false;
      try {
        fs.accessSync(stateDir, fs.constants.X_OK);
      } catch {
        denied = true;
      }
      if (denied) {
        expect(unloadedAnswer(machine, 'keys', [])).toBeNull();
        const endpoint = createEndpoint();
        await endpoint.start(services).catch(() => undefined);
        try {
          expect((await endpoint.cli('keys', [])).code).not.toBe(0);
        } finally {
          await endpoint.stop();
        }
      }
    } finally {
      fs.chmodSync(stateDir, 0o700);
    }
    expect(unloadedAnswer({ ...machine, stateDir: join(stateDir, 'absent') }, 'keys', [])).toBeNull();
  });
});
