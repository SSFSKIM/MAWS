// P3-HD M1: route D's source lookup and its one file entry (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md,
// "Source truth and lifetime"; P3 co-work Decision Log 98 (1) and (2)). The file a launch's environment names, the one
// JSON location a user or local scope names in it, the engine's `${VAR}` expansion reproduced against that launch's
// environment alone, the visible fields compared as mcp_status reports them (spikes/p3-connectors/fixtures/
// engine-mcp-call.jsonl seq 5), and the whole entry made into what MAWS's own instance would run: the SDK's minimal
// environment from the launch plus the configured env, the command found on the launch's PATH.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { McpStatusResponse } from '@shared/wire/control';
import { configFileOf, expandVariables, legacyConfigFileOf, locateEntry, materializeEntry, nodeSourceFiles, reportedVisible, visibleKey, visibleOfEntry } from './source-entry';

const REPO_ROOT = resolve(__dirname, '../../..');
const SPIKE = (() => {
  const row = readFileSync(join(REPO_ROOT, 'spikes/p3-connectors/fixtures/engine-mcp-call.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { seq: number; frame: { response?: { response?: unknown } } })
    .find((entry) => entry.seq === 5)!;
  return row.frame.response!.response as McpStatusResponse;
})();
const reported = (name: string) => (SPIKE.mcpServers as { name: string; config?: unknown }[]).find((server) => server.name === name)!.config;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-hd-entry-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const executable = (path: string) => {
  writeFileSync(path, '#!/bin/sh\nexit 0\n');
  chmodSync(path, 0o755);
  return path;
};

describe('the config file a launch names', () => {
  it('is $CLAUDE_CONFIG_DIR/.claude.json, else $HOME/.claude.json, from the launch environment only', () => {
    expect(configFileOf({ HOME: '/Users/o', CLAUDE_CONFIG_DIR: '/scratch/config' })).toBe('/scratch/config/.claude.json');
    expect(configFileOf({ HOME: '/Users/o' })).toBe('/Users/o/.claude.json');
    expect(configFileOf({ HOME: '/Users/o', CLAUDE_CONFIG_DIR: '' })).toBe('/Users/o/.claude.json'); // the engine's `||`
    expect(legacyConfigFileOf({ HOME: '/Users/o' })).toBe('/Users/o/.claude/.config.json');
    expect(legacyConfigFileOf({ HOME: '/Users/o', CLAUDE_CONFIG_DIR: '/scratch/config' })).toBe('/scratch/config/.config.json');
  });

  it('is unidentified without an absolute home, or under the custom-OAuth file suffix', () => {
    expect(configFileOf({})).toBeNull();
    expect(configFileOf({ HOME: 'relative' })).toBeNull();
    expect(configFileOf({ HOME: '/Users/o', CLAUDE_CONFIG_DIR: 'relative' })).toBeNull();
    expect(configFileOf({ HOME: '/Users/o', CLAUDE_CODE_CUSTOM_OAUTH_URL: 'https://example.invalid' })).toBeNull();
    expect(legacyConfigFileOf({ HOME: '/Users/o', CLAUDE_CONFIG_DIR: '' })).toBeNull();
  });
});

describe('expandVariables (the engine’s ${VAR} and ${VAR:-default}, against the launch environment)', () => {
  const env = { XDG_A: 'alpha', XDG_EMPTY: '', ANTHROPIC_API_KEY: 'k', HOMEBREW_GITHUB_API_TOKEN: 't', CLAUDE_CONFIG_DIR: '/c' };

  it('substitutes a defined variable (empty included), else the default; `$VAR` without braces is literal', () => {
    expect(expandVariables('a-${XDG_A}-b', env)).toBe('a-alpha-b');
    expect(expandVariables('${XDG_EMPTY:-fallback}', env)).toBe('');
    expect(expandVariables('${XDG_MISSING:-fallback}', env)).toBe('fallback');
    expect(expandVariables('${XDG_MISSING:-}', env)).toBe('');
    expect(expandVariables('$XDG_A and plain', env)).toBe('$XDG_A and plain');
  });

  it('refuses an unresolved variable and any other `${…}` form', () => {
    expect(expandVariables('${XDG_MISSING}', env)).toBeNull();
    expect(expandVariables('${XDG_A:=x}', env)).toBeNull();
    expect(expandVariables('${not valid}', env)).toBeNull();
    expect(expandVariables('${}', env)).toBeNull();
  });

  it('refuses, for an omitted field, a variable the engine may withhold from a server: its own and credential-shaped names', () => {
    for (const value of ['${ANTHROPIC_API_KEY}', '${CLAUDE_CONFIG_DIR}', '${HOMEBREW_GITHUB_API_TOKEN}', '${ANTHROPIC_API_KEY:-x}']) expect(expandVariables(value, env, 'omitted'), value).toBeNull();
    // a visible field's expansion is compared with the engine's own report, so it needs no such list
    expect(expandVariables('${HOMEBREW_GITHUB_API_TOKEN}', env, 'visible')).toBe('t');
  });
});

describe('locateEntry (the one JSON location the reported scope names)', () => {
  const file = {
    mcpServers: { top: { command: 'a' } },
    projects: { '/work/p': { mcpServers: { here: { command: 'b' } } }, '/work': { mcpServers: { here: { command: 'c' } } } },
  };

  it('reads user scope at mcpServers[name] and local scope at projects[exact cwd].mcpServers[name]', () => {
    expect(locateEntry(file, 'user', '/work/p', 'top')).toEqual({ entry: { command: 'a' }, entryPath: ['mcpServers', 'top'], alternates: [] });
    expect(locateEntry(file, 'local', '/work/p', 'here')).toEqual({ entry: { command: 'b' }, entryPath: ['projects', '/work/p', 'mcpServers', 'here'], alternates: [{ command: 'c' }] });
  });

  it('is changed when the entry is missing or not an object, never found by another location', () => {
    expect(locateEntry(file, 'user', '/work/p', 'here')).toBe('changed');
    expect(locateEntry(file, 'local', '/work/q', 'here')).toBe('changed');
    expect(locateEntry(file, 'local', '/work/p', 'top')).toBe('changed');
    expect(locateEntry({ mcpServers: { top: 'text' } }, 'user', '/w', 'top')).toBe('changed');
    expect(locateEntry([], 'user', '/w', 'top')).toBe('changed');
  });
});

describe('the visible fields, as mcp_status reports them and as the file gives them', () => {
  it('matches the spike’s reported stdio and http entries from the files that produced them', () => {
    const stdio = reportedVisible(reported('usertoy'))!;
    const fileStdio = { type: 'stdio', command: (reported('usertoy') as { command: string }).command, args: (reported('usertoy') as { args: string[] }).args };
    expect(visibleKey(visibleOfEntry(fileStdio, {}) as never)).toBe(visibleKey(stdio));
    // engine-mcp-call-probe.mjs wrote `${PROBE_FAKE_SECRET}` and the report carries its expanded value
    const http = reportedVisible(reported('userhttp'))!;
    const fileHttp = { type: 'http', url: 'http://127.0.0.1:47831/mcp', headers: { 'X-Probe-Header': '${PROBE_FAKE_SECRET}' } };
    expect(visibleKey(visibleOfEntry(fileHttp, { PROBE_FAKE_SECRET: 'fake-value-not-a-credential' }) as never)).toBe(visibleKey(http));
    expect(visibleKey(visibleOfEntry(fileHttp, { PROBE_FAKE_SECRET: 'other' }) as never)).not.toBe(visibleKey(http));
  });

  it('reads a missing type as stdio, missing args as none and streamable-http as http', () => {
    expect(visibleKey(visibleOfEntry({ command: 'x' }, {}) as never)).toBe(visibleKey(reportedVisible({ type: 'stdio', command: 'x', args: [] })!));
    expect(visibleKey(visibleOfEntry({ type: 'streamable-http', url: 'http://h/m' }, {}) as never)).toBe(visibleKey(reportedVisible({ type: 'http', url: 'http://h/m' })!));
  });

  it('has no supported shape for sse, ws, sdk or claude.ai entries, or a malformed one', () => {
    for (const config of [{ type: 'sse', url: 'http://h' }, { type: 'ws', url: 'ws://h' }, { type: 'sdk', name: 'x' }, { type: 'claudeai-proxy', url: 'https://x', id: '1' }, { type: 'stdio' }, { type: 'stdio', command: 'x', args: [1] }, undefined]) {
      expect(reportedVisible(config), JSON.stringify(config)).toBeNull();
      expect(visibleOfEntry((config ?? {}) as Record<string, unknown>, {}), JSON.stringify(config)).toBeNull();
    }
    expect(visibleOfEntry({ command: '${XDG_MISSING}' }, {})).toBe('unresolved');
  });
});

describe('materializeEntry (the whole entry, for MAWS’s own instance)', () => {
  it('runs the command found on the launch PATH with the SDK’s minimal launch environment plus exactly the configured env', async () => {
    const first = join(dir, 'first');
    const second = join(dir, 'second');
    mkdirSync(first);
    mkdirSync(second);
    const tool = executable(join(second, 'probe-tool'));
    const launch = { PATH: `${first}:${second}`, HOME: '/h', USER: 'u', LOGNAME: 'u', SHELL: '/bin/zsh', TERM: 'dumb', TMPDIR: '/t', LANG: 'en', XDG_V: 'v', FN: '() { :; }' };
    const entry = { type: 'stdio', command: 'probe-tool', args: ['--v', '${XDG_V}', './rel'], env: { PLAIN: 'p', EXPANDED: '${XDG_V}', DEFAULTED: '${XDG_NONE:-d}' } };
    const made = await materializeEntry(entry, launch, '/work/p', nodeSourceFiles);
    expect(made).toEqual({
      visible: { transport: 'stdio', command: 'probe-tool', args: ['--v', 'v', './rel'] },
      launch: { transport: 'stdio', command: 'probe-tool', executable: tool, args: ['--v', 'v', './rel'], cwd: '/work/p', env: { HOME: '/h', LOGNAME: 'u', PATH: `${first}:${second}`, SHELL: '/bin/zsh', TERM: 'dumb', USER: 'u', PLAIN: 'p', EXPANDED: 'v', DEFAULTED: 'd' } },
    });
    // the host's own PATH never resolves it
    expect(await materializeEntry(entry, { ...launch, PATH: '/usr/bin' }, '/work/p', nodeSourceFiles)).toBe('unresolved');
  });

  it('resolves a relative command against the launch cwd and a configured PATH override as the spawn would', async () => {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const tool = executable(join(bin, 'tool'));
    expect(await materializeEntry({ command: './bin/tool' }, { PATH: '/usr/bin' }, dir, nodeSourceFiles)).toMatchObject({ launch: { executable: tool, cwd: dir } });
    expect(await materializeEntry({ command: 'tool', env: { PATH: bin } }, { PATH: '/usr/bin' }, dir, nodeSourceFiles)).toMatchObject({ launch: { executable: tool, env: { PATH: bin } } });
    expect(await materializeEntry({ command: 'tool' }, {}, dir, nodeSourceFiles)).toBe('unresolved'); // no launch PATH
    expect(await materializeEntry({ command: join(dir, 'absent') }, {}, dir, nodeSourceFiles)).toBe('unresolved');
  });

  it('reads an http entry’s headers transiently, expanded against the launch environment', async () => {
    const made = await materializeEntry({ type: 'http', url: 'http://127.0.0.1:1/${XDG_P}', headers: { 'X-H': 'v-${XDG_P}' } }, { XDG_P: 'mcp' }, '/w', nodeSourceFiles);
    expect(made).toEqual({ visible: { transport: 'http', url: 'http://127.0.0.1:1/mcp', headers: { 'X-H': 'v-mcp' } }, launch: { transport: 'http', url: 'http://127.0.0.1:1/mcp', headers: { 'X-H': 'v-mcp' } } });
  });

  it('is engine-only for helpers, manual OAuth clients, unknown options and unsupported transports; unresolved for a withheld variable', async () => {
    for (const entry of [
      { type: 'http', url: 'http://h/m', headersHelper: '/bin/helper' },
      { type: 'http', url: 'http://h/m', oauth: { clientId: 'c' } },
      { command: 'x', cwd: '/elsewhere' },
      { type: 'sse', url: 'http://h/m' },
    ])
      expect(await materializeEntry(entry, { PATH: '/usr/bin' }, '/w', nodeSourceFiles), JSON.stringify(entry)).toBe('engineOnly');
    const tool = executable(join(dir, 'tool'));
    expect(await materializeEntry({ command: tool, env: { K: '${ANTHROPIC_API_KEY}' } }, { ANTHROPIC_API_KEY: 'k' }, dir, nodeSourceFiles)).toBe('unresolved');
    expect(await materializeEntry({ command: tool, env: { K: '${XDG_NONE}' } }, {}, dir, nodeSourceFiles)).toBe('unresolved');
    expect(await materializeEntry({ command: tool, env: { K: 7 } }, {}, dir, nodeSourceFiles)).toBe('changed');
  });
});
