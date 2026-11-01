// Streams (P5 O7 M3, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Streams", "The pty stream" and
// "Forwarding", Interfaces §N; RL §4.8): byte flows inside a device's channel, each opened under an act the device sent,
// behind `rl2.streams`. Two planes: `pty` (a terminal's output and input, the pty host's) and `tcp` (one connection to a
// forwarded port of the machine's loopback, forwards.ts).
//
// Admission. A caller who doesn't hold the kind's grade (`shell`) now is refused `grade` before anything else is read, so
// it learns nothing of the op it names. `streamOpen {id, kind, op}` names the authorizing act's opId. The act's executor's ledger is read for it
// (the pty host's, `pty.opQuery`, for `pty`; the endpoint's own for `tcp`), without a tombstone: it must answer `done`
// with a binding of this channel's member and device and a name the kind allows (STREAM_ACTS), and the act's kept result
// must name the pty or forward the open names; else `grade` (`unknown` for an op the ledger holds nothing of, and for a
// forward past its window: a fresh act may open it; `unavailable` when the ledger can't say now). Then, after every read
// the opening makes (the ring, the connect) and before anything crosses, the binding is authorized as a query is
// (authorize.ts's `stream`, `decide`): the member still holds the act's machine grade (`shell`), the device is still the
// head's; one decided while a re-check began is decided again, so a grant ended during the opening opens nothing. Step-up and the rest of the act's decision stood when the act ran, so a reopen under it asks
// nothing of the person. A ledger keeps an op for a day (KEPT_S); a stream reopened past that needs a new act. The ledger
// is read as of now (its `opCreated`), since the horizon bounds an act's resends, not what its binding authorizes.
//
// Credit. Each direction goes within the other side's credit: the device's, given at open and refunded by
// `streamCredit` (at most STREAM_CREDIT_MAX), bounds what the endpoint sends, counted in decoded bytes; the endpoint's,
// STREAM_INPUT_CREDIT at `streamOpened` and refunded as it writes, bounds the device's (past it: `malformed`). Data goes in
// chunks of at most STREAM_CHUNK_BYTES, through the channel's stream window (stream-window.ts), so control messages never
// wait behind a stream.
//
// A pty stream reads the ring through `pty.replay {ptyId, from}` at its open (the pty host's offsets, independent of any
// viewer's checkpoint) and sends `[max(from, ringStart), nextOffset)`, then each later `pty.data` frame of that pty at its
// offset (`onFrame`), frames from before the replay's answer trimmed against it. Output past the device's credit is held
// up to STREAM_BACKLOG_BYTES (the ring's size), and then the stream closes `behind`: the device reopens from its last
// offset and the ring fills the gap; frames that come while the ring is read count against the same bound, and past it the
// stream opens and closes `behind` at once. The pty's own flow control is untouched (the endpoint takes no credit, `mawsd`'s
// seam). Input is written through `pty.write` in order; the endpoint keeps the next input offset per `(device, ptyId,
// inputEpoch)` while a stream holds it and for RESUME_MS after, drops what it already wrote (a resend after a reopen), and
// forgets an older epoch when a new one opens. An epoch it holds no record of (new, or lost to a restart) starts at the
// device's `inputSent`, the end of what it already sent: a resend of that is dropped, since nothing here says whether it
// was written (zero for an app run's first stream).
// Bytes are UTF-8 to `pty.write`'s string, a character split across chunks or reopens written whole. A write the pty host
// refused closes the stream `unavailable` with the offset short of its chunk, unrefunded, so the reopen's resend is
// written; one whose outcome is unknown (thrown, timed out, the host gone) closes it `unavailable` with the offset past
// the chunk, so the resend is dropped: input is at most once, since a doubled Enter runs a command twice where a lost
// keystroke shows as a missing echo. Resize is `streamControl {resize: {cols, rows}}`, through `pty.resize`. A pty that
// exits closes its streams `exit` after the output they hold.
//
// A tcp stream connects to `127.0.0.1:<port>` at its open, and to `[::1]:<port>` once when that is refused (a server
// bound to `localhost` on ::1 alone); `streamOpened` after the connect, `unreachable` when neither connects,
// and ends whole with either side's close (the device's resets the socket at once: nothing could carry what it still
// sends). The socket is paused while the device's credit is out, so its own flow
// control holds the peer (it is never closed `behind`).
//
// A stream dies with its channel (a tcp socket reset, a pty stream dropped: the device reopens it on its next channel
// from its offsets, under the same act). Open streams, and the forwards the table keeps, are authorized again at every
// refresh of the members' rights (channels.ts's `caps` refresh: a grant kept, an owner changed, a new head): one whose
// member no longer holds the grade closes `removed` at once, its held input dropped, its forward removed and its socket
// reset. While a check runs (one hold however many overlap), its output and input wait. Streams carry no liveness of their own.
import { createConnection, type Socket } from 'node:net';
import { TextDecoder } from 'node:util';
import {
  MAX_STREAMS,
  STREAM_CHUNK_BYTES,
  STREAM_CREDIT_MAX,
  type DeviceStreamMessage,
  type EndpointMessage,
  type RefusalReason,
  type StreamControlMessage,
  type StreamDataMessage,
  type StreamKind,
  type StreamOpenMessage,
  type StreamRefusal,
} from 'org-protocol';
import type { AuthorizeRequest, Decision, StreamBinding, Who } from './authorize';
import type { RemoteChannel } from './channels';
import type { EndpointActions } from './endpoint-actions';
import { forwardOf } from './endpoint-actions';
import type { Forward, Forwards } from './forwards';
import { RESUME_MS } from './interest';
import { dispatchAs, type EndpointServices } from './services';
import { RECHECK_RETRY_MS, TRANSMIT_DEADLINE_MS } from './subscriptions';
import { StreamWindow, type StreamSource } from './stream-window';

