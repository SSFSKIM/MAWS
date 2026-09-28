// Request/response data through TanStack Query (charter §12 C1 *State wiring*): `useCommand` is a query over one
// X2 command. Pushed state (events) lives in Zustand stores instead; see `stores/settings.ts` for that pattern.
import { QueryClient, useQuery, type UseQueryOptions } from '@tanstack/react-query';
import type { CommandInput, CommandName, CommandOutput, IpcError } from '@shared/ipc/schema';
import { ipc } from './client';

// An IPC failure is an answer from main (invalid input, host unavailable, …), not a flaky network: no retries.
export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

export class IpcCommandError extends Error {
  constructor(readonly error: IpcError) {
    super(error.message);
    this.name = 'IpcCommandError';
  }
}

export function useCommand<N extends CommandName>(
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
