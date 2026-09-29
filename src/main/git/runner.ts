// How the git service runs `git` (C4 execution document, Interfaces "Git service"; residue *Git invocation and
// watcher*). One `execFile` per call against `MAWS_GIT` or `/usr/bin/git`, `-C <directory>` first, with exactly the
// environment below: `GIT_OPTIONAL_LOCKS=0` keeps `git status` from refreshing the index (the service is read-only even in
// side effects), `GIT_TERMINAL_PROMPT=0` makes a credential question fail instead of hanging, `LC_ALL=C` fixes the
// messages this file matches, and nothing else of the caller's environment (a GIT_DIR, a GIT_INDEX_FILE) reaches git.
// Which subcommands run is the service's business; this file only runs them and names the failures.
import { execFile as nodeExecFile, type ExecFileException } from 'node:child_process';

export const GIT_TIMEOUT_MS = 10_000;
const MAX_BUFFER = 64 * 1024 * 1024;

export interface GitExecOptions {
  env: NodeJS.ProcessEnv;
  timeout: number;
  maxBuffer: number;
  encoding: 'utf8';
}
// The shape of `child_process.execFile` the runner calls; tests pass a spy or a stand-in.
export type ExecFileFn = (
  file: string,
  args: string[],
  options: GitExecOptions,
  callback: (error: ExecFileException | null, stdout: string, stderr: string) => void,
) => unknown;

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

export function gitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  if (env.PATH !== undefined) out.PATH = env.PATH;
  if (env.HOME !== undefined) out.HOME = env.HOME;
  return { ...out, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };
}

export function createGitRunner(options: { env?: NodeJS.ProcessEnv; execFile?: ExecFileFn } = {}): GitRun {
  const env = options.env ?? process.env;
  const binary = gitBinary(env);
  const execOptions: GitExecOptions = { env: gitEnv(env), timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_BUFFER, encoding: 'utf8' };
  const run = options.execFile ?? (nodeExecFile as unknown as ExecFileFn);
  return (directory, args) =>
    new Promise((resolve, reject) => {
      run(binary, ['-C', directory, ...args], execOptions, (error, stdout, stderr) => {
        if (!error) resolve(stdout);
        else reject(failure(error, stderr, binary, directory, args[0]));
      });
    });
}

function failure(error: ExecFileException, stderr: string, binary: string, directory: string, subcommand: string): Error {
  if (error.killed && error.signal) return new GitTimeoutError(`git ${subcommand} timed out after ${GIT_TIMEOUT_MS / 1000} s in ${directory}`);
  if (error.code === 'ENOENT' || error.code === 'EACCES') return new Error(`git unavailable: ${binary}: ${error.code}`);
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return new Error(`git ${subcommand} output exceeds ${MAX_BUFFER / 1024 / 1024} MiB`);
  if (/not a git repository/.test(stderr)) return new NotARepositoryError();
  const first = stderr.split('\n').find((line) => line.trim() !== '')?.replace(/^(fatal|error): /, '') ?? error.message;
  return new GitCommandError(`git ${subcommand} failed: ${first}`, stderr);
}
