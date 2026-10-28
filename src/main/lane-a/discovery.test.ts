// Discovery (P5 O9 M2): where a terminal session's bridge listens, by sminos's own rule, and the guard that keeps every
// test away from the owner's sminos (acceptance 10).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bridgeSocket, sminosHome, SOCKET_PATH_MAX, watchBridgeDir } from './discovery';

const scratch: string[] = [];
const dir = () => {
  const d = mkdtempSync(join(tmpdir(), 'o9d-'));
  scratch.push(d);
  return d;
};
afterEach(() => {
  for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('the sminos home', () => {
  const home = '/scratch/home';
  it('is SMINOS_HOME from main’s environment, else the login shell’s, else DAEMON_HOME from either, else ~/.claude/sminos', () => {
    expect(sminosHome({ SMINOS_HOME: '/a', DAEMON_HOME: '/b', HOME: home }, { SMINOS_HOME: '/c' })).toBe('/a');
    expect(sminosHome({ DAEMON_HOME: '/b', HOME: home }, { SMINOS_HOME: '/c' })).toBe('/c');
    expect(sminosHome({ DAEMON_HOME: '/b', HOME: home }, {})).toBe('/b');
    expect(sminosHome({ HOME: home }, { DAEMON_HOME: '/d' })).toBe('/d');
    expect(sminosHome({ HOME: home }, null)).toBe('/scratch/home/.claude/sminos');
    expect(sminosHome({ HOME: home, SMINOS_HOME: '' }, { SMINOS_HOME: '/c' })).toBe('/c'); // an empty value is none, as sminos's `or`
  });

  it('refuses, under a test runner, a home under the real ~/.claude', () => {
    const real = userInfo().homedir;
    expect(() => sminosHome({ HOME: real }, null)).toThrow(/real ~\/\.claude/);
    expect(() => sminosHome({ SMINOS_HOME: join(real, '.claude', 'sminos') }, null)).toThrow(/real ~\/\.claude/);
    expect(() => sminosHome({ SMINOS_HOME: join(real, '.claude', 'sminos') }, null, { underTest: false })).not.toThrow();
  });

  it('is never the real one in this suite, whose HOME and SMINOS_HOME are scratch', () => {
    const real = join(userInfo().homedir, '.claude');
    const resolved = sminosHome({ ...process.env, HOME: dir(), SMINOS_HOME: dir() }, null);
    expect(resolved.startsWith(real)).toBe(false);
    expect(homedir()).toBeTypeOf('string');
  });
});

describe('the bridge socket', () => {
  it('is <home>/bridge/<engine session id>.sock, and a path over 103 bytes does not fit', () => {
    expect(bridgeSocket('/h', 'abc')).toEqual({ path: '/h/bridge/abc.sock', fits: true });
    const long = `/${'x'.repeat(SOCKET_PATH_MAX)}`;
    expect(bridgeSocket(long, 'abc').fits).toBe(false);
  });
});

describe('the bridge directory watch', () => {
  it('names a socket that appears, and follows the directory into being', async () => {
    const home = dir();
    const seen: (string | null)[] = [];
    const watch = watchBridgeDir(home, (name) => seen.push(name), { pollMs: 50 });
    try {
      mkdirSync(join(home, 'bridge'));
      await expect.poll(() => seen.length, { timeout: 3000 }).toBeGreaterThan(0); // the directory's appearance
      seen.length = 0;
      writeFileSync(join(home, 'bridge', 'sess-1.sock'), '');
      await expect.poll(() => seen.includes('sess-1.sock') || seen.includes(null), { timeout: 3000 }).toBe(true);
    } finally {
      watch.close();
    }
  });
});
