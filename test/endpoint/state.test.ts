// The endpoint's state directory (O10 M2, Interfaces §E; acceptance 6's machine half): private modes checked at start
// and a widened one refused, atomic writes, and the machine key and the grant ledger present together or not at all.
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSigningKey, keyId } from 'org-protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EndpointState, type MachineKeyFile } from '../../src/endpoint/state/store';

// A crash between the temporary write and the rename: the hook throws where the rename would run.
const beforeRename = vi.hoisted(() => ({ hook: null as null | ((to: string) => void) }));
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  const renameSync: typeof real.renameSync = (from, to) => {
    const hook = beforeRename.hook;
    beforeRename.hook = null;
    hook?.(String(to));
    real.renameSync(from, to);
  };
  return { ...real, default: { ...real, renameSync }, renameSync };
});

let root: string;
let dir: string;
const lines: string[] = [];
const open = () => EndpointState.open(dir, { log: (line) => lines.push(line) });
const mode = (path: string) => fs.statSync(path).mode & 0o777;

async function machineKey(): Promise<MachineKeyFile> {
  const key = await generateSigningKey(true);
  return { version: 1, keyId: await keyId(key.pub), jwk: (await crypto.subtle.exportKey('jwk', key.privateKey)) as JsonWebKey, created: new Date().toISOString() };
}

beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'endpoint-state-'));
  dir = join(root, 'endpoint');
  lines.length = 0;
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('the state directory', () => {
  it('is made 0700 when absent and starts unenrolled', () => {
    const state = open();
    expect(mode(dir)).toBe(0o700);
    expect(state.refusing).toBeNull();
    expect(state.enrolled).toBe(false);
    expect(state.machineKey).toBeNull();
  });

  it('writes every file 0600 and reads back what it wrote', async () => {
    const state = open();
    const key = await machineKey();
    state.setMachineKey(key);
    state.setLedger({ version: 1, heldKeys: [key.keyId], grants: {}, highWater: {} });
    state.setPolicy({ read_only: true, ceiling: 'plan' });
    for (const name of ['machine-key.json', 'grants.json', 'policy.json']) expect(mode(join(dir, name))).toBe(0o600);
    const again = open();
    expect(again.machineKey).toEqual(key);
    expect(again.ledger).toEqual({ version: 1, heldKeys: [key.keyId], grants: {}, highWater: {} });
    expect(again.policy).toEqual({ read_only: true, ceiling: 'plan' });
  });

  it('keeps the old file when a write fails between the temporary file and the rename, and sweeps what a crash left', async () => {
    const state = open();
    state.setPolicy({ read_only: false, ceiling: 'settings' });
    beforeRename.hook = () => {
      throw new Error('crash');
    };
    expect(() => state.setPolicy({ read_only: true, ceiling: 'plan' })).toThrow('crash');
    expect(JSON.parse(fs.readFileSync(join(dir, 'policy.json'), 'utf8'))).toEqual({ read_only: false, ceiling: 'settings' });
    expect(fs.readdirSync(dir)).toEqual(['policy.json']);
    // A real crash leaves its temporary file behind; the next start sweeps it and reads the old file.
    fs.writeFileSync(join(dir, 'policy.json.123.abcdef.tmp'), '{"read_only": true', { mode: 0o600 });
    expect(open().policy).toEqual({ read_only: false, ceiling: 'settings' });
    expect(fs.readdirSync(dir)).toEqual(['policy.json']);
  });
});

describe('the machine key and the grant ledger', () => {
  for (const [alone, other] of [
    ['machine-key.json', 'grants.json'],
    ['grants.json', 'machine-key.json'],
  ] as const) {
    it(`moves ${alone} without ${other} aside and starts unenrolled`, async () => {
      const state = open();
      const key = await machineKey();
      state.setMachineKey(key);
      state.setLedger({ version: 1, heldKeys: [key.keyId], grants: {}, highWater: {} });
      state.setEnrollment({
        version: 1,
        state: 'org-listed',
        name: 'mini',
        ref: 'AAAAAAAAAAAAAAAAAAAAAA',
        org: 'org-local',
        hub: 'http://127.0.0.1:1',
        enrollment: 'e'.repeat(32),
        credentials: { clientId: 'id', clientSecret: 'secret' },
        at: new Date().toISOString(),
      });
      fs.rmSync(join(dir, other));
      const again = open();
      expect(again.enrolled).toBe(false);
      expect(again.machineKey).toBeNull();
      expect(again.ledger).toBeNull();
      expect(again.stale).toBe(true);
      const [stale] = fs.readdirSync(dir).filter((name) => name.startsWith('stale-'));
      expect(fs.readdirSync(join(dir, stale)).sort()).toEqual(['enrollment.json', alone].sort());
      expect(mode(join(dir, stale))).toBe(0o700);
      // A start after that finds neither and is simply unenrolled.
      expect(open().stale).toBe(false);
    });
  }
});

describe('refusing a state that is not private', () => {
  it('refuses a symlinked directory and a widened one', () => {
    const real = join(root, 'real');
    fs.mkdirSync(real, { mode: 0o700 });
    fs.symlinkSync(real, dir);
    expect(open().refusing).toBe('state-symlink');
    fs.rmSync(dir);
    fs.mkdirSync(dir, { mode: 0o700 });
    fs.chmodSync(dir, 0o755);
    expect(open().refusing).toBe('state-mode');
    expect(lines.at(-1)).toContain(dir);
  });

  it('refuses a widened key file, a symlinked file and a foreign owner, logging the path but not saying it', async () => {
    const state = open();
    const key = await machineKey();
    state.setMachineKey(key);
    state.setLedger({ version: 1, heldKeys: [key.keyId], grants: {}, highWater: {} });
    fs.chmodSync(join(dir, 'machine-key.json'), 0o644);
    const widened = open();
    expect(widened.refusing).toBe('state-mode');
    expect(widened.machineKey).toBeNull();
    expect(lines.at(-1)).toContain(join(dir, 'machine-key.json'));
    fs.chmodSync(join(dir, 'machine-key.json'), 0o600);
    fs.renameSync(join(dir, 'grants.json'), join(root, 'grants.json'));
    fs.symlinkSync(join(root, 'grants.json'), join(dir, 'grants.json'));
    expect(open().refusing).toBe('state-symlink');
    fs.rmSync(join(dir, 'grants.json'));
    fs.renameSync(join(root, 'grants.json'), join(dir, 'grants.json'));
    expect(EndpointState.open(dir, { uid: 4242 }).refusing).toBe('state-owner');
    expect(open().refusing).toBeNull();
  });

  it('refuses a file that does not hold its shape', () => {
    open();
    fs.writeFileSync(join(dir, 'policy.json'), '{"read_only": "yes"}', { mode: 0o600 });
    expect(open().refusing).toBe('state-malformed');
  });
});
