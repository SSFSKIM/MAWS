// A client carried across a host link (P5 O1 M5). A `machine` handler is handed a `ClientRef` in a host runtime as it is
// in main, so its per-client state is keyed and released the same way in either root. Two halves:
//
// - the receiving side (`RemoteClients`, the host runtime's): one remote ref per (served connection, client id), with id
//   `<connection>/<client id>`, ended by the sender's `clientGone` or, every ref at once, by the connection's end; plus
//   the connection's own ref, id `<connection>`, for a request that names no client, which ends with the connection.
//   An ended client stays ended for the connection's life: a later request naming it gets a gone ref, as main's own
//   ended page instance never comes back;
// - the sending side (`ClientGoneRelay`, main's host supervisor's, one per link): the first time a client a request
//   carried on that link ends, it posts `{ t: 'clientGone', client }`, once per client for the link's life; closing the
//   relay with its link drops every subscription, since the receiving side ends that link's refs by itself.
//
// Both sides remember an ended client as its id string alone, never the ref or its listeners: one short string per ended
// client per link, kept until the link (connection) is torn down. That growth is accepted (the O1 architect's ruling):
// it is what makes an ended identity permanent on both ends.
//
// Zod-free and Electron-free: mawsd (O3) runs the receiving side behind its own sockets.
import { endableClientRef, type ClientRef, type EndableClientRef } from '../ipc/client';
import type { HostMessage } from '../ipc/host-protocol';

// The refs of one served connection.
export interface RemoteClients {
  // The ref for a request on this connection: the named client's, minted on first sight (gone already when that client,
  // or the connection, has ended), or the connection's own.
  refFor(client: string | undefined): ClientRef;
  gone(client: string): void; // the sender's clientGone; an id this connection holds no live ref for is ignored
  end(): void; // the connection ended: every ref it minted, and its own, end now; later refs are gone from the start
}

export function remoteClients(connection: number): RemoteClients {
  const own = endableClientRef(String(connection));
  const live = new Map<string, EndableClientRef>();
  const ended = new Set<string>(); // the ids of clients that ended on this connection (see the header on its growth)
  let over = false;
  const goneRef = (client: string) => {
    const ref = endableClientRef(`${connection}/${client}`);
    ref.end();
    return ref;
  };
  return {
    refFor(client) {
      if (client === undefined) return own;
      if (over || ended.has(client)) return goneRef(client);
      let ref = live.get(client);
      if (!ref) live.set(client, (ref = endableClientRef(`${connection}/${client}`)));
      return ref;
    },
    gone(client) {
      const ref = live.get(client);
      if (!ref) return;
      live.delete(client);
      ended.add(client);
      ref.end();
    },
    end() {
      if (over) return;
      over = true;
      const ending = [...live.values(), own];
      live.clear();
      ended.clear(); // `over` answers for every id from here
      for (const ref of ending) ref.end();
    },
  };
}

// The sending side, one per link: `carry` each client a request sent on the link names.
export interface ClientGoneRelay {
  carry(client: ClientRef): void;
  close(): void; // the link closed: no clientGone is posted for it from here on
}

export function clientGoneRelay(post: (message: Extract<HostMessage, { t: 'clientGone' }>) => void): ClientGoneRelay {
  let subscriptions: Map<string, () => void> | null = new Map();
  const notified = new Set<string>(); // the clients this link has posted clientGone for (see the header on its growth)
  return {
    carry(client) {
      if (!subscriptions || subscriptions.has(client.id) || notified.has(client.id)) return;
      const open = subscriptions;
      open.set(client.id, () => {}); // set first: a client already gone runs its listener inside onGone, below
      const unsubscribe = client.onGone(() => {
        if (subscriptions !== open || !open.delete(client.id)) return;
        notified.add(client.id);
        post({ t: 'clientGone', client: client.id });
      });
      if (open.has(client.id)) open.set(client.id, unsubscribe);
    },
    close() {
      const closing = subscriptions;
      subscriptions = null;
      notified.clear();
      for (const unsubscribe of closing?.values() ?? []) unsubscribe();
    },
  };
}
