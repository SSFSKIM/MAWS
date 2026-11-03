import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cuaSocketPath, daemonCuaSocketPath, daemonSessionSocketName, MAX_SOCKET_PATH_BYTES } from './cua-socket';

const UUID = '0b6f3c1e-7d2a-4c59-9e41-2f8a6b0d5c73';

describe('a session\'s cua socket path', () => {
  it('is <dir>/<appSessionId>.sock in the app\'s directory, the cross-build convention mawsd relays to', () => {
    expect(cuaSocketPath('/u/browser/cua', 'S1')).toBe('/u/browser/cua/S1.sock');
  });

  // P5 O17 (the session sockets' names, 2026-11-03): mawsd's own and the render host's are named by a digest
  it('is <dir>/<16 hex of the session id\'s sha256>.sock in a directory mawsd owns: 21 bytes for any session id', () => {
    const name = daemonSessionSocketName(UUID);
    expect(name).toBe(`${createHash('sha256').update(UUID).digest('hex').slice(0, 16)}.sock`);
    expect(name).toMatch(/^[0-9a-f]{16}\.sock$/);
    expect(daemonSessionSocketName('S1')).toHaveLength(21);
    expect(daemonSessionSocketName(UUID)).toBe(name); // stable for the session's life
    expect(daemonSessionSocketName('0b6f3c1e-7d2a-4c59-9e41-2f8a6b0d5c74')).not.toBe(name);
    expect(daemonCuaSocketPath('/p/mawsd/cua', UUID)).toBe(`/p/mawsd/cua/${name}`);
  });

  it('is none past sun_path (103 bytes)', () => {
    const appDir = `/${'d'.repeat(MAX_SOCKET_PATH_BYTES - '/'.length - '/S1.sock'.length)}`;
    expect(cuaSocketPath(appDir, 'S1')).toHaveLength(MAX_SOCKET_PATH_BYTES);
    expect(cuaSocketPath(`${appDir}x`, 'S1')).toBeNull();
    const dir = `/${'d'.repeat(MAX_SOCKET_PATH_BYTES - '/'.length - '/'.length - 21)}`;
    expect(daemonCuaSocketPath(dir, UUID)).toHaveLength(MAX_SOCKET_PATH_BYTES);
    expect(daemonCuaSocketPath(`${dir}x`, UUID)).toBeNull();
  });
});
