// P5 O4 M1: the machine's custody of route D's grants (./custody.ts; docs/doperpowers/plans/2026-10-31-p5-o4-services.md,
// Interfaces §A, D4 to D6, D34). Scratch directories stand in for the profile; the backup exclusion is a fake, or the
// real helper with child_process doubled and the platform not darwin, so nothing here runs osascript, and no keychain
// is touched. Each fresh custody over a directory is a fresh spine load.
// The store over this custody is pinned beside the store's own suite (./oauth-store.test.ts).
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEALED_FORMAT_V2 } from '@shared/connectors/sealer';

// The real exclusion helper's one effect, doubled: off darwin it must never be reached.
const spawned = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async (actual) => ({ ...(await actual<typeof import('node:child_process')>()), execFile: spawned }));
import { CUSTODY_EXCLUDED_MARKER, CUSTODY_KEY_FILE, fileKeyCustody, type CustodyFs } from './custody';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const RECORD = JSON.stringify({ version: 1, connectionId: A, tokens: { accessToken: 'at-secret-5a1e' } });

let root: string;
let dir: string;
let excluded: string[];
const exclude = async (path: string) => {
  excluded.push(path);
  return true;
};
const custody = (options: Parameters<typeof fileKeyCustody>[1] = {}) => fileKeyCustody(dir, { excludeFromBackup: exclude, ...options });
const keyPath = () => join(dir, CUSTODY_KEY_FILE);
const mode = (path: string) => statSync(path).mode & 0o777;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-oauth-custody-'));
  dir = join(root, 'connectors', 'oauth');
  excluded = [];
});
afterEach(() => {
  vi.restoreAllMocks();
  chmodSync(root, 0o700);
  rmSync(root, { recursive: true, force: true });
});

