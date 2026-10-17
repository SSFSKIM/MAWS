// P3-HD M1: the host-memory observation cache behind route D (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md,
// "Source truth and lifetime"; P3 co-work Decision Log 98 (1)-(3) and (9)). Observations come only from a live
// mcp_status answer tied to the exact launch that answered it; a server is a verified source only when every report of
// its launch context agrees, its scope is user or local, and the one entry that scope names in the launch's own config
// file still matches what the engine reported. Scratch config files throughout; the spike's seq 5 answer is the report.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { McpStatusResponse } from '@shared/wire/control';
import { connectorToolState } from './status';
import { CONNECTOR_STATUS_BOUNDS, ConnectorStatusCache, connectorLaunchContext, type ConnectorLaunchContext } from './provenance';
import { nodeSourceFiles, type SourceFiles } from './source-entry';

type Private = { current: Map<string, string>; retired: Set<string> };

const REPO_ROOT = resolve(__dirname, '../../..');
type Server = { name: string; status: string; scope?: string; source?: string; config?: Record<string, unknown>; tools?: { name: string; annotations?: Record<string, unknown> }[] };
const SPIKE: McpStatusResponse = (() => {
  const row = readFileSync(join(REPO_ROOT, 'spikes/p3-connectors/fixtures/engine-mcp-call.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { seq: number; frame: { response?: { response?: unknown } } })
    .find((entry) => entry.seq === 5)!;
  return row.frame.response!.response as McpStatusResponse;
})();
const spikeServer = (name: string): Server => structuredClone((SPIKE.mcpServers as Server[]).find((server) => server.name === name)!);
const report = (...servers: Server[]): McpStatusResponse => ({ mcpServers: servers });
const without = (answer: McpStatusResponse, name: string): McpStatusResponse => ({ mcpServers: (answer.mcpServers as Server[]).filter((server) => server.name !== name) });

const SECRET_ENV = 'omitted-env-literal-7f3a';
const HEADER = 'fake-value-not-a-credential';

let dir: string;
let home: string;
let config: string;
let project: string;
let bin: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-hd-provenance-'));
  home = join(dir, 'home');
  config = join(dir, 'config');
  project = join(dir, 'project');
  bin = join(dir, 'bin');
  for (const path of [home, config, project, bin]) mkdirSync(path);
  // the spike's stdio command, as the report spells it, made runnable on the launch PATH's directory
  writeFileSync(join(bin, 'toy'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(bin, 'toy'), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const stdio = (name: string, args: string[] = ['toy-server.mjs', 'stdio']): Server => ({ name, status: 'connected', scope: 'user', source: 'user', config: { type: 'stdio', command: 'toy', args }, tools: [{ name: 'metrics_snapshot', annotations: { readOnly: true } }, { name: 'send_document', annotations: {} }] });
const userhttp = (): Server => spikeServer('userhttp');
// the scratch user file behind those reports: the spike's servers as engine-mcp-call-probe.mjs configured them
function writeConfig(edit: (file: Record<string, unknown>) => void = () => {}): void {
  const file: Record<string, unknown> = {
    hasCompletedOnboarding: true,
    mcpServers: {
      usertoy: { type: 'stdio', command: 'toy', args: ['toy-server.mjs', 'stdio'], env: { TOY_SECRET: SECRET_ENV } },
      userhttp: { type: 'http', url: 'http://127.0.0.1:47831/mcp', headers: { 'X-Probe-Header': HEADER } },
    },
    projects: { [project]: { mcpServers: { localtoy: { command: 'toy', args: ['local'] } } } },
  };
  edit(file);
  writeFileSync(join(config, '.claude.json'), JSON.stringify(file));
}
const environment = (extra: Record<string, string> = {}) => ({ HOME: home, CLAUDE_CONFIG_DIR: config, PATH: bin, USER: 'u', LOGNAME: 'u', SHELL: '/bin/zsh', TERM: 'dumb', TMPDIR: '/t', XDG_TOY: 'expanded', XDG_HEADER: HEADER, ...extra });
const launch = (appSessionId = 'app-1', launchId = 'L1', extra: Record<string, string> = {}, cwd = project): ConnectorLaunchContext => connectorLaunchContext({ appSessionId, launchId, cwd, environment: environment(extra) });
const USER_REPORT = () => report(stdio('usertoy'), userhttp(), { ...stdio('localtoy', ['local']), scope: 'local', source: 'local' }, spikeServer('projtoy'), spikeServer('dyntoy'));

function observed(cache: ConnectorStatusCache, context: ConnectorLaunchContext, answer: McpStatusResponse): void {
  cache.observe(cache.begin(context), answer);
}

describe('ConnectorStatusCache: a verified source from one live report', () => {
  it('admits user entries the launch’s own file holds, with H’s fingerprint and the reported readOnly', async () => {
    writeConfig();
    const cache = new ConnectorStatusCache();
    const answer = USER_REPORT();
    observed(cache, launch(), answer);
    const read = await cache.resolve(project, 'usertoy', 'metrics_snapshot');
    expect(read).toMatchObject({ ok: true, source: { cwd: project, server: 'usertoy', scope: 'user', transport: 'stdio', path: join(config, '.claude.json'), entryPath: ['mcpServers', 'usertoy'] }, tool: { readOnly: true } });
    const ready = connectorToolState(answer, 'usertoy', 'metrics_snapshot');
    expect(read.ok && ready.ready && read.tool.fingerprint === ready.fingerprint).toBe(true); // a route change alone never re-grants
    expect(await cache.resolve(project, 'usertoy', 'send_document')).toMatchObject({ ok: true, tool: { readOnly: false } });
    expect(await cache.resolve(project, 'usertoy', 'not_listed')).toMatchObject({ ok: true, tool: { readOnly: null } });
    const http = await cache.resolve(project, 'userhttp', 'metrics_snapshot');
    expect(http).toMatchObject({ ok: true, source: { transport: 'http', url: 'http://127.0.0.1:47831/mcp' } });
    const httpReady = connectorToolState(answer, 'userhttp', 'metrics_snapshot');
    expect(http.ok && httpReady.ready && http.tool.fingerprint === httpReady.fingerprint).toBe(true);
  });

  it('keeps project, dynamic and unreported servers engine-only or unobserved, and a directory nobody reported unobserved', async () => {
    writeConfig();
    const cache = new ConnectorStatusCache();
    observed(cache, launch(), USER_REPORT());
    expect(await cache.resolveSource(project, 'projtoy')).toEqual({ ok: false, why: 'engineOnly' });
    expect(await cache.resolveSource(project, 'dyntoy')).toEqual({ ok: false, why: 'engineOnly' });
    expect(await cache.resolveSource(project, 'nosuch')).toEqual({ ok: false, why: 'unobserved' });
    expect(await cache.resolveSource(join(dir, 'other'), 'usertoy')).toEqual({ ok: false, why: 'unobserved' });
  });

  it('admits a needs-auth server’s source with no tool metadata, for the owner’s first Connect', async () => {
    writeConfig();
    const cache = new ConnectorStatusCache();
    observed(cache, launch(), report({ ...userhttp(), status: 'needs-auth', tools: undefined }));
    expect(await cache.resolveSource(project, 'userhttp')).toMatchObject({ ok: true, source: { server: 'userhttp', transport: 'http' } });
    expect(await cache.resolve(project, 'userhttp', 'metrics_snapshot')).toMatchObject({ ok: true, tool: { readOnly: null } });
    // pending, failed and the like attest nothing
    const pending = new ConnectorStatusCache();
    observed(pending, launch(), report({ ...userhttp(), status: 'pending', tools: undefined }));
    expect(await pending.resolveSource(project, 'userhttp')).toEqual({ ok: false, why: 'unobserved' });
  });

  it('is unidentified when the launch environment names no file, or the engine’s legacy file could be the one it read', async () => {
    writeConfig();
    const cache = new ConnectorStatusCache();
    observed(cache, connectorLaunchContext({ appSessionId: 'app-1', launchId: 'L1', cwd: project, environment: { PATH: bin } }), USER_REPORT());
    expect(await cache.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'unidentified' });
    const legacy = new ConnectorStatusCache();
    observed(legacy, launch(), USER_REPORT());
    writeFileSync(join(config, '.config.json'), '{}');
    expect(await legacy.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'unidentified' });
  });

  it('is changed when the entry left the file or its visible fields no longer match; an omitted field’s change only moves the digest', async () => {
    writeConfig();
    const cache = new ConnectorStatusCache();
    observed(cache, launch(), USER_REPORT());
    const first = await cache.resolveSource(project, 'usertoy');
    writeConfig((file) => ((file.mcpServers as Record<string, { env: Record<string, string> }>).usertoy.env.TOY_SECRET = 'rotated'));
    const second = await cache.resolveSource(project, 'usertoy');
    expect(first.ok && second.ok && first.source.sourceId === second.source.sourceId && first.source.entryDigest !== second.source.entryDigest).toBe(true);
    writeConfig((file) => ((file.mcpServers as Record<string, { args: string[] }>).usertoy.args = ['toy-server.mjs', 'http']));
    expect(await cache.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'changed' });
    writeConfig((file) => delete (file.mcpServers as Record<string, unknown>).usertoy);
    expect(await cache.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'changed' });
    // never another location: the same entry under the project does not stand in for the user one
    writeConfig((file) => {
      const servers = file.mcpServers as Record<string, unknown>;
      (file.projects as Record<string, { mcpServers: Record<string, unknown> }>)[project].mcpServers.usertoy = servers.usertoy;
      delete servers.usertoy;
    });
    expect(await cache.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'changed' });
  });

  it('keeps local scope engine-only until the engine’s projects key is attested, and reads no other key for it', async () => {
    writeConfig((file) => ((file.projects as Record<string, unknown>)[dir] = { mcpServers: { localtoy: { command: 'toy', args: ['local'] } } }));
    let reads = 0;
    const files: SourceFiles = { ...nodeSourceFiles, read: async (path, max) => (reads++, nodeSourceFiles.read(path, max)) };
    const cache = new ConnectorStatusCache({ files });
    observed(cache, launch(), report({ ...stdio('localtoy', ['local']), scope: 'local', source: 'local' }));
    expect(await cache.resolveSource(project, 'localtoy')).toEqual({ ok: false, why: 'unidentified' });
    expect(reads).toBe(0); // refused before any lookup, so no candidate key is ever scanned
  });
});

