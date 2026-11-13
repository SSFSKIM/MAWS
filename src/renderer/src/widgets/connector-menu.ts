// The "+" › Connectors submenu's rows and the line it shows when it has none (UX wave U11a; §C's status words, §D):
// a started session's connectors in the dialog's words once its process is ready; before the first message on this Mac,
// the folder's configured connectors, one per name with its scope in Customize's words in place of a status (the
// inventory read while the "+" menu is open, `enabled`); a tab set to another machine says the list shows once the chat
// starts there. A menu drawn with no session id reads nothing.
import { useMemo } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { useCustomizationInventory } from '../customize/inventory';
import { INVENTORY_READING } from '../customize/InventoryState';
import { CONNECTORS } from '../customize/connectors/copy';
import { usedEntries } from '../customize/connectors/present';
import { useSessions } from '../stores/sessions';
import { connectorStatusWords } from './connector-status';
import { BEFORE_START, CONNECTOR_MENU, MCP } from './copy';
import { useTabPlace } from './tab-place';

export interface ConnectorMenu {
  rows: { name: string; detail: string }[];
  empty: string | null; // the line in the rows' place when there are none
}

export function useConnectorMenu(appSessionId: AppSessionId | undefined, { enabled }: { enabled: boolean }): ConnectorMenu {
  const place = useTabPlace(appSessionId);
  const status = useSessions((s) => (appSessionId ? s.engine.get(appSessionId) : undefined));
  const inventory = useCustomizationInventory(place.kind === 'local' ? place.folder : null, { enabled: enabled && place.kind === 'local' });
  const { data, error, isPending } = inventory;
  return useMemo((): ConnectorMenu => {
    if (place.kind === 'remote') return { rows: [], empty: BEFORE_START.remote(place.machine) };
    if (place.kind === 'local') {
      if (data) {
        const rows = usedEntries(data.servers).map((server) => ({ name: server.name, detail: CONNECTORS.scopeOf(server.scope) }));
        return { rows, empty: rows.length === 0 ? MCP.none : null };
      }
      return { rows: [], empty: error ? error.message : isPending ? INVENTORY_READING : null };
    }
    if (status?.process !== 'ready') return { rows: [], empty: CONNECTOR_MENU.notRunning };
    const rows = status.mcpServers.map((server) => ({ name: server.name, detail: connectorStatusWords(server.status) }));
    return { rows, empty: rows.length === 0 ? CONNECTOR_MENU.noneReported : null };
  }, [place, data, error, isPending, status]);
}
