// The processes a supervisor spec's scratch profile starts (E11 W-E; the tracker's E10 row on the packaged spec's copied
// helpers): a supervisor's command line names the profile's root (`--detached <dir>`), so a case's cleanup kills every
// pid it recorded and every process naming the root, and then checks that none outlives it. Used by e2e/supervisor.spec.ts
// and e2e/supervisor-packaged.spec.ts; free of Playwright, so test/support/processes.test.ts runs it under vitest.
import { execFileSync } from 'node:child_process';

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
    return execFileSync('ps', ['-o', `${field}=`, '-p', String(pid)], { encoding: 'utf8' }).trim();
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

// Kills (SIGKILL) every `recorded` pid and every process naming `root`, a recorded pid only while it still names the root
// (never a reused pid), then waits up to `timeoutMs` for no process naming the root to be left: the survivor check. A
// survivor is thrown, by pid and command, after the wait; the caller removes its files first and rethrows. `kill` is the
// signal's sender (the survivor case's test passes one that sends nothing).
export async function killScratchProcesses(root: string, recorded: Iterable<number>, opts: { timeoutMs?: number; kill?: (pid: number) => void } = {}): Promise<void> {
  const kill = opts.kill ?? ((pid: number) => process.kill(pid, 'SIGKILL'));
  for (const pid of new Set([...recorded, ...processesNaming(root).map((p) => p.pid)])) {
    if (!isAlive(pid) || !ps(pid, 'command').includes(root)) continue;
    try {
      kill(pid);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') console.error(error); // gone meanwhile is fine
    }
  }
  const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
  for (;;) {
    const left = processesNaming(root);
    if (left.length === 0) return;
    if (Date.now() > deadline) throw new Error(`processes of ${root} outlive the case: ${left.map((p) => `${p.pid} ${p.command}`).join('; ')}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
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
