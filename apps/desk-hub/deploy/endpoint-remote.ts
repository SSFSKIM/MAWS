// The test device's side of the endpoint acceptance run (endpoint-acceptance.ts; P5 O10 M11): its two carriers to the
// machine, RL1's multiplex through the hub (an app's Machine socket, `/api/machines/<ref>/socket`, as the owner's Access
// session) and a direct WebSocket to the endpoint's listener on the tailnet; a hostile relay (`TamperRelay`) spliced
// into either; and a device's channel with everything it received kept in order, as the endpoint's own suites hold one
// (test/endpoint/carriers.ts and sub-harness.ts, rebuilt here on Node's WebSocket so the deploy tool needs no `ws`).
//
// The direct listener limits handshakes per source address (5 a minute, burst 3, M4), and every dial the run makes from
// this machine is one source: `DirectPacer` keeps the run's own dials under that, so only the check that means to meet
// the limit does.
import { request } from 'node:http';
import { randomBytes } from 'node:crypto';
import { CHANNEL_CLOSE, closeReasonName, decodeChannelFrame, encodeChannelFrame, memoryOrgView, openTag, type Action, type ByteDuplex, type Channel, type ChannelMessage, type DeviceClass, type SignedOrgState, type SigningKey } from 'org-protocol';
import { TamperRelay, TestDevice } from 'org-protocol/test-support';
import { newSocket, opened } from '../../org-protocol/test-support/socket.ts';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One carrier's two directions, held until something listens. */
class Carrier implements ByteDuplex {
  readonly #listeners: Array<(bytes: Uint8Array) => void> = [];
  readonly #ends: Array<(reason: string) => void> = [];
  readonly #waiting: Uint8Array[] = [];
  ended = false;
  constructor(private readonly out: { send(bytes: Uint8Array): void; close(): void }) {}

