// A test's end of a host process it woke, which outlives the daemon as it does in the product and writes under the
// scratch profile until it is gone: asked to exit (SIGTERM) and waited for, before the profile is removed. Only an
// already-gone process is let pass; one still up after `graceMs` is killed (SIGKILL), waited for, and reported.
import { isAlive } from '../../src/engine-host/supervisor-files';

export async function endHostProcess(pid: number, graceMs = 10_000): Promise<void> {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return; // gone
    throw error;
  }
  if (await exited(pid, graceMs)) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  const killed = await exited(pid, 5_000);
  throw new Error(`no exit of ${pid} within ${graceMs} ms${killed ? ': killed' : ', nor after SIGKILL'}`);
}

async function exited(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (isAlive(pid)) {
    if (Date.now() > deadline) return false;
    await new Promise((done) => setTimeout(done, 50));
  }
  return true;
}
