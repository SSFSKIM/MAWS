// fixB, keychain conditions (b) and (c) for every e2e:discover step that reaches the login keychain (the Mac mini's holds
// the owner's real Claude Code credential, and no agent may answer a keychain dialog):
// - a pending keychain prompt fails the step at once rather than waiting on it: macOS shows every keychain (and
//   authorization) dialog from the SecurityAgent process, which runs only while one is up or just closed, so its
//   presence is taken as a prompt pending, before and after each keychain-touching step and every POLL_MS during it;
//   a lookup that cannot say fails closed;
// - an engine that could name another keychain item than its scratch configuration's is refused before it starts: the
//   engine derives its two items' names from CLAUDE_SECURESTORAGE_CONFIG_DIR, else CLAUDE_CONFIG_DIR (2.1.309
//   cli.pretty.js 318187, every read and write through `vj`), and CLAUDE_CODE_CUSTOM_OAUTH_URL changes the suffix.
import { spawnSync } from 'node:child_process';
import { parseNulSeparatedEnv } from '../../src/shared/host/shell-env';

export const SECURITY_MS = 5_000; // one `security` call: a dialog would hold it, so it is cut short
export const PROMPT_CHECK_MS = 2_000;
export const POLL_MS = 500;

export type PromptProbe = () => boolean; // a keychain prompt is pending

/** `pgrep -x SecurityAgent`: 0 found, 1 none; anything else establishes nothing and throws. */
export const securityAgentRunning: PromptProbe = () => {
  const probe = spawnSync('/usr/bin/pgrep', ['-x', 'SecurityAgent'], { stdio: 'ignore', timeout: PROMPT_CHECK_MS });
  if (probe.status === 0) return true;
  if (probe.status === 1) return false;
  throw new Error(`could not tell whether a keychain prompt is pending (pgrep ${probe.status ?? probe.signal ?? probe.error?.message})`);
};

export function assertNoKeychainPrompt(where: string, probe: PromptProbe = securityAgentRunning): void {
  if (probe()) throw new Error(`a keychain prompt (SecurityAgent) is pending ${where}; no test answers one`);
}

/** Runs a keychain-touching step: no prompt before; one appearing during it, or a probe that can no longer tell, fails
 * the step at once (after `onPrompt`, which stops what the step started, so nothing keeps waiting on the dialog or runs
 * unmonitored); none after. */
export async function guardKeychain<T>(where: string, step: () => Promise<T>, options: { probe?: PromptProbe; pollMs?: number; onPrompt?: () => unknown } = {}): Promise<T> {
  const probe = options.probe ?? securityAgentRunning;
  assertNoKeychainPrompt(`before ${where}`, probe);
  let timer: ReturnType<typeof setInterval> | undefined;
  let seen = false; // the poll has already failed the step (a prompt, or no way to tell)
  const prompted = new Promise<never>((_, reject) => {
    timer = setInterval(() => {
      let failure: unknown;
      try {
        if (!probe()) return;
        failure = new Error(`a keychain prompt (SecurityAgent) appeared during ${where}; the step was stopped`);
      } catch (error) {
        failure = error; // prompt safety can no longer be established: treated as a prompt
      }
      seen = true;
      clearInterval(timer);
      void Promise.resolve()
        .then(() => options.onPrompt?.())
        .catch(() => {})
        .then(() => reject(failure));
    }, options.pollMs ?? POLL_MS);
  });
  try {
    return await Promise.race([step(), prompted]);
  } finally {
    clearInterval(timer);
    if (!seen) assertNoKeychainPrompt(`after ${where}`, probe);
  }
}

/** Watches for a keychain prompt for as long as something that can raise one runs (an app whose engines run under the
 * runner's HOME): on one, `onPrompt` stops it at once, so every wait on it fails fast; `stop` answers the error to fail
 * the test with, or null. */
export function watchKeychainPrompt(onPrompt: () => unknown, options: { probe?: PromptProbe; pollMs?: number } = {}): { stop(): Error | null } {
  const probe = options.probe ?? securityAgentRunning;
  let failure: Error | null = null;
  const timer = setInterval(() => {
    try {
      if (!probe()) return;
      failure = new Error('a keychain prompt (SecurityAgent) appeared while the app ran; the app was stopped');
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    }
    clearInterval(timer);
    try {
      onPrompt();
    } catch {
      // stopping is best effort; the failure stands
    }
  }, options.pollMs ?? POLL_MS);
  return {
    stop() {
      clearInterval(timer);
      return failure;
    },
  };
}

/** Kills `rootPid` and every descendant (deepest first, read in one `ps` pass): a dialog's requester (an engine's
 * `security` child) dying is what withdraws it, so stopping the app alone is not enough. Best effort; bounded. */
export function killTree(rootPid: number): void {
  const ps = spawnSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8', timeout: PROMPT_CHECK_MS });
  const children = new Map<number, number[]>();
  for (const line of (ps.stdout ?? '').split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (m) children.set(Number(m[2]), [...(children.get(Number(m[2])) ?? []), Number(m[1])]);
  }
  const order: number[] = [];
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    order.push(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  for (const pid of order.reverse()) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // gone already
    }
  }
}

const REFUSED = ['CLAUDE_SECURESTORAGE_CONFIG_DIR', 'CLAUDE_CODE_CUSTOM_OAUTH_URL'] as const;

/** The engine environment names its keychain items after `configDir` alone. */
export function assertEngineKeychainEnv(env: Record<string, string | undefined>, configDir: string, where: string): void {
  for (const name of REFUSED) if (env[name] !== undefined) throw new Error(`${where}: the engine would run with ${name}, under which it names another keychain item`);
  if (env.CLAUDE_CONFIG_DIR !== configDir) throw new Error(`${where}: the engine would run with CLAUDE_CONFIG_DIR=${env.CLAUDE_CONFIG_DIR ?? '(unset: the owner’s ~/.claude)'}, not the scratch ${configDir}`);
}

/** The environment the engine host builds every engine's from (src/shared/host/shell-env.ts, src/engine-host/launch.ts):
 * the login shell's alone, captured as `$SHELL -ilc 'env -0'` by a host that inherits the app's environment, parsed by
 * the host's own parser and accepted only with a PATH; on any failure the host's own environment, which is the app's.
 * Read the same way, bounded, before the app runs: what the startup files unset or change is gone from the engine too. */
export function loginShellEnvironment(env: Record<string, string>): Record<string, string> {
  const shell = env.SHELL || '/bin/zsh';
  const capture = spawnSync(shell, ['-ilc', 'env -0'], { env, encoding: 'utf8', timeout: SECURITY_MS, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'ignore'] });
  if (capture.status !== 0) return env;
  const captured = parseNulSeparatedEnv(capture.stdout);
  return 'PATH' in captured ? captured : env;
}

/** The live engine's own environment, from `ps -E` (one's own processes): it names the scratch store and none other. */
export function assertEngineProcessKeychainEnv(pid: number, configDir: string): void {
  const ps = spawnSync('/bin/ps', ['-E', '-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', timeout: PROMPT_CHECK_MS });
  if (ps.status !== 0) throw new Error(`engine ${pid}'s environment could not be read (ps ${ps.status ?? ps.signal})`);
  const words = ` ${ps.stdout.trim()} `;
  for (const name of REFUSED) if (words.includes(` ${name}=`)) throw new Error(`engine ${pid} runs with ${name}`);
  if (!words.includes(` CLAUDE_CONFIG_DIR=${configDir} `)) throw new Error(`engine ${pid} does not run with CLAUDE_CONFIG_DIR=${configDir}`);
}
