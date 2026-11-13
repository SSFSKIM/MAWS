// The configured inventory of a folder (UX2-K; `customization.inventory`, answered by this Mac's engine host with no
// session running): one query for Customize's page and, before a chat's first message, its Connectors and Skills dialogs
// and the "+" › Connectors submenu (UX wave U11a, §D). One key, so they share the answer; a stale time, so opening the
// submenu twice reads once. Every CLI change the runner makes (an MCP server added or removed among them) reads it again.
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CommandOutput } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { IpcCommandError } from '../ipc/query';

export type Inventory = CommandOutput<'customization.inventory'>;
export const INVENTORY_STALE_MS = 30_000;
const INVENTORY = ['maws', 'customization.inventory'] as const;

export function useCustomizationInventory(cwd: string | null, opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled ?? true;
  const client = useQueryClient();
  useEffect(() => (enabled ? ipc.on('plugins.changed', () => void client.invalidateQueries({ queryKey: INVENTORY })) : undefined), [client, enabled]);
  return useQuery<Inventory, Error>({
    queryKey: [...INVENTORY, { cwd }],
    queryFn: async () => {
      // P5 O6 M4: Customize is this machine's, as its plugin and connector actions are, until O4 spans machines.
      const answer = await ipc.invoke('customization.inventory', { cwd }, { machine: ipc.localMachine });
      if (!answer.ok) throw new IpcCommandError(answer.error);
      return answer.value;
    },
    staleTime: INVENTORY_STALE_MS,
    enabled,
  });
}
