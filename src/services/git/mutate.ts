// E6's mutating runner (E6 execution document, Design §2): the local mutations the Source control panel makes (stage,
// unstage, discard, commit), through the read runner's spawn core in `mutate` mode: the owner's login-shell environment
// so the repository's hooks, signing and commit template behave as in Terminal.app, with transport and credential
// helpers still off (P-12, parent §8: the mutating runner never runs a remote command). Only the allowlisted
// subcommands ever spawn; the caller builds every argument.
import { execGit, gitBinary, gitEnv, spawnGit, streamTail, type ExecFileFn } from './runner';

export const MUTATING_SUBCOMMANDS = ['add', 'restore', 'rm', 'clean', 'commit'] as const;

// Both streams of a call that exited 0, each its last 256 KiB; a non-zero exit throws `GitCommandError`, a timeout
// `GitTimeoutError`.
export type MutateRun = (directory: string, args: string[], options: { timeoutMs: number }) => Promise<{ stdout: string; stderr: string }>;

export function createMutatingRunner(options: {
  env?: NodeJS.ProcessEnv; // where MAWS_GIT is read; process.env by default
  captured: () => Promise<Record<string, string>>; // the login-shell capture: the environment's base
  execFile?: ExecFileFn;
}): MutateRun {
  const env = options.env ?? process.env;
  const binary = gitBinary(env);
  const execFile = options.execFile ?? execGit;
  return async (directory, args, { timeoutMs }) => {
    if (!(MUTATING_SUBCOMMANDS as readonly string[]).includes(args[0])) throw new Error(`git ${args[0] ?? '(none)'} is not an allowed mutation`);
    const base = await options.captured();
    const { stdout, stderr } = await spawnGit({ binary, directory, args, env: gitEnv(env, 'mutate', base), timeoutMs, acceptExitCodes: [], execFile });
    return { stdout: streamTail(stdout), stderr: streamTail(stderr) };
  };
}
