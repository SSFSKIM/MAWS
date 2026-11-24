// One session's stored memory in a view (memory.ts; T19): read from storage, read again whenever this tab or another
// changes it, and changed only by updates bound to that session, so an update that lands after the view unmounted (a
// Send's late answer, a late paste) still lands in its own session's entries. One snapshot a session, dropped at each
// change and when a view subscribes, so a view that mounts after a change it did not hear reads storage again.
import { useCallback, useSyncExternalStore } from 'react';
import type { SheetMemory } from '../../../../src/renderer/src/sheet';
import { madeElsewhere, onMemory, readMemory, sendingSince, updateMemory } from '../memory';

export interface SessionMemory {
  memory: SheetMemory;
  elsewhereSince: number | null; // since when a Send this window did not make has been held, while it is being sent
  update(update: (current: SheetMemory) => SheetMemory): void;
}

const snapshots = new Map<string, SessionMemory>();

function snapshotOf(session: string): SessionMemory {
  const known = snapshots.get(session);
  if (known) return known;
  const memory = readMemory(session);
  const elsewhere = madeElsewhere(memory) && memory.sending?.state === 'sending';
  const made: SessionMemory = { memory, elsewhereSince: elsewhere ? sendingSince(session) : null, update: (update) => updateMemory(session, update) };
  snapshots.set(session, made);
  return made;
}

function subscribe(session: string, notify: () => void): () => void {
  snapshots.delete(session);
  return onMemory(session, () => {
    snapshots.delete(session);
    notify();
  });
}

export function useSessionMemory(session: string): SessionMemory {
  const subscribed = useCallback((notify: () => void) => subscribe(session, notify), [session]);
  const snapshot = useCallback(() => snapshotOf(session), [session]);
  return useSyncExternalStore(subscribed, snapshot);
}
