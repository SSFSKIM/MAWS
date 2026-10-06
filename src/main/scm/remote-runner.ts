// The remote runner (E6 execution document, Design §4, §10; P-12): the one place MAWS starts `git push` and `gh`, under
// the owner's login-shell environment with their credential helpers (`childEnvironment(captured, 'remote')`), never
// through a shell, stdin closed (a helper that wants a tty fails fast instead of waiting), each child leading its own
// process group so a cancel or a timeout stops the helpers it started too.
//
// `RemoteRunner` runs a confirmed plan and streams what it prints as `scm.remote.output` chunks numbered from 1 per run
// (at most 16 KiB each; after 1 MiB in total one `truncated` chunk and nothing more but the exit), ends with an `exit`
// chunk, and keeps the checkout's latest run (plan, output, exit, the `seq` of its last chunk) for `scm.remote.last`:
// while it runs and for 10 minutes after. One run per checkout. It runs what it is given: the plan was built, shown and
// revalidated before (plans.ts, the service).
//
// `runCollected` is the same spawn for the short `gh` reads (`repo view`, `auth status`, `pr view`, …): both streams
// whole, the exit code, and a timeout or a failure to start answered as `failure` rather than thrown.
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type { AppSessionId } from '@shared/graph/ids';
import type { RemotePlan, ScmRemoteLast, ScmRemoteOutput, ScmRunStarted } from '@shared/ipc/schema/scm';
import { childEnvironment } from './remote-env';
import { refusal } from './validate';

export const REMOTE_TIMEOUT_MS = 120_000;
export const KILL_AFTER_MS = 2_000;
export const CHUNK_BYTES = 16 * 1024;
export const OUTPUT_CAP_BYTES = 1024 * 1024; // per run, both streams together
export const LATEST_RUN_KEPT_MS = 10 * 60_000; // after the run ends

export interface RemoteSpawnOptions {
  cwd: string;
  env: Record<string, string>;
  detached: true;
  stdio: ['ignore', 'pipe', 'pipe'];
}
export type SpawnFn = (program: string, argv: readonly string[], options: RemoteSpawnOptions) => ChildProcess;
export type KillFn = (pid: number, signal: NodeJS.Signals) => void;

// The child's whole process group; a group already gone is not an error.
const killGroup: KillFn = (pid, signal) => {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
};

const spawnOptions = (cwd: string, captured: Record<string, string>): RemoteSpawnOptions => ({
  cwd, env: childEnvironment(captured, 'remote'), detached: true, stdio: ['ignore', 'pipe', 'pipe'],
});

export interface RemoteRunnerDeps {
  emit(event: ScmRemoteOutput): void;
  spawn?: SpawnFn;
  kill?: KillFn;
  now?: () => number;
  onExit?(key: string): void; // a run of the checkout ended (the PR state cache is dropped)
}

export interface RemoteRunStart {
  appSessionId: AppSessionId;
  key: string; // the checkout's realpath: one run at a time per key
  plan: RemotePlan;
  captured: Record<string, string>; // the login-shell capture
}

