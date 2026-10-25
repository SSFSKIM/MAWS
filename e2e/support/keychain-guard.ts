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

/** Runs a keychain-touching step: no prompt before; one appearing during it fails the step at once (after `onPrompt`,
 * which stops what the step started, so nothing keeps waiting on the dialog); none after. */
export async function guardKeychain<T>(where: string, step: () => Promise<T>, options: { probe?: PromptProbe; pollMs?: number; onPrompt?: () => unknown } = {}): Promise<T> {
  const probe = options.probe ?? securityAgentRunning;
  assertNoKeychainPrompt(`before ${where}`, probe);
  let timer: ReturnType<typeof setInterval> | undefined;
  let seen = false; // the poll has already failed the step on a prompt
  const prompted = new Promise<never>((_, reject) => {
    timer = setInterval(() => {
      let pending: boolean;
      try {
        pending = probe();
      } catch (error) {
        clearInterval(timer);
        reject(error);
        return;
      }
      if (!pending) return;
      seen = true;
      clearInterval(timer);
      void Promise.resolve()
        .then(() => options.onPrompt?.())
        .catch(() => {})
        .then(() => reject(new Error(`a keychain prompt (SecurityAgent) appeared during ${where}; the step was stopped`)));
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

const REFUSED = ['CLAUDE_SECURESTORAGE_CONFIG_DIR', 'CLAUDE_CODE_CUSTOM_OAUTH_URL'] as const;

/** The engine environment names its keychain items after `configDir` alone. */
export function assertEngineKeychainEnv(env: Record<string, string | undefined>, configDir: string, where: string): void {
  for (const name of REFUSED) if (env[name] !== undefined) throw new Error(`${where}: the engine would run with ${name}, under which it names another keychain item`);
  if (env.CLAUDE_CONFIG_DIR !== configDir) throw new Error(`${where}: the engine would run with CLAUDE_CONFIG_DIR=${env.CLAUDE_CONFIG_DIR ?? '(unset: the owner’s ~/.claude)'}, not the scratch ${configDir}`);
}

/** The environment the engine host builds every engine's from: the login shell's, captured with the app's own
 * environment as `$SHELL -ilc 'env -0'` (src/shared/host/shell-env.ts). Read the same way, bounded, before the app runs. */
export function loginShellEnvironment(env: Record<string, string>): Record<string, string> {
  const shell = env.SHELL || '/bin/zsh';
  const capture = spawnSync(shell, ['-ilc', 'env -0'], { env, encoding: 'utf8', timeout: SECURITY_MS, stdio: ['ignore', 'pipe', 'ignore'] });
  if (capture.status !== 0) throw new Error(`the login shell's environment could not be read (${shell}: ${capture.status ?? capture.signal ?? capture.error?.message})`);
  const out: Record<string, string> = {};
  for (const entry of capture.stdout.split('\0')) {
    const at = entry.indexOf('=');
    if (at > 0) out[entry.slice(0, at)] = entry.slice(at + 1);
  }
  return { ...env, ...out };
}

/** The live engine's own environment, from `ps -E` (one's own processes): it names the scratch store and none other. */
export function assertEngineProcessKeychainEnv(pid: number, configDir: string): void {
  const ps = spawnSync('/bin/ps', ['-E', '-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', timeout: PROMPT_CHECK_MS });
  if (ps.status !== 0) throw new Error(`engine ${pid}'s environment could not be read (ps ${ps.status ?? ps.signal})`);
  const words = ` ${ps.stdout.trim()} `;
  for (const name of REFUSED) if (words.includes(` ${name}=`)) throw new Error(`engine ${pid} runs with ${name}`);
  if (!words.includes(` CLAUDE_CONFIG_DIR=${configDir} `)) throw new Error(`engine ${pid} does not run with CLAUDE_CONFIG_DIR=${configDir}`);
}
