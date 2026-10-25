// The catalog's summary for the dev-only live walk (scripts/catalog-summary.mjs; the Discover spec's M2): what the real
// sources hold and what the catalog makes of them, for Surprises & Discoveries beside the 2026-10-25 numbers, and the
// measured size and type of every request, for the `catalog` egress rule's caps. Pure: the walk is the script's.
import type { CatalogItem } from '@shared/ipc/schema/catalog';
import type { Exchange } from './fetch';
import { connectorRoute } from './normalize';
import { homeOf, inTab } from './query';
import { TAXONOMY_AXES, type DirectoryServer, type NetworkData } from './records';

type Axis = (typeof TAXONOMY_AXES)[number];
const share = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10);

/** Each taxonomy axis' coverage, in percent, over the directory's public plugins and its servers (and the servers' own categories). */
export function axisCoverage(network: NetworkData): { plugins: Record<Axis, number>; servers: Record<Axis | 'categories', number> } {
  const plugins = network.plugins ?? [];
  const servers = network.servers ?? [];
  const over = <T extends { taxonomy: Partial<Record<Axis, string[]>> }>(records: readonly T[]) => Object.fromEntries(TAXONOMY_AXES.map((axis) => [axis, share(records.filter((r) => (r.taxonomy[axis]?.length ?? 0) > 0).length, records.length)])) as Record<Axis, number>;
  return { plugins: over(plugins), servers: { ...over(servers), categories: share(servers.filter((s) => s.categories.length > 0).length, servers.length) } };
}

// Why a directory server is not a Connectors item (Design, Discover per tab).
function notShownReason(server: DirectoryServer): string {
  if (server.type !== 'remote') return `type ${server.type}`;
  if (!server.worksWithClaudeCode) return 'not for Claude Code';
  if (server.remote === null) return 'no remote';
  if (server.remote.transport !== 'streamable-http' && server.remote.transport !== 'sse') return `transport ${server.remote.transport}`;
  return 'no URL, URL pattern or choice of URLs';
}

const count = <T>(values: readonly T[], key: (value: T) => string) => {
  const counts: Record<string, number> = {};
  for (const value of values) counts[key(value)] = (counts[key(value)] ?? 0) + 1;
  return counts;
};

export function catalogSummary(network: NetworkData, items: readonly CatalogItem[], exchanges: ReadonlyMap<string, readonly Exchange[]>, dropped: ReadonlyMap<string, number>) {
  const plugins = items.filter((i) => i.kind === 'plugin');
  const connectors = items.filter((i) => i.kind === 'connector');
  const servers = network.servers ?? [];
  const records = network.plugins ?? [];
  return {
    requests: Object.fromEntries([...exchanges].map(([key, list]) => [key, list.map((e) => ({ url: e.url, bytes: e.bytes, contentType: e.contentType, ms: e.ms }))])),
    sources: {
      seeds: Object.fromEntries([...network.seeds].map(([key, m]) => [key, { entries: m.entries.records.length, owner: m.owner }])),
      directoryPlugins: { records: records.length, byTier: count(records, (r) => r.tier ?? 'none'), withoutReviewedCommit: records.filter((r) => r.reviewedCommit === null).length, withoutClaudeCode: records.filter((r) => !r.claudeCode).length, withPublisher: records.filter((r) => r.publisher !== null).length, emptyComponents: records.filter((r) => r.components.length === 0).length, scanBlocked: records.filter((r) => r.scanBlocked !== null).length },
      directoryServers: { records: servers.length, byType: count(servers, (s) => s.type), byTier: count(servers, (s) => s.tier ?? 'none'), notShown: count(servers.filter((s) => connectorRoute(s) === null), notShownReason), claudeCodeRemote: connectors.length, urlPattern: connectors.filter((c) => c.install.kind === 'connector' && c.install.url === null).length, byTransport: count(connectors, (c) => (c.install.kind === 'connector' ? c.install.transport : '?')), byAuth: count(connectors, (c) => (c.install.kind === 'connector' ? c.install.authPosture : '?')) },
      pluginDetails: { ids: network.details?.size ?? 0, withInstalls: [...(network.details?.values() ?? [])].filter((d) => d.installs !== null).length },
      dropped: Object.fromEntries(dropped),
    },
    catalog: {
      items: items.length,
      plugins: plugins.length,
      connectors: connectors.length,
      skillsTab: items.filter((i) => inTab(i, 'skills')).length,
      joinedFromSeveralSources: plugins.filter((i) => i.sources.filter((s) => s.startsWith('seed:') || s === 'directory:plugins').length > 1).length,
      withAlsoListedBy: plugins.filter((i) => i.alsoListedBy.length > 0).length,
      byRoute: count(plugins, (i) => (i.install.kind === 'plugin' ? i.install.marketplaceName : 'manual')),
      byOwnership: count(plugins, (i) => i.ownership),
      byReviewTier: count(plugins, (i) => i.reviewTier ?? 'none'),
      componentsUnknown: plugins.filter((i) => i.components === null).length,
      runsOnYourComputer: count(plugins, (i) => String(i.runsOnYourComputer)),
      withPublisher: plugins.filter((i) => i.publisher !== null).length,
      withInstalls: plugins.filter((i) => i.installs !== null).length,
      withCategories: { plugins: plugins.filter((i) => i.categories.length > 0).length, connectors: connectors.filter((i) => i.categories.length > 0).length },
      featured: { plugins: homeOf(items, 'plugins').featured?.name ?? null, skills: homeOf(items, 'skills').featured?.name ?? null, connectors: homeOf(items, 'connectors').featured?.name ?? null },
      shelves: homeOf(items, 'plugins').shelves.map((s) => `${s.title} (${s.total})`),
    },
    axisCoverage: axisCoverage(network),
  };
}
