import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BREAK_STALE_MS, buildIdOf, isAlive, procStartOf, readLock, socketPathFor, takeLock, type LockDeps, type LockFile } from './supervisor-files';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), 'maws-lock-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const MINE = { protocol: 1, buildId: 'build-1', socketPath: '/x/host.sock' };
const lockPath = () => join(dir, 'host.lock');
const leftovers = () => fs.readdirSync(dir).filter((name) => name !== 'host.lock');

// A world of processes: `alive` maps a pid to its start token; anything absent is dead.
function deps(pid: number, alive: Map<number, string | null>, over: Partial<LockDeps> = {}): LockDeps {
  return {
    fs,
    pid,
    isAlive: (p) => alive.has(p),
    procStartOf: (p) => alive.get(p) ?? null,
    now: () => Date.now(),
    sleep: async () => {},
    ...over,
  };
}

function writeLock(lock: Partial<LockFile> & { pid: number; procStart: string }) {
  fs.writeFileSync(lockPath(), JSON.stringify({ protocol: 1, buildId: 'old', socketPath: '/old/host.sock', startedAt: '2026-10-06T00:00:00.000Z', ...lock }));
}

describe('takeLock', () => {
  it('takes a free lock: the file names this candidate, is 0600, and no temporary is left', async () => {
    const alive = new Map([[100, 'Mon Oct  6 10:00:00 2026']]);
    expect(await takeLock(dir, MINE, deps(100, alive))).toBe('taken');
    const lock = readLock(dir, fs);
    expect(lock).toMatchObject({ pid: 100, procStart: 'Mon Oct  6 10:00:00 2026', ...MINE });
    expect(new Date(lock!.startedAt).getTime()).not.toBeNaN();
    expect(fs.statSync(lockPath()).mode & 0o777).toBe(0o600);
    expect(leftovers()).toEqual([]);
  });

  it('breaks the lock of a dead pid', async () => {
    writeLock({ pid: 99, procStart: 'T99' });
    expect(await takeLock(dir, MINE, deps(100, new Map([[100, 'T100']])))).toBe('taken');
    expect(readLock(dir, fs)?.pid).toBe(100);
    expect(leftovers()).toEqual([]);
  });

  it('breaks the lock of a reused pid (alive, another start time)', async () => {
    writeLock({ pid: 99, procStart: 'T99-old' });
    const alive = new Map([
      [99, 'T99-new'],
      [100, 'T100'],
    ]);
    expect(await takeLock(dir, MINE, deps(100, alive))).toBe('taken');
    expect(readLock(dir, fs)?.pid).toBe(100);
  });

  it('breaks an unparseable or empty lock', async () => {
    fs.writeFileSync(lockPath(), '{"pid": 9');
    expect(await takeLock(dir, MINE, deps(100, new Map([[100, 'T100']])))).toBe('taken');
    fs.writeFileSync(lockPath(), '');
    expect(await takeLock(dir, MINE, deps(101, new Map([[101, 'T101']])))).toBe('taken');
    expect(readLock(dir, fs)?.pid).toBe(101);
  });

  it('a live holder is held whatever its socket does, and its lock is untouched', async () => {
    writeLock({ pid: 99, procStart: 'T99' });
    const before = fs.readFileSync(lockPath(), 'utf8');
    const alive = new Map([
      [99, 'T99'],
      [100, 'T100'],
    ]);
    expect(await takeLock(dir, MINE, deps(100, alive))).toBe('held');
    expect(fs.readFileSync(lockPath(), 'utf8')).toBe(before);
    expect(leftovers()).toEqual([]);
  });

  it('a live pid whose start time cannot be read, or a lock that recorded none, is live', async () => {
    writeLock({ pid: 99, procStart: 'T99' });
    expect(await takeLock(dir, MINE, deps(100, new Map<number, string | null>([[99, null], [100, 'T100']])))).toBe('held');
    writeLock({ pid: 98, procStart: '' });
    expect(await takeLock(dir, MINE, deps(100, new Map([[98, 'T98'], [100, 'T100']])))).toBe('held');
  });

  it('a lock that vanishes between the failed link and the read is retried at once', async () => {
    writeLock({ pid: 99, procStart: 'T99' });
    let reads = 0;
    const racing = {
      ...fs,
      readFileSync: ((path: fs.PathOrFileDescriptor, options?: unknown) => {
        if (path === lockPath() && reads++ === 0) fs.unlinkSync(lockPath()); // its holder exited and unlinked it
        return fs.readFileSync(path, options as never);
      }) as typeof fs.readFileSync,
    };
    expect(await takeLock(dir, MINE, deps(100, new Map([[99, 'T99'], [100, 'T100']]), { fs: racing }))).toBe('taken');
    expect(readLock(dir, fs)?.pid).toBe(100);
  });

  it('waits while another candidate holds the break file, then finds the lock it took', async () => {
    writeLock({ pid: 99, procStart: 'T99' });
    fs.writeFileSync(join(dir, 'host.lock.break'), '');
    const alive = new Map([
      [100, 'T100'],
      [101, 'T101'],
    ]);
    const sleep = vi.fn(async () => {
      // the other breaker finishes: it replaced the stale lock with its own and removed the break file
      fs.unlinkSync(join(dir, 'host.lock.break'));
      writeLock({ pid: 101, procStart: 'T101' });
    });
    expect(await takeLock(dir, MINE, deps(100, alive, { sleep }))).toBe('held');
    expect(sleep).toHaveBeenCalledOnce();
    expect(readLock(dir, fs)?.pid).toBe(101);
  });

  it('a break file older than BREAK_STALE_MS is itself stale and is removed', async () => {
    writeLock({ pid: 99, procStart: 'T99' });
    fs.writeFileSync(join(dir, 'host.lock.break'), '');
    const now = Date.now() + BREAK_STALE_MS + 1_000;
    const sleep = vi.fn(async () => {});
    expect(await takeLock(dir, MINE, deps(100, new Map([[100, 'T100']]), { now: () => now, sleep }))).toBe('taken');
    expect(sleep).not.toHaveBeenCalled();
    expect(leftovers()).toEqual([]);
  });

  it('two candidates breaking one stale lock: the one that read it stale never unlinks the other’s fresh lock', async () => {
    writeLock({ pid: 99, procStart: 'T99' });
    const alive = new Map([
      [100, 'T100'],
      [101, 'T101'],
    ]);
    let first: Promise<string> | null = null;
    // Candidate B reads the stale lock; before it acts, candidate A runs its whole attempt and takes the lock.
    const interleaved = {
      ...fs,
      readFileSync: ((path: fs.PathOrFileDescriptor, options?: unknown) => {
        const content = fs.readFileSync(path, options as never);
        if (path === lockPath() && first === null) first = takeLock(dir, MINE, deps(100, alive));
        return content;
      }) as typeof fs.readFileSync,
    };
    const second = await takeLock(dir, MINE, deps(101, alive, { fs: interleaved }));
    expect(await first).toBe('taken');
    expect(second).toBe('held');
    expect(readLock(dir, fs)?.pid).toBe(100);
    expect(leftovers()).toEqual([]);
  });

  it('a second candidate after the first took the lock (one directory, live holders): one taken, one held', async () => {
    const alive = new Map([
      [100, 'T100'],
      [101, 'T101'],
    ]);
    const results = await Promise.all([takeLock(dir, MINE, deps(100, alive)), takeLock(dir, MINE, deps(101, alive))]);
    expect(results.sort()).toEqual(['held', 'taken']);
    expect(leftovers()).toEqual([]);
  });
});

