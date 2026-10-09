// Each session's app queue as the composer shows it (C7 execution document, Repository map `stores/queue.ts`; "Submit
// control and queue"): C3's `session.queue` events and a `session.queue.list` snapshot, per session, while a composer
// is attached. The event carries the whole queue and no revision, so the rule is arrival: the subscription goes on
// first, and a snapshot that answers after an event for its session is older than that event and is dropped. A session
// whose queue the host cannot answer (no process and no state file yet) holds the empty queue. W1: the pending `next`
// steers (Enter while a turn runs) and the uuids of those held back into the queue ride along.
import { useEffect } from 'react';
import { create } from 'zustand';
import type { PendingSteer, QueueEntry, QueuePauseReason, QueueState as HostQueueState } from '@shared/engine/session-state-store';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';

export interface SessionQueue {
  entries: readonly QueueEntry[];
  paused: boolean;
  pauseReason: QueuePauseReason | null; // why it paused; null while running, and for a state file older than the reason
  steers: readonly PendingSteer[]; // W1: `next` steers the engine has not started yet, in write order
  withdrawn: readonly MessageUuid[]; // W1: steers held back into the queue (the engine reports them cancelled)
  loaded: boolean; // a snapshot or an event has arrived
}

export const EMPTY_QUEUE: SessionQueue = Object.freeze({ entries: Object.freeze([]) as readonly QueueEntry[], paused: false, pauseReason: null, steers: Object.freeze([]) as readonly PendingSteer[], withdrawn: Object.freeze([]) as readonly MessageUuid[], loaded: false });

const sessionQueueOf = (q: Omit<HostQueueState, 'pauseReason'> & { pauseReason?: QueuePauseReason | null }): SessionQueue => ({
  entries: q.entries, paused: q.paused, pauseReason: q.pauseReason ?? null, steers: q.steers ?? EMPTY_QUEUE.steers, withdrawn: q.withdrawn ?? EMPTY_QUEUE.withdrawn, loaded: true,
});

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
      put(appSessionId, sessionQueueOf(e));
    });
    void client.invoke('session.queue.list', { appSessionId }).then((result) => {
      if (!live || evented) return;
      put(appSessionId, result.ok ? sessionQueueOf(result.value) : { ...EMPTY_QUEUE, loaded: true });
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

// P2-0: a human send outside a mounted composer still needs the queue's between-write-and-turn busy signal. Use
// the event-fed value only while it is attached; a detached cached queue can be stale. Subscribe before the read,
// with the same arrival rule as attachQueue, so a newer queue event always wins over the snapshot.
export async function readSessionQueue(appSessionId: AppSessionId, client: MawsBridge = ipc): Promise<SessionQueue> {
  const current = useQueueStore.getState().bySession.get(appSessionId);
  if (attachments.has(appSessionId) && current?.loaded) return current;
  let evented: SessionQueue | null = null;
  const off = client.on('session.queue', (e) => {
    if (e.appSessionId === appSessionId) evented = sessionQueueOf(e);
  });
  try {
    const result = await client.invoke('session.queue.list', { appSessionId });
    return evented ?? (result.ok ? sessionQueueOf(result.value) : { ...EMPTY_QUEUE, loaded: true });
  } finally {
    off();
  }
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