describe('ConnectorStatusCache: what MAWS’s own instance reads', () => {
  it('reads the whole entry transiently: the launch’s minimal environment and PATH plus the configured env, never the host’s', async () => {
    writeConfig();
    const cache = new ConnectorStatusCache();
    observed(cache, launch(), USER_REPORT());
    const source = await cache.resolveSource(project, 'usertoy');
    if (!source.ok) throw new Error(source.why);
    const read = await cache.readEntry(source.source);
    expect(read).toEqual({
      ok: true,
      source: source.source,
      entry: { transport: 'stdio', command: 'toy', executable: join(bin, 'toy'), args: ['toy-server.mjs', 'stdio'], cwd: project, env: { HOME: home, LOGNAME: 'u', PATH: bin, SHELL: '/bin/zsh', TERM: 'dumb', USER: 'u', TOY_SECRET: SECRET_ENV } },
    });
    expect(process.env.PATH).not.toBe(bin);
    const http = await cache.resolveSource(project, 'userhttp');
    if (!http.ok) throw new Error(http.why);
    expect(await cache.readEntry(http.source)).toMatchObject({ ok: true, entry: { transport: 'http', url: 'http://127.0.0.1:47831/mcp', headers: { 'X-Probe-Header': HEADER } } });
  });

  it('keeps no omitted value, header or report configuration in its memory or its answers', async () => {
    writeConfig();
    const cache = new ConnectorStatusCache();
    observed(cache, launch(), USER_REPORT());
    const source = await cache.resolveSource(project, 'usertoy');
    const http = await cache.resolve(project, 'userhttp', 'metrics_snapshot');
    if (!source.ok) throw new Error(source.why);
    await cache.readEntry(source.source);
    for (const held of [inspect(cache, { depth: Infinity, showHidden: true }), JSON.stringify(source), JSON.stringify(http)]) {
      expect(held).not.toContain(SECRET_ENV);
      expect(held).not.toContain('toy-server.mjs'); // even visible args stay in the file and the report, never the cache
    }
    expect(JSON.stringify(source)).not.toContain(HEADER);
    expect(JSON.stringify(http)).not.toContain(HEADER);
  });

  it('refuses a source whose meaning changed since it was resolved, rather than reading another', async () => {
    writeConfig();
    const cache = new ConnectorStatusCache();
    const context = launch();
    observed(cache, context, USER_REPORT());
    const source = await cache.resolveSource(project, 'usertoy');
    if (!source.ok) throw new Error(source.why);
    observed(cache, context, without(USER_REPORT(), 'usertoy')); // the same launch's newer report
    expect(await cache.readEntry(source.source)).toEqual({ ok: false, why: 'unobserved' });
    observed(cache, context, USER_REPORT());
    const again = await cache.resolveSource(project, 'usertoy');
    expect(again.ok && again.source.sourceId !== source.source.sourceId && again.source.generation > source.source.generation).toBe(true);
    expect(await cache.readEntry(source.source)).toEqual({ ok: false, why: 'changed' });
  });
});

