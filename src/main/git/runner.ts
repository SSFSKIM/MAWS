// Git runs with a constructed environment, bounded output and a process-group timeout. Command selection belongs
// to the services; executable configuration and cancellation policy belong here (charter §4.5). Three modes (E6
// execution document, Design §2): `read` (C4's reads: no hooks, no fsmonitor), `checkout` (C10's `worktree add`, whose
// checkout hooks and filters run) and `mutate` (E6's local mutations under the owner's login-shell environment, hooks
// running as in a terminal); transport and credential helpers are off in all three.
import { spawn, type ChildProcess, type ExecFileException } from 'node:child_process';
import { childEnvironment } from '../scm/remote-env';

export const GIT_TIMEOUT_MS = 10_000;
const KILL_GRACE_MS = 500;
const MAX_BUFFER = 64 * 1024 * 1024;
export const STREAM_BOUND_BYTES = 256 * 1024; // what a failure (and a mutation's answer) keeps of each stream: its end

export interface GitExecOptions {
  env: NodeJS.ProcessEnv;
  detached: true;
  maxBuffer: number;
  encoding: 'utf8';
}
// The shape of `child_process.execFile` the runner calls; tests pass a spy or a stand-in.
export type ExecFileFn = (
  file: string,
  args: string[],
  options: GitExecOptions,
  callback: (error: ExecFileException | null, stdout: string, stderr: string) => void,
) => ChildProcess | void;

export type GitMode = 'read' | 'checkout' | 'mutate';
export interface GitRunOptions {
  timeoutMs?: number; // GIT_TIMEOUT_MS by default
  acceptExitCodes?: readonly number[]; // exit codes that resolve rather than throw (`diff --no-index` exits 1 for a difference)
}
export type GitRun = (directory: string, args: string[], options?: GitRunOptions) => Promise<string>;

// A call killed at its timeout. The router answers it as `timeout`, and the watcher backs off on it.
export class GitTimeoutError extends Error {}
// The directory is not inside a work tree.
export class NotARepositoryError extends Error {
  constructor() {
    super('not a git repository');
  }
}
// Git ran and exited non-zero (a bad revision, a repository with no commit for `diff HEAD`, a hook that refused); the
// message is stderr's first line. Both streams are kept, each its last STREAM_BOUND_BYTES, so a hook's words are there
// whichever stream it wrote to; `exitCode` is null when git ended on a signal.
export class GitCommandError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    readonly exitCode: number | null,
    readonly stdout: string,
  ) {
    super(message);
  }
}

export function gitBinary(env: NodeJS.ProcessEnv): string {
  return env.MAWS_GIT || '/usr/bin/git';
}

// Command-scope config outranks repository/global config without trusting any caller-supplied GIT_* variables.
// Reads cannot run fsmonitor or hooks. Diff's --no-ext-diff/--no-textconv additionally disable named diff drivers.
// Pagers and transport executables are disabled for every invocation: MAWS never fetches, pushes or authenticates here.
// GIT_ALLOW_PROTOCOL (empty allowlist) wins even over protocol.<name>.allow=always, including lazy object fetches.
// Reset safe.directory's allowlist, not the ownership check: opening a repo is not permission to trust another owner.
// `read` and `checkout` keep only PATH and HOME of `env`; `mutate` starts from `base`, the captured login-shell
// environment (`env` when none is given), without any inherited GIT_* (`childEnvironment`), so hooks find the owner's
// tools and signing finds its agent, and a commit message given with `-m` never opens an editor.
export function gitEnv(env: NodeJS.ProcessEnv, mode: GitMode = 'read', base?: Record<string, string>): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  if (mode === 'mutate') Object.assign(out, childEnvironment(base ?? env, 'mutate'));
  else {
    if (env.PATH !== undefined) out.PATH = env.PATH;
    if (env.HOME !== undefined) out.HOME = env.HOME;
  }
  const config = [
    ['core.fsmonitor', 'false'],
    ['credential.helper', ''],
    ['log.showSignature', 'false'], // stash list uses log; signature verification would spawn gpg/ssh-keygen
    ['safe.directory', ''],
    ...(mode === 'read' ? [['core.hooksPath', '/dev/null']] : []),
  ];
  config.forEach(([key, value], i) => {
    out[`GIT_CONFIG_KEY_${i}`] = key;
    out[`GIT_CONFIG_VALUE_${i}`] = value;
  });
  return {
    ...out, GIT_CONFIG_COUNT: String(config.length), GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C',
    GIT_PAGER: 'cat', GIT_EXTERNAL_DIFF: '/usr/bin/false', GIT_SSH_COMMAND: '/usr/bin/false', GIT_ALLOW_PROTOCOL: '',
    ...(mode === 'mutate' ? { GIT_EDITOR: 'true' } : {}),
  };
}

export interface SpawnGitInput {
  binary: string;
  directory: string; // passed as `-C`
  args: string[];
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  acceptExitCodes: readonly number[];
  execFile: ExecFileFn;
}

