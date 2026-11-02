// Getting a notification click to the page (C5 execution document, X2 `attention.*`, M5 fix wave). A click that has to
// create or reload the window cannot be emitted on `did-finish-load`: React subscribes later, and the event would be
// lost. So the relay emits `attention.navigate` only to a page that has announced itself, and otherwise keeps the
// latest navigation for the page to pull through `attention.pendingNavigate`, C1's subscribe-then-snapshot rule: the
// page subscribes to the event, then calls the command, and that call is its announcement. A reload or a new window
// starts un-announced (`pageGone`).
// P5 O7 M6: a click on another machine's item (`machine`) is that machine's navigation, emitted from it (`emitFrom`) so the
// page lifts its ids to that machine's addresses and opens the session there; one queued for a page is told it as that
// event when it announces itself (the command's answer is this Mac's, whose ids it would lift), and the answer is null.
import type { AttentionNavigate } from '@shared/ipc/schema/attention';
import type { EventPayload } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import type { emit as emitEvent, emitFrom as emitEventFrom } from '../ipc/events';

export interface NavigationRelay {
  deliver(navigation: AttentionNavigate, machine?: MachineRef): void; // emit to a listening page, or queue (the latest only); `machine`: another machine's
  failure(notified: EventPayload<'attention.notified'>): void; // keep every failed action until the page can recover it
  take(): AttentionNavigate | null; // answers attention.pendingNavigate: marks the page announced, returns and clears the queue
  pageGone(): void; // the page is reloading or its window closed: queue from now on until it asks again
}

export function createNavigationRelay(emit: typeof emitEvent, emitFrom?: typeof emitEventFrom): NavigationRelay {
  let announced = false;
  let pending: { navigation: AttentionNavigate; machine?: MachineRef } | null = null;
  const failures: EventPayload<'attention.notified'>[] = [];
  const send = (navigation: AttentionNavigate, machine?: MachineRef) => (machine === undefined ? emit('attention.navigate', navigation) : emitFrom?.(machine, 'attention.navigate', navigation));
  return {
    deliver(navigation, machine) {
      if (announced) send(navigation, machine);
      else pending = { navigation, ...(machine !== undefined && { machine }) };
    },
    failure(notified) {
      if (announced) emit('attention.notified', notified);
      else failures.push(notified);
    },
    take() {
      announced = true;
      // connectAttention subscribes to notified before announcing this page, too.
      for (const failure of failures.splice(0)) emit('attention.notified', failure);
      const held = pending;
      pending = null;
      if (held?.machine === undefined) return held?.navigation ?? null;
      send(held.navigation, held.machine); // the page subscribed before it asked: it hears this
      return null;
    },
    pageGone() {
      announced = false;
    },
  };
}
