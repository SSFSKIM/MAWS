// The RL2 link's two carriers (P5 O7 M1, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Carriers"; P5 §3):
// a direct WebSocket to the machine's endpoint listener on its tailnet address, and RL1's channel multiplex through the
// hub's app socket to the machine's object (`/api/machines/<ref>/socket`). Each dial is one RL2 carrier, a message-
// oriented `ByteDuplex` that `connectChannel` runs its handshake over. Both use `ws`, whose `headers` option carries the
// hub's credentials (Node's global WebSocket takes undici's own).
//
// Only a `ws://` address whose host lies in the tailnet's ranges (IPv4 100.64.0.0/10, IPv6 fd7a:115c:a1e0::/48, the
// ranges the listener binds; RL §4.1) is ever dialled: a signed record that names another host is not followed, so a
// compromised machine can't point the app's sockets anywhere else.
//
// A carrier's end reaches the channel as the fixed reason `carrier`, whatever the transport said: a sealed `close`
// arrives inside the channel and is the only way the far side's word ends it, so a relay or a socket's close frame can
// never pass for one (link.ts reads `removed` only from a sealed close).
import { BlockList, isIP } from 'node:net';
import WebSocket, { type RawData } from 'ws';
import { CHANNEL_CLOSE, decodeChannelFrame, encodeChannelFrame, MAX_CHANNELS_PER_SOCKET, openTag, type ByteDuplex } from '../../../../apps/org-protocol/src/index.ts';

/** The reason every carrier end reports to its channel. */
export const CARRIER_CLOSED = 'carrier';

const TAILNET = new BlockList();
TAILNET.addSubnet('100.64.0.0', 10, 'ipv4');
TAILNET.addSubnet('fd7a:115c:a1e0::', 48, 'ipv6');

/** Whether `address` is a `ws://` URL with a tailnet host, the only addresses the direct carrier dials. */
export function isTailnetAddress(address: string): boolean {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (url.protocol !== 'ws:' || url.username !== '' || url.password !== '') return false;
  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  const family = isIP(host);
  if (family === 4) return TAILNET.check(host, 'ipv4');
  if (family === 6) return TAILNET.check(host, 'ipv6');
  return false;
}

/** One carrier's two directions, its received messages held until the channel listens. */
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
    for (const listener of this.#ends.splice(0)) listener(CARRIER_CLOSED);
  }

  onBytes(listener: (bytes: Uint8Array) => void): void {
    this.#listeners.push(listener);
    for (const bytes of this.#waiting.splice(0)) listener(bytes);
  }

  onClose(listener: (reason: string) => void): void {
    if (this.ended) return void queueMicrotask(() => listener(CARRIER_CLOSED));
    this.#ends.push(listener);
  }

  deliver(bytes: Uint8Array): void {
    if (this.ended) return;
    if (this.#listeners.length === 0) this.#waiting.push(bytes);
    for (const listener of this.#listeners) listener(bytes);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const listener of this.#ends.splice(0)) listener(CARRIER_CLOSED);
  }
}

const bytesOf = (data: RawData): Uint8Array => new Uint8Array(Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data);

/** One `ws://` WebSocket, binary messages; rejects past `timeoutMs`. */
export function dialDirect(url: string, timeoutMs: number): Promise<ByteDuplex> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { handshakeTimeout: timeoutMs, maxPayload: 2 * 1024 * 1024 });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error(`${url} did not open within ${timeoutMs} ms`));
    }, timeoutMs);
    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timer);
      socket.terminate();
      reject(new Error(`${url} answered ${response.statusCode}`));
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      socket.terminate();
      reject(error);
    });
    socket.once('open', () => {
      clearTimeout(timer);
      socket.removeAllListeners('error');
      const carrier = new Carrier({ send: (bytes) => socket.send(bytes, { binary: true }), close: () => socket.close(1000) });
      socket.on('message', (data: RawData, isBinary: boolean) => {
        if (isBinary) carrier.deliver(bytesOf(data));
      });
      socket.on('close', () => carrier.end());
      socket.on('error', () => socket.terminate());
      resolve(carrier);
    });
  });
}

/**
 * Every address dialled at once: the first WebSocket to open within `timeoutMs` wins and the rest are closed, as each
 * opens or fails. Rejects when none opens in time.
 */
export function raceDirect(addresses: readonly string[], timeoutMs: number, dial: (url: string, timeoutMs: number) => Promise<ByteDuplex>): Promise<{ url: string; carrier: ByteDuplex }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let failed = 0;
    if (addresses.length === 0) return reject(new Error('no direct address'));
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`no direct address opened within ${timeoutMs} ms`));
    }, timeoutMs);
    for (const url of addresses) {
      dial(url, timeoutMs).then(
        (carrier) => {
          if (settled) return carrier.close('lost the race');
          settled = true;
          clearTimeout(timer);
          resolve({ url, carrier });
        },
        () => {
          failed += 1;
          if (settled || failed < addresses.length) return;
          settled = true;
          clearTimeout(timer);
          reject(new Error('no direct address opened'));
        },
      );
    }
  });
}

