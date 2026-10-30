// A host process's end in a test's cleanup (test/support/host-exit.ts): only an already-gone process is let pass; one that
// outlives its grace is killed, waited for, and reported. Over real node children this test starts and ends.
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { isAlive } from '../../src/engine-host/supervisor-files';
import { endHostProcess } from './host-exit';

const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
});

// A node child, ready once it says so; `stubborn` ignores SIGTERM
async function child(stubborn: boolean): Promise<number> {
  const script = `${stubborn ? "process.on('SIGTERM', () => {});" : ''} setInterval(() => {}, 1000); process.stdout.write('ready');`;
  const started = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  children.push(started);
  await new Promise((ready) => started.stdout!.once('data', ready));
  return started.pid!;
}

it('ends a host that exits on SIGTERM, and lets one already gone pass', async () => {
  const pid = await child(false);
  await endHostProcess(pid);
  expect(isAlive(pid)).toBe(false);
  await expect(endHostProcess(pid)).resolves.toBeUndefined();
});

it('a host that outlives its grace is killed and waited for, and the timeout is reported', async () => {
  const pid = await child(true);
  await expect(endHostProcess(pid, 300)).rejects.toThrow(`no exit of ${pid} within 300 ms`);
  expect(isAlive(pid)).toBe(false);
});