interface Run {
  appSessionId: AppSessionId;
  plan: RemotePlan;
  child: ChildProcess;
  running: boolean;
  exitCode: number | null;
  signal: string | null;
  output: string;
  bytes: number;
  truncated: boolean;
  seq: number;
  startedAt: number;
  endedAt: number | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export class RemoteRunner {
  private readonly runs = new Map<string, Run>();
  private readonly spawn: SpawnFn;
  private readonly kill: KillFn;
  private readonly now: () => number;
  private disposed = false;

  constructor(private readonly deps: RemoteRunnerDeps) {
    this.spawn = deps.spawn ?? (nodeSpawn as SpawnFn);
    this.kill = deps.kill ?? killGroup;
    this.now = deps.now ?? Date.now;
  }

  isRunning(key: string): boolean {
    return this.runs.get(key)?.running === true;
  }

  start({ appSessionId, key, plan, captured }: RemoteRunStart): ScmRunStarted {
    if (this.isRunning(key)) return refusal('busy', 'A push or pull request is already running for this checkout; wait for it or cancel it');
    const child = this.spawn(plan.program, plan.argv, spawnOptions(plan.cwd, captured));
    const run: Run = {
      appSessionId, plan, child, running: true, exitCode: null, signal: null, output: '', bytes: 0, truncated: false, seq: 0,
      startedAt: this.now(), endedAt: null, timer: null,
    };
    this.runs.set(key, run);
    run.timer = setTimeout(() => {
      this.note(run, 'stderr', `MAWS: timed out after ${REMOTE_TIMEOUT_MS / 1000} s; stopping it\n`);
      this.stop(run);
    }, REMOTE_TIMEOUT_MS);
    for (const kind of ['stdout', 'stderr'] as const) {
      const decoder = new StringDecoder('utf8');
      child[kind]?.on('data', (data: Buffer) => this.output(run, kind, decoder.write(data)));
    }
    child.on('error', (error: Error) => {
      if (!run.running) return;
      this.note(run, 'stderr', `could not start ${plan.program}: ${error.message}\n`);
      this.end(key, run, null, null);
    });
    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (run.running) this.end(key, run, code, signal);
    });
    return { started: true, token: plan.token };
  }

  // SIGTERM to the run's group, SIGKILL 2 s later; only the checkout's running run of that token.
  cancel(key: string, token: string): void {
    const run = this.runs.get(key);
    if (run?.running === true && run.plan.token === token) this.stop(run);
  }

  last(key: string): ScmRemoteLast {
    const run = this.runs.get(key);
    if (run === undefined) return null;
    if (run.endedAt !== null && this.now() - run.endedAt > LATEST_RUN_KEPT_MS) {
      this.runs.delete(key);
      return null;
    }
    return {
      token: run.plan.token, kind: run.plan.kind, plan: run.plan, running: run.running, exitCode: run.exitCode, signal: run.signal,
      output: run.output, truncated: run.truncated, seq: run.seq, startedAt: new Date(run.startedAt).toISOString(),
    };
  }

  // The app is quitting: every running group is asked to stop (git removes its lock files on SIGTERM), nothing more
  // is emitted, no latest run is kept.
  dispose(): void {
    this.disposed = true;
    for (const run of this.runs.values()) {
      if (!run.running) continue;
      if (run.timer !== null) clearTimeout(run.timer);
      run.running = false;
      if (run.child.pid !== undefined) this.kill(run.child.pid, 'SIGTERM');
    }
    this.runs.clear();
  }

  private stop(run: Run): void {
    const pid = run.child.pid;
    if (pid === undefined) return;
    this.kill(pid, 'SIGTERM');
    // Not cancelled when the child closes: a helper may have closed its pipes and outlived git.
    setTimeout(() => this.kill(pid, 'SIGKILL'), KILL_AFTER_MS);
  }

  private end(key: string, run: Run, exitCode: number | null, signal: string | null): void {
    if (run.timer !== null) clearTimeout(run.timer);
    run.running = false;
    run.exitCode = exitCode;
    run.signal = signal;
    run.endedAt = this.now();
    this.publish(run, { kind: 'exit', exitCode, signal });
    if (!this.disposed) this.deps.onExit?.(key);
  }

  // The program's own words: split at 16 KiB, counted against the run's 1 MiB, cut at the cap with one notice.
  private output(run: Run, kind: 'stdout' | 'stderr', text: string): void {
    if (!run.running || run.truncated || text === '') return;
    const room = OUTPUT_CAP_BYTES - run.bytes;
    const kept = utf8Prefix(text, room);
    for (const piece of utf8Pieces(kept, CHUNK_BYTES)) this.note(run, kind, piece);
    run.bytes += Buffer.byteLength(kept);
    if (kept.length < text.length) {
      run.truncated = true;
      this.publish(run, { kind, truncated: true });
    }
  }

  private note(run: Run, kind: 'stdout' | 'stderr', text: string): void {
    run.output += text;
    this.publish(run, { kind, text });
  }

  private publish(run: Run, chunk: Omit<ScmRemoteOutput, 'appSessionId' | 'token' | 'seq'>): void {
    if (this.disposed) return;
    run.seq += 1;
    this.deps.emit({ appSessionId: run.appSessionId, token: run.plan.token, seq: run.seq, ...chunk });
  }
}

export interface CollectedRun {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  failure: string | null; // why there is no exit code: a timeout, or the program could not start
}

export interface CollectInput {
  program: string;
  argv: readonly string[];
  cwd: string;
  captured: Record<string, string>;
  timeoutMs: number;
  spawn?: SpawnFn;
  kill?: KillFn;
}

// A short remote-environment command, collected whole (each stream bounded to 1 MiB).
export function runCollected({ program, argv, cwd, captured, timeoutMs, spawn = nodeSpawn as SpawnFn, kill = killGroup }: CollectInput): Promise<CollectedRun> {
  return new Promise((resolve) => {
    const child = spawn(program, argv, spawnOptions(cwd, captured));
    const streams = { stdout: '', stderr: '' };
    let failure: string | null = null;
    let settled = false;
    const timer = setTimeout(() => {
      failure = `timed out after ${timeoutMs / 1000} s`;
      const pid = child.pid;
      if (pid === undefined) return;
      kill(pid, 'SIGTERM');
      setTimeout(() => kill(pid, 'SIGKILL'), KILL_AFTER_MS);
    }, timeoutMs);
    const settle = (exitCode: number | null, signal: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, signal, ...streams, failure });
    };
    for (const kind of ['stdout', 'stderr'] as const) {
      const decoder = new StringDecoder('utf8');
      child[kind]?.on('data', (data: Buffer) => {
        streams[kind] += utf8Prefix(decoder.write(data), OUTPUT_CAP_BYTES - Buffer.byteLength(streams[kind]));
      });
    }
    child.on('error', (error: Error) => {
      failure = `could not start ${program}: ${error.message}`;
      settle(null, null);
    });
    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => settle(failure === null ? code : null, signal));
  });
}

// The longest prefix of `text` within `bytes` UTF-8 bytes, never ending inside a character.
function utf8Prefix(text: string, bytes: number): string {
  if (bytes <= 0) return '';
  if (Buffer.byteLength(text) <= bytes) return text;
  let used = 0;
  let end = 0;
  for (const char of text) {
    used += Buffer.byteLength(char);
    if (used > bytes) break;
    end += char.length;
  }
  return text.slice(0, end);
}

// `text` in pieces of at most `bytes` UTF-8 bytes each, whole characters only.
function utf8Pieces(text: string, bytes: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest !== '') {
    const piece = utf8Prefix(rest, bytes);
    pieces.push(piece);
    rest = rest.slice(piece.length);
  }
  return pieces;
}
