// The lock a deployment tool holds for a whole run (O11 M3's reviews: two access-sync runs that overlap, an operator's
// retry beside a slow run, could each read the checkpoint, and the older could finish last). A file beside the state it
// guards, created only if absent, naming the process that holds it; any lock already there, its process gone or not,
// refuses the run before it starts, until the operator removes it. Run in a temporary directory.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withRunLock } from '../../deploy/run-lock.ts';

let dir: string;
let lock: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'desk-hub-lock-'));
  lock = join(dir, 'state', 'desk-hub-test.json.lock');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** The lock as another run left it. */
const heldBy = (holder: { pid: number; host: string }) => {
  mkdirSync(dirname(lock), { recursive: true });
  writeFileSync(lock, `${JSON.stringify({ at: new Date().toISOString(), token: 'theirs', ...holder })}\n`);
};
/** The pid of a process that has exited. */
const exited = () => spawnSync(process.execPath, ['-e', '']).pid;

describe('the run lock', () => {
  it('is held, naming this process, for the length of the run, and released after it, though the run throws', async () => {
    const seen = await withRunLock(lock, async () => JSON.parse(readFileSync(lock, 'utf8')) as { pid: number; host: string });
    expect(seen).toMatchObject({ pid: process.pid, host: hostname() });
    expect(existsSync(lock)).toBe(false);
    await expect(withRunLock(lock, async () => Promise.reject(new Error('the run failed')))).rejects.toThrow('the run failed');
    expect(existsSync(lock)).toBe(false);
  });

  it('refuses a second run while a run in this process holds it', async () => {
    let finish!: () => void;
    const first = withRunLock(lock, () => new Promise<string>((resolve) => (finish = () => resolve('first'))));
    let ran = false;
    await expect(withRunLock(lock, async () => (ran = true))).rejects.toThrow(/another run holds/);
    expect(ran).toBe(false);
    finish();
    expect(await first).toBe('first');
    expect(await withRunLock(lock, async () => 'after')).toBe('after');
  });

  it('refuses a run while another live process on this host holds it, and leaves its lock', async () => {
    heldBy({ pid: process.ppid, host: hostname() });
    let ran = false;
    await expect(withRunLock(lock, async () => (ran = true))).rejects.toThrow(new RegExp(`another run holds .*pid ${process.ppid}`));
    expect(ran).toBe(false);
    expect(JSON.parse(readFileSync(lock, 'utf8'))).toMatchObject({ pid: process.ppid, token: 'theirs' });
  });

  it('refuses a lock whose process is gone, naming its holder, until the operator removes it', async () => {
    const gone = exited();
    heldBy({ pid: gone, host: hostname() });
    let ran = false;
    await expect(withRunLock(lock, async () => (ran = true))).rejects.toThrow(new RegExp(`another run holds ${lock.replaceAll('.', '\\.')} \\(pid ${gone} on ${hostname()}, since `));
    expect(ran).toBe(false);
    expect(JSON.parse(readFileSync(lock, 'utf8'))).toMatchObject({ pid: gone, token: 'theirs' });
    rmSync(lock);
    expect(await withRunLock(lock, async () => JSON.parse(readFileSync(lock, 'utf8')) as { pid: number })).toMatchObject({ pid: process.pid });
    expect(existsSync(lock)).toBe(false);
  });

  it('refuses a lock taken on another host, whose process it cannot see', async () => {
    heldBy({ pid: exited(), host: 'another-host' });
    await expect(withRunLock(lock, async () => 'ran')).rejects.toThrow(/another run holds .*another-host/);
    expect(existsSync(lock)).toBe(true);
  });
});
