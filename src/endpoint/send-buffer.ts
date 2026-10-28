// A carrier's send buffer (O10, after M8; RL §4.4): what the endpoint handed a WebSocket and the socket hasn't yet
// written to the kernel, which a peer that stops reading would otherwise grow without limit. The direct listener keeps
// one per device socket, the hub link one per RL1 connection.
//
// Under the soft cap the carrier is writable: a channel's stream (stream-window.ts, through `RemoteChannel.transmit`)
// waits while the buffer is at or over it, and goes on once it drains under it. Nothing else waits: every send goes into
// the socket at once, in order, so control messages are never held behind the stream. A capped send (what a peer can
// make the endpoint hold: a channel's frames) is refused once the capped bytes held would pass the hard cap, and the
// carrier decides what that ends. Each is counted with its frame's largest header, so a socket whose every send is
// capped holds no more than the hard cap. A carrier may also bound how long bytes are held with none written
// (`stallMs`): a peer that reads nothing, while its own traffic keeps its channel alive, is ended then.
import type WebSocket from 'ws';

export type SendLimits = {
  /** At or over this many bytes unsent, the carrier's stream waits. */
  soft: number;
  /** Capped sends hold at most this many bytes unsent; one that would pass it is refused. */
  hard: number;
  /** Bytes held with none of them written for this long are a stall; unset, there is no bound. */
  stallMs?: number;
};

/** A WebSocket frame's header at most (RFC 6455 §5.2: two bytes, a 64-bit length and a mask). */
const FRAME_HEADER_MAX = 14;

export class SendBuffer {
  readonly #socket: WebSocket;
  readonly #limits: SendLimits;
  readonly #stalled: () => void;
  readonly #waiting: Array<() => void> = [];
  /** Capped bytes sent and not yet written. */
  #capped = 0;
  #closed = false;
  /** When the socket last wrote a send, or began holding bytes. */
  #wroteAt = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(socket: WebSocket, limits: SendLimits, stalled: () => void = () => {}) {
    this.#socket = socket;
    this.#limits = limits;
    this.#stalled = stalled;
    socket.once('close', () => {
      this.#closed = true;
      if (this.#timer !== null) clearTimeout(this.#timer);
      this.#timer = null;
      this.#release();
    });
  }

  /** Bytes handed to the socket and not yet written, whatever sent them. */
  get buffered(): number {
    return this.#socket.bufferedAmount;
  }

  /** Sends `data` now; a capped send that would take the capped bytes held past the hard cap is refused (false), unsent. */
  send(data: Uint8Array | string, options: { binary: boolean; capped: boolean }): boolean {
    const cost = options.capped ? (typeof data === 'string' ? Buffer.byteLength(data) : data.length) + FRAME_HEADER_MAX : 0;
    if (this.#capped + cost > this.#limits.hard) return false;
    this.#capped += cost;
    this.#socket.send(data, { binary: options.binary }, () => {
      this.#capped -= cost;
      this.#wroteAt = Date.now();
      if (this.buffered < this.#limits.soft) this.#release();
    });
    if (this.buffered > 0) this.#arm();
    return true;
  }

  /** Resolves once the socket holds less than the soft cap unsent, or has closed. */
  writable(): Promise<void> {
    if (this.#closed || this.buffered < this.#limits.soft) return Promise.resolve();
    return new Promise((resolve) => this.#waiting.push(resolve));
  }

  #release(): void {
    for (const resolve of this.#waiting.splice(0)) resolve();
  }

  #arm(): void {
    const ms = this.#limits.stallMs;
    if (ms === undefined || this.#timer !== null || this.#closed) return;
    this.#wroteAt = Date.now();
    this.#timer = setTimeout(() => this.#check(ms), ms);
    this.#timer.unref?.();
  }

  #check(ms: number): void {
    this.#timer = null;
    if (this.#closed || this.buffered === 0) return;
    const idle = Date.now() - this.#wroteAt;
    if (idle >= ms) return this.#stalled();
    this.#timer = setTimeout(() => this.#check(ms), ms - idle);
    this.#timer.unref?.();
  }
}
