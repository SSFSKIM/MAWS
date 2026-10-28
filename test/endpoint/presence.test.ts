// The endpoint's presence entry (P5 O10 M10): what mawsd knows of the module without loading it.
import * as fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createEndpoint } from '../../src/endpoint';
import { enrollmentOnDisk, ENROLLMENT_FILES, UNENROLLED_STATUS } from '../../src/endpoint/presence';
import { FILES } from '../../src/endpoint/state/store';

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('the endpoint’s presence', () => {
  it('names state files the store has, and every one that holds or begins an enrollment', () => {
    const stored = new Set<string>(Object.values(FILES));
    for (const name of ENROLLMENT_FILES) expect(stored.has(name), name).toBe(true);
    expect([...ENROLLMENT_FILES].sort()).toEqual([FILES.machineKey, FILES.ledger, FILES.enrollment, FILES.org, FILES.delegation, FILES.provisioning, FILES.retirement].sort());
  });

  it('finds an enrollment by any of its files, a symlink included, and none in what an unenrolled endpoint keeps', () => {
    dir = mkdtempSync(join(tmpdir(), 'endpoint-presence-'));
    expect(enrollmentOnDisk(join(dir, 'absent'))).toBe(false);
    for (const name of ['policy.json', 'ops.jsonl', 'webauthn.json']) fs.writeFileSync(join(dir, name), '{}');
    fs.mkdirSync(join(dir, 'stale-2026-10-28T00-00-00.000Z'));
    expect(enrollmentOnDisk(dir)).toBe(false);
    for (const name of ENROLLMENT_FILES) {
      const path = join(dir, name);
      fs.writeFileSync(path, '{}');
      expect(enrollmentOnDisk(dir), name).toBe(true);
      fs.rmSync(path);
    }
    fs.symlinkSync('/nowhere', join(dir, 'machine-key.json'));
    expect(enrollmentOnDisk(dir)).toBe(true);
  });

  it('reports an unenrolled endpoint as the module itself does', () => {
    expect(UNENROLLED_STATUS).toEqual(createEndpoint().status());
  });
});
