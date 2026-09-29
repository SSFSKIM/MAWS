// Each session's app queue as the composer shows it (C7 execution document, Repository map `stores/queue.ts`; "Submit
// control and queue"): C3's `session.queue` events and a `session.queue.list` snapshot, per session, while a composer
// is attached. The event carries the whole queue and no revision, so the rule is arrival: the subscription goes on
// first, and a snapshot that answers after an event for its session is older than that event and is dropped. A session
// whose queue the host cannot answer (no process and no state file yet) holds the empty queue.
import { useEffect } from 'react';
import { create } from 'zustand';
import type { QueueEntry, QueuePauseReason } from '@shared/engine/session-state-store';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';

export interface SessionQueue {
  entries: readonly QueueEntry[];
  paused: boolean;
  pauseReason: QueuePauseReason | null; // why it paused; null while running, and for a state file older than the reason
  loaded: boolean; // a snapshot or an event has arrived
}

export const EMPTY_QUEUE: SessionQueue = Object.freeze({ entries: Object.freeze([]) as readonly QueueEntry[], paused: false, pauseReason: null, loaded: false });

interface QueueState {
  bySession: ReadonlyMap<AppSessionId, SessionQueue>;
}

export const useQueueStore = create<QueueState>()(() => ({ bySession: new Map() }));

const put = (appSessionId: AppSessionId, queue: SessionQueue) => useQueueStore.setState((s) => ({ bySession: new Map(s.bySession).set(appSessionId, queue) }));

const attachments = new Map<AppSessionId, { count: number; off: () => void }>();

// Hydrates a session's queue and keeps it live while anything is attached; the disposer releases one attachment.
export function attachQueue(appSessionId: AppSessionId, client: MawsBridge = ipc): () => void {
  const held = attachments.get(appSessionId);
  if (held) held.count += 1;
  else {
    let live = true;
    let evented = false;
    const off = client.on('session.queue', (e) => {
      if (!live || e.appSessionId !== appSessionId) return;
      evented = true;
      put(appSessionId, { entries: e.entries, paused: e.paused, pauseReason: e.pauseReason ?? null, loaded: true });
    });
    void client.invoke('session.queue.list', { appSessionId }).then((result) => {
      if (!live || evented) return;
      put(appSessionId, result.ok ? { entries: result.value.entries, paused: result.value.paused, pauseReason: result.value.pauseReason ?? null, loaded: true } : { ...EMPTY_QUEUE, loaded: true });
    });
    attachments.set(appSessionId, {
      count: 1,
      off: () => {
        live = false;
        off();
      },
    });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const entry = attachments.get(appSessionId);
    if (!entry) return;
    entry.count -= 1;
    if (entry.count > 0) return;
    entry.off();
    attachments.delete(appSessionId);
  };
}

export function resetQueueStore(): void {
  for (const entry of attachments.values()) entry.off();
  attachments.clear();
  useQueueStore.setState({ bySession: new Map() });
}

// The session's queue, kept live while the calling component is mounted.
export function useSessionQueue(appSessionId: AppSessionId, client: MawsBridge = ipc): SessionQueue {
  useEffect(() => attachQueue(appSessionId, client), [appSessionId, client]);
  return useQueueStore((s) => s.bySession.get(appSessionId) ?? EMPTY_QUEUE);
}