describe('ConnectorStatusCache: complete reports, replacement and negative provenance', () => {
  it('a launch’s newer complete report replaces its older one, removal included', async () => {
    writeConfig();
    const cache = new ConnectorStatusCache();
    const context = launch();
    observed(cache, context, USER_REPORT());
    observed(cache, context, without(USER_REPORT(), 'usertoy'));
    expect(await cache.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'unobserved' });
    expect(await cache.resolveSource(project, 'userhttp')).toMatchObject({ ok: true });
  });

  it('a late answer to an older request of the same launch never rolls a newer one back', async () => {
    writeConfig();
    const cache = new ConnectorStatusCache();
    const context = launch();
    const older = cache.begin(context);
    const newer = cache.begin(context);
    cache.observe(newer, without(USER_REPORT(), 'usertoy'));
    cache.observe(older, USER_REPORT());
    expect(await cache.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'unobserved' });
  });

  it('a late answer from a launch its session replaced cannot repopulate the cache', async () => {
    writeConfig();
    const cache = new ConnectorStatusCache();
    const replaced = cache.begin(launch('app-1', 'L1'));
    cache.begin(launch('app-1', 'L2'));
    cache.observe(replaced, USER_REPORT());
    expect(await cache.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'unobserved' });
  });

  it('positive, exit, then another launch reporting it absent or disabled: engine-only until the attachment resets', async () => {
    writeConfig();
    for (const contrary of [without(USER_REPORT(), 'usertoy'), report(...(USER_REPORT().mcpServers as Server[]).map((server) => (server.name === 'usertoy' ? { ...server, status: 'disabled' } : server)))]) {
      const cache = new ConnectorStatusCache();
      observed(cache, launch('app-1', 'L1'), USER_REPORT()); // its engine then exits; the observation stays
      const second = launch('app-2', 'L2');
      observed(cache, second, contrary);
      expect(await cache.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'ambiguous' });
      expect(await cache.resolveSource(project, 'userhttp')).toMatchObject({ ok: true }); // the others still agree
      observed(cache, second, USER_REPORT()); // a later agreeing report does not erase the contradiction
      expect(await cache.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'ambiguous' });
      cache.clear();
      expect(await cache.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'unobserved' });
      observed(cache, launch('app-3', 'L3'), USER_REPORT());
      expect(await cache.resolveSource(project, 'usertoy')).toMatchObject({ ok: true });
    }
  });

  it('two launches reporting different identities, or one server twice, are ambiguous', async () => {
    writeConfig();
    const cache = new ConnectorStatusCache();
    observed(cache, launch('app-1', 'L1'), USER_REPORT());
    observed(cache, launch('app-2', 'L2'), report(stdio('usertoy', ['toy-server.mjs', 'http']), userhttp()));
    expect(await cache.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'ambiguous' });
    const twice = new ConnectorStatusCache();
    observed(twice, launch(), report(stdio('usertoy'), stdio('usertoy')));
    expect(await twice.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'ambiguous' });
  });

  it('agreeing launches must also give the entry one meaning: a different launch PATH is ambiguous', async () => {
    writeConfig();
    const other = join(dir, 'other-bin');
    mkdirSync(other);
    writeFileSync(join(other, 'toy'), '#!/bin/sh\n');
    chmodSync(join(other, 'toy'), 0o755);
    const cache = new ConnectorStatusCache();
    observed(cache, launch('app-1', 'L1'), USER_REPORT());
    observed(cache, launch('app-2', 'L2', { PATH: other }), USER_REPORT());
    expect(await cache.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'ambiguous' });
  });

  it('config homes at one directory: one positive is a source; two positives naming two files are ambiguous', async () => {
    writeConfig();
    const config2 = join(dir, 'config2');
    mkdirSync(config2);
    writeFileSync(join(config2, '.claude.json'), readFileSync(join(config, '.claude.json')));
    const cache = new ConnectorStatusCache();
    observed(cache, launch('app-1', 'L1'), USER_REPORT());
    observed(cache, launch('app-2', 'L2', { CLAUDE_CONFIG_DIR: config2 }), without(USER_REPORT(), 'usertoy'));
    expect(await cache.resolveSource(project, 'usertoy')).toMatchObject({ ok: true, source: { path: join(config, '.claude.json') } });
    observed(cache, launch('app-3', 'L3', { CLAUDE_CONFIG_DIR: config2 }), USER_REPORT());
    expect(await cache.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'ambiguous' });
  });
});