describe('fileKeyCustody: the key', () => {
  it('names format 2', () => {
    expect(custody().format).toBe(SEALED_FORMAT_V2);
    expect(SEALED_FORMAT_V2).toBe('maws-connector-oauth/2');
  });

  it('creates a 32-byte key exclusively on first use, 0600 in a 0700 directory excluded from backups first', async () => {
    const first = custody();
    expect(existsSync(dir)).toBe(false); // nothing is made until a use
    expect(await first.available()).toBe(true);
    expect(statSync(keyPath()).size).toBe(32);
    expect(mode(keyPath())).toBe(0o600);
    expect(mode(dir)).toBe(0o700);
    expect(excluded).toEqual([dir]);
    expect(existsSync(join(dir, CUSTODY_EXCLUDED_MARKER))).toBe(true);
    expect(readdirSync(dir).sort()).toEqual([CUSTODY_KEY_FILE, CUSTODY_EXCLUDED_MARKER].sort()); // no temporary left

    const key = readFileSync(keyPath());
    const later = custody(); // a later load reads the same key and never excludes again
    expect(await later.available()).toBe(true);
    expect(readFileSync(keyPath())).toEqual(key);
    expect(excluded).toEqual([dir]);
  });

  it('tightens a wider existing directory', async () => {
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o755);
    expect(await custody().available()).toBe(true);
    expect(mode(dir)).toBe(0o700);
  });

  it('one first use at a time in a load; two loads racing keep one key', async () => {
    const one = custody();
    await Promise.all([one.available(), one.seal('x', A), one.available()]);
    expect(excluded).toEqual([dir]);

    rmSync(dir, { recursive: true });
    const [left, right] = [custody(), custody()];
    await Promise.all([left.available(), right.available()]);
    expect((await right.open(await left.seal(RECORD, A), A)).text).toBe(RECORD);
    expect(readdirSync(dir).filter((name) => name.startsWith('.'))).toEqual([]);
  });

  it('records no exclusion where none was set, and still makes the key when setting it failed', async () => {
    expect(await custody({ excludeFromBackup: async () => false }).available()).toBe(true);
    expect(existsSync(join(dir, CUSTODY_EXCLUDED_MARKER))).toBe(false);

    rmSync(dir, { recursive: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await custody({ excludeFromBackup: async () => Promise.reject(new Error('osascript failed')) }).available()).toBe(true);
    expect(existsSync(keyPath())).toBe(true);
    expect(existsSync(join(dir, CUSTODY_EXCLUDED_MARKER))).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });

  // D34: a directory one failed attempt left in Time Machine is excluded at a later load.
  it('retries the exclusion once per load while unmarked, an existing key included, and marks it on success', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await custody({ excludeFromBackup: async () => Promise.reject(new Error('osascript failed')) }).available()).toBe(true);
    const key = readFileSync(keyPath());
    expect(existsSync(join(dir, CUSTODY_EXCLUDED_MARKER))).toBe(false);

    const retried = custody(); // a later load: the key exists, the marker does not
    await Promise.all([retried.available(), retried.seal(RECORD, A), retried.available()]);
    expect(await retried.available()).toBe(true);
    expect(excluded).toEqual([dir]);
    expect(existsSync(join(dir, CUSTODY_EXCLUDED_MARKER))).toBe(true);
    expect(readFileSync(keyPath())).toEqual(key);

    expect(await custody().available()).toBe(true); // marked: never asked again
    expect(excluded).toEqual([dir]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('off darwin the default exclusion is a no-op: nothing spawned, the key made, no marker', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    try {
      const sealer = fileKeyCustody(dir); // the real helper
      expect(await sealer.available()).toBe(true);
      expect((await sealer.open(await sealer.seal(RECORD, A), A)).text).toBe(RECORD);
      expect(await fileKeyCustody(dir).available()).toBe(true); // a later load asks again, still a no-op
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }
    expect(spawned).not.toHaveBeenCalled();
    expect(existsSync(keyPath())).toBe(true);
    expect(existsSync(join(dir, CUSTODY_EXCLUDED_MARKER))).toBe(false);
  });

  it('an exclusion that throws, even synchronously, never fails the key: logged, and the key made and used', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const throwing = () => fileKeyCustody(dir, { excludeFromBackup: () => { throw new Error('no osascript'); } });
    const first = throwing();
    expect(await first.available()).toBe(true);
    const sealed = await first.seal(RECORD, A);
    expect((await throwing().open(sealed, A)).text).toBe(RECORD);
    expect(existsSync(join(dir, CUSTODY_EXCLUDED_MARKER))).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2); // once per load
  });

  it('a load whose retry answers false or fails still uses the existing key, unmarked', async () => {
    expect(await custody({ excludeFromBackup: async () => false }).available()).toBe(true);
    const sealed = await custody({ excludeFromBackup: async () => false }).seal(RECORD, A);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = custody({ excludeFromBackup: async () => Promise.reject(new Error('osascript failed')) });
    expect((await failing.open(sealed, A)).text).toBe(RECORD);
    expect(existsSync(join(dir, CUSTODY_EXCLUDED_MARKER))).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });

  it.each([
    ['another mode', () => chmodSync(keyPath(), 0o644)],
    ['a narrower mode', () => chmodSync(keyPath(), 0o400)],
    ['a short key', () => writeFileSync(keyPath(), Buffer.alloc(31))],
    ['a long key', () => writeFileSync(keyPath(), Buffer.alloc(33))],
    ['an empty key', () => writeFileSync(keyPath(), '')],
  ])('fails closed on %s and never replaces the key file', async (_why, spoil) => {
    expect(await custody().available()).toBe(true);
    spoil();
    const before = readFileSync(keyPath());
    const refused = custody();
    expect(await refused.available()).toBe(false);
    await expect(refused.seal(RECORD, A)).rejects.toThrow();
    await expect(refused.open(Buffer.alloc(64), A)).rejects.toThrow();
    expect(readFileSync(keyPath())).toEqual(before);
  });

  it('fails closed on a key that is a link, even to a good key', async () => {
    expect(await custody().available()).toBe(true);
    const elsewhere = join(root, 'elsewhere-key');
    writeFileSync(elsewhere, readFileSync(keyPath()), { mode: 0o600 });
    rmSync(keyPath());
    symlinkSync(elsewhere, keyPath());
    expect(await custody().available()).toBe(false);
    expect(lstatSync(keyPath()).isSymbolicLink()).toBe(true);
  });

  it('fails closed on a key that is not a regular file', async () => {
    mkdirSync(keyPath(), { recursive: true });
    expect(await custody().available()).toBe(false);
  });

  it('fails closed on a directory that is a link', async () => {
    mkdirSync(join(root, 'real'), { mode: 0o700 });
    mkdirSync(join(root, 'connectors'));
    symlinkSync(join(root, 'real'), dir);
    expect(await custody().available()).toBe(false);
    expect(readdirSync(join(root, 'real'))).toEqual([]);
  });

  it("fails closed on another uid's key (a fake fs)", async () => {
    expect(await custody().available()).toBe(true);
    const uid = process.getuid!();
    const foreign: CustodyFs = {
      ...fsp,
      open: (async (...args: Parameters<typeof fsp.open>) => {
        const handle = await fsp.open(...args);
        return new Proxy(handle, {
          get(target, property, receiver) {
            if (property === 'stat') return async () => Object.assign(await target.stat(), { uid: uid + 1 });
            const value: unknown = Reflect.get(target, property, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      }) as CustodyFs['open'],
    };
    expect(await custody({ fs: foreign }).available()).toBe(false);
  });

  it('is unavailable, storing nothing, when the directory cannot be made', async () => {
    writeFileSync(join(root, 'connectors'), 'a file where the directory goes');
    const blocked = custody();
    expect(await blocked.available()).toBe(false);
    await expect(blocked.seal(RECORD, A)).rejects.toThrow();
    expect(readdirSync(root)).toEqual(['connectors']);
    expect(excluded).toEqual([]);
  });

  it('a failure is not remembered: the next use tries again', async () => {
    writeFileSync(join(root, 'connectors'), 'in the way');
    const later = custody();
    expect(await later.available()).toBe(false);
    rmSync(join(root, 'connectors'));
    expect(await later.available()).toBe(true);
  });
});

describe('fileKeyCustody: sealing', () => {
  it('seals with a fresh nonce, AES-256-GCM: nonce, ciphertext, tag', async () => {
    const sealer = custody();
    const one = await sealer.seal(RECORD, A);
    const two = await sealer.seal(RECORD, A);
    expect(one.length).toBe(12 + Buffer.byteLength(RECORD) + 16);
    expect(one.subarray(0, 12)).not.toEqual(two.subarray(0, 12));
    expect(one.toString('latin1')).not.toContain('at-secret-5a1e');
    expect(await sealer.open(one, A)).toEqual({ text: RECORD, reseal: false });
  });

  it('opens a record only under its own id', async () => {
    const sealer = custody();
    const sealed = await sealer.seal(RECORD, A);
    await expect(sealer.open(sealed, B)).rejects.toThrow();
  });

  it('opens a record only under its own key', async () => {
    const sealed = await custody().seal(RECORD, A);
    const other = fileKeyCustody(join(root, 'other'), { excludeFromBackup: exclude });
    await expect(other.open(sealed, A)).rejects.toThrow();
  });

  it('refuses a tampered or truncated record', async () => {
    const sealer = custody();
    const sealed = await sealer.seal(RECORD, A);
    const flipped = Buffer.from(sealed);
    flipped[20] = (flipped[20] ?? 0) ^ 1;
    await expect(sealer.open(flipped, A)).rejects.toThrow();
    await expect(sealer.open(sealed.subarray(0, 27), A)).rejects.toThrow();
    await expect(sealer.open(sealed.subarray(0, sealed.length - 1), A)).rejects.toThrow();
  });
});
