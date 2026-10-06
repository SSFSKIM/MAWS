import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { PARENT_SESSION_VARIABLES } from '@shared/host/session-variables';
import { GitFixture } from '../../../test/support/git-fixture';
import { childEnvironment, REDIRECTING_GIT_VARIABLES } from './remote-env';

const REDIRECTING = {
  GIT_DIR: '/x/.git', GIT_WORK_TREE: '/x', GIT_INDEX_FILE: '/x/index', GIT_OBJECT_DIRECTORY: '/x/objects',
  GIT_ALTERNATE_OBJECT_DIRECTORIES: '/y/objects', GIT_COMMON_DIR: '/x/.git', GIT_NAMESPACE: 'ns', GIT_CEILING_DIRECTORIES: '/',
  GIT_DISCOVERY_ACROSS_FILESYSTEM: '1', GIT_EXEC_PATH: '/evil/libexec', GIT_PREFIX: 'sub/', GIT_CONFIG: '/evil/config',
  GIT_CONFIG_GLOBAL: '/evil/global', GIT_CONFIG_SYSTEM: '/evil/system', GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_PARAMETERS: "'core.fsmonitor=true'", GIT_CONFIG_COUNT: '3',
  GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'true', GIT_CONFIG_KEY_2: 'core.sshCommand', GIT_CONFIG_VALUE_2: 'evil',
};
const KEPT = {
  PATH: '/opt/homebrew/bin:/usr/bin:/bin', HOME: '/Users/owner', LANG: 'en_US.UTF-8',
  GIT_SSH_COMMAND: 'ssh -i ~/.ssh/work', GIT_ASKPASS: '/usr/local/bin/askpass', SSH_AUTH_SOCK: '/private/tmp/agent.sock',
  GIT_AUTHOR_NAME: 'Owner', GH_HOST: 'github.example.com', GH_TOKEN: 'gho_secret', GH_ENTERPRISE_TOKEN: 'ghe_secret',
};
const LAUNCHER = { MAWS_E2E: '1', MAWS_USER_DATA: '/u', ELECTRON_RUN_AS_NODE: '1', ELECTRON_RENDERER_URL: 'http://localhost' };
const parentSession = Object.fromEntries(PARENT_SESSION_VARIABLES.map((name) => [name, 'parent']));

describe('remote environment drops every redirecting git variable', () => {
  it('names the inventory, the counted pairs by prefix', () => {
    expect(REDIRECTING_GIT_VARIABLES).toEqual([
      'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR',
      'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM', 'GIT_EXEC_PATH', 'GIT_PREFIX', 'GIT_CONFIG',
      'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
      'GIT_CONFIG_KEY_*', 'GIT_CONFIG_VALUE_*',
    ]);
  });

  it('keeps the owner transport, credentials and gh variables; drops the inventory, GH_REPO, the parent session and the launcher', () => {
    const env = childEnvironment({ ...KEPT, ...REDIRECTING, ...parentSession, ...LAUNCHER, GH_REPO: 'someone/else' }, 'remote');
    expect(env).toEqual({
      ...KEPT,
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'false',
      GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1', TERM: 'dumb',
    });
  });

  it('for a mutation drops every git variable but adds nothing (the mutating runner adds its own)', () => {
    const env = childEnvironment({ ...KEPT, ...REDIRECTING, ...parentSession, ...LAUNCHER, GH_REPO: 'o/r' }, 'mutate');
    const rest = Object.fromEntries(Object.entries(KEPT).filter(([name]) => !name.startsWith('GIT_')));
    expect(env).toEqual({ ...rest, GH_REPO: 'o/r' });
    expect(rest).toHaveProperty('SSH_AUTH_SOCK');
  });

  it('pins core.fsmonitor false for real git over an inherited GIT_CONFIG_PARAMETERS and the repository config', async () => {
    const repo = await GitFixture.create();
    try {
      await repo.git('config', 'core.fsmonitor', 'true');
      const captured = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: repo.home, GIT_CONFIG_PARAMETERS: "'core.fsmonitor=true'" };
      const read = (env: NodeJS.ProcessEnv) => execFileSync('/usr/bin/git', ['-C', repo.root, 'config', '--get', 'core.fsmonitor'], { env, encoding: 'utf8' }).trim();
      // The control: the counted pair alone loses to the -c channel, which is why the inventory drops it.
      expect(read({ ...captured, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'false' })).toBe('true');
      expect(read(childEnvironment(captured, 'remote'))).toBe('false');
    } finally {
      repo.dispose();
    }
  });
});