describe('ConnectorStatusCache: bounds and fences fail closed', () => {
  it('a malformed or overbound newer report fails its context closed instead of leaving the older positive usable', async () => {
    writeConfig();
    const cache = new ConnectorStatusCache();
    const context = launch();
    observed(cache, context, USER_REPORT());
    const many = report(...Array.from({ length: CONNECTOR_STATUS_BOUNDS.serversPerContext + 1 }, (_, i) => stdio(`s${i}`)));
    observed(cache, context, many);
    expect(await cache.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'unavailable' });
    const rejected = new ConnectorStatusCache();
    observed(rejected, context, USER_REPORT());
    rejected.reject(rejected.begin(context)); // an answer that failed mcp_status's schema
    expect(await rejected.resolveSource(project, 'userhttp')).toEqual({ ok: false, why: 'unavailable' });
  });

  it('refuses new observations past the directory-context bound rather than evicting one, failing closed where they were refused', async () => {
    writeConfig();
    const cache = new ConnectorStatusCache();
    observed(cache, launch(), USER_REPORT());
    for (let i = 1; i < CONNECTOR_STATUS_BOUNDS.contexts; i++) observed(cache, launch(`app-${i}`, `L${i}`, {}, join(dir, `d${i}`)), report());
    expect(await cache.resolveSource(project, 'usertoy')).toMatchObject({ ok: true });
    observed(cache, launch('app-x', 'Lx', {}, join(dir, 'one-too-many')), USER_REPORT());
    expect(await cache.resolveSource(join(dir, 'one-too-many'), 'usertoy')).toEqual({ ok: false, why: 'unavailable' });
    expect(await cache.resolveSource(project, 'usertoy')).toMatchObject({ ok: true }); // nothing admitted was evicted
    // a refused report at an admitted directory (another config home) could have contradicted it: unavailable there too
    observed(cache, launch('app-y', 'Ly', { CLAUDE_CONFIG_DIR: join(dir, 'config2') }), USER_REPORT());
    expect(await cache.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'unavailable' });
    for (let i = 0; i < CONNECTOR_STATUS_BOUNDS.contexts; i++) observed(cache, launch(`app-r${i}`, `Lr${i}`, {}, join(dir, `r${i}`)), report());
    expect(await cache.resolveSource(join(dir, 'd1'), 'usertoy')).toEqual({ ok: false, why: 'unavailable' }); // past both bounds
    cache.clear();
    observed(cache, launch(), USER_REPORT());
    expect(await cache.resolveSource(project, 'usertoy')).toMatchObject({ ok: true });
  });

  it('clear invalidates an observation begun before it and a file read in flight', async () => {
    writeConfig();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const files: SourceFiles = { ...nodeSourceFiles, read: async (path, max) => (await held, nodeSourceFiles.read(path, max)) };
    const cache = new ConnectorStatusCache({ files });
    observed(cache, launch(), USER_REPORT());
    const reading = cache.resolveSource(project, 'usertoy');
    cache.clear();
    observed(cache, launch('app-2', 'L2'), USER_REPORT()); // a fresh attachment's observation meanwhile
    release();
    expect(await reading).toEqual({ ok: false, why: 'unavailable' });
    const before = cache.begin(launch('app-3', 'L3'));
    cache.clear();
    cache.observe(before, USER_REPORT());
    expect(await cache.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'unobserved' });
  });

  it('a report observed while the file was being read answers what a fresh lookup answers, never the older meaning', async () => {
    writeConfig();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const files: SourceFiles = { ...nodeSourceFiles, read: async (path, max) => (await held, nodeSourceFiles.read(path, max)) };
    const cache = new ConnectorStatusCache({ files });
    const context = launch();
    observed(cache, context, USER_REPORT());
    const reading = cache.resolveSource(project, 'usertoy');
    observed(cache, context, without(USER_REPORT(), 'usertoy'));
    release();
    expect(await reading).toEqual({ ok: false, why: 'unobserved' });
    expect(await reading).toEqual(await cache.resolveSource(project, 'usertoy'));
  });

  // Finding 1: every mutation of the cache while a lookup is suspended, not only the chosen context's revision.
  const suspended = () => {
    let started!: () => void;
    const gate: { release?: () => void; pending: number; reading: Promise<void> } = { pending: 0, reading: new Promise<void>((resolve) => (started = resolve)) };
    const files: SourceFiles = {
      ...nodeSourceFiles,
      read: async (path, max) => {
        if (gate.pending++ === 0) {
          const held = new Promise<void>((resolve) => (gate.release = resolve));
          started(); // the lookup is suspended in its read now
          await held;
        }
        return nodeSourceFiles.read(path, max);
      },
    };
    return { gate, files };
  };

  it('a suspended lookup answers ambiguous when another config home reports the server meanwhile, as a fresh one would', async () => {
    writeConfig();
    const config2 = join(dir, 'config2');
    mkdirSync(config2);
    writeFileSync(join(config2, '.claude.json'), readFileSync(join(config, '.claude.json')));
    const { gate, files } = suspended();
    const cache = new ConnectorStatusCache({ files });
    observed(cache, launch(), USER_REPORT());
    const reading = cache.resolveSource(project, 'usertoy');
    await gate.reading;
    observed(cache, launch('app-2', 'L2', { CLAUDE_CONFIG_DIR: config2 }), USER_REPORT());
    gate.release!();
    expect(await reading).toEqual({ ok: false, why: 'ambiguous' });
    expect(await cache.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'ambiguous' });
  });

  it('a suspended lookup answers ambiguous when an agreeing launch with another PATH reports meanwhile', async () => {
    writeConfig();
    const other = join(dir, 'other-bin');
    mkdirSync(other);
    writeFileSync(join(other, 'toy'), '#!/bin/sh\n');
    chmodSync(join(other, 'toy'), 0o755);
    const { gate, files } = suspended();
    const cache = new ConnectorStatusCache({ files });
    observed(cache, launch(), USER_REPORT());
    const reading = cache.resolveSource(project, 'usertoy');
    await gate.reading;
    observed(cache, launch('app-2', 'L2', { PATH: other }), USER_REPORT());
    gate.release!();
    expect(await reading).toEqual({ ok: false, why: 'ambiguous' });
  });

  it('a suspended lookup answers unavailable when its directory is refused or the cache saturates meanwhile', async () => {
    for (const fill of ['refuse', 'saturate'] as const) {
      writeConfig();
      const { gate, files } = suspended();
      const cache = new ConnectorStatusCache({ files });
      observed(cache, launch(), USER_REPORT());
      for (let i = 1; i < CONNECTOR_STATUS_BOUNDS.contexts; i++) observed(cache, launch(`app-${i}`, `L${i}`, {}, join(dir, `d${i}`)), report());
      const reading = cache.resolveSource(project, 'usertoy');
      await gate.reading;
      if (fill === 'refuse') observed(cache, launch('app-x', 'Lx', { CLAUDE_CONFIG_DIR: join(dir, 'config2') }), USER_REPORT());
      else for (let i = 0; i <= CONNECTOR_STATUS_BOUNDS.contexts; i++) observed(cache, launch(`app-r${i}`, `Lr${i}`, {}, join(dir, `r${i}`)), report());
      gate.release!();
      expect(await reading, fill).toEqual({ ok: false, why: 'unavailable' });
      expect(await cache.resolveSource(project, 'usertoy'), fill).toEqual({ ok: false, why: 'unavailable' });
    }
  });

  it('a lookup the cache keeps changing under gives up unavailable after a bounded number of fresh attempts', async () => {
    writeConfig();
    const churn: { cache?: ConnectorStatusCache; n: number } = { n: 0 };
    const files: SourceFiles = { ...nodeSourceFiles, read: async (path, max) => (observed(churn.cache!, launch(`app-c${churn.n}`, `Lc${churn.n++}`), USER_REPORT()), nodeSourceFiles.read(path, max)) };
    const cache = (churn.cache = new ConnectorStatusCache({ files }));
    observed(cache, launch(), USER_REPORT());
    expect(await cache.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'unavailable' });
    expect(churn.n).toBe(3); // one read per attempt, then it stops
  });
});

