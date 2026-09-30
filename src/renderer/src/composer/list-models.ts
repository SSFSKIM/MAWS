// The composer's two model reads. `useListModels` is C7's read of a session's models (`session.listModels`, a control
// request to the engine, so only when a reader is enabled: a chip or the mode menu that shows them opened, never per
// mount); every answer is remembered per session in the composer store for C11's readers. `useModelCatalogue` is
// C10's host-side catalogue (`engine.models`, one per route, answered from the host's cache without asking any
// engine), which names the model chip's model from the first render, before any menu has opened.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { ModelCatalogueEntry } from '@shared/sessions/models';
import { useCommand } from '../ipc/query';
import { rememberListedModels, type ListedModel } from '../stores/composer';

export function useListModels(appSessionId: AppSessionId, enabled: boolean): readonly ListedModel[] | null {
  const read = useCommand('session.listModels', { appSessionId }, { enabled, staleTime: 60_000 });
  const models = read.data?.models ?? null;
  useEffect(() => {
    if (models) rememberListedModels(appSessionId, models);
  }, [appSessionId, models]);
  return models;
}

export type Route = 'gateway' | 'direct';

const CATALOGUE = ['maws', 'engine.models'];

// The route whose catalogue names a session's models: the running process's own, else the one its record kept; null
// when neither says (a discovered session), and `engine.models` answers the most recently updated catalogue.
export function routeOf(status: EngineSessionStatus | null, record: SessionRecord | null): Route | null {
  if (status) return status.gateway.mode;
  const routed = record?.gateway.routed ?? null;
  return routed === null ? null : routed ? 'gateway' : 'direct';
}

// The route's catalogue. A launch updates its route's catalogue at `initialize`, so the read is renewed when the
// session's process becomes ready (a relay's `claude/*` aliases arrive with the first routed launch): on the change to
// ready only, not at every mount of an already-ready session's composer. With the route, the session's directory: a
// launch whose settings there set a model environment of its own has its own catalogue (debt wave 5).
export function useModelCatalogue(route: Route | null, ready: boolean, cwd: string | null = null): readonly ModelCatalogueEntry[] | null {
  const read = useCommand('engine.models', route === null ? { refresh: false } : cwd === null ? { refresh: false, gateway: route } : { refresh: false, gateway: route, cwd }, { staleTime: 60_000 });
  const client = useQueryClient();
  const wasReady = useRef(ready);
  useEffect(() => {
    // a first read still in flight would be reused by a bare invalidation and settle with the pre-launch catalogue
    if (ready && !wasReady.current) void client.cancelQueries({ queryKey: CATALOGUE }).then(() => client.invalidateQueries({ queryKey: CATALOGUE }));
    wasReady.current = ready;
  }, [ready, client]);
  return read.data?.models ?? null;
}
