// RL1, the endpoint's one socket to its hub (O10 M3; the remote layer's RL1, O11's Interfaces §C). While the machine is
// `org-listed` the endpoint holds one WebSocket to `GET /machine/socket` with its Access service token: `hello` with
// RL1's protocol, its build and its ref; the hub's `welcome` with the connection's generation and heartbeat; `hb` every
// heartbeat, which renews the machine's lease in every project the connection opened; the hub's `state {version}`
// notices; DX2's log plane per project; the machine's signed `listing` and `endpoint` records and its `notify`, up; and
// the channel multiplex, `[u8 type][u32 channel][payload]` binary messages whose channels only an app opens.
//
// It survives every cut the hub makes. A connection that drops, misses two `hb-ack`s or hears nothing for three
// heartbeats is opened again, backing off with jitter from 1 s to 30 s, reset by a welcome that held for a minute. The
// hub's verdicts on an upgrade or a close (P5 Decision Log 41) decide the rest: `503` tries again with the backoff, `409
// stale-generation` at once; `409 not-listed` (a rename) and `409 no-ref` stop it (`re-enroll`), as do `403
// not-enrolled` and a `4403` close (`revoked`); a `4409` (replaced) reconnects once, and a second within a minute stops
// it (`replaced`): another daemon holds this machine's key, and a retry loop would only fight it. Reading a refused
// upgrade's status and body is why the socket is `ws`'s: Node's global WebSocket reports a refusal as a bare error.
//
// A hub deploy need not cut the socket (O11 M8 saw hibernated sockets survive one), so nothing here waits on a reconnect
// to learn of a change: a frame of a kind this endpoint doesn't know is ignored with one log line per kind, and the
// welcome is read for the fields it needs. Nothing logs a credential or a frame's body.
import {
  CHANNEL_CLOSE,
  CHANNEL_HEADER_BYTES,
  closeReasonName,
  decodeChannelFrame,
  encodeChannelFrame,
  RL1_MESSAGE_LIMIT,
  RL1_PROTOCOL,
  type ChannelCloseReason,
  type EndpointRecord,
  type Listing,
  type NotifyFrame,
  type Rl1Refusal,
  type Signed,
} from 'org-protocol';
import { MACHINE_SOCKET_PATH, PartAssembler, toWire, type Part } from 'desk-hub/protocol';
import WebSocket, { type RawData } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Credentials } from './hub-http';

/** Why the link stopped for good, as `status().refusing` says it: each needs the machine's owner, not a retry. */
export type HubStop = 're-enroll' | 'revoked' | 'replaced';

/** Where the link connects: the enrollment's hub and credentials, and the machine's ref; null while it holds none. */
export type HubTarget = { hub: string; credentials: Credentials; ref: string };

/** What the rest of the module hears from the link, each call made in the link's own order. */
export type HubLinkHooks = {
  /** A connection was welcomed: its generation and the heartbeat it keeps. */
  welcome?(welcome: { generation: number; heartbeatMs: number }): void;
  /** The connection ended (it may be opened again). */
  ended?(): void;
  /** The org state advanced to `version` at the hub. */
  state?(version: number): void;
  /** The hub refused a text frame and kept the socket (`listing`, `endpoint`, `notify`, a log-plane frame). */
  refusal?(refusal: Rl1Refusal): void;
  /** The link stopped for good. */
  stopped?(reason: HubStop): void;
};

/** A project the connection opens on the log plane: its `hello` (sent on each connection) and its down frames. */
export type LogProject = {
  /** The hello's fields beside `t` and `project`, read each time it is sent. */
  hello(): { name: string; have: Record<string, number>; follow?: boolean };
  /** The hub's `have`, `events`, `resend` and `refused` for the project, one at a time, in the order they came. */
  down(frame: { t: string; project: string } & Record<string, unknown>): void | Promise<void>;
};

/** The channel multiplex's side at the endpoint (M4): what an app opened, sent and closed. */
export type ChannelHandler = {
  opened(channel: number, payload: Uint8Array): void;
  data(channel: number, payload: Uint8Array): void;
  /** `endpoint-gone` when the connection carrying it ended. */
  closed(channel: number, reason: ChannelCloseReason | null): void;
};

/** The text frames the endpoint sends up, beside the log plane's. */
export type HubUpFrame = { t: 'listing'; record: Signed<Listing> } | { t: 'endpoint'; record: Signed<EndpointRecord> } | NotifyFrame;

