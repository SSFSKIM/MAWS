// The client port's far end in main on the daemon shape (P5 O3-D M5b; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md,
// Interfaces §E; D15, D44(1); OX4): a service in `mawsd` asks this app for an effect only a client can perform with a
// `clientPort.request` event; main performs it through its Electron port (./electron-port.ts), for the page instance the
// request names (`client`, the id main's `machine` transport sent with the asking request) or app-level for none, and
// answers with `clientPort.answer`.
//
// Every request that awaits an answer gets one: a dialog that throws answers `noClient` (logged), and a request naming a
// page that has ended answers `noClient` with no dialog, as `mawsd` would at that page's end. A notification's events
// are answers of its id until it closes or fails; one that cannot show answers `failed`; `notifyClose` closes it, after
// which nothing more of it is answered. The badge and focus await no answer.
import { isNoClient, NO_CLIENT, NO_CLIENT_REASON, type ClientPort, type NotificationHandle, type NotifyEvent } from '@shared/client/port';
import type { HostSupervisor } from '@shared/host/host-supervisor';
import type { ClientRef } from '@shared/ipc/client';
import type { EventPayload } from '@shared/ipc/schema';

export interface PortAnswersOptions {
  hosts: Pick<HostSupervisor, 'onEvent' | 'dispatch'>;
  port: ClientPort; // main's own (electronClientPort)
  clientOfId(id: string): ClientRef | null; // the live page instance an id names (../ipc/clients.ts)
  log(line: string): void;
}

type Request = EventPayload<'clientPort.request'>;
const AWAITED = ['pick', 'save', 'confirm', 'reveal', 'openExternal'] as const;
type Awaited = (typeof AWAITED)[number];
const isAwaited = (kind: Request['kind']): kind is Awaited => (AWAITED as readonly string[]).includes(kind);

export function startPortAnswers({ hosts, port, clientOfId, log }: PortAnswersOptions): () => void {
  const notifications = new Map<string, NotificationHandle>();
  const answer = (id: string, value: unknown) =>
    void hosts.dispatch('machine', 'clientPort.answer', { id, answer: value }).then(
      (result) => !result.ok && log(`[client-port] the answer to ${id} was refused: ${result.error.code} ${result.error.message}`),
      (error: unknown) => log(`[client-port] the answer to ${id} could not be sent: ${messageOf(error)}`),
    );

  async function perform({ id, client, kind, request }: Request): Promise<void> {
    // the page the request names, if it still lives; null for the app itself
    const ref = client === null ? null : clientOfId(client);
    const gone = client !== null && ref === null;
    if (isAwaited(kind)) {
      if (gone) return answer(id, NO_CLIENT);
      try {
        answer(id, await askPort(kind, ref, request));
      } catch (error) {
        log(`[client-port] ${kind} ${id} failed: ${messageOf(error)}; answered noClient`);
        answer(id, NO_CLIENT);
      }
      return;
    }
    switch (kind) {
      case 'notify':
        return notify(id, gone ? null : ref, request, gone);
      case 'notifyClose': {
        const closing = (request as { id?: unknown } | null)?.id;
        const handle = typeof closing === 'string' ? notifications.get(closing) : undefined;
        if (typeof closing === 'string') notifications.delete(closing);
        return handle?.close();
      }
      case 'badge':
        return void port.badge(ref, Number((request as { count?: unknown } | null)?.count ?? 0));
      case 'focus':
        return void port.focus(ref, (request as { mode?: 'bring' | 'request' } | null)?.mode === 'request' ? 'request' : 'bring');
    }
  }

  function askPort(kind: Awaited, ref: ClientRef | null, request: unknown): Promise<unknown> {
    switch (kind) {
      case 'pick':
        return port.pick(ref, request as never);
      case 'save':
        return port.save(ref, request as never);
      case 'confirm':
        return port.confirm(ref, request as never);
      case 'reveal':
        return port.reveal(ref, String((request as { path?: unknown } | null)?.path ?? ''));
      case 'openExternal':
        return port.openExternal(ref, request as never);
    }
  }

  function notify(id: string, ref: ClientRef | null, request: unknown, gone: boolean): void {
    if (gone) return answer(id, { kind: 'failed', error: NO_CLIENT_REASON } satisfies NotifyEvent);
    let open = true; // until it closed or failed, or its asker closed it
    const relay = (event: NotifyEvent) => {
      if (!open) return;
      if (event.kind === 'closed' || event.kind === 'failed') {
        open = false;
        notifications.delete(id);
      }
      answer(id, event);
    };
    try {
      const shown = port.notify(ref, request as never, relay);
      if (isNoClient(shown)) return answer(id, { kind: 'failed', error: NO_CLIENT_REASON } satisfies NotifyEvent);
      if ('unsupported' in shown) return answer(id, { kind: 'failed', error: shown.unsupported } satisfies NotifyEvent);
      if (open)
        notifications.set(id, {
          close: () => {
            open = false;
            shown.close();
          },
        });
    } catch (error) {
      log(`[client-port] notify ${id} failed: ${messageOf(error)}`);
      answer(id, { kind: 'failed', error: messageOf(error) } satisfies NotifyEvent);
    }
  }

  const off = hosts.onEvent('clientPort.request', (request) => {
    void perform(request).catch((error: unknown) => log(`[client-port] ${request.kind} ${request.id} failed: ${messageOf(error)}`));
  });
  return () => {
    off();
    for (const handle of notifications.values()) handle.close();
    notifications.clear();
  };
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
