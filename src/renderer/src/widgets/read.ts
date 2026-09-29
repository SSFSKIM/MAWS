// The widgets' engine reads (C11 execution document, Interfaces "Widgets" and M2 decisions): a TanStack query over one of
// C3's session reads, keyed as `useCommand` keys it (so C7's reads of the same command share the cache), fresh for 10 s,
// refetched when the session's status moves and when an operation naming the session completes, and issued only over
// a ready process. A harness may mount widgets passively (`WidgetReadPolicyContext`, mode `passive`): the query then
// issues nothing of its own and renders whatever the harness read into the cache under the widget's key, so a strict
// replay sees exactly the frames its driver writes.
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef } from 'react';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandInput, CommandOutput } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { IpcCommandError, type QueryCommand } from '../ipc/query';
import { useSessions } from '../stores/sessions';
import { FRAME } from './copy';

export type WidgetReadPolicy = { mode: 'active' } | { mode: 'passive' };
export const WidgetReadPolicyContext = createContext<WidgetReadPolicy>({ mode: 'active' });

export const READ_STALE_MS = 10_000;

// The reads that name a session.
export type SessionRead = { [N in QueryCommand]: CommandInput<N> extends { appSessionId: string } ? N : never }[QueryCommand];

export const engineReadKey = <N extends SessionRead>(command: N, input: CommandInput<N>) => ['maws', command, input] as const;

async function fetchEngineRead<N extends SessionRead>(command: N, input: CommandInput<N>): Promise<CommandOutput<N>> {
  const result = await ipc.invoke(command, input);
  if (!result.ok) throw new IpcCommandError(result.error);
  return result.value;
}

// The harness's seam (`window.__maws_widgets.read`): one invoke, its answer landing where a mounted widget reads.
export function readIntoCache<N extends SessionRead>(client: QueryClient, command: N, input: CommandInput<N>): Promise<CommandOutput<N>> {
  return client.fetchQuery({ queryKey: engineReadKey(command, input), queryFn: () => fetchEngineRead(command, input), staleTime: 0 });
}

// What makes a read worth repeating: a new launch, the process moving, a turn opening or closing, the engine's state.
// A memory sample or a queue count does not.
export const MOVES_READS = (s: EngineSessionStatus): string => `${s.launchId}|${s.process}|${s.turn?.id ?? ''}|${s.engineState}`;

// The status fact each cached answer was read under (by query key), so a widget opened after the status moved reads
// again even when the answer is fresh by age (C11 M6, live: `/diff` opened just after a turn showed the turn-start read).
const readUnder = new Map<string, string | null>();

export type ReadState = 'loading' | 'ready' | 'error' | 'not_running';

export interface EngineRead<T> {
  state: ReadState;
  data: T | undefined;
  error: string | null; // the refusal in words; a timeout reads as the engine's silence; with data, that it is the last value
  refetch(): void;
  refresh(): Promise<{ data: T | undefined; failed: IpcCommandError | null }>; // a read now, answering what it read or why it failed
}

export interface EngineReadOptions {
  refreshOn?: (status: EngineSessionStatus) => string; // the status facts whose change refetches; MOVES_READS by default
  enabled?: boolean; // false holds the read (Session info while its tab is hidden); true by default
  refetchIntervalMs?: number; // a read repeated while enabled (Session info's 30 s while visible)
}

export const errorWords = (error: IpcCommandError | null): string | null => {
  if (error === null) return null;
  return error.error.code === 'timeout' ? `${FRAME.noAnswer} · ${error.message}` : error.message;
};

// A failed read after an answer: the answer stays, and one line says the engine's later answer is missing.
const staleWords = (error: IpcCommandError): string => `${error.error.code === 'timeout' ? FRAME.noAnswer : error.message} · ${FRAME.lastValue}`;

export function useEngineRead<N extends SessionRead>(command: N, input: CommandInput<N>, options: EngineReadOptions = {}): EngineRead<CommandOutput<N>> {
  const active = useContext(WidgetReadPolicyContext).mode === 'active';
  const appSessionId = (input as { appSessionId: AppSessionId }).appSessionId;
  const refreshOn = options.refreshOn ?? MOVES_READS;
  const wanted = options.enabled ?? true;
  const ready = useSessions((s) => s.engine.get(appSessionId)?.process === 'ready');
  const moved = useSessions((s) => {
    const status = s.engine.get(appSessionId);
    return status ? refreshOn(status) : null;
  });
  const key = engineReadKey(command, input);
  const keyHash = JSON.stringify(key);
  const query = useQuery<CommandOutput<N>, IpcCommandError>({
    queryKey: key,
    queryFn: async () => {
      const status = useSessions.getState().engine.get(appSessionId);
      const fact = status ? refreshOn(status) : null;
      const answer = await fetchEngineRead(command, input);
      readUnder.set(keyHash, fact);
      return answer;
    },
    staleTime: READ_STALE_MS,
    enabled: active && ready && wanted,
    refetchInterval: active && ready && wanted && options.refetchIntervalMs !== undefined ? options.refetchIntervalMs : false,
  });
  const { refetch } = query;

  // A read already in flight (the one `enabled` started when the process became ready) answers for the move too.
  // On open, an answer read under an earlier fact counts as a move.
  const seen = useRef(readUnder.has(keyHash) ? readUnder.get(keyHash)! : moved);
  useEffect(() => {
    if (seen.current === moved) return;
    seen.current = moved;
    if (active && ready && wanted) void refetch({ cancelRefetch: false });
  }, [active, ready, wanted, moved, refetch]);

  useEffect(() => {
    if (!active || !wanted) return;
    return ipc.on('session.operation', (event) => {
      if (event.appSessionId === appSessionId) void refetch({ cancelRefetch: false });
    });
  }, [active, wanted, appSessionId, refetch]);

  let state: ReadState;
  if (active && !ready) state = 'not_running';
  else if (query.data !== undefined) state = 'ready';
  else if (query.isError) state = 'error';
  else state = 'loading';
  const error = query.data !== undefined && query.error ? staleWords(query.error) : errorWords(query.error);
  return {
    state,
    data: query.data,
    error,
    refetch: () => void refetch(),
    // joins a read already in flight (the one an operation's completion started), so a read-back costs one read
    refresh: async () => {
      const result = await refetch({ cancelRefetch: false });
      return { data: result.data, failed: result.isError ? result.error : null };
    },
  };
}

// A control's transport branch (Interfaces "Transport and timeout errors are the separate branch"): a rejected invoke
// infers nothing; the control keeps the value the engine last reported and says why.
export { transportWords } from '../ipc/transport-words';
