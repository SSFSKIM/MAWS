import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireFileLock } from './file-lock';

describe('a lock file between processes', () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'maws-file-lock-'));
    path = join(dir, 'lock');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('holds a free lock under this pid until released', async () => {
    const release = await acquireFileLock(path, { waitMs: 1_000 });
    expect(readFileSync(path, 'utf8')).toBe(String(process.pid));
    release();
    expect(existsSync(path)).toBe(false);
  });

  it('waits while another holder lives and takes the lock once it is released', async () => {
    const first = await acquireFileLock(path, { waitMs: 1_000 });
    let second: (() => void) | null = null;
    const waiting = acquireFileLock(path, { waitMs: 2_000, pollMs: 10 }).then((release) => (second = release));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(second).toBeNull();
    first();
    await waiting;
    expect(second).not.toBeNull();
    expect(readFileSync(path, 'utf8')).toBe(String(process.pid));
    second!();
  });

  it('takes over a lock whose holder has died', async () => {
    const dead = spawnSync('/usr/bin/true').pid; // exited and reaped
    writeFileSync(path, String(dead));
    const release = await acquireFileLock(path, { waitMs: 1_000, pollMs: 10 });
    expect(readFileSync(path, 'utf8')).toBe(String(process.pid));
    release();
  });

  it('gives up after the wait while a live holder keeps it, leaving the lock alone', async () => {
    writeFileSync(path, '1'); // launchd: alive, and not this process's to signal
    await expect(acquireFileLock(path, { waitMs: 100, pollMs: 10 })).rejects.toThrow('still held (pid 1)');
    expect(readFileSync(path, 'utf8')).toBe('1');
  });

  it('waits on a lock its holder has created but not yet written', async () => {
    writeFileSync(path, '');
    await expect(acquireFileLock(path, { waitMs: 100, pollMs: 10 })).rejects.toThrow('still held');
    expect(existsSync(path)).toBe(true);
  });

  it('leaves a lock another holder has taken since in place on release', async () => {
    const release = await acquireFileLock(path, { waitMs: 1_000 });
    writeFileSync(path, '1');
    release();
    expect(readFileSync(path, 'utf8')).toBe('1');
  });
});
