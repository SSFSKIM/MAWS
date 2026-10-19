// The supervisor specs' process cleanup (E11 W-E; e2e/support/processes.ts): every recorded pid and every process naming
// the scratch root is killed, a reused pid never is, and a process that outlives the kill is reported. Runs real `sleep`
// children whose command lines name a scratch root, and never touches a process it did not start.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isAlive, killScratchProcesses, processesNaming, shellsUnder, untilExited } from '../../e2e/support/processes';

const roots: string[] = [];
const children: ChildProcess[] = [];
const groups: number[] = []; // process groups a case started, killed whole so no grandchild outlives it
afterEach(() => {
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  for (const group of groups.splice(0)) {
    try {
      process.kill(-group, 'SIGKILL');
    } catch {
      // the group has gone
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// A process whose command line names `root`, as a supervisor's `--detached <dir>` does (an idle Node given the root as
// an argument), once it has started.
async function namedChild(root: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)', root], { stdio: 'ignore' });
  children.push(child);
  await new Promise<void>((resolve) => child.once('spawn', () => resolve()));
  return child;
}
const exited = (child: ChildProcess) => new Promise<void>((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve() : child.once('exit', () => resolve())));

describe('killScratchProcesses', () => {
  it('kills every process naming the root and every recorded pid still naming it, then finds none left', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maws-processes-'));
    roots.push(root);
    const named = await namedChild(root);
    const recorded = await namedChild(root);
    await killScratchProcesses(root, [recorded.pid!]);
    await Promise.all([exited(named), exited(recorded)]);
    expect([named.signalCode, recorded.signalCode]).toEqual(['SIGKILL', 'SIGKILL']);
    expect(processesNaming(root)).toEqual([]);
  });

  it('leaves a recorded pid alone once it no longer names the root (a reused pid)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maws-processes-'));
    const other = mkdtempSync(join(tmpdir(), 'maws-processes-other-'));
    roots.push(root, other);
    const stranger = await namedChild(other);
    await killScratchProcesses(root, [stranger.pid!]);
    expect(isAlive(stranger.pid!)).toBe(true);
  });

  it('reports a process naming the root that outlives the kill, by pid and command', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maws-processes-'));
    roots.push(root);
    const child = await namedChild(root);
    // a kill that cannot land (the survivor case): the process is shown to the check but never signalled
    await expect(killScratchProcesses(root, [], { timeoutMs: 300, kill: () => {} })).rejects.toThrow(new RegExp(`outlive.*${child.pid}`));
  });
});

// A Node process in its own process group whose children run `commands` (each through `/bin/sh -c`, or `sleep` alone for
// a non-shell child): the app's main process, its shells below it, as a launch's cleanup sees them.
async function parentOf(children: ({ shell: string } | { sleep: number })[], count: number): Promise<number> {
  const script = `const { spawn } = require('node:child_process');
for (const c of ${JSON.stringify(children)}) 'shell' in c ? spawn('/bin/sh', ['-c', c.shell], { stdio: 'ignore' }) : spawn('sleep', [String(c.sleep)], { stdio: 'ignore' });
setTimeout(() => {}, 60_000);`;
  const parent = spawn(process.execPath, ['-e', script], { stdio: 'ignore', detached: true });
  groups.push(parent.pid!);
  await expect.poll(() => shellsUnder(parent.pid!).length, { timeout: 5_000 }).toBe(count);
  return parent.pid!;
}

describe('shellsUnder and untilExited', () => {
  it('finds the shells below a process, not the process itself, its other children or the shells’ own children', async () => {
    const root = await parentOf([{ shell: 'sleep 30; :' }, { sleep: 30 }], 1);
    const [shell] = shellsUnder(root);
    expect(shell!.pid).not.toBe(root);
    expect(shell!.started).not.toBe('');
  });

  it('waits for a shell to exit, signalling nothing', async () => {
    const root = await parentOf([{ shell: 'sleep 1; :' }], 1);
    const shells = shellsUnder(root);
    const started = Date.now();
    expect(await untilExited(shells, 10_000)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('answers a shell still running at the deadline and leaves it running', async () => {
    const root = await parentOf([{ shell: 'sleep 30; :' }], 1);
    const shells = shellsUnder(root);
    expect(await untilExited(shells, 300)).toEqual(shells);
    expect(isAlive(shells[0]!.pid)).toBe(true);
  });

  it('does not wait for a pid that now names another process (a reused pid)', async () => {
    const root = await parentOf([{ shell: 'sleep 30; :' }], 1);
    const [shell] = shellsUnder(root);
    expect(await untilExited([{ pid: shell!.pid, started: 'Thu Jan  1 00:00:00 1970' }], 10_000)).toEqual([]);
  });
});
