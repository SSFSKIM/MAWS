// The fake endpoint (O11 M6): RL1's client side, as O10's endpoint module will hold it, for the suites and for the
// staging runs (M8's measurement, acceptance 3). One WebSocket to `/machine/socket` with the machine's service token:
// `hello` with its ref, the hub's `welcome` with the generation, `hb` every `heartbeat_ms`, DX2's log plane per project,
// its signed listings and endpoint record, `notify`, and the channel multiplex, each channel's data echoed back on it
// unless the caller handles channels itself. With `reconnect`, a connection that drops is opened again, at once and then
// with backoff, under the next generation, and the projects it had opened are opened again.
import { CHANNEL_CLOSE, closeReasonName, decodeChannelFrame, encodeChannelFrame, RL1_PROTOCOL, type ChannelCloseReason, type EndpointRecord, type Listing, type NotifyKind, type Rl1Welcome, type Signed } from 'org-protocol';
import type { LogEvent, Vector } from '../src/protocol/log';
import { MACHINE_SOCKET_PATH, type DownFrame, type UpFrame } from '../src/protocol/machine';
import { PartAssembler, toWire, type Part } from '../src/protocol/parts';
import { credentialHeaders, type Credentials } from './link';

/** A text frame the hub sent: RL1's own or DX2's log plane. */
export type EndpointDown = { t: string } & Record<string, unknown>;

/** What a channel's data does at this endpoint: by default it is sent back on the channel (an echo). */
export type ChannelHandler = { opened?(channel: number, payload: Uint8Array): void; data(channel: number, payload: Uint8Array): void; closed?(channel: number, reason: ChannelCloseReason | null): void };

export type FakeEndpointOptions = {
  hub: string;
  credentials: Credentials;
  /** The machine's ref (RL DL 19), as its hello names it. */
  ref: string;
  build?: string;
  /** Open the socket again when it drops (the default is not to). */
  reconnect?: boolean;
  /** Channels handled by the caller; unset, each channel's data is echoed. */
  channels?: ChannelHandler;
  /** Whether each `welcome`'s `heartbeat_ms` is kept with `hb` (default true; a suspended endpoint's is not). */
  heartbeats?: boolean;
  /** Every connection's opening and end, and each failed reconnect, for a command's log. */
  log?: (line: string) => void;
  /** How long an upgrade may go unanswered before the attempt is given up (default 15 s). */
  openMs?: number;
};

/** How a connection ended: the WebSocket close code and reason. */
export type Ended = { code: number; reason: string; generation: number };

