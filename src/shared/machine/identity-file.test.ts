import * as actualFs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_FILE, readMachineRef, readOrMintMachineRef } from './identity-file';
import { MachineRefSchema } from './ref';

// The minter's pause point: the identity file is published by `link`, so a hook run just before the real link stands for
// a first run paused after writing its temporary file and before linking it.
const beforeLink = vi.hoisted(() => ({ hook: null as null | (() => void) }));
// The write stage's faults: `chunk` caps the bytes each writeSync call writes (a short write), and `fail` makes the next
// call throw (a full disk).
const writes = vi.hoisted(() => ({ chunk: null as number | null, fail: null as NodeJS.ErrnoException | null, calls: 0 }));
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const linkSync: typeof fs.linkSync = (existing, created) => {
    const hook = beforeLink.hook;
    beforeLink.hook = null;
    hook?.();
    fs.linkSync(existing, created);
  };
  // The minter's one form, (fd, buffer, offset, length).
  const writeSync = ((fd: number, buffer: Uint8Array, offset: number, length: number): number => {
    writes.calls++;
    if (writes.fail) throw writes.fail;
    return fs.writeSync(fd, buffer, offset, writes.chunk === null ? length : Math.min(length, writes.chunk));
  }) as unknown as typeof fs.writeSync;
  return { ...fs, default: { ...fs, linkSync, writeSync }, linkSync, writeSync };
});

let profile: string;
beforeEach(() => {
  profile = actualFs.mkdtempSync(join(tmpdir(), 'maws-identity-'));
});
afterEach(() => {
  beforeLink.hook = null;
  Object.assign(writes, { chunk: null, fail: null, calls: 0 });
  actualFs.rmSync(profile, { recursive: true, force: true });
});

const identityPath = () => join(profile, IDENTITY_FILE);
const leftovers = () => actualFs.readdirSync(profile).filter((name) => name !== IDENTITY_FILE);

