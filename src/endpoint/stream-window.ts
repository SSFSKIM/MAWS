// A channel's stream window (O10 M8; RL §4.4): what a channel's subscriptions stream goes through it, so that only a
// small window of stream messages is ever queued in the channel itself. The channel seals and sends in one queue, in
// order (RL2), so every stream message handed to it is one a later control message (`ack`, `done`, `result`, `caps`,
// `paused`, `ended`) waits behind; a device's credit alone allows 64 subscriptions × 4 MiB of them. Here a stream
// message goes to the channel only while less than STREAM_WINDOW_BYTES of stream traffic is still unsealed in it (one
// message at least, whatever its size), and the channel's subscriptions take their turns, one message each. A message
// the channel hasn't sealed within its deadline (a carrier that stopped taking bytes while the device's own traffic
// keeps the channel alive) ends the carrier under it: a sealed close would wait behind the same send. The channel
// closes, and its subscriptions' cursors resume on the device's next channel.
import type { EndpointMessage } from 'org-protocol';
import type { RemoteChannel } from './channels';

/** Stream bytes handed to the channel and not yet sealed onto its carrier, at most (one message past it at most). */
export const STREAM_WINDOW_BYTES = 256 * 1024;

/** A subscription's side: its next message the device's credit allows, or null when it has none to send now. */
export interface StreamSource {
  next(): { message: EndpointMessage; bytes: number } | null;
}

export class StreamWindow {
  readonly #channel: RemoteChannel;
  readonly #limit: number;
  readonly #deadlineMs: number;
  readonly #log: (line: string) => void;
  /** Sources that may have something to send, in turn order. */
  readonly #turns: StreamSource[] = [];
  #inFlight = 0;

  constructor(channel: RemoteChannel, options: { deadlineMs: number; log: (line: string) => void; limit?: number }) {
    this.#channel = channel;
    this.#limit = options.limit ?? STREAM_WINDOW_BYTES;
    this.#deadlineMs = options.deadlineMs;
    this.#log = options.log;
  }

  /** `source` may have something to send now (a message queued, credit come, its hold over). */
  ready(source: StreamSource): void {
    if (!this.#turns.includes(source)) this.#turns.push(source);
    this.#pump();
  }

  #pump(): void {
    while (this.#inFlight < this.#limit && this.#turns.length > 0 && !this.#channel.closed) {
      const source = this.#turns.shift()!;
      const next = source.next();
      if (next === null) continue;
      this.#turns.push(source);
      this.#inFlight += next.bytes;
      const stuck = setTimeout(() => {
        this.#log(`endpoint: channel ${this.#channel.key} sealed no stream message in ${this.#deadlineMs} ms; its carrier is ended`);
        this.#channel.terminate('timeout');
      }, this.#deadlineMs);
      stuck.unref?.();
      void this.#channel.transmit(next.message).then(() => {
        clearTimeout(stuck);
        this.#inFlight -= next.bytes;
        this.#pump();
      });
    }
  }
}
