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
    expect(ownerPlugins(init, [])).toEqual(['prompt-autosave@inline']);
    expect(ownerPlugins(init.slice(1), [])).toEqual([]);
  });

  it('leaves out a plugin the sitting installed under its own scratch, in either spelling of /tmp', () => {
    // pass3/e8-plugins-reload-settle's init: the plugin E8's probe installed from its scratch market, reported under
    // /tmp while the run's directories were realpaths under /private/tmp
    const init = [
      { name: 'e8-probe', path: '/tmp/e8-g0/run1/market/plugins/e8-probe', source: 'e8-probe@e8-scratch' },
      { name: 'cached', path: '/private/tmp/maws-s2-config-x/plugins/cache/m/cached/1.0.0', source: 'cached@m' },
      { name: 'prompt-autosave', path: '/Users/owner/.claude/mods/prompt-autosave', source: 'prompt-autosave@inline' },
      { name: 'cc-plugin-telemetry', path: 'builtin', source: 'cc-plugin-telemetry@builtin' },
    ];
    expect(ownerPlugins(init, ['/private/tmp/e8-g0/run1', '/tmp/maws-s2-config-x'])).toEqual(['prompt-autosave@inline']);
  });

  it("counts a plugin under a sibling of the scratch, or with no path, as the owner's", () => {
    const init = [
      { name: 'neighbour', path: '/tmp/maws-s2-config-xy/plugins/neighbour', source: 'neighbour@m' },
      { name: 'unplaced', source: 'unplaced@m' },
    ];
    expect(ownerPlugins(init, ['/tmp/maws-s2-config-x'])).toEqual(['neighbour@m', 'unplaced@m']);
  });
});