/** Output held past the device's credit, at most; a pty stream past it closes `behind` (the pty host's ring is as large). */
export const STREAM_BACKLOG_BYTES = 512 * 1024;
/** The credit the endpoint gives a stream for the device's bytes, refunded as they are written. */
export const STREAM_INPUT_CREDIT = 256 * 1024;
/** The acts a stream of each kind opens under. */
export const STREAM_ACTS: Readonly<Record<StreamKind, readonly string[]>> = { pty: ['pty.spawn', 'pty.attach'], tcp: ['forward.open'] };
/** The largest terminal a resize sets. */
const RESIZE_MAX = 10_000;

export type StreamsContext = {
  authorize(request: AuthorizeRequest, who: Who, now: number): Promise<Decision>;
  dispatch: EndpointServices['dispatch'];
  own: Pick<EndpointActions, 'query'>;
  forwards: Forwards;
  now(): number;
  log(line: string): void;
  /** The suites' seams: how a tcp stream connects, the input epochs' window, the re-check's retries, a stuck send's deadline. */
  connect?(port: number, host: Loopback): Socket;
  resumeMs?: number;
  recheckRetryMs?: readonly number[];
  transmitDeadlineMs?: number;
};

type Queued = { offset: number; bytes: Uint8Array } | { close: string };

/** An open past its ledger read: what it opens and on whose behalf, its placeholder in the table, and how it takes its place. */
type Opening = { channel: RemoteChannel; m: StreamOpenMessage; act: string; binding: StreamBinding; who: Who; placeholder: Stream; install(stream: Stream): void };

/** An act's ledger answer, as a stream's admission reads it. */
type Ledgered = { kind: 'done'; member: string; device: string; name: string; outcome: unknown } | { kind: 'refused'; reason: StreamRefusal };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** One stream of one channel: its output queue under the device's credit, and its input under the endpoint's. */
abstract class Stream implements StreamSource {
  /** Answered `streamOpened`: data flows. */
  opened = false;
  #ended = false;
  #credit: number;
  readonly #queue: Queued[] = [];
  #backlog = 0;
  #held = false;
  #release: (() => void) | null = null;
  #gate: Promise<void> = Promise.resolve();
  /** What the device may still send. */
  #inputCredit = 0;
  #refund = 0;

  constructor(
    readonly id: string,
    readonly channel: RemoteChannel,
    readonly act: string,
    readonly binding: StreamBinding,
    credit: number,
    protected readonly window: StreamWindow,
    private readonly over: (stream: Stream) => void,
  ) {
    this.#credit = Math.min(credit, STREAM_CREDIT_MAX);
  }

  get ended(): boolean {
    return this.#ended || this.channel.closed;
  }

  get backlog(): number {
    return this.#backlog;
  }

  /** The stream's answer: `streamOpened`, the device's input credit given. */
  open(fields: { pty?: Record<string, unknown> }): void {
    this.opened = true;
    this.#inputCredit = STREAM_INPUT_CREDIT;
    this.channel.send({ t: 'streamOpened', id: this.id, ...fields, credit: STREAM_INPUT_CREDIT } as EndpointMessage);
  }

  /** Output at `offset`, queued for the device's credit. */
  push(offset: number, bytes: Uint8Array): void {
    if (this.ended || bytes.byteLength === 0) return;
    this.#queue.push({ offset, bytes });
    this.#backlog += bytes.byteLength;
    this.queued();
    if (!this.ended) this.window.ready(this);
  }

  /** The stream closes with `reason` once what it holds is sent. */
  closeAfter(reason: string): void {
    if (this.ended) return;
    this.#queue.push({ close: reason });
    this.window.ready(this);
  }

  credit(bytes: number): void {
    this.#credit = Math.min(this.#credit + bytes, STREAM_CREDIT_MAX);
    this.window.ready(this);
  }

