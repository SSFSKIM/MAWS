// A device's two carriers for the endpoint's channel suite (O10 M4): RL1's multiplex through the hub, from an app's
// Machine socket (`/api/machines/<ref>/socket`), and a direct WebSocket to the endpoint's listener; and a hostile relay
// (`TamperRelay`) spliced into either. Each dial is one RL2 carrier, as a device's `connectChannel` takes it.
import { closeReasonName, decodeChannelFrame, encodeChannelFrame, openTag, CHANNEL_CLOSE, type ByteDuplex } from 'org-protocol';
import WebSocket, { type RawData } from 'ws';
import { TamperRelay } from '../../apps/org-protocol/test-support/tamper-relay.ts';

/** One carrier's two directions, held until something listens. */
class Carrier implements ByteDuplex {
  readonly #listeners: Array<(bytes: Uint8Array) => void> = [];
  readonly #ends: Array<(reason: string) => void> = [];
  readonly #waiting: Uint8Array[] = [];
  readonly #out: { send(bytes: Uint8Array): void; close(): void };
  ended = false;

  constructor(out: { send(bytes: Uint8Array): void; close(): void }) {
    this.#out = out;
  }

  send(bytes: Uint8Array): void {
    if (!this.ended) this.#out.send(bytes);
  }

  close(): void {
    if (this.ended) return;
    this.ended = true;
    this.#out.close();
  }

  onBytes(listener: (bytes: Uint8Array) => void): void {
    this.#listeners.push(listener);
    for (const bytes of this.#waiting.splice(0)) listener(bytes);
  }

  onClose(listener: (reason: string) => void): void {
    this.#ends.push(listener);
  }

  deliver(bytes: Uint8Array): void {
    if (this.ended) return;
    if (this.#listeners.length === 0) this.#waiting.push(bytes);
    for (const listener of this.#listeners) listener(bytes);
  }

  end(reason: string): void {
    if (this.ended) return;
    this.ended = true;
    for (const listener of this.#ends) listener(reason);
  }
}

const bytesOf = (data: RawData): Uint8Array => new Uint8Array(Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data);

/**
 * An app's Machine socket to the hub, carrying any number of channels: a dial's first message opens its channel (the
 * hub numbers it and hands the endpoint the payload), the rest are its data, and either end's close ends it.
 */
export class RelayDialer {
  readonly #socket: WebSocket;
  readonly #byTag = new Map<number, { carrier: Carrier; queue: Uint8Array[]; closing: boolean; id?: number }>();
  readonly #byId = new Map<number, Carrier>();
  #tag = 1;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) this.#frame(bytesOf(data));
    });
    socket.on('close', () => {
      for (const carrier of this.#byId.values()) carrier.end('app-gone');
      this.#byId.clear();
    });
  }

  static async open(hubUrl: string, machine: string, headers: Record<string, string>): Promise<RelayDialer> {
    const socket = new WebSocket(`${hubUrl.replace(/^http/, 'ws')}/api/machines/${encodeURIComponent(machine)}/socket`, { headers });
    await new Promise<void>((resolve, reject) => socket.once('open', () => resolve()).once('error', reject));
    return new RelayDialer(socket);
  }

  dial(): Promise<ByteDuplex> {
    const tag = this.#tag++;
    let opened = false;
    const link: { carrier: Carrier; queue: Uint8Array[]; closing: boolean; id?: number } = {
      queue: [],
      closing: false,
      carrier: new Carrier({
        send: (bytes) => {
          if (!opened) {
            opened = true;
            this.#byTag.set(tag, link);
            this.#socket.send(encodeChannelFrame('open', tag, bytes));
          } else if (link.id === undefined) link.queue.push(bytes);
          else this.#socket.send(encodeChannelFrame('data', link.id, bytes));
        },
        close: () => {
          if (link.id === undefined) link.closing = true;
          else {
            this.#byId.delete(link.id);
            this.#socket.send(encodeChannelFrame('close', link.id, CHANNEL_CLOSE.closed));
          }
        },
      }),
    };
    return Promise.resolve(link.carrier);
  }

  close(): void {
    this.#socket.terminate();
  }

  #frame(bytes: Uint8Array): void {
    const frame = decodeChannelFrame(bytes);
    if (frame === null) return;
    if (frame.type === 'open') {
      const tag = openTag(frame.payload);
      const link = tag === null ? undefined : this.#byTag.get(tag);
      if (tag === null || link === undefined) return;
      this.#byTag.delete(tag);
      link.id = frame.channel;
      for (const queued of link.queue.splice(0)) this.#socket.send(encodeChannelFrame('data', frame.channel, queued));
      if (link.closing) this.#socket.send(encodeChannelFrame('close', frame.channel, CHANNEL_CLOSE.closed));
      else this.#byId.set(frame.channel, link.carrier);
      return;
    }
    const carrier = this.#byId.get(frame.channel);
    if (carrier === undefined) return;
    if (frame.type === 'close') {
      this.#byId.delete(frame.channel);
      return carrier.end(closeReasonName(frame.payload) ?? 'closed');
    }
    carrier.deliver(frame.payload.slice());
  }
}

/** A direct WebSocket to `url` (the listener's loopback stand-in in the suites). */
export async function dialDirect(url: string): Promise<ByteDuplex> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => socket.once('open', () => resolve()).once('error', reject));
  const carrier = new Carrier({ send: (bytes) => socket.send(bytes, { binary: true }), close: () => socket.close(1000) });
  socket.on('message', (data: RawData) => carrier.deliver(bytesOf(data)));
  socket.on('close', (_code, reason: Buffer) => carrier.end(reason.toString() || 'closed'));
  socket.on('error', () => socket.terminate());
  return carrier;
}

/** `inner` with a hostile relay spliced into its path: the device's end, and the relay to tamper through. */
export function throughTamper(inner: ByteDuplex): { device: ByteDuplex; relay: TamperRelay } {
  const relay = new TamperRelay();
  relay.endpoint.onBytes((bytes) => inner.send(bytes));
  inner.onBytes((bytes) => relay.endpoint.send(bytes));
  inner.onClose?.((reason) => relay.endpoint.close(reason));
  relay.endpoint.onClose?.((reason) => inner.close(reason));
  return { device: relay.device, relay };
}