export const RECONNECT_MIN_MS = 1000;
export const RECONNECT_MAX_MS = 30_000;
/** A welcome that held this long resets the backoff. */
export const STEADY_MS = 60_000;
/** A second replacement within this long of the first stops the link (`replaced`). */
export const REPLACED_WINDOW_MS = 60_000;
/** How long an upgrade and its welcome may take before the attempt is given up. */
export const OPEN_MS = 15_000;
/** The heartbeat a welcome that names none is kept at: the deployed hub's. */
export const DEFAULT_HEARTBEAT_MS = 15_000;
/** The most of a refused upgrade's body read for its verdict. */
const VERDICT_BYTES = 64 * 1024;

/** The wait before attempt `attempt` (0, 1, …) opens again: from 1 s doubling to 30 s, each with up to half its length off. */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** Math.min(attempt, 16));
  return Math.round(ceiling * (0.5 + 0.5 * random()));
}

/** How a connection or its attempt ended. */
type Ending =
  | { kind: 'refused'; status: number; error: string }
  | { kind: 'closed'; code: number; reason: string }
  | { kind: 'dead'; why: string }
  | { kind: 'failed'; why: string };

/** The next step after an ending: a wait (0 at once), or a stop. */
type Next = { wait: number } | { stop: HubStop };

type Attempt = {
  socket: WebSocket;
  ending: Ending | null;
  welcomed: boolean;
  welcomedAt: number;
  generation: number;
  heartbeatMs: number;
  lastHeard: number;
  unacked: number;
  /** The kind of the last frame sent, for a close that names a frame (1009, 4412). */
  lastSent: string;
  parts: PartAssembler;
  channels: Set<number>;
  timers: Array<ReturnType<typeof setTimeout>>;
  beat: ReturnType<typeof setInterval> | null;
};

export type HubLinkOptions = {
  target(): HubTarget | null;
  /** `mawsd`'s build id, as the hello names it. */
  build: string;
  log(line: string): void;
  hooks?: HubLinkHooks;
  now?(): number;
  random?(): number;
};

export class HubLink {
  readonly #options: HubLinkOptions;
  readonly #hooks: HubLinkHooks;
  readonly #now: () => number;
  readonly #projects = new Map<string, LogProject>();
  readonly #queues = new Map<string, Promise<void>>();
  readonly #unknown = new Set<string>();
  #channels: ChannelHandler | null = null;
  #running = false;
  #stopped: HubStop | null = null;
  #attempt: Attempt | null = null;
  #retry: ReturnType<typeof setTimeout> | null = null;
  /** Failed or short-lived attempts since the last welcome that held. */
  #failures = 0;
  #lastGeneration = 0;
  #replacedAt: number | null = null;
  /** The last wait was an at-once retry after `stale-generation`: the next one backs off. */
  #retriedAtOnce = false;

  constructor(options: HubLinkOptions) {
    this.#options = options;
    this.#hooks = options.hooks ?? {};
    this.#now = options.now ?? Date.now;
  }

  /** Whether a connection is welcomed now. */
  get connected(): boolean {
    return this.#attempt?.welcomed === true;
  }

  /** The welcomed connection's generation. */
  get generation(): number | undefined {
    return this.#attempt?.welcomed ? this.#attempt.generation : undefined;
  }

  get running(): boolean {
    return this.#running;
  }

  /** Why the link stopped for good, or null. */
  get stopped(): HubStop | null {
    return this.#stopped;
  }

