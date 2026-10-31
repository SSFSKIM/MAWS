import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hostsDirOf, sessionHostBinary, sessionHostPaths } from './files';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-holder-files-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the session host binary, per shape', () => {
  it('is Resources/session-host in a packaged app', () => {
    const entry = '/Applications/MAWS.app/Contents/Resources/app.asar/out/main/index-abc.js';
    expect(sessionHostBinary(entry)).toBe('/Applications/MAWS.app/Contents/Resources/session-host/maws-session-host');
  });

  it("is the platform's prebuild in a checkout", () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'maws' }));
    const entry = join(dir, 'out', 'main', 'index.js');
    expect(sessionHostBinary(entry, { platform: 'linux', arch: 'x64' })).toBe(join(dir, 'native', 'session-host', 'prebuilds', 'linux-x64', 'maws-session-host'));
    expect(sessionHostBinary(entry, { platform: 'darwin', arch: 'arm64' })).toBe(join(dir, 'native', 'session-host', 'prebuilds', 'darwin-arm64', 'maws-session-host'));
  });

  it("is the release's bin/ in mawsd's Linux pack", () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'maws-mawsd', mawsd: { release: '1.0.0-abc-12345678' } }));
    expect(sessionHostBinary(join(dir, 'out', 'main', 'mawsd.js'))).toBe(join(dir, 'bin', 'maws-session-host'));
  });
});

describe("a session host's files", () => {
  it('live in the hosts directory beside each other, the socket too when its path fits', () => {
    const hosts = hostsDirOf('/u/supervisor');
    expect(hosts).toBe('/u/supervisor/hosts');
    expect(sessionHostPaths(hosts, 'ABCD2345', { userData: '/u', tmpdir: '/tmp-x' })).toEqual({
      roster: join(hosts, 'ABCD2345.json'),
      token: join(hosts, 'ABCD2345.token'),
      socket: join(hosts, 'ABCD2345.sock'),
      log: join(hosts, 'ABCD2345.log'),
    });
  });

  it("put the socket under the tmpdir, per profile, when the hosts directory's path is too long", () => {
    const userData = `/u/${'p'.repeat(90)}`;
    const paths = sessionHostPaths(hostsDirOf(join(userData, 'supervisor')), 'ABCD2345', { userData, tmpdir: '/tmp-x' });
    expect(paths.socket).toMatch(/^\/tmp-x\/maws-session-hosts-[0-9a-f]{12}\/ABCD2345\.sock$/);
    const other = sessionHostPaths(hostsDirOf(join(`${userData}2`, 'supervisor')), 'ABCD2345', { userData: `${userData}2`, tmpdir: '/tmp-x' });
    expect(other.socket).not.toBe(paths.socket);
  });
});
