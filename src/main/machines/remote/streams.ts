// The RL2 link's streams (P5 O7 M3, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Streams", Interfaces §N,
// the link's half; RL §4.8): byte flows inside the current channel, each opened under an act the device sent (its opId),
// behind the peer's `rl2.streams`. A terminal's bytes (`pty`) and a forwarded port's connection (`tcp`) ride them.
//
// - A stream is sent only to a peer that listed `rl2.streams` in its `h2`; for any other it closes `not-offered` at once,
//   never sent, since the peer would close the channel on the kind. One opened while no channel is current waits for the
//   next; one sent on a channel dies with it (`carrier`), and the consumer opens it again if it should live on (a
//   terminal's, from its offsets under the same act; a connection is not reopened).
// - Each direction goes within the other side's credit. The endpoint's, given in `streamOpened` and refunded by its
//   `streamCredit`, bounds what this side sends: bytes past it wait here, and the consumer reads how many (`queued`).
//   This side's, given at the open and refunded by the consumer (`credit`, as the bytes are taken: a terminal's as the
//   renderer acknowledges them, a connection's as the local socket writes them), bounds what the endpoint sends.
//   Credit is counted in decoded bytes, and a refund given before the stream opened is held until it has, since the
//   endpoint is still admitting it.
// - Data goes in chunks of at most STREAM_CHUNK_BYTES, each unpadded base64url, at the sender's byte offset: this side
//   numbers its bytes from the open's `inputFrom` for a pty (the device's input offset in its epoch) and from zero for a
//   connection; the endpoint's are the pty host's output offsets, or the connection's.
// - A refusal is the stream's close with the refusal's reason; a close this side sends is not answered.
import { STREAM_CHUNK_BYTES, STREAM_CREDIT_MAX, base64urlEncode, type DeviceMessage, type EndpointMessage, type StreamOpenedMessage } from '../../../../apps/org-protocol/src/index.ts';
import { peerLists } from './capabilities';

/** The credit a stream gives the endpoint at its open, unless asked otherwise: twice a terminal's ring, which its opening sends whole. */
export const STREAM_OPEN_CREDIT = 1024 * 1024;

export interface StreamRequest {
  kind: 'pty' | 'tcp';
  /** The authorizing act's opId, sent on this link. */
  op: string;
  /** What the endpoint may send before a refund; STREAM_OPEN_CREDIT by default, at most STREAM_CREDIT_MAX. */
  credit?: number;
  pty?: { ptyId: string; from: number; inputEpoch: string; inputFrom: number };
  tcp?: { forward: string };
}
/** `streamOpened` without its kind and id: a pty's `{info, ringStart, nextOffset}`, and the endpoint's credit for this side's bytes. */
export type StreamOpened = Omit<StreamOpenedMessage, 't' | 'id'>;
export interface StreamSink {
  opened(opened: StreamOpened): void;
  data(offset: number, bytes: Uint8Array): void;
  /** The endpoint refunded `bytes` of what this side sent: they were taken (written, or dropped as a resend). */
  credit(bytes: number): void;
  /** Final: the endpoint's close or refusal, `carrier` with its channel, `not-offered`, or the link's end. Never after `close()`. */
  closed(reason: string): void;
}
export interface RemoteStream {
  readonly id: string;
  send(bytes: Uint8Array): void;
  control(control: Record<string, unknown>): void;
  /** Gives the endpoint back `bytes` of credit: what this side took of its output. */
  credit(bytes: number): void;
  close(reason?: string): void;
  /** P5 O7 M3: bytes sent here that wait for the endpoint's credit (a connection's local socket pauses on it). */
  queued(): number;
}

export interface StreamTableDeps {
  /** Sends on the current channel; false when none is current. */
  send(message: DeviceMessage): boolean;
  current(): boolean;
  peerCapabilities(): readonly string[] | null;
  log(line: string): void;
}

type Entry = {
  id: string;
  request: StreamRequest;
  sink: StreamSink;
  state: 'waiting' | 'sent' | 'opened';
  /** The endpoint's credit for this side's bytes. */
  credit: number;
  /** This side's next byte offset. */
  offset: number;
  outbox: Uint8Array[];
  queued: number;
  controls: Array<Record<string, unknown>>;
  /** A refund given before the stream opened. */
  refund: number;
};

const toBase64url = (bytes: Uint8Array): string => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64url');
const fromBase64url = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'base64url'));

export class StreamTable {
  readonly #entries = new Map<string, Entry>();
  readonly #deps: StreamTableDeps;

  constructor(deps: StreamTableDeps) {
    this.#deps = deps;
  }

  get size(): number {
    return this.#entries.size;
  }

