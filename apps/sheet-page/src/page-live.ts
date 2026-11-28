// What the page's live connection tells the page's data (§P; T14, T15, T19): the callbacks App gives live.ts's `connect`,
// over the store and the chunk gate. At `paired` the store is not fresh until its `ready`'s read, and the lazy chunks may
// load; each snapshot and change feeds the store; the connection's state goes to the frame. `unavailable` holds the
// model unfresh until the read after the next snapshot (B3), so no card action reaches the door on a model from before
// the spine went away, and so does any other end of the connection (a loss, a refusal), the model staying on screen:
// a new socket's proof comes before its `paired`, and nothing kept from before passes in between. A revocation by the server the tab proved (4403 while paired, or 4401 after the proof matched)
// lets go of everything read under that pairing and of every read still out (B5); the stored memory stays, since a
// refusal deletes nothing (T19). An ordinary disconnect, or a refusal before any proof, keeps the store.
import type { DoorState } from '@shared/ipc/schema/sheet';
import type { SheetSummary } from '@shared/sheet/model';
import type { Connection, LiveDeps } from './live';
import type { SheetStore } from './store';

export interface PageLiveDeps {
  store: SheetStore;
  chunks: { opened(): void };
  paired(): void; // the frame shows
  state(state: Connection): void; // the band, and the pairing screen at `unpaired`
}

export function pageLive({ store, chunks, paired, state }: PageLiveDeps): Pick<LiveDeps, 'onPaired' | 'onReady' | 'onChanged' | 'onState' | 'onRevoked'> {
  return {
    onPaired: () => {
      paired();
      store.opened(); // not fresh until this connection's `ready` has been read (T14)
      chunks.opened();
    },
    onReady: (sessions: SheetSummary[], door: DoorState) => store.ready(sessions, door),
    onChanged: (session: string, summary: SheetSummary | null) => store.changed(session, summary),
    onState: (next: Connection) => {
      if (next !== 'connected') store.stale(); // any end of the connection, `unavailable` included: not fresh until the next snapshot's read
      state(next);
    },
    onRevoked: () => store.reset(),
  };
}
