import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DAEMON_CUA_DIR, daemonCuaSocketPath, daemonSessionSocketName } from '../browser/cua-socket';
import { cuaSocketDir, daemonHostFiles, daemonPaths, RENDER_CUA_DIR, renderCuaSocketDir, socketFallbackDir } from './files';
import { defaultProfileDir } from './profile';

describe('defaultProfileDir', () => {
  it("is Electron's userData for productName MAWS on macOS", () => {
    expect(defaultProfileDir('darwin', { XDG_CONFIG_HOME: '/elsewhere' }, '/Users/o')).toBe('/Users/o/Library/Application Support/MAWS');
  });

  it('is ${XDG_CONFIG_HOME:-$HOME/.config}/MAWS on Linux', () => {
    expect(defaultProfileDir('linux', {}, '/home/o')).toBe('/home/o/.config/MAWS');
    expect(defaultProfileDir('linux', { XDG_CONFIG_HOME: '' }, '/home/o')).toBe('/home/o/.config/MAWS');
    expect(defaultProfileDir('linux', { XDG_CONFIG_HOME: '/srv/cfg' }, '/home/o')).toBe('/srv/cfg/MAWS');
    expect(defaultProfileDir('linux', { XDG_CONFIG_HOME: 'relative' }, '/home/o')).toBe('/home/o/.config/MAWS'); // the XDG spec ignores a relative one
  });
});

describe('daemonPaths', () => {
  it('keeps the three sockets in <profile>/mawsd when they fit sun_path', () => {
    const paths = daemonPaths('/tmp/p', '/var/tmp');
    expect(paths.dir).toBe('/tmp/p/mawsd');
    expect(paths.socketDir).toBe('/tmp/p/mawsd');
    expect(paths.sockets).toEqual({ 'engine-host': '/tmp/p/mawsd/engine-host.sock', 'pty-host': '/tmp/p/mawsd/pty-host.sock', machine: '/tmp/p/mawsd/machine.sock' });
    expect(paths.artifactsSocket).toBe('/tmp/p/mawsd/artifacts.sock'); // P5 O5 M2
    expect(paths.endpoint).toBe('/tmp/p/mawsd/endpoint');
    expect(paths.ptyHost).toBe('/tmp/p/mawsd/pty-host');
    expect(paths.log).toBe('/tmp/p/mawsd/mawsd.log');
  });

  it('moves all three to one per-profile tmpdir directory when the longest would pass 103 bytes', () => {
    // 103 bytes is exactly the limit: `machine.sock` would fit at this length and `engine-host.sock` would not
    const profile = `/p/${'x'.repeat(103 - '/p/'.length - '/mawsd/engine-host.sock'.length + 1)}`;
    expect(Buffer.byteLength(join(profile, 'mawsd', 'machine.sock'))).toBeLessThanOrEqual(103);
    const paths = daemonPaths(profile, '/var/tmp');
    expect(paths.socketDir).toMatch(/^\/var\/tmp\/maws-mawsd-[0-9a-f]{12}$/);
    for (const socket of [...Object.values(paths.sockets), paths.artifactsSocket]) expect(socket.startsWith(`${paths.socketDir}/`)).toBe(true); // P5 O5 M2: artifacts.sock with them
    expect(daemonPaths(profile, '/var/tmp').socketDir).toBe(paths.socketDir); // stable per profile
    expect(daemonPaths(`${profile}y`, '/var/tmp').socketDir).not.toBe(paths.socketDir);
    expect(paths.dir).toBe(join(profile, 'mawsd')); // only the sockets move
  });

  it('gives a client one lock and one token for every socket', () => {
    const paths = daemonPaths('/tmp/p');
    expect(daemonHostFiles(paths, 'pty-host')).toEqual({ dir: '/tmp/p/mawsd', lock: 'mawsd.lock', token: 'mawsd.token', socket: '/tmp/p/mawsd/pty-host.sock', log: 'mawsd.log' });
  });
});

// P5 O5 M5 (Interfaces §H): the daemon's per-session cua sockets, `<dir>/cua/<name>.sock`, in the daemon's directory when
// such a path fits sun_path and in the fallback directory otherwise, chosen by the cua path's own length. P5 O17 (the
// session sockets' names, 2026-11-03): a mawsd-owned socket is named by a 16-hex digest of the session id (21 bytes with
// `.sock`), not by the uuid (41), so the length a directory is chosen by is the digest name's.
describe('cuaSocketDir', () => {
  const UUID = '0b6f3c1e-7d2a-4c59-9e41-2f8a6b0d5c73';
  it('is <profile>/mawsd/cua when <dir>/cua/<digest>.sock fits', () => {
    expect(cuaSocketDir('/tmp/p', '/var/tmp')).toBe('/tmp/p/mawsd/cua');
  });

  it('falls back by its own length: a profile whose daemon sockets fit but whose cua paths would not', () => {
    const name = daemonSessionSocketName(UUID);
    const fits = `/p/${'x'.repeat(103 - '/p/'.length - `/mawsd/cua/${name}`.length)}`;
    expect(Buffer.byteLength(join(fits, 'mawsd', 'cua', name))).toBe(103);
    expect(cuaSocketDir(fits, '/var/tmp')).toBe(join(fits, 'mawsd', 'cua'));
    const longer = `${fits}y`;
    expect(daemonPaths(longer, '/var/tmp').socketDir).toBe(join(longer, 'mawsd')); // the daemon's own sockets still fit
    expect(cuaSocketDir(longer, '/var/tmp')).toBe(join(socketFallbackDir(longer, '/var/tmp'), 'cua'));
  });
});