  /**
   * Its access is checked again: nothing goes either way until a current decision grants it. One hold however many
   * checks overlap (a check superseded by a newer one is never answered), released by the latest one's grant.
   */
  hold(): void {
    if (this.#held) return;
    this.#held = true;
    this.#gate = new Promise((resolve) => (this.#release = resolve));
  }

  unhold(): void {
    if (!this.#held) return;
    this.#held = false;
    this.#release?.();
    this.#release = null;
    this.window.ready(this);
  }

  /** Resolves once no re-check holds the stream. */
  get gate(): Promise<void> {
    return this.#gate;
  }

  /** The device's chunk counted against its input credit: false when it is over (the stream is then closed `malformed`). */
  take(bytes: number): boolean {
    this.#inputCredit -= bytes;
    if (this.#inputCredit >= 0) return true;
    this.end('malformed');
    return false;
  }

  /** `bytes` of the device's taken off the stream (written, or dropped as a resend): refunded in batches. */
  refund(bytes: number): void {
    this.#refund += bytes;
    this.#inputCredit += bytes;
    if (this.#refund < STREAM_INPUT_CREDIT / 4 && !this.idle()) return;
    if (!this.ended) this.channel.send({ t: 'streamCredit', id: this.id, bytes: this.#refund });
    this.#refund = 0;
  }

  /** The stream window's turn: its next chunk the device's credit allows, or its close once it holds nothing before it. */
  next(): { message: EndpointMessage; bytes: number } | null {
    if (this.ended || this.#held || this.#queue.length === 0) return null;
    const head = this.#queue[0];
    if ('close' in head) {
      this.#queue.shift();
      const message: EndpointMessage = { t: 'streamClose', id: this.id, reason: head.close };
      this.#finish();
      return { message, bytes: 64 };
    }
    if (this.#credit <= 0) return null;
    const n = Math.min(head.bytes.byteLength, STREAM_CHUNK_BYTES, this.#credit);
    const chunk = head.bytes.subarray(0, n);
    const offset = head.offset;
    if (n === head.bytes.byteLength) this.#queue.shift();
    else this.#queue[0] = { offset: offset + n, bytes: head.bytes.subarray(n) };
    this.#credit -= n;
    this.#backlog -= n;
    this.drained();
    const data = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('base64url');
    return { message: { t: 'streamData', id: this.id, offset, data } as EndpointMessage, bytes: data.length + 96 };
  }

  /** The stream ends now with `reason`, told to the device unless `reason` is null (the device closed it, or its channel). */
  end(reason: string | null): void {
    if (this.#ended) return;
    if (reason !== null && !this.channel.closed) this.channel.send({ t: 'streamClose', id: this.id, reason });
    this.#finish();
  }

  #finish(): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#queue.length = 0;
    this.#backlog = 0;
    this.#release?.();
    this.#release = null;
    this.closed();
    this.over(this);
  }

  /** Output was queued (a pty past its backlog closes `behind`). */
  protected queued(): void {}
  /** Output was sent (a paused socket reads again). */
  protected drained(): void {}
  /** Whether no input waits to be written (a refund then goes at once). */
  protected abstract idle(): boolean;
  /** Its plane lets go (a socket reset, a pty's frames no longer routed here). */
  protected abstract closed(): void;
  abstract input(m: StreamDataMessage): void;
  abstract control(m: StreamControlMessage): void;
  /** The device closed it. */
  abstract closedByDevice(): void;
}

/** What the endpoint keeps of one device's input to one pty: the epoch, the next offset, the decoder, the write order. */
/** `carry`: the bytes of a UTF-8 character the last written chunk began and didn't finish, written with the next. */
type InputRecord = { epoch: string; next: number; carry: Uint8Array; chain: Promise<void>; holders: number; forget: (() => void) | null };

/** A failed host answer that may come after the write ran: the request timed out, or the host went away with it. */
const OUTCOME_UNKNOWN = new Set(['timeout', 'host_unavailable']);

class PtyStream extends Stream {
  /** The next output offset the device is owed; earlier bytes of a frame are trimmed. */
  sent = 0;
  /** Frames that came while the ring was read, applied after it. */
  pending: Array<{ offset: number; data: Uint8Array }> | null = [];
  #pendingBytes = 0;
  /** More than the backlog came while the ring was read: the frames are dropped, and the stream closes `behind` once open. */
  overrun = false;
  /** The pty exited while the stream opened. */
  exited = false;
  #writing = 0;

  constructor(
    id: string,
    channel: RemoteChannel,
    act: string,
    binding: StreamBinding,
    credit: number,
    window: StreamWindow,
    over: (stream: Stream) => void,
    readonly ptyId: string,
    readonly record: InputRecord,
    private readonly host: EndpointServices['dispatch'],
    private readonly log: (line: string) => void,
  ) {
    super(id, channel, act, binding, credit, window, over);
  }

  /** A `pty.data` frame of its pty, at the pty host's offset. */
  frame(offset: number, data: Uint8Array): void {
    if (this.ended) return;
    if (this.pending !== null) {
      if (this.overrun) return;
      this.#pendingBytes += data.byteLength;
      if (this.#pendingBytes <= STREAM_BACKLOG_BYTES) return void this.pending.push({ offset, data });
      this.overrun = true;
      this.pending = [];
      return;
    }
    const end = offset + data.byteLength;
    if (end <= this.sent) return;
    const start = Math.max(0, this.sent - offset);
    this.push(offset + start, data.subarray(start));
    this.sent = end;
  }

  protected override queued(): void {
    if (this.backlog > STREAM_BACKLOG_BYTES) this.end('behind');
  }

  protected idle(): boolean {
    return this.#writing === 0;
  }

  protected closed(): void {
    this.pending = null;
  }

  /**
   * The device's input, written in order. A write the pty host refused ends the stream `unavailable` with the chunk
   * unrefunded and the record short of it, so the reopen's resend is written. A write whose outcome is unknown (it threw,
   * timed out, or the host went away with it) moves the record and its decoder past the chunk first, so the resend is
   * dropped: at most once.
   */
  input(m: StreamDataMessage): void {
    const bytes = Buffer.from(m.data, 'base64url');
    if (!this.take(bytes.byteLength)) return;
    const record = this.record;
    this.#writing++;
    let landed = true;
    record.chain = record.chain
      .then(() => this.gate)
      .then(async () => {
        if (this.ended) return;
        const end = m.offset + bytes.byteLength;
        if (m.offset > record.next) return this.end('malformed'); // a gap: bytes the device never sent here
        if (end <= record.next) return; // a resend of what was written
        const { text, carry } = utf8Cut(record.carry, bytes.subarray(record.next - m.offset));
        if (text !== '') {
          const written = await this.host('pty-host', 'pty.write', { ptyId: this.ptyId, data: text }).catch((error: unknown) => {
            [record.next, record.carry] = [end, carry];
            throw error;
          });
          if (!written.ok) {
            if (OUTCOME_UNKNOWN.has(written.error.code)) [record.next, record.carry] = [end, carry];
            throw new Error(written.error.code);
          }
        }
        record.next = end;
        record.carry = carry;
      })
      .catch((error: unknown) => {
        landed = false;
        this.log(`endpoint: a remote terminal's input could not be written: ${(error as Error).message}`);
        this.end('unavailable');
      })
      .finally(() => {
        this.#writing--;
        if (landed) this.refund(bytes.byteLength);
      });
  }

  control(m: StreamControlMessage): void {
    const resize = m.control.resize;
    const size = (v: unknown) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= RESIZE_MAX;
    if (!isObject(resize) || !size(resize.cols) || !size(resize.rows) || Object.keys(m.control).length !== 1) return this.end('malformed');
    void this.gate.then(async () => {
      if (this.ended) return;
      const answer = await this.host('pty-host', 'pty.resize', { ptyId: this.ptyId, cols: resize.cols, rows: resize.rows });
      if (!answer.ok) this.log(`endpoint: a remote terminal could not be resized: ${answer.error.code}`);
    });
  }

  closedByDevice(): void {
    this.end(null);
  }
}

class TcpStream extends Stream {
  socket: Socket | null = null;
  #out = 0;
  #in = 0;
  #writing = 0;
  #paused = false;

  constructor(id: string, channel: RemoteChannel, act: string, binding: StreamBinding, credit: number, window: StreamWindow, over: (stream: Stream) => void, readonly forward: Forward) {
    super(id, channel, act, binding, credit, window, over);
  }

  /** The connection made: its bytes to the device, its end the stream's. */
  attach(socket: Socket): void {
    this.socket = socket;
    socket.on('data', (data: Buffer) => {
      this.push(this.#out, data);
      this.#out += data.byteLength;
    });
    socket.on('end', () => this.closeAfter('closed'));
    socket.on('close', () => this.closeAfter('closed'));
    socket.on('error', () => {});
  }

  protected override queued(): void {
    if (this.backlog >= STREAM_CHUNK_BYTES && !this.#paused) {
      this.#paused = true;
      this.socket?.pause();
    }
  }

  protected override drained(): void {
    if (this.#paused && this.backlog < STREAM_CHUNK_BYTES) {
      this.#paused = false;
      this.socket?.resume();
    }
  }

  protected idle(): boolean {
    return this.#writing === 0;
  }

  protected closed(): void {
    const socket = this.socket;
    if (socket !== null && !socket.destroyed) socket.resetAndDestroy();
  }

  input(m: StreamDataMessage): void {
    const bytes = Buffer.from(m.data, 'base64url');
    if (!this.take(bytes.byteLength)) return;
    if (m.offset !== this.#in) return this.end('malformed');
    this.#in += bytes.byteLength;
    this.#writing++;
    void this.gate.then(() => {
      if (this.ended || this.socket === null) return;
      this.socket.write(bytes, () => {
        this.#writing--;
        this.refund(bytes.byteLength);
      });
    });
  }

  control(): void {
    this.end('malformed');
  }

  /** The device's side closed: the stream is gone, so nothing could carry what the machine's side still sends: reset now. */
  closedByDevice(): void {
    this.end(null);
  }
}

export class Streams {
  readonly #ctx: StreamsContext;
  readonly #channels = new Map<RemoteChannel, Map<string, Stream>>();
  readonly #windows = new Map<RemoteChannel, StreamWindow>();
  /** Each pty's open streams, for its frames and its exit. */
  readonly #byPty = new Map<string, Set<PtyStream>>();
  /** Each device's input to each pty (`<device>\n<ptyId>`). */
  readonly #inputs = new Map<string, InputRecord>();
  /** Re-checks begun per stream or forward: only the latest one's verdict is taken. */
  readonly #checks = new Map<unknown, number>();
  /** Counts `recheck` calls, so a decision asked while one began is asked again (`decide`). */
  #epoch = 0;
  /** The pty host's restarts as its last `pty.hostState` counted them; null before the first. */
  #hostRestarts: number | null = null;
  /** The pty host's last state was `crashed`: it runs no terminal this endpoint can reach until it is `ready` again. */
  #hostCrashed = false;
  readonly #offRemoved: () => void;

  constructor(ctx: StreamsContext) {
    this.#ctx = ctx;
    // A forward removed (its member lost `shell`) or forgotten takes its connections with it.
    this.#offRemoved = ctx.forwards.onRemoved((forward) => {
      for (const streams of this.#channels.values())
        for (const stream of streams.values()) if (stream instanceof TcpStream && stream.forward === forward) stream.end('removed');
    });
  }

  /** The channel's stream messages. */
  receive(channel: RemoteChannel, m: DeviceStreamMessage): void {
    if (channel.closed) return;
    if (m.t === 'streamOpen') return void this.#open(channel, m);
    const stream = this.#channels.get(channel)?.get(m.id);
    if (stream === undefined || stream.ended) return;
    switch (m.t) {
      case 'streamData':
        if (!stream.opened) return stream.end('malformed');
        return stream.input(m);
      case 'streamControl':
        return stream.control(m);
      case 'streamCredit':
        return stream.credit(m.bytes);
      case 'streamClose':
        return stream.closedByDevice();
    }
  }

  /** A pty's output frame (`onFrame`). */
  frame(frame: { ptyId: string; offset: number; data: Uint8Array }): void {
    for (const stream of this.#byPty.get(frame.ptyId) ?? []) stream.frame(frame.offset, frame.data);
  }

  /**
   * The pty host's events: a pty that exits closes its streams `exit` after what they hold. `pty.hostState` (mawsd's
   * supervisor's state of the pty host) tells the host's loss from a reconnect to it: a transition that counts one more
   * restart is the process gone, and every pty with it, so each stream closes `exit` at once (no status: the device reads
   * it as lost); so does `crashed` (the supervisor gave up on it, no successor follows), and until the host is `ready`
   * again a pty stream's open is refused `unknown`, which the device's reopen for the exit's status takes as final;
   * `ready` is the host reached again, whose ptys are listed, a stream on one it no longer runs closing likewise (a new
   * process, or an exit the reconnect's gap hid), the others kept.
   */
  event(owner: string, message: { name: string; payload: unknown }): void {
    if (owner !== 'pty-host' || !isObject(message.payload)) return;
    const payload = message.payload;
    if (message.name === 'pty.exit' && isText(payload.ptyId)) return this.#exited([...(this.#byPty.get(payload.ptyId) ?? [])]);
    if (message.name !== 'pty.hostState') return;
    const restarts = Number.isSafeInteger(payload.restarts) ? (payload.restarts as number) : null;
    const died = restarts !== null && this.#hostRestarts !== null && restarts > this.#hostRestarts;
    if (restarts !== null) this.#hostRestarts = restarts;
    this.#hostCrashed = payload.state === 'crashed' || (this.#hostCrashed && payload.state !== 'ready');
    if (died || payload.state === 'crashed') this.#exited([...this.#byPty.values()].flatMap((set) => [...set]));
    if (payload.state === 'ready') void this.#revalidate();
  }

  /** Streams whose pty is gone: closed `exit` after what they hold (one still opening, once open). */
  #exited(streams: readonly PtyStream[]): void {
    for (const stream of streams) {
      if (stream.pending !== null) stream.exited = true;
      else stream.closeAfter('exit');
    }
  }

  /** The pty host reached again: the streams of a pty it no longer runs end; a list it can't answer leaves them. */
  async #revalidate(): Promise<void> {
    const held = [...this.#byPty].map(([ptyId, set]) => [ptyId, [...set]] as const);
    if (held.length === 0) return;
    const listed = await this.#ctx.dispatch('pty-host', 'pty.list', undefined);
    if (!listed.ok) return this.#ctx.log(`endpoint: the pty host's terminals could not be listed after it was reached again: ${listed.error.code}`);
    const ptys: unknown[] = isObject(listed.value) && Array.isArray(listed.value.ptys) ? listed.value.ptys : [];
    const running = new Set(ptys.flatMap((p) => (isObject(p) && isText(p.ptyId) && p.alive !== false ? [p.ptyId] : [])));
    for (const [ptyId, streams] of held) if (!running.has(ptyId)) this.#exited(streams);
  }

  /**
   * The members' rights may have changed (a grant kept or ended, an owner changed, a new head): every open stream and
   * every kept forward is authorized again, and one no longer granted ends `removed` (a forward: removed, its streams with it).
   */
  recheck(): void {
    this.#epoch++;
    for (const streams of this.#channels.values()) for (const stream of streams.values()) if (stream.opened && !stream.ended) this.#recheckStream(stream);
    for (const forward of this.#ctx.forwards.list()) this.checkForward(forward);
  }

  /** A forward authorized again: removed, its streams with it, once its member no longer holds `shell`. */
  checkForward(forward: Forward): void {
    const binding = { member: forward.member, device: forward.device };
    this.#check(forward, 'forward.open', binding, { ...binding, clientClass: forward.clientClass }, (verdict) => verdict === 'refused' && this.#ctx.forwards.remove(forward.device, forward.id));
  }

  /** An open stream authorized again, held while the check runs; ended `removed` (its forward too) once refused. */
  #recheckStream(stream: Stream): void {
    stream.hold();
    this.#check(stream, stream.act, stream.binding, this.#who(stream.channel), (verdict) => {
      if (verdict === 'granted') return stream.unhold();
      if (stream instanceof TcpStream && verdict === 'refused') this.#ctx.forwards.remove(stream.forward.device, stream.forward.id);
      stream.end(verdict === 'refused' ? 'removed' : 'unavailable');
    });
  }

  /** Every stream ended and every socket reset (the endpoint stops). */
  stop(): void {
    this.#offRemoved();
    for (const streams of this.#channels.values()) for (const stream of [...streams.values()]) stream.end(null);
    this.#channels.clear();
    this.#windows.clear();
    for (const record of this.#inputs.values()) record.forget?.();
    this.#inputs.clear();
  }

  // ---- Admission ---------------------------------------------------------------------------------------------------

  async #open(channel: RemoteChannel, m: StreamOpenMessage): Promise<void> {
    const refuse = (reason: StreamRefusal) => void (channel.closed || channel.send({ t: 'streamRefused', id: m.id, reason } as EndpointMessage));
    let streams = this.#channels.get(channel);
    if (streams === undefined) {
      const mine = new Map<string, Stream>();
      streams = mine;
      this.#channels.set(channel, mine);
      this.#windows.set(channel, new StreamWindow(channel, { deadlineMs: this.#ctx.transmitDeadlineMs ?? TRANSMIT_DEADLINE_MS, log: this.#ctx.log }));
      channel.onClose(() => this.#channelClosed(channel, mine));
    }
    if (streams.has(m.id)) return refuse('malformed');
    if (streams.size >= MAX_STREAMS) return refuse('busy');
    // The id is the open's from here on: a second open of it is `malformed`, a `streamClose` cancels it.
    const placeholder = new Cancelled(m.id, channel, this.#windows.get(channel)!, (s) => this.#forget(s));
    streams.set(m.id, placeholder);
    try {
      const who = this.#who(channel);
      // The caller's own standing first: one below the kind's grade learns nothing of the op it names, and no ledger is read.
      const floor = await this.#ctx.authorize({ kind: 'stream', name: STREAM_ACTS[m.kind][0], input: { member: who.member, device: who.device } }, who, this.#ctx.now());
      if (placeholder.ended) return;
      if (!floor.ok) return refuse(floor.reason === 'unavailable' ? 'unavailable' : 'grade');
      const ledgered = m.kind === 'pty' ? await this.#ptyLedger(m.op, channel) : this.#ownLedger(m.op);
      if (placeholder.ended) return;
      if (ledgered.kind === 'refused') return refuse(ledgered.reason);
      if (ledgered.member !== who.member || ledgered.device !== who.device || !STREAM_ACTS[m.kind].includes(ledgered.name)) return refuse('grade');
      const named = m.kind === 'pty' ? ptyOf(ledgered.name, ledgered.outcome) : forwardOf(ledgered.outcome);
      if (named === null || named !== (m.kind === 'pty' ? m.pty!.ptyId : m.tcp!.forward)) return refuse('grade');
      const binding: StreamBinding = { member: ledgered.member, device: ledgered.device };
      // The stream takes the open's place in the table as it answers, so what the device sends next reaches it.
      const install = (stream: Stream) => void (streams.get(m.id) === placeholder && streams.set(m.id, stream));
      const open = { channel, m, act: ledgered.name, binding, who, placeholder, install };
      if (m.kind === 'pty') await this.#openPty(open);
      else await this.#openTcp(open);
    } catch (error) {
      this.#ctx.log(`endpoint: a stream on channel ${channel.key} could not be opened: ${(error as Error).message}`);
      refuse('unavailable');
    } finally {
      if (streams.get(m.id) === placeholder) streams.delete(m.id);
    }
  }

  /**
   * A stream's binding decided against the rights now, and on a grant `publish` run in the same synchronous step as the
   * check that no re-check began meanwhile: nothing a re-check could miss happens between them, so what `publish` makes
   * (a stream installed and opened, a forward) is either seen by every later re-check or never made. A decision a
   * re-check overtook is asked again; `unavailable` after three. The endpoint asks it before a forward is made too, since
   * the `forward.open` act was decided before its effect ran.
   */
  async decide<R>(act: string, binding: StreamBinding, who: Who, publish: () => R): Promise<{ ok: true; value: R } | { ok: false; reason: RefusalReason }> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const epoch = this.#epoch;
      const decision = await this.#ctx.authorize({ kind: 'stream', name: act, input: binding }, who, this.#ctx.now());
      if (epoch !== this.#epoch) continue;
      return decision.ok ? { ok: true, value: publish() } : decision;
    }
    return { ok: false, reason: 'unavailable' };
  }

  /** The pty host's ledger, read for the act's binding and result. */
  async #ptyLedger(op: string, channel: RemoteChannel): Promise<Ledgered> {
    const answer = await dispatchAs(this.#ctx.dispatch, channel.client)('pty-host', 'pty.opQuery', { opId: op, opCreated: new Date(this.#ctx.now()).toISOString(), tombstoneIfAbsent: false });
    if (!answer.ok || !isObject(answer.value)) return { kind: 'refused', reason: 'unavailable' };
    return ledgered(answer.value);
  }

  /** The endpoint's own ledger (`forward.open`). */
  #ownLedger(op: string): Ledgered {
    return ledgered(this.#ctx.own.query(op, new Date(this.#ctx.now()).toISOString(), false));
  }

  async #openPty({ channel, m, act, binding, who, placeholder, install }: Opening): Promise<void> {
    const { ptyId, from, inputEpoch, inputFrom, inputSent } = m.pty!;
    const refuse = (reason: StreamRefusal) => void (channel.closed || channel.send({ t: 'streamRefused', id: m.id, reason } as EndpointMessage));
    // A crashed host runs no pty this endpoint reaches: final for the device (its terminal ends as lost), not a retry.
    if (this.#hostCrashed) return refuse('unknown');
    const dispatch = dispatchAs(this.#ctx.dispatch, channel.client);
    const record = this.#input(binding.device, ptyId, inputEpoch, inputFrom, inputSent ?? inputFrom);
    const stream = new PtyStream(m.id, channel, act, binding, m.credit, this.#windows.get(channel)!, (s) => this.#forget(s), ptyId, record, dispatch, this.#ctx.log);
    // Frames from now on are held while the ring is read, then trimmed against it.
    let set = this.#byPty.get(ptyId);
    if (set === undefined) this.#byPty.set(ptyId, (set = new Set()));
    set.add(stream);
    const fail = (reason: StreamRefusal | null) => {
      stream.end(null);
      if (reason !== null) refuse(reason);
    };
    const [listed, replayed] = await Promise.all([dispatch('pty-host', 'pty.list', undefined), dispatch('pty-host', 'pty.replay', { ptyId, from })]);
    if (placeholder.ended || channel.closed) return fail(null);
    if (!listed.ok) return fail(unavailableOr(listed, 'unknown'));
    if (!replayed.ok) return fail(unavailableOr(replayed, 'unknown'));
    const info = (isObject(listed.value) && Array.isArray(listed.value.ptys) ? listed.value.ptys : []).find((p: unknown) => isObject(p) && p.ptyId === ptyId) as Record<string, unknown> | undefined;
    const replay = isObject(replayed.value) ? replayed.value : {};
    const bytes = replay.replay instanceof Uint8Array ? replay.replay : null;
    if (info === undefined || bytes === null || !Number.isSafeInteger(replay.replayFrom) || !Number.isSafeInteger(replay.nextOffset)) return fail('unknown');
    const ringStart = replay.replayFrom as number;
    const nextOffset = replay.nextOffset as number;
    // An offset past what the pty has emitted is none the device read from it.
    if (from > nextOffset) return fail('malformed');
    // The binding decided now, after every read and before anything crosses, and the stream published in the same step:
    // a grant ended while the ring was read, or before the publication, opens nothing.
    const decided = await this.decide(act, binding, who, () => {
      if (placeholder.ended || channel.closed || stream.ended) return false;
      install(stream);
      stream.open({ pty: { info, ringStart, nextOffset } });
      // Past the backlog while the ring was read: open and at once `behind`, the device reopening from its offset.
      if (stream.overrun) {
        stream.end('behind');
        return true;
      }
      stream.push(ringStart, bytes);
      stream.sent = nextOffset;
      const pending = stream.pending ?? [];
      stream.pending = null;
      for (const frame of pending) stream.frame(frame.offset, frame.data);
      if (stream.exited || info.alive === false) stream.closeAfter('exit');
      return true;
    });
    if (!decided.ok) return fail(decided.reason === 'unavailable' ? 'unavailable' : 'grade');
    if (!decided.value) fail(null);
  }

  async #openTcp({ channel, m, act, binding, who, placeholder, install }: Opening): Promise<void> {
    const refuse = (reason: StreamRefusal) => void (channel.closed || channel.send({ t: 'streamRefused', id: m.id, reason } as EndpointMessage));
    const forward = this.#ctx.forwards.hold(binding.device, m.tcp!.forward, channel);
    if (forward === null) return refuse('unknown');
    const connect = this.#ctx.connect ?? connectLoopback;
    // 127.0.0.1, then ::1 once only when that was refused (Node 17+ servers bound to `localhost`, Vite's among them, often
    // listen on ::1 alone); the answer is the last attempt's. A cancelled opening starts no further attempt.
    let socket: Socket | null = null;
    for (const host of LOOPBACKS) {
      if (placeholder.ended || channel.closed) return;
      const attempt = connect(forward.port, host);
      const outcome = await new Promise<string>((resolve) => {
        attempt.once('connect', () => resolve('connected'));
        attempt.once('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? 'error'));
      });
      if (outcome === 'connected') {
        socket = attempt;
        break;
      }
      attempt.destroy();
      if (outcome !== 'ECONNREFUSED') break;
    }
    if (socket === null) return refuse('unreachable');
    // The connection may end while the binding is decided (its listeners come with the stream): such an open is
    // `unreachable`, never a live stream on a dead socket.
    let lost = false;
    socket.once('close', () => (lost = true));
    socket.on('error', () => {});
    const decided = await this.decide(act, binding, who, (): StreamRefusal | 'gone' | null => {
      if (placeholder.ended || channel.closed) return 'gone';
      if (lost || socket.destroyed) return 'unreachable';
      if (this.#ctx.forwards.get(forward.device, forward.id) !== forward) return 'unknown';
      const stream = new TcpStream(m.id, channel, act, binding, m.credit, this.#windows.get(channel)!, (s) => this.#forget(s), forward);
      install(stream);
      stream.attach(socket);
      stream.open({});
      return null;
    });
    const refusal = decided.ok ? decided.value : decided.reason === 'unavailable' ? 'unavailable' : 'grade';
    if (refusal === null) return;
    if (!socket.destroyed) socket.resetAndDestroy();
    if (refusal !== 'gone') refuse(refusal);
  }

  /**
   * The device's input record for a pty: kept for its epoch. An epoch it holds no record of (a new one, or one it lost to
   * a restart or forgot past RESUME_MS) starts at the device's `inputSent`: what the device sent before may have been
   * written, and nothing here says what, so a resend of it is dropped (at most once; a fresh epoch's is 0).
   */
  #input(device: string, ptyId: string, epoch: string, inputFrom: number, inputSent: number): InputRecord {
    const key = `${device}\n${ptyId}`;
    let record = this.#inputs.get(key);
    if (record === undefined || record.epoch !== epoch) {
      record?.forget?.();
      record = { epoch, next: inputSent, carry: new Uint8Array(0), chain: Promise.resolve(), holders: 0, forget: null };
      this.#inputs.set(key, record);
    } else {
      // A reopen in the same epoch: what the endpoint wrote stands; bytes the device says it won't send again are skipped.
      record.next = Math.max(record.next, inputFrom);
    }
    record.forget?.();
    record.forget = null;
    record.holders++;
    return record;
  }

  // ---- The table -----------------------------------------------------------------------------------------------------

  #who(channel: RemoteChannel): Who {
    return { member: channel.member, device: channel.device, clientClass: channel.clientClass, client: channel.client };
  }

  /** A stream ended: out of the table, its pty's routing and its input record's holders. */
  #forget(stream: Stream): void {
    const streams = this.#channels.get(stream.channel);
    if (streams?.get(stream.id) === stream) streams.delete(stream.id);
    this.#checks.delete(stream);
    if (!(stream instanceof PtyStream)) return;
    const set = this.#byPty.get(stream.ptyId);
    set?.delete(stream);
    if (set?.size === 0) this.#byPty.delete(stream.ptyId);
    const record = stream.record;
    if (--record.holders > 0) return;
    const key = `${stream.binding.device}\n${stream.ptyId}`;
    const timer = setTimeout(() => {
      if (this.#inputs.get(key) === record && record.holders === 0) this.#inputs.delete(key);
    }, this.#ctx.resumeMs ?? RESUME_MS);
    timer.unref?.();
    record.forget = () => clearTimeout(timer);
  }

  /** A channel closed: its streams die with it, told nothing (a tcp socket reset, a pty stream dropped). */
  #channelClosed(channel: RemoteChannel, streams: Map<string, Stream>): void {
    for (const stream of [...streams.values()]) stream.end(null);
    this.#channels.delete(channel);
    this.#windows.delete(channel);
  }

  /**
   * Authorizes a stream's binding again for `who`, the latest check of `key` counting; an answer the endpoint can't give
   * now (`unavailable`) is asked again after each retry delay, and is `unanswered` after the last.
   */
  #check(key: unknown, act: string, binding: StreamBinding, who: Who, verdict: (verdict: 'granted' | 'refused' | 'unanswered') => void, attempt = 0): void {
    const n = attempt === 0 ? (this.#checks.get(key) ?? 0) + 1 : this.#checks.get(key)!;
    this.#checks.set(key, n);
    const current = () => this.#checks.get(key) === n && !(key instanceof Stream && key.ended);
    const done = (answer: 'granted' | 'refused' | 'unanswered') => {
      this.#checks.delete(key);
      verdict(answer);
    };
    this.#ctx
      .authorize({ kind: 'stream', name: act, input: binding }, who, this.#ctx.now())
      .then((decision) => {
        if (!current()) return;
        if (decision.ok) return done('granted');
        if (decision.reason !== 'unavailable') return done('refused');
        const retries = this.#ctx.recheckRetryMs ?? RECHECK_RETRY_MS;
        if (attempt >= retries.length) return done('unanswered');
        const timer = setTimeout(() => current() && this.#check(key, act, binding, who, verdict, attempt + 1), retries[attempt]);
        timer.unref?.();
      })
      .catch((error: unknown) => {
        if (!current()) return;
        this.#ctx.log(`endpoint: a stream's access could not be checked again: ${(error as Error).message}`);
        done('unanswered');
      });
  }
}

/** An open not yet answered: it holds the id, and a `streamClose` cancels it. */
class Cancelled extends Stream {
  constructor(id: string, channel: RemoteChannel, window: StreamWindow, over: (stream: Stream) => void) {
    super(id, channel, '', { member: '', device: '' }, 1, window, over);
  }
  protected idle(): boolean {
    return true;
  }
  protected closed(): void {}
  input(): void {
    this.end(null);
  }
  control(): void {}
  closedByDevice(): void {
    this.end(null);
  }
}

/** A ledger's query answer as a stream's admission reads it. */
function ledgered(value: Record<string, unknown>): Ledgered {
  if (value.state === 'not-received' || value.state === 'expired') return { kind: 'refused', reason: 'unknown' };
  if (value.state !== 'done') return { kind: 'refused', reason: 'unavailable' };
  if (!isText(value.member) || !isText(value.device) || !isText(value.name)) return { kind: 'refused', reason: 'grade' };
  return { kind: 'done', member: value.member, device: value.device, name: value.name, outcome: value.outcome };
}

/** The pty a kept `pty.spawn` or `pty.attach` result names (`{ptyId}`, `{info: {ptyId}}`), or null. */
function ptyOf(name: string, outcome: unknown): string | null {
  if (!isObject(outcome) || outcome.ok !== true || !isObject(outcome.value)) return null;
  const value = outcome.value;
  const ptyId = name === 'pty.spawn' ? value.ptyId : isObject(value.info) ? value.info.ptyId : undefined;
  return isText(ptyId) ? ptyId : null;
}

/** A failed host read's refusal: `unavailable` when the host couldn't answer, else `fallback`. */
function unavailableOr(response: { ok: false; error: { code: string } }, fallback: StreamRefusal): StreamRefusal {
  return response.error.code === 'host_unavailable' || response.error.code === 'timeout' ? 'unavailable' : fallback;
}

/** The machine's own addresses a forward connects to, in order: never another, never a name to look up. */
type Loopback = '127.0.0.1' | '::1';
const LOOPBACKS: readonly Loopback[] = ['127.0.0.1', '::1'];

function connectLoopback(port: number, host: Loopback): Socket {
  return createConnection({ host, port });
}

const UTF8 = new TextDecoder();

/**
 * `carry` and `fresh` as text up to the last whole UTF-8 character, and the bytes of one begun and not finished (at most
 * three), which wait for the next chunk. Bytes that are no UTF-8 read as U+FFFD.
 */
function utf8Cut(carry: Uint8Array, fresh: Uint8Array): { text: string; carry: Uint8Array } {
  const bytes = new Uint8Array(carry.byteLength + fresh.byteLength);
  bytes.set(carry);
  bytes.set(fresh, carry.byteLength);
  let cut = bytes.byteLength;
  for (let back = 1; back <= Math.min(3, bytes.byteLength); back++) {
    const byte = bytes[bytes.byteLength - back];
    if ((byte & 0xc0) === 0x80) continue; // a continuation byte: look further back for its lead
    const need = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    if (need > back) cut = bytes.byteLength - back;
    break;
  }
  return { text: UTF8.decode(bytes.subarray(0, cut)), carry: bytes.slice(cut) };
}
