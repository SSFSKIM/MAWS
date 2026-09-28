import { describe, expect, it } from 'vitest';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import { LaunchSpecSchema } from '@shared/engine/launch-spec';
import { parseJournalRow } from '@shared/wire/journal';
import {
  buildLaunch,
  CHARTER_PIN,
  ENGINE_BIN,
  ENGINE_FLAGS,
  ENGINE_VERSION,
  GATEWAY_AUTH_TOKEN,
  LaunchSpecConflict,
  mergeFlagSettings,
  RELAY_URL,
  spawnMeta,
} from './launch';

const OPTS = { relayUrl: RELAY_URL, engineVersion: ENGINE_VERSION };
const SETTINGS_FLAG = '--settings';

function spec(overrides: Partial<LaunchSpec> = {}): LaunchSpec {
  return LaunchSpecSchema.parse({
    appSessionId: 'app-1',
    cwd: '/tmp/maws-launch-test',
    additionalDirectories: [],
    model: null,
    effort: null,
    permissionMode: null,
    gateway: 'gateway',
    subagentModel: null,
    resume: null,
    sessionId: null,
    trust: null,
    mcpConfig: null,
    extraSettings: null,
    maxBudgetUsd: null,
    replay: null,
    ...overrides,
  });
}

// A login-shell capture as the owner's Mac would produce it from inside a Claude Code terminal: the shell's own
// exports, the gateway variables ClaudeUsage writes, the parent-session variables a child must never inherit, and
// noise that never reaches an engine.
const CAPTURED: Record<string, string> = {
  PATH: '/opt/homebrew/bin:/usr/bin:/bin',
  HOME: '/Users/owner',
  USER: 'owner',
  LOGNAME: 'owner',
  SHELL: '/bin/zsh',
  TMPDIR: '/var/folders/xx/T/',
  TZ: 'Asia/Seoul',
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
  LC_CTYPE: 'UTF-8',
  SSH_AUTH_SOCK: '/private/tmp/agent.sock',
  XDG_CONFIG_HOME: '/Users/owner/.config',
  HOMEBREW_PREFIX: '/opt/homebrew',
  GIT_AUTHOR_NAME: 'Owner',
  GIT_DIR: '/somewhere/.git',
  GIT_WORK_TREE: '/somewhere',
  GIT_INDEX_FILE: '/somewhere/.git/index',
  CLAUDE_CONFIG_DIR: '/Users/owner/.claude',
  ANTHROPIC_DEFAULT_HAIKU_MODEL: 'gpt-5-mini',
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:9999',
  ENABLE_TOOL_SEARCH: 'false',
  MCP_TIMEOUT: '30000',
  MCP_CONNECT_TIMEOUT_MS: '5000',
  MAX_THINKING_TOKENS: '8000',
  DISABLE_TELEMETRY: '1',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
  // excluded whatever the capture holds
  CLAUDE_CODE_SESSION_ID: 'parent-session',
  CLAUDE_CODE_CHILD_SESSION: '1',
  CLAUDE_CODE_SESSION_ATTENDED: '1',
  CLAUDE_PID: '123',
  CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/sock',
  CLAUDE_CODE_MESSAGING_TOKEN: 'tok',
  CLAUDE_CODE_EXECPATH: '/x/claude',
  CLAUDE_EFFORT: 'high',
  CLAUDECODE: '1',
  CLAUDE_CODE_SSE_PORT: '4444',
  CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS: '1000',
  CLAUDE_CODE_ENTRYPOINT: 'cli',
  CMUX_SOCKET: '/tmp/cmux',
  NODE_OPTIONS: '--max-old-space-size=8192',
  ELECTRON_RUN_AS_NODE: '1',
  ELECTRON_NO_ATTACH_CONSOLE: '1',
  // never allowlisted
  AWS_SECRET_ACCESS_KEY: 'aws-secret',
  EDITOR: 'vim',
  TERM: 'xterm-256color',
};

const EXCLUDED_KEYS = [
  'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_PID',
  'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_EFFORT',
  'CLAUDECODE', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS', 'CMUX_SOCKET', 'NODE_OPTIONS',
  'ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ATTACH_CONSOLE', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE',
  'AWS_SECRET_ACCESS_KEY', 'EDITOR',
];

function settingsOf(args: string[]): Record<string, unknown> {
  const i = args.lastIndexOf(SETTINGS_FLAG);
  expect(i).toBeGreaterThan(-1);
  return JSON.parse(args[i + 1]!) as Record<string, unknown>;
}

