// P4-AGG M2: the catalog's engine reads (the Discover spec, Design "Parts", the boundary): asked of the host per cwd,
// held until invalidated (all, or one cwd), the last 16 cwds kept; a failed read is null and does not stop the others; an
// installed Anthropic Directory entry is known by the engine's own record of it, asked for the installed names only.
import { describe, expect, it } from 'vitest';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import { EngineReads, type HostCall } from './engine-reads';

const DIRECTORY_ENTRY = { pluginId: 'fd@anthropic-plugin-directory', name: 'fd', marketplaceName: 'anthropic-plugin-directory', description: null, version: null, source: { kind: 'git-subdir', url: 'https://github.com/a/b', repo: null, path: 'p', ref: null, sha: 'f'.repeat(40) }, installCount: null };
const INSTALLED = { id: 'fd@anthropic-plugin-directory', name: 'fd', marketplace: 'anthropic-plugin-directory', scope: 'user', projectPath: null };

function host(answers: Partial<Record<CommandName, unknown>>) {
  const asked: { name: string; input: unknown }[] = [];
  const call = (async (name: CommandName, input: unknown): Promise<CommandResult<CommandName>> => {
    asked.push({ name, input });
    const value = answers[name];
    if (value instanceof Error) return { ok: false, error: { code: 'timeout', message: value.message } };
    return { ok: true, value } as CommandResult<CommandName>;
  }) as HostCall;
  return { asked, call, answers };
}

const ANSWERS = {
  'plugins.list': { plugins: [] },
  'plugins.available': { plugins: [DIRECTORY_ENTRY] },
  'marketplaces.list': { marketplaces: [{ name: 'm', source: 'github', locator: 'o/m', ref: null, installLocation: '/clones/m' }] },
  'plugins.marketplaceManifest': { state: 'read', owner: 'O', plugins: [] },
  'customization.inventory': { skills: [], servers: [{ name: 'linear', scope: 'user', path: '/x', transport: 'http' }], warnings: [], serversRead: true },
  'plugins.env': { binary: null, binaryError: null, configHome: '/config', globalConfig: '/config/.claude.json' },
  'plugins.directoryProvenance': { pluginsDir: '/config/plugins', entries: [] },
  'customization.serverEndpoints': { servers: [] },
};
const READS = ['customization.inventory', 'customization.serverEndpoints', 'marketplaces.list', 'plugins.available', 'plugins.directoryProvenance', 'plugins.list', 'plugins.marketplaceManifest'];

describe('EngineReads', () => {
  it('asks the host in the cwd, each listed marketplace’s clone, and the configured servers; holds the view until invalidated', async () => {
    const h = host(ANSWERS);
    const reads = new EngineReads(h.call);
    const view = await reads.view('/w');
    expect(view).toMatchObject({ cwd: '/w', installed: [], available: [DIRECTORY_ENTRY], servers: ['linear'] });
    expect(view!.manifests.get('m')).toEqual({ state: 'read', owner: 'O', plugins: [] });
    expect(h.asked.map((a) => a.name).sort()).toEqual([...READS, 'plugins.env'].sort()); // the configuration's place, once
    await reads.view('/w');
    expect(h.asked).toHaveLength(8);
    const generation = reads.generation;
    reads.invalidate();
    expect(reads.generation).toBe(generation + 1);
    await reads.view('/w');
    expect(h.asked).toHaveLength(15);
    expect(reads.places()).toEqual({ configHome: '/config', pluginsDir: '/config/plugins', globalConfig: '/config/.claude.json', projects: ['/w'] });
  });

  it('forgets one cwd’s view alone when only its settings changed', async () => {
    const h = host(ANSWERS);
    const reads = new EngineReads(h.call);
    await reads.view('/a');
    await reads.view('/b');
    const before = h.asked.length;
    const generation = reads.generation;
    reads.invalidate('/a');
    expect(reads.generation).toBe(generation + 1);
    await reads.view('/b');
    expect(h.asked.length).toBe(before);
    await reads.view('/a');
    expect(h.asked.length).toBe(before + 7);
  });

  it('reads the user configuration in the engine’s configuration directory, and is null when even that cannot be asked', async () => {
    const h = host(ANSWERS);
    expect((await new EngineReads(h.call).view(null))?.cwd).toBe('/config');
    expect(h.asked.find((a) => a.name === 'plugins.list')?.input).toEqual({ cwd: '/config' });
    expect(await new EngineReads(host({ ...ANSWERS, 'plugins.env': new Error('down') }).call).view(null)).toBeNull();
  });

  it('a failing read is null and the others stand', async () => {
    const view = await new EngineReads(host({ ...ANSWERS, 'plugins.available': new Error('the CLI exited 1') }).call).view('/w');
    expect(view).toMatchObject({ available: null, installed: [], servers: ['linear'] });
  });

  it('knows an installed directory entry by the engine’s record of it, on a cold start', async () => {
    const h = host({ ...ANSWERS, 'plugins.list': { plugins: [INSTALLED] }, 'plugins.available': { plugins: [] }, 'plugins.directoryProvenance': { pluginsDir: '/config/plugins', entries: [{ name: 'fd', repositoryKey: 'github.com/a/b#p' }] } });
    const view = await new EngineReads(h.call).view('/w');
    expect(h.asked.find((a) => a.name === 'plugins.directoryProvenance')?.input).toEqual({ names: ['fd'] });
    expect(view!.directoryInstalled).toEqual(new Map([['fd', 'github.com/a/b#p']]));
  });

  it('keeps the last 16 cwds', async () => {
    const h = host(ANSWERS);
    const reads = new EngineReads(h.call);
    for (let i = 0; i < 17; i += 1) await reads.view(`/w${i}`);
    const before = h.asked.length;
    await reads.view('/w16');
    expect(h.asked.length).toBe(before);
    await reads.view('/w0');
    expect(h.asked.length).toBeGreaterThan(before);
  });

  it('after an MCP change, forgets only the views whose configured servers moved (scalpel-3#1)', async () => {
    const h = host(ANSWERS);
    const reads = new EngineReads(h.call);
    await reads.view('/a');
    await reads.view('/b');
    expect(await reads.recheckServers()).toBe(false); // the global file rewritten, the servers as they were
    expect(reads.holds('/a') && reads.holds('/b')).toBe(true);
    h.answers['customization.serverEndpoints'] = { servers: [{ name: 'linear', scope: 'user', path: '/config/.claude.json', transport: 'http', url: 'https://mcp.linear.app/mcp' }] };
    expect(await reads.recheckServers()).toBe(true);
    expect(reads.holds('/a') || reads.holds('/b')).toBe(false);
    expect(reads.places()).toMatchObject({ globalConfig: '/config/.claude.json' });
  });
});
