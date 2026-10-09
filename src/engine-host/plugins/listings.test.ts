// P2-B M2: the host's memory of its own last listings per cwd, and the `plugins.manifest` request resolved against it:
// only the paths the engine's listings named are read, an item they do not name is listed once more, and still absent
// answers `unknown`.
import { describe, expect, it } from 'vitest';
import type { Marketplace } from '@shared/ipc/schema/marketplaces';
import type { ManifestItemRef, PluginManifestView } from '@shared/ipc/schema/plugins';
import type { PluginListRow } from './cli-result';
import { LastListings, manifestsFor } from './listings';
import type { ManifestAnchors } from './manifest';

const row = (id: string, over: Partial<PluginListRow> = {}): PluginListRow => ({
  id, version: '1.0.0', scope: 'user', enabled: true, installPath: `/c/${id}`, projectPath: null, errors: [], notes: [], readFromFolder: null, folderVersion: null, installedAt: null, lastUpdated: null, projectEnabled: false, ...over,
});
const market = (name: string, installLocation: string | null): Marketplace => ({ name, source: 'github', locator: `o/${name}`, installLocation });
const user = (id: string): ManifestItemRef => ({ kind: 'installation', id, scope: 'user', projectPath: null });

// A reader that records the anchors it was given and answers a minimal view.
function recorder() {
  const seen: { key: ManifestItemRef; anchors: ManifestAnchors; deadline: number | undefined }[] = [];
  const read = async (key: ManifestItemRef, anchors: ManifestAnchors, deps?: { deadline?: number }): Promise<PluginManifestView> => {
    seen.push({ key, anchors, deadline: deps?.deadline });
    return { key, state: anchors.root === null && anchors.marketplaceRoot === null ? 'unknown' : 'read', name: null, displayName: null, version: null, marketplaceVersion: null, description: null, author: null, license: null, keywords: [], components: { mcpServers: [], mcpBundles: 0, agents: [], hooks: [], hookModules: 0, monitors: [], lspServers: [], commands: [], skills: [] }, partial: false, problems: [] };
  };
  return { seen, read };
}

describe('LastListings', () => {
  it('replaces, never merges, each cwd’s listing', () => {
    const listings = new LastListings();
    listings.keepPlugins('/a', [row('p@m'), row('q@m')]);
    listings.keepPlugins('/a', [row('q@m')]);
    expect(listings.plugins('/a')?.map((r) => r.id)).toEqual(['q@m']);
    expect(listings.plugins('/b')).toBeNull();
    listings.keepMarketplaces('/a', [market('m', '/mk')]);
    expect(listings.marketplaces('/a')).toEqual([market('m', '/mk')]);
    expect(listings.plugins('/a')?.map((r) => r.id)).toEqual(['q@m']); // the other listing of the cwd stays
  });

  it('keeps the last 16 directories, the least recently listed dropped first', () => {
    const listings = new LastListings();
    for (let i = 0; i < 16; i += 1) listings.keepPlugins(`/d${i}`, []);
    listings.keepMarketplaces('/d0', []); // listed again: now the most recent
    listings.keepPlugins('/d16', []);
    expect(listings.plugins('/d0')).toEqual([]);
    expect(listings.plugins('/d1')).toBeNull();
    expect(listings.plugins('/d16')).toEqual([]);
  });
});