/** One app socket to the machine's object; at most `MAX_CHANNELS_PER_SOCKET` channels. */
export interface RelaySocket {
  /** A new channel: its first send is the hub's `open [tag][payload]`. */
  dial(): Promise<ByteDuplex>;
  /** Every channel on it has ended by then. */
  onClose(listener: (reason: string) => void): void;
  close(): void;
}

/** The hub's upgrade refused: `status` is its HTTP status (401 and 403 say the hub session needs renewing). */
export class RelayUpgradeError extends Error {
  constructor(readonly status: number) {
    super(`the hub refused the relay socket: ${status}`);
    this.name = 'RelayUpgradeError';
  }
}

type RelayChannel = { carrier: Carrier; queue: Uint8Array[]; closing: boolean; id?: number };

/** An app socket to the hub (`wss://`, or `ws://` for an `http://` hub); rejects on a failed upgrade, naming its status. */
export function openRelaySocket(url: string, headers: Record<string, string>, timeoutMs = 10_000): Promise<RelaySocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers, handshakeTimeout: timeoutMs, maxPayload: 2 * 1024 * 1024 });
    socket.once('unexpected-response', (_request, response) => {
      socket.terminate();
      reject(new RelayUpgradeError(response.statusCode ?? 0));
    });
    socket.once('error', (error) => {
      socket.terminate();
      reject(error);
    });
    socket.once('open', () => {
      socket.removeAllListeners('error');
      socket.on('error', () => socket.terminate());
      resolve(relayOver(socket));
    });
  });
}

function relayOver(socket: WebSocket): RelaySocket {
  const byTag = new Map<number, RelayChannel>();
  const byId = new Map<number, RelayChannel>();
  const closeListeners: Array<(reason: string) => void> = [];
  let nextTag = 1;
  let ended: string | null = null;
  const open = () => byTag.size + byId.size;

  socket.on('message', (data: RawData, isBinary: boolean) => {
    if (!isBinary) return; // the hub's `presence` and other text messages are not the link's
    const frame = decodeChannelFrame(bytesOf(data));
    if (frame === null) return;
    if (frame.type === 'open') {
      const tag = openTag(frame.payload);
      const channel = tag === null ? undefined : byTag.get(tag);
      if (tag === null || channel === undefined) return;
      byTag.delete(tag);
      channel.id = frame.channel;
      for (const queued of channel.queue.splice(0)) socket.send(encodeChannelFrame('data', frame.channel, queued));
      if (channel.closing) socket.send(encodeChannelFrame('close', frame.channel, CHANNEL_CLOSE.closed));
      else byId.set(frame.channel, channel);
      return;
    }
    const channel = byId.get(frame.channel);
    if (channel === undefined) return;
    if (frame.type === 'close') {
      byId.delete(frame.channel);
      return channel.carrier.end();
    }
    channel.carrier.deliver(frame.payload.slice());
  });
  socket.on('close', () => {
    ended ??= 'closed';
    for (const channel of [...byTag.values(), ...byId.values()]) channel.carrier.end();
    byTag.clear();
    byId.clear();
    for (const listener of closeListeners.splice(0)) listener(ended);
  });

  return {
    dial() {
      if (ended !== null || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('the relay socket is closed'));
      if (open() >= MAX_CHANNELS_PER_SOCKET) return Promise.reject(new Error(`the relay socket holds ${MAX_CHANNELS_PER_SOCKET} channels`));
      const tag = nextTag;
      nextTag = nextTag >= 0xffffffff ? 1 : nextTag + 1;
      let opened = false;
      const channel: RelayChannel = {
        queue: [],
        closing: false,
        carrier: new Carrier({
          send: (bytes) => {
            if (!opened) {
              opened = true;
              byTag.set(tag, channel);
              socket.send(encodeChannelFrame('open', tag, bytes));
            } else if (channel.id === undefined) channel.queue.push(bytes);
            else socket.send(encodeChannelFrame('data', channel.id, bytes));
          },
          close: () => {
            if (channel.id === undefined) {
              channel.closing = true;
              if (!opened) byTag.delete(tag);
            } else {
              byId.delete(channel.id);
              if (socket.readyState === WebSocket.OPEN) socket.send(encodeChannelFrame('close', channel.id, CHANNEL_CLOSE.closed));
            }
          },
        }),
      };
      return Promise.resolve(channel.carrier);
    },
    onClose(listener) {
      if (ended !== null) return void queueMicrotask(() => listener(ended!));
      closeListeners.push(listener);
    },
    close() {
      ended ??= 'closed';
      socket.terminate();
    },
  };
}
