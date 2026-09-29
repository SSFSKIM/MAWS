// The environment a terminal shell starts with (C9 Residue *Terminal environment*, charter §4.1 and X6): the base
// minus the variables that belong to the Claude session the app itself may have been started from, plus what names
// this terminal. Nothing here injects engine-launch settings (gateway variables, `CLAUDE_CODE_FORK_SUBAGENT`): a
// shell the owner types into must behave exactly like Terminal.app (D-12).
import { captureShellEnvironment } from '@shared/host/shell-env';

// §4.1's parent-session exclusions: a `claude` started in the terminal must never believe it is inside the session
// that started the app (the executor's own shell is one).
export const PARENT_SESSION_VARIABLES = [
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_PID',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SSE_PORT',
  // Observed in M1 (not in the charter's list): with only the seven above stripped, a claude started from the
  // terminal under the executor's own session reported "Transcript saving is off — inherited
  // CLAUDE_CODE_CHILD_SESSION marker". These three are what a nested claude reads to know it is nested.
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SESSION_ATTENDED',
] as const;

// Engine-launch settings the host may carry from its own environment; a terminal never forwards them (X6: the
// terminal is not an engine launch).
const ENGINE_LAUNCH_VARIABLES = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ENABLE_TOOL_SEARCH', 'CLAUDE_CODE_FORK_SUBAGENT'] as const;
// The gateway's per-tier model routing (`ANTHROPIC_DEFAULT_<TIER>_MODEL`, D-19), engine-launch settings like the two above.
const GATEWAY_MODEL_VARIABLE = /^ANTHROPIC_DEFAULT_[A-Z_]*MODEL$/;

// What the capture's own shell (or the one the host was started from) set about its session rather than exported:
// passed on, every terminal shell would start nested (`SHLVL` 2 or more) with a stale `OLDPWD` and `_`. A shell
// sets all three for itself; Terminal.app starts one without them. (`PWD` is node-pty's: it sets it to the cwd.)
const SHELL_SESSION_VARIABLES = ['SHLVL', 'OLDPWD', '_'] as const;

// What main sets in its own environment for its hosts (C3: the engine host's profile directory travels this way), which
// the PTY host inherits at fork and its login-shell capture passes on. A MAWS started in a terminal would otherwise open
// this app's profile (`MAWS_USER_DATA` selects it) instead of its own.
const APP_HOST_VARIABLES = ['MAWS_USER_DATA'] as const;

// What the app's launcher put in its environment, which the hosts inherit the same way: Electron's switches
// (`ELECTRON_RENDERER_URL` from `electron-vite dev` makes a built MAWS started in the terminal a dev-server client and
// trips `window.ts`'s dev-CSP guard; `ELECTRON_RUN_AS_NODE` turns any Electron app into Node), dropped by prefix as the
// engine's allowlist does; and `NODE_OPTIONS` when it is the launcher's own value. A value the owner's rc files set is
// set again by the terminal's login shell, and a `NODE_OPTIONS` of their own that differs from the launcher's passes.
const LAUNCHER_PREFIXES = ['ELECTRON_'] as const;
const LAUNCHER_VALUE_VARIABLES = ['NODE_OPTIONS'] as const;

const LOCALE_VARIABLES = ['LANG', 'LC_ALL', 'LC_CTYPE'] as const;

// The seed every terminal environment is built from: X6's captured login-shell environment (C3's capture, run once, at
// host start, by the caller). The capture never rejects and never comes back empty: when it fails it answers the host's
// own `process.env` itself. Async so the capture never blocks the host's handshake with main; the first spawn waits for it.
export function baseEnvironment(
  capture: () => Promise<Record<string, string>> = captureShellEnvironment,
): Promise<Record<string, string>> {
  return capture();
}

export interface TerminalEnvironmentOptions {
  appVersion: string; // TERM_PROGRAM_VERSION
  launcher?: NodeJS.ProcessEnv; // the environment the host inherited (default its own `process.env`)
}

export function terminalEnvironment(base: NodeJS.ProcessEnv, { appVersion, launcher = process.env }: TerminalEnvironmentOptions): Record<string, string> {
  const env: Record<string, string> = {};
  const excluded = new Set<string>([...PARENT_SESSION_VARIABLES, ...ENGINE_LAUNCH_VARIABLES, ...SHELL_SESSION_VARIABLES, ...APP_HOST_VARIABLES]);
  const fromLauncher = (name: string, value: string) =>
    LAUNCHER_PREFIXES.some((prefix) => name.startsWith(prefix)) || ((LAUNCHER_VALUE_VARIABLES as readonly string[]).includes(name) && launcher[name] === value);
  for (const [name, value] of Object.entries(base)) {
    if (value !== undefined && !excluded.has(name) && !GATEWAY_MODEL_VARIABLE.test(name) && !fromLauncher(name, value)) env[name] = value;
  }
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.TERM_PROGRAM = 'MAWS';
  env.TERM_PROGRAM_VERSION = appVersion;
  // Claude Code 2.1.283 turns synchronized output on only when XTVERSION is answered (xterm.js 6.0.0 does not
  // answer it), when TERM_PROGRAM is on its allowlist, or when this says so.
  env.CLAUDE_CODE_FORCE_SYNC_OUTPUT = '1';
  // A Dock-launched app has no locale at all; UTF-8 without choosing a language keeps the tty from mangling bytes.
  if (!LOCALE_VARIABLES.some((name) => env[name] !== undefined)) env.LC_CTYPE = 'UTF-8';
  return env;
}
