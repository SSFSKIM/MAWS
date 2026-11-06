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
