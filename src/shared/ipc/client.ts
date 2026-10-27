// Who asked (P5 O1 M2). A handler learns its asker through a `ClientRef`: a small value that names the asking client and
// says when it is gone. In main the client is an app page instance (`src/main/ipc/clients.ts`); in a daemon it will be a
// connection's page. Per-client state is keyed by `id` and released on `onGone`. Zod-free and Electron-free, so the same
// handler code runs in either root.
export type ClientId = string & { readonly __brand: 'ClientId' };

export interface ClientRef {
  readonly id: ClientId;
  // Runs `listener` once when the client ends, or at once if it already has; returns the unsubscribe.
  onGone(listener: () => void): () => void;
}

export interface HandlerContext {
  readonly client: ClientRef;
}

// A ClientRef its owner ends (P5 O1 M5): main's page instances (src/main/ipc/clients.ts) and a host's remote clients
// (src/shared/host/client-refs.ts) alike. `end` runs every listener once, each isolated from the others' failures; a
// listener added after the end runs at once.
export interface EndableClientRef extends ClientRef {
  end(): void;
}

export function endableClientRef(id: string): EndableClientRef {
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
          console.error(`[client] a gone listener of ${id} failed`, error); // the others still release
        }
      }
    },
  };
}
