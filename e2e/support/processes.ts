// The processes a supervisor spec's scratch profile starts (E11 W-E; the tracker's E10 row on the packaged spec's copied
// helpers): a supervisor's command line names the profile's root (`--detached <dir>`), so a case's cleanup kills every
// pid it recorded and every process naming the root, and then checks that none outlives it. Used by e2e/supervisor.spec.ts
// and e2e/supervisor-packaged.spec.ts; free of Playwright, so test/support/processes.test.ts runs it under vitest. The
// launch's own cleanup (launch.ts) waits here for the shells the app started before it removes their scratch home, and
// (P5 O3-B) ends what the daemon shape leaves running on the profile (endProfileProcesses).
import { execFileSync } from 'node:child_process';
import { existsSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { daemonPaths } from '../../src/shared/daemon/files';
import { socketPathFor } from '../../src/engine-host/supervisor-files';
import { ptyHostSocketPath } from '../../src/pty-host/files';

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// One `ps -o <field>=` of the process, or '' when there is no such process.
export function ps(pid: number, field: string): string {
  try {
    return execFileSync('ps', ['-o', `${field}=`, '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim();
  } catch {
    return ''; // no such process
  }
}

// Every process whose command line names `text` (a scratch root), but this one.
export function processesNaming(text: string): { pid: number; command: string }[] {
  const out = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  return out
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null && m[2]!.includes(text))
    .map((m) => ({ pid: Number(m[1]), command: m[2]! }))
    .filter((p) => p.pid !== process.pid);
}

// A process can use the scratch project as cwd without naming it in argv (notably an engine whose title is `claude`).
// The caller binds these bare pids to a pre-discovery identity snapshot and validates it before signalling.
// Resolve the root because macOS reports /private/var rather than /var; both native cwd readers preserve path spaces.
function processesWorkingIn(root: string, pids: Iterable<number>): number[] {
  const directory = realpathSync(root);
  const found: number[] = [];
  const record = (pid: number, cwd: string) => {
    if (pid !== process.pid && (cwd === directory || cwd.startsWith(`${directory}${sep}`))) found.push(pid);
  };
  if (process.platform === 'linux') {
    // /proc is native on the Linux unit pool; unlike macOS, that pool does not provide lsof.
    for (const pid of pids) {
      let cwd: string;
      try {
        cwd = readlinkSync(`/proc/${pid}/cwd`);
      } catch (error) {
        if (!['ENOENT', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        continue; // exited meanwhile, or another user's process
      }
      record(pid, cwd);
    }
    return found;
  }
  let out: string;
  try {
    out = execFileSync('lsof', ['-nP', '-d', 'cwd', '-Fpn'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const failed = error as { status?: number; stdout?: string };
    if (failed.status !== 1) throw error; // lsof exits 1 when nothing is open
    out = failed.stdout ?? '';
  }
  let pid = 0;
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    if (line.startsWith('n')) record(pid, line.slice(1));
  }
  return found;
}

// Kills each process owning the scratch root through argv or cwd, never a recorded pid that no longer owns it. Track
// start times through exit: losing its argv/cwd during shutdown does not mean a signalled process has finished writing.
// Re-scan before removing files, including processes that were still starting during the first scan. `kill` is the
// signal's sender (the survivor case's test passes one that sends nothing).
export async function killScratchProcesses(root: string, recorded: Iterable<number>, opts: { timeoutMs?: number; kill?: (pid: number) => void } = {}): Promise<void> {
  const kill = opts.kill ?? ((pid: number) => process.kill(pid, 'SIGKILL'));
  const tracked = new Map<number, ProcessIdentity & { command: string }>();
  const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
  for (;;) {
    const left = [...tracked.values()].filter(running);
    if (left.length > 0) {
      if (Date.now() > deadline) throw new Error(`processes of ${root} outlive the case: ${left.map((p) => `${p.pid} ${p.command}`).join('; ')}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }
    // Every tracked identity has exited before this snapshot, so children born during the previous kill are visible.
    // One snapshot captures identity and argv before cwd discovery.
    const snapshot = processSnapshot();
    const named = [...snapshot.values()].filter((p) => p.command.includes(root));
    const working = new Set(processesWorkingIn(root, snapshot.keys()));
    let signalled = false;
    for (const pid of new Set([...recorded, ...named.map((p) => p.pid), ...working])) {
      const identity = snapshot.get(pid);
      if (!identity || (!identity.command.includes(root) && !working.has(pid)) || !running(identity)) continue;
      tracked.set(pid, identity);
      signalled = true;
      try {
        kill(pid);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') console.error(error); // gone meanwhile is fine
      }
    }
    if (!signalled) return;
  }
}

// A process as one `ps` reading saw it: its pid and start time, so a pid the system later reuses is never taken for it.
export interface ProcessIdentity {
  pid: number;
  started: string; // `ps -o lstart=`
}

// Every process but this one, by pid, with its identity and command line, from one `ps` reading; C locale keeps lstart
// parseable and equal to ps().
function processSnapshot(): Map<number, ProcessIdentity & { command: string }> {
  const snapshot = new Map<number, ProcessIdentity & { command: string }>();
  for (const line of execFileSync('ps', ['-axo', 'pid=,lstart=,command='], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).split('\n')) {
    const m = /^\s*(\d+)\s+((?:\S+\s+){4}\S+)\s+(.*)$/.exec(line);
    if (m && Number(m[1]) !== process.pid) snapshot.set(Number(m[1]), { pid: Number(m[1]), started: m[2]!, command: m[3]! });
  }
  return snapshot;
}

// A shell's name as `ps` reports it (a login shell's carries a leading dash), by its last path component.
const SHELL_NAME = /^-?(ba|z|da|k|tc|c|fi)?sh$/;

// The shells among the descendants of `rootPids` (a terminal's login shell, a host's environment capture): what may still
// be saving its history into a launch's scratch shell home as it exits on its terminal's hang-up, after the app has
// closed. Their own children (a command a shell runs) are not shells and are not listed unless they are shells themselves.
// P5 O3-B: on the daemon shape a terminal's shell is the profile's pty host's, not the app's, so a launch names both.
export function shellsUnder(rootPids: number | readonly number[]): ProcessIdentity[] {
  const out = execFileSync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8' });
  const children = new Map<number, { pid: number; comm: string }[]>();
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const ppid = Number(m[2]);
    children.set(ppid, [...(children.get(ppid) ?? []), { pid: Number(m[1]), comm: m[3]!.trim() }]);
  }
  const shells: number[] = [];
  const queue = typeof rootPids === 'number' ? [rootPids] : [...rootPids];
  while (queue.length > 0) {
    for (const child of children.get(queue.pop()!) ?? []) {
      queue.push(child.pid);
      if (SHELL_NAME.test(basename(child.comm))) shells.push(child.pid);
    }
  }
  return shells.map((pid) => ({ pid, started: ps(pid, 'lstart') })).filter((p) => p.started !== '');
}

// Still the process `p` names, and not a zombie (one that has exited and writes nothing, its parent yet to reap it).
function running(p: ProcessIdentity): boolean {
  return ps(p.pid, 'lstart') === p.started && !ps(p.pid, 'stat').startsWith('Z');
}

// Waits up to `timeoutMs` for every one of `processes` to exit, signalling none: those still running at the deadline.
export async function untilExited(processes: readonly ProcessIdentity[], timeoutMs: number): Promise<ProcessIdentity[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const left = processes.filter(running);
    if (left.length === 0 || Date.now() >= deadline) return left;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// P5 O3-B (docs/doperpowers/plans/2026-10-28-p5-o3-spine.md, O3-B, acceptance 1): what a launch leaves on its profile
// once the app has gone. On the daemon shape the profile's private `mawsd`, its engine host and its pty host outlive the
// app, as the owner's do, each naming the profile in its command line (`--dir <profile>/mawsd`, `--detached <profile>/…`),
// with the engines they started. Each is killed, as the utility shape's hosts ended with the app, so a relaunch over the
// profile starts its own and nothing outlives the test; one that does is reported. Then the daemon shape's socket
// directories outside the profile, when its paths were too long for sun_path, each named for this profile alone.
export async function endProfileProcesses(userData: string, opts: { timeoutMs?: number; kill?: (pid: number) => void } = {}): Promise<void> {
  if (!existsSync(userData)) return;
  try {
    for (const root of profileRoots(userData)) await killScratchProcesses(root, [], opts);
  } finally {
    for (const dir of socketFallbacks(userData)) rmSync(dir, { recursive: true, force: true });
  }
}

// The same end, synchronous and best effort, for a process about to exit (a worker whose test never reached its
// launch's cleanup): every process naming a path under the profile is sent SIGKILL, and nothing is awaited. A pid whose
// start time has changed since the listing is another process now, and is left alone.
export function killProfileProcessesNow(userData: string): void {
  const roots = profileRoots(userData);
  for (const p of processSnapshot().values()) {
    if (!roots.some((root) => p.command.includes(root)) || ps(p.pid, 'lstart') !== p.started) continue;
    try {
      process.kill(p.pid, 'SIGKILL');
    } catch {
      // gone meanwhile
    }
  }
}

// P5 O3-B: the text a process names the profile by, in each spelling main may have been given: as given and resolved
// (macOS's /var and /tmp are /private/var and /private/tmp). The /private one is reduced to the shorter, which it
// contains, so that one matches both. Each ends in the separator: never a profile whose path this one prefixes.
function profileRoots(userData: string): string[] {
  const spellings = existsSync(userData) ? [userData, realpathSync(userData)] : [userData];
  const unaliased = (path: string) => (process.platform === 'darwin' ? path.replace(/^\/private(?=\/(?:var|tmp)\/)/, '') : path);
  return [...new Set(spellings.map((path) => unaliased(join(path, sep))))];
}

function socketFallbacks(userData: string): string[] {
  const daemon = daemonPaths(userData);
  const dirs = [daemon.socketDir, dirname(socketPathFor(join(userData, 'supervisor'), userData, tmpdir())), dirname(ptyHostSocketPath(daemon.ptyHost))];
  return dirs.filter((dir) => !`${dir}${sep}`.startsWith(join(userData, sep)));
}

// The TCP addresses the process listens on (`lsof`, which needs no privilege for one's own process), sorted; [] for none.
// The SIGUSR1 checks compare it before and after the signal: an inspector would add 127.0.0.1:9229.
export function tcpListeners(pid: number): string[] {
  try {
    const out = execFileSync('lsof', ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN', '-Fn'], { encoding: 'utf8' });
    return out.split('\n').filter((line) => line.startsWith('n')).map((line) => line.slice(1)).sort();
  } catch {
    return []; // lsof exits 1 when nothing matches
  }
}

// The pids listening on 127.0.0.1:9229, Node's default inspector address; [] for none. A SIGUSR1 check needs it free:
// an unprotected process whose inspector cannot bind prints "Starting inspector on 127.0.0.1:9229 failed" and adds no
// listener, which would pass for no inspector.
export function inspectorPortHolders(): number[] {
  try {
    return execFileSync('lsof', ['-nP', '-iTCP@127.0.0.1:9229', '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(Number);
  } catch {
    return []; // lsof exits 1 when nothing matches
  }
}

// An inspector's start or its failed start, in a process's output.
export const INSPECTOR_LINE = /Starting inspector|Debugger listening/;
