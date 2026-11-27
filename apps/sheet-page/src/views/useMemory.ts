// One session's stored memory in a view (memory.ts; T19): read from storage, read again whenever this tab or another
// changes it, and changed only by updates bound to that session, so an update that lands after the view unmounted (a
// Send's late answer, a late paste) still lands in its own session's entries. An update is bound to the pairing it was
// made under too: one that lands after the person unpaired this browser (an upload's late answer) is dropped, since
// Unpair forgets everything and a later pairing is another, while one that lands after a move to another place under
// the same pairing still lands. One snapshot a session and a pairing, dropped at each change and when a view
// subscribes, so a view that mounts after a change it did not hear reads storage again.
import { useCallback, useSyncExternalStore } from 'react';
import type { SheetModel } from '@shared/sheet/model';
import type { SheetMemory } from '../../../../src/renderer/src/sheet';
import { readPairing } from '../credential';
import { madeElsewhere, onMemory, readMemory, sendingSince, updateMemory } from '../memory';

export interface SessionMemory {
  memory: SheetMemory;
  elsewhereSince: number | null; // since when a Send this window did not make has been held, while it is being sent
  // `known`: the questions the model the update was made against holds; an entry of any other question is not removed
  update(update: (current: SheetMemory) => SheetMemory, known?: (question: string) => boolean): void;
}

/** The questions a model holds in any form: open, hidden by a queued dismissal, or closed. */
export function questionsOf(model: SheetModel): (question: string) => boolean {
  const ids = new Set([...model.open.map((question) => question.id), ...model.hidden.map((entry) => entry.id), ...Object.keys(model.closed)]);
  return (question) => ids.has(question);
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
    update: (update: (current: SheetMemory) => SheetMemory, questions?: (question: string) => boolean) => {
      if (pairing === null || pairingNow() !== pairing) return; // the pairing it was made under has ended
      updateMemory(session, update, { known: questions });
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