describe('socketPathFor', () => {
  const userData = '/Users/someone/Library/Application Support/MAWS';
  const fallback = join('/tmp-ish', `maws-supervisor-${createHash('sha1').update(userData).digest('hex').slice(0, 12)}`, 'host.sock');
  const dirOfLength = (bytes: number) => `/${'d'.repeat(bytes - '/'.length - '/host.sock'.length)}`;

  it('keeps the socket in the supervisor directory up to 103 bytes', () => {
    const dir103 = dirOfLength(103);
    expect(Buffer.byteLength(join(dir103, 'host.sock'))).toBe(103);
    expect(socketPathFor(dir103, userData, '/tmp-ish')).toBe(join(dir103, 'host.sock'));
  });

  it('falls back to a per-profile directory under tmpdir past 103 bytes, counting UTF-8 bytes', () => {
    expect(socketPathFor(dirOfLength(104), userData, '/tmp-ish')).toBe(fallback);
    const multibyte = `/${'é'.repeat(30)}${'d'.repeat(40)}`; // 71 characters, 101 bytes, 111 with /host.sock
    expect(socketPathFor(multibyte, userData, '/tmp-ish')).toBe(fallback);
  });
});

describe('buildIdOf', () => {
  it('is 16 hex of the file’s bytes, stable across reads, different across a byte change', () => {
    const a = join(dir, 'a.js');
    const b = join(dir, 'b.js');
    fs.writeFileSync(a, 'console.log(1)');
    fs.writeFileSync(b, 'console.log(2)');
    const id = buildIdOf(a);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(id).toBe(createHash('sha1').update('console.log(1)').digest('hex').slice(0, 16));
    expect(buildIdOf(a)).toBe(id);
    expect(buildIdOf(b)).not.toBe(id);
  });
});

describe('process facts', () => {
  it('isAlive: this process, an unsignalable one (EPERM reads alive), and a reaped child', () => {
    expect(isAlive(process.pid)).toBe(true);
    expect(isAlive(1)).toBe(true);
    const child = spawnSync('/usr/bin/true');
    expect(isAlive(child.pid!)).toBe(false);
  });

  it('procStartOf reads this process’s start time and null for a dead pid', () => {
    const start = procStartOf(process.pid);
    expect(start).toMatch(/^\w{3} \w{3} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/);
    expect(procStartOf(process.pid)).toBe(start);
    expect(procStartOf(spawnSync('/usr/bin/true').pid!)).toBeNull();
  });
});
