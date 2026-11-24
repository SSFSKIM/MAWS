// The page's data (§P, "The page and the model"; T14, C3's S7): the summaries and the door's state from each snapshot
// and each change, and the model of the one session on screen, read over HTTP for it alone. At every snapshot that
// model is read again, since changes made while a tab was not connected are never replayed to it, and until that read
// has been applied the model is not `fresh`: Send cannot be pressed on a model older than the connection. A change of
// the session on screen reads it again. Each read carries a count that only grows, and an answer is applied only when
// no later read of that session has been. A read that failed is tried again after a while, while its session is still
// on screen and nothing newer was asked.
import type { DoorState } from '@shared/ipc/schema/sheet';
import type { SheetModel, SheetSummary } from '@shared/sheet/model';
import type { ReadAnswer } from './api';

export const READ_RETRY_MS = 5_000;

export interface StoreState {
  sessions: readonly SheetSummary[] | null; // null until the first snapshot
  door: DoorState | null;
  // the session on screen: its model (undefined until a read is applied; null where the service holds no record), and
  // whether a read started after the last snapshot has been applied
  shown: { session: string; model: SheetModel | null | undefined; fresh: boolean } | null;
}

export interface SheetStore {
  state(): StoreState;
  subscribe(listener: () => void): () => void;
  ready(sessions: SheetSummary[], door: DoorState): void;
  changed(session: string, summary: SheetSummary | null): void;
  show(session: string | null): void;
}

export function createStore(deps: { read(session: string): Promise<ReadAnswer> }): SheetStore {
  let state: StoreState = { sessions: null, door: null, shown: null };
  const listeners = new Set<() => void>();
  let snapshot = 0; // which snapshot the page is at
  let asked = 0; // the count of the last read started
  let applied = 0; // the count of the last read applied
  let retry: ReturnType<typeof setTimeout> | null = null;

  const set = (next: Partial<StoreState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  function read(session: string): void {
    if (retry !== null) clearTimeout(retry);
    retry = null;
    const count = (asked += 1);
    const at = snapshot;
    void deps.read(session).then((answer) => {
      const shown = state.shown;
      if (shown === null || shown.session !== session || count < applied) return;
      if (!answer.ok) {
        if (count === asked) retry = setTimeout(() => state.shown?.session === session && count === asked && read(session), READ_RETRY_MS);
        return;
      }
      applied = count;
      set({ door: answer.door, shown: { session, model: answer.model, fresh: shown.fresh || at === snapshot } });
    });
  }

  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    ready(sessions, door) {
      snapshot += 1;
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
    show(session) {
      if ((state.shown?.session ?? null) === session) return;
      applied = asked; // reads of another session are not this one's
      set({ shown: session === null ? null : { session, model: undefined, fresh: false } });
      if (session !== null) read(session);
    },
  };
}
