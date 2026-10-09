// `plugins.manifest`'s admission (P2-B execution document §5.5): the host keeps, per cwd, the rows of its own last
// `plugin list --json` and `plugin marketplace list --json` (the ones `plugins.list` and `marketplaces.list` answered),
// and the manifest reader reads only under the folders those rows name. The renderer names items, never a path. Each
// listing replaces the cwd's memory, so an uninstalled plugin's folder stops being readable at the next listing.
import type { Marketplace } from '@shared/ipc/schema/marketplaces';
import type { ManifestItemRef, PluginManifestView } from '@shared/ipc/schema/plugins';
import type { PluginListRow } from './cli-result';
import { readManifestView, type ManifestAnchors, type ManifestReaderDeps } from './manifest';

const KEPT_DIRECTORIES = 16;
export const MANIFEST_READ_MS = 2_500; // per call, after any listing, so a call that also had to list fits the bridge's 10 s

export class LastListings {
  private readonly byCwd = new Map<string, { plugins: PluginListRow[] | null; marketplaces: Marketplace[] | null }>();

  private keep(cwd: string, update: (kept: { plugins: PluginListRow[] | null; marketplaces: Marketplace[] | null }) => void): void {
    const kept = this.byCwd.get(cwd) ?? { plugins: null, marketplaces: null };
    update(kept);
    this.byCwd.delete(cwd); // the most recently listed last
    this.byCwd.set(cwd, kept);
    for (const oldest of this.byCwd.keys()) {
      if (this.byCwd.size <= KEPT_DIRECTORIES) break;
      this.byCwd.delete(oldest);
    }
  }

  keepPlugins(cwd: string, rows: PluginListRow[]): PluginListRow[] {
    this.keep(cwd, (kept) => (kept.plugins = rows));
    return rows;
  }

  keepMarketplaces(cwd: string, rows: Marketplace[]): Marketplace[] {
    this.keep(cwd, (kept) => (kept.marketplaces = rows));
    return rows;
  }

  plugins(cwd: string): PluginListRow[] | null {
    return this.byCwd.get(cwd)?.plugins ?? null;
  }

  marketplaces(cwd: string): Marketplace[] | null {
    return this.byCwd.get(cwd)?.marketplaces ?? null;
  }
}

export interface ManifestsDeps {
  listings: LastListings;
  listPlugins: () => Promise<PluginListRow[]>; // runs the listing; what it answers is kept
  listMarketplaces: () => Promise<Marketplace[]>;
  read?: (key: ManifestItemRef, anchors: ManifestAnchors, deps?: ManifestReaderDeps) => Promise<PluginManifestView>;
  now?: () => number;
}

const nameOf = (id: string) => {
  const at = id.lastIndexOf('@');
  return { name: at > 0 ? id.slice(0, at) : id, marketplace: at > 0 ? id.slice(at + 1) : '' };
};
const rowOf = (rows: readonly PluginListRow[] | null, key: Extract<ManifestItemRef, { kind: 'installation' }>) =>
  rows?.find((row) => row.id === key.id && row.scope === key.scope && row.projectPath === key.projectPath) ?? null;
const marketplaceOf = (rows: readonly Marketplace[] | null, name: string) => rows?.find((m) => m.name === name) ?? null;

// The views of `items`, in their order (the renderer asks for its representative installations first), read under one
// deadline. An item the kept rows do not name is resolved after one more listing for the whole call (an installation:
// the plugin listing; an available entry's marketplace, or a cwd with no marketplace listing kept: the marketplace
// listing); still absent, or with a listing that failed, it answers `unknown`. An installation whose marketplace is not
// a listed one (a skills-directory or session plugin) is read without an entry and lists nothing again.
export async function manifestsFor(cwd: string, items: readonly ManifestItemRef[], deps: ManifestsDeps): Promise<PluginManifestView[]> {
  const { listings } = deps;
  const relist = async <T>(list: () => Promise<T[]>): Promise<T[] | null> => list().catch(() => null);
  let plugins = listings.plugins(cwd);
  let marketplaces = listings.marketplaces(cwd);
  const installations = items.filter((item): item is Extract<ManifestItemRef, { kind: 'installation' }> => item.kind === 'installation');
  const available = items.filter((item): item is Extract<ManifestItemRef, { kind: 'available' }> => item.kind === 'available');
  const [pluginsAgain, marketplacesAgain] = await Promise.all([
    installations.some((key) => rowOf(plugins, key) === null) ? relist(deps.listPlugins) : null,
    marketplaces === null ? (items.length > 0 ? relist(deps.listMarketplaces) : null) : available.some((key) => marketplaceOf(marketplaces, nameOf(key.pluginId).marketplace) === null) ? relist(deps.listMarketplaces) : null,
  ]);
  if (pluginsAgain !== null) plugins = listings.keepPlugins(cwd, pluginsAgain);
  if (marketplacesAgain !== null) marketplaces = listings.keepMarketplaces(cwd, marketplacesAgain);

  const anchorsOf = (key: ManifestItemRef): ManifestAnchors => {
    if (key.kind === 'available') {
      const { name, marketplace } = nameOf(key.pluginId);
      return { root: null, marketplaceRoot: marketplaceOf(marketplaces, marketplace)?.installLocation || null, entryName: name };
    }
    const { name, marketplace } = nameOf(key.id);
    const row = rowOf(plugins, key);
    if (row === null) return { root: null, marketplaceRoot: null, entryName: name };
    // an empty optional path from the CLI is none, never a path (`path.resolve('')` is the host's own cwd)
    return { root: row.readFromFolder || row.installPath || null, marketplaceRoot: marketplaceOf(marketplaces, marketplace)?.installLocation || null, entryName: name };
  };

  const read = deps.read ?? readManifestView;
  const now = deps.now ?? Date.now;
  const deadline = now() + MANIFEST_READ_MS;
  const views: PluginManifestView[] = [];
  for (const key of items) views.push(await read(key, anchorsOf(key), { now, deadline }));
  return views;
}
