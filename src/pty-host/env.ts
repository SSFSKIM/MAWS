// The environment a terminal shell starts with (C9 Residue *Terminal environment*, charter §4.1 and X6): the base
// minus the variables that belong to the Claude session the app itself may have been started from, plus what names
// this terminal. Nothing here injects engine-launch settings (gateway variables, `CLAUDE_CODE_FORK_SUBAGENT`): a
// shell the owner types into must behave exactly like Terminal.app (D-12).
// M1 ships the pure `terminalEnvironment`; M2 adds `baseEnvironment()` over C3's captured login-shell environment.

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
] as const;

// Engine-launch settings the host may carry from its own environment; a terminal never forwards them (X6: the
// terminal is not an engine launch).
const ENGINE_LAUNCH_VARIABLES = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ENABLE_TOOL_SEARCH', 'CLAUDE_CODE_FORK_SUBAGENT'] as const;

const LOCALE_VARIABLES = ['LANG', 'LC_ALL', 'LC_CTYPE'] as const;

export interface TerminalEnvironmentOptions {
  appVersion: string; // TERM_PROGRAM_VERSION
}

export function terminalEnvironment(base: NodeJS.ProcessEnv, { appVersion }: TerminalEnvironmentOptions): Record<string, string> {
  const env: Record<string, string> = {};
  const excluded = new Set<string>([...PARENT_SESSION_VARIABLES, ...ENGINE_LAUNCH_VARIABLES]);
  for (const [name, value] of Object.entries(base)) {
    if (value !== undefined && !excluded.has(name)) env[name] = value;
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
