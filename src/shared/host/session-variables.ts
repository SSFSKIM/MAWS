// The variables a child process MAWS starts must never inherit from the environment MAWS itself runs in, shared by the
// PTY host's terminals (C9) and main's git children (E6's mutating and remote runners) so the lists cannot drift.

// §4.1's parent-session exclusions: a `claude` started in the terminal (or by a git hook) must never believe it is
// inside the session that started the app (the executor's own shell is one).
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

// What the app's launcher and main put in the environment the hosts inherit at fork, dropped by prefix. `MAWS_` is the
// app's own switches: main sets `MAWS_USER_DATA` for its hosts (C3: the engine host's profile directory travels this
// way), and a launcher may set `MAWS_HARNESS`, `MAWS_SESSION_SOURCE`, `MAWS_ENGINE_REPLAY`, `MAWS_SCENARIO_CLOCK` or
// `MAWS_E2E`; a MAWS started from a child would otherwise open this app's profile or load the harness or stub sessions.
// `ELECTRON_` is Electron's (`ELECTRON_RENDERER_URL` from `electron-vite dev` makes a built MAWS a dev-server client and
// trips `window.ts`'s dev-CSP guard; `ELECTRON_RUN_AS_NODE` turns any Electron app into Node).
export const LAUNCHER_PREFIXES = ['MAWS_', 'ELECTRON_'] as const;

// The captured environment without the parent session's variables, the launcher's prefixes and whatever `drop` names:
// the base of every git child main starts (E6: the mutating runner here, the remote runner in `src/main/scm`).
export function childBaseEnvironment(captured: Record<string, string | undefined>, drop: (name: string) => boolean = () => false): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(captured)) {
    if (value !== undefined && !parentSession.has(name) && !LAUNCHER_PREFIXES.some((prefix) => name.startsWith(prefix)) && !drop(name)) env[name] = value;
  }
  return env;
}
const parentSession = new Set<string>(PARENT_SESSION_VARIABLES);

// Who the owner's commits are by, when their shell says so: kept by the mutating environment, which drops every other
// inherited `GIT_*`, since they redirect no repository, configuration or transport (E6 Decision Log, task 1). The
// `_DATE` variables stay dropped: a date pinned in a profile is not an identity.
export const IDENTITY_GIT_VARIABLES = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'] as const;
const identity = new Set<string>(IDENTITY_GIT_VARIABLES);

// E6's mutating environment's base (`gitEnv(…, 'mutate')` adds its safety configuration): the capture without any
// inherited git override but the identity, so nothing the owner's or the launcher's environment sets redirects a MAWS
// mutation or injects configuration (`GIT_DIR`, `GIT_CONFIG_PARAMETERS`, `GIT_EXTERNAL_DIFF`, …).
export function mutatingBaseEnvironment(captured: Record<string, string | undefined>): Record<string, string> {
  return childBaseEnvironment(captured, (name) => name.startsWith('GIT_') && !identity.has(name));
}
