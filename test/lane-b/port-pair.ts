// A MessageChannelMain in memory, for the suites that bridge a document port (P5 O7 M5b: main's document bridge,
// src/main/artifacts/remote-open.ts, posts one end to the window and drives the other): main's end is driven through `on`
// (MessagePortMain's), the page's through `addEventListener` (a DOM port's, the provider's PortLike).
import type { PortLike } from '@artifacts/provider/port';

type Listener = (event: { data?: unknown }) => void;

/**
 * One end of the channel. Delivery on a microtask, held until the receiving end starts; closing either end closes both
 * and says `close` on each.
 */
export class End implements PortLike {
  peer!: End;
  closed = false;
  #started = false;
  readonly #queued: unknown[] = [];
  readonly #listeners = { message: new Set<Listener>(), close: new Set<Listener>() };
  static pair(): [End, End] {
    const [a, b] = [new End(), new End()];
    a.peer = b;
    b.peer = a;
    return [a, b];
  }
  postMessage(data: unknown): void {
    if (this.closed) return;
    const copy = data instanceof Uint8Array ? data.slice() : data;
    queueMicrotask(() => this.peer.#deliver(copy));
  }
  start(): void {
    this.#started = true;
    for (const data of this.#queued.splice(0)) this.#deliver(data);
  }
  #deliver(data: unknown): void {
    if (this.closed) return;
    if (!this.#started) return void this.#queued.push(data);
    for (const listener of [...this.#listeners.message]) listener({ data });
  }
  on(type: 'message' | 'close', listener: Listener): this {
    this.#listeners[type].add(listener);
    return this;
  }
  addEventListener(type: 'message' | 'close', listener: Listener): void {
    this.#listeners[type].add(listener);
  }
  removeEventListener(type: 'message' | 'close', listener: Listener): void {
    this.#listeners[type].delete(listener);
  }
  close(): void {
    if (this.closed) return;
    for (const end of [this, this.peer]) end.closed = true;
    for (const end of [this, this.peer]) for (const listener of [...end.#listeners.close]) listener({});
  }
}
