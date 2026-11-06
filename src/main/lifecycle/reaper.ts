// The quit's last resort (tracker 2026-11-06, "the quit guard's 1 mid-turn, not asked"; PR #500's named wait). After
// MAWS's own shutdown, Chromium's teardown waits for every task marked to block shutdown, and on a Mac whose cores are
// saturated (an agent's build) one of them can sit on a background-QoS worker the kernel never schedules: the windows are
// gone, the process stays until the load drops, and a relaunch meanwhile hands off to a process with no windows.
//
// So at Electron's `quit` (after the shutdown list's steps have settled, on its held path and its unheld one) main
// spawns a detached `/bin/sh` that sleeps REAP_AFTER_S and then SIGKILLs main, only if main is still the shell's parent:
// once main has exited the shell is reparented, so a pid the system has reused is never signalled. It kills that one
// pid, never a process group: `mawsd` and the engine hosts outlive the app by design. A quit that ends on its own leaves
// the shell to sleep out and exit with nothing to do.
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

// Electron's `quit` to the exit, over MAWS's e2e quits on GitHub's hosted Macs (3 cores): with one core busy (about half),
// p50 151 ms, p90 240, p99 530, max 1214 over 78 quits (probe run 42180403479); with two busy, 64 of 78 under 0.7 s, 10
// from 0.9 to 4.4 s and 4 stalled 25 to 33 s, the stall itself (42182017028); with all three busy every quit stalls
// past 60 s (42182048773). 5 s is about ten times the half-load p99 and four times its slowest.
export const REAP_AFTER_S = 5;

// The shell's script: `$1` the pid to end, `$2` the seconds to wait. `ps -o ppid=` pads with spaces.
export const REAPER_SCRIPT = 'sleep "$2"; [ "$(/bin/ps -o ppid= -p $$ | tr -d \' \')" = "$1" ] && kill -9 "$1"';

type Spawn = (command: string, args: readonly string[], options: SpawnOptions) => Pick<ChildProcess, 'on' | 'unref'>;

export function startReaper(pid: number = process.pid, afterSeconds: number = REAP_AFTER_S, spawn: Spawn = nodeSpawn): void {
  if (process.platform === 'win32') return;
  try {
    const shell = spawn('/bin/sh', ['-c', REAPER_SCRIPT, 'maws-reaper', String(pid), String(afterSeconds)], { detached: true, stdio: 'ignore' });
    shell.on('error', () => {}); // a reaper that cannot start leaves the exit as it was
    shell.unref();
  } catch {
    // as above
  }
}
