// The page's data (§P, "The page and the model"; T14, C3's S7): the summaries and the door's state from each snapshot
// and each change, and the model of the one session on screen, read over HTTP for it alone. At every snapshot that
// model is read again, since changes made while a tab was not connected are never replayed to it, and until that read
// has been applied the model is not `fresh`: Send cannot be pressed on a model older than the connection. A connection
// is not fresh from its `paired` (`opened`) on: a read started before its `ready` (a change heard meanwhile) is applied
// but does not make it fresh, since only the snapshot's read follows everything the tab missed. A change of
// the session on screen reads it again. Each read carries a count that only grows, and an answer is applied only when
// no later read of that session has been. A read that failed is tried again after a while, while its session is still
// on screen and nothing newer was asked. A write of another tab this tab adopted reads the session again, and until a
// read started after it is applied the model is not `settled`: the tab shows its reconcile against it but writes none
// of it (§P, "What a tab writes of `reconcile`"). The store hears the shown session's memory itself, from the moment it
// is shown and its first read starts, so a write another tab makes while that read is out unsettles it even though no
// view was mounted yet to hear the write. A pairing that ends or changes resets it (`reset`): nothing of the old
// pairing's summaries, door or model stays, no read of it still out is applied, and the place on screen is read again
// by the next pairing's snapshot. Reconnects of one pairing keep it. Each read takes the stored memory as it is when
// the read starts (`baseline`), and the model applied carries it: reconcile's removals are judged against what storage
// held when the model was asked for, not what it holds when the model lands, so another tab's write whose notification
// comes after the answer is never taken for part of the model's past. A connection that says `unavailable` holds the
// model unfresh (`stale`) until a read started after its next snapshot is applied.
import type { DoorState } from '@shared/ipc/schema/sheet';
import type { SheetModel, SheetSummary } from '@shared/sheet/model';
import type { SheetMemory } from '../../../src/renderer/src/sheet';
import type { ReadAnswer } from './api';

export const READ_RETRY_MS = 5_000;

export interface StoreState {
  sessions: readonly SheetSummary[] | null; // null until the first snapshot
  door: DoorState | null;
  // the session on screen: its model (undefined until a read is applied; null where the service holds no record),
  // whether a read started after the last snapshot has been applied, and whether one started after the last write of
  // another tab this tab adopted has been (`settled`: the tab's reconcile against it may be written, §P)
  // `baseline`: the session's stored memory when the applied read started (null before one is applied, or without the dep)
  shown: { session: string; model: SheetModel | null | undefined; fresh: boolean; settled: boolean; baseline?: SheetMemory | null } | null;
}

export interface SheetStore {
  state(): StoreState;
  subscribe(listener: () => void): () => void;
  opened(): void; // a connection reached `paired`; its `ready` is to come
  ready(sessions: SheetSummary[], door: DoorState): void;
  changed(session: string, summary: SheetSummary | null): void;
  show(session: string | null): void;
  adopted(session: string): void; // this tab adopted another tab's write of the session's memory
  reset(): void; // the pairing ended or changed
  stale(): void; // the connection said `unavailable`: not fresh until the read after its next snapshot
}

export interface StoreDeps {
  read(session: string): Promise<ReadAnswer>;
  baseline?(session: string): SheetMemory; // the session's stored memory now (memory.ts's readMemory)
  // a session's memory written, in this tab or (`adopted`) in another (memory.ts's onMemory)
  onMemory?(session: string, listener: (adopted: boolean) => void): () => void;
}

export function createStore(deps: StoreDeps): SheetStore {
  let state: StoreState = { sessions: null, door: null, shown: null };
  const listeners = new Set<() => void>();
  let snapshot = 0; // which snapshot the page is at
  let awaitingReady = false; // between a connection's `paired` and its `ready`
  let asked = 0; // the count of the last read started
  let applied = 0; // the count of the last read applied
  let retry: ReturnType<typeof setTimeout> | null = null;
  let adoptedAt = 0; // the count of the last read started before the last adoption
  const out = new Map<string, number>(); // each session's reads not yet answered
  let unwatch: (() => void) | null = null; // the shown session's memory, heard from its show on
  let pairing = 0; // moved on by each reset: a read started under an earlier pairing is applied nowhere
  // the session an adoption came for while a read of it was out: one more read of it once they are in
  let readAgain: string | null = null;

  const set = (next: Partial<StoreState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  function read(session: string): void {
    if (retry !== null) clearTimeout(retry);
    retry = null;
    const count = (asked += 1);
    const at = awaitingReady ? null : snapshot;
    const under = pairing;
    const baseline = deps.baseline?.(session) ?? null; // before the read leaves
    out.set(session, (out.get(session) ?? 0) + 1);
    void deps.read(session).then((answer) => {
      if (under !== pairing) return; // the pairing it was read under has ended
      out.set(session, out.get(session)! - 1);
      if (readAgain === session && out.get(session) === 0 && state.shown?.session === session) {
        readAgain = null;
        read(session);
      }
      const shown = state.shown;
      if (shown === null || shown.session !== session || count < applied) return;
      if (!answer.ok) {
        if (count === asked) retry = setTimeout(() => state.shown?.session === session && count === asked && read(session), READ_RETRY_MS);
        return;
      }
      applied = count;
      set({ door: answer.door, shown: { session, model: answer.model, fresh: shown.fresh || at === snapshot, settled: shown.settled || count > adoptedAt, baseline } });
    });
  }

  // Not fresh until a read started after the next `ready` is applied (a connection's `paired`, or its `unavailable`)
  function unfresh(): void {
    snapshot += 1;
    awaitingReady = true;
    if (state.shown?.fresh) set({ shown: { ...state.shown, fresh: false } });
  }

  function adopted(session: string): void {
    if (state.shown?.session !== session) return;
    adoptedAt = asked;
    if (state.shown.settled) set({ shown: { ...state.shown, settled: false } });
    if ((out.get(session) ?? 0) === 0) read(session);
    else readAgain = session;
  }

  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    opened: unfresh,
    stale: unfresh,
    ready(sessions, door) {
      snapshot += 1;
      awaitingReady = false;
      set({ sessions, door, shown: state.shown && { ...state.shown, fresh: false } });
      if (state.shown) read(state.shown.session);
    },
    changed(session, summary) {
      if (state.sessions !== null) {
        const rest = state.sessions.filter((entry) => entry.session !== session);
        const at = state.sessions.findIndex((entry) => entry.session === session);
        const sessions = summary === null ? rest : at < 0 ? [...rest, summary] : state.sessions.map((entry) => (entry.session === session ? summary : entry));
        set({ sessions });
      }
      if (state.shown?.session === session) read(session);
    },
    adopted,
    reset() {
      pairing += 1;
      if (retry !== null) clearTimeout(retry);
      retry = null;
      out.clear();
      readAgain = null;
      awaitingReady = false;
      applied = adoptedAt = asked;
      const shown = state.shown && { session: state.shown.session, model: undefined, fresh: false, settled: false };
      set({ sessions: null, door: null, shown });
    },
    show(session) {
      if ((state.shown?.session ?? null) === session) return;
      readAgain = null; // what was queued is another session's, and this one's read starts now
      applied = asked; // reads of another session are not this one's
      unwatch?.();
      unwatch = null;
      set({ shown: session === null ? null : { session, model: undefined, fresh: false, settled: false } });
      if (session === null) return;
      unwatch = deps.onMemory?.(session, (fromAnother) => fromAnother && adopted(session)) ?? null; // before its read starts
      read(session);
    },
  };
}
