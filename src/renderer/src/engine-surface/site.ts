// A render site as React holds it (R2): whether the session is attached as the engine's desktop surface (the status's
// `uiSurface` while its process is ready), the instance's answer, and the connection that re-asks a session's mounted
// instances when the engine invalidates them and forgets a session's answers when its surface goes.
import { useEffect, useMemo } from 'react';
import type { AskedSite, SurfaceViewport } from '@shared/engine/surface';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { useSurfaceViewport } from './viewport';
import { assistantDrawingKey, useAssistantDrawings } from './assistant-drawings';
import { ipc } from '../ipc/client';
import { useSessions } from '../stores/sessions';
import { useTranscriptStore } from '../stores/transcript';
import { forgetSession, hookKey, invalidateSession, retainSite, setSiteProps, siteKey, useSurfaceAnswers, type SiteAnswer } from './registry';

// Attached and live: the only state in which a site asks the engine.
export function useSurfaceAttached(appSessionId: AppSessionId | null): boolean {
  return useSessions((s) => {
    if (appSessionId === null) return false;
    const status = s.engine.get(appSessionId);
    return status?.process === 'ready' && status.uiSurface !== undefined;
  });
}

export interface SiteOptions {
  appSessionId: AppSessionId | null;
  component: AskedSite;
  instanceId: string;
  props: Record<string, unknown>;
  viewport?: SurfaceViewport;
  enabled?: boolean; // the site is on screen (default true)
  client?: MawsBridge;
}

// The instance's latest answer while the session is attached, else null (draw MAWS's own).
export function useSurfaceSite({ appSessionId, component, instanceId, props, viewport, enabled = true, client = ipc }: SiteOptions): SiteAnswer | null {
  const envelope = useSurfaceViewport();
  viewport ??= envelope;
  const attached = useSurfaceAttached(appSessionId);
  const on = enabled && attached && appSessionId !== null;
  const address = useMemo(() => (appSessionId === null ? null : { appSessionId, component, instanceId }), [appSessionId, component, instanceId]);
  const propsKey = JSON.stringify([props, viewport ?? null]);
  useEffect(() => (on && address ? retainSite(client, address) : undefined), [on, address, client]);
  useEffect(() => {
    if (on && address) setSiteProps(address, props, viewport);
    // `props` and `viewport` are read through their key, so an equal object built anew asks nothing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, address, propsKey]);
  return useSurfaceAnswers((s) => {
    if (!on || !address) return null;
    if (s.hooked.get(hookKey(address.appSessionId, component)) === false) return UNHOOKED;
    return s.answers.get(siteKey(address)) ?? null;
  });
}

const UNHOOKED: SiteAnswer = { tree: { type: 'engine', ref: 0 }, props: {}, rewritten: false, hooked: false };

export function useSurfaceHooked(appSessionId: AppSessionId | null, component: AskedSite): boolean | undefined {
  return useSurfaceAnswers((s) => appSessionId === null ? undefined : s.hooked.get(hookKey(appSessionId, component)));
}

// Live batches only (never a snapshot): an invalidate re-asks the session's mounted instances; a session whose status
// no longer carries the surface forgets its answers. UX wave U2b (the execution document, §E, "After a reload MAWS
// re-asks by itself"; check 1's C4: `reload_plugins` may push no invalidation): a status whose plugins were observed at
// another time than the last one this window knew for the session (a reload, a new launch's report) re-asks its
// mounted instances exactly as an invalidation does. What the window knows is the sessions store's, which both routes
// of a status fill: an event, and the snapshot of `engine.sessions` a window reads at its start for sessions already
// running (M5's fix wave 1), so the first reload after that snapshot is one too.
export function connectEngineSurface(client: MawsBridge = ipc): () => void {
  const observed = new Map<AppSessionId, string | null>();
  const look = (engine: ReadonlyMap<AppSessionId, EngineSessionStatus>) => {
    for (const [id, status] of engine) {
      if (status.process !== 'ready' || status.uiSurface === undefined) {
        observed.delete(id);
        continue;
      }
      const before = observed.get(id);
      observed.set(id, status.pluginsObservedAt);
      if (before !== undefined && before !== status.pluginsObservedAt) invalidateSession(id);
    }
    for (const id of observed.keys()) if (!engine.has(id)) observed.delete(id);
  };
  look(useSessions.getState().engine);
  const offSessions = useSessions.subscribe((s, prev) => { if (s.engine !== prev.engine) look(s.engine); });
  const offEvents = client.on('session.eventBatch', ({ appSessionId, events }) => {
    if (events.some((event) => event.kind === 'plugin.invalidate')) invalidateSession(appSessionId as AppSessionId);
  });
  const offStatus = client.on('session.status', ({ appSessionId, status }) => {
    const now = status.process === 'ready' && status.uiSurface !== undefined;
    if (!now) {
      forgetSession(appSessionId as AppSessionId);
      // Mounted rows must survive until React hands their presentation back to the detached renderer.
      // Unmounted surface drawings have no such owner and are cleared immediately.
      const drawings = useAssistantDrawings.getState();
      useTranscriptStore.getState().clearAssistantInk(appSessionId, 'surface', (row) => drawings.has(assistantDrawingKey(appSessionId, row)));
    }
  });
  return () => {
    offSessions();
    offEvents();
    offStatus();
  };
}