// The spawn core every git call shares: `-C <directory>`, a new process group, the timeout (SIGTERM to the group, then
// SIGKILL), and the exit code. Exit 0 and any accepted code resolve with both streams whole; any other end throws
// (`GitTimeoutError`, a plain `Error` when git cannot start or overflows, else `GitCommandError` with both streams).
export function spawnGit({ binary, directory, args, env, timeoutMs, acceptExitCodes, execFile }: SpawnGitInput): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const execOptions: GitExecOptions = { env, detached: true, maxBuffer: MAX_BUFFER, encoding: 'utf8' };
    const timedOutError = () => new GitTimeoutError(`git ${args[0]} timed out after ${timeoutMs / 1000} s in ${directory}`);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { signalGroup(child, 'SIGTERM'); } catch (error) { reject(error); }
      // Do not cancel this when Git exits: a hook may have closed its pipes and outlived its parent.
      setTimeout(() => {
        try {
          signalGroup(child, 'SIGKILL');
          reject(timedOutError());
        } catch (error) { reject(error); }
      }, KILL_GRACE_MS);
    }, timeoutMs);
    const child = execFile(binary, ['-C', directory, ...args], execOptions, (error, stdout, stderr) => {
      clearTimeout(timer);
      if (timedOut) return; // recovery may start only after the whole group has received SIGKILL
      if (!error) resolve({ stdout, stderr, exitCode: 0 });
      else if (typeof error.code === 'number' && acceptExitCodes.includes(error.code)) resolve({ stdout, stderr, exitCode: error.code });
      else if (error.killed && error.signal) reject(timedOutError());
      else reject(failure(error, stdout, stderr, binary, args[0]));
    });
  });
}

// The read and checkout runner: stdout of each call. A failure saying "not a git repository" is NotARepositoryError
// (a mutation's hook saying so stays the GitCommandError it is: only reads ask what the directory is).
export function createGitRunner(options: { env?: NodeJS.ProcessEnv; execFile?: ExecFileFn } = {}): GitRun {
  const env = options.env ?? process.env;
  const binary = gitBinary(env);
  const execFile = options.execFile ?? execGit;
  return async (directory, args, { timeoutMs = GIT_TIMEOUT_MS, acceptExitCodes = [] } = {}) => {
    // Only trusted worktree creation runs checkout hooks/filters. Read callers never acquire that privilege.
    const mode = args[0] === 'worktree' && args[1] === 'add' ? 'checkout' : 'read';
    try {
      return (await spawnGit({ binary, directory, args, env: gitEnv(env, mode), timeoutMs, acceptExitCodes, execFile })).stdout;
    } catch (error) {
      if (error instanceof GitCommandError && /not a git repository/.test(error.stderr)) throw new NotARepositoryError();
      throw error;
    }
  };
}

// execFile does not forward `detached` to spawn. Use spawn directly so Git really leads a new process group.
export const execGit: ExecFileFn = (file, args, options, callback) => {
  const child = spawn(file, args, { env: options.env, detached: options.detached, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let outBytes = 0;
  let errBytes = 0;
  let failure: ExecFileException | null = null;
  const collect = (chunks: Buffer[], chunk: Buffer, bytes: number) => {
    if (failure) return;
    if (bytes > options.maxBuffer) {
      failure = Object.assign(new Error('Git output exceeds buffer limit'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' });
      signalGroup(child, 'SIGKILL');
    } else chunks.push(chunk);
  };
  child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk, outBytes += chunk.length));
  child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk, errBytes += chunk.length));
  child.on('error', (error) => { failure = error; });
  child.on('close', (code, signal) => {
    if (!failure && (code !== 0 || signal !== null)) {
      failure = Object.assign(new Error(`Git exited with ${signal ?? code}`), { code: code ?? undefined, signal: signal ?? undefined });
    }
    callback(failure, Buffer.concat(stdout).toString(options.encoding), Buffer.concat(stderr).toString(options.encoding));
  });
  return child;
};

// The last `bytes` of a stream's text, cut at a character boundary.
export function streamTail(text: string, bytes = STREAM_BOUND_BYTES): string {
  if (text.length * 3 <= bytes) return text; // no UTF-16 unit takes more than three UTF-8 bytes
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= bytes) return text;
  let start = buffer.length - bytes;
  while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start++; // never begin inside a character
  return buffer.subarray(start).toString('utf8');
}

function signalGroup(child: ChildProcess | void, signal: NodeJS.Signals): void {
  if (child?.pid === undefined) return;
  try { process.kill(-child.pid, signal); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

function failure(error: ExecFileException, stdout: string, stderr: string, binary: string, subcommand: string): Error {
  if (error.code === 'ENOENT' || error.code === 'EACCES') return new Error(`git unavailable: ${binary}: ${error.code}`);
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return new Error(`git ${subcommand} output exceeds ${MAX_BUFFER / 1024 / 1024} MiB`);
  const first = stderr.split('\n').find((line) => line.trim() !== '')?.replace(/^(fatal|error): /, '') ?? error.message;
  const exitCode = typeof error.code === 'number' ? error.code : null;
  return new GitCommandError(`git ${subcommand} failed: ${first}`, streamTail(stderr), exitCode, streamTail(stdout));
}
