// The process-group probe (./process-group.ts) across a SIGKILL and the reap after it. On macOS a group whose processes
// are dead but not yet reaped answers `kill(-pgid, 0)` with EPERM, not ESRCH: e2e/widgets.spec.ts's E8 Stop case polled
// its group through that window and failed on the EPERM (runs 41221488219, 41432116462, 42311634738).
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { groupAlive } from './process-group';

// Blocks this process, which is the leader's parent, so nothing reaps the leader in the meantime
const block = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const probe = (pgid: number): string => {
  try {
    process.kill(-pgid, 0);
    return 'ok';
  } catch (error) {
    return String((error as NodeJS.ErrnoException).code);
  }
};

describe('groupAlive', () => {
  it.skipIf(process.platform !== 'darwin')('reads a group sent SIGKILL as still there while its leader is unreaped (macOS answers EPERM then), and as gone once it is reaped', async () => {
    // a leader in its own group with a member it started, as the stubborn plugin CLI stub's run (plugin-cli-script.js)
    const member = `require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000); process.stdout.write("up")'], { stdio: ['ignore', 'pipe', 'ignore'] }).stdout.once('data', () => process.stdout.write('ready')); setInterval(() => {}, 1000);`;
    const leader = spawn(process.execPath, ['-e', member], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const reaped = new Promise((resolve) => leader.once('exit', resolve));
    try {
      await new Promise((resolve) => leader.stdout!.once('data', resolve));
      const pgid = leader.pid!;
      expect(groupAlive(pgid)).toBe(true);
      process.kill(-pgid, 'SIGKILL');
      block(200);
      expect(probe(pgid), 'the dead, unreaped group: EPERM, not ESRCH').toBe('EPERM');
      expect(groupAlive(pgid), 'still there: its leader is unreaped').toBe(true);
      await reaped;
      await expect.poll(() => groupAlive(pgid), { timeout: 5_000 }).toBe(false);
    } finally {
      try {
        process.kill(-leader.pid!, 'SIGKILL');
      } catch {
        // gone already
      }
    }
  });
});
