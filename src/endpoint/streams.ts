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
//
// P5 O7 M5b (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5 "The read open"): the read open, a `streamOpen`
// that names no `op`, of the kinds `http` and `document`, from a device that listed `rl2.read-open` (from any other,
// `malformed`). It names no act: the stream row of its kind (offers.ts' READ_OPENS) admits it, through authorization's
// eight steps with the open's kind fields as the input (authorize.ts; its refusal read as the device reads it: `malformed`,
// `unavailable`, `read-only`, else `grade`), and its kind's plane runs it (stream-base.ts' `ReadPlane`: stream-http.ts for
// `http`; `document` is M5b's next task's, refused `unavailable` until it is here). The plane publishes the stream in the
// step its decision is found to stand (`stands`), taken again once when it moved. A read stream is authorized again with
// its open's input at every refresh, as every stream is, and at every change that can move its decision (`accessMoved`:
// a record change, a relink, a linked session's new placement, after the artifact cache dropped its entry), each stream
// whose decision no longer stands decided again and ended `removed` once refused, what it holds dropped.
import { createConnection, type Socket } from 'node:net';
import { TextDecoder } from 'node:util';
import {
  MAX_STREAMS,
  STREAM_CHUNK_BYTES,
  isReadStreamKind,
  type ActStreamKind,
  type DeviceStreamMessage,
  type EndpointMessage,
  type RefusalReason,
  type StreamControlMessage,
  type StreamDataMessage,
  type ReadStreamKind,
  type StreamOpenMessage,
  type StreamRefusal,
} from 'org-protocol';
import type { AuthorizeRequest, Decision, StreamBinding, Who } from './authorize';
import type { RemoteChannel } from './channels';
import type { EndpointActions } from './endpoint-actions';
import { forwardOf } from './endpoint-actions';
import type { Forward, Forwards } from './forwards';
import { RESUME_MS } from './interest';
import { READ_OPENS } from './offers';
import { dispatchAs, type EndpointServices } from './services';
import { RECHECK_RETRY_MS, TRANSMIT_DEADLINE_MS } from './subscriptions';
import { Stream, type ReadAccess, type ReadOpening, type ReadPlane } from './stream-base';
import { httpPlane } from './stream-http';
import { StreamWindow } from './stream-window';

/** Output held past the device's credit, at most; a pty stream past it closes `behind` (the pty host's ring is as large). */
export const STREAM_BACKLOG_BYTES = 512 * 1024;
/** The acts a stream of each kind opens under. */
export const STREAM_ACTS: Readonly<Record<ActStreamKind, readonly string[]>> = { pty: ['pty.spawn', 'pty.attach'], tcp: ['forward.open'] };
/** The largest terminal a resize sets. */
const RESIZE_MAX = 10_000;

