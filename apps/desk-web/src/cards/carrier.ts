// The phone's carrier for RL2 channels (P5 O13 M4, §C): one WebSocket per machine to the hub's relay,
// `/api/machines/<ref or name>/socket` (O11 M6), signed in by the Access cookie, speaking RL1's multiplex with the
// package's frames (`[u8 open 1 | data 2 | close 3][u32 channel][payload]`):
//   dial   `open [tag][empty]` on the socket, resolved at the hub's `open [id][tag]` with a byte duplex whose sends are
//          `data [id][bytes]`; `close [id][reason]` either way ends it, with the reason's name
//   end    the socket's end ends every channel `app-gone`; the socket reconnects on `src/hub/socket.ts`'s backoff, and a
//          dial meanwhile waits for it (bounded)
// The socket's text frames are the hub's `presence` (the machine's endpoint online, each session's pending count as the
// endpoint last notified), kept here for the cards list; null while the socket is down. The phone stays on the relay
// (P5 Decision Log 39): it dials nothing directly and reads no endpoint record.
import { closeReasonName, decodeChannelFrame, encodeChannelFrame, openTag, CHANNEL_CLOSE, type ByteDuplex, type RelayPresence } from 'org-protocol';
import { backoff } from '../hub/socket';

export interface MachineSocket {
  /** A new channel's carrier through the hub, once the hub numbered it. */
  dial(): Promise<ByteDuplex>;
  /** The hub's last presence for the machine; null before the first and while the socket is down. */
  presence(): RelayPresence | null;
  onPresence(listener: (presence: RelayPresence | null) => void): () => void;
  /** Ends the socket for good, every channel with it. */
  close(): void;
}

export type MachineSocketOptions = {
  /** Opens the socket (the browser's WebSocket by default, which carries the Access cookie). */
  connect?: (url: string) => WebSocket;
  /** The pause before the next connection after `attempt` failed ones (`backoff`). */
  delay?: (attempt: number) => number;
  /** How long a dial waits for the socket and the hub's answer to its `open` (a channel's handshake budget). */
  dialMs?: number;
  /** Called once the socket is closed for good (`close`). */
  closed?: () => void;
};

export const DIAL_MS = 30_000;

export const machineSocketPath = (machine: string) => `/api/machines/${encodeURIComponent(machine)}/socket`;

/**
 * One channel over the socket: what it receives before anything listens is kept for the first listener, and its end for
 * a listener that comes after it (a refused open ends at once, before the dial's caller holds the duplex).
 */
class Link implements ByteDuplex {
  ended = false;
  #endedBy: string | null = null;
  readonly #listeners: Array<(bytes: Uint8Array) => void> = [];
  readonly #ends: Array<(reason: string) => void> = [];
  readonly #waiting: Uint8Array[] = [];

  constructor(
    readonly id: number,
    private readonly out: { send(frame: Uint8Array): void; forget(id: number): void },
  ) {}

  send(bytes: Uint8Array): void {
    if (!this.ended) this.out.send(encodeChannelFrame('data', this.id, bytes));
  }

  close(): void {
    if (this.ended) return;
    this.ended = true;
    this.out.forget(this.id);
    this.out.send(encodeChannelFrame('close', this.id, CHANNEL_CLOSE.closed));
  }

