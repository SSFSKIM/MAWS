// The quit's reaper (reaper.ts): how it is spawned, and its shell's guard run for real on disposable processes; the test
// runner itself is never a target.
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REAPER_SCRIPT, startReaper } from './reaper';

const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
});

const ended = (child: ChildProcess) =>
  new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve({ code: child.exitCode, signal: child.signalCode });
    else child.once('exit', (code, signal) => resolve({ code, signal }));
  });

describe('the quit reaper', () => {
  it('spawns one detached /bin/sh with no stdio, naming the pid and the wait, and lets it go', () => {
    const unref = vi.fn();
    const spawnFake = vi.fn(() => ({ on: vi.fn(), unref }));
    startReaper(4242, 7, spawnFake as never);
    expect(spawnFake).toHaveBeenCalledOnce();
    expect(spawnFake).toHaveBeenCalledWith('/bin/sh', ['-c', REAPER_SCRIPT, 'maws-reaper', '4242', '7'], { detached: true, stdio: 'ignore' });
    expect(unref).toHaveBeenCalledOnce();
  });

  it('a spawn that throws leaves the quit as it was', () => {
    expect(() =>
      startReaper(4242, 7, () => {
        throw new Error('EAGAIN');
      }),
    ).not.toThrow();
  });

  it('ends its parent once the wait is over, with SIGKILL', async () => {
    // the parent starts the reaper on itself ($$), then becomes a long sleep under the same pid
    const parent = spawn('/bin/sh', ['-c', 'reaper="$1"; /bin/sh -c "$reaper" maws-reaper $$ 0.3 & exec /bin/sleep 30', 'parent', REAPER_SCRIPT], { stdio: 'ignore' });
    children.push(parent);
    const started = Date.now();
    expect(await ended(parent)).toEqual({ code: null, signal: 'SIGKILL' });
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  // macOS's `ps -o comm=` names a process by its executable's path (Linux's by a 15-character name)
  it.skipIf(process.platform !== 'darwin')('takes its parent’s Chromium helpers with it, and no other child', async () => {
    const helperPath = '/tmp/maws-reaper-test.app/Contents/Frameworks/MAWS Helper.app/Contents/MacOS/MAWS Helper';
    const parent = spawn(
      '/bin/bash',
      ['-c', '(exec -a "$2" /bin/sleep 30) & echo "$!"; (exec -a mawsd /bin/sleep 30) & echo "$!"; /bin/sh -c "$1" maws-reaper $$ 0.5 & exec /bin/sleep 30', 'parent', REAPER_SCRIPT, helperPath],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    children.push(parent);
    let out = '';
    parent.stdout!.on('data', (chunk: Buffer) => void (out += String(chunk)));
    await expect.poll(() => out.trim().split('\n').length).toBe(2);
    const [helper, mawsd] = out.trim().split('\n').map(Number) as [number, number];
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    try {
      expect(await ended(parent)).toEqual({ code: null, signal: 'SIGKILL' });
      await expect.poll(() => alive(helper)).toBe(false);
      expect(alive(mawsd), 'a child that is not a Chromium helper stays').toBe(true);
    } finally {
      for (const pid of [helper, mawsd]) if (alive(pid)) process.kill(pid, 'SIGKILL');
    }
  });

  it('leaves a process that is not its parent alone: the target outlives the reaper', async () => {
    const target = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
    children.push(target);
    // the reaper's parent is this test runner, not the target
    const reaper = spawn('/bin/sh', ['-c', REAPER_SCRIPT, 'maws-reaper', String(target.pid), '0.2'], { stdio: 'ignore' });
    children.push(reaper);
    const { code } = await ended(reaper);
    expect(code).not.toBe(0); // the guard failed, so no kill ran
    expect(target.exitCode).toBeNull();
    expect(target.signalCode).toBeNull();
  });
});