export type StreamsContext = {
  authorize(request: AuthorizeRequest, who: Who, now: number): Promise<Decision>;
  dispatch: EndpointServices['dispatch'];
  /** P5 O7 M5b: the machine's artifact endpoint, which an `http` read open's request goes to. */
  artifacts: EndpointServices['artifacts'];
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

/** An act open (`pty`, `tcp`): it names its act. */
type ActOpen = StreamOpenMessage & { kind: ActStreamKind; op: string };
/** A read open (P5 O7 M5b: `http`, `document`): it names none. */
type ReadOpen = StreamOpenMessage & { kind: ReadStreamKind };

/** An open past its ledger read: what it opens and on whose behalf, its placeholder in the table, and how it takes its place. */
type Opening = { channel: RemoteChannel; m: ActOpen; act: string; binding: StreamBinding; who: Who; placeholder: Stream; install(stream: Stream): void };

/** An open's id taken in its channel's table: its placeholder, how it answers a refusal, takes its place, and lets go of the id. */
type Taken = { placeholder: Stream; refuse(reason: StreamRefusal): void; install(stream: Stream): void; release(): void };

/** An act's ledger answer, as a stream's admission reads it. */
type Ledgered = { kind: 'done'; member: string; device: string; name: string; outcome: unknown } | { kind: 'refused'; reason: StreamRefusal };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

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
  /**
   * P5 O7 M5b: the read open's planes by kind, each run once its open is admitted. `document` is M5b's next task's
   * (stream-document.ts); until it is here an admitted document open is refused `unavailable`.
   */
  readonly #planes: Partial<Record<ReadStreamKind, ReadPlane>>;

  constructor(ctx: StreamsContext) {
    this.#ctx = ctx;
    this.#planes = { http: httpPlane((request) => ctx.artifacts.fetch(request)) };
    // A forward removed (its member lost `shell`) or forgotten takes its connections with it.
    this.#offRemoved = ctx.forwards.onRemoved((forward) => {
      for (const streams of this.#channels.values())
        for (const stream of streams.values()) if (stream instanceof TcpStream && stream.forward === forward) stream.end('removed');
    });
  }

  /** The channel's stream messages. */
  receive(channel: RemoteChannel, m: DeviceStreamMessage): void {
    if (channel.closed) return;
    if (m.t === 'streamOpen') return void (isReadStreamKind(m.kind) ? this.#openRead(channel, m as ReadOpen) : this.#open(channel, m as ActOpen));
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

  /**
   * P5 O7 M5b: what a read stream's decision may rest on moved: a record change, an artifact's relink (or create or
   * delete), a linked session's new placement in the spine's index, each after the artifact cache dropped what it said
   * (endpoint.ts). Every open read stream whose decision no longer stands (authorize.ts' `stands`: a record it read, a
   * placement, the head, the policy or the grants) is authorized again through the same steps with its open's input, held
   * meanwhile, and ends `removed` once refused; one that still stands is untouched.
   */
  accessMoved(): void {
    for (const streams of this.#channels.values())
      for (const stream of streams.values()) if (stream.read !== null && stream.opened && !stream.ended && !stream.read.stands()) this.#recheckStream(stream);
  }

  /** A forward authorized again: removed, its streams with it, once its member no longer holds `shell`. */
  checkForward(forward: Forward): void {
    const binding = { member: forward.member, device: forward.device };
    this.#check(forward, { kind: 'stream', name: 'forward.open', input: binding }, { ...binding, clientClass: forward.clientClass }, (verdict) => verdict === 'refused' && this.#ctx.forwards.remove(forward.device, forward.id));
  }

  /**
   * An open stream authorized again, held while the check runs; ended `removed` (its forward too) once refused. A read
   * stream (P5 O7 M5b) is decided as its open was, by its row's name and its open's input, and keeps the new decision's
   * `stands`; one already moved again when granted is checked again.
   */
  #recheckStream(stream: Stream): void {
    stream.hold();
    const read = stream.read;
    const request: AuthorizeRequest = { kind: 'stream', name: stream.act, input: read === null ? stream.binding : read.input };
    this.#check(stream, request, this.#who(stream.channel), (verdict, decision) => {
      if (verdict === 'granted') {
        if (read !== null) {
          const stands = decision !== undefined && decision.ok ? decision.stands : undefined;
          stream.read = { input: read.input, stands: stands ?? (() => true) };
          if (!stream.read.stands()) return this.#recheckStream(stream);
        }
        return stream.unhold();
      }
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

  /**
   * The open's id taken in its channel's table, held by a placeholder a `streamClose` cancels (a second open of it is
   * `malformed`), or null once refused (`malformed`, `busy`).
   */
  #take(channel: RemoteChannel, m: StreamOpenMessage): Taken | null {
    const refuse = (reason: StreamRefusal) => void (channel.closed || channel.send({ t: 'streamRefused', id: m.id, reason } as EndpointMessage));
    let streams = this.#channels.get(channel);
    if (streams === undefined) {
      const mine = new Map<string, Stream>();
      streams = mine;
      this.#channels.set(channel, mine);
      this.#windows.set(channel, new StreamWindow(channel, { deadlineMs: this.#ctx.transmitDeadlineMs ?? TRANSMIT_DEADLINE_MS, log: this.#ctx.log }));
      channel.onClose(() => this.#channelClosed(channel, mine));
    }
    const full = streams.has(m.id) ? 'malformed' : streams.size >= MAX_STREAMS ? 'busy' : null;
    if (full !== null) {
      refuse(full);
      return null;
    }
    const table = streams;
    const placeholder = new Cancelled(m.id, channel, this.#windows.get(channel)!, (s) => this.#forget(s));
    table.set(m.id, placeholder);
    return {
      placeholder,
      refuse,
      // The stream takes the open's place in the table as it answers, so what the device sends next reaches it.
      install: (stream) => void (table.get(m.id) === placeholder && table.set(m.id, stream)),
      release: () => void (table.get(m.id) === placeholder && table.delete(m.id)),
    };
  }

  async #open(channel: RemoteChannel, m: ActOpen): Promise<void> {
    const taken = this.#take(channel, m);
    if (taken === null) return;
    const { placeholder, refuse, install, release } = taken;
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
      const open = { channel, m, act: ledgered.name, binding, who, placeholder, install };
      if (m.kind === 'pty') await this.#openPty(open);
      else await this.#openTcp(open);
    } catch (error) {
      this.#ctx.log(`endpoint: a stream on channel ${channel.key} could not be opened: ${(error as Error).message}`);
      refuse('unavailable');
    } finally {
      release();
    }
  }

  /**
   * P5 O7 M5b: a read open, which names no act: admitted by the stream row of its kind (offers.ts' READ_OPENS) through
   * authorization's eight steps with the open's kind fields as the input (authorize.ts), then handed to its kind's plane,
   * which does what the stream needs before it can answer (an `http` open's request) and publishes the stream through
   * `decide`: the decision asked whether it stands in the step the stream is installed and answered. A device that
   * listed no `rl2.read-open` sent what its protocol has no form for (`malformed`, as an older endpoint would have found it).
   */
  async #openRead(channel: RemoteChannel, m: ReadOpen): Promise<void> {
    const taken = this.#take(channel, m);
    if (taken === null) return;
    const { placeholder, refuse, install, release } = taken;
    try {
      if (!channel.capabilities.includes(READ_OPEN)) return refuse('malformed');
      const who = this.#who(channel);
      const request: AuthorizeRequest = { kind: 'stream', name: READ_OPENS[m.kind], input: m.kind === 'http' ? m.http : m.document };
      const since = this.#epoch;
      const decision = await this.#ctx.authorize(request, who, this.#ctx.now());
      if (placeholder.ended || channel.closed) return;
      if (!decision.ok) return refuse(readRefusal(decision.reason));
      const plane = this.#planes[m.kind];
      if (plane === undefined) return refuse('unavailable');
      const opening: ReadOpening = {
        channel,
        id: m.id,
        credit: m.credit,
        act: request.name,
        input: request.input,
        binding: { member: who.member, device: who.device },
        window: this.#windows.get(channel)!,
        over: (stream) => this.#forget(stream),
        cancelled: () => placeholder.ended || channel.closed,
        decide: async (publish) => {
          const decided = await this.#decideRead(request, who, decision, since, publish);
          return decided.ok ? decided : { ok: false, reason: readRefusal(decided.reason) };
        },
        install,
        refuse,
        log: this.#ctx.log,
      };
      await plane(opening);
    } catch (error) {
      this.#ctx.log(`endpoint: a stream on channel ${channel.key} could not be opened: ${(error as Error).message}`);
      refuse('unavailable');
    } finally {
      release();
    }
  }

  /**
   * P5 O7 M5b: a read open's verdict and its publication in one synchronous step: the decision taken at the open is asked
   * whether it stands (authorize.ts' `stands`) and whether a re-check began since, and on both `publish` runs at once,
   * handed the access the stream keeps for its re-checks. One that moved is taken again, once, against the state now;
   * moved again, `unavailable` (authorize's own rule, and the act path's `Actions.#again`).
   */
  async #decideRead<R>(request: AuthorizeRequest, who: Who, first: Decision, since: number, publish: (access: ReadAccess) => R): Promise<{ ok: true; value: R } | { ok: false; reason: RefusalReason }> {
    let decision = first;
    let epoch = since;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        epoch = this.#epoch;
        decision = await this.#ctx.authorize(request, who, this.#ctx.now());
      }
      if (!decision.ok) return decision;
      const stands = decision.stands ?? (() => true);
      if (epoch === this.#epoch && stands()) return { ok: true, value: publish({ input: request.input, stands }) };
    }
    return { ok: false, reason: 'unavailable' };
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
   * Authorizes a stream's binding (P5 O7 M5b: or a read stream's open) again for `who`, the latest check of `key`
   * counting; an answer the endpoint can't give now (`unavailable`) is asked again after each retry delay, and is
   * `unanswered` after the last. A grant comes with its decision (a read stream keeps its `stands`).
   */
  #check(key: unknown, request: AuthorizeRequest, who: Who, verdict: (verdict: 'granted' | 'refused' | 'unanswered', decision?: Decision) => void, attempt = 0): void {
    const n = attempt === 0 ? (this.#checks.get(key) ?? 0) + 1 : this.#checks.get(key)!;
    this.#checks.set(key, n);
    const current = () => this.#checks.get(key) === n && !(key instanceof Stream && key.ended);
    const done = (answer: 'granted' | 'refused' | 'unanswered', decision?: Decision) => {
      this.#checks.delete(key);
      verdict(answer, decision);
    };
    this.#ctx
      .authorize(request, who, this.#ctx.now())
      .then((decision) => {
        if (!current()) return;
        if (decision.ok) return done('granted', decision);
        if (decision.reason !== 'unavailable') return done('refused');
        const retries = this.#ctx.recheckRetryMs ?? RECHECK_RETRY_MS;
        if (attempt >= retries.length) return done('unanswered');
        const timer = setTimeout(() => current() && this.#check(key, request, who, verdict, attempt + 1), retries[attempt]);
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

/** P5 O7 M5b: the capability a device lists to make a read open. */
const READ_OPEN = 'rl2.read-open';

/**
 * P5 O7 M5b: a read open's refusal as the device reads it: its fields out of shape (a URL not the scheme's) `malformed`,
 * the machine unable to say now `unavailable`, an edit the machine's policy refuses `read-only`, and everything else
 * (not offered, no target, below the grade) `grade`.
 */
function readRefusal(reason: RefusalReason): StreamRefusal {
  return reason === 'malformed' || reason === 'unavailable' || reason === 'read-only' ? reason : 'grade';
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
