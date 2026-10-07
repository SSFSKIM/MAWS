// E10 Task 2.4: the build id and wire fingerprint main presents to a supervisor and reports in host.status, with the e2e
// seams MAWS_E2E_BUILD_ID and MAWS_E2E_WIRE that simulate an update.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wireFingerprint } from '@shared/ipc/wire-fingerprint';
import { buildIdOf } from '../../engine-host/supervisor-files';
import { appIdentity } from './identity';

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

describe('appIdentity', () => {
  it('is the bundle’s build id and the wire fingerprint', () => {
    const identity = appIdentity(modulePath, {});
    expect(identity.buildId()).toBe(buildIdOf(modulePath));
    expect(identity.wire()).toBe(wireFingerprint());
  });

  it('under the e2e harness, MAWS_E2E_BUILD_ID and MAWS_E2E_WIRE stand in for them', () => {
    const identity = appIdentity(modulePath, { MAWS_E2E: '1', MAWS_E2E_BUILD_ID: 'stale', MAWS_E2E_WIRE: 'other' });
    expect(identity.buildId()).toBe('stale');
    expect(identity.wire()).toBe('other');
    const buildOnly = appIdentity(modulePath, { MAWS_E2E: '1', MAWS_E2E_BUILD_ID: 'stale' });
    expect([buildOnly.buildId(), buildOnly.wire()]).toEqual(['stale', wireFingerprint()]);
  });

  it('ignores the seams outside the e2e harness, and an empty value', () => {
    const outside = appIdentity(modulePath, { MAWS_E2E_BUILD_ID: 'stale', MAWS_E2E_WIRE: 'other' });
    expect([outside.buildId(), outside.wire()]).toEqual([buildIdOf(modulePath), wireFingerprint()]);
    const empty = appIdentity(modulePath, { MAWS_E2E: '1', MAWS_E2E_BUILD_ID: '', MAWS_E2E_WIRE: '' });
    expect([empty.buildId(), empty.wire()]).toEqual([buildIdOf(modulePath), wireFingerprint()]);
  });

  it('a utility host ignores the seams: it is never compared with a supervisor, so host.status reads what the app is', () => {
    const utility = appIdentity(modulePath, { MAWS_E2E: '1', MAWS_E2E_BUILD_ID: 'stale', MAWS_E2E_WIRE: 'other' }, 'utility');
    expect([utility.buildId(), utility.wire()]).toEqual([buildIdOf(modulePath), wireFingerprint()]);
    const detached = appIdentity(modulePath, { MAWS_E2E: '1', MAWS_E2E_BUILD_ID: 'stale', MAWS_E2E_WIRE: 'other' }, 'detached');
    expect([detached.buildId(), detached.wire()]).toEqual(['stale', 'other']);
  });

  it('once this app run starts a supervisor of its own (always of its build), the seams no longer apply', () => {
    const identity = appIdentity(modulePath, { MAWS_E2E: '1', MAWS_E2E_BUILD_ID: 'stale', MAWS_E2E_WIRE: 'other' });
    identity.startedOwn();
    expect([identity.buildId(), identity.wire()]).toEqual([buildIdOf(modulePath), wireFingerprint()]);
  });
});
