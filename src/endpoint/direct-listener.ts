// The direct listener (O10 M4; RL §4.1, P5 Decision Log 39): RL2 over a WebSocket straight to the endpoint, for a
// device on the owner's tailnet. It binds one server to each tailnet address the interface table names (tailnet.ts),
// never a wildcard, reads the table again every 30 s and at once on a bind error, rebinds when the addresses change, and
// reports the bound set as WebSocket URLs, which the endpoint signs into its endpoint record (RL6).
//
// A connection carries nothing but RL2: binary messages, the first of them `h1`; a text message closes it. The channel
// table (channels.ts) runs the handshake on it, which reads `h1` (at most 64 KiB) and then `h3` (at most a handshake
// page) before anything else, within 10 s. Every message is at most a handshake page (`maxPayload`), so an over-large
// `h3` closes the socket before it is read. Handshakes are limited per source address (a burst of 3, then 5 a minute)
// and overall (60 a minute); one past either is answered `503 busy` at the upgrade, before any key work.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { HANDSHAKE_PAGE_BYTES } from 'org-protocol';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { CarrierDuplex } from './channels';
import { directUrl, tailnetAddresses, type InterfaceTable } from './tailnet';

/** The interfaces are read again this often (and at once after a bind error). */
export const RESCAN_MS = 30_000;

type Bucket = { burst: number; perMinute: number };
export type HandshakeLimits = { perSource: Bucket; overall: Bucket };
export const HANDSHAKE_LIMITS: HandshakeLimits = { perSource: { burst: 3, perMinute: 5 }, overall: { burst: 60, perMinute: 60 } };

type Tokens = { tokens: number; at: number };

/** Token buckets: one per source address and one for all of them; a handshake takes a token from both, or from neither. */
export class HandshakeLimiter {
  readonly #limits: HandshakeLimits;
  readonly #now: () => number;
  readonly #sources = new Map<string, Tokens>();
  readonly #overall: Tokens;

  constructor(limits: HandshakeLimits = HANDSHAKE_LIMITS, now: () => number = Date.now) {
    this.#limits = limits;
    this.#now = now;
    this.#overall = { tokens: limits.overall.burst, at: now() };
  }

  /** How many sources it remembers (a source whose bucket is full again is forgotten). */
  get sources(): number {
    return this.#sources.size;
  }