describe('manifestsFor', () => {
  const lists = (plugins: PluginListRow[][], marketplaces: Marketplace[][]) => {
    const calls = { plugins: 0, marketplaces: 0 };
    return {
      calls,
      listPlugins: async () => plugins[Math.min(calls.plugins++, plugins.length - 1)],
      listMarketplaces: async () => marketplaces[Math.min(calls.marketplaces++, marketplaces.length - 1)],
    };
  };

  it('anchors an installation at its row’s folder (readFromFolder before installPath) and its marketplace’s clone', async () => {
    const listings = new LastListings();
    listings.keepPlugins('/w', [row('a@m'), row('b@dir', { readFromFolder: '/market/plugins/b', installPath: '/c/b' }), row('c@m', { scope: 'project', projectPath: '/w' })]);
    listings.keepMarketplaces('/w', [market('m', '/clones/m')]);
    const { seen, read } = recorder();
    const cli = lists([[]], [[]]);
    await manifestsFor('/w', [user('a@m'), user('b@dir'), { kind: 'installation', id: 'c@m', scope: 'project', projectPath: '/w' }], { listings, ...cli, read });
    expect(seen.map((s) => s.anchors)).toEqual([
      { root: '/c/a@m', marketplaceRoot: '/clones/m', entryName: 'a' },
      { root: '/market/plugins/b', marketplaceRoot: null, entryName: 'b' },
      { root: '/c/c@m', marketplaceRoot: '/clones/m', entryName: 'c' },
    ]);
    expect(cli.calls).toEqual({ plugins: 0, marketplaces: 0 }); // every item was named: nothing listed again
  });

  it('an empty readFromFolder or installLocation reads as absent, never as a path', async () => {
    const listings = new LastListings();
    listings.keepPlugins('/w', [row('p@m', { readFromFolder: '', installPath: '/c/p' })]);
    listings.keepMarketplaces('/w', [market('m', '')]);
    const { seen, read } = recorder();
    await manifestsFor('/w', [user('p@m'), { kind: 'available', pluginId: 'q@m' }], { listings, ...lists([[]], [[]]), read });
    expect(seen.map((s) => s.anchors)).toEqual([
      { root: '/c/p', marketplaceRoot: null, entryName: 'p' },
      { root: null, marketplaceRoot: null, entryName: 'q' },
    ]);
  });

  it('a row with no installPath has no root (never the host’s own cwd)', async () => {
    const listings = new LastListings();
    listings.keepPlugins('/w', [row('s@skills-dir', { installPath: '' })]);
    listings.keepMarketplaces('/w', []);
    const { seen, read } = recorder();
    await manifestsFor('/w', [user('s@skills-dir')], { listings, ...lists([[]], [[]]), read });
    expect(seen[0].anchors.root).toBeNull();
  });

  it('an installation the kept rows do not name is listed once more; still absent, it has no anchors', async () => {
    const listings = new LastListings();
    listings.keepPlugins('/w', [row('a@m')]);
    listings.keepMarketplaces('/w', [market('m', '/clones/m')]);
    const { seen, read } = recorder();
    const cli = lists([[row('a@m'), row('new@m')]], [[market('m', '/clones/m')]]);
    await manifestsFor('/w', [user('new@m'), user('gone@m'), { kind: 'installation', id: 'a@m', scope: 'project', projectPath: '/elsewhere' }], { listings, ...cli, read });
    expect(cli.calls.plugins).toBe(1); // once for the whole call
    expect(seen.map((s) => s.anchors.root)).toEqual(['/c/new@m', null, null]);
    expect(listings.plugins('/w')?.map((r) => r.id)).toEqual(['a@m', 'new@m']); // the re-listing replaced the memory
  });

  it('with no listing kept for the cwd, lists first; a failing listing answers unknown, never throws', async () => {
    const listings = new LastListings();
    const { seen, read } = recorder();
    await manifestsFor('/w', [user('a@m')], { listings, ...lists([[row('a@m')]], [[market('m', '/clones/m')]]), read });
    expect(seen[0].anchors).toEqual({ root: '/c/a@m', marketplaceRoot: '/clones/m', entryName: 'a' });

    const failing = { listPlugins: async () => Promise.reject(new Error('the CLI exited 1')), listMarketplaces: async () => Promise.reject(new Error('no')) };
    const fresh = recorder();
    await manifestsFor('/x', [user('a@m'), { kind: 'available', pluginId: 'q@m' }], { listings: new LastListings(), ...failing, read: fresh.read });
    expect(fresh.seen.map((s) => s.anchors)).toEqual([{ root: null, marketplaceRoot: null, entryName: 'a' }, { root: null, marketplaceRoot: null, entryName: 'q' }]);
  });

  it('an available entry is anchored at its marketplace’s clone; an unnamed marketplace is listed once more', async () => {
    const listings = new LastListings();
    listings.keepPlugins('/w', []);
    listings.keepMarketplaces('/w', [market('m', '/clones/m')]);
    const { seen, read } = recorder();
    const cli = lists([[]], [[market('m', '/clones/m'), market('n', '/clones/n')]]);
    await manifestsFor('/w', [{ kind: 'available', pluginId: 'p@m' }, { kind: 'available', pluginId: 'q@n' }, { kind: 'available', pluginId: 'r@anthropic-plugin-directory' }], { listings, ...cli, read });
    expect(cli.calls).toEqual({ plugins: 0, marketplaces: 1 });
    expect(seen.map((s) => s.anchors)).toEqual([
      { root: null, marketplaceRoot: '/clones/m', entryName: 'p' },
      { root: null, marketplaceRoot: '/clones/n', entryName: 'q' },
      { root: null, marketplaceRoot: null, entryName: 'r' }, // the built-in directory is never a marketplace row
    ]);
  });

  it('reads in the order asked, under one deadline set after any listing', async () => {
    const listings = new LastListings();
    listings.keepPlugins('/w', [row('a@m'), row('b@m')]);
    listings.keepMarketplaces('/w', []);
    const { seen, read } = recorder();
    let clock = 1_000;
    await manifestsFor('/w', [user('b@m'), user('a@m')], { listings, ...lists([[]], [[]]), read, now: () => clock++ });
    expect(seen.map((s) => s.key)).toEqual([user('b@m'), user('a@m')]);
    expect(new Set(seen.map((s) => s.deadline))).toEqual(new Set([1_000 + 2_500]));
  });
});
