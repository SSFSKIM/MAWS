// X17 in the renderer (P2-A execution document §5.5): what the engine last reported for a session, read through main's
// `session.observedFacts`, and how fresh a fact is in the person's words. Precedence everywhere: live (a ready process,
// and the fact reported in this launch) over observed ("Loaded last time, 2 days ago") over unknown ("Not observed
// yet"); a record's requested or default values are never shown as observed. Reading the facts starts nothing.
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { Fact, ObservedFactsAnswer, ObservedPlugin, ObservedPluginError, ObservedPluginWarning } from '@shared/engine/observed-facts';
import type { AppSessionId } from '@shared/graph/ids';
import { relativeAge } from '../app/relative-age';
import { ipc } from '../ipc/client';
import { IpcCommandError } from '../ipc/query';
import type { AcquireOutcome } from '@shared/sessions/setup';
import { useSessions } from '../stores/sessions';
import { useOperation } from '../widgets/operation'; // P2-A M3
import { loadForRead } from '../widgets/read'; // P2-A M3

export type Freshness = { kind: 'now' } | { kind: 'last'; at: string } | { kind: 'unknown' };

export function freshness(fact: Fact<unknown>, live: boolean): Freshness {
  if (live) return { kind: 'now' };
  return fact ? { kind: 'last', at: fact.at } : { kind: 'unknown' };
}

const ago = (at: string, now: number) => relativeAge(Math.max(0, now - Date.parse(at)));
export const FRESHNESS = {
  loadedNow: 'Loaded now',
  loadedLast: (at: string, now = Date.now()) => `Loaded last time, ${ago(at, now)}`,
  lastReading: (at: string, now = Date.now()) => `Last reading, ${ago(at, now)}`,
  lastObserved: (at: string, now = Date.now()) => `Last observed ${ago(at, now)}`,
  notObserved: 'Not observed yet',
};

// The facts of one session. Keyed with its engine status's launch and process, so an exit (whose facts the host has
// just written) or a new launch reads again; a complete answer stays fresh until then, while a null or partial one
// (`complete: false`, a recovery its reading budget cut short) is read again at the surface's next open.
export function useObservedFacts(appSessionId: AppSessionId, opts: { enabled?: boolean } = {}): { facts: ObservedFactsAnswer | null; loading: boolean } {
  const launch = useSessions((s) => {
    const status = s.engine.get(appSessionId);
    return status ? `${status.launchId}|${status.process}` : 'none';
  });
  const query = useQuery<ObservedFactsAnswer | null, IpcCommandError>({
    queryKey: ['maws', 'session.observedFacts', { appSessionId }, launch],
    queryFn: async () => {
      const result = await ipc.invoke('session.observedFacts', { appSessionId });
      if (!result.ok) throw new IpcCommandError(result.error);
      return result.value;
    },
    enabled: opts.enabled ?? true,
    staleTime: (q) => (q.state.data?.complete ? Infinity : 0),
  });
  return { facts: query.data ?? null, loading: query.isLoading };
}

export interface LoadedPlugins {
  plugins: ObservedPlugin[];
  errors: ObservedPluginError[];
  warnings: ObservedPluginWarning[];
  freshness: Freshness;
}

const UNKNOWN: LoadedPlugins = { plugins: [], errors: [], warnings: [], freshness: { kind: 'unknown' } };

// The loaded plugins by precedence: a ready process whose launch reported them (system/init or reload_plugins); else
// the later of the facts file's and an exited status's own report, labelled with when; else unknown. A ready process
// that has not reported them yet (a no-prompt start) reads the observed list, never its empty one.
export function loadedPluginsOf(status: EngineSessionStatus | null, facts: ObservedFactsAnswer | null): LoadedPlugins {
  const reported = status && status.pluginsObservedAt !== null ? { plugins: status.plugins, errors: status.pluginErrors, warnings: status.pluginWarnings, at: status.pluginsObservedAt } : null;
  if (status?.process === 'ready' && reported) return { plugins: reported.plugins, errors: reported.errors, warnings: reported.warnings, freshness: { kind: 'now' } };
  const observed = facts?.plugins ? { ...facts.plugins.value, at: facts.plugins.at } : null;
  const last = reported && (!observed || Date.parse(reported.at) > Date.parse(observed.at)) ? reported : observed;
  return last ? { plugins: last.plugins, errors: last.errors, warnings: last.warnings, freshness: { kind: 'last', at: last.at } } : UNKNOWN;
}

// P2-A M3 (2026-10-09; the execution document §5.7, branch Y): `refresh` is the owner's Refresh: it acquires the session
// for a read (joining a launch in flight), then reloads its plugins (`reload_plugins` answers before any turn with the
// loaded list, U1), so the list reads "Loaded now". It runs only from that gesture, never on open.
export function useLoadedPlugins(appSessionId: AppSessionId): LoadedPlugins & { refresh(): Promise<AcquireOutcome> } {
  const status = useSessions(useShallow((s) => s.engine.get(appSessionId) ?? null));
  const liveNow = status?.process === 'ready' && status.pluginsObservedAt !== null;
  const { facts } = useObservedFacts(appSessionId, { enabled: !liveNow });
  const reload = useOperation(appSessionId, 'session.reloadPlugins');
  const { run } = reload;
  const refresh = useCallback(async () => {
    const outcome = await loadForRead(appSessionId);
    if (outcome.status === 'ready') await run({});
    return outcome;
  }, [appSessionId, run]);
  const loaded = useMemo(() => loadedPluginsOf(status, facts), [status, facts]);
  return useMemo(() => ({ ...loaded, refresh }), [loaded, refresh]);
}
