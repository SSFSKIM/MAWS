import { describe, expect, it } from 'vitest';
import { baseEnvironment, PARENT_SESSION_VARIABLES, terminalEnvironment } from './env';

const base = {
  PATH: '/usr/bin:/bin',
  HOME: '/Users/owner',
  SHELL: '/bin/zsh',
  LANG: 'en_US.UTF-8',
  CLAUDE_CODE_SESSION_ID: 'sess',
  CLAUDE_PID: '123',
  CLAUDECODE: '1',
  CLAUDE_CODE_ENTRYPOINT: 'cli',
  CLAUDE_CODE_SSE_PORT: '4000',
  CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS: '1000',
  CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/sock',
  CLAUDE_CODE_MESSAGING_TOKEN: 'tok',
  CLAUDE_CODE_CHILD_SESSION: '1',
  CLAUDE_CODE_EXECPATH: '/Users/owner/.local/share/claude/versions/2.1.283',
  CLAUDE_CODE_SESSION_ATTENDED: '1',
  ANTHROPIC_BASE_URL: 'https://gateway.example',
  ANTHROPIC_AUTH_TOKEN: 'secret',
  ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-x',
  ENABLE_TOOL_SEARCH: '1',
  CLAUDE_CODE_FORK_SUBAGENT: '1',
};

describe('pty host environment', () => {
  it('drops every parent-session variable and the engine-launch variables', () => {
    const env = terminalEnvironment(base, { appVersion: '0.0.0' });
    for (const name of PARENT_SESSION_VARIABLES) expect(env).not.toHaveProperty(name);
    for (const name of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ENABLE_TOOL_SEARCH', 'CLAUDE_CODE_FORK_SUBAGENT']) {
      expect(env).not.toHaveProperty(name);
    }
    expect(env.PATH).toBe(base.PATH);
    expect(env.HOME).toBe(base.HOME);
  });

  it('names the §4.1 exclusions', () => {
    expect(PARENT_SESSION_VARIABLES).toEqual(
      expect.arrayContaining([
        'CLAUDE_CODE_SESSION_ID',
        'CLAUDE_PID',
        'CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS',
        'CLAUDECODE',
        'CLAUDE_CODE_ENTRYPOINT',
        'CLAUDE_CODE_SSE_PORT',
        // observed in M1: a claude started under the executor's session reported "Transcript saving is off —
        // inherited CLAUDE_CODE_CHILD_SESSION marker" with only the charter's seven names stripped
        'CLAUDE_CODE_CHILD_SESSION',
        'CLAUDE_CODE_EXECPATH',
        'CLAUDE_CODE_SESSION_ATTENDED',
      ]),
    );
  });

  it('sets the terminal identity and the synchronized-output switch', () => {
    const env = terminalEnvironment(base, { appVersion: '1.2.3' });
    expect(env).toMatchObject({
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'MAWS',
      TERM_PROGRAM_VERSION: '1.2.3',
      CLAUDE_CODE_FORCE_SYNC_OUTPUT: '1',
    });
  });

  it('sets LC_CTYPE=UTF-8 only when no locale variable is present', () => {
    expect(terminalEnvironment(base, { appVersion: '0' })).not.toHaveProperty('LC_CTYPE');
    expect(terminalEnvironment({ PATH: '/bin' }, { appVersion: '0' }).LC_CTYPE).toBe('UTF-8');
    expect(terminalEnvironment({ PATH: '/bin', LC_ALL: 'C' }, { appVersion: '0' })).not.toHaveProperty('LC_CTYPE');
    expect(terminalEnvironment({ PATH: '/bin', LC_CTYPE: 'ko_KR.UTF-8' }, { appVersion: '0' }).LC_CTYPE).toBe('ko_KR.UTF-8');
  });

  it('drops every MAWS_ switch, so a MAWS started in a terminal never opens this one’s profile, the harness or stub sessions', () => {
    const own = {
      MAWS_USER_DATA: '/Users/owner/Library/Application Support/MAWS',
      MAWS_HARNESS: '1',
      MAWS_SESSION_SOURCE: 'stub',
      MAWS_ENGINE_REPLAY: '/tmp/journal',
      MAWS_SCENARIO_CLOCK: 'fake',
      MAWS_E2E: '1',
    };
    const env = terminalEnvironment({ ...base, ...own, NOT_MAWS_: 'kept' }, { appVersion: '0', launcher: {} });
    for (const name of Object.keys(own)) expect(env).not.toHaveProperty(name);
    expect(env.NOT_MAWS_).toBe('kept');
  });

  it('drops what the launcher set: every ELECTRON_ variable, and NODE_OPTIONS when it is the launcher’s value', () => {
    const launcher = { ELECTRON_RENDERER_URL: 'http://localhost:5173', NODE_OPTIONS: '--require ./launcher-hook.js' };
    const env = terminalEnvironment(
      { ...base, ...launcher, ELECTRON_RUN_AS_NODE: '1', ELECTRON_ENABLE_LOGGING: '1', NOT_ELECTRON_: 'kept' },
      { appVersion: '0', launcher },
    );
    for (const name of ['ELECTRON_RENDERER_URL', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_ENABLE_LOGGING', 'NODE_OPTIONS']) expect(env).not.toHaveProperty(name);
    expect(env.NOT_ELECTRON_).toBe('kept');
    // the owner's own NODE_OPTIONS (set by the login shell's rc files, or with no launcher value at all) passes
    expect(terminalEnvironment({ ...base, NODE_OPTIONS: '--max-old-space-size=8192' }, { appVersion: '0', launcher }).NODE_OPTIONS).toBe('--max-old-space-size=8192');
    expect(terminalEnvironment({ ...base, NODE_OPTIONS: '--max-old-space-size=8192' }, { appVersion: '0', launcher: {} }).NODE_OPTIONS).toBe('--max-old-space-size=8192');
  });

  it('drops the capture shell’s own session state, so a terminal shell starts at level 1 as in Terminal.app', () => {
    const env = terminalEnvironment({ ...base, SHLVL: '3', OLDPWD: '/Users/owner/src', _: '/usr/bin/env' }, { appVersion: '0' });
    for (const name of ['SHLVL', 'OLDPWD', '_']) expect(env).not.toHaveProperty(name);
  });

  it('skips undefined entries and never mutates the base', () => {
    const input: NodeJS.ProcessEnv = { PATH: '/bin', EMPTY: undefined, CLAUDECODE: '1' };
    const env = terminalEnvironment(input, { appVersion: '0' });
    expect(env).not.toHaveProperty('EMPTY');
    expect(input.CLAUDECODE).toBe('1');
  });

  it('seeds from the captured login-shell environment when the capture succeeds', async () => {
    const captured = { PATH: '/opt/homebrew/bin:/usr/bin', HOME: '/Users/owner', SHELL: '/bin/zsh' };
    await expect(baseEnvironment(async () => captured)).resolves.toBe(captured);
  });
});
