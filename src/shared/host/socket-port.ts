// A HostPort over a connected Unix socket (E10 execution document, Interfaces "The socket port"), so C1's runtime
// serves a socket exactly as it serves a MessagePort, and main's side speaks the envelope over the same class. One JSON
// value per line. Like a MessagePort, received messages queue until `start()`; the handshake reader's leftover bytes
// (what it read past the hello) are delivered first. A line that is not JSON, a line over the cap, or a peer stalled
// past the writable cap closes the connection with a log line; a write after the close is dropped. A draining close
// (main's deliberate one at a keep-quit, E11) writes nothing more but still delivers what the peer wrote before it saw
// the end, until the peer closes (or the grace runs out): the host, which ends its side at the client's end and refuses
// every write after it, then counts nothing delivered that the client did not read.
//
// P3-A M5 (socket protocol 2; docs/doperpowers/plans/2026-10-12-p3-a-store.md): after the handshake the port reads
// records, not lines (`splitRecords`): a document frame is delivered to the `onDoc` listeners in its place among the
// lines (queued with them until `start()`), and `postDoc` writes one, under the same rules as a line (nothing once
// closing, draining or closed; a write that stalls the peer past the cap closes the connection). A line carries a
// Uint8Array as base64 (json-bytes.ts), so a message's bytes cross as they do over a MessagePort.
import type { Socket } from 'node:net';
import type { HostPort } from './runtime';
import { decodeJsonLine, encodeJsonLine } from './json-bytes';
import { DOC_FRAME_CAP, encodeDocFrame, LINE_CAP, splitRecords, WRITABLE_CAP } from './socket-protocol';

export interface SocketPortOptions {
  lineCap?: number;
  frameCap?: number; // P3-A M5: a document frame's payload
  writableCap?: number;
  log?: (line: string) => void;
}

// How long close() waits for the peer to finish the close before it destroys the socket.
export const CLOSE_GRACE_MS = 1_000; // E11: also the bound main's quit waits for a draining close

type MessageListener = (event: { data: unknown }) => void;
type DocListener = (channel: number, frame: Uint8Array) => void; // P3-A M5

export class SocketPort implements HostPort {
  private readonly listeners: MessageListener[] = [];
  private readonly closeListeners: ((hadError: boolean) => void)[] = [];
  private readonly docListeners: DocListener[] = []; // P3-A M5
  private queue: (() => void)[] | null = []; // the deliveries waiting for start(), lines and frames in arrival order; null once started
  private dead = false; // closing or closed: nothing more is delivered or written
  private draining = false; // a draining close: nothing more is written, what arrives is still delivered (E11)
  private closedWith: boolean | null = null;
  private readonly log: (line: string) => void;
  private readonly writableCap: number;

  constructor(
    private readonly socket: Socket,
    leftover: Buffer,
    options: SocketPortOptions = {},
  ) {
    this.log = options.log ?? ((line) => console.error(`[socket] ${line}`));
    this.writableCap = options.writableCap ?? WRITABLE_CAP;
    const lineCap = options.lineCap ?? LINE_CAP;
    const splitter = splitRecords(
      {
        line: (line) => this.receive(line),
        doc: (channel, frame) => this.enqueue(() => this.deliverDoc(channel, frame)), // P3-A M5
        overflow: (why) => this.fail(`closed the connection: ${why}`),
      },
      lineCap,
      options.frameCap ?? DOC_FRAME_CAP,
    );
    socket.on('data', (chunk: Buffer) => splitter.push(chunk));
    socket.on('error', (error) => this.log(`socket error: ${error.message}`));
    socket.on('close', (hadError) => {
      this.dead = true;
      this.closedWith = hadError;
      for (const listener of this.closeListeners) listener(hadError);
    });
    if (leftover.length > 0) splitter.push(leftover);
  }

  // True when the line was handed to a live socket; false when the port is closing or closed, or when this write
  // stalled the peer past the cap (the connection is then destroyed with the line still buffered, so it never leaves).
  postMessage(message: unknown): boolean {
    return this.write(`${encodeJsonLine(message)}\n`);
  }

  // P3-A M5 start: a document frame for `channel`, under postMessage's rules.
  postDoc(channel: number, frame: Uint8Array): boolean {
    return this.write(encodeDocFrame(channel, frame));
  }

  onDoc(listener: DocListener): void {
    this.docListeners.push(listener);
  }

  // What this end has written that the peer has not yet taken (the host's high-water check before a frame).
  queuedBytes(): number {
    return this.socket.writableLength;
  }
  // P3-A M5 end

  private write(bytes: string | Buffer): boolean {
    if (this.dead || this.draining || !this.socket.writable) return false;
    this.socket.write(bytes);
    if (this.socket.writableLength <= this.writableCap) return true;
    this.fail(`closed the connection: the peer stalled ${this.socket.writableLength} bytes behind`);
    return false;
  }

  start(): void {
    const queued = this.queue;
    if (!queued) return;
    this.queue = null;
    for (const delivery of queued) delivery();
  }

  on(_event: 'message', listener: MessageListener): this {
    this.listeners.push(listener);
    return this;
  }

  onClose(listener: (hadError: boolean) => void): void {
    const closedWith = this.closedWith;
    if (closedWith === null) this.closeListeners.push(listener);
    else queueMicrotask(() => listener(closedWith));
  }

  close(options: { drain?: boolean } = {}): void {
    if (this.dead || this.draining) return;
    if (options.drain) this.draining = true;
    else this.dead = true;
    this.socket.end();
    const timer = setTimeout(() => this.socket.destroy(), CLOSE_GRACE_MS);
    timer.unref();
    this.socket.once('close', () => clearTimeout(timer));
  }

  private receive(line: string): void {
    if (this.dead) return;
    let data: unknown;
    try {
      data = decodeJsonLine(line);
    } catch {
      this.fail('closed the connection: a line that is not JSON');
      return;
    }
    const restored = restoreUndefined(data);
    this.enqueue(() => this.deliver(restored));
  }

  private enqueue(delivery: () => void): void {
    if (this.dead) return;
    if (this.queue) this.queue.push(delivery);
    else delivery();
  }

  private deliver(data: unknown): void {
    if (this.dead) return;
    for (const listener of this.listeners) listener({ data });
  }

  private deliverDoc(channel: number, frame: Uint8Array): void {
    if (this.dead) return;
    for (const listener of this.docListeners) listener(channel, frame);
  }

  private fail(reason: string): void {
    if (this.dead) return;
    this.log(reason);
    this.dead = true;
    this.socket.destroy();
  }
}

// JSON has no `undefined`: a void command's `input` and a void answer's `value` lose their key on the way, while C1's
// envelope requires both keys (a MessagePort's structured clone keeps them). They are restored here. Nothing else on
// the engine host's wire depends on `undefined`; a `Uint8Array` (the artifact store's bytes) crosses as base64 (P3-A M5,
// json-bytes.ts).
function restoreUndefined(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data;
  const message = data as Record<string, unknown>;
  if (message.t === 'req' && !('input' in message)) return { ...message, input: undefined };
  if (message.t === 'res' && message.ok === true && !('value' in message)) return { ...message, value: undefined };
  return data;
}
