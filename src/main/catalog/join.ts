// One item per thing (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "One item per thing",
// "Normalising", "Publisher chain", "Categories"): the listings that point at the same code become one CatalogItem.
// - Routes: every listing's (marketplace, entry), one per pair, in route precedence (sources.ts `routeRank`: present
//   marketplaces first); the first is the item's `install`, the rest "Also listed by". A route the item is installed
//   through comes first whatever its rank (here before elsewhere): it is the one that updates or removes it, and a second
//   install through another marketplace would be the same code twice. A directory plugin no route reaches is shown with
//   its documentation and the reason, never with +.
// - At an ambiguous place (one source lists several entries there, normalize.ts), a directory record joins the entry of
//   its engine name.
// - Contents describe what the chosen route installs: through the engine's Anthropic Directory, the directory record's
//   (it installs the record's whole place); through a `strict: false` entry, the subset the entry declares; otherwise the
//   directory record (where the place is the route's alone), plugin-details, then the host's read or the entry's
//   declaration of a route installing the same bundle (same place and entry name). Never another bundle's list.
// - Metadata precedence: the directory's record (tier, publisher, categories, components, icon), plugin-details for an
//   official plugin's counts, contents and date, the host's read of a clone (or a test source's of its folder), then the
//   manifest entry, each in route order.
// - Installed state is the cwd's: `here` when any route is installed in a scope that applies here, `elsewhere` when only
//   in another project.
import type { CatalogItem, Ownership } from '@shared/ipc/schema/catalog';
import { repositoryLocation } from '@shared/plugins/source-key';
import { connectorRoute, directoryEntryName, identityOf, knownFromDetail, knownFromDirectory, pluginListings, type EngineView, type EntryListing, type Known, type TestSourceData } from './normalize';
import type { DirectoryPlugin, NetworkData, PluginDetail } from './records';
import { DIRECTORY_MARKETPLACE, OFFICIAL } from './sources';

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
const routeId = (l: EntryListing) => `${l.route.pluginName}@${l.route.marketplaceName}`;
const INSTALLED_FIRST: Record<CatalogItem['installed'], number> = { here: 0, elsewhere: 1, no: 2 };

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

const sameBundle = (a: EntryListing, b: EntryListing) => a === b || (a.place !== null && a.place === b.place && a.entryName === b.entryName);

// What the chosen route installs (the header's contents rule).
function knownOf(identity: string, chosen: EntryListing | null, routes: readonly EntryListing[], record: DirectoryPlugin | null, detail: PluginDetail | null): Known | null {
  const fromRecord = record ? knownFromDirectory(record.components) : null;
  if (chosen === null) return fromRecord;
  if (chosen.route.marketplaceName === DIRECTORY_MARKETPLACE) return fromRecord ?? chosen.known;
  // the chosen route's own revision, read from the clone the engine holds (or the entry's own declaration): what it
  // installs, hooks and running code included; the directory's record of another revision never overrides it
  if (chosen.knownBy === 'entry' || chosen.knownBy === 'host') return chosen.known;
  const same = routes.filter((l) => sameBundle(l, chosen));
  const officialDetail = same.some((l) => l.route.marketplaceName === OFFICIAL) && detail?.components ? knownFromDetail(detail.components) : null;
  return (
    (identity.includes('?entry=') ? null : fromRecord) ??
    officialDetail ??
    first(same.filter((l) => l.knownBy === 'host').map((l) => l.known)) ??
    first(same.filter((l) => l.knownBy === 'entry').map((l) => l.known))
  );
}

// Each built item's routes' ownership by marketplace name (a seed's name from another repository is `added`), for the
// query's source filters and Featured, which see only names on the item (scalpel-1#2).
const routeOwnership = new WeakMap<CatalogItem, ReadonlyMap<string, Ownership>>();
export const ownershipOfRoute = (item: CatalogItem, marketplaceName: string): Ownership | null => routeOwnership.get(item)?.get(marketplaceName) ?? null;

function pluginItem(identity: string, listed: readonly EntryListing[], records: readonly DirectoryPlugin[], input: CatalogInput): CatalogItem {
  const { network, engine } = input;
  const ordered = [...listed].sort((a, b) => a.route.rank - b.route.rank || a.route.marketplaceName.localeCompare(b.route.marketplaceName) || a.route.pluginName.localeCompare(b.route.pluginName));
  const ranked = ordered.filter((l, i) => ordered.findIndex((o) => o.route.marketplaceName === l.route.marketplaceName && o.route.pluginName === l.route.pluginName) === i);
  const state = (l: EntryListing) => INSTALLED_FIRST[installedState(new Set([routeId(l)]), engine)];
  const routes = ranked.map((l, i) => ({ l, i, s: state(l) })).sort((a, b) => a.s - b.s || a.i - b.i).map(({ l }) => l);
  const chosen = routes[0] ?? null;
  const record = records[0] ?? null;
  const officialRoute = routes.find((l) => l.route.marketplaceName === OFFICIAL);
  const detail = officialRoute ? (network.details?.get(`${officialRoute.route.pluginName}@${OFFICIAL}`) ?? null) : null;
  const known = knownOf(identity, chosen, routes, record, detail);
  const name = record?.name ?? chosen?.entryName ?? identity;
  const item: CatalogItem = {
    id: identity,
    kind: 'plugin',
    name,
    installName: chosen && chosen.route.pluginName !== name ? chosen.route.pluginName : null,
    description: record?.description ?? first(routes.map((l) => l.description)),
    publisher: record?.publisher ?? first(routes.map((l) => l.author)) ?? first(routes.map((l) => l.owner)),
    ownership: chosen ? chosen.route.ownership : 'anthropic',
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
    installed: installedState(new Set(routes.map(routeId)), engine),
  };
  routeOwnership.set(item, new Map(routes.map((l) => [l.route.marketplaceName, l.route.ownership])));
  return item;
}

/** The catalog for one cwd: every plugin and connector, joined. */
export function buildCatalog(input: CatalogInput): CatalogItem[] {
  const groups = new Map<string, { listed: EntryListing[]; records: DirectoryPlugin[] }>();
  const group = (identity: string) => groups.get(identity) ?? groups.set(identity, { listed: [], records: [] }).get(identity)!;
  const { listings, ambiguous } = pluginListings(input.network, input.engine, input.tests);
  for (const listing of listings) group(listing.identity).listed.push(listing);
  for (const record of input.network.plugins ?? []) {
    const place = repositoryLocation(record.repository, record.path);
    group(place === null ? `directory:${record.id}` : identityOf(place, directoryEntryName(record.name), DIRECTORY_MARKETPLACE, ambiguous)).records.push(record);
  }

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