  /** Connects, and keeps a connection until `stop()` or a verdict that stops it. */
  start(): void {
    if (this.#running || this.#stopped !== null) return;
    this.#running = true;
    this.#failures = 0;
    this.#replacedAt = null;
    this.#connect();
  }

  /** Closes the connection and stops reconnecting; resolves once the socket has closed (at most a second). */
  async stop(): Promise<void> {
    this.#running = false;
    if (this.#retry !== null) clearTimeout(this.#retry);
    this.#retry = null;
    const attempt = this.#attempt;
    if (attempt === null) return;
    const closed = new Promise<void>((resolve) => {
      if (attempt.socket.readyState === WebSocket.CLOSED) return resolve();
      attempt.socket.once('close', () => resolve());
      setTimeout(resolve, 1000).unref?.();
    });
    this.#end(attempt, { kind: 'closed', code: 1000, reason: 'stopped' }, 1000);
    await closed;
  }

  /** Clears a stop for good (a new enrollment's credentials); `start()` connects again. */
  reset(): void {
    this.#stopped = null;
  }

  /** Opens `project` on the log plane: its hello now, if connected, and on every connection after. Returns its close. */
  openProject(project: string, handler: LogProject): () => void {
    this.#projects.set(project, handler);
    if (this.connected) this.#hello(project, handler);
    return () => {
      if (this.#projects.get(project) === handler) this.#projects.delete(project);
    };
  }

  /** Whether `project` is open on the log plane (a project the endpoint relays). */
  relays(project: string): boolean {
    return this.#projects.has(project);
  }

  /** Where channels go (M4); unset, an app's channel is closed as it opens. */
  setChannels(handler: ChannelHandler | null): void {
    this.#channels = handler;
  }

  /** Sends a text frame (as parts when it is over RL1's limit); false while no connection is welcomed. */
  send(frame: HubUpFrame | ({ t: 'events' | 'rejected'; project: string } & Record<string, unknown>)): boolean {
    const attempt = this.#attempt;
    if (attempt === null || !attempt.welcomed) return false;
    return this.#sendText(attempt, frame);
  }

  /** Sends `payload` on an open channel; false while it isn't open on the welcomed connection. */
  sendChannel(channel: number, payload: Uint8Array): boolean {
    if (CHANNEL_HEADER_BYTES + payload.length > RL1_MESSAGE_LIMIT) throw new RangeError(`a channel's message is at most ${RL1_MESSAGE_LIMIT - CHANNEL_HEADER_BYTES} bytes`);
    const attempt = this.#attempt;
    if (attempt === null || !attempt.welcomed || !attempt.channels.has(channel)) return false;
    return this.#sendBinary(attempt, encodeChannelFrame('data', channel, payload));
  }

  /** Closes a channel from this end. */
  closeChannel(channel: number, reason: ChannelCloseReason = 'closed'): void {
    const attempt = this.#attempt;
    if (attempt === null || !attempt.channels.delete(channel)) return;
    this.#sendBinary(attempt, encodeChannelFrame('close', channel, CHANNEL_CLOSE[reason]));
  }

  // ---- A connection -----------------------------------------------------------------------------------------------

  #connect(): void {
    this.#retry = null;
    const target = this.#options.target();
    if (!this.#running) return;
    if (target === null) {
      this.#running = false;
      return;
    }
    const url = `${target.hub.replace(/^http/, 'ws')}${MACHINE_SOCKET_PATH}`;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url, {
        headers: { 'CF-Access-Client-Id': target.credentials.clientId, 'CF-Access-Client-Secret': target.credentials.clientSecret },
        handshakeTimeout: OPEN_MS,
        maxPayload: RL1_MESSAGE_LIMIT,
        perMessageDeflate: false,
        followRedirects: false,
      });
    } catch (error) {
      // An address the socket can't be opened to at all (the enrollment's hub, malformed): tried again on the backoff.
      const wait = reconnectDelay(this.#failures++, this.#options.random);
      this.#options.log(`endpoint: the hub's socket could not be opened: ${(error as Error).message}; trying again in ${wait} ms`);
      this.#retry = setTimeout(() => this.#connect(), wait);
      return;
    }
    const attempt: Attempt = {
      socket,
      ending: null,
      welcomed: false,
      welcomedAt: 0,
      generation: 0,
      heartbeatMs: DEFAULT_HEARTBEAT_MS,
      lastHeard: this.#now(),
      unacked: 0,
      lastSent: 'hello',
      parts: new PartAssembler({ now: this.#now }),
      channels: new Set(),
      timers: [],
      beat: null,
    };
    this.#attempt = attempt;
    attempt.timers.push(setTimeout(() => this.#end(attempt, { kind: 'dead', why: `no welcome within ${OPEN_MS} ms` }), OPEN_MS));
    socket.on('unexpected-response', (request, response) => void this.#refused(attempt, request, response));
    socket.on('open', () => {
      this.#sendText(attempt, { t: 'hello', protocol: RL1_PROTOCOL, build: this.#options.build, machine: target.ref, ...(this.#lastGeneration > 0 ? { leaseGeneration: this.#lastGeneration } : {}) });
    });
    socket.on('message', (data, isBinary) => this.#message(attempt, data, isBinary));
    // A failed upgrade or a broken socket: its close follows, and decides.
    socket.on('error', (error) => {
      if (attempt.ending === null) attempt.ending = { kind: 'failed', why: error.message };
    });
    socket.on('close', (code, reason) => this.#closed(attempt, code, reason.toString()));
  }

  /** An upgrade answered with a status other than 101: its `{error}` read (bounded), then the attempt ended. */
  async #refused(attempt: Attempt, request: { destroy(): void }, response: IncomingMessage): Promise<void> {
    const text = await readBounded(response, VERDICT_BYTES, 5000);
    let error = response.statusCode === 401 ? 'access' : 'refused';
    try {
      const said = (JSON.parse(text) as { error?: unknown }).error;
      if (typeof said === 'string') error = said;
    } catch {
      // not a JSON answer (Access's own page, a proxy's): the status alone
    }
    attempt.ending = { kind: 'refused', status: response.statusCode ?? 0, error };
    request.destroy();
    attempt.socket.terminate();
  }

  #message(attempt: Attempt, data: RawData, isBinary: boolean): void {
    if (this.#attempt !== attempt || attempt.ending !== null) return;
    attempt.lastHeard = this.#now();
    const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
    if (isBinary) return this.#binary(attempt, bytes);
    let frame: unknown;
    try {
      frame = JSON.parse(bytes.toString('utf8'));
    } catch {
      return this.#once('unparseable', 'endpoint: the hub sent a text message that is not JSON; ignored');
    }
    if (!isFrame(frame)) return this.#once('shapeless', 'endpoint: the hub sent a frame with no kind; ignored');
    if (frame.t === 'part') {
      try {
        frame = attempt.parts.add(frame as unknown as Part);
      } catch (error) {
        return this.#options.log(`endpoint: a frame the hub sent as parts was dropped: ${(error as Error).message}`);
      }
      if (frame === undefined) return;
      if (!isFrame(frame)) return this.#once('shapeless', 'endpoint: the hub sent a frame with no kind; ignored');
    }
    this.#text(attempt, frame);
  }

  #text(attempt: Attempt, frame: Frame): void {
    if (frame.t === 'welcome') return this.#welcomed(attempt, frame);
    if (!attempt.welcomed) return this.#once(`early:${frame.t}`, `endpoint: the hub sent \`${frame.t}\` before its welcome; ignored`);
    switch (frame.t) {
      case 'hb-ack':
        attempt.unacked = 0;
        return;
      case 'state':
        if (Number.isSafeInteger(frame.version) && (frame.version as number) >= 1) this.#hooks.state?.(frame.version as number);
        return;
      case 'refusal':
        return this.#hooks.refusal?.(frame as unknown as Rl1Refusal);
      case 'have':
      case 'events':
      case 'resend':
      case 'refused':
        return this.#down(frame);
      default:
        return this.#once(frame.t, `endpoint: the hub sent a \`${frame.t}\` frame, which this endpoint doesn't know; ignored`);
    }
  }

  /** The welcome, read for what it needs: a generation, and a heartbeat (the deployed hub's when it names none). */
  #welcomed(attempt: Attempt, frame: Frame): void {
    if (attempt.welcomed) return;
    if (!Number.isSafeInteger(frame.generation) || (frame.generation as number) < 1) {
      return this.#end(attempt, { kind: 'dead', why: 'a welcome with no generation' }, 4400);
    }
    const heartbeat = typeof frame.heartbeat_ms === 'number' && Number.isFinite(frame.heartbeat_ms) && frame.heartbeat_ms > 0 ? frame.heartbeat_ms : DEFAULT_HEARTBEAT_MS;
    for (const timer of attempt.timers) clearTimeout(timer);
    attempt.timers = [];
    attempt.welcomed = true;
    attempt.welcomedAt = this.#now();
    attempt.generation = frame.generation as number;
    attempt.heartbeatMs = Math.min(300_000, Math.max(100, heartbeat));
    attempt.unacked = 0;
    this.#lastGeneration = attempt.generation;
    this.#retriedAtOnce = false;
    attempt.beat = setInterval(() => this.#beat(attempt), attempt.heartbeatMs);
    this.#options.log(`endpoint: connected to the hub (generation ${attempt.generation})`);
    for (const [project, handler] of this.#projects) this.#hello(project, handler);
    this.#hooks.welcome?.({ generation: attempt.generation, heartbeatMs: attempt.heartbeatMs });
  }

  /** One heartbeat: the connection is dead after two unanswered `hb`s or three heartbeats with nothing heard. */
  #beat(attempt: Attempt): void {
    if (attempt.unacked >= 2) return this.#end(attempt, { kind: 'dead', why: 'two heartbeats went unanswered' });
    if (this.#now() - attempt.lastHeard >= 3 * attempt.heartbeatMs) return this.#end(attempt, { kind: 'dead', why: 'nothing heard for three heartbeats' });
    attempt.unacked++;
    this.#sendText(attempt, { t: 'hb', generation: attempt.generation });
  }

  #hello(project: string, handler: LogProject): void {
    const attempt = this.#attempt;
    if (attempt === null || !attempt.welcomed) return;
    let hello: ReturnType<LogProject['hello']>;
    try {
      hello = handler.hello();
    } catch (error) {
      return this.#options.log(`endpoint: the hello of project ${project} could not be built: ${(error as Error).message}`);
    }
    this.#sendText(attempt, { t: 'hello', project, ...hello });
  }

  /** A log-plane frame to its project's handler, behind the project's earlier ones. */
  #down(frame: Frame): void {
    const project = typeof frame.project === 'string' ? frame.project : null;
    const handler = project === null ? undefined : this.#projects.get(project);
    if (project === null || handler === undefined) return this.#once(`project:${project}`, `endpoint: the hub sent \`${frame.t}\` for a project this endpoint hasn't opened; ignored`);
    const run = (this.#queues.get(project) ?? Promise.resolve())
      .then(() => handler.down(frame as { t: string; project: string }))
      .catch((error: unknown) => this.#options.log(`endpoint: project ${project}'s \`${frame.t}\` failed: ${(error as Error).message}`));
    this.#queues.set(project, run);
    void run.then(() => {
      if (this.#queues.get(project) === run) this.#queues.delete(project);
    });
  }

  #binary(attempt: Attempt, bytes: Uint8Array): void {
    if (!attempt.welcomed) return;
    const frame = decodeChannelFrame(bytes);
    if (frame === null) return this.#once('binary', 'endpoint: the hub sent a binary message that is not a channel frame; ignored');
    const { channel } = frame;
    const payload = frame.payload.slice();
    if (frame.type === 'open') {
      if (this.#channels === null) return void this.#sendBinary(attempt, encodeChannelFrame('close', channel, CHANNEL_CLOSE.closed));
      attempt.channels.add(channel);
      return this.#call(() => this.#channels?.opened(channel, payload));
    }
    if (frame.type === 'close') {
      if (!attempt.channels.delete(channel)) return;
      const reason = closeReasonName(payload);
      return this.#call(() => this.#channels?.closed(channel, reason));
    }
    if (!attempt.channels.has(channel)) return;
    this.#call(() => this.#channels?.data(channel, payload));
  }

  // ---- The end of a connection ------------------------------------------------------------------------------------

  #closed(attempt: Attempt, code: number, reason: string): void {
    const ending = attempt.ending ?? { kind: 'closed', code, reason };
    // An ending already decided (a refusal, a dead link, a stop) keeps its own word; a socket that failed says its code.
    this.#end(attempt, ending.kind === 'failed' && code !== 1006 ? { kind: 'closed', code, reason } : ending);
  }

  /** Ends `attempt` once: its socket closed (with `code`) or dropped, its channels ended, and the next step taken. */
  #end(attempt: Attempt, ending: Ending, code?: number): void {
    if (this.#attempt !== attempt) return;
    this.#attempt = null;
    attempt.ending = ending;
    for (const timer of attempt.timers) clearTimeout(timer);
    if (attempt.beat !== null) clearInterval(attempt.beat);
    try {
      if (code !== undefined) attempt.socket.close(code, ending.kind === 'closed' ? ending.reason : ending.kind);
      else attempt.socket.terminate();
    } catch {
      // closed already
    }
    for (const channel of attempt.channels) this.#call(() => this.#channels?.closed(channel, 'endpoint-gone'));
    attempt.channels.clear();
    if (attempt.welcomed) this.#hooks.ended?.();
    if (!this.#running) return;
    const next = this.#next(attempt, ending);
    this.#options.log(`endpoint: the hub connection ${describe(ending, attempt)}; ${'stop' in next ? `stopped (${next.stop})` : next.wait === 0 ? 'connecting again at once' : `connecting again in ${next.wait} ms`}`);
    if ('stop' in next) {
      this.#running = false;
      this.#stopped = next.stop;
      this.#hooks.stopped?.(next.stop);
      return;
    }
    this.#retry = setTimeout(() => this.#connect(), next.wait);
  }

  /** What follows an ending (P5 Decision Log 41's verdicts). */
  #next(attempt: Attempt, ending: Ending): Next {
    if (attempt.welcomed && this.#now() - attempt.welcomedAt >= STEADY_MS) this.#failures = 0;
    if (ending.kind === 'refused') {
      if (ending.status === 409 && (ending.error === 'not-listed' || ending.error === 'no-ref')) return { stop: 're-enroll' };
      if (ending.status === 403 && ending.error === 'not-enrolled') return { stop: 'revoked' };
      if (ending.status === 409 && ending.error === 'stale-generation' && !this.#retriedAtOnce) {
        this.#retriedAtOnce = true;
        return { wait: 0 };
      }
    }
    if (ending.kind === 'closed' && ending.code === 4403) return { stop: 'revoked' };
    if (ending.kind === 'closed' && ending.code === 4409) {
      const at = this.#now();
      if (this.#replacedAt !== null && at - this.#replacedAt < REPLACED_WINDOW_MS) return { stop: 'replaced' };
      this.#replacedAt = at;
      return { wait: 0 };
    }
    this.#retriedAtOnce = false;
    return { wait: reconnectDelay(this.#failures++, this.#options.random) };
  }

  // ---- Sending ----------------------------------------------------------------------------------------------------

  #sendText(attempt: Attempt, frame: { t: string } & Record<string, unknown>): boolean {
    if (attempt.socket.readyState !== WebSocket.OPEN) return false;
    try {
      for (const line of toWire(frame, RL1_MESSAGE_LIMIT)) attempt.socket.send(line);
      attempt.lastSent = frame.t;
      return true;
    } catch (error) {
      this.#options.log(`endpoint: a \`${frame.t}\` frame could not be sent: ${(error as Error).message}`);
      return false;
    }
  }

  #sendBinary(attempt: Attempt, bytes: Uint8Array): boolean {
    if (attempt.socket.readyState !== WebSocket.OPEN) return false;
    attempt.socket.send(bytes);
    attempt.lastSent = 'channel';
    return true;
  }

  // ---- Helpers ----------------------------------------------------------------------------------------------------

  /** One log line per kind of oddity, for the link's life. */
  #once(kind: string, line: string): void {
    if (this.#unknown.has(kind)) return;
    this.#unknown.add(kind);
    this.#options.log(line);
  }

  #call(run: () => void): void {
    try {
      run();
    } catch (error) {
      this.#options.log(`endpoint: a channel handler failed: ${(error as Error).message}`);
    }
  }
}

type Frame = { t: string } & Record<string, unknown>;
const isFrame = (value: unknown): value is Frame => typeof value === 'object' && value !== null && !Array.isArray(value) && typeof (value as { t?: unknown }).t === 'string';

const CLOSE_NAMES: Record<number, string> = { 4409: 'replaced', 4403: 'revoked', 4412: 'parts lost', 4400: 'a protocol error', 1009: 'a message too large', 1011: 'the hub failed' };

function describe(ending: Ending, attempt: Attempt): string {
  switch (ending.kind) {
    case 'refused':
      return `was refused: ${ending.status} ${ending.error}`;
    case 'dead':
      return `was given up: ${ending.why}`;
    case 'failed':
      return `failed: ${ending.why}`;
    case 'closed': {
      const name = CLOSE_NAMES[ending.code];
      // A frame too large or lost in parts names the kind of the frame last sent, the one it most likely was.
      const frame = ending.code === 1009 || ending.code === 4412 ? ` after a \`${attempt.lastSent}\` frame` : '';
      return `closed: ${ending.code}${name === undefined ? '' : ` (${name})`}${ending.reason === '' ? '' : ` ${ending.reason}`}${frame}`;
    }
  }
}

/** A response's body as text, at most `limit` bytes of it, within `ms`. */
function readBounded(response: IncomingMessage, limit: number, ms: number): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const done = () => {
      clearTimeout(timer);
      response.removeAllListeners('data');
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const timer = setTimeout(done, ms);
    response.on('data', (chunk: Buffer) => {
      if (size >= limit) return;
      chunks.push(chunk.subarray(0, limit - size));
      size += chunk.length;
      if (size >= limit) done();
    });
    response.on('end', done);
    response.on('error', done);
  });
}
