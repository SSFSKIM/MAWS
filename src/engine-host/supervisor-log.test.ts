import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openSupervisorLog } from './supervisor-log';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-log-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('the supervisor log', () => {
  it('appends timestamped lines to host.log, creating the directory 0700', () => {
    const dir = join(root, 'supervisor');
    const log = openSupervisorLog(dir);
    log('first');
    log('second');
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    const lines = readFileSync(join(dir, 'host.log'), 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z first$/);
  });

  it('rotates to host.log.1 past the size cap, keeping one previous generation', () => {
    const log = openSupervisorLog(root, 100);
    for (let i = 0; i < 12; i++) log(`line ${String(i).padStart(2, '0')} ${'x'.repeat(10)}`);
    const current = readFileSync(join(root, 'host.log'), 'utf8');
    const previous = readFileSync(join(root, 'host.log.1'), 'utf8');
    expect(Buffer.byteLength(current)).toBeLessThanOrEqual(100);
    expect(current).toContain('line 11');
    expect(previous).not.toContain('line 11');
    expect(existsSync(join(root, 'host.log.2'))).toBe(false);
  });

  it('counts a log left by an earlier run toward the cap', () => {
    openSupervisorLog(root, 100)('x'.repeat(60));
    openSupervisorLog(root, 100)('y'.repeat(60));
    expect(readFileSync(join(root, 'host.log.1'), 'utf8')).toContain('x'.repeat(60));
  });
});