describe('ConnectorStatusCache: references under the settings ruling', () => {
  const referencing = (file: Record<string, unknown>) => ((file.mcpServers as Record<string, unknown>).usertoy = { type: 'stdio', command: 'toy', args: ['toy-server.mjs', '${XDG_TOY}'] });
  const answer = () => report(stdio('usertoy', ['toy-server.mjs', 'expanded']));

  it('literal-only by default: an entry with any reference is unattested, its report notwithstanding', async () => {
    writeConfig(referencing);
    const cache = new ConnectorStatusCache();
    observed(cache, launch(), answer());
    expect(await cache.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'unattested' });
  });

  it('attestedPresent: a visible reference to a present variable matches its report; an absent one refuses, its default too', async () => {
    writeConfig(referencing);
    const cache = new ConnectorStatusCache({ references: 'attestedPresent' });
    observed(cache, launch(), answer());
    expect(await cache.resolveSource(project, 'usertoy')).toMatchObject({ ok: true });
    writeConfig((file) => ((file.mcpServers as Record<string, unknown>).usertoy = { command: 'toy', args: ['toy-server.mjs', '${XDG_ABSENT:-expanded}'] }));
    expect(await cache.resolveSource(project, 'usertoy')).toEqual({ ok: false, why: 'unattested' });
  });

  it('the attested environment is the launch plan’s plus the flag settings env MAWS passed, filling only what the plan lacks', async () => {
    const context = connectorLaunchContext({ appSessionId: 'app-1', launchId: 'L1', cwd: project, environment: environment(), flagSettings: { env: { XDG_FLAG: 'from-flag', XDG_TOY: 'flag-loses', CLAUDE_CONFIG_DIR: join(dir, 'elsewhere'), ODD: 7 } } });
    expect(context.environment).toMatchObject({ XDG_FLAG: 'from-flag', XDG_TOY: 'expanded' });
    expect(context.environment).not.toHaveProperty('ODD');
    expect(context.configFile).toBe(join(config, '.claude.json')); // settings never move the config home
    writeConfig((file) => ((file.mcpServers as Record<string, unknown>).usertoy = { command: 'toy', args: ['toy-server.mjs', '${XDG_FLAG}'] }));
    const cache = new ConnectorStatusCache({ references: 'attestedPresent' });
    observed(cache, context, report(stdio('usertoy', ['toy-server.mjs', 'from-flag'])));
    expect(await cache.resolveSource(project, 'usertoy')).toMatchObject({ ok: true });
  });
});

