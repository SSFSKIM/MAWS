// A connector's row in My items, as data (UX wave U11c, docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md,
// §E and §J): today one kind, a server configured in a file the inventory reads. The model is a union so that a second
// kind (U11h's: a plugin's connector) is a member and a branch of its own, and the rows come from the inventory, not
// from its list of servers, so that kind's list joins them here.
import type { CustomizationServer } from '@shared/ipc/schema/customization';
import type { Inventory } from '../inventory';
import { serverKey } from './present';

export type ConnectorRowModel = { kind: 'configured'; key: string; name: string; scope: 'app' | 'user' | 'project' | 'local'; path: string; transport: string };

/** A configured row's identity, which its operations run under: `connector:<scope>:<name>:<path>` (`serverKey`). */
export const connectorRowKey: (row: Pick<CustomizationServer, 'name' | 'scope' | 'path'>) => string = serverKey;

/** The configured rows, in the inventory's order. */
export function connectorRows(inventory: Pick<Inventory, 'servers'>): ConnectorRowModel[] {
  return inventory.servers.map((server) => ({ kind: 'configured', key: connectorRowKey(server), name: server.name, scope: server.scope, path: server.path, transport: server.transport }));
}

/** The rows whose name holds My items' text, case aside (the connectors' own rule for the page's search). */
export function connectorRowsMatching(rows: readonly ConnectorRowModel[], search: string): readonly ConnectorRowModel[] {
  const text = search.trim().toLowerCase();
  return text === '' ? rows : rows.filter((row) => row.name.toLowerCase().includes(text));
}
