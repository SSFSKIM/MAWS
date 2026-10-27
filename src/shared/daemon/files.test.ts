import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { daemonHostFiles, daemonPaths } from './files';
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
    for (const socket of Object.values(paths.sockets)) expect(socket.startsWith(`${paths.socketDir}/`)).toBe(true);
    expect(daemonPaths(profile, '/var/tmp').socketDir).toBe(paths.socketDir); // stable per profile
    expect(daemonPaths(`${profile}y`, '/var/tmp').socketDir).not.toBe(paths.socketDir);
    expect(paths.dir).toBe(join(profile, 'mawsd')); // only the sockets move
  });

  it('gives a client one lock and one token for every socket', () => {
    const paths = daemonPaths('/tmp/p');
    expect(daemonHostFiles(paths, 'pty-host')).toEqual({ dir: '/tmp/p/mawsd', lock: 'mawsd.lock', token: 'mawsd.token', socket: '/tmp/p/mawsd/pty-host.sock', log: 'mawsd.log' });
  });
});
