// One item per thing (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "One item per thing",
// "Normalising", "Publisher chain", "Categories"): the listings that point at the same code become one CatalogItem.
// - Routes: every listing's (marketplace, entry), one per pair, in route precedence (sources.ts `routeRank`: present
//   marketplaces first); the first is the item's `install`, the rest "Also listed by". A directory plugin no route reaches
//   is shown with its documentation and the reason, never with +.
// - Metadata precedence: the directory's record (tier, publisher, categories, components, icon), plugin-details for an
//   official plugin's counts, contents and date, the host's read of a clone (or a test source's of its folder), then the
//   manifest entry, each in route order.
// - Installed state is the cwd's: `here` when any route is installed in a scope that applies here, `elsewhere` when only
//   in another project.
import type { CatalogItem } from '@shared/ipc/schema/catalog';
import { repositoryLocation } from '@shared/plugins/source-key';
import { connectorRoute, knownFromDetail, knownFromDirectory, pluginListings, type EngineView, type EntryListing, type Known, type TestSourceData } from './normalize';
import type { DirectoryPlugin, NetworkData } from './records';
import { DIRECTORY_MARKETPLACE, OFFICIAL, ownershipOf } from './sources';

export interface CatalogInput {
  network: NetworkData;
  engine: EngineView | null; // null: the engine could not be read for this cwd
  tests: readonly TestSourceData[];
}

const first = <T>(values: readonly (T | null | undefined)[]): T | null => values.find((v): v is T => v !== null && v !== undefined) ?? null;
const distinct = (values: readonly string[]) => [...new Set(values)];

function installedState(ids: ReadonlySet<string>, engine: EngineView | null): CatalogItem['installed'] {
  const rows = (engine?.installed ?? []).filter((row) => ids.has(row.id));
  // project and local scope apply in their project and below it; any other scope (user) applies everywhere
  if (rows.some((row) => (row.scope === 'project' || row.scope === 'local' ? row.coversHere : true))) return 'here';
  return rows.length > 0 ? 'elsewhere' : 'no';
}

function notInstallable(record: DirectoryPlugin, engine: EngineView | null): string {
  const why =
    record.reviewedCommit === null
      ? 'no reviewed commit'
      : !record.claudeCode
        ? 'not listed for Claude Code'
        : engine?.available == null
          ? 'its listing could not be read'
          : !engine.available.some((p) => p.marketplaceName === DIRECTORY_MARKETPLACE)
            ? 'Anthropic Directory is off in this engine'
            : 'its Anthropic Directory does not list this plugin';
  return `Not installable by this engine: ${why}`;
}

function pluginItem(identity: string, listed: readonly EntryListing[], records: readonly DirectoryPlugin[], input: CatalogInput): CatalogItem {
  const { network, engine } = input;
  const ordered = [...listed].sort((a, b) => a.route.rank - b.route.rank || a.route.marketplaceName.localeCompare(b.route.marketplaceName) || a.route.pluginName.localeCompare(b.route.pluginName));
  const routes = ordered.filter((l, i) => ordered.findIndex((o) => o.route.marketplaceName === l.route.marketplaceName && o.route.pluginName === l.route.pluginName) === i);
  const chosen = routes[0] ?? null;
  const record = records[0] ?? null;
  const officialRoute = routes.find((l) => l.route.marketplaceName === OFFICIAL);
  const detail = officialRoute ? (network.details?.get(`${officialRoute.route.pluginName}@${OFFICIAL}`) ?? null) : null;
  const known: Known | null =
    (record ? knownFromDirectory(record.components) : null) ??
    (detail?.components ? knownFromDetail(detail.components) : null) ??
    first(routes.filter((l) => l.knownBy === 'host').map((l) => l.known)) ??
    first(routes.filter((l) => l.knownBy === 'entry').map((l) => l.known));
  const name = record?.name ?? chosen?.entryName ?? identity;
  return {
    id: identity,
    kind: 'plugin',
    name,
    installName: chosen && chosen.route.pluginName !== name ? chosen.route.pluginName : null,
    description: record?.description ?? first(routes.map((l) => l.description)),
    publisher: record?.publisher ?? first(routes.map((l) => l.author)) ?? first(routes.map((l) => l.owner)),
    ownership: chosen ? ownershipOf(chosen.route.marketplaceName) : 'anthropic',
    reviewTier: record?.tier ?? null,
    scanBlocked: record?.scanBlocked ?? null,
    categories: record?.taxonomy.object_acted_on ?? [],
    iconUrl: record?.iconUrl ?? null,
    updatedAt: detail?.updatedAt ?? record?.updatedAt ?? null,
    installs: detail?.installs ?? first(routes.map((l) => l.installCount)),
    rank: null,
    components: known?.components ?? null,
    runsOnYourComputer: known?.runs ?? 'unknown',
    install: chosen
      ? { kind: 'plugin', marketplaceSource: chosen.route.marketplaceSource, marketplaceName: chosen.route.marketplaceName, pluginName: chosen.route.pluginName, ref: chosen.route.ref, present: chosen.route.present }
      : { kind: 'manual', docsUrl: record?.homepage ?? null, reason: record ? notInstallable(record, engine) : 'Not installable by this engine' },
    alsoListedBy: distinct(routes.slice(1).map((l) => l.route.marketplaceName)).filter((m) => m !== chosen?.route.marketplaceName),
    sources: distinct([...(record ? ['directory:plugins'] : []), ...(detail ? ['plugin-details'] : []), ...ordered.map((l) => l.source)]),
    installed: installedState(new Set(routes.map((l) => `${l.route.pluginName}@${l.route.marketplaceName}`)), engine),
  };
}

/** The catalog for one cwd: every plugin and connector, joined. */
export function buildCatalog(input: CatalogInput): CatalogItem[] {
  const groups = new Map<string, { listed: EntryListing[]; records: DirectoryPlugin[] }>();
  const group = (identity: string) => groups.get(identity) ?? groups.set(identity, { listed: [], records: [] }).get(identity)!;
  for (const listing of pluginListings(input.network, input.engine, input.tests)) group(listing.identity).listed.push(listing);
  for (const record of input.network.plugins ?? []) group(repositoryLocation(record.repository, record.path) ?? `directory:${record.id}`).records.push(record);

  const items = [...groups].map(([identity, { listed, records }]) => pluginItem(identity, listed, records, input));
  const configured = new Set(input.engine?.servers ?? []);
  for (const server of input.network.servers ?? []) {
    const route = connectorRoute(server);
    if (route === null) continue;
    items.push({
      id: server.id,
      kind: 'connector',
      name: server.name,
      installName: route.name !== server.name ? route.name : null,
      description: server.description,
      publisher: server.publisher,
      ownership: 'anthropic', // listed by Anthropic's directory; its label is its review tier
      reviewTier: server.tier,
      scanBlocked: null,
      categories: server.taxonomy.object_acted_on ?? server.categories,
      iconUrl: server.iconUrl,
      updatedAt: null,
      installs: null,
      rank: server.rank,
      components: { skills: [], mcpServers: [{ name: route.name, transport: route.transport }], hooks: false, commands: 0, agents: 0, cli: false },
      runsOnYourComputer: false,
      install: route,
      alsoListedBy: [],
      sources: ['directory:servers'],
      installed: configured.has(route.name) ? 'here' : 'no',
    });
  }
  return items;
}
