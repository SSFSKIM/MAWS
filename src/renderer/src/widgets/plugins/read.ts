// The plugin CLI's reads (E8 execution document, M2): `plugins.list`, `marketplaces.list` and `plugins.available` are
// not session reads (the CLI needs no engine process), so they are keyed by the directory the CLI runs in and issued
// whether or not the session runs; `plugins.changed` (emitted when any mutation's CLI ends) reads them again (after a
// listing already in flight, whose answer may predate the change). Each runs
// the engine's CLI, which refreshes its own catalogue cache (D-12), so none refetches on focus, and a harness mounting
// widgets passively (`WidgetReadPolicyContext`) issues none.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useContext, useEffect, useRef } from 'react';
import type { CommandOutput } from '@shared/ipc/schema';
import { ipc } from '../../ipc/client';
import { IpcCommandError } from '../../ipc/query';
import { FRAME } from '../copy';
import { errorWords, READ_STALE_MS, WidgetReadPolicyContext } from '../read';

export type PluginsRead = 'plugins.list' | 'marketplaces.list' | 'plugins.available';

export interface PluginsReadResult<T> {
  state: 'loading' | 'ready' | 'error';
  data: T | undefined;
  error: string | null; // the refusal in words; with data, that the list shown is the last one read
}

async function invokeRead<N extends PluginsRead | 'plugins.env'>(command: N, input: N extends 'plugins.env' ? Record<string, never> : { cwd: string }): Promise<CommandOutput<N>> {
  const result = await ipc.invoke(command, input as never);
  if (!result.ok) throw new IpcCommandError(result.error);
  return result.value as CommandOutput<N>;
}

const resultOf = <T,>(data: T | undefined, failed: IpcCommandError | null, isError: boolean): PluginsReadResult<T> => {
  const error = data !== undefined && failed ? `${errorWords(failed)} · ${FRAME.lastValue}` : errorWords(failed);
  return { state: data !== undefined ? 'ready' : isError ? 'error' : 'loading', data, error };
};

// `enabled: false` holds the read (Available while its section is closed).
export function usePluginsRead<N extends PluginsRead>(command: N, cwd: string | null, enabled = true): PluginsReadResult<CommandOutput<N>> {
  const active = useContext(WidgetReadPolicyContext).mode === 'active';
  const on = active && enabled && cwd !== null;
  const client = useQueryClient();
  const query = useQuery<CommandOutput<N>, IpcCommandError>({
    queryKey: ['maws', command, { cwd }],
    queryFn: () => invokeRead(command, { cwd: cwd! } as never),
    enabled: on,
    staleTime: READ_STALE_MS,
    refetchOnWindowFocus: false,
  });
  const { refetch, isFetching } = query;
  // A change during a listing in flight: that listing may have read the state before the change, so one more read
  // follows it rather than joining it (M2 review); changes meanwhile coalesce into that one read.
  const owed = useRef(false);
  useEffect(() => {
    if (!on) return;
    return ipc.on('plugins.changed', () => {
      if (client.isFetching({ queryKey: ['maws', command, { cwd }] }) > 0) owed.current = true;
      else void refetch();
    });
  }, [on, client, command, cwd, refetch]);
  useEffect(() => {
    if (isFetching || !owed.current || !on) return;
    owed.current = false;
    void refetch();
  }, [isFetching, on, refetch]);
  return resultOf(query.data, query.error, query.isError);
}

// The binary the CLI runs (the launcher's probe; null when it fails), the config home it writes and the engine's global
// config file: the foot shows the last answer; every confirm sheet asks again (`reread`) and confirms nothing until that
// answer came, since Settings › Engine may have chosen another binary meanwhile (E8 whole-branch review), nor while it
// failed or names no binary (M2 review). `reread` answers the fresh read alone: a failed one is an error even when an
// earlier answer is cached.
export function usePluginsEnv(): PluginsReadResult<CommandOutput<'plugins.env'>> & { reread(): Promise<PluginsReadResult<CommandOutput<'plugins.env'>>> } {
  const active = useContext(WidgetReadPolicyContext).mode === 'active';
  const query = useQuery<CommandOutput<'plugins.env'>, IpcCommandError>({
    queryKey: ['maws', 'plugins.env', {}],
    queryFn: () => invokeRead('plugins.env', {}),
    enabled: active,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const { refetch } = query;
  const reread = useCallback(async () => {
    const answer = await refetch();
    return answer.isError ? resultOf<CommandOutput<'plugins.env'>>(undefined, answer.error, true) : resultOf(answer.data, null, false);
  }, [refetch]);
  return { ...resultOf(query.data, query.error, query.isError), reread };
}