describe('ConnectorStatusCache: launch metadata is bounded', () => {
  it('a session replaced past the launch bound, or new sessions past it, saturate the cache: closed, and growing no further', async () => {
    for (const kind of ['replacements', 'sessions'] as const) {
      writeConfig();
      const cache = new ConnectorStatusCache();
      observed(cache, launch(), USER_REPORT());
      const stale = cache.begin(launch());
      for (let i = 0; i < CONNECTOR_STATUS_BOUNDS.launches + 50; i++) cache.begin(kind === 'replacements' ? launch('app-r', `R${i}`) : launch(`app-s${i}`, 'S'));
      expect(await cache.resolveSource(project, 'usertoy'), kind).toEqual({ ok: false, why: 'unavailable' });
      for (let i = 0; i < 1000; i++) cache.begin(launch(`app-more${i}`, 'M'));
      const held = cache as unknown as Private;
      expect(held.current.size + held.retired.size, kind).toBeLessThanOrEqual(CONNECTOR_STATUS_BOUNDS.launches);
      cache.observe(stale, without(USER_REPORT(), 'usertoy')); // refused while saturated
      cache.clear();
      cache.observe(stale, without(USER_REPORT(), 'usertoy')); // and after the reset
      observed(cache, launch(), USER_REPORT());
      expect(await cache.resolveSource(project, 'usertoy'), kind).toMatchObject({ ok: true });
    }
  });
});