export class FakeEndpoint {
  /** Every text frame received, in order, across connections. */
  readonly frames: EndpointDown[] = [];
  /** Each connection's end, in order. */
  readonly ends: Ended[] = [];
  /** The channels open now, with what each received. */
  readonly channels = new Map<number, Uint8Array[]>();
  /** Each channel's close as it came: its id and reason. */
  readonly closes: Array<{ channel: number; reason: ChannelCloseReason | null }> = [];
  generation = 0;
  heartbeats: boolean;
  /** Called with each echoed payload as it arrives. */
  onData: ((channel: number, payload: Uint8Array) => void) | undefined;
  private socket: WebSocket | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private parts = new PartAssembler();
  private readonly opened = new Map<string, { name: string; have: () => Vector }>();
  private closing = false;
  private retry: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: FakeEndpointOptions) {
    this.heartbeats = options.heartbeats ?? true;
  }

  get isOpen(): boolean {
    return this.socket !== undefined;
  }

  /** Opens the socket, says hello and resolves with the `welcome`; rejects when the hub refuses or closes first. */
  async connect(): Promise<Rl1Welcome> {
    this.closing = false;
    const url = `${this.options.hub.replace(/^http/, 'ws')}${MACHINE_SOCKET_PATH}`;
    // Node's WebSocket (undici) takes headers in place of the protocols argument.
    const socket = new WebSocket(url, { headers: credentialHeaders(this.options.credentials) } as unknown as string[]);
    socket.binaryType = 'arraybuffer';
    this.parts = new PartAssembler();
    const from = this.frames.length;
    let opened = false;
    let welcomed = false;
    const openMs = this.options.openMs ?? 15_000;
    let unanswered: ReturnType<typeof setTimeout> | undefined;
    const ready = new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => {
        opened = true;
        resolve();
      });
      socket.addEventListener('error', () => reject(new Error(`RL1 socket refused at ${url}`)));
      // An upgrade the hub never answers would hold this attempt, and every reconnect after it, for good.
      unanswered = setTimeout(() => {
        reject(new Error(`RL1 upgrade unanswered for ${openMs} ms at ${url}`));
        socket.close();
      }, openMs);
    }).finally(() => clearTimeout(unanswered));
    socket.addEventListener('message', (event) => this.receive(socket, event.data as string | ArrayBuffer));
    socket.addEventListener('close', (event) => {
      if (this.socket === socket) this.lost(event.code, event.reason, opened && welcomed);
    });
    await ready;
    this.socket = socket;
    socket.send(JSON.stringify({ t: 'hello', protocol: RL1_PROTOCOL, build: this.options.build ?? 'fake-endpoint', machine: this.options.ref, ...(this.generation ? { leaseGeneration: this.generation } : {}) }));
    const welcome = (await this.next((f) => f.t === 'welcome', 'welcome', from)) as unknown as Rl1Welcome;
    welcomed = true;
    this.generation = welcome.generation;
    this.beat(welcome.heartbeat_ms);
    this.options.log?.(`connected: generation ${welcome.generation}, heartbeat ${welcome.heartbeat_ms} ms`);
    for (const [project, { name, have }] of this.opened) this.sendText({ t: 'hello', project, name, have: have() });
    return welcome;
  }

  private beat(ms: number): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (this.heartbeats) this.sendText({ t: 'hb', generation: this.generation });
    }, ms);
  }

  private lost(code: number, reason: string, welcomed: boolean): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.socket = undefined;
    this.ends.push({ code, reason, generation: this.generation });
    for (const channel of this.channels.keys()) this.options.channels?.closed?.(channel, 'endpoint-gone');
    this.channels.clear();
    this.options.log?.(`ended: ${code} ${reason} (generation ${this.generation})`);
    if (!this.options.reconnect || this.closing) return;
    let attempt = welcomed ? 0 : 1;
    const again = () => {
      this.retry = setTimeout(
        () => {
          this.connect().catch((error: unknown) => {
            this.options.log?.(`reconnect failed: ${error instanceof Error ? error.message : String(error)}`);
            attempt++;
            if (!this.closing && !this.socket) again();
          });
        },
        attempt === 0 ? 0 : Math.min(30_000, 250 * 2 ** attempt),
      );
    };
    again();
  }

  private receive(socket: WebSocket, data: string | ArrayBuffer): void {
    if (typeof data !== 'string') return this.binary(socket, data);
    let frame = JSON.parse(data) as EndpointDown;
    if (frame.t === 'part') {
      const whole = this.parts.add(frame as unknown as Part);
      if (whole === undefined) return;
      frame = whole as EndpointDown;
    }
    this.frames.push(frame);
  }

  private binary(socket: WebSocket, data: ArrayBuffer): void {
    const frame = decodeChannelFrame(data);
    if (!frame) return;
    const handler = this.options.channels;
    if (frame.type === 'open') {
      this.channels.set(frame.channel, []);
      handler?.opened?.(frame.channel, frame.payload.slice());
      return;
    }
    if (frame.type === 'close') {
      this.channels.delete(frame.channel);
      const reason = closeReasonName(frame.payload);
      this.closes.push({ channel: frame.channel, reason });
      handler?.closed?.(frame.channel, reason);
      return;
    }
    if (handler) return handler.data(frame.channel, frame.payload.slice());
    const payload = frame.payload.slice();
    this.channels.get(frame.channel)?.push(payload);
    this.onData?.(frame.channel, payload);
    // The echo: the same bytes back on the same channel.
    socket.send(data);
  }

  /** Sends one text frame (a frame over 1 MiB as parts). */
  sendText(frame: object): void {
    for (const line of toWire(frame)) this.socket?.send(line);
  }

  /** Data on a channel the hub opened. */
  sendData(channel: number, payload: Uint8Array): void {
    this.socket?.send(encodeChannelFrame('data', channel, payload));
  }

  /** Closes a channel from this end. */
  closeChannel(channel: number, reason: ChannelCloseReason = 'closed'): void {
    this.channels.delete(channel);
    this.socket?.send(encodeChannelFrame('close', channel, CHANNEL_CLOSE[reason]));
  }

  /** Opens a project on this connection (and on every later one): `hello` with the vector `have` gives, and the
   * hub's `have`. */
  async project(project: string, name: string, have: () => Vector = () => ({})): Promise<Extract<DownFrame, { t: 'have' }>> {
    this.opened.set(project, { name, have });
    const from = this.frames.length;
    this.sendText({ t: 'hello', project, name, have: have() } satisfies UpFrame);
    return (await this.next((f) => f.t === 'have' && f.project === project, `have of ${project}`, from)) as unknown as Extract<DownFrame, { t: 'have' }>;
  }

  upload(project: string, events: LogEvent[]): void {
    this.sendText({ t: 'events', project, events } satisfies UpFrame);
  }

  listing(record: Signed<Listing>): void {
    this.sendText({ t: 'listing', record });
  }

  endpointRecord(record: Signed<EndpointRecord>): void {
    this.sendText({ t: 'endpoint', record });
  }

  notify(session: string, project: string, kind: NotifyKind, pending: number): void {
    this.sendText({ t: 'notify', session, project, kind, pending });
  }

  /** Waits for a text frame from `from` on that `predicate` holds. */
  async next(predicate: (frame: EndpointDown) => boolean, what = 'frame', from = 0, ms = 10_000): Promise<EndpointDown> {
    const deadline = Date.now() + ms;
    for (;;) {
      const found = this.frames.slice(from).find(predicate);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms; received ${JSON.stringify(this.frames.slice(-6)).slice(0, 600)}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /** Drops the connection from this side (`code` 1000 unless given), as an endpoint that went away. */
  drop(code = 1000, reason = 'dropped'): void {
    this.socket?.close(code, reason);
  }

  /** Closes for good: no reconnect. */
  close(): void {
    this.closing = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.timer) clearInterval(this.timer);
    this.socket?.close(1000, 'done');
  }
}
