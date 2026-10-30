// The client port over the services front (P5 O3-D M4; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces
// §E; OX4, O3X6, D15): the `ClientPort` a service in `mawsd` asks for an effect only a client can perform. It posts the
// request as a `clientPort.request` event to the machine.sock connection whose request minted the asking `ClientRef`
// (its `client` the asker's own id on that connection, null for the connection's own ref), or, for `null`, to the app
// (the connection whose hello's appPid is the app attached on engine-host.sock), and takes the answer back through
// `clientPort.answer` from that same connection; a notification's events are further answers of its id.
//
// Nothing waits on a client that cannot answer (OX4: `noClient`, never a hang): with no connection to ask (a ref the
// endpoint minted for a remote device, until O7 M5 carries the port across the channel; no app attached) or an asking
// ref that has ended (its page, though its connection lives), the answer is `noClient` at once and nothing is posted; an
// asker that ends (its page, or its connection) settles what it was asked `noClient` and releases the notifications it
// shows. The interactive kinds (`pick`, `save`, `confirm`) wait for the person while their asker lives (D43(1)): its end
// is what ends the wait, as a dead client always shows. `reveal` and `openExternal` involve no person and settle
// `noClient` at the deadline, so a connection that never answers them (a CLI, a test client, an app of a build that
// reads no port) hangs nothing. `badge` and `focus` return at once; `notify` returns its handle at once, and its events
// follow as answers until it closes or fails. A pending request holds nothing but its own entry: no lock, ledger slot or
// queue, so an open dialog never stalls another request (D44(1)).
import { HostCommandError } from '@shared/host/runtime';
import type { ClientRef } from '@shared/ipc/client';
import { ipcError } from '@shared/ipc/errors';
import type { CLIENT_PORT_KINDS } from '@shared/ipc/schema/client-port';
import { NO_CLIENT, type ClientPort, type NoClient, type NotifyEvent } from '@shared/client/port';

/** How long `reveal` and `openExternal` wait for their answer (§E; the interactive kinds wait while their asker lives). */
export const CLIENT_PORT_DEADLINE_MS = 10_000;

type Kind = (typeof CLIENT_PORT_KINDS)[number];
const TIMED: ReadonlySet<Kind> = new Set(['reveal', 'openExternal']);
export type ClientPortRequest = { id: string; client: string | null; kind: Kind; request: unknown };

/** A connection the port can ask: false when the request could not be posted (the connection is gone). */
export interface PortTarget {
  post(request: ClientPortRequest): boolean;
}

export interface FrontClientPort extends ClientPort {
  /** `clientPort.answer` from `from`: refused for an id it was never asked (unknown, settled, or another's). */
  answer(from: PortTarget, input: { id: string; answer: unknown }): void;
  /** The connection ended: every request it was asked settles `noClient`, every notification it shows ends. */
  gone(target: PortTarget): void;
  /** Every outstanding request settles `noClient` (the front closes). */
  close(): void;
  /** The app may have become reachable (its machine.sock or engine-host.sock connection was welcomed): it is told the app
   * badge's current count once, if a count was set and this app was not told it. */
  appArrived(): void;
}

export interface ClientPortOptions {
  /** Where `client`'s requests go, and its id there; null when no connection can be asked. */
  route(client: ClientRef | null): { target: PortTarget; client: string | null } | null;
  deadlineMs?: number;
  log(line: string): void;
}

type Pending = { target: PortTarget; kind: Kind; settle(answer: unknown): void; event?(event: NotifyEvent): void };

