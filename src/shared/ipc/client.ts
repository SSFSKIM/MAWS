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
