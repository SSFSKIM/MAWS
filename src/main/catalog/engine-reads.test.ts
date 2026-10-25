// P4-AGG M2: the catalog's engine reads (the Discover spec, Design "Parts", the boundary): asked of the host per cwd,
// held until invalidated, the last 16 cwds kept; a failed read is null and does not stop the others; an Anthropic
// Directory entry's source outlives its leaving the available listing once installed.
import { describe, expect, it } from 'vitest';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import { EngineReads, type HostCall } from './engine-reads';

const DIRECTORY_ENTRY = { pluginId: 'fd@anthropic-plugin-directory', name: 'fd', marketplaceName: 'anthropic-plugin-directory', description: null, version: null, source: { kind: 'git-subdir', url: 'https://github.com/a/b', repo: null, path: 'p', ref: null, sha: 'f'.repeat(40) }, installCount: null };

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
  'customization.inventory': { skills: [], servers: [{ name: 'linear', scope: 'user', path: '/x', transport: 'http' }], warnings: [] },
  'plugins.env': { binary: null, binaryError: null, configHome: '/config', globalConfig: '/config/.claude.json' },
};

describe('EngineReads', () => {
  it('asks the host in the cwd, each listed marketplace’s clone, and the configured servers; holds the view until invalidated', async () => {
    const h = host(ANSWERS);
    const reads = new EngineReads(h.call);
    const view = await reads.view('/w');
    expect(view).toMatchObject({ cwd: '/w', installed: [], available: [DIRECTORY_ENTRY], servers: ['linear'] });
    expect(view!.manifests.get('m')).toEqual({ state: 'read', owner: 'O', plugins: [] });
    expect(h.asked.map((a) => a.name).sort()).toEqual(['customization.inventory', 'marketplaces.list', 'plugins.available', 'plugins.list', 'plugins.marketplaceManifest']);
    await reads.view('/w');
    expect(h.asked).toHaveLength(5);
    const generation = reads.generation;
    reads.invalidate();
    expect(reads.generation).toBe(generation + 1);
    await reads.view('/w');
    expect(h.asked).toHaveLength(10);
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

  it('remembers a directory entry’s source after it leaves the available listing', async () => {
    const h = host(ANSWERS);
    const reads = new EngineReads(h.call);
    await reads.view('/w');
    h.answers['plugins.available'] = { plugins: [] }; // installed: the engine no longer lists it
    reads.invalidate();
    expect((await reads.view('/w'))!.directorySources.get('fd')).toEqual(DIRECTORY_ENTRY.source);
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
});