export function createClientPort(options: ClientPortOptions): FrontClientPort {
  const pending = new Map<string, Pending>();
  let next = 0;
  const deadlineMs = options.deadlineMs ?? CLIENT_PORT_DEADLINE_MS;

  // Where `client`'s effect goes; null with no connection to ask, or an asking ref that has ended.
  function routeOf(client: ClientRef | null): { target: PortTarget; client: string | null } | null {
    return client !== null && ended(client) ? null : options.route(client);
  }

  // A request that awaits its answer: noClient at the asker's end, a post that could not go, or a timed kind's deadline.
  function ask<A>(kind: Kind, client: ClientRef | null, request: unknown): Promise<A | NoClient> {
    const to = routeOf(client);
    if (to === null) return Promise.resolve(NO_CLIENT);
    return new Promise((resolve) => {
      const id = `cp-${++next}`;
      let settled = false;
      let unsubscribe = () => {};
      const settle = (answer: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        pending.delete(id);
        resolve(answer as A | NoClient);
      };
      const timer = TIMED.has(kind)
        ? setTimeout(() => {
            options.log(`machine.sock: the client port's ${kind} ${id} had no answer within ${deadlineMs} ms; answered noClient`);
            settle(NO_CLIENT);
          }, deadlineMs)
        : undefined;
      timer?.unref?.();
      pending.set(id, { target: to.target, kind, settle });
      const off = client?.onGone(() => settle(NO_CLIENT)); // runs at once for a client already gone
      if (off !== undefined) {
        if (settled) off();
        else unsubscribe = off;
      }
      if (!settled && !to.target.post({ id, client: to.client, kind, request })) settle(NO_CLIENT);
    });
  }

  // The app's dock badge is a level (M5b fix round 2): the spine's notifier sets it when its count changes, which may be
  // before any app is reachable (the spine loads at the app's first machine.sock request, before its engine-host.sock
  // attach) or for an app since replaced, so the count is kept and told to each app as it arrives.
  let appBadge: number | null = null;
  let appBadgeTold: PortTarget | null = null;
  function tellAppBadge(): void | NoClient {
    const to = options.route(null);
    appBadgeTold = to !== null && to.target.post({ id: `cp-${++next}`, client: to.client, kind: 'badge', request: { count: appBadge } }) ? to.target : null;
    if (appBadgeTold === null) return NO_CLIENT;
  }

  // An effect asked with no answer awaited: whether a connection could be asked.
  function tell(kind: Kind, client: ClientRef | null, request: unknown): void | NoClient {
    const to = routeOf(client);
    if (to === null || !to.target.post({ id: `cp-${++next}`, client: to.client, kind, request })) return NO_CLIENT;
  }

  return {
    pick: (client, request) => ask('pick', client, request),
    save: (client, request) => ask('save', client, request),
    confirm: (client, request) => ask('confirm', client, request),
    reveal: (client, path) => ask('reveal', client, { path }),
    openExternal: (client, target) => ask('openExternal', client, target),
    badge(client, count) {
      if (client !== null) return tell('badge', client, { count });
      appBadge = count;
      return tellAppBadge();
    },
    appArrived() {
      if (appBadge !== null && options.route(null)?.target !== appBadgeTold) void tellAppBadge();
    },
    focus: (client, mode) => tell('focus', client, { mode }),
    notify(client, request, onEvent) {
      const to = routeOf(client);
      if (to === null) return NO_CLIENT;
      const id = `cp-${++next}`;
      let unsubscribe = () => {};
      const end = () => {
        unsubscribe();
        pending.delete(id);
      };
      pending.set(id, { target: to.target, kind: 'notify', settle: end, event: onEvent });
      unsubscribe = client?.onGone(end) ?? unsubscribe; // the page that shows it ended: released, nothing more posted
      if (!to.target.post({ id, client: to.client, kind: 'notify', request })) {
        end();
        return NO_CLIENT;
      }
      return {
        close() {
          if (!pending.has(id)) return;
          end();
          to.target.post({ id: `cp-${++next}`, client: to.client, kind: 'notifyClose', request: { id } });
        },
      };
    },
    answer(from, { id, answer }) {
      const entry = pending.get(id);
      if (entry === undefined || entry.target !== from) throw new HostCommandError(ipcError('invalid_input', `no client port request ${id} is outstanding for this client`));
      if (entry.event === undefined) return entry.settle(typeof answer === 'object' && answer !== null ? answer : NO_CLIENT);
      const event = answer as NotifyEvent;
      if (event?.kind === 'closed' || event?.kind === 'failed') entry.settle(undefined);
      try {
        entry.event(event);
      } catch (error) {
        options.log(`machine.sock: a notification's listener failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    gone(target) {
      for (const entry of [...pending.values()]) if (entry.target === target) entry.settle(NO_CLIENT);
    },
    close() {
      for (const entry of [...pending.values()]) entry.settle(NO_CLIENT);
    },
  };
}

/** Whether `ref` has ended: its `onGone` runs a listener at once then. */
function ended(ref: ClientRef): boolean {
  let gone = false;
  ref.onGone(() => (gone = true))();
  return gone;
}