// Re-review: the fence spans the whole logical lookup, to the public answer's completion. File access answers without
// I/O waits beyond the real stat/read, and from the lookup's last file access a mutation is scheduled `depth`
// microtasks later, so the sweep lands it at every point from inside the inner lookup through the public method's
// completion. The mutation reads the public promise's own state as it runs (util.inspect shows `<pending>` until it
// settles): one still pending must answer the fresh meaning; one already settled may hold the older meaning (later
// caller scheduling is not the cache's to promise).
describe('ConnectorStatusCache: the fence holds to the public completion', () => {
  const lastAccess = (onLastAccess: () => void): SourceFiles => ({
    ...nodeSourceFiles,
    executable: async (path) => {
      const answer = await nodeSourceFiles.executable(path);
      onLastAccess();
      return answer;
    },
  });
  const later = (depth: number, run: () => void) => {
    const step = (left: number) => queueMicrotask(() => (left === 0 ? run() : step(left - 1)));
    step(depth);
  };
  const cases = [
    ['a contradicting launch', (cache: ConnectorStatusCache) => observed(cache, launch('app-2', 'L2'), without(USER_REPORT(), 'usertoy')), { ok: false, why: 'ambiguous' }],
    ['a clear and a fresh observation', (cache: ConnectorStatusCache) => (cache.clear(), observed(cache, launch('app-3', 'L3'), USER_REPORT())), { ok: false, why: 'unavailable' }],
  ] as const;

  for (const [label, mutate, fresh] of cases) {
    for (const method of ['resolveSource', 'resolve', 'readEntry'] as const) {
      it(`${method}: ${label} before its completion is never answered with the older meaning`, async () => {
        writeConfig();
        let landedBeforeCompletion = 0;
        for (let depth = 0; depth < 24; depth++) {
          let pendingAtMutation = false;
          let armed = false;
          const watched: { pending?: Promise<{ ok: boolean }> } = {};
          const cache = new ConnectorStatusCache({
            files: lastAccess(() => {
              if (!armed) return;
              armed = false;
              later(depth, () => {
                pendingAtMutation = inspect(watched.pending).includes('<pending>');
                mutate(cache);
              });
            }),
          });
          observed(cache, launch(), USER_REPORT());
          const resolved = await cache.resolveSource(project, 'usertoy');
          if (!resolved.ok) throw new Error(resolved.why);
          armed = true;
          const pending = (watched.pending = method === 'resolveSource' ? cache.resolveSource(project, 'usertoy') : method === 'resolve' ? cache.resolve(project, 'usertoy', 'metrics_snapshot') : cache.readEntry(resolved.source));
          const answer = await pending;
          await new Promise((resolve) => setTimeout(resolve, 0)); // any scheduled mutation has run
          if (pendingAtMutation) {
            landedBeforeCompletion += 1;
            expect(answer, `depth ${depth}`).toMatchObject(fresh);
          }
        }
        expect(landedBeforeCompletion, 'the sweep reached the window').toBeGreaterThan(0);
      });
    }
  }
});
