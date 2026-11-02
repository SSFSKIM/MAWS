// P5 O7 M5c (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Consent and the client port"; A15; Interfaces
// §O): the consent callback of a flow whose asker is a remote device. The consent opens in that device's browser and its
// redirect lands on the device's own loopback, where the device's app listens on the port it named in the act's
// `callback` and relays each request it receives as `connectors.callback {port, method, url}`. Here nothing binds: the
// receiver is a `ListenLoopback` that answers the device's port, and the flow's own handler (./oauth-flow.ts's, or the
// engine sign-in's, ./sign-in.ts) runs over the relayed request exactly as it runs over a local listener's.
//
// - A receiver is keyed by the asking `ClientRef` and the port: a port is unique on one device, not across the
//   machine's clients, and `connectors.callback` is dispatched under the asking channel's own ref, so a callback reaches
//   only a flow its own channel armed and two devices arming one port number never meet (routing, not `state`, is the
//   isolation: the shipped handler marks a flow settled before it rejects a wrong `state`).
// - `arm` is the reservation, decided and made in one synchronous step at the command: a `(client, port)` this client
//   already has armed is refused (null: the command answers `busy`), and nothing else changes.
// - Each arming has its own registration; `release` (and the listener's `close`, the flow's cleanup) removes that
//   registration alone, so a predecessor's end never removes a successor and a late callback never reaches one.
// - The asker's end releases the registration (no request can come for a dead ref) and, when no request was answered
//   2xx under it, calls the arming's `orphaned`, so the flow ends rather than waits out its deadline for a callback that
//   cannot arrive; a flow past its callback (the token exchange, the engine's submit) is left to finish.
// - A request for a `(client, port)` with no bound handler answers `{status: 404, body: ''}`; PKCE's verifier, the
//   state and the code stay in the flow, which only answers what it would have written to the browser.
import type { ClientRef } from '@shared/ipc/client';
import type { ConnectorCallbackAnswer, ConnectorCallbackRequest } from '@shared/ipc/schema/connectors';
import type { ListenLoopback, LoopbackReply, LoopbackRequest } from './oauth-callback';

// The local listener's own headers (./oauth-callback.ts), which the device's listener writes to the browser
const HEADERS: Readonly<Record<string, string>> = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' };
const UNREAD: LoopbackReply = { status: 500, body: 'MAWS could not read this request.' }; // the local listener's answer to a throw
export const NOT_ARMED: ConnectorCallbackAnswer = { status: 404, body: '' };

export interface RelayedReceiver {
  readonly port: number;
  // Binds nothing: the flow's handler, registered for this arming; rejects once the arming was released
  readonly listen: ListenLoopback;
  release(): void; // this arming's registration alone; idempotent
}

export interface RelayedCallbacks {
  // The reservation for one flow, or null when this client has `port` armed already (busy). `orphaned`: the asker ended
  // before any request under this arming was answered 2xx (called on a later turn, once).
  arm(client: ClientRef, port: number, orphaned?: () => void): RelayedReceiver | null;
  // `connectors.callback`'s answer for the asking client
  answer(client: ClientRef, request: ConnectorCallbackRequest): ConnectorCallbackAnswer;
  armed(): number; // registrations held
}

interface Registration {
  handle: ((request: LoopbackRequest) => LoopbackReply) | null;
  answered: boolean; // a request under it was answered 2xx: the flow is past its callback
  offGone(): void;
}

export function createRelayedCallbacks(): RelayedCallbacks {
  const registrations = new Map<string, Registration>(); // `${client id}\0${port}`
  const keyOf = (client: ClientRef, port: number) => `${client.id}\u0000${port}`;

  return {
    arm(client, port, orphaned) {
      const key = keyOf(client, port);
      if (registrations.has(key)) return null;
      const own: Registration = { handle: null, answered: false, offGone: () => {} };
      registrations.set(key, own);
      const release = () => {
        own.offGone();
        if (registrations.get(key) === own) registrations.delete(key);
      };
      // a ref already gone runs this at once, inside `arm`: the arming is released before the caller holds it
      own.offGone = client.onGone(() => {
        const current = registrations.get(key) === own;
        release();
        if (current && !own.answered && orphaned) queueMicrotask(orphaned);
      });
      return {
        port,
        release,
        listen: (handle) => {
          if (registrations.get(key) !== own) return Promise.reject(new Error('the relayed callback was released before the flow listened'));
          if (own.handle !== null) return Promise.reject(new Error('the relayed callback is listened on already'));
          own.handle = handle;
          return Promise.resolve({ port, close: async () => release() });
        },
      };
    },
    answer(client, { port, method, url }) {
      const own = registrations.get(keyOf(client, port));
      if (!own?.handle) return NOT_ARMED;
      let reply: LoopbackReply;
      try {
        reply = own.handle({ method, url });
      } catch {
        reply = UNREAD;
      }
      if (reply.status >= 200 && reply.status < 300) own.answered = true;
      return { status: reply.status, headers: { ...HEADERS }, body: reply.body };
    },
    armed: () => registrations.size,
  };
}