describe('readOrMintMachineRef', () => {
  it('mints once at the first run into a 0600 machine.json and reads the same ref ever after', () => {
    const ref = readOrMintMachineRef(profile);
    const written = actualFs.readFileSync(identityPath(), 'utf8');
    expect(JSON.parse(written)).toEqual({ version: 1, ref, mintedAt: expect.any(String) });
    expect(Number.isNaN(Date.parse(JSON.parse(written).mintedAt))).toBe(false);
    expect(actualFs.statSync(identityPath()).mode & 0o777).toBe(0o600);
    expect(leftovers()).toEqual([]);

    expect(readOrMintMachineRef(profile)).toBe(ref);
    expect(readMachineRef(profile)).toBe(ref);
    expect(actualFs.readFileSync(identityPath(), 'utf8')).toBe(written); // never rewritten
  });

  it("is RL5's format, from 128 random bits: 22 base64url characters of 16 random bytes", () => {
    const refs = new Set<string>();
    for (let n = 0; n < 32; n++) {
      const dir = actualFs.mkdtempSync(join(profile, 'p-'));
      const ref = readOrMintMachineRef(dir);
      expect(ref).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(MachineRefSchema.safeParse(ref).success).toBe(true);
      expect(Buffer.from(ref, 'base64url')).toHaveLength(16);
      refs.add(ref);
    }
    expect(refs.size).toBe(32); // a second profile gets a different ref
  });

  it("creates the profile's directory when it does not exist yet", () => {
    const dir = join(profile, 'fresh', 'profile');
    const ref = readOrMintMachineRef(dir);
    expect(readMachineRef(dir)).toBe(ref);
  });

  it("publishes atomically: a run that starts while the first is paused before its link leaves both on one complete ref", () => {
    let second: string | null = null;
    let seenBySecond: string[] = [];
    beforeLink.hook = () => {
      // The first run's complete temporary file is on disk and machine.json is not: a second run starts meanwhile.
      expect(actualFs.existsSync(identityPath())).toBe(false);
      second = readOrMintMachineRef(profile);
      seenBySecond = leftovers();
    };
    const first = readOrMintMachineRef(profile);

    expect(second).not.toBeNull();
    expect(first).toBe(second); // the first run lost the link and read the winner's file
    expect(readMachineRef(profile)).toBe(first);
    expect(JSON.parse(actualFs.readFileSync(identityPath(), 'utf8')).ref).toBe(first);
    expect(seenBySecond).toHaveLength(1); // the paused run's fresh temporary file survived the second run's sweep
    expect(leftovers()).toEqual([]); // and each run removed its own
  });

  it('writes the whole identity through short writes before it links it', () => {
    writes.chunk = 7;
    const ref = readOrMintMachineRef(profile);
    expect(writes.calls).toBeGreaterThan(1);
    expect(JSON.parse(actualFs.readFileSync(identityPath(), 'utf8'))).toEqual({ version: 1, ref, mintedAt: expect.any(String) });
    expect(leftovers()).toEqual([]);
  });

  it('publishes nothing and removes its temporary file when the write fails, so the next start mints afresh', () => {
    writes.fail = Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
    expect(() => readOrMintMachineRef(profile)).toThrow('ENOSPC');
    expect(actualFs.readdirSync(profile)).toEqual([]);
    writes.fail = null;
    expect(readMachineRef(profile)).toBeNull();
    expect(readOrMintMachineRef(profile)).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('removes a stray temporary file older than a minute at the next start, and keeps a fresh one (a racing minter)', () => {
    const stray = join(profile, `${IDENTITY_FILE}.4242.c3RyYXk`);
    const fresh = join(profile, `${IDENTITY_FILE}.4343.ZnJlc2g`);
    actualFs.writeFileSync(stray, '{"version":1,"ref":"strayStrayStrayStr', { mode: 0o600 });
    actualFs.writeFileSync(fresh, '{"version":1,"ref":"freshFreshFreshFre', { mode: 0o600 });
    const old = new Date(Date.now() - 2 * 60_000);
    actualFs.utimesSync(stray, old, old);

    readOrMintMachineRef(profile);
    expect(actualFs.existsSync(stray)).toBe(false);
    expect(actualFs.existsSync(fresh)).toBe(true);
  });
});

describe('a malformed identity file', () => {
  const malformed: [string, string][] = [
    ['not JSON', '{"version":1,"ref":'],
    ['empty', ''],
    ['no ref', '{"version":1,"mintedAt":"2026-10-27T00:00:00.000Z"}'],
    ['a ref that breaks the format', '{"version":1,"ref":"abcdefgh/ijklmnopqrst","mintedAt":"2026-10-27T00:00:00.000Z"}'],
    ['a ref too short', '{"version":1,"ref":"short","mintedAt":"2026-10-27T00:00:00.000Z"}'],
    ['not an object', '"q3J8Vb2bQyKh0bN7k6m2Fw"'],
  ];

  it.each(malformed)('is refused loudly, naming the path, and never re-minted (%s)', (_, content) => {
    actualFs.writeFileSync(identityPath(), content);
    expect(() => readMachineRef(profile)).toThrow(identityPath());
    expect(() => readOrMintMachineRef(profile)).toThrow(identityPath());
    expect(actualFs.readFileSync(identityPath(), 'utf8')).toBe(content);
    expect(leftovers()).toEqual([]);
  });
});

describe('readMachineRef', () => {
  it('answers null when no identity exists, and mints nothing', () => {
    expect(readMachineRef(profile)).toBeNull();
    expect(actualFs.readdirSync(profile)).toEqual([]);
  });

  it('reads a ref minted elsewhere in the whole RL5 range, whatever the file version', () => {
    const ref = 'Another_daemon-minted-this-ref-0123456789';
    actualFs.writeFileSync(identityPath(), JSON.stringify({ version: 2, ref, mintedAt: '2026-10-27T00:00:00.000Z', extra: true }));
    expect(readMachineRef(profile)).toBe(ref);
  });
});

// P5 O2 M5 (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md; the remote layer's Decision Log 25): a devcloud
// delegation's ref begins with the delegation's id.
describe('readOrMintMachineRef with a prefix', () => {
  const delegation = '0123456789abcdef0123456789abcdef';

  it("mints `<prefix>_<22 base64url>`, 55 characters inside RL5's format", () => {
    const ref = readOrMintMachineRef(profile, { prefix: delegation });
    expect(ref).toHaveLength(55);
    expect(ref.startsWith(`${delegation}_`)).toBe(true);
    expect(MachineRefSchema.safeParse(ref).success).toBe(true);
    expect(Buffer.from(ref.slice(33), 'base64url')).toHaveLength(16);
    expect(JSON.parse(actualFs.readFileSync(identityPath(), 'utf8'))).toEqual({ version: 1, ref, mintedAt: expect.any(String) });
    expect(readOrMintMachineRef(profile, { prefix: delegation })).toBe(ref);
  });

  it.each([
    ['upper-case hex', '0123456789ABCDEF0123456789ABCDEF'],
    ['too short', '0123456789abcdef'],
    ['too long', `${delegation}0`],
    ['not hex', 'g123456789abcdef0123456789abcdef'],
    ['empty', ''],
    ['an underscore', '0123456789abcdef_123456789abcdef'],
  ])('refuses a prefix that is not 32 lower-case hex digits (%s), minting nothing', (_, prefix) => {
    expect(() => readOrMintMachineRef(profile, { prefix })).toThrow(/prefix/);
    expect(actualFs.readdirSync(profile)).toEqual([]);
  });

  it('leaves an existing file as it is, prefix or not', () => {
    const ref = readOrMintMachineRef(profile);
    const written = actualFs.readFileSync(identityPath(), 'utf8');
    expect(readOrMintMachineRef(profile, { prefix: delegation })).toBe(ref);
    expect(actualFs.readFileSync(identityPath(), 'utf8')).toBe(written);
  });
});
