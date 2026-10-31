// O16 M5 test support (not a test file): a fake of sminos's observer bridge (O12 M4's, which this document only names)
// on a real Unix socket, speaking OX10 as adopted (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, Interfaces §E).
// It writes what a test tells it to and keeps every frame of the exchange in both directions, in order, so the tests
// can assert on the host's answers and record the exchange as the conformance fixture O12 M4's bridge test replays.
import { createConnection, type Socket } from 'node:net';

export type GateFrame = Record<string, unknown> & { t: string };
export interface Exchanged { from: 'observer' | 'host'; frame: GateFrame }
// Where a recording test keeps every connection's exchange, in the order it happened, beside its own marks.
export interface ExchangeSink { push(row: Exchanged): unknown }

export class FakeObserver {
  readonly exchanged: Exchanged[] = [];
  private readonly received: GateFrame[] = [];
  private readonly waiters: { t: string | null; resolve: (frame: GateFrame) => void }[] = [];
  private buffer = '';
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  readonly closed: Promise<void>;
  private ended = false;

  private constructor(private readonly socket: Socket, private readonly sink: ExchangeSink | null) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      let newline: number;
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        if (line.length > 0) this.take(JSON.parse(line) as GateFrame);
      }
    });
    this.closed = new Promise((resolve) => socket.on('close', () => {
      this.ended = true;
      this.stopHeartbeat();
      resolve();
    }));
    socket.on('error', () => {});
  }

  static connect(path: string, opts: { sink?: ExchangeSink } = {}): Promise<FakeObserver> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(path);
      socket.once('connect', () => resolve(new FakeObserver(socket, opts.sink ?? null)));
      socket.once('error', reject);
    });
  }

  get isClosed(): boolean {
    return this.ended;
  }

  send(frame: GateFrame): void {
    this.keep({ from: 'observer', frame });
    this.socket.write(`${JSON.stringify(frame)}\n`);
  }

  // Several frames in one write, so the gate reads them in one chunk (a race a test pins).
  sendAll(frames: GateFrame[]): void {
    for (const frame of frames) this.keep({ from: 'observer', frame });
    this.socket.write(frames.map((f) => `${JSON.stringify(f)}\n`).join(''));
  }

  hello(session: string, opts: { pid?: number | null; childPid?: number | null } = {}): void {
    this.send({ t: 'hello', protocol: 1, session, pid: opts.pid ?? null, childPid: opts.childPid ?? null });
  }

  hb(): void {
    this.send({ t: 'hb' });
  }

  // A heartbeat every `ms` (the bridge's 5 s), until stopped or the connection ends.
  beat(ms: number): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => this.hb(), ms);
  }

  stopHeartbeat(): void {
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  // The next host frame (of type `t`, skipping others), already received or still to come; rejects after `ms`.
  next(t: string | null = null, ms = 2_000): Promise<GateFrame> {
    const index = this.received.findIndex((f) => t === null || f.t === t);
    if (index >= 0) return Promise.resolve(this.received.splice(index, 1)[0]!);
    return new Promise((resolve, reject) => {
      const waiter = { t, resolve: (frame: GateFrame) => { clearTimeout(timer); resolve(frame); } };
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error(`no ${t ?? 'frame'} from the gate within ${ms} ms (received: ${JSON.stringify(this.received)})`));
      }, ms);
      this.waiters.push(waiter);
    });
  }

  // Host frames received and not yet taken by `next`.
  pending(): GateFrame[] {
    return [...this.received];
  }

  close(): Promise<void> {
    this.stopHeartbeat();
    this.socket.end();
    return this.closed;
  }

  private keep(row: Exchanged): void {
    this.exchanged.push(row);
    this.sink?.push(row);
  }

  private take(frame: GateFrame): void {
    this.keep({ from: 'host', frame });
    const index = this.waiters.findIndex((w) => w.t === null || w.t === frame.t);
    if (index >= 0) this.waiters.splice(index, 1)[0]!.resolve(frame);
    else this.received.push(frame);
  }
}
