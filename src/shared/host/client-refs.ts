// A client carried across a host link (P5 O1 M5). A `machine` handler is handed a `ClientRef` in a host runtime as it is
// in main, so its per-client state is keyed and released the same way in either root. Two halves:
//
// - the receiving side (`RemoteClients`, the host runtime's): one remote ref per (served connection, client id), with id
//   `<connection>/<client id>`, ended by the sender's `clientGone` or, every ref at once, by the connection's end; plus
//   the connection's own ref, id `<connection>`, for a request that names no client, which ends with the connection;
// - the sending side (`ClientGoneRelay`, main's host supervisor's, one per link): the first time a client a request
//   carried on that link ends, it posts `{ t: 'clientGone', client }` once; closing the relay with its link drops every
//   subscription, since the receiving side ends that link's refs by itself.
//
// Zod-free and Electron-free: mawsd (O3) runs the receiving side behind its own sockets.
import type { ClientId, ClientRef } from '../ipc/client';
import type { HostMessage } from '../ipc/host-protocol';

interface EndableRef extends ClientRef {
  end(): void;
}

// A ref whose `onGone` listeners run once, at `end`; a listener added after the end runs at once.
function endableRef(id: string): EndableRef {
  let listeners: Set<() => void> | null = new Set();
  return {
    id: id as ClientId,
    onGone(listener) {
      if (!listeners) {
        listener();
        return () => {};
      }
      const entry = () => listener(); // its own identity, so one function added twice unsubscribes each
      listeners.add(entry);
      return () => void listeners?.delete(entry);
    },
    end() {
      if (!listeners) return;
      const ending = [...listeners];
      listeners = null;
      for (const listener of ending) {
        try {
          listener();
        } catch (error) {
          console.error(`[host] a gone listener of ${id} failed`, error); // the others still release
        }
      }
    },
  };
}

// The refs of one served connection.
export interface RemoteClients {
  // The ref for a request on this connection: the named client's, minted on first sight, or the connection's own.
  refFor(client: string | undefined): ClientRef;
  gone(client: string): void; // the sender's clientGone; an id this connection holds no ref for is ignored
  end(): void; // the connection ended: every ref it minted, and its own, end now; later refs are gone from the start
}

export function remoteClients(connection: number): RemoteClients {
  const own = endableRef(String(connection));
  const refs = new Map<string, EndableRef>();
  let ended = false;
  return {
    refFor(client) {
      if (client === undefined) return own;
      let ref = refs.get(client);
      if (!ref) {
        ref = endableRef(`${connection}/${client}`);
        if (ended) ref.end();
        else refs.set(client, ref);
      }
      return ref;
    },
    gone(client) {
      const ref = refs.get(client);
      if (!ref) return;
      refs.delete(client); // a later request naming the same id gets a fresh ref
      ref.end();
    },
    end() {
      if (ended) return;
      ended = true;
      const ending = [...refs.values(), own];
      refs.clear();
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
  return {
    carry(client) {
      if (!subscriptions || subscriptions.has(client.id)) return;
      const live = subscriptions;
      live.set(client.id, () => {}); // set first: a client already gone runs its listener inside onGone, below
      const unsubscribe = client.onGone(() => {
        if (subscriptions !== live || !live.delete(client.id)) return;
        post({ t: 'clientGone', client: client.id });
      });
      if (live.has(client.id)) live.set(client.id, unsubscribe);
    },
    close() {
      const closing = subscriptions;
      subscriptions = null;
      for (const unsubscribe of closing?.values() ?? []) unsubscribe();
    },
  };
}
