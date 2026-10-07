// The environments the e2e runs start the app and a terminal engine with, as pure functions of the runner's environment
// (E11 W-E review m7; Decision Log 22): the scrub of every inherited CLAUDE* variable is pinned by
// test/support/scratch-env.test.ts. launch.ts and c12-prerun.ts add the side effects (the profile's directories, the
// login-shell capture) around them.
import { join } from 'node:path';
import { GATEWAY_AUTH_TOKEN, RELAY_URL } from '../../src/engine-host/launch';
import { withoutClaudeVariables } from '../../test/support/claude-env';

type Env = Record<string, string | undefined>;

// launchMaws's base environment over the profile `userData`: the runner's without its CLAUDE* variables (a parent Claude
// session's plugin dirs, ids, model and effort would reach every engine the app starts through the hosts' login-shell
// capture), nor the switches that turn the app into a dev-server client or a Node; the e2e mark, the profile, an empty
// engine store as the config home (C4 reads the config home the engine would, so the run never reads ~/.claude) and no
// ClaudeUsage data (C7: a directory that does not exist, so the status line never reads the owner's; statusline.spec.ts
// names its own copy). A test's `env`, applied by launchMaws afterwards, may still name a CLAUDE* variable on purpose.
export function launchEnvironment(runner: Env, userData: string): Record<string, string> {
  const env = withoutClaudeVariables(runner);
  delete env.ELECTRON_RENDERER_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  return { ...env, MAWS_E2E: '1', MAWS_USER_DATA: userData, CLAUDE_CONFIG_DIR: join(userData, 'claude-config'), MAWS_CLAUDE_USAGE_DIR: join(userData, 'claude-usage') };
}

// What a parent Claude or Electron process injects into a shell, beside the CLAUDE* variables already dropped.
const INJECTED = /^(CLAUDECODE|CLAUDE_CODE_(SESSION_ID|CHILD_SESSION|SESSION_ATTENDED|MESSAGING_SOCKET|MESSAGING_TOKEN|EXECPATH|ENTRYPOINT|SSE_PORT)|CLAUDE_PID|CLAUDE_EFFORT|ELECTRON_.*|NODE_OPTIONS|GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE)$/;

// The terminal's environment for the pinned engine under the scratch home `config`: the base variables from the runner,
// the owner's login shell `loginShell` without anything a parent Claude or Electron process injects and without any
// CLAUDE* variable (the capture inherits the runner's, a parent Claude session's plugin dirs among them), then the
// scratch home, the relay and its marker token, and Haiku for subagents (spend); `extra` last.
export function terminalEnvironment(config: string, loginShell: Env, runner: Env, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = { TERM: 'xterm-256color', LANG: runner.LANG ?? 'en_US.UTF-8' };
  for (const key of ['PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR']) {
    const value = runner[key];
    if (value) env[key] = value;
  }
  for (const [key, v] of Object.entries(runner)) if (key.startsWith('ANTHROPIC_DEFAULT_') && v) env[key] = v;
  for (const [key, v] of Object.entries(withoutClaudeVariables(loginShell))) if (!INJECTED.test(key)) env[key] = v;
  env.TERM = 'xterm-256color';
  return { ...env, CLAUDE_CONFIG_DIR: config, ANTHROPIC_BASE_URL: RELAY_URL, ANTHROPIC_AUTH_TOKEN: GATEWAY_AUTH_TOKEN, CLAUDE_CODE_SUBAGENT_MODEL: 'haiku', ...extra };
}

// The engine's arguments for one `claude -p` exchange on `model` (printRun) and for an interactive terminal on `model`
// (ptyEngine); `args` follow (a resume, more flags).
export const printArgs = (prompt: string, model: string, args: string[] = []): string[] => ['-p', prompt, '--model', model, '--max-budget-usd', '0.5', '--output-format', 'stream-json', '--verbose', ...args];
export const ptyArgs = (model: string, args: string[]): string[] => ['--model', model, ...args];
