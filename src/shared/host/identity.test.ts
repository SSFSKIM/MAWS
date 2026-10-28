// E10 Task 2.4: the build id and wire main presents to a supervisor and reports in host.status, with the e2e seams
// MAWS_E2E_BUILD_ID and (P5 O1 M6) MAWS_E2E_WIRE_MAJOR that simulate an update.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SOCKET_PROTOCOL } from '@shared/host/socket-protocol';
import { WIRE_CAPABILITIES, WIRE_MINOR } from '@shared/ipc/wire';
import { wireFingerprint } from '@shared/ipc/wire-fingerprint';
import { buildIdOf } from '../../engine-host/supervisor-files';
import { appIdentity, type AppIdentity } from './identity';

let dir: string;
let modulePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-identity-'));
  modulePath = join(dir, 'engine-host.js');
  writeFileSync(modulePath, '// the engine host bundle');
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const read = (identity: AppIdentity) => [identity.buildId(), identity.major()];

describe('appIdentity', () => {
  it('is the bundle’s build id, the wire’s major, minor and capabilities, and the wire fingerprint', () => {
    const identity = appIdentity(modulePath, {});
    expect(identity.buildId()).toBe(buildIdOf(modulePath));
    expect([identity.major(), identity.minor(), identity.capabilities()]).toEqual([SOCKET_PROTOCOL, WIRE_MINOR, WIRE_CAPABILITIES]);
    expect(identity.wire()).toBe(wireFingerprint());
  });

  it('under the e2e harness, MAWS_E2E_BUILD_ID and MAWS_E2E_WIRE_MAJOR stand in for the build and the major', () => {
    const identity = appIdentity(modulePath, { MAWS_E2E: '1', MAWS_E2E_BUILD_ID: 'stale', MAWS_E2E_WIRE_MAJOR: '4' });
    expect(read(identity)).toEqual(['stale', 4]);
    expect([identity.minor(), identity.wire()]).toEqual([WIRE_MINOR, wireFingerprint()]); // the seam moves the major alone
    const buildOnly = appIdentity(modulePath, { MAWS_E2E: '1', MAWS_E2E_BUILD_ID: 'stale' });
    expect(read(buildOnly)).toEqual(['stale', SOCKET_PROTOCOL]);
  });

  it('ignores the seams outside the e2e harness, and an empty or unreadable value', () => {
    expect(read(appIdentity(modulePath, { MAWS_E2E_BUILD_ID: 'stale', MAWS_E2E_WIRE_MAJOR: '4' }))).toEqual([buildIdOf(modulePath), SOCKET_PROTOCOL]);
    expect(read(appIdentity(modulePath, { MAWS_E2E: '1', MAWS_E2E_BUILD_ID: '', MAWS_E2E_WIRE_MAJOR: '' }))).toEqual([buildIdOf(modulePath), SOCKET_PROTOCOL]);
    expect(read(appIdentity(modulePath, { MAWS_E2E: '1', MAWS_E2E_WIRE_MAJOR: 'four' }))).toEqual([buildIdOf(modulePath), SOCKET_PROTOCOL]);
  });

  it('a utility host ignores the seams: it is never compared with a supervisor, so host.status reads what the app is', () => {
    const env = { MAWS_E2E: '1', MAWS_E2E_BUILD_ID: 'stale', MAWS_E2E_WIRE_MAJOR: '4' };
    expect(read(appIdentity(modulePath, env, 'utility'))).toEqual([buildIdOf(modulePath), SOCKET_PROTOCOL]);
    expect(read(appIdentity(modulePath, env, 'detached'))).toEqual(['stale', 4]);
  });

  it('once this app run starts a supervisor of its own (always of its build), the seams no longer apply', () => {
    const identity = appIdentity(modulePath, { MAWS_E2E: '1', MAWS_E2E_BUILD_ID: 'stale', MAWS_E2E_WIRE_MAJOR: '4' });
    identity.startedOwn();
    expect(read(identity)).toEqual([buildIdOf(modulePath), SOCKET_PROTOCOL]);
  });
});
