// Whether a program other than the shell holds the terminal (C9 Residue *Lifecycle and close*: closing a busy
// terminal asks first). The name is node-pty's `process` (the foreground process's name on macOS). Busy is decided
// by process group, not by comparing that name with the shell's: macOS's `/bin/sh` re-executes bash, so node-pty
// names an idle `sh` prompt "bash". The shell leads its own process group (node-pty starts it in a new session), so
// the terminal is busy exactly when its foreground process group is not the shell's pid.
import { execFile } from 'node:child_process';
import { basename } from 'node:path';

export interface ForegroundTarget {
  pid: number; // the shell's pid
  shell: string;
  process: string; // node-pty's foreground process name
}

export interface Foreground {
  process: string | null;
  busy: boolean;
}

export async function foregroundOf(target: ForegroundTarget): Promise<Foreground> {
  const process = target.process || null;
  const group = await foregroundGroup(target.pid);
  const busy = group === null ? process !== null && process !== basename(target.shell) : group !== target.pid;
  return { process, busy };
}

// The foreground process group of the shell's terminal (`ps`'s `tpgid`), or null when it cannot be read.
function foregroundGroup(pid: number): Promise<number | null> {
  return new Promise((resolve) => {
    execFile('/bin/ps', ['-o', 'tpgid=', '-p', String(pid)], { encoding: 'utf8', timeout: 2_000 }, (error, stdout) => {
      const group = Number.parseInt(stdout.trim(), 10);
      resolve(error || !Number.isInteger(group) || group <= 0 ? null : group);
    });
  });
}
