// A channel for the cards client's unit suites (P5 O13 M4): what the client sends is kept in `sent`, in order, and
// handed to `respond`, which answers as an endpoint would through `deliver`. It stands in for a sealed RL2 channel;
// the real one, its handshake and its endpoint are the local-hub suites'.
import type { CapsMessage, ChannelMessage } from 'org-protocol';
import type { MachineChannel } from '../src/cards/client';

export class FakeChannel implements MachineChannel {
  readonly id = 'fake-channel';
  readonly peer = { protocol: { major: 1, minor: 0 }, build: 'fake', capabilities: [], stateVersion: 1 };
  readonly sent: ChannelMessage[] = [];
  closed = false;
  caps: CapsMessage | null = null;
  /** Called with each message the client sends, after it is kept. */
  respond: ((message: ChannelMessage) => void) | null = null;
  readonly #listeners = new Set<(message: ChannelMessage) => void>();
  readonly #closes = new Set<(reason: string) => void>();

  constructor(readonly machine = 'AAAAAAAAAAAAAAAAAAAAAA') {}

  send(message: ChannelMessage): Promise<void> {
    if (this.closed) return Promise.reject(new Error('channel: closed'));
    this.sent.push(message);
    this.respond?.(message);
    return Promise.resolve();
  }

  onMessage(listener: (message: ChannelMessage) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onClose(listener: (reason: string) => void): () => void {
    this.#closes.add(listener);
    return () => this.#closes.delete(listener);
  }

  /** A message from the endpoint. */
  deliver(message: ChannelMessage): void {
    for (const listener of [...this.#listeners]) listener(message);
  }

  /** The channel ends, as the peer's close or a carrier's end ends it. */
  close(reason = 'closed'): void {
    if (this.closed) return;
    this.closed = true;
    for (const listener of [...this.#closes]) listener(reason);
  }

  /** The messages sent of kind `t`. */
  of(t: string): Array<ChannelMessage & Record<string, unknown>> {
    return this.sent.filter((m) => m.t === t) as Array<ChannelMessage & Record<string, unknown>>;
  }
}
