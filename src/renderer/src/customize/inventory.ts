// The configured inventory of a folder (UX2-K; `customization.inventory`, answered by this Mac's engine host with no
// session running): one query for Customize's page and, before a chat's first message, its Connectors and Skills dialogs
// and the "+" › Connectors submenu (UX wave U11a, §D). One key, so they share the answer; a stale time, so opening the
// submenu twice reads once. Every CLI change the runner makes (an MCP server added or removed among them) makes every
// folder's answer stale by the plugin reads' one rule (widgets/plugins/after-change.ts), whether or not a reader is
// mounted or may fetch: a reader shown reads again at once, or after the read in flight when the change came, which may
// predate it; one mounted later, or enabled again (the "+" menu reopened), reads instead of a pre-change answer inside
// the stale time.
import { useQuery } from '@tanstack/react-query';
import type { CommandOutput } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { IpcCommandError } from '../ipc/query';
import { useReadAgainAfterPluginsChange } from '../widgets/plugins/after-change';

export type Inventory = CommandOutput<'customization.inventory'>;
export const INVENTORY_STALE_MS = 30_000;

export function useCustomizationInventory(cwd: string | null, opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled ?? true;
  useReadAgainAfterPluginsChange('customization.inventory');
  return useQuery<Inventory, Error>({
    queryKey: ['maws', 'customization.inventory', { cwd }],
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
