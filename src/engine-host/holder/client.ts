// One authenticated connection to a session host (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, Interfaces §A):
// connect, `auth`, the host's `hello`; then the host's items (validated control lines and output records) to one
// listener, in arrival order. Items that arrive before the listener is set are kept for it, so a handshake can await a
// control line (`expect`) and hand the rest of the stream on without a gap.
import { connect, type Socket } from 'node:net';
import { controlLine, HostMessageSchema, HostStreamDecoder, HostStreamError, SESSION_HOST_PROTOCOL, type ClientMessage, type Hello, type HostMessage } from './protocol';

export type HostEvent = { kind: 'control'; message: HostMessage } | { kind: 'record'; stream: 'out' | 'err'; seq: number; data: Buffer };

export class HostConnectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostConnectError';
  }
}

const CONNECT_RETRY_MS = 25;

export class HostConnection {
  private readonly decoder = new HostStreamDecoder();
  private readonly kept: HostEvent[] = [];
  private listener: ((event: HostEvent) => void) | null = null;
  private waiter: (() => void) | null = null;
  private closedWith: string | null = null;
  private readonly closeListeners: ((why: string) => void)[] = [];

  private constructor(private readonly socket: Socket, private readonly log: (line: string) => void) {
    socket.on('data', (chunk: Buffer) => {
      let items;
      try {
        items = this.decoder.push(chunk);
      } catch (error) {
        this.destroy(error instanceof HostStreamError ? error.message : String(error));
        return;
      }
      for (const item of items) {
        if (item.kind === 'record') this.deliver(item);
        else {
          const parsed = HostMessageSchema.safeParse(item.message);
          if (parsed.success) this.deliver({ kind: 'control', message: parsed.data });
          else this.log(`session host: an unknown or malformed line ignored: ${JSON.stringify(item.message).slice(0, 160)}`);
        }
      }
    });
    socket.on('error', (error) => this.destroy(error.message));
    socket.on('close', () => this.destroy('the connection closed'));
  }

  // Connects to `path` (retried until `deadline`, epoch ms, while `gone` does not say the host is gone: a host just
  // spawned listens within milliseconds), authenticates and waits for `hello`, which must speak this protocol major.
  static async open(path: string, token: string, opts: { deadline: number; gone?: () => string | null; log: (line: string) => void }): Promise<{ connection: HostConnection; hello: Hello }> {
    for (;;) {
      const gone = opts.gone?.() ?? null;
      if (gone !== null) throw new HostConnectError(gone);
      let socket: Socket;
      try {
        socket = await new Promise<Socket>((resolve, reject) => {
          const s = connect(path);
          s.once('connect', () => {
            s.off('error', reject);
            resolve(s);
          });
          s.once('error', reject);
        });
      } catch (error) {
        if (Date.now() >= opts.deadline) throw new HostConnectError(`no session host answered at ${path}: ${(error as Error).message}`);
        await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_MS));
        continue;
      }
      const connection = new HostConnection(socket, opts.log);
      connection.send({ t: 'auth', token });
      const hello = await connection.expect('hello', opts.deadline).catch((error: unknown) => {
        connection.close();
        throw error;
      });
      if (hello.protocol !== SESSION_HOST_PROTOCOL) {
        connection.close();
        throw new HostConnectError(`the session host speaks protocol ${hello.protocol}, not ${SESSION_HOST_PROTOCOL}`);
      }
      return { connection, hello };
    }
  }

  get closed(): boolean {
    return this.closedWith !== null;
  }

  send(message: ClientMessage): void {
    this.write(controlLine(message));
  }

  write(data: Buffer): void {
    if (this.closedWith === null) this.socket.write(data);
  }

  // The first kept control line of type `t` (what came before it stays kept); rejects on `refused`, on the connection's
  // close, or at `deadline`.
  async expect<T extends HostMessage['t']>(t: T, deadline: number): Promise<Extract<HostMessage, { t: T }>> {
    for (;;) {
      const at = this.kept.findIndex((e) => e.kind === 'control' && (e.message.t === t || e.message.t === 'refused'));
      if (at !== -1) {
        const [event] = this.kept.splice(at, 1) as [{ kind: 'control'; message: HostMessage }];
        if (event.message.t === 'refused' && t !== 'refused') throw new HostConnectError(`the session host refused the attach (${event.message.reason})`);
        return event.message as Extract<HostMessage, { t: T }>;
      }
      if (this.closedWith !== null) throw new HostConnectError(`the session host closed the connection before ${t}: ${this.closedWith}`);
      const left = deadline - Date.now();
      if (left <= 0) throw new HostConnectError(`no ${t} from the session host in time`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiter = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      this.waiter = null;
    }
  }

  // From now on every item goes to `listener`, those kept first.
  listen(listener: (event: HostEvent) => void): void {
    this.listener = listener;
    for (const event of this.kept.splice(0)) listener(event);
  }

  onClose(listener: (why: string) => void): void {
    if (this.closedWith !== null) listener(this.closedWith);
    else this.closeListeners.push(listener);
  }

  // Ends the connection once what was written has been flushed.
  end(): void {
    this.socket.end();
  }

  close(): void {
    this.destroy('closed by the engine host');
  }

  private deliver(event: HostEvent): void {
    if (this.listener) this.listener(event);
    else {
      this.kept.push(event);
      this.waiter?.();
    }
  }

  private destroy(why: string): void {
    if (this.closedWith !== null) return;
    this.closedWith = why;
    this.socket.destroy();
    this.waiter?.();
    for (const listener of this.closeListeners.splice(0)) listener(why);
  }
}
