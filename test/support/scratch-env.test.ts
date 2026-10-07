// The e2e runs' scratch environments drop every inherited CLAUDE* variable (E11 W-E review m7, Decision Log 22;
// e2e/support/scratch-env.ts): the app's launch and the C12 pre-run's terminal engine.
import { describe, expect, it } from 'vitest';
import { GATEWAY_AUTH_TOKEN, RELAY_URL } from '../../src/engine-host/launch';
import { launchEnvironment, printArgs, ptyArgs, terminalEnvironment } from '../../e2e/support/scratch-env';

// A runner inside a Claude session (Decision Log 22's list), with what must stay.
const PARENT_SESSION = {
  CLAUDE_CODE_PLUGIN_DIRS: '/Users/owner/.claude/mods/prompt-autosave',
  CLAUDE_CODE_SESSION_ID: 'parent-session',
  CLAUDE_CODE_SUBAGENT_MODEL: 'opus',
  CLAUDE_MODEL: 'opus',
  CLAUDE_CONFIG_DIR: '/Users/owner/.claude',
  CLAUDECODE: '1',
};
const RUNNER = { ...PARENT_SESSION, PATH: '/usr/bin', HOME: '/Users/owner', LANG: 'en_GB.UTF-8', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku', UNSET: undefined };
const claudeKeys = (env: Record<string, string>) => Object.keys(env).filter((key) => key.startsWith('CLAUDE')).sort();

describe('launchEnvironment', () => {
  it("drops the runner's CLAUDE* variables and the dev and Node switches, and sets the profile's scratch config home", () => {
    const env = launchEnvironment({ ...RUNNER, ELECTRON_RENDERER_URL: 'http://localhost:5173', ELECTRON_RUN_AS_NODE: '1' }, '/tmp/maws-e2e-x');
    expect(env).toEqual({
      PATH: '/usr/bin', HOME: '/Users/owner', LANG: 'en_GB.UTF-8', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku',
      MAWS_E2E: '1', MAWS_USER_DATA: '/tmp/maws-e2e-x', CLAUDE_CONFIG_DIR: '/tmp/maws-e2e-x/claude-config', MAWS_CLAUDE_USAGE_DIR: '/tmp/maws-e2e-x/claude-usage',
    });
  });
});

describe('terminalEnvironment', () => {
  const loginShell = { ...PARENT_SESSION, CLAUDE_EFFORT: 'high', CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1', PATH: '/opt/homebrew/bin:/usr/bin', EDITOR: 'vim', NODE_OPTIONS: '--inspect', ELECTRON_RUN_AS_NODE: '1' };

  it("keeps none of the owner's CLAUDE* variables, from the runner or the login shell, and sets the scratch home, relay and Haiku subagents", () => {
    const env = terminalEnvironment('/tmp/maws-c12-prerun-x/claude-config', loginShell, RUNNER);
    expect(claudeKeys(env)).toEqual(['CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CONFIG_DIR']);
    expect(env).toEqual({
      TERM: 'xterm-256color', LANG: 'en_GB.UTF-8', PATH: '/opt/homebrew/bin:/usr/bin', HOME: '/Users/owner', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku', EDITOR: 'vim',
      CLAUDE_CONFIG_DIR: '/tmp/maws-c12-prerun-x/claude-config', ANTHROPIC_BASE_URL: RELAY_URL, ANTHROPIC_AUTH_TOKEN: GATEWAY_AUTH_TOKEN, CLAUDE_CODE_SUBAGENT_MODEL: 'haiku',
    });
  });

  it('adds what the caller names last (the teammate sitting’s switch)', () => {
    const env = terminalEnvironment('/tmp/scratch', loginShell, RUNNER, { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' });
    expect(claudeKeys(env)).toEqual(['CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', 'CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CONFIG_DIR']);
  });
});

describe("the terminal engine's arguments", () => {
  it('run on the model the caller names', () => {
    expect(printArgs('hi', 'haiku')).toEqual(['-p', 'hi', '--model', 'haiku', '--max-budget-usd', '0.5', '--output-format', 'stream-json', '--verbose']);
    expect(printArgs('hi', 'sonnet', ['--resume', 's1']).slice(2, 4)).toEqual(['--model', 'sonnet']);
    expect(ptyArgs('haiku', ['--resume', 's1'])).toEqual(['--model', 'haiku', '--resume', 's1']);
  });
});
