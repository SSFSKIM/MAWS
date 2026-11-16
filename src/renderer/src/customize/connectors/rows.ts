// A connector's row in My items, as data (UX wave U11c, docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md,
// §E and §J): a server configured in a file the inventory reads, or (UX wave U11h,
// docs/doperpowers/plans/2026-11-14-ux-wave-U11h-plugin-connectors.md, §E) a server an installed plugin's files declare,
// each a member of the union and a branch of its own; the rows come from the inventory, the configured ones first.
import type { CustomizationServer } from '@shared/ipc/schema/customization';
import type { Inventory } from '../inventory';
import { keyNameOf, pluginRowOf, type PluginRowModel } from './plugin-row';
import { serverKey } from './present';

export type ConnectorRowModel = { kind: 'configured'; key: string; name: string; scope: 'app' | 'user' | 'project' | 'local'; path: string; transport: string } | PluginRowModel;

/** A configured row's identity, which its operations run under: `connector:<scope>:<name>:<path>` (`serverKey`). */
export const connectorRowKey: (row: Pick<CustomizationServer, 'name' | 'scope' | 'path'>) => string = serverKey;

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The configured rows in the inventory's order, then the plugins' by key and server (an engine host of an earlier build
 * answers no `pluginServers`: none). */
export function connectorRows(inventory: Pick<Inventory, 'servers' | 'pluginServers'>): ConnectorRowModel[] {
  const configured = inventory.servers.map((server): ConnectorRowModel => ({ kind: 'configured', key: connectorRowKey(server), name: server.name, scope: server.scope, path: server.path, transport: server.transport }));
  const plugins = [...(inventory.pluginServers ?? [])].sort((a, b) => byText(a.plugin, b.plugin) || byText(a.server, b.server)).map(pluginRowOf);
  return [...configured, ...plugins];
}

/** The name a row shows: a plugin's row its server's. */
export const shownNameOf = (row: ConnectorRowModel): string => (row.kind === 'plugin' ? row.server : row.name);

/** The rows whose name holds My items' text, case aside (the connectors' own rule for the page's search); a plugin's row
 * also by its plugin's name as "from <plugin>" shows it (`pluginName`, by its key). */
export function connectorRowsMatching(rows: readonly ConnectorRowModel[], search: string, pluginName: (key: string) => string = keyNameOf): readonly ConnectorRowModel[] {
  const text = search.trim().toLowerCase();
  if (text === '') return rows;
  return rows.filter((row) => shownNameOf(row).toLowerCase().includes(text) || (row.kind === 'plugin' && pluginName(row.plugin).toLowerCase().includes(text)));
}