  /** `ended` names the link's permanent end (`removed`, `closed`) when it holds one. */
  open(request: StreamRequest, sink: StreamSink, ended: 'removed' | 'closed' | null): RemoteStream {
    const id = base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
    const entry: Entry = { id, request, sink, state: 'waiting', credit: 0, offset: request.pty?.inputFrom ?? 0, outbox: [], queued: 0, controls: [], refund: 0 };
    const stream: RemoteStream = {
      id,
      send: (bytes) => {
        if (this.#entries.get(id) !== entry || bytes.byteLength === 0) return;
        entry.outbox.push(bytes);
        entry.queued += bytes.byteLength;
        this.#flush(entry);
      },
      control: (control) => {
        if (this.#entries.get(id) !== entry) return;
        if (entry.state === 'opened') this.#deps.send({ t: 'streamControl', id, control });
        else entry.controls.push(control);
      },
      credit: (bytes) => {
        if (this.#entries.get(id) !== entry || !(bytes > 0)) return;
        if (entry.state === 'opened') this.#refund(entry, bytes);
        else entry.refund += bytes;
      },
      close: (reason = 'closed') => {
        if (this.#entries.get(id) !== entry) return;
        this.#entries.delete(id);
        if (entry.state !== 'waiting') this.#deps.send({ t: 'streamClose', id, reason });
      },
      queued: () => entry.queued,
    };
    if (ended !== null) {
      queueMicrotask(() => sink.closed(ended));
      return stream;
    }
    this.#entries.set(id, entry);
    if (this.#deps.current()) this.#open(entry);
    return stream;
  }

  /** A channel became current: every stream waiting for one is opened on it. */
  onCurrent(): void {
    for (const entry of [...this.#entries.values()]) if (entry.state === 'waiting') this.#open(entry);
  }

  /** The current channel was lost: every stream on it ends with it. */
  onLost(): void {
    for (const entry of [...this.#entries.values()]) {
      if (entry.state === 'waiting') continue;
      this.#entries.delete(entry.id);
      entry.sink.closed('carrier');
    }
  }

  /** The link ended for good. */
  close(reason: string): void {
    for (const entry of [...this.#entries.values()]) {
      this.#entries.delete(entry.id);
      entry.sink.closed(reason);
    }
  }

  receive(message: EndpointMessage): void {
    if (!('id' in message) || typeof message.id !== 'string') return;
    const entry = this.#entries.get(message.id);
    if (entry === undefined) return;
    switch (message.t) {
      case 'streamOpened': {
        if (entry.state !== 'sent') return;
        entry.state = 'opened';
        entry.credit = message.credit;
        entry.sink.opened({ ...(message.pty === undefined ? {} : { pty: message.pty }), credit: message.credit });
        if (this.#entries.get(entry.id) !== entry) return;
        for (const control of entry.controls.splice(0)) this.#deps.send({ t: 'streamControl', id: entry.id, control });
        if (entry.refund > 0) this.#refund(entry, entry.refund);
        entry.refund = 0;
        return this.#flush(entry);
      }
      case 'streamRefused':
        this.#entries.delete(entry.id);
        return entry.sink.closed(message.reason);
      case 'streamData':
        if (entry.state !== 'opened') return;
        return entry.sink.data(message.offset, fromBase64url(message.data));
      case 'streamCredit':
        if (entry.state !== 'opened') return;
        entry.credit = Math.min(entry.credit + message.bytes, STREAM_CREDIT_MAX);
        this.#flush(entry);
        return entry.sink.credit(message.bytes);
      case 'streamClose':
        this.#entries.delete(entry.id);
        return entry.sink.closed(message.reason);
      default:
        return;
    }
  }

  #open(entry: Entry): void {
    // What the peer could not read never goes: the stream ends here, as the peer would end the channel.
    if (!peerLists(this.#deps, 'rl2.streams')) {
      this.#entries.delete(entry.id);
      return void queueMicrotask(() => entry.sink.closed('not-offered'));
    }
    const { kind, op, pty, tcp } = entry.request;
    const credit = Math.min(Math.max(1, entry.request.credit ?? STREAM_OPEN_CREDIT), STREAM_CREDIT_MAX);
    if (this.#deps.send({ t: 'streamOpen', id: entry.id, kind, op, credit, ...(pty === undefined ? {} : { pty }), ...(tcp === undefined ? {} : { tcp }) })) entry.state = 'sent';
  }

  #refund(entry: Entry, bytes: number): void {
    for (let left = bytes; left > 0; left -= STREAM_CREDIT_MAX) this.#deps.send({ t: 'streamCredit', id: entry.id, bytes: Math.min(left, STREAM_CREDIT_MAX) });
  }

  /** What waits goes out, in chunks, within the endpoint's credit. */
  #flush(entry: Entry): void {
    if (entry.state !== 'opened') return;
    while (entry.outbox.length > 0 && entry.credit > 0 && this.#entries.get(entry.id) === entry) {
      const head = entry.outbox[0];
      const n = Math.min(head.byteLength, STREAM_CHUNK_BYTES, entry.credit);
      const chunk = head.subarray(0, n);
      if (!this.#deps.send({ t: 'streamData', id: entry.id, offset: entry.offset, data: toBase64url(chunk) })) return;
      if (n === head.byteLength) entry.outbox.shift();
      else entry.outbox[0] = head.subarray(n);
      entry.offset += n;
      entry.credit -= n;
      entry.queued -= n;
    }
  }
}