  send(bytes: Uint8Array): void {
    if (!this.ended) this.out.send(bytes);
  }
  close(): void {
    if (this.ended) return;
    this.ended = true;
    this.out.close();
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

/**
 * An app's Machine socket to the hub, carrying any number of channels: a dial's first message opens its channel (the
 * hub numbers it and hands the endpoint the payload), the rest are its data, and either end's close ends it. When the
 * socket itself ends (a hub deploy may cut it), every channel on it ends `app-gone`, and `dial` opens a new socket.
 */
export class RelayDialer {
  #socket: WebSocket | null = null;
  #opening: Promise<WebSocket> | null = null;
  readonly #byTag = new Map<number, { carrier: Carrier; queue: Uint8Array[]; closing: boolean; id?: number }>();
  readonly #byId = new Map<number, Carrier>();
  #tag = 1;
  /** How many times the Machine socket ended under the run (each a cut the device saw). */
  socketEnds = 0;
  #closed = false;

  constructor(
    readonly hub: string,
    readonly machine: string,
    private readonly headers: () => Record<string, string>,
  ) {}

  async #open(): Promise<WebSocket> {
    if (this.#closed) throw new Error('the relay dialer is closed');
    if (this.#socket !== null && this.#socket.readyState === WebSocket.OPEN) return this.#socket;
    this.#opening ??= (async () => {
      const socket = newSocket(`${this.hub.replace(/^http/, 'ws')}/api/machines/${encodeURIComponent(this.machine)}/socket`, this.headers());
      socket.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') this.#frame(new Uint8Array(event.data as ArrayBuffer));
      });
      socket.addEventListener('close', () => {
        if (this.#socket === socket) {
          this.#socket = null;
          this.socketEnds++;
        }
        for (const carrier of this.#byId.values()) carrier.end('app-gone');
        this.#byId.clear();
        for (const link of this.#byTag.values()) link.carrier.end('app-gone');
        this.#byTag.clear();
      });
      await opened(socket, `Machine ${this.machine}`, 15_000);
      this.#socket = socket;
      return socket;
    })().finally(() => (this.#opening = null));
    return this.#opening;
  }

  async dial(): Promise<ByteDuplex> {
    const socket = await this.#open();
    const tag = this.#tag++;
    let opened = false;
    const link: { carrier: Carrier; queue: Uint8Array[]; closing: boolean; id?: number } = {
      queue: [],
      closing: false,
      carrier: new Carrier({
        send: (bytes) => {
          if (socket.readyState !== WebSocket.OPEN) return;
          if (!opened) {
            opened = true;
            this.#byTag.set(tag, link);
            socket.send(encodeChannelFrame('open', tag, bytes));
          } else if (link.id === undefined) link.queue.push(bytes);
          else socket.send(encodeChannelFrame('data', link.id, bytes));
        },
        close: () => {
          if (link.id === undefined) link.closing = true;
          else {
            this.#byId.delete(link.id);
            if (socket.readyState === WebSocket.OPEN) socket.send(encodeChannelFrame('close', link.id, CHANNEL_CLOSE.closed));
          }
        },
      }),
    };
    return link.carrier;
  }

  close(): void {
    this.#closed = true;
    this.#socket?.close(1000, 'done');
    this.#socket = null;
  }

  #frame(bytes: Uint8Array): void {
    const frame = decodeChannelFrame(bytes);
    if (frame === null) return;
    const socket = this.#socket;
    if (frame.type === 'open') {
      const tag = openTag(frame.payload);
      const link = tag === null ? undefined : this.#byTag.get(tag);
      if (tag === null || link === undefined) return;
      this.#byTag.delete(tag);
      link.id = frame.channel;
      for (const queued of link.queue.splice(0)) socket?.send(encodeChannelFrame('data', frame.channel, queued));
      if (link.closing) socket?.send(encodeChannelFrame('close', frame.channel, CHANNEL_CLOSE.closed));
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

/** A direct WebSocket to the endpoint's listener at `url`, opened within 15 s. */
export async function dialDirect(url: string): Promise<ByteDuplex> {
  const socket = newSocket(url, {});
  const carrier = new Carrier({ send: (bytes) => socket.send(bytes), close: () => socket.close(1000) });
  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') carrier.deliver(new Uint8Array(event.data as ArrayBuffer));
  });
  socket.addEventListener('close', (event) => carrier.end(event.reason || 'closed'));
  await opened(socket, 'direct listener', 15_000);
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

/**
 * The run's own direct dials kept under the listener's per-source limit (burst 3, then 5 a minute): a token bucket a
 * little slower than the listener's, so a dial of the run's is never `busy` unless a check spent the burst on purpose
 * (`drain`, after which the bucket waits a full refill).
 */
export class DirectPacer {
  #tokens: number;
  #at: number;
  constructor(
    private readonly burst = 3,
    private readonly everyMs = 13_000,
    private readonly now: () => number = Date.now,
    private readonly wait: (ms: number) => Promise<void> = sleep,
  ) {
    this.#tokens = burst;
    this.#at = now();
  }

  #refill(): void {
    const gained = Math.floor((this.now() - this.#at) / this.everyMs);
    if (gained <= 0) return;
    this.#tokens = Math.min(this.burst, this.#tokens + gained);
    this.#at = this.#tokens === this.burst ? this.now() : this.#at + gained * this.everyMs;
  }

  /** Waits until a dial is within the limit, and takes it. */
  async take(): Promise<void> {
    for (;;) {
      this.#refill();
      if (this.#tokens > 0) {
        this.#tokens--;
        if (this.#tokens === this.burst - 1) this.#at = this.now();
        return;
      }
      await this.wait(this.everyMs - (this.now() - this.#at) + 50);
    }
  }

  /** Waits until the whole burst is back (before a check that spends it). */
  async full(): Promise<void> {
    for (;;) {
      this.#refill();
      if (this.#tokens === this.burst) return;
      await this.wait(this.everyMs - (this.now() - this.#at) + 50);
    }
  }

  /** The burst was spent outside the pacer (the rate-limit check): nothing until it refills from now. */
  drain(): void {
    this.#tokens = 0;
    this.#at = this.now();
  }
}

/**
 * The status a WebSocket upgrade to `url` is answered with, and the body of a refusal: 101 for an accepted one (the
 * socket closed at once), or the HTTP status and body the listener refused it with (its rate limit's `503 busy`).
 * Node's WebSocket hides both, so this is the upgrade by hand.
 */
export function upgradeStatus(url: string, ms = 10_000): Promise<{ status: number; body: string }> {
  const target = new URL(url.replace(/^ws/, 'http'));
  return new Promise((resolve, reject) => {
    const req = request({
      host: target.hostname,
      port: target.port,
      path: target.pathname || '/',
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64') },
      timeout: ms,
    });
    req.once('upgrade', (_response, socket) => {
      socket.destroy();
      resolve({ status: 101, body: '' });
    });
    req.once('response', (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
    });
    req.once('timeout', () => req.destroy(new Error(`no answer to the upgrade within ${ms} ms`)));
    req.once('error', reject);
    req.end();
  });
}

// ---- a device and its channel ----------------------------------------------------------------------------------------

/** A device of the run: its id, member, class and keys (its step-up key when it holds one). */
export type RunDevice = { member: string; id: string; clientClass: DeviceClass; channel: SigningKey; stepUp?: SigningKey };

export type Msg = ChannelMessage & Record<string, unknown>;

/** A device's open channel and everything it received, in order. */
export class Remote {
  readonly inbox: Msg[] = [];
  readonly closed: Promise<string>;
  #reason: string | null = null;

  constructor(
    readonly device: TestDevice,
    readonly channel: Channel,
  ) {
    channel.onMessage((m) => {
      // A device answers the endpoint's ping (RL §4.5): a channel left silent for two of them is closed `timeout`, as
      // the run's would be while it waits on something long (a hub deploy's build).
      if ((m as Msg).t === 'ping') this.#pong((m as Msg).at as number);
      const drop = this.#drops.find((d) => d.match(m as Msg));
      if (drop !== undefined) return void drop.dropped.push(m as Msg);
      this.inbox.push(m as Msg);
    });
    this.closed = new Promise<string>((resolve) => channel.onClose((reason) => resolve((this.#reason = reason))));
  }

  #held: number[] | null = null;
  readonly #drops: Array<{ match: (m: Msg) => boolean; dropped: Msg[] }> = [];

  /**
   * Keeps every message `match` holds for from the run, by its content, and records it in `dropped`; every other
   * message passes, pings included. The relay sees only sealed frames, so a message is told apart here, on the device's
   * end of the channel, past its seal: to the endpoint, which sent it, the message is lost all the same.
   */
  dropIncoming(match: (m: Msg) => boolean): { dropped: Msg[] } {
    const drop = { match, dropped: [] as Msg[] };
    this.#drops.push(drop);
    return drop;
  }

  #pong(at: number): void {
    if (this.#held !== null) this.#held.push(at);
    else void this.channel.send({ t: 'pong', at }).catch(() => {});
  }

  /**
   * Holds the pongs (`on`), and sends those held once released: while a relay of the run's takes or alters a frame by
   * its place in the stream, the frame there is the one the run sent, never a pong. A few seconds held is well inside
   * the endpoint's two unanswered pings.
   */
  holdPongs(on: boolean): void {
    if (on) {
      this.#held ??= [];
      return;
    }
    const held = this.#held ?? [];
    this.#held = null;
    for (const at of held) this.#pong(at);
  }

  /** How the channel closed, once it has. */
  get closeReason(): string | null {
    return this.#reason;
  }

  /** The first message from `from` that `match` holds for, within `ms`; the channel's close first rejects. */
  async waitFor(match: (m: Msg) => boolean, what: string, from = 0, ms = 20_000): Promise<Msg> {
    const deadline = Date.now() + ms;
    for (;;) {
      const found = this.inbox.slice(from).find(match);
      if (found) return found;
      if (this.#reason !== null) throw new Error(`no ${what}: the channel closed (${this.#reason})`);
      if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
      await sleep(20);
    }
  }

  /** A `call`'s result: its output, or `refused <code>`. */
  async call(name: string, input: unknown, ms = 30_000): Promise<{ ok: true; output: unknown } | { ok: false; code: string }> {
    const id = randomBytes(6).toString('hex');
    const from = this.inbox.length;
    await this.channel.send({ t: 'call', id, name, input });
    const m = await this.waitFor((x) => x.t === 'result' && x.id === id, `the result of ${name}`, from, ms);
    return m.ok === true ? { ok: true, output: m.output } : { ok: false, code: String((m.error as { code?: unknown } | undefined)?.code ?? 'error') };
  }

  /** An action sent, and its `ack`'s word: `accepted`, or the refusal's reason. */
  async act(action: Action, ms = 30_000): Promise<string> {
    const from = this.inbox.length;
    await this.channel.send({ t: 'act', action });
    const m = await this.waitFor((x) => x.t === 'ack' && x.opId === action.opId, `the ack of ${action.action}`, from, ms);
    return m.state === 'accepted' ? 'accepted' : String(m.reason);
  }

  /** An accepted action's outcome, from its `done`. */
  async done(opId: string, from = 0, ms = 60_000): Promise<{ state?: string; [field: string]: unknown }> {
    return (await this.waitFor((x) => x.t === 'done' && x.opId === opId, `the done of ${opId}`, from, ms)).outcome as { state?: string };
  }

  /** A query's answer. */
  async query(opId: string, opCreated: string, executor: 'sminos' | 'engine-host' | 'endpoint', ms = 30_000): Promise<Msg> {
    const from = this.inbox.length;
    await this.channel.send({ t: 'query', opId, opCreated, executor });
    return this.waitFor((x) => x.t === 'queried' && x.opId === opId, `the answer to the query of ${opId}`, from, ms);
  }

  close(reason = 'done'): void {
    if (!this.channel.closed) this.channel.close(reason);
  }
}

/** A test device over `org`'s chain (the run's own record of the head, verified as it was signed or read). */
export function testDevice(org: string, device: RunDevice, chain: SignedOrgState[], options: { now?: () => Date; build?: string } = {}): TestDevice {
  return new TestDevice({
    identity: { org, member: device.member, device: device.id, clientClass: device.clientClass, channelKey: device.channel, build: options.build ?? 'o10-m11-acceptance', capabilities: [] },
    org: memoryOrgView({ chain: [...chain] }),
    ...(device.stepUp === undefined ? {} : { stepUpKey: device.stepUp }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

/** Opens a channel for `device` over `dial`, waiting for its `caps`. */
export async function openRemote(device: TestDevice, ref: string, dial: () => Promise<ByteDuplex>): Promise<Remote> {
  const channel = await device.open(dial, ref);
  const remote = new Remote(device, channel);
  await remote.waitFor((m) => m.t === 'caps', 'caps', 0, 20_000);
  return remote;
}