describe('launch contract builds the X6 command line and environment', () => {
  it('pins the binary by absolute path and the relay by loopback URL', () => {
    expect(ENGINE_BIN).toBe('/Users/new/.local/share/claude/versions/2.1.283');
    expect(ENGINE_VERSION).toBe('2.1.283');
    expect(RELAY_URL).toBe('http://127.0.0.1:8641');
    expect(GATEWAY_AUTH_TOKEN).toBe('claudeusage-local-gateway');
    expect(ENGINE_FLAGS).toEqual([
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--permission-prompt-tool', 'stdio', '--include-partial-messages', '--forward-subagent-text',
      '--replay-user-messages', '--include-hook-events', '--setting-sources', 'user,project,local',
    ]);
  });

  it('starts args with exactly the §4.1 flag set, never passes --strict-mcp-config, and ends with --settings', () => {
    const plan = buildLaunch(spec(), CAPTURED, OPTS);
    expect(plan.bin).toBe(ENGINE_BIN);
    expect(plan.cwd).toBe('/tmp/maws-launch-test');
    expect(plan.args.slice(0, ENGINE_FLAGS.length)).toEqual(ENGINE_FLAGS);
    expect(plan.args).not.toContain('--strict-mcp-config');
    expect(plan.args.at(-2)).toBe(SETTINGS_FLAG);
    expect(settingsOf(plan.args)).toEqual({ dialogExpiry: 'never' });
    expect(plan.flagSettings).toEqual({ dialogExpiry: 'never' });
  });

  it('places the optional flags in the stated order after the fixed set', () => {
    const plan = buildLaunch(
      spec({
        model: 'sonnet',
        permissionMode: 'auto',
        additionalDirectories: ['/a', '/b'],
        sessionId: '11111111-1111-4111-8111-111111111111' as LaunchSpec['sessionId'],
        mcpConfig: { mcpServers: { x: { command: 'node' } } },
        maxBudgetUsd: 0.5,
        effort: 'high',
      }),
      CAPTURED,
      OPTS,
    );
    expect(plan.args.slice(ENGINE_FLAGS.length)).toEqual([
      '--model', 'sonnet',
      '--permission-mode', 'auto',
      '--add-dir', '/a', '--add-dir', '/b',
      '--session-id', '11111111-1111-4111-8111-111111111111',
      '--mcp-config', JSON.stringify({ mcpServers: { x: { command: 'node' } } }),
      '--max-budget-usd', '0.5',
      SETTINGS_FLAG, JSON.stringify({ dialogExpiry: 'never', effortLevel: 'high' }),
    ]);
    expect(plan.sessionId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('mints a UUID v4 --session-id and an eight-character base32 launchId when the spec pins neither', () => {
    const plan = buildLaunch(spec(), CAPTURED, OPTS);
    const i = plan.args.indexOf('--session-id');
    expect(i).toBeGreaterThan(-1);
    expect(plan.args[i + 1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(plan.sessionId).toBe(plan.args[i + 1]);
    expect(plan.launchId).toMatch(/^[a-z2-7]{8}$/);
    expect(buildLaunch(spec(), CAPTURED, OPTS).launchId).not.toBe(plan.launchId);
  });

  it('never pins --session-id on a non-fork resume, pins a fork like a new session, and refuses a pinned id on a non-fork resume', () => {
    const resumed = buildLaunch(spec({ resume: { sessionId: 'abc' as LaunchSpec['sessionId'] & string, fork: false } }), CAPTURED, OPTS);
    expect(resumed.args).toContain('--resume');
    expect(resumed.args[resumed.args.indexOf('--resume') + 1]).toBe('abc');
    expect(resumed.args).not.toContain('--session-id');
    expect(resumed.args).not.toContain('--fork-session');
    expect(resumed.sessionId).toBe('abc');

    // a fork is pinned like a new session (C10's ask; SPEC 35.16.5: --session-id is accepted beside --resume with --fork-session)
    const forked = buildLaunch(spec({ resume: { sessionId: 'abc' as LaunchSpec['sessionId'] & string, fork: true }, sessionId: '22222222-2222-4222-8222-222222222222' as LaunchSpec['sessionId'] }), CAPTURED, OPTS);
    expect(forked.args.slice(ENGINE_FLAGS.length, ENGINE_FLAGS.length + 5)).toEqual(['--resume', 'abc', '--fork-session', '--session-id', '22222222-2222-4222-8222-222222222222']);
    expect(forked.sessionId).toBe('22222222-2222-4222-8222-222222222222');
    const mintedFork = buildLaunch(spec({ resume: { sessionId: 'abc' as LaunchSpec['sessionId'] & string, fork: true } }), CAPTURED, OPTS);
    const i = mintedFork.args.indexOf('--session-id');
    expect(mintedFork.args.slice(i - 3, i)).toEqual(['--resume', 'abc', '--fork-session']);
    expect(mintedFork.args[i + 1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(mintedFork.sessionId).toBe(mintedFork.args[i + 1]);

    expect(() =>
      buildLaunch(spec({ resume: { sessionId: 'abc' as LaunchSpec['sessionId'] & string, fork: false }, sessionId: 'def' as LaunchSpec['sessionId'] & string }), CAPTURED, OPTS),
    ).toThrow(LaunchSpecConflict);
  });

  describe('environment', () => {
    it('for a gateway spec carries the D-19 variables and the host identity and lacks every excluded key', () => {
      const { env } = buildLaunch(spec({ subagentModel: 'haiku' }), CAPTURED, OPTS);
      expect(env).toMatchObject({
        ANTHROPIC_BASE_URL: RELAY_URL,
        ANTHROPIC_AUTH_TOKEN: GATEWAY_AUTH_TOKEN,
        ENABLE_TOOL_SEARCH: 'true',
        CLAUDE_CODE_FORK_SUBAGENT: 'true',
        CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: '1',
        CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
        CLAUDE_CODE_SUBAGENT_MODEL: 'haiku',
        TERM: 'dumb',
      });
      for (const key of EXCLUDED_KEYS) expect(env, key).not.toHaveProperty(key);
    });

    it('passes the allowlisted shell keys through, by name and by prefix', () => {
      const { env } = buildLaunch(spec(), CAPTURED, OPTS);
      expect(env).toMatchObject({
        PATH: CAPTURED.PATH, HOME: CAPTURED.HOME, USER: 'owner', LOGNAME: 'owner', SHELL: '/bin/zsh',
        TMPDIR: CAPTURED.TMPDIR, TZ: 'Asia/Seoul', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', LC_CTYPE: 'UTF-8',
        SSH_AUTH_SOCK: CAPTURED.SSH_AUTH_SOCK, XDG_CONFIG_HOME: CAPTURED.XDG_CONFIG_HOME,
        HOMEBREW_PREFIX: '/opt/homebrew', GIT_AUTHOR_NAME: 'Owner', CLAUDE_CONFIG_DIR: CAPTURED.CLAUDE_CONFIG_DIR,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'gpt-5-mini', MCP_TIMEOUT: '30000', MCP_CONNECT_TIMEOUT_MS: '5000',
        MAX_THINKING_TOKENS: '8000', DISABLE_TELEMETRY: '1', OTEL_EXPORTER_OTLP_ENDPOINT: CAPTURED.OTEL_EXPORTER_OTLP_ENDPOINT,
      });
      expect(env).not.toHaveProperty('CLAUDE_CODE_SUBAGENT_MODEL');
    });

    it('for a direct spec drops the three gateway keys even when the capture holds them', () => {
      const { env, args } = buildLaunch(spec({ gateway: 'direct' }), CAPTURED, OPTS);
      expect(env).not.toHaveProperty('ANTHROPIC_BASE_URL');
      expect(env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN');
      expect(env).not.toHaveProperty('ENABLE_TOOL_SEARCH');
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('gpt-5-mini');
      expect(settingsOf(args)).toEqual({ dialogExpiry: 'never', env: { ANTHROPIC_BASE_URL: '', ANTHROPIC_AUTH_TOKEN: '' } });
    });

    it('is constructed, never inherited: a key process.env holds but the capture lacks is absent', () => {
      process.env.MAWS_LAUNCH_TEST_LEAK = 'leak';
      try {
        const { env } = buildLaunch(spec(), CAPTURED, OPTS);
        expect(env).not.toHaveProperty('MAWS_LAUNCH_TEST_LEAK');
        expect(env).not.toHaveProperty('EDITOR');
      } finally {
        delete process.env.MAWS_LAUNCH_TEST_LEAK;
      }
    });
  });

  describe('launch settings merge protects the X6 keys', () => {
    it('keeps a caller env key beside the two the host sets on a direct spec', () => {
      const extraSettings = { permissions: { ask: ['Bash(git log:*)'] }, env: { FOO: 'bar' } };
      const { args, flagSettings } = buildLaunch(spec({ gateway: 'direct', extraSettings }), CAPTURED, OPTS);
      const expected = {
        permissions: { ask: ['Bash(git log:*)'] },
        env: { FOO: 'bar', ANTHROPIC_BASE_URL: '', ANTHROPIC_AUTH_TOKEN: '' },
        dialogExpiry: 'never',
      };
      expect(settingsOf(args)).toEqual(expected);
      expect(flagSettings).toEqual(expected);
      expect(extraSettings.env).toEqual({ FOO: 'bar' }); // the caller's object is not mutated
    });

    it.each([
      ['dialogExpiry', 'gateway', { dialogExpiry: '5m' }, null],
      ['env.ANTHROPIC_BASE_URL', 'gateway', { env: { ANTHROPIC_BASE_URL: 'https://x' } }, null],
      ['env.ANTHROPIC_BASE_URL', 'direct', { env: { ANTHROPIC_BASE_URL: 'https://x' } }, null],
      ['env.ANTHROPIC_AUTH_TOKEN', 'gateway', { env: { ANTHROPIC_AUTH_TOKEN: 'x' } }, null],
      ['effortLevel', 'gateway', { effortLevel: 'low' }, 'high'],
    ] as const)('refuses %s from extraSettings under %s as a conflict naming the key', (key, gateway, extraSettings, effort) => {
      let caught: unknown;
      try {
        buildLaunch(spec({ gateway, extraSettings: extraSettings as Record<string, unknown>, effort }), CAPTURED, OPTS);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(LaunchSpecConflict);
      expect((caught as LaunchSpecConflict).key).toBe(key);
      expect((caught as LaunchSpecConflict).message).toContain(key);
    });

    it('lets a caller set effortLevel when effort is null, and passes other keys through untouched', () => {
      const merged = mergeFlagSettings(spec({ effort: null, extraSettings: { effortLevel: 'low', fileCheckpointingEnabled: true, enableWorkflows: true } }));
      expect(merged).toEqual({ effortLevel: 'low', fileCheckpointingEnabled: true, enableWorkflows: true, dialogExpiry: 'never' });
    });

    it('accepts a protected key whose value equals the host\'s own', () => {
      expect(mergeFlagSettings(spec({ extraSettings: { dialogExpiry: 'never' } }))).toEqual({ dialogExpiry: 'never' });
      expect(mergeFlagSettings(spec({ gateway: 'direct', extraSettings: { env: { ANTHROPIC_BASE_URL: '' } } }))).toEqual({
        dialogExpiry: 'never', env: { ANTHROPIC_BASE_URL: '', ANTHROPIC_AUTH_TOKEN: '' },
      });
    });
  });

  it('describes the spawn as a journal-ready meta row with env key names, never values', () => {
    const plan = buildLaunch(spec({ gateway: 'gateway' }), CAPTURED, OPTS);
    const frame = spawnMeta(plan, { appVersion: '0.0.0-test' });
    expect(frame).toMatchObject({
      event: 'spawn', bin: ENGINE_BIN, args: plan.args, cwd: plan.cwd, gateway: 'gateway',
      engineVersion: ENGINE_VERSION, appVersion: '0.0.0-test', charterPin: CHARTER_PIN, launchId: plan.launchId, sessionId: plan.sessionId,
    });
    expect(frame.envKeys).toEqual(Object.keys(plan.env).sort());
    expect(JSON.stringify(frame)).not.toContain(GATEWAY_AUTH_TOKEN);
    expect(() => parseJournalRow({ seq: 1, direction: 'meta', at: new Date().toISOString(), frame })).not.toThrow();
  });
});

describe('LaunchSpecSchema', () => {
  it('is strict and typed as the X6 contract describes', () => {
    expect(() => LaunchSpecSchema.parse({ ...spec(), extra: 1 })).toThrow();
    expect(() => spec({ effort: 'ultra' as LaunchSpec['effort'] })).toThrow();
    expect(() => spec({ gateway: 'proxy' as LaunchSpec['gateway'] })).toThrow();
    expect(() => spec({ maxBudgetUsd: 0 })).toThrow();
    expect(() => spec({ trust: { accepted: false, directory: '/x' } as unknown as LaunchSpec['trust'] })).toThrow();
    expect(spec({ trust: { accepted: true, directory: '/x' } }).trust).toEqual({ accepted: true, directory: '/x' });
  });
});
