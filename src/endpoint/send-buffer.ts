// A carrier's send buffer (O10, after M8; RL §4.4): what the endpoint handed a WebSocket and the peer hasn't yet taken,
// which a peer that stops reading would otherwise grow without limit. The direct listener keeps one per device socket,
// the hub link one per RL1 connection.
//
// Every frame the endpoint sends on the socket goes through it, in order, a WebSocket pong among them (the carriers
// answer pings here, not in `ws`, so no byte escapes the count). It hands the socket one frame at a time, the next once
// the kernel took the last: what waits is held here, counted, and each frame written is progress the buffer sees,
// however the socket would have batched queued writes (a batch's callbacks all wait for its last byte).
//
// Under the soft cap the carrier is writable: a channel's stream (stream-window.ts, through `RemoteChannel.transmit`)
// and the log plane's uploads (rl10/log-relay.ts) wait while the buffer is at or over it, and go on once it drains
// under it. Nothing else waits. A capped send (a relayed channel's frame on the hub link) is refused once the capped
// bytes held would pass the budget, and the carrier decides what that ends. Past the ceiling, which counts every byte
// held, and when bytes are held with no frame written for the stall bound, the buffer ends and the carrier ends its
// socket: what a peer that reads nothing costs is its connection, whatever else it keeps sending.
//
// A graceful close goes through it too (`close`): it refuses every send after, writes what it holds, and only then
// hands the socket its close frame, so a channel's sealed close (and the results before it) is not overtaken by the
// WebSocket's. The stall bound still holds while it writes: a peer that stops reading then has its socket ended here.
import type WebSocket from 'ws';

export type SendLimits = {
  /** At or over this many bytes held, the carrier's streams and uploads wait. */
  soft: number;
  /** Every byte held, at most: a send that would pass it ends the buffer (`overflow`). */
  ceiling: number;
  /** Capped sends' bytes held, at most: a capped send that would pass it is refused; unset, the ceiling alone. */
  budget?: number;
  /** Bytes held with no frame written for this long end the buffer (`stalled`). */
  stallMs: number;
};

export type SendEnding = 'overflow' | 'stalled';

/** A WebSocket frame's header at most (RFC 6455 §5.2: two bytes, a 64-bit length and a mask). */
const FRAME_HEADER_MAX = 14;

type Held = { data: Uint8Array | string; binary: boolean; pong: boolean; capped: boolean; size: number };

export class SendBuffer {
  readonly #socket: WebSocket;
  readonly #limits: SendLimits;
  readonly #ended: (why: SendEnding) => void;
  readonly #held: Held[] = [];
  readonly #waiting = new Set<() => void>();
  /** Bytes held here, not yet handed to the socket. */
  #queued = 0;
  /** Capped bytes held here, or handed to the socket and not yet written. */
  #capped = 0;
  #writing = false;
  #over = false;
  /** The close to send once everything held is written (`close`). */
  #closing: { code: number; reason: string } | null = null;
  /** When the socket last wrote a frame, or began holding bytes. */
  #wroteAt = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(socket: WebSocket, limits: SendLimits, ended: (why: SendEnding) => void) {
    this.#socket = socket;
    this.#limits = limits;
    this.#ended = ended;
    socket.once('close', () => this.#stop());
  }

  /** Every byte held: here, and handed to the socket and not yet written. */
  get buffered(): number {
    return this.#queued + this.#socket.bufferedAmount;
  }

  /** The buffer ended (past its ceiling, stalled, closing, or its socket closed): it takes nothing more. */
  get ended(): boolean {
    return this.#over || this.#closing !== null;
  }

  /** The `writable()` waits registered now. */
  get waits(): number {
    return this.#waiting.size;
  }

  /**
   * Sends `data` after everything sent before it. False when refused: a capped send past the budget (the buffer goes
   * on), or a send past the ceiling or after the end (the buffer has ended).
   */
  send(data: Uint8Array | string, options: { binary: boolean; capped?: boolean }): boolean {
    return this.#hold({ data, binary: options.binary, pong: false, capped: options.capped === true });
  }

