// One stream of a device's channel (P5 O7 M3; docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, Interfaces §N),
// the part every plane shares (streams.ts' `pty` and `tcp`, P5 O7 M5b's `http` in stream-http.ts and `document`): its
// output queued under the device's credit and sent through the channel's stream window, its input under the endpoint's
// credit, the hold a re-check puts on both, and its end. A plane says what it does at each of those (`queued`,
// `drained`, `closed`, `input`, `control`); streams.ts admits, routes and re-checks.
import { STREAM_CHUNK_BYTES, STREAM_CREDIT_MAX, type EndpointMessage, type StreamControlMessage, type StreamDataMessage, type StreamRefusal } from 'org-protocol';
import type { StreamBinding } from './authorize';
import type { RemoteChannel } from './channels';
import type { StreamSource, StreamWindow } from './stream-window';

/** The credit the endpoint gives a stream for the device's bytes, refunded as they are written. */
export const STREAM_INPUT_CREDIT = 256 * 1024;

/**
 * P5 O7 M5b: what a read open (a stream row's, no act) is authorized on again at each re-check: the open's kind fields as
 * its input, and whether the decision that admitted it, or the latest re-check's, still stands (authorize.ts' `stands`:
 * no record, placement, head, policy or grant it read has moved).
 */
export type ReadAccess = { input: unknown; stands: () => boolean };

/**
 * P5 O7 M5b: a read open admitted, as its kind's plane takes it (streams.ts runs the admission; a plane is the seam each
 * kind fills: stream-http.ts' `http`, M5b's next task's `document`). `act` is the stream row's name and `binding` the
 * channel's member and device, which the stream is made with; `input` the open's kind fields as authorized. The plane does
 * what the stream needs before it can answer, then publishes it through `decide`, which runs `publish` only in the step
 * the decision is found to stand (handing it the access the stream keeps: set it as `stream.read`), and answers the
 * refusal otherwise, which the plane sends (`refuse`) after letting go of what it made. `cancelled`: the device closed the
 * open, or its channel is gone; nothing is published then.
 */
export type ReadOpening = {
  channel: RemoteChannel;
  id: string;
  credit: number;
  act: string;
  input: unknown;
  binding: StreamBinding;
  window: StreamWindow;
  /** The stream ended: out of its channel's table. */
  over(stream: Stream): void;
  cancelled(): boolean;
  decide<R>(publish: (access: ReadAccess) => R): Promise<{ ok: true; value: R } | { ok: false; reason: StreamRefusal }>;
  install(stream: Stream): void;
  refuse(reason: StreamRefusal): void;
  log(line: string): void;
};
/** A read open's kind's plane (P5 O7 M5b). */
export type ReadPlane = (opening: ReadOpening) => Promise<void>;

type Queued = { offset: number; bytes: Uint8Array } | { close: string };

/** One stream of one channel: its output queue under the device's credit, and its input under the endpoint's. */
export abstract class Stream implements StreamSource {
  /** Answered `streamOpened`: data flows. */
  opened = false;
  /** P5 O7 M5b: a read open's authorization, asked again at its re-checks; null for one opened under an act. */
  read: ReadAccess | null = null;
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

  /** What the device's credit still allows to be sent (P5 O7 M5b: an `http` body is read from its source only within it). */
  protected get creditLeft(): number {
    return this.#credit;
  }

  /** Whether a re-check holds it: nothing goes either way meanwhile. */
  protected get held(): boolean {
    return this.#held;
  }

  /** The stream's answer: `streamOpened`, the device's input credit given; P5 O7 M5b: an `http` answer's status and headers. */
  open(fields: { pty?: Record<string, unknown>; http?: { status: number; headers: Record<string, string> } }): void {
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
    this.credited();
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
    this.credited();
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
  /** The device's credit grew, or a re-check's hold ended: more may be sent (an `http` body read on). */
  protected credited(): void {}
  /** Whether no input waits to be written (a refund then goes at once). */
  protected abstract idle(): boolean;
  /** Its plane lets go (a socket reset, a pty's frames no longer routed here). */
  protected abstract closed(): void;
  abstract input(m: StreamDataMessage): void;
  abstract control(m: StreamControlMessage): void;
  /** The device closed it. */
  abstract closedByDevice(): void;
}

