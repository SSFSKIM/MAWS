// Request/response data through TanStack Query (charter §12 C1 *State wiring*): `useCommand` is a cached query over
// one X2 *read* command. Queries refetch on focus and remount and cannot hold `undefined`, so the hook takes only the
// commands in QUERY_COMMANDS: reads without side effects whose output is a value. Writes and every other command go
// through `ipc.invoke` (or a store action built on it, like `useSettings().setTheme`). Pushed state (events) lives in
// Zustand stores; see `stores/settings.ts`.
import { QueryClient, useQuery, type UseQueryOptions } from '@tanstack/react-query';
import type { CommandInput, CommandName, CommandOutput, IpcError } from '@shared/ipc/schema';
import { ipc } from './client';

// Commands whose output is not `void` (a `z.void()` output infers `void`, which nothing else extends).
type ValueCommand = { [N in CommandName]: CommandOutput<N> extends void ? never : N }[CommandName];

// The read commands, listed on purpose: whether a command is side-effect free is not visible in its schema. A child
// adding a read command adds its name here; the `satisfies` refuses one whose output is void.
export const QUERY_COMMANDS = [
  'settings.get',
  'engine.ping',
  'engine.hostState',
  'pty.ping',
  'pty.hostState',
  'fs.workflows', // C8a: a disk-only session's workflow runs (the summary's Background work), invalidated on fs.workflowChanged
  // C7 start: the composer's, the request card's and the status line's reads (C7 execution document, Repository map)
  'attention.request',
  'session.catalog',
  'session.listModels',
  'session.getContextUsage',
  'session.getUsage',
  'session.getMemoryDialog',
  'session.getSessionCost',
  'settings.usage',
  'git.lsFiles',
  'session.history.list',
  'session.listPermissionRules', // M4: the + dir chip's workspace directories
  'git.branches', // M4: the location chip's branch picker
  // C7 end
  // C11 start: the widgets' engine reads, Session info's and the Settings tab's (C11 execution document, Repository map),
  // and C10's model catalogue, which the Direct model choice and Session info's lane read before any process
  'session.getSettings',
  'session.getHooksListing',
  'session.getSandboxDialog',
  'session.getSkillsDialog',
  'session.getWorkspaceDiff',
  'session.exportConversation',
  'session.getStatus',
  'session.mcpStatus',
  'engine.binaryInfo',
  'engine.relayHealth',
  'engine.models',
  'settings.claudeUsage.status',
  // C11 end
] as const satisfies readonly ValueCommand[];
export type QueryCommand = (typeof QUERY_COMMANDS)[number];

// An IPC failure is an answer from main (invalid input, host unavailable, …), not a flaky network: no retries.
export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

export class IpcCommandError extends Error {
  constructor(readonly error: IpcError) {
    super(error.message);
    this.name = 'IpcCommandError';
  }
}

export function useCommand<N extends QueryCommand>(
  name: N,
  input: CommandInput<N>,
  options?: Omit<UseQueryOptions<CommandOutput<N>, IpcCommandError>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<CommandOutput<N>, IpcCommandError>({
    queryKey: ['maws', name, input],
    queryFn: async () => {
      const result = await ipc.invoke(name, input);
      if (!result.ok) throw new IpcCommandError(result.error);
      return result.value;
    },
    ...options,
  });
}
