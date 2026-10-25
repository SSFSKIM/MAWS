// + on a Discover card (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "Adding"): the existing
// install sheet for the item's chosen route, `plugin install <name>@<marketplace>` at user scope by default, carrying what
// the sheet shows beside the command (what gets installed, "Also listed by", the runs-code warning) and, when the engine
// does not have the route's marketplace yet, the first step that adds it at the sheet's scope (the sheet runs both, add
// first; the one-step `--marketplace` form is never used, fact 2). From Skills the sheet names the plugin and its skills:
// that is the unit the engine installs. A connector's + adds the server (customize/connectors).
import type { CatalogItem, CatalogTab } from '@shared/ipc/schema/catalog';
import { requestFor, type PluginsRequest } from '../../widgets/plugins/present';
import { componentParts, runsCodeWords } from './present';
import { connectorAddOf } from '../connectors/present';

/** The operation key a card's + runs under: its line shows on the card and in its detail. */
export const CATALOG_KEY = 'catalog:';
export const catalogKey = (item: CatalogItem): string => `${CATALOG_KEY}${item.id}`;

/** The id My items knows an installed route by (`<plugin>@<marketplace>`), or null for a route that is not a plugin. */
export const pluginIdOf = (item: CatalogItem): string | null => (item.install.kind === 'plugin' ? `${item.install.pluginName}@${item.install.marketplaceName}` : null);

export function installRequestOf(item: CatalogItem, tab: CatalogTab): PluginsRequest | null {
  const route = item.install;
  if (route.kind === 'connector') return connectorAddOf(item); // P4-AGG M4: `claude mcp add`, through the connector sheet
  if (route.kind !== 'plugin' || item.scanBlocked !== null) return null;
  return requestFor(
    'install',
    { plugin: `${route.pluginName}@${route.marketplaceName}`, scope: 'user' },
    null,
    {
      catalog: {
        name: item.name,
        marketplace: { name: route.marketplaceName, source: route.marketplaceSource, present: route.present },
        skills: tab === 'skills' ? (item.components?.skills ?? []) : null,
        contents: componentParts(item),
        runsCode: runsCodeWords(item),
        alsoListedBy: item.alsoListedBy,
      },
    },
  );
}
