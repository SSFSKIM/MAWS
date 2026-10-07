// A scratch-home engine's environment holds no inherited CLAUDE* variable (E11 W-E, Decision Log 22).
import { describe, expect, it } from 'vitest';
import { ownerPlugins, withoutClaudeVariables } from './claude-env';

// What a test run inside a Claude session inherits (E4c's recording; Decision Log 22's list), beside what must stay.
const PARENT_SESSION = {
  CLAUDE_CODE_PLUGIN_DIRS: '/Users/owner/.claude/mods/prompt-autosave',
  CLAUDE_CODE_SESSION_ID: 'parent-session',
  CLAUDE_CODE_CHILD_SESSION: '1',
  CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/socket',
  CLAUDE_CODE_MESSAGING_TOKEN: 'token',
  CLAUDE_CODE_SUBAGENT_MODEL: 'opus',
  CLAUDE_CODE_EXECPATH: '/usr/local/bin/claude',
  CLAUDE_MODEL: 'opus',
  CLAUDE_EFFORT: 'high',
  CLAUDE_CONFIG_DIR: '/Users/owner/.claude',
  CLAUDECODE: '1',
};

describe('withoutClaudeVariables', () => {
  it('drops every CLAUDE* variable and keeps the rest, the relay and model aliases included', () => {
    const env = withoutClaudeVariables({ ...PARENT_SESSION, PATH: '/usr/bin', HOME: '/Users/owner', ANTHROPIC_BASE_URL: 'http://127.0.0.1:8641', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku', LANG: 'en_US.UTF-8', MYCLAUDE: 'kept' });
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/Users/owner', ANTHROPIC_BASE_URL: 'http://127.0.0.1:8641', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku', LANG: 'en_US.UTF-8', MYCLAUDE: 'kept' });
  });

  it('takes a process environment: unset values are left out', () => {
    expect(withoutClaudeVariables({ PATH: '/bin', UNSET: undefined, CLAUDE_MODEL: undefined })).toEqual({ PATH: '/bin' });
  });
});

describe('ownerPlugins', () => {
  it("lists the init's plugins that are not the engine's builtins", () => {
    const init = [
      { name: 'prompt-autosave', source: 'prompt-autosave@inline' },
      { name: 'cc-plugin-agents-md', source: 'cc-plugin-agents-md@builtin' },
      { name: 'cc-plugin-telemetry', source: 'cc-plugin-telemetry@builtin' },
    ];
    expect(ownerPlugins(init)).toEqual(['prompt-autosave@inline']);
    expect(ownerPlugins(init.slice(1))).toEqual([]);
  });
});
