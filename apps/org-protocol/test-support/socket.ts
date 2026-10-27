// What the reference client's three sockets share: opening a WebSocket to the hub with the caller's Access headers,
// keeping every frame in order, joining a frame the hub sent as parts, and waiting for the frame a caller names.
//
// The hub sends a text frame over 1 MiB as numbered parts (`{t: 'part', id, index, count, data}`), each a slice of the
// frame's JSON text (desk-hub's `toWire`); the receiver joins a set once all its parts are in, in any order.

export type Headers = Record<string, string>;
export type Part = { t: 'part'; id: string; index: number; count: number; data: string };
export type Frame = { t: string } & Record<string, unknown>;

/** Joins the hub's parts into the frame they carry; anything else passes through as it is. */
export class PartJoiner {
  private readonly sets = new Map<string, Array<string | undefined>>();

  /** The whole frame once `frame` completes its set (or is not a part), else undefined. */
  add(frame: Frame): Frame | undefined {
    if (frame.t !== 'part') return frame;
    const { id, index, count, data } = frame as unknown as Part;
    const slices = this.sets.get(id) ?? new Array<string | undefined>(count).fill(undefined);
    this.sets.set(id, slices);
    slices[index] = data;
    if (slices.some((slice) => slice === undefined)) return undefined;
    this.sets.delete(id);
    return JSON.parse(slices.join('')) as Frame;
  }
}

/** `http(s)://…` → `ws(s)://…`. */
export const socketUrl = (base: string, path: string) => `${base.replace(/\/$/, '').replace(/^http/, 'ws')}${path}`;

/** A WebSocket to `url` with `headers` (Node's WebSocket, undici's, takes headers in place of the protocols argument),
 * not yet open. */
export function newSocket(url: string, headers: Headers): WebSocket {
  const socket = new WebSocket(url, { headers } as unknown as string[]);
  socket.binaryType = 'arraybuffer';
  return socket;
}

/**
 * Resolves once `socket` is open; a refused upgrade rejects, naming `what`, and so does one unanswered past `ms`, the
 * socket closed while connecting (which fails it: it never opens): a caller's bound holds however far the server got.
 */
export function opened(socket: WebSocket, what: string, ms: number): Promise<WebSocket> {
  let unanswered: ReturnType<typeof setTimeout> | undefined;
  return new Promise<WebSocket>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(socket));
    socket.addEventListener('error', () => reject(new Error(`the ${what} socket was refused`)));
    unanswered = setTimeout(() => {
      reject(new Error(`the ${what} socket's upgrade went unanswered for ${ms} ms`));
      socket.close();
    }, ms);
  }).finally(() => clearTimeout(unanswered));
}

/** Opens a WebSocket with `headers` and resolves once it is open (`opened`). */
export function openSocket(url: string, headers: Headers, what: string, ms: number): Promise<WebSocket> {
  return opened(newSocket(url, headers), what, ms);
}

/** Waits until `probe` answers something other than undefined; throws naming `what` past `ms`. */
export async function until<T>(probe: () => T | undefined, what: string, ms = 10_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** A JSON socket: every whole frame kept in order, and how it closed once it has. */
export class JsonSocket {
  readonly frames: Frame[] = [];
  /** The size in bytes of every text message the socket carried, parts included. */
  readonly wire: number[] = [];
  ended: { code: number; reason: string } | undefined;
  private readonly parts = new PartJoiner();
  protected readonly socket: WebSocket;

  protected constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      this.wire.push(new TextEncoder().encode(event.data).length);
      const whole = this.parts.add(JSON.parse(event.data) as Frame);
      if (whole !== undefined) this.received(whole);
    });
    socket.addEventListener('close', (event) => (this.ended = { code: event.code, reason: event.reason }));
  }

  /** Each whole frame as it arrives; a subclass keeps its own view of it too. */
  protected received(frame: Frame): void {
    this.frames.push(frame);
  }

  /** The first frame from index `from` on that `predicate` takes. */
  next(predicate: (frame: Frame) => boolean, what: string, from = 0, ms = 10_000): Promise<Frame> {
    return until(() => {
      const found = this.frames.slice(from).find(predicate);
      if (found === undefined && this.ended) throw new Error(`the socket closed (${this.ended.code} ${this.ended.reason}) before ${what}`);
      return found;
    }, what, ms);
  }

  /**
   * Waits for the frame that says the socket is ready to use. When the wait fails (a timeout, a close), the socket is
   * closed before the failure is thrown: its opener never receives it, so nothing else could close it.
   */
  protected async untilReady(predicate: (frame: Frame) => boolean, what: string, ms: number): Promise<void> {
    try {
      await this.next(predicate, what, 0, ms);
    } catch (error) {
      this.close();
      throw error;
    }
  }

  send(frame: object): void {
    this.socket.send(JSON.stringify(frame));
  }

  close(): void {
    this.socket.close(1000, 'done');
  }
}
