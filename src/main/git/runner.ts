// Git runs with a constructed environment, bounded output and a process-group timeout. Command selection belongs
// to the services; executable configuration and cancellation policy belong here (charter §4.5).
import { spawn, type ChildProcess, type ExecFileException } from 'node:child_process';

export const GIT_TIMEOUT_MS = 10_000;
const KILL_GRACE_MS = 500;
const MAX_BUFFER = 64 * 1024 * 1024;

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

export type GitRun = (directory: string, args: string[]) => Promise<string>;

// A call killed at GIT_TIMEOUT_MS. The router answers it as `timeout`, and the watcher backs off on it.
export class GitTimeoutError extends Error {}
// The directory is not inside a work tree.
export class NotARepositoryError extends Error {
  constructor() {
    super('not a git repository');
  }
}
// Git ran and refused (a bad revision, a repository with no commit for `diff HEAD`); the message is git's first line.
export class GitCommandError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
  }
}

export function gitBinary(env: NodeJS.ProcessEnv): string {
  return env.MAWS_GIT || '/usr/bin/git';
}

// Command-scope config outranks repository/global config without trusting any caller-supplied GIT_* variables.
// Reads cannot run fsmonitor or hooks. Diff's --no-ext-diff/--no-textconv additionally disable named diff drivers.
// Pagers and transport executables are disabled for every invocation: MAWS never fetches, pushes or authenticates.
// GIT_ALLOW_PROTOCOL (empty allowlist) wins even over protocol.<name>.allow=always, including lazy object fetches.
// Reset safe.directory's allowlist, not the ownership check: opening a repo is not permission to trust another owner.
export function gitEnv(env: NodeJS.ProcessEnv, checkout = false): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  if (env.PATH !== undefined) out.PATH = env.PATH;
  if (env.HOME !== undefined) out.HOME = env.HOME;
  const config = [
    ['core.fsmonitor', 'false'],
    ['credential.helper', ''],
    ['log.showSignature', 'false'], // stash list uses log; signature verification would spawn gpg/ssh-keygen
    ['safe.directory', ''],
    ...(!checkout ? [['core.hooksPath', '/dev/null']] : []),
  ];
  config.forEach(([key, value], i) => {
    out[`GIT_CONFIG_KEY_${i}`] = key;
    out[`GIT_CONFIG_VALUE_${i}`] = value;
  });
  return {
    ...out, GIT_CONFIG_COUNT: String(config.length), GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C',
    GIT_PAGER: 'cat', GIT_EXTERNAL_DIFF: '/usr/bin/false', GIT_SSH_COMMAND: '/usr/bin/false', GIT_ALLOW_PROTOCOL: '',
  };
}

export function createGitRunner(options: { env?: NodeJS.ProcessEnv; execFile?: ExecFileFn } = {}): GitRun {
  const env = options.env ?? process.env;
  const binary = gitBinary(env);
  const run = options.execFile ?? execGit;
  return (directory, args) =>
    new Promise((resolve, reject) => {
      // Only trusted worktree creation runs checkout hooks/filters. Read callers never acquire that privilege.
      const checkout = args[0] === 'worktree' && args[1] === 'add';
      const execOptions: GitExecOptions = { env: gitEnv(env, checkout), detached: true, maxBuffer: MAX_BUFFER, encoding: 'utf8' };
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try { signalGroup(child, 'SIGTERM'); } catch (error) { reject(error); }
        // Do not cancel this when Git exits: a hook may have closed its pipes and outlived its parent.
        setTimeout(() => {
          try {
            signalGroup(child, 'SIGKILL');
            reject(new GitTimeoutError(`git ${args[0]} timed out after ${GIT_TIMEOUT_MS / 1000} s in ${directory}`));
          } catch (error) { reject(error); }
        }, KILL_GRACE_MS);
      }, GIT_TIMEOUT_MS);
      const child = run(binary, ['-C', directory, ...args], execOptions, (error, stdout, stderr) => {
        clearTimeout(timer);
        if (timedOut) return; // recovery may start only after the whole group has received SIGKILL
        if (!error) resolve(stdout);
        else reject(failure(error, stderr, binary, directory, args[0]));
      });
    });
}

// execFile does not forward `detached` to spawn. Use spawn directly so Git really leads a new process group.
const execGit: ExecFileFn = (file, args, options, callback) => {
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

function signalGroup(child: ChildProcess | void, signal: NodeJS.Signals): void {
  if (child?.pid === undefined) return;
  try { process.kill(-child.pid, signal); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

function failure(error: ExecFileException, stderr: string, binary: string, directory: string, subcommand: string): Error {
  if (error.killed && error.signal) return new GitTimeoutError(`git ${subcommand} timed out after ${GIT_TIMEOUT_MS / 1000} s in ${directory}`);
  if (error.code === 'ENOENT' || error.code === 'EACCES') return new Error(`git unavailable: ${binary}: ${error.code}`);
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return new Error(`git ${subcommand} output exceeds ${MAX_BUFFER / 1024 / 1024} MiB`);
  if (/not a git repository/.test(stderr)) return new NotARepositoryError();
  const first = stderr.split('\n').find((line) => line.trim() !== '')?.replace(/^(fatal|error): /, '') ?? error.message;
  return new GitCommandError(`git ${subcommand} failed: ${first}`, stderr);
}
