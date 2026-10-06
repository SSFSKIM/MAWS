// The environments E6's git children start from (E6 execution document, Design §2 and §4): the owner's login-shell
// capture, so hooks, signing and credential helpers behave as in Terminal.app, without what belongs to the session
// that started the app (`PARENT_SESSION_VARIABLES`) or to its launcher (`LAUNCHER_PREFIXES`).
//
// `mutate` (the base the mutating runner layers its own safety configuration on, `gitEnv(…, 'mutate')`): every
// inherited `GIT_*` dropped, so no override of the owner's or the launcher's redirects a MAWS mutation or injects
// configuration (`GIT_CONFIG_PARAMETERS` included); nothing added here.
//
// `remote` (complete: what `git push` and `gh` run under): the owner's transport and authentication variables kept
// (`GIT_SSH_COMMAND`, `GIT_ASKPASS`, `SSH_AUTH_SOCK`, `GH_HOST`, `GH_TOKEN`, …, P-12's point), minus the inventory of
// what moves the repository git acts on or injects configuration, and minus `GH_REPO` (gh's override of the repository
// every command targets; a PR plan binds its repository with `--repo` instead). Then the one safety key every mode keeps,
// `core.fsmonitor=false`, which every `git` that `gh` spawns inherits too; no prompt that has no tty to answer it; no
// colour, no update notice.
import { LAUNCHER_PREFIXES, PARENT_SESSION_VARIABLES } from '@shared/host/session-variables';

// `GIT_CONFIG_PARAMETERS` outranks the `GIT_CONFIG_COUNT` pairs (the adversarial review's probe: an inherited
// `'core.fsmonitor=true'` beat a counted pair setting it false), so it is dropped rather than outvoted. Entries ending
// in `*` match by prefix.
export const REDIRECTING_GIT_VARIABLES = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_EXEC_PATH',
  'GIT_PREFIX',
  'GIT_CONFIG',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_KEY_*',
  'GIT_CONFIG_VALUE_*',
] as const;

const REMOTE_ADDITIONS = {
  GIT_TERMINAL_PROMPT: '0', // a missing credential fails fast with git's own message instead of waiting on a prompt
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'core.fsmonitor',
  GIT_CONFIG_VALUE_0: 'false',
  GH_PROMPT_DISABLED: '1',
  GH_NO_UPDATE_NOTIFIER: '1',
  NO_COLOR: '1',
  TERM: 'dumb',
};

const parentSession = new Set<string>(PARENT_SESSION_VARIABLES);
const fromLauncher = (name: string) => LAUNCHER_PREFIXES.some((prefix) => name.startsWith(prefix));
const redirecting = (name: string) =>
  REDIRECTING_GIT_VARIABLES.some((entry) => (entry.endsWith('*') ? name.startsWith(entry.slice(0, -1)) : name === entry));

export function childEnvironment(captured: Record<string, string | undefined>, mode: 'mutate' | 'remote'): Record<string, string> {
  const dropped = mode === 'mutate' ? (name: string) => name.startsWith('GIT_') : (name: string) => redirecting(name) || name === 'GH_REPO';
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(captured)) {
    if (value !== undefined && !parentSession.has(name) && !fromLauncher(name) && !dropped(name)) env[name] = value;
  }
  return mode === 'remote' ? { ...env, ...REMOTE_ADDITIONS } : env;
}
