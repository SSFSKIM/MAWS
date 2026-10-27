// An app page for main's handler tests (P5 O1 M2): Electron's WebContents as far as main's ClientRef follows it (an
// EventEmitter with an id that ends on `destroyed`, `render-process-gone` or a main-frame cross-document
// `did-start-navigation`), and the context the router builds for an invoke from it. `extra` adds what a handler reaches
// through `pageOf` (`send`, `postMessage`, …).
import { EventEmitter } from 'node:events';
import type { WebContents } from 'electron';
import type { HandlerContext } from '../../src/shared/ipc/client';
import { clientOf } from '../../src/main/ipc/clients';

export type FakePage<T extends object = object> = EventEmitter & T & {
  readonly id: number;
  destroyed: boolean;
  isDestroyed(): boolean;
  destroy(): void; // the window closes
  reload(): void; // a main-frame cross-document navigation
};

let nextId = 1_000;

export function fakePage<T extends object>(extra?: T): FakePage<T> {
  const page = Object.assign(new EventEmitter(), extra ?? {}, {
    id: nextId++,
    destroyed: false,
    isDestroyed: () => page.destroyed,
    destroy() {
      page.destroyed = true;
      page.emit('destroyed');
    },
    reload: () => void page.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false }),
  });
  return page as FakePage<T>;
}

// What the router hands a handler for an invoke from `page` now: its live page instance's ClientRef.
export const contextOf = (page: object): HandlerContext => ({ client: clientOf(page as WebContents) });
