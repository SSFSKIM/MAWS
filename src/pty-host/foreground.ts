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

// Runs a probe program and answers its exit code and stdout, or null when it could not run (missing, timed out).
export type ProbeRunner = (file: string, args: string[]) => Promise<{ code: number; stdout: string } | null>;

// Any shell's name as node-pty reports it (a login shell's carries a leading dash): what an idle prompt is called.
const SHELL_NAME = /^-?(ba|z|da|k|tc|fi)?sh$/;

// Three readings, most exact first: the terminal's foreground group from `ps`; when `ps` fails, the shell's children
// from `pgrep` (a foreground job is always a descendant of the shell, so a shell with no children holds the terminal
// itself, unless it exec'd a program, which then owns the pid under its own name); when that fails too, the shell has
// children (a background job, a prompt's helper) or the childless pid runs something other than a shell, the name
// rule, which errs toward asking before close.
export async function foregroundOf(target: ForegroundTarget, run: ProbeRunner = runProbe): Promise<Foreground> {
  const process = target.process || null;
  const group = await foregroundGroup(target.pid, run);
  if (group !== null) return { process, busy: group !== target.pid };
  const shellNamed = process !== null && (process === basename(target.shell) || SHELL_NAME.test(process));
  if (shellNamed && (await hasChildren(target.pid, run)) === false) return { process, busy: false };
  return { process, busy: process !== null && process !== basename(target.shell) };
}

// The foreground process group of the shell's terminal (`ps`'s `tpgid`), or null when it cannot be read.
async function foregroundGroup(pid: number, run: ProbeRunner): Promise<number | null> {
  const result = await run('/bin/ps', ['-o', 'tpgid=', '-p', String(pid)]);
  if (!result || result.code !== 0) return null;
  const group = Number.parseInt(result.stdout.trim(), 10);
  return Number.isInteger(group) && group > 0 ? group : null;
}

// Whether the shell has child processes (`pgrep -P`: exit 0 some, exit 1 none), or null when that cannot be read.
async function hasChildren(pid: number, run: ProbeRunner): Promise<boolean | null> {
  const result = await run('/usr/bin/pgrep', ['-P', String(pid)]);
  if (!result) return null;
  return result.code === 0 ? true : result.code === 1 ? false : null;
}

export function runProbe(file: string, args: string[]): ReturnType<ProbeRunner> {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: 'utf8', timeout: 2_000 }, (error, stdout) => {
      if (!error) return resolve({ code: 0, stdout });
      const code = (error as { code?: unknown }).code;
      // a timeout kills the probe (`killed`), and a probe that never started reports a string code such as ENOENT
      resolve(typeof code === 'number' && !error.killed ? { code, stdout } : null);
    });
  });
}
