// P3-HD M1: route D's source lookup and its one file entry (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md,
// "Source truth and lifetime"; P3 co-work Decision Log 98 (1) and (2), with P3-HD's settings ruling, branch B from probe
// run 39007800364). The file a launch's environment names, the one JSON location a scope names in it (never another
// key), literal entries only (any `${…}` reference is unattested), the visible fields compared as mcp_status reports them
// (spikes/p3-connectors/fixtures/engine-mcp-call.jsonl seq 5), the whole entry made into what MAWS's own instance would
// run, and the config file read under a cap that holds on the bytes actually read.
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { McpStatusResponse } from '@shared/wire/control';
import { configFileOf, legacyConfigFileOf, locateEntry, materializeEntry, nodeSourceFiles, reportedVisible, visibleKey, visibleOfEntry } from './source-entry';

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

describe('locateEntry (exactly the JSON location it is given)', () => {
  const file = {
    mcpServers: { top: { command: 'a' } },
    projects: { '/work/p': { mcpServers: { here: { command: 'b' } } }, '/work': { mcpServers: { here: { command: 'c' } } } },
  };

  it('reads user scope at mcpServers[name] and local scope at projects[key].mcpServers[name] for that key alone', () => {
    expect(locateEntry(file, 'user', '/work/p', 'top')).toEqual({ entry: { command: 'a' }, entryPath: ['mcpServers', 'top'] });
    expect(locateEntry(file, 'local', '/work/p', 'here')).toEqual({ entry: { command: 'b' }, entryPath: ['projects', '/work/p', 'mcpServers', 'here'] });
    expect(locateEntry(file, 'local', '/work', 'here')).toEqual({ entry: { command: 'c' }, entryPath: ['projects', '/work', 'mcpServers', 'here'] });
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
  it('matches the spike’s reported stdio entry and a literal http entry; the spike’s referencing http entry is unattested', () => {
    const stdio = reportedVisible(reported('usertoy'))!;
    const fileStdio = { type: 'stdio', command: (reported('usertoy') as { command: string }).command, args: (reported('usertoy') as { args: string[] }).args };
    expect(visibleKey(visibleOfEntry(fileStdio) as never)).toBe(visibleKey(stdio));
    // engine-mcp-call-probe.mjs wrote `${PROBE_FAKE_SECRET}` and the report carries its expanded value
    const http = reportedVisible(reported('userhttp'))!;
    const fileHttp = { type: 'http', url: 'http://127.0.0.1:47831/mcp', headers: { 'X-Probe-Header': '${PROBE_FAKE_SECRET}' } };
    expect(visibleOfEntry(fileHttp)).toBe('unattested');
    const literal = { type: 'http', url: 'http://127.0.0.1:47831/mcp', headers: { 'X-Probe-Header': 'fake-value-not-a-credential' } };
    expect(visibleKey(visibleOfEntry(literal) as never)).toBe(visibleKey(http));
    expect(visibleKey(visibleOfEntry({ ...literal, headers: { 'X-Probe-Header': 'other' } }) as never)).not.toBe(visibleKey(http));
  });

  it('reads a missing type as stdio, missing args as none and streamable-http as http', () => {
    expect(visibleKey(visibleOfEntry({ command: 'x' }) as never)).toBe(visibleKey(reportedVisible({ type: 'stdio', command: 'x', args: [] })!));
    expect(visibleKey(visibleOfEntry({ type: 'streamable-http', url: 'http://h/m' }) as never)).toBe(visibleKey(reportedVisible({ type: 'http', url: 'http://h/m' })!));
  });

  it('has no supported shape for sse, ws, sdk or claude.ai entries, or a malformed one', () => {
    for (const config of [{ type: 'sse', url: 'http://h' }, { type: 'ws', url: 'ws://h' }, { type: 'sdk', name: 'x' }, { type: 'claudeai-proxy', url: 'https://x', id: '1' }, { type: 'stdio' }, { type: 'stdio', command: 'x', args: [1] }, undefined]) {
      expect(reportedVisible(config), JSON.stringify(config)).toBeNull();
      expect(visibleOfEntry((config ?? {}) as Record<string, unknown>), JSON.stringify(config)).toBeNull();
    }
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
    const entry = { type: 'stdio', command: 'probe-tool', args: ['--v', './rel'], env: { PLAIN: 'p', DOLLAR: 'a$b' } };
    expect(await materializeEntry(entry, launch, '/work/p', nodeSourceFiles)).toEqual({
      visible: { transport: 'stdio', command: 'probe-tool', args: ['--v', './rel'] },
      launch: { transport: 'stdio', command: 'probe-tool', executable: tool, args: ['--v', './rel'], cwd: '/work/p', env: { HOME: '/h', LOGNAME: 'u', PATH: `${first}:${second}`, SHELL: '/bin/zsh', TERM: 'dumb', USER: 'u', PLAIN: 'p', DOLLAR: 'a$b' } },
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

  // P3-HD panel correction: the engine's spawn searches a relative or empty PATH component from its cwd, so skipping one
  // could select a later absolute match the engine never runs, under the same visible command and fingerprint
  it('refuses a bare command when a relative or empty PATH component precedes its first match', async () => {
    const project = join(dir, 'project');
    const absolute = join(dir, 'absolute');
    mkdirSync(join(project, 'rel'), { recursive: true });
    mkdirSync(absolute);
    executable(join(project, 'rel', 'probe'));
    const tool = executable(join(absolute, 'probe'));
    for (const path of [`rel:${absolute}`, `:${absolute}`, `${absolute}/../absolute/../nowhere::${absolute}`, `./rel:${absolute}`]) {
      expect(await materializeEntry({ command: 'probe' }, { PATH: path }, project, nodeSourceFiles), path).toBe('unresolved');
    }
    // a relative component after the first absolute match is never reached by either search
    expect(await materializeEntry({ command: 'probe' }, { PATH: `${absolute}:rel:` }, project, nodeSourceFiles)).toMatchObject({ launch: { executable: tool } });
  });

  it('reads an http entry’s headers transiently; a referencing url or header is unattested', async () => {
    expect(await materializeEntry({ type: 'http', url: 'http://127.0.0.1:1/mcp', headers: { 'X-H': 'literal' } }, {}, '/w', nodeSourceFiles)).toEqual({
      visible: { transport: 'http', url: 'http://127.0.0.1:1/mcp', headers: { 'X-H': 'literal' } },
      launch: { transport: 'http', url: 'http://127.0.0.1:1/mcp', headers: { 'X-H': 'literal' } },
    });
    const referencing = { type: 'http', url: 'http://127.0.0.1:1/${XDG_P}', headers: { 'X-H': 'v-${XDG_P}' } };
    expect(await materializeEntry(referencing, { XDG_P: 'mcp' }, '/w', nodeSourceFiles)).toBe('unattested');
    expect(await materializeEntry({ type: 'http', url: 'http://127.0.0.1:1/mcp', headers: { 'X-H': 'v-${XDG_P}' } }, { XDG_P: 'mcp' }, '/w', nodeSourceFiles)).toBe('unattested');
  });

  it('is unattested for any reference in the command, an argument or an env value, its variable present or not', async () => {
    const tool = executable(join(dir, 'tool'));
    const env = { XDG_V: 'v', PATH: dir };
    for (const entry of [{ command: '${XDG_V}' }, { command: tool, args: ['${XDG_V}'] }, { command: tool, args: ['x${XDG_NONE:-d}'] }, { command: tool, env: { K: '${XDG_V}' } }, { command: tool, env: { K: '${XDG_NONE:-d}' } }])
      expect(await materializeEntry(entry, env, dir, nodeSourceFiles), JSON.stringify(entry)).toBe('unattested');
    // `$VAR` without braces is literal text to the engine and here
    expect(await materializeEntry({ command: tool, args: ['$XDG_V'], env: { K: 'a$b' } }, env, dir, nodeSourceFiles)).toMatchObject({ launch: { args: ['$XDG_V'], env: { K: 'a$b' } } });
  });

  it('is engine-only for helpers, manual OAuth clients, unknown options and unsupported transports', async () => {
    for (const entry of [
      { type: 'http', url: 'http://h/m', headersHelper: '/bin/helper' },
      { type: 'http', url: 'http://h/m', oauth: { clientId: 'c' } },
      { command: 'x', cwd: '/elsewhere' },
      { type: 'sse', url: 'http://h/m' },
    ])
      expect(await materializeEntry(entry, { PATH: '/usr/bin' }, '/w', nodeSourceFiles), JSON.stringify(entry)).toBe('engineOnly');
    const tool = executable(join(dir, 'tool'));
    expect(await materializeEntry({ command: tool, env: { K: 7 } }, {}, dir, nodeSourceFiles)).toBe('changed');
  });
});

describe('nodeSourceFiles.exists (the legacy file check)', () => {
  it('is true for a present path and false only for an absent one; any other failure is not an absence', async () => {
    const present = join(dir, 'present');
    writeFileSync(present, '{}');
    expect(await nodeSourceFiles.exists(present)).toBe(true);
    expect(await nodeSourceFiles.exists(join(dir, 'absent'))).toBe(false);
    expect(await nodeSourceFiles.exists(join(present, 'under-a-file'))).toBe(false); // ENOTDIR
    await expect(nodeSourceFiles.exists(join(dir, 'x'.repeat(300)))).rejects.toMatchObject({ code: 'ENAMETOOLONG' });
  });
});

describe('nodeSourceFiles.read (the config file under its cap)', () => {
  it('reads a file up to the cap and refuses one byte past it, counting the bytes it actually reads', async () => {
    const path = join(dir, 'file.json');
    writeFileSync(path, 'x'.repeat(100));
    expect(await nodeSourceFiles.read(path, 100)).toBe('x'.repeat(100));
    await expect(nodeSourceFiles.read(path, 99)).rejects.toThrow(/larger than 99 bytes/);
    expect(await nodeSourceFiles.read(join(dir, 'absent'), 10)).toBeNull();
  });

  it('refuses what is not a regular file without hanging: a FIFO with no writer, a character device, a directory', async () => {
    const fifo = join(dir, 'fifo');
    execFileSync('mkfifo', [fifo]);
    await expect(nodeSourceFiles.read(fifo, 10)).rejects.toThrow(/not a regular file/);
    await expect(nodeSourceFiles.read('/dev/zero', 10)).rejects.toThrow(/not a regular file/); // size 0, endless
    await expect(nodeSourceFiles.read(dir, 10)).rejects.toThrow(/not a regular file/);
  });
});
