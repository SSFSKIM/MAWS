import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { withProbeFile } from './probe-file';

vi.mock('node:crypto', async (original) => ({ ...await original<typeof import('node:crypto')>(), randomUUID: vi.fn((await original<typeof import('node:crypto')>()).randomUUID) }));
import { randomUUID } from 'node:crypto';
afterEach(() => vi.mocked(randomUUID).mockClear());

test('concurrent probes are unique, preserve existing files, and clean up a failed launch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maws-probe-test-'));
  const existing = join(root, 'c8c-live-probe.txt');
  writeFileSync(existing, 'owner bytes');
  let failedPath = '';
  try {
    await withProbeFile(root, 'first', async (first) => {
      await withProbeFile(root, 'second', async (second) => {
        expect(first).not.toBe(second);
        expect(readFileSync(first, 'utf8')).toBe('first');
        expect(readFileSync(second, 'utf8')).toBe('second');
      });
    });
    await expect(withProbeFile(root, 'probe', async (path) => { failedPath = path; throw new Error('launch failed'); })).rejects.toThrow('launch failed');
    expect(existsSync(failedPath)).toBe(false);
    expect(readFileSync(existing, 'utf8')).toBe('owner bytes');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('even a name collision never overwrites or removes a file it did not create', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maws-probe-test-'));
  const id = '11111111-1111-4111-8111-111111111111';
  const path = join(root, `c8c-live-probe-${id}.txt`);
  writeFileSync(path, 'do not replace');
  vi.mocked(randomUUID).mockReturnValueOnce(id);
  try {
    await expect(withProbeFile(root, 'replacement', async () => { throw new Error('must not launch'); })).rejects.toMatchObject({ code: 'EEXIST' });
    expect(readFileSync(path, 'utf8')).toBe('do not replace');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