  onBytes(listener: (bytes: Uint8Array) => void): void {
    this.#listeners.push(listener);
    for (const bytes of this.#waiting.splice(0)) listener(bytes);
  }

  onClose(listener: (reason: string) => void): void {
    const reason = this.#endedBy;
    if (reason !== null) queueMicrotask(() => listener(reason));
    else this.#ends.push(listener);
  }

  deliver(bytes: Uint8Array): void {
    if (this.ended) return;
    if (this.#listeners.length === 0) this.#waiting.push(bytes);
    for (const listener of this.#listeners) listener(bytes);
  }

  end(reason: string): void {
    if (this.ended) return;
    this.ended = true;
    this.#endedBy = reason;
    for (const listener of this.#ends.splice(0)) listener(reason);
  }
}

type Waiter = { resolve(): void; reject(error: Error): void };

class Socket implements MachineSocket {
  #ws: WebSocket | null = null;
  #open = false;
  #closed = false;
  #attempt = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #tag = 1;
  #presence: RelayPresence | null = null;
  readonly #presenceListeners = new Set<(presence: RelayPresence | null) => void>();
  /** Dials waiting for the socket to open. */
  readonly #waiting = new Set<Waiter>();
  /** Dials waiting for the hub's answer to their `open`, by tag. */
  readonly #opening = new Map<number, { resolve(link: Link): void; reject(error: Error): void }>();
  readonly #links = new Map<number, Link>();

  constructor(
    private readonly url: string,
    private readonly options: MachineSocketOptions,
  ) {
    this.#connect();
  }

  presence(): RelayPresence | null {
    return this.#presence;
  }

  onPresence(listener: (presence: RelayPresence | null) => void): () => void {
    this.#presenceListeners.add(listener);
    return () => this.#presenceListeners.delete(listener);
  }

  async dial(): Promise<ByteDuplex> {
    const deadline = Date.now() + (this.options.dialMs ?? DIAL_MS);
    await this.#opened(deadline);
    const tag = this.#tag;
    this.#tag += 1;
    const link = new Promise<Link>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#opening.delete(tag);
        reject(new Error(`machine socket: no answer to a channel's open within ${this.options.dialMs ?? DIAL_MS} ms`));
      }, Math.max(0, deadline - Date.now()));
      this.#opening.set(tag, {
        resolve: (opened) => (clearTimeout(timer), resolve(opened)),
        reject: (error) => (clearTimeout(timer), reject(error)),
      });
    });
    this.#send(encodeChannelFrame('open', tag));
    return link;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    const ws = this.#ws;
    this.#ws = null;
    ws?.close();
    this.#down('machine socket: closed');
    this.options.closed?.();
  }

  #opened(deadline: number): Promise<void> {
    if (this.#closed) return Promise.reject(new Error('machine socket: closed'));
    if (this.#open) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve: () => (clearTimeout(timer), this.#waiting.delete(waiter), resolve()),
        reject: (error) => (clearTimeout(timer), this.#waiting.delete(waiter), reject(error)),
      };
      const timer = setTimeout(() => waiter.reject(new Error(`machine socket: not connected within ${this.options.dialMs ?? DIAL_MS} ms`)), Math.max(0, deadline - Date.now()));
      this.#waiting.add(waiter);
    });
  }

  #send(frame: Uint8Array): void {
    const ws = this.#ws;
    if (ws !== null && this.#open) ws.send(frame);
  }

  #connect(): void {
    if (this.#closed) return;
    const ws = (this.options.connect ?? ((url) => new WebSocket(url)))(this.url);
    ws.binaryType = 'arraybuffer';
    this.#ws = ws;
    ws.onopen = () => {
      if (this.#ws !== ws) return;
      this.#open = true;
      for (const waiter of [...this.#waiting]) waiter.resolve();
    };
    ws.onmessage = (event: MessageEvent) => {
      if (this.#ws !== ws) return;
      this.#attempt = 0; // the hub answered: the next drop starts the backoff over
      if (typeof event.data === 'string') this.#text(event.data);
      else if (event.data instanceof ArrayBuffer) this.#frame(new Uint8Array(event.data));
    };
    ws.onclose = () => {
      if (this.#ws !== ws) return;
      this.#ws = null;
      this.#down('app-gone');
      if (this.#closed) return;
      const delay = (this.options.delay ?? backoff)(this.#attempt);
      this.#attempt += 1;
      this.#timer = setTimeout(() => {
        this.#timer = null;
        this.#connect();
      }, delay);
    };
  }

  /** The socket is down: every channel ends, every dial waiting on the hub's answer fails, presence is unknown. */
  #down(reason: string): void {
    this.#open = false;
    for (const link of [...this.#links.values()]) link.end('app-gone');
    this.#links.clear();
    for (const opening of [...this.#opening.values()]) opening.reject(new Error(`machine socket: ${reason}`));
    this.#opening.clear();
    if (this.#closed) for (const waiter of [...this.#waiting]) waiter.reject(new Error('machine socket: closed'));
    if (this.#presence !== null) this.#tell(null);
  }

  #text(data: string): void {
    let frame: unknown;
    try {
      frame = JSON.parse(data);
    } catch {
      return; // the hub's `pong`, or a text frame this version does not read
    }
    if (isPresence(frame)) this.#tell(frame);
  }

  #tell(presence: RelayPresence | null): void {
    this.#presence = presence;
    for (const listener of [...this.#presenceListeners]) listener(presence);
  }

  #frame(bytes: Uint8Array): void {
    const frame = decodeChannelFrame(bytes);
    if (frame === null) return;
    if (frame.type === 'open') {
      const tag = openTag(frame.payload);
      const opening = tag === null ? undefined : this.#opening.get(tag);
      if (tag === null || opening === undefined) return;
      this.#opening.delete(tag);
      const link = new Link(frame.channel, { send: (out) => this.#send(out), forget: (id) => this.#links.delete(id) });
      this.#links.set(frame.channel, link);
      return opening.resolve(link);
    }
    const link = this.#links.get(frame.channel);
    if (link === undefined) return;
    if (frame.type === 'close') {
      this.#links.delete(frame.channel);
      return link.end(closeReasonName(frame.payload) ?? 'closed');
    }
    link.deliver(frame.payload.slice());
  }
}

function isPresence(value: unknown): value is RelayPresence {
  if (typeof value !== 'object' || value === null) return false;
  const frame = value as Record<string, unknown>;
  return frame.t === 'presence' && typeof frame.online === 'boolean' && typeof frame.pending === 'object' && frame.pending !== null && !Array.isArray(frame.pending);
}

/** The Machine socket to `machine` (its ref, or its name) at the hub `hub` (an origin). */
export function machineSocket(hub: string, machine: string, options: MachineSocketOptions = {}): MachineSocket {
  return new Socket(`${hub.replace(/\/$/, '').replace(/^http/, 'ws')}${machineSocketPath(machine)}`, options);
}
