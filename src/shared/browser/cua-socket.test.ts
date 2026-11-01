import { describe, expect, it } from 'vitest';
import { cuaSocketPath, daemonCuaSocketPath, MAX_SOCKET_PATH_BYTES } from './cua-socket';

describe('a session\'s cua socket path', () => {
  it('is <dir>/<appSessionId>.sock in the app\'s directory and in the daemon\'s alike', () => {
    expect(cuaSocketPath('/u/browser/cua', 'S1')).toBe('/u/browser/cua/S1.sock');
    expect(daemonCuaSocketPath('/p/mawsd/cua', 'S1')).toBe('/p/mawsd/cua/S1.sock');
  });

  it('is none past sun_path (103 bytes)', () => {
    const dir = `/${'d'.repeat(MAX_SOCKET_PATH_BYTES - '/'.length - '/S1.sock'.length)}`;
    expect(daemonCuaSocketPath(dir, 'S1')).toHaveLength(MAX_SOCKET_PATH_BYTES);
    expect(daemonCuaSocketPath(`${dir}x`, 'S1')).toBeNull();
    expect(cuaSocketPath(`${dir}x`, 'S1')).toBeNull();
  });
});
