// The widgets' engine reads (C11 execution document, Interfaces "Widgets" and M2 decisions): a TanStack query over one of
// C3's session reads, keyed as `useCommand` keys it (so C7's reads of the same command share the cache), fresh for 10 s,
// refetched when the session's status moves and when an operation naming the session completes, and issued only over
// a ready process. A harness may mount widgets passively (`WidgetReadPolicyContext`, mode `passive`): the query then
// issues nothing of its own and renders whatever the harness read into the cache under the widget's key, so a strict
// replay sees exactly the frames its driver writes.
// P2-A (2026-10-09; the execution document §5.6): a session with a record and no ready process is not an error. The
// read is `dormant` (the cached answer, if any, still served with when it was read), `starting` while an acquisition or
// a launch runs, or `unavailable` (a terminal or a job holds it, it is archived, or the last Load now was refused, in
// words). Only an owner's Load now or Refresh acquires (`loadForRead`); the queries, the operation refetch and the
// interval stay gated on a ready process, so a mount, a switch, a refetch or a timer never starts an engine.
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandInput, CommandOutput } from '@shared/ipc/schema';
import type { AcquireOutcome } from '@shared/sessions/setup';
import { ipc } from '../ipc/client';
import { IpcCommandError, type QueryCommand } from '../ipc/query';
import { acquireSession, refusalWords } from '../sessions/acquire';
import { availabilityIn, availabilityRefusal } from '../sessions/availability';
import { useSessions, type SessionsState } from '../stores/sessions';
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

// The session's last event seq when each cached answer was read (by query key), so a widget opened after anything
// happened in the session reads again even when the answer is fresh by age (C11 M6, live: `/diff` opened just after a
// turn that wrote a file showed the read from before it; the turn left MOVES_READS' facts where they were).
const readAtSeq = new Map<string, number | null>();
const lastSeq = (id: AppSessionId): number | null => useSessions.getState().engine.get(id)?.lastEventSeq ?? null;

export type ReadState = 'loading' | 'ready' | 'error' | 'dormant' | 'starting' | 'unavailable';

export interface EngineRead<T> {
  state: ReadState;
  data: T | undefined; // while dormant, the cache's last answer
  error: string | null; // the refusal in words; a timeout reads as the engine's silence; with data, that it is the last value; unavailable: why
  readAt: number | null; // when `data` was read (P2-A: a dormant body is labelled with it)
  refetch(): void;
  refresh(): Promise<{ data: T | undefined; failed: IpcCommandError | null }>; // a read now, answering what it read or why it failed
  load(): Promise<AcquireOutcome>; // P2-A: the owner's Load now: acquires the session; the read follows at ready
}

// P2-A start (2026-10-09): a Load now or Refresh per session, shared by every surface of it (the frame's button, a
// hook's `load`, the context popover's and Session info's Refresh): whether one is running, and the words of the last
// one refused. The words go when the next begins or the process is ready.
interface ReadLoads {
  loads: ReadonlyMap<AppSessionId, { acquiring: boolean; refused: string | null }>;
}
export const useReadLoads = create<ReadLoads>()(() => ({ loads: new Map() }));
const setLoad = (id: AppSessionId, load: { acquiring: boolean; refused: string | null } | null) =>
  useReadLoads.setState((s) => {
    const loads = new Map(s.loads);
    if (load === null) loads.delete(id);
    else loads.set(id, load);
    return { loads };
  });
useSessions.subscribe(({ engine }) => {
  const { loads } = useReadLoads.getState();
  for (const [id, load] of loads) if (!load.acquiring && engine.get(id)?.process === 'ready') setLoad(id, null);
});

