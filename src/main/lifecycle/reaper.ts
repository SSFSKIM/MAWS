// The quit's last resort (tracker 2026-11-06, "the quit guard's 1 mid-turn, not asked"; PR #500's named wait). After
// MAWS's own shutdown, Chromium's teardown waits for every task marked to block shutdown, and on a Mac whose cores are
// saturated (an agent's build) one of them can sit on a background-QoS worker the kernel never schedules: the windows are
// gone, the process stays until the load drops, and a relaunch meanwhile hands off to a process with no windows.
//
// So at Electron's `quit` main spawns a detached `/bin/sh` that sleeps REAP_AFTER_S and then SIGKILLs main, only if
// main is still the shell's parent:
// once main has exited the shell is reparented, so a pid the system has reused is never signalled. Main's own Chromium
// helpers go with it, each a child of main whose executable is a `*Helper*` in the bundle's Frameworks: a helper main's
// teardown had not yet ended is left orphaned by the kill and, starved the same way, lives on for minutes holding its
// launcher's stdio (probe run 42184947993: one per reaped quit, still alive 25 s later). Nothing else is
// signalled, and never a process group: `mawsd` and the engine hosts outlive the app by design. A quit that ends on its
// own leaves the shell to sleep out and exit with nothing to do. The shell closes the descriptors above stderr it may have
// inherited, so it holds no launcher's pipe while it sleeps. (Electron's `app.relaunch()` would start its relauncher as
// such a helper; MAWS never calls it, and a change that does must spare that helper here.)
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

// Electron's `quit` to the exit, over MAWS's e2e quits on GitHub's hosted Macs (3 cores): with one core busy (about half),
// p50 151 ms, p90 240, p99 530, max 1214 over 78 quits (probe run 42180403479); with two busy, 64 of 78 under 0.7 s, 10
// from 0.9 to 4.4 s and 4 stalled 25 to 33 s, the stall itself (42182017028); with all three busy every quit stalls
// past 60 s (42182048773). 5 s is about ten times the half-load p99 and four times its slowest.
export const REAP_AFTER_S = 5;

// The shell's script: `$1` the pid to end, `$2` the seconds to wait. `read` strips `ps`'s ppid padding and keeps the path's
// spaces in its last variable; `comm` is the executable's path on macOS (an `argv0` such as mawsd's where one was given).
// Each helper's parent is checked with its path, and the shell's own parent again just before main is signalled.
export const REAPER_SCRIPT = [
  'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-',
  'sleep "$2"',
  '[ "$(/bin/ps -o ppid= -p $$ | tr -d \' \')" = "$1" ] || exit 1',
  'for child in $(/usr/bin/pgrep -P "$1"); do',
  '  /bin/ps -o ppid=,comm= -p "$child" | while read -r parent executable; do',
  '    [ "$parent" = "$1" ] || continue',
  '    case "$executable" in */Contents/Frameworks/*Helper*) kill -9 "$child" ;; esac',
  '  done',
  'done',
  '[ "$(/bin/ps -o ppid= -p $$ | tr -d \' \')" = "$1" ] || exit 1',
  'kill -9 "$1"',
].join('\n');

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