  /** A pong for the peer's ping, held and counted as any frame. */
  pong(data: Uint8Array): void {
    this.#hold({ data, binary: true, pong: true, capped: false });
  }

  /**
   * Closes the socket with `code` and `reason` once everything held is written; a peer that reads none of it for the
   * stall bound has its socket ended instead.
   */
  close(code: number, reason: string): void {
    if (this.ended) return;
    this.#closing = { code, reason };
    this.#release();
    this.#finish();
  }

  /** Resolves once the buffer holds less than the soft cap, or has ended, or `signal` aborts (the wait unregistered). */
  writable(signal?: AbortSignal): Promise<void> {
    if (this.ended || signal?.aborted === true || this.buffered < this.#limits.soft) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        this.#waiting.delete(done);
        signal?.removeEventListener('abort', done);
        resolve();
      };
      this.#waiting.add(done);
      signal?.addEventListener('abort', done, { once: true });
    });
  }

  #hold(item: Omit<Held, 'size'>): boolean {
    if (this.ended) return false;
    const size = (typeof item.data === 'string' ? Buffer.byteLength(item.data) : item.data.length) + FRAME_HEADER_MAX;
    if (item.capped && this.#capped + size > (this.#limits.budget ?? Infinity)) return false;
    if (this.buffered + size > this.#limits.ceiling) {
      this.#end('overflow');
      return false;
    }
    this.#held.push({ ...item, size });
    this.#queued += size;
    if (item.capped) this.#capped += size;
    this.#write();
    this.#arm();
    return true;
  }

  /** Hands the socket the next frame, once it wrote the last. */
  #write(): void {
    if (this.#writing || this.#over || this.#socket.readyState !== this.#socket.OPEN) return;
    const item = this.#held.shift();
    if (item === undefined) return;
    this.#queued -= item.size;
    this.#writing = true;
    const written = () => {
      this.#writing = false;
      if (item.capped) this.#capped -= item.size;
      this.#wroteAt = Date.now();
      if (this.buffered < this.#limits.soft) this.#release();
      this.#write();
      this.#finish();
    };
    if (item.pong) this.#socket.pong(item.data, undefined, written);
    else this.#socket.send(item.data, { binary: item.binary }, written);
  }

  /** The close, once closing and nothing is left to write (the socket's own close goes after what it was handed). */
  #finish(): void {
    if (this.#closing === null || this.#over || this.#writing || this.#held.length > 0) return;
    const { code, reason } = this.#closing;
    this.#stop();
    this.#socket.close(code, reason);
  }

  #release(): void {
    for (const done of [...this.#waiting]) done();
  }

  #holding(): boolean {
    return this.#writing || this.#held.length > 0 || this.#socket.bufferedAmount > 0;
  }

  #arm(): void {
    if (this.#timer !== null || this.#over || !this.#holding()) return;
    this.#wroteAt = Date.now();
    this.#timer = setTimeout(() => this.#check(), this.#limits.stallMs);
    this.#timer.unref?.();
  }

  #check(): void {
    this.#timer = null;
    if (this.#over || !this.#holding()) return;
    const idle = Date.now() - this.#wroteAt;
    if (idle >= this.#limits.stallMs) return this.#end('stalled');
    this.#timer = setTimeout(() => this.#check(), this.#limits.stallMs - idle);
    this.#timer.unref?.();
  }

  /**
   * Ends the buffer: the carrier hears why while what it held is still counted, then everything held is let go. A
   * closing buffer's socket is ended here, its carrier having let it go already.
   */
  #end(why: SendEnding): void {
    if (this.#over) return;
    this.#over = true;
    this.#ended(why);
    this.#stop();
    if (this.#closing !== null) this.#socket.terminate();
  }

  #stop(): void {
    this.#over = true;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#held.length = 0;
    this.#queued = 0;
    this.#release();
  }
}
