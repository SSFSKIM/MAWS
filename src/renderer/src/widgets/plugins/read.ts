// The plugin CLI's reads (E8 execution document, M2): `plugins.list`, `marketplaces.list` and `plugins.available` are
// not session reads (the CLI needs no engine process), so they are keyed by the directory the CLI runs in and issued
// whether or not the session runs; `plugins.changed` (emitted when any mutation's CLI ends) reads them again. Each runs
// the engine's CLI, which refreshes its own catalogue cache (D-12), so none refetches on focus, and a harness mounting
// widgets passively (`WidgetReadPolicyContext`) issues none.
import { useQuery } from '@tanstack/react-query';
import { useContext, useEffect } from 'react';
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

// `enabled: false` holds the read (Available until its section is first opened).
export function usePluginsRead<N extends PluginsRead>(command: N, cwd: string | null, enabled = true): PluginsReadResult<CommandOutput<N>> {
  const active = useContext(WidgetReadPolicyContext).mode === 'active';
  const on = active && enabled && cwd !== null;
  const query = useQuery<CommandOutput<N>, IpcCommandError>({
    queryKey: ['maws', command, { cwd }],
    queryFn: () => invokeRead(command, { cwd: cwd! } as never),
    enabled: on,
    staleTime: READ_STALE_MS,
    refetchOnWindowFocus: false,
  });
  const { refetch } = query;
  useEffect(() => {
    if (!on) return;
    return ipc.on('plugins.changed', () => void refetch({ cancelRefetch: false }));
  }, [on, refetch]);
  const error = query.data !== undefined && query.error ? `${errorWords(query.error)} · ${FRAME.lastValue}` : errorWords(query.error);
  return { state: query.data !== undefined ? 'ready' : query.isError ? 'error' : 'loading', data: query.data, error };
}

// The binary the CLI runs (the launcher's probe; null when it fails) and the config home it writes, for the sheet and
// the foot. Neither moves while the app runs, so it is read once.
export function usePluginsEnv(): CommandOutput<'plugins.env'> | null {
  const active = useContext(WidgetReadPolicyContext).mode === 'active';
  const query = useQuery<CommandOutput<'plugins.env'>, IpcCommandError>({
    queryKey: ['maws', 'plugins.env', {}],
    queryFn: () => invokeRead('plugins.env', {}),
    enabled: active,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  return query.data ?? null;
}
