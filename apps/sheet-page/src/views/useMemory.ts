// One session's stored memory in a view (memory.ts; T19): read from storage, read again whenever this tab or another
// changes it, and changed only by updates bound to that session, so an update that lands after the view unmounted (a
// Send's late answer, a late paste) still lands in its own session's entries. An update is bound to the pairing it was
// made under too: one that lands after the person unpaired this browser (an upload's late answer) is dropped, since
// Unpair forgets everything and a later pairing is another, while one that lands after a move to another place under
// the same pairing still lands. One snapshot a session and a pairing, dropped at each change and when a view
// subscribes, so a view that mounts after a change it did not hear reads storage again.
import { useCallback, useSyncExternalStore } from 'react';
import type { SheetModel } from '@shared/sheet/model';
import { reconcile, type SheetMemory } from '../../../../src/renderer/src/sheet';
import { readPairing } from '../credential';
import { madeElsewhere, onMemory, readMemory, sendingSince, updateMemory, type MemoryUpdateOptions } from '../memory';

export interface SessionMemory {
  memory: SheetMemory;
  elsewhereSince: number | null; // since when a Send this window did not make has been held, while it is being sent
  // `against`: the model the update was made against (memory.ts: what it knows, its `seq`, and its reconcile)
  update(update: (current: SheetMemory) => SheetMemory, against?: Against): void;
}

type Against = Pick<MemoryUpdateOptions, 'known' | 'base'>;

/**
 * What an update made against a model carries of it: the questions it holds in any form (open, hidden by a queued
 * dismissal, or closed), and the tab's view of the stored memory, its reconcile against that model.
 */
export function against(model: SheetModel): Required<Against> {
  const ids = new Set([...model.open.map((question) => question.id), ...model.hidden.map((entry) => entry.id), ...Object.keys(model.closed)]);
  return { known: (question) => ids.has(question), base: (stored) => reconcile(stored, model) };
}

const pairingNow = (): string | null => {
  const pairing = readPairing();
  return pairing === null ? null : `${pairing.id} ${pairing.credential}`;
};

const snapshots = new Map<string, SessionMemory & { pairing: string | null }>();

function snapshotOf(session: string): SessionMemory {
  const pairing = pairingNow();
  const known = snapshots.get(session);
  if (known && known.pairing === pairing) return known;
  const memory = readMemory(session);
  const elsewhere = madeElsewhere(memory) && memory.sending?.state === 'sending';
  const made = {
    memory,
    elsewhereSince: elsewhere ? sendingSince(session) : null,
    pairing,
    update: (update: (current: SheetMemory) => SheetMemory, against?: Against) => {
      if (pairing === null || pairingNow() !== pairing) return; // the pairing it was made under has ended
      updateMemory(session, update, { ...against });
    },
  };
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
