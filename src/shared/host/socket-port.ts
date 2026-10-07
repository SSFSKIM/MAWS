// A HostPort over a connected Unix socket (E10 execution document, Interfaces "The socket port"), so C1's runtime
// serves a socket exactly as it serves a MessagePort, and main's side speaks the envelope over the same class. One JSON
// value per line. Like a MessagePort, received messages queue until `start()`; the handshake reader's leftover bytes
// (what it read past the hello) are delivered first. A line that is not JSON, a line over the cap, or a peer stalled
// past the writable cap closes the connection with a log line; a write after the close is dropped. A draining close
// (main's deliberate one at a keep-quit, E11) writes nothing more but still delivers what the peer wrote before it saw
// the end, until the peer closes (or the grace runs out): the host, which ends its side at the client's end and refuses
// every write after it, then counts nothing delivered that the client did not read.
import type { Socket } from 'node:net';
import type { HostPort } from './runtime';
import { LINE_CAP, splitLines, WRITABLE_CAP } from './socket-protocol';

export interface SocketPortOptions {
  lineCap?: number;
  writableCap?: number;
  log?: (line: string) => void;
}

// How long close() waits for the peer to finish the close before it destroys the socket.
const CLOSE_GRACE_MS = 1_000;

type MessageListener = (event: { data: unknown }) => void;

export class SocketPort implements HostPort {
  private readonly listeners: MessageListener[] = [];
  private readonly closeListeners: ((hadError: boolean) => void)[] = [];
  private queue: unknown[] | null = []; // null once started
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
    const splitter = splitLines(
      (line) => this.receive(line),
      () => this.fail(`closed the connection: a line over ${lineCap} bytes`),
      lineCap,
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
    if (this.dead || this.draining || !this.socket.writable) return false;
    this.socket.write(`${JSON.stringify(message)}\n`);
    if (this.socket.writableLength <= this.writableCap) return true;
    this.fail(`closed the connection: the peer stalled ${this.socket.writableLength} bytes behind`);
    return false;
  }

  start(): void {
    const queued = this.queue;
    if (!queued) return;
    this.queue = null;
    for (const data of queued) this.deliver(data);
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

  private receive(line: string): void | 'stop' {
    if (this.dead) return 'stop';
    let data: unknown;
    try {
      data = JSON.parse(line);
    } catch {
      this.fail('closed the connection: a line that is not JSON');
      return 'stop';
    }
    data = restoreUndefined(data);
    if (this.queue) this.queue.push(data);
    else this.deliver(data);
  }

  private deliver(data: unknown): void {
    if (this.dead) return;
    for (const listener of this.listeners) listener({ data });
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
// the engine host's wire depends on `undefined` or on a non-JSON value (only the pty host's `Uint8Array`s do, and the
// pty host never runs detached).
function restoreUndefined(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data;
  const message = data as Record<string, unknown>;
  if (message.t === 'req' && !('input' in message)) return { ...message, input: undefined };
  if (message.t === 'res' && message.ok === true && !('value' in message)) return { ...message, value: undefined };
  return data;
}
