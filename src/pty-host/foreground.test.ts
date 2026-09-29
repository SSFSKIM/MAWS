import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { foregroundOf, runProbe, type ProbeRunner } from './foreground';

// An idle macOS `/bin/sh`: node-pty names it "bash", since `/bin/sh` re-executes bash.
const IDLE_SH = { pid: 4242, shell: '/bin/sh', process: 'bash' };

function runner(answers: { ps?: { code: number; stdout: string } | null; pgrep?: { code: number; stdout: string } | null }): ProbeRunner {
  return async (file) => (file === '/bin/ps' ? (answers.ps ?? null) : file === '/usr/bin/pgrep' ? (answers.pgrep ?? null) : null);
}

describe('foreground detection', () => {
  it('decides by the terminal’s foreground group when ps answers', async () => {
    await expect(foregroundOf(IDLE_SH, runner({ ps: { code: 0, stdout: ' 4242\n' } }))).resolves.toEqual({ process: 'bash', busy: false });
    await expect(foregroundOf({ ...IDLE_SH, process: 'sleep' }, runner({ ps: { code: 0, stdout: '4300\n' } }))).resolves.toEqual({ process: 'sleep', busy: true });
  });

  it('reads an idle /bin/sh as idle when ps fails and the shell has no children', async () => {
    await expect(foregroundOf(IDLE_SH, runner({ ps: null, pgrep: { code: 1, stdout: '' } }))).resolves.toEqual({ process: 'bash', busy: false });
    await expect(foregroundOf({ ...IDLE_SH, process: '-zsh' }, runner({ ps: null, pgrep: { code: 1, stdout: '' } }))).resolves.toMatchObject({ busy: false });
  });

  it('asks when ps fails and a childless pid is a program exec’d in the shell’s place', async () => {
    await expect(foregroundOf({ ...IDLE_SH, process: 'vim' }, runner({ ps: null, pgrep: { code: 1, stdout: '' } }))).resolves.toEqual({ process: 'vim', busy: true });
  });

  it('falls back to the name rule, erring toward asking, when the shell has children or both probes fail', async () => {
    await expect(foregroundOf(IDLE_SH, runner({ ps: null, pgrep: { code: 0, stdout: '4300\n' } }))).resolves.toMatchObject({ busy: true });
    await expect(foregroundOf(IDLE_SH, runner({ ps: null, pgrep: null }))).resolves.toMatchObject({ busy: true });
    await expect(foregroundOf(IDLE_SH, runner({ ps: null, pgrep: { code: 3, stdout: '' } }))).resolves.toMatchObject({ busy: true });
    await expect(foregroundOf({ pid: 4242, shell: '/bin/zsh', process: 'zsh' }, runner({ ps: null, pgrep: null }))).resolves.toMatchObject({ busy: false });
  });

  describe('second probe against real processes', () => {
    const started: ChildProcess[] = [];
    afterEach(() => {
      for (const child of started.splice(0)) {
        spawnSync('/usr/bin/pkill', ['-KILL', '-P', String(child.pid)]); // the shell's own children, which would outlive it
        child.kill('SIGKILL');
      }
    });
    const start = async (args: string[]) => {
      const child = spawn('/bin/sh', args, { stdio: ['pipe', 'ignore', 'ignore'] });
      started.push(child);
      await new Promise((resolve) => child.once('spawn', resolve));
      return child.pid!;
    };
    const psFails: ProbeRunner = (file, args) => (file === '/bin/ps' ? Promise.resolve(null) : runProbe(file, args));

    it('answers idle for a childless shell, and the name rule for a program exec’d in its place or a shell running a child', async () => {
      const waiting = await start(['-c', 'read line']); // a builtin: the shell itself waits, with no child
      await expect(foregroundOf({ ...IDLE_SH, pid: waiting }, psFails)).resolves.toEqual({ process: 'bash', busy: false });
      const execd = await start(['-c', 'exec sleep 30']); // `exec vim file`: childless, but not a shell
      await expect(foregroundOf({ ...IDLE_SH, pid: execd, process: 'sleep' }, psFails)).resolves.toEqual({ process: 'sleep', busy: true });
      const parent = await start(['-c', 'sleep 30; :']);
      await expect.poll(async () => (await runProbe('/usr/bin/pgrep', ['-P', String(parent)]))?.code, { timeout: 5_000 }).toBe(0);
      await expect(foregroundOf({ ...IDLE_SH, pid: parent }, psFails)).resolves.toEqual({ process: 'bash', busy: true });
    });
  });
});