  take(source: string): boolean {
    const now = this.#now();
    const { perSource, overall } = this.#limits;
    for (const [key, bucket] of this.#sources) if (refill(bucket, perSource, now) >= perSource.burst) this.#sources.delete(key);
    const bucket = this.#sources.get(source) ?? { tokens: perSource.burst, at: now };
    this.#sources.set(source, bucket);
    refill(this.#overall, overall, now);
    if (bucket.tokens < 1 || this.#overall.tokens < 1) return false;
    bucket.tokens -= 1;
    this.#overall.tokens -= 1;
    return true;
  }
}

function refill(bucket: Tokens, limit: Bucket, now: number): number {
  bucket.tokens = Math.min(limit.burst, bucket.tokens + ((now - bucket.at) * limit.perMinute) / 60_000);
  bucket.at = now;
  return bucket.tokens;
}

export type DirectListenerOptions = {
  port: number;
  interfaces(): InterfaceTable;
  /** A connection's carrier, for the channel table's handshake. */
  connection(io: CarrierDuplex, source: string): void;
  /** The bound set changed: its URLs, sorted. */
  addresses(urls: string[]): void;
  log(line: string): void;
  /** Listens `server` on `address`; answers the port it got. The suites listen on loopback in the address's place. */
  listen?(server: Server, address: string, port: number): Promise<number>;
  limits?: HandshakeLimits;
  rescanMs?: number;
  now?(): number;
};

/** An address's server and the WebSockets it upgraded, which `server.close()` alone would wait on. */
type Bound = { server: Server; port: number; sockets: Set<WebSocket> };

const BUSY = '{"error":"busy"}';

export class DirectListener {
  readonly #options: DirectListenerOptions;
  readonly #limiter: HandshakeLimiter;
  readonly #wss = new WebSocketServer({ noServer: true, maxPayload: HANDSHAKE_PAGE_BYTES, perMessageDeflate: false });
  readonly #bound = new Map<string, Bound>();
  /** Addresses whose bind failed, left alone until the next periodic read. */
  readonly #failed = new Set<string>();
  #reported: string[] = [];
  #queue: Promise<void> = Promise.resolve();
  #timer: ReturnType<typeof setInterval> | null = null;
  #stopped = false;

  constructor(options: DirectListenerOptions) {
    this.#options = options;
    this.#limiter = new HandshakeLimiter(options.limits, options.now);
  }

  get bound(): boolean {
    return this.#bound.size > 0;
  }

  /** Binds the tailnet's addresses, and reads the interfaces again every 30 s. */
  async start(): Promise<void> {
    this.#stopped = false;
    this.#timer ??= setInterval(() => void this.rescan(), this.#options.rescanMs ?? RESCAN_MS);
    this.#timer.unref?.();
    await this.rescan();
  }

  /** The periodic read: the interfaces again, and every address whose bind failed tried again. */
  rescan(): Promise<void> {
    return this.#serial(async () => {
      this.#failed.clear();
      if (await this.#reconcile()) await this.#reconcile();
      this.#report();
    });
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    await this.#serial(async () => {
      for (const address of [...this.#bound.keys()]) this.#unbind(address);
      for (const client of this.#wss.clients) client.terminate();
    });
  }

  #serial(run: () => Promise<void>): Promise<void> {
    const next = this.#queue.then(run).catch((error: unknown) => this.#options.log(`endpoint: the direct listener failed: ${(error as Error).message}`));
    this.#queue = next;
    return next;
  }

  /** Brings the bound set to the table's tailnet addresses; true when a bind failed (the table is read again at once). */
  async #reconcile(): Promise<boolean> {
    if (this.#stopped) return false;
    let wanted: string[];
    try {
      wanted = tailnetAddresses(this.#options.interfaces());
    } catch (error) {
      this.#options.log(`endpoint: the network interfaces could not be read: ${(error as Error).message}`);
      return false;
    }
    for (const address of [...this.#bound.keys()]) if (!wanted.includes(address)) this.#unbind(address);
    let failed = false;
    for (const address of wanted) {
      if (this.#bound.has(address) || this.#failed.has(address) || this.#stopped) continue;
      const sockets = new Set<WebSocket>();
      const server = this.#server(sockets);
      try {
        const port = await (this.#options.listen ?? listenOn)(server, address, this.#options.port);
        this.#bound.set(address, { server, port, sockets });
        this.#options.log(`endpoint: the direct listener is bound to ${directUrl(address, port)}`);
      } catch (error) {
        server.close();
        this.#failed.add(address);
        failed = true;
        this.#options.log(`endpoint: the direct listener could not bind a tailnet address: ${(error as Error).message}`);
      }
    }
    return failed;
  }

  #report(): void {
    if (this.#stopped) return;
    const urls = [...this.#bound].map(([address, { port }]) => directUrl(address, port)).sort();
    if (urls.length === this.#reported.length && urls.every((u, i) => u === this.#reported[i])) return;
    this.#reported = urls;
    this.#options.addresses(urls);
  }

  /**
   * Stops listening on `address` at once and ends every socket it carried (a channel on an address that left has no
   * path back anyway). Nothing waits for the server's drain: an upgraded socket would hold it, and the rebind and the
   * endpoint record must not.
   */
  #unbind(address: string): void {
    const bound = this.#bound.get(address);
    this.#bound.delete(address);
    if (bound === undefined) return;
    this.#options.log(`endpoint: the direct listener let ${directUrl(address, bound.port)} go`);
    for (const socket of bound.sockets) socket.terminate();
    bound.server.close();
    bound.server.closeAllConnections();
  }

  #server(sockets: Set<WebSocket>): Server {
    const server = createServer((_request, response) => {
      response.writeHead(426, { 'content-type': 'text/plain', connection: 'close' });
      response.end('RL2 only\n');
    });
    server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => this.#upgrade(request, socket, head, sockets));
    server.on('error', (error) => this.#options.log(`endpoint: the direct listener's server failed: ${error.message}`));
    return server;
  }

  #upgrade(request: IncomingMessage, socket: Duplex, head: Buffer, sockets: Set<WebSocket>): void {
    socket.on('error', () => socket.destroy());
    const source = request.socket.remoteAddress ?? 'unknown';
    if (this.#stopped || !this.#limiter.take(source)) {
      socket.end(`HTTP/1.1 503 Service Unavailable\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(BUSY)}\r\nconnection: close\r\n\r\n${BUSY}`);
      return;
    }
    this.#wss.handleUpgrade(request, socket, head, (ws) => {
      sockets.add(ws);
      ws.once('close', () => sockets.delete(ws));
      this.#connected(ws, source);
    });
  }

  #connected(ws: WebSocket, source: string): void {
    const io = new CarrierDuplex({
      send: (bytes) => {
        if (ws.readyState === ws.OPEN) ws.send(bytes, { binary: true });
      },
      close: (reason) => ws.close(1000, reason.slice(0, 64)),
    });
    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (!isBinary) return io.close('malformed');
      io.deliver(bytesOf(data));
    });
    ws.on('close', (_code: number, reason: Buffer) => io.end(reason.toString() || 'closed'));
    ws.on('error', () => ws.terminate());
    this.#options.connection(io, source);
  }
}

function listenOn(server: Server, address: string, port: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: address, port, exclusive: true }, () => {
      server.off('error', reject);
      const bound = server.address();
      resolve(typeof bound === 'object' && bound !== null ? bound.port : port);
    });
  });
}

/** A message's bytes, copied out of the socket's buffers. */
function bytesOf(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return data instanceof ArrayBuffer ? new Uint8Array(data.slice(0)) : new Uint8Array(data);
}
