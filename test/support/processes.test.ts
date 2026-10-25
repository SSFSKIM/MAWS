// The supervisor specs' process cleanup (E11 W-E; e2e/support/processes.ts): every recorded pid and every process naming
// the scratch root is killed, a reused pid never is, and a process that outlives the kill is reported. Runs real `sleep`
// children whose command lines name a scratch root, and never touches a process it did not start.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAlive, killScratchProcesses, processesNaming, ps, shellsUnder, untilExited, type ProcessIdentity } from '../../e2e/support/processes';

// Only the PID-reuse case replaces an OS reading; the other cases delegate every command to the real OS.
vi.mock('node:child_process', async (original) => ({ ...await original<typeof import('node:child_process')>(), execFileSync: vi.fn((await original<typeof import('node:child_process')>()).execFileSync) }));
vi.mock('node:fs', async (original) => ({ ...await original<typeof import('node:fs')>(), readlinkSync: vi.fn((await original<typeof import('node:fs')>()).readlinkSync) }));

const roots: string[] = [];
const children: ChildProcess[] = [];
const groups: number[] = []; // process groups a case started, killed whole so no grandchild outlives it
afterEach(async () => {
  vi.mocked(execFileSync).mockReset();
  vi.mocked(readlinkSync).mockReset();
  const started = children.splice(0);
  for (const child of started) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await Promise.all(started.map(exited));
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

// The signal sender is synchronous: let the other process finish its side of the race before it returns.
function waitSynchronously(check: () => boolean): void {
  const deadline = Date.now() + 3_000;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('subprocess did not reach the cleanup race checkpoint');
    Atomics.wait(pause, 0, 0, 10);
  }
}

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

  it('kills a scratch writer whose cwd, but not command line, names the root; leaves a neighbouring cwd alone', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-processes-')));
    const other = `${root}-other`;
    // The engine's process title carries no scratch path; its cwd still identifies the scene it can write into.
    const script = `process.title = 'maws-scratch-writer'; const fs = require('node:fs'); fs.writeFileSync('ready', ''); setInterval(() => fs.writeFileSync('writing', ''), 10);`;
    roots.push(root, other);
    mkdirSync(other);
    const writer = spawn(process.execPath, ['-e', script], { cwd: root, stdio: 'ignore' });
    const neighbour = spawn(process.execPath, ['-e', script], { cwd: other, stdio: 'ignore' });
    children.push(writer, neighbour);
    await expect.poll(() => existsSync(join(root, 'ready')) && existsSync(join(other, 'ready'))).toBe(true);
    expect(processesNaming(root)).toEqual([]);
    await killScratchProcesses(root, []);
    await expect.poll(() => writer.signalCode, { timeout: 1_000 }).toBe('SIGKILL');
    expect(isAlive(neighbour.pid!)).toBe(true);
  });

  it('sweeps again after the tracked parent exits, catching a cwd-only child spawned after discovery', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-processes-')));
    roots.push(root);
    const writerScript = `process.title = 'maws-late-scratch-writer'; const fs = require('node:fs'); fs.writeFileSync('writer-ready', String(process.pid)); setInterval(() => fs.writeFileSync('writing', ''), 10);`;
    const parentScript = `const { spawn } = require('node:child_process'); const fs = require('node:fs');
process.once('SIGUSR2', () => spawn(process.execPath, ['-e', ${JSON.stringify(writerScript)}], { stdio: 'ignore' }));
fs.writeFileSync('parent-ready', ''); setInterval(() => {}, 1_000);`;
    const parent = spawn(process.execPath, ['-e', parentScript, root], { cwd: root, stdio: 'ignore', detached: true });
    children.push(parent);
    groups.push(parent.pid!);
    await expect.poll(() => existsSync(join(root, 'parent-ready'))).toBe(true);
    let writer: ProcessIdentity | undefined;
    await killScratchProcesses(root, [], { kill: (pid) => {
      if (pid === parent.pid && !writer) {
        process.kill(pid, 'SIGUSR2');
        waitSynchronously(() => existsSync(join(root, 'writer-ready')) && /^\d+$/.test(readFileSync(join(root, 'writer-ready'), 'utf8')));
        const writerPid = Number(readFileSync(join(root, 'writer-ready'), 'utf8'));
        writer = { pid: writerPid, started: ps(writerPid, 'lstart') };
        expect(writer.started).not.toBe('');
        expect(processesNaming(root).some((p) => p.pid === writerPid)).toBe(false);
      }
      process.kill(pid, 'SIGKILL');
      // Force the original tracked identity to be gone before cleanup checks it, rather than winning by a slow exit.
      waitSynchronously(() => { const status = ps(pid, 'stat'); return status === '' || status.startsWith('Z'); });
    } });
    expect(writer).toBeDefined();
    expect(await untilExited([writer!], 1_000)).toEqual([]);
  });

  it('does not signal a cwd pid whose start identity changed after the pre-discovery snapshot', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-processes-')));
    const other = mkdtempSync(join(tmpdir(), 'maws-processes-other-'));
    roots.push(root, other);
    const child = spawn(process.execPath, ['-e', `process.title = 'maws-reused-cwd-pid'; require('node:fs').writeFileSync('ready', ''); setInterval(() => {}, 1_000);`], { cwd: other, stdio: 'ignore' });
    children.push(child);
    await expect.poll(() => existsSync(join(other, 'ready'))).toBe(true);
    // Real PID reuse cannot be forced safely. Cwd discovery reports stale ownership, then subsequent identity reads
    // see a replacement. Taking the identity snapshot after cwd discovery would therefore authorize the wrong kill.
    let reused = false;
    const nativeExec = vi.mocked(execFileSync).getMockImplementation()!;
    vi.mocked(execFileSync).mockImplementation((...args) => {
      const out = nativeExec(...args);
      if (args[0] === 'lsof' && args[1]?.includes('cwd')) {
        reused = true;
        return `${String(out)}\np${child.pid}\nn${root}\n`;
      }
      if (args[0] === 'ps' && reused) {
        if (args[1]?.includes('lstart=') && args[1].includes(String(child.pid))) return 'Thu Jan  1 00:00:00 1970';
        if (args[1]?.includes('pid=,lstart=,command=')) return String(out).replace(new RegExp(`^(\\s*${child.pid}\\s+)((?:\\S+\\s+){4}\\S+)(\\s+.*)$`, 'm'), '$1Thu Jan  1 00:00:00 1970$3');
      }
      return out;
    });
    const nativeReadlink = vi.mocked(readlinkSync).getMockImplementation()!;
    vi.mocked(readlinkSync).mockImplementation((...args) => {
      if (args[0] === `/proc/${child.pid}/cwd`) { reused = true; return root; }
      return nativeReadlink(...args);
    });
    const signalled: number[] = [];
    await killScratchProcesses(root, [child.pid!], { kill: (pid) => { signalled.push(pid); process.kill(pid, 'SIGKILL'); } });
    expect(reused).toBe(true);
    expect(signalled).not.toContain(child.pid);
    expect(isAlive(child.pid!)).toBe(true);
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
