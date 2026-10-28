// A channel's stream window (O10 M8; RL §4.4): what a channel's subscriptions stream goes through it, so that only a
// small window of stream messages is ever queued in the channel itself. The channel seals and sends in one queue, in
// order (RL2), so every stream message handed to it is one a later control message (`ack`, `done`, `result`, `caps`,
// `paused`, `ended`) waits behind; a device's credit alone allows 64 subscriptions × 4 MiB of them. Here a stream
// message goes to the channel only while less than STREAM_WINDOW_BYTES of stream traffic is still unsealed in it (one
// message at least, whatever its size), and the channel's subscriptions take their turns, one message each.
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
  /** Sources that may have something to send, in turn order. */
  readonly #turns: StreamSource[] = [];
  #inFlight = 0;

  constructor(channel: RemoteChannel, limit = STREAM_WINDOW_BYTES) {
    this.#channel = channel;
    this.#limit = limit;
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
      void this.#channel.transmit(next.message).then(() => {
        this.#inFlight -= next.bytes;
        this.#pump();
      });
    }
  }
}