// P5 O17 M4 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §D): the render host's per-session cua
// sockets, beside mawsd's own and chosen the same way, by their own length; `rcua` since the session sockets' names
describe('renderCuaSocketDir', () => {
  const UUID = '0b6f3c1e-7d2a-4c59-9e41-2f8a6b0d5c73';
  it('is <profile>/mawsd/rcua when <dir>/rcua/<digest>.sock fits', () => {
    expect(renderCuaSocketDir('/tmp/p', '/var/tmp')).toBe('/tmp/p/mawsd/rcua');
  });

  it('falls back by its own length, to rcua in the profile’s fallback directory', () => {
    const name = daemonSessionSocketName(UUID);
    const fits = `/p/${'x'.repeat(103 - '/p/'.length - `/mawsd/rcua/${name}`.length)}`;
    expect(Buffer.byteLength(join(fits, 'mawsd', 'rcua', name))).toBe(103);
    expect(renderCuaSocketDir(fits, '/var/tmp')).toBe(join(fits, 'mawsd', 'rcua'));
    const longer = `${fits}y`;
    expect(cuaSocketDir(longer, '/var/tmp')).toBe(join(longer, 'mawsd', 'cua')); // mawsd's own still fit
    expect(renderCuaSocketDir(longer, '/var/tmp')).toBe(join(socketFallbackDir(longer, '/var/tmp'), RENDER_CUA_DIR));
  });
});

// P5 O17 (the session sockets' names, 2026-11-03; Surprises, "the session sockets' sun_path overflow"): on a Mac the
// default profile is `/Users/<u>/Library/Application Support/MAWS` and the per-user TMPDIR is always 48 bytes, so with
// the uuid's name the render host's socket failed from a 5-character user name and the fallback never rescued either.
// Each mawsd-owned socket kind, for a 36-character session id under a 24-character user's profile, in the profile and
// in the fallback under that TMPDIR: every path fits sun_path.
describe('the session sockets on a Mac’s default profile', () => {
  const UUID = '0b6f3c1e-7d2a-4c59-9e41-2f8a6b0d5c73';
  const TMP = `/var/folders/c1/${'t'.repeat(30)}/T`; // os.tmpdir()'s form of the per-user TMPDIR
  const profile = defaultProfileDir('darwin', {}, `/Users/${'u'.repeat(24)}`);
  const kinds = [
    { kind: 'mawsd’s cua socket', dirOf: cuaSocketDir, name: DAEMON_CUA_DIR, inProfile: 72 + 24, fallback: 98 },
    { kind: 'the render host’s socket', dirOf: renderCuaSocketDir, name: RENDER_CUA_DIR, inProfile: 73 + 24, fallback: 99 },
  ];

  it('reads a 48-byte TMPDIR and a 36-character session id', () => {
    expect(Buffer.byteLength(TMP)).toBe(48);
    expect(UUID).toHaveLength(36);
  });

  for (const { kind, dirOf, name, inProfile, fallback } of kinds) {
    it(`${kind}: fits in a 24-character user’s profile (${inProfile} bytes) and in the TMPDIR fallback (${fallback})`, () => {
      const dir = dirOf(profile, TMP);
      expect(dir).toBe(join(profile, 'mawsd', name));
      const path = daemonCuaSocketPath(dir, UUID);
      expect(path).toBe(join(dir, daemonSessionSocketName(UUID)));
      expect(Buffer.byteLength(path!)).toBe(inProfile);
      const fellBack = daemonCuaSocketPath(join(socketFallbackDir(profile, TMP), name), UUID);
      expect(fellBack).not.toBeNull();
      expect(Buffer.byteLength(fellBack!)).toBe(fallback);
    });

    it(`${kind}: falls back under the 48-byte TMPDIR when the user name is too long for the profile, and fits there`, () => {
      const long = defaultProfileDir('darwin', {}, `/Users/${'u'.repeat(40)}`);
      const dir = dirOf(long, TMP);
      expect(dir).toBe(join(socketFallbackDir(long, TMP), name));
      expect(Buffer.byteLength(daemonCuaSocketPath(dir, UUID)!)).toBe(fallback);
    });
  }
});
