// The one subscription point that feeds the shell's stores from X2 events (C5 execution document, Renderer stores).
// C1's ordering rule: every event is subscribed before any snapshot command runs; each snapshot then reconciles with
// the events that raced it inside its store (by revision for sessions, projects and digests; by buffer and replay for
// attention). The layout hydrates once the sessions are known, so a persisted tab of a vanished session is dropped.
import type { MawsBridge } from '@shared/ipc/schema';
import { useAttention } from '../stores/attention';
import { createFreshness } from '../stores/freshness';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { ipc } from './client';

export interface ShellStores {
  sessions: typeof useSessions;
  attention: typeof useAttention;
  layout: typeof useLayout;
}

export function connectShell(client: MawsBridge = ipc, stores: ShellStores = { sessions: useSessions, attention: useAttention, layout: useLayout }): () => void {
  const sessions = () => stores.sessions.getState();
  const attention = () => stores.attention.getState();
  const freshness = createFreshness();
  let connected = true;
  const on: MawsBridge['on'] = (name, listener) => client.on(name, (payload) => connected && listener(payload));

  const offs = [
    on('session.changed', (e) => sessions().applyChanged(e)),
    on('session.removed', (e) => {
      // A stale removal (older than what the store knows) leaves the session, so its tabs stay too.
      if (sessions().applyRemoved(e)) stores.layout.getState().dropSession(e.appSessionId);
    }),
    on('session.projects.changed', (e) => sessions().applyProjects(e)),
    on('session.digest', (d) => sessions().applyDigest(d)),
    on('session.status', (e) => sessions().applyStatus(e)),
    on('attention.changed', (e) => attention().applyChanged(e)),
    on('attention.notified', (e) => attention().applyNotified(e)),
  ];

  // Replies apply only while this connection is live; the stores' own revisions decide against events.
  const live = freshness.stamp();
  const answer = async <T>(label: string, request: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>, apply: (value: T) => void) => {
    const result = await request;
    if (!live()) return;
    // A snapshot nobody answers leaves its store empty and live on events: a degraded start, not a fault in the page.
    // (In launch mode `index` before C3 and C4 land, the record side and attention have no answerer at all.)
    if (!result.ok) console.warn(`[shell] ${label} unavailable; starting empty`, result.error);
    else apply(result.value);
  };

  attention().beginSnapshot();
  void answer('attention.list', client.invoke('attention.list', undefined), (items) => attention().applySnapshot(items)).then(() => {
    if (live() && !attention().loaded) attention().applySnapshot([]); // no answerer: start empty, keep what was buffered
  });

  void Promise.all([
    answer('session.list', client.invoke('session.list', {}), (value) => sessions().applyList(value)),
    answer('session.projects.list', client.invoke('session.projects.list', undefined), (value) => sessions().applyProjects(value)),
    answer('session.digests', client.invoke('session.digests', undefined), ({ digests }) => sessions().applyDigests(digests)),
  ]).then(async () => {
    if (!live()) return;
    sessions().setLoaded();
    await stores.layout.getState().hydrate(client, (id) => sessions().records.has(id));
  });

  return () => {
    connected = false;
    freshness.advance();
    offs.forEach((off) => off());
  };
}