// An owner's Load now or Refresh: acquires the session for a read (main joins a launch already in flight). Call it only
// from an event handler. A thrown IPC failure is answered in words too, and rethrown.
export async function loadForRead(appSessionId: AppSessionId): Promise<AcquireOutcome> {
  setLoad(appSessionId, { acquiring: true, refused: null });
  try {
    const outcome = await acquireSession(appSessionId, 'read');
    setLoad(appSessionId, { acquiring: false, refused: refusalWords(outcome) });
    return outcome;
  } catch (error) {
    setLoad(appSessionId, { acquiring: false, refused: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

// What a surface on a session with no ready process shows: `starting` while a Load now or a launch runs; `unavailable`
// with its words for a holder, an archive, a session that has not started (an unstarted tab's), or a refused Load now;
// else `dormant`.
export type DormantState = { state: 'dormant' | 'starting'; words: null } | { state: 'unavailable'; words: string };
export function dormantStateOf(s: Pick<SessionsState, 'engine' | 'digests' | 'records'>, load: { acquiring: boolean; refused: string | null } | undefined, appSessionId: AppSessionId): DormantState {
  const availability = availabilityIn(s, appSessionId);
  if (load?.acquiring || availability === 'starting') return { state: 'starting', words: null };
  const refused = availabilityRefusal(availability, s.records.get(appSessionId)?.holder ?? null) ?? load?.refused ?? null;
  if (refused !== null) return { state: 'unavailable', words: refused };
  return { state: 'dormant', words: null };
}

export const isDormant = (state: ReadState): state is DormantState['state'] => state === 'dormant' || state === 'starting' || state === 'unavailable';

// The same states for a widget that reads no engine query of its own (its body is the status or the catalogue): null
// while the process is ready.
export function useDormant(appSessionId: AppSessionId): DormantState | null {
  const load = useReadLoads((s) => s.loads.get(appSessionId));
  return useSessions(useShallow((s) => (s.engine.get(appSessionId)?.process === 'ready' ? null : dormantStateOf(s, load, appSessionId))));
}
// P2-A end

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
      const seq = lastSeq(appSessionId);
      const answer = await fetchEngineRead(command, input);
      readAtSeq.set(keyHash, seq);
      return answer;
    },
    staleTime: READ_STALE_MS,
    enabled: active && ready && wanted,
    refetchInterval: active && ready && wanted && options.refetchIntervalMs !== undefined ? options.refetchIntervalMs : false,
  });
  const { refetch } = query;

  // A read already in flight (the one `enabled` started when the process became ready) answers for the move too.
  const seen = useRef(moved);
  useEffect(() => {
    if (seen.current === moved) return;
    seen.current = moved;
    if (active && ready && wanted) void refetch({ cancelRefetch: false });
  }, [active, ready, wanted, moved, refetch]);

  // On open: an answer read before the session's latest event is read again, once.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !(active && ready && wanted)) return;
    opened.current = true;
    const at = readAtSeq.get(keyHash);
    if (at !== undefined && at !== lastSeq(appSessionId)) void refetch({ cancelRefetch: false });
  }, [active, ready, wanted, keyHash, appSessionId, refetch]);

  // P2-A: an operation's completion reads again only over a ready process (on a dormant widget the read would ask a
  // session with no process and land in the error state)
  useEffect(() => {
    if (!active || !wanted || !ready) return;
    return ipc.on('session.operation', (event) => {
      if (event.appSessionId === appSessionId) void refetch({ cancelRefetch: false });
    });
  }, [active, wanted, ready, appSessionId, refetch]);

  // P2-A: no ready process is dormant, starting or unavailable, never an error
  const load = useReadLoads((s) => s.loads.get(appSessionId));
  const dormant = useSessions(useShallow((s) => (active && !ready ? dormantStateOf(s, load, appSessionId) : null)));

  let state: ReadState;
  if (dormant) state = dormant.state;
  else if (query.data !== undefined) state = 'ready';
  else if (query.isError) state = 'error';
  else state = 'loading';
  const error = dormant ? dormant.words : query.data !== undefined && query.error ? staleWords(query.error) : errorWords(query.error);
  return {
    state,
    data: query.data,
    error,
    readAt: query.data !== undefined ? query.dataUpdatedAt : null,
    // P2-A: nothing is read without a ready process (TanStack's refetch would ignore `enabled`)
    refetch: () => {
      if (ready || !active) void refetch();
    },
    // joins a read already in flight (the one an operation's completion started), so a read-back costs one read
    refresh: async () => {
      if (active && !ready) return { data: query.data, failed: null };
      const result = await refetch({ cancelRefetch: false });
      return { data: result.data, failed: result.isError ? result.error : null };
    },
    load: () => loadForRead(appSessionId),
  };
}

// A control's transport branch (Interfaces "Transport and timeout errors are the separate branch"): a rejected invoke
// infers nothing; the control keeps the value the engine last reported and says why.
export { transportWords } from '../ipc/transport-words';
