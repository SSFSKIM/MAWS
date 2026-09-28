// Getting a notification click to the page (C5 execution document, X2 `attention.*`, M5 fix wave). A click that has to
// create or reload the window cannot be emitted on `did-finish-load`: React subscribes later, and the event would be
// lost. So the relay emits `attention.navigate` only to a page that has announced itself, and otherwise keeps the
// latest navigation for the page to pull through `attention.pendingNavigate`, C1's subscribe-then-snapshot rule: the
// page subscribes to the event, then calls the command, and that call is its announcement. A reload or a new window
// starts un-announced (`pageGone`).
import type { AttentionNavigate } from '@shared/ipc/schema/attention';
import type { emit as emitEvent } from '../ipc/events';

export interface NavigationRelay {
  deliver(navigation: AttentionNavigate): void; // emit to a listening page, or queue (the latest only)
  take(): AttentionNavigate | null; // answers attention.pendingNavigate: marks the page announced, returns and clears the queue
  pageGone(): void; // the page is reloading or its window closed: queue from now on until it asks again
}

export function createNavigationRelay(emit: typeof emitEvent): NavigationRelay {
  let announced = false;
  let pending: AttentionNavigate | null = null;
  return {
    deliver(navigation) {
      if (announced) emit('attention.navigate', navigation);
      else pending = navigation;
    },
    take() {
      announced = true;
      const navigation = pending;
      pending = null;
      return navigation;
    },
    pageGone() {
      announced = false;
    },
  };
}
