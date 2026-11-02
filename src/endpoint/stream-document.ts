// The `document` read open's plane (P5 O7 M5b, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5 "The
// `document` stream"; Interfaces §N): one endpoint document channel of the machine's engine host (`EndpointServices.
// documents`, in the endpoint's range of channel numbers), opened as the human (every port write is the human's; a
// member's attribution is O8 M6's), its open admitted on the `artifact` rule at `view`, or `manage` for an `edit` open
// (streams.ts).
//
// The open. The artifact is read first (`artifacts.get`, as main's `openDocument` does): a parked host wakes for it, so the
// channel can open, and an artifact gone or of no document kind opens nothing. The decision is then asked whether it
// stands in the step the channel opens and `streamOpened {id, credit}` is sent (`decide`); a host that can take no channel
// now is `unavailable`.
//
// The frames. Each direction carries the document frames (src/artifacts/provider/frames.ts), each prefixed by its u32be
// length, as one byte flow cut into `streamData` chunks under the other side's credit. The host's come from `onFrame`'s
// `{owner: 'engine-host', channel, bytes}` and are held past the device's credit up to DOCUMENT_BACKLOG_BYTES (the host
// can't be paused), past which the stream closes `behind` and the device reopens and resyncs. A provisional frame's
// session is withheld (nothing a stream sends names a session the member may not view; the CRDT bytes keep the opaque ids
// their provenance carries, M5a's known limit). The device's go to the host through `documents.frame` as each completes
// across chunks; a length of 0 or past DOCUMENT_FRAME_MAX, or bytes that are no frame, close the stream `malformed`. Its
// bytes are refunded as they are taken (one frame at most is assembled), and wait, unrefunded, while a re-check holds
// the stream.
//
// `view`. The decision's mode (the open's input as authorized) is the one predicate: a `view` open forwards only step 1
// and awareness from the device, so its editor syncs and shows presence but never writes, and drops update, step 2 and
// anything else (counted, logged); past VIEW_DROPPED_MAX dropped the stream closes `read-only`.
//
// The ends. The channel's end (`documents.onClosed`) closes the stream with its word (`host`, `reset`, `upstream`) after
// the frames before it; the stream's end closes the channel (the device's close, its channel's loss, a re-check's
// `removed`, which drops what the stream holds). Before each forward either way the decision is asked whether it still
// stands; one that moved holds the stream and is authorized again (`ReadOpening.recheck`).
import { decodeFrame, encodeFrame, MSG_PROVISIONAL } from '@artifacts/provider/frames';
import { isDocKind, type ArtifactKind } from '@shared/artifacts/entity';
import { DOC_HIGH_WATER } from '@shared/host/doc-channels';
import { WITHHELD_SESSION, type StreamDataMessage, type StreamDocumentOpen } from 'org-protocol';
import { dispatchAs, type EndpointServices } from './services';
import { Stream, type ReadAccess, type ReadOpening, type ReadPlane } from './stream-base';

/** The endpoint's document channels: numbers from 2^31 (EndpointServices.documents; main's are below). */
const CHANNEL_BASE = 2 ** 31;
const CHANNEL_SPAN = 2 ** 31;
/** The largest frame either way: the engine host's socket resets a document channel queued past it anyway. */
export const DOCUMENT_FRAME_MAX = DOC_HIGH_WATER;
/** The host's frames held past the device's credit, at most: past it the stream closes `behind`. */
export const DOCUMENT_BACKLOG_BYTES = DOC_HIGH_WATER;
/** A `view` open's device frames dropped, at most: past it the stream closes `read-only`. */
export const VIEW_DROPPED_MAX = 64 * 1024;

export type DocumentChannels = Pick<EndpointServices['documents'], 'open' | 'close' | 'frame'>;
type ChannelEnd = 'host' | 'reset' | 'upstream';

/** The plane, and how the host's side reaches its streams: a channel's frames (`onFrame`) and its end (`onClosed`). */
export type DocumentPlane = {
  open: ReadPlane;
  frame(channel: number, bytes: Uint8Array): void;
  closed(channel: number, reason: ChannelEnd): void;
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** Whether an open is `view`: the mode its decision admitted, read from the input it was authorized with. */
const viewOnly = (access: ReadAccess): boolean => (access.input as StreamDocumentOpen).mode === 'view';

export function documentPlane(ctx: { documents: DocumentChannels; dispatch: EndpointServices['dispatch']; log(line: string): void }): DocumentPlane {
  const streams = new Map<number, DocumentStream>();
  let next = 0;
  /** A number of the range no stream holds. */
  const allocate = (): number => {
    for (;;) {
      const channel = CHANNEL_BASE + (next++ % CHANNEL_SPAN);
      if (!streams.has(channel)) return channel;
    }
  };

  const open: ReadPlane = async (opening) => {
    const { artifactId, doc } = opening.input as StreamDocumentOpen;
    const found = await dispatchAs(ctx.dispatch, opening.channel.client)('engine-host', 'artifacts.get', { artifactId });
    if (opening.cancelled()) return;
    if (!found.ok) {
      opening.log(`endpoint: a document's artifact could not be read: ${found.error.code}`);
      return opening.refuse('unavailable');
    }
    const artifact = isObject(found.value) && isObject(found.value.artifact) ? found.value.artifact : null;
    if (artifact === null) return opening.refuse('grade');
    if (!isDocKind(artifact.kind as ArtifactKind)) return opening.refuse('malformed');
    const decided = await opening.decide((access) => {
      if (opening.cancelled()) return 'gone' as const;
      const channel = allocate();
      const stream = new DocumentStream(opening, access, channel, ctx.documents, () => streams.delete(channel));
      streams.set(channel, stream);
      if (!ctx.documents.open({ t: 'documents.open', channel, artifactId, actor: { kind: 'human' }, ...(doc === undefined ? {} : { doc }) })) {
        streams.delete(channel);
        return 'unavailable' as const;
      }
      opening.install(stream);
      stream.open({});
      return null;
    });
    if (!decided.ok) return opening.refuse(decided.reason);
    if (decided.value === 'unavailable') {
      opening.log(`endpoint: the engine host took no document channel for ${artifactId}`);
      opening.refuse('unavailable');
    }
  };

  return {
    open,
    frame: (channel, bytes) => streams.get(channel)?.hostFrame(bytes),
    closed: (channel, reason) => streams.get(channel)?.hostClosed(reason),
  };
}

class DocumentStream extends Stream {
  /** The bytes sent the device so far: the next chunk's offset. */
  #out = 0;
  /** The device's bytes taken so far: its next chunk's offset. */
  #in = 0;
  /** The device's chunks a re-check holds, unrefunded, in order. */
  readonly #inbox: Buffer[] = [];
  readonly #frames = new LengthPrefixed(DOCUMENT_FRAME_MAX);
  /** A `view` open's device frames dropped: how many, and their bytes. */
  #dropped = { frames: 0, bytes: 0 };
  /** The channel is open on the host's side. */
  #upstream = true;
  readonly #recheck: (stream: Stream) => void;
  readonly #log: (line: string) => void;

  constructor(
    opening: ReadOpening,
    access: ReadAccess,
    readonly docChannel: number,
    private readonly documents: DocumentChannels,
    private readonly released: () => void,
  ) {
    super(opening.id, opening.channel, opening.act, opening.binding, opening.credit, opening.window, opening.over);
    this.read = access;
    this.#recheck = opening.recheck;
    this.#log = opening.log;
  }

  /** Whether the decision still stands; one that moved holds the stream and is authorized again. */
  #stands(): boolean {
    if (this.read!.stands()) return true;
    if (!this.held) this.#recheck(this);
    return false;
  }

  /** A frame of the host's, length-prefixed, queued for the device's credit. */
  hostFrame(bytes: Uint8Array): void {
    if (this.ended || !this.#upstream) return;
    const frame = withheld(bytes);
    if (frame === null) return this.#log(`endpoint: a document's provisional frame was not read, and not sent (${bytes.byteLength} bytes)`);
    const out = new Uint8Array(4 + frame.byteLength);
    new DataView(out.buffer).setUint32(0, frame.byteLength);
    out.set(frame, 4);
    this.push(this.#out, out);
    this.#out += out.byteLength;
  }

  /** The channel ended on the host's side: the stream closes with its word once what it holds is sent. */
  hostClosed(reason: ChannelEnd): void {
    if (this.ended) return;
    this.#upstream = false;
    this.closeAfter(reason);
  }

  /** The window's turn: nothing goes on a decision that moved. */
  override next(): ReturnType<Stream['next']> {
    if (!this.ended && !this.held && !this.#stands()) return null;
    return super.next();
  }

  protected override queued(): void {
    if (this.backlog > DOCUMENT_BACKLOG_BYTES) this.end('behind');
  }

  override unhold(): void {
    super.unhold();
    this.#drain();
  }

  protected idle(): boolean {
    return true;
  }

  /** The channel closed with the stream (unless the host ended it), and what the stream holds dropped. */
  protected closed(): void {
    this.#inbox.length = 0;
    this.#frames.clear();
    if (this.#upstream) this.documents.close(this.docChannel);
    this.#upstream = false;
    this.released();
    if (this.#dropped.frames > 0) this.#log(`endpoint: a view-only document stream dropped ${this.#dropped.frames} frames (${this.#dropped.bytes} bytes) the device wrote`);
  }

  input(m: StreamDataMessage): void {
    const bytes = Buffer.from(m.data, 'base64url');
    if (!this.take(bytes.byteLength)) return;
    if (m.offset !== this.#in) return this.end('malformed');
    this.#in += bytes.byteLength;
    this.#inbox.push(bytes);
    this.#drain();
  }

  /** The device's chunks taken in order, each frame they complete forwarded and their bytes refunded, unless held. */
  #drain(): void {
    if (this.#inbox.length === 0 || this.ended || this.held || !this.#stands()) return;
    while (this.#inbox.length > 0 && !this.ended) {
      const chunk = this.#inbox.shift()!;
      const frames = this.#frames.push(chunk);
      if (frames === null) return this.end('malformed');
      for (const frame of frames) {
        this.#forward(frame);
        if (this.ended) return;
      }
      this.refund(chunk.byteLength);
    }
  }

  /** One frame of the device's to the host: a `view` open's only when it is step 1 or awareness. */
  #forward(bytes: Uint8Array): void {
    let type: string;
    try {
      type = decodeFrame(bytes).type;
    } catch {
      return this.end('malformed');
    }
    if (viewOnly(this.read!) && type !== 'step1' && type !== 'awareness') {
      if (this.#dropped.frames === 0) this.#log(`endpoint: a view-only document stream dropped the device's ${type}`);
      this.#dropped.frames++;
      this.#dropped.bytes += bytes.byteLength;
      if (this.#dropped.bytes > VIEW_DROPPED_MAX) this.end('read-only');
      return;
    }
    // Ended on the host's side: its close follows what the stream holds, and the device's writes go nowhere.
    if (!this.#upstream) return;
    if (this.documents.frame(this.docChannel, bytes)) return;
    this.#log(`endpoint: a document frame could not be written to channel ${this.docChannel}`);
    this.end('unavailable');
  }

  control(): void {
    this.end('malformed');
  }

  closedByDevice(): void {
    this.end(null);
  }
}

/**
 * A host frame as the device may read it: a provisional frame (an agent's streaming edit) names its session plainly,
 * which is withheld (`WITHHELD_SESSION`, as M5a's projection withholds an actor; nothing the device shows reads it);
 * every other frame as it is. Null for a provisional frame that can't be read.
 */
function withheld(bytes: Uint8Array): Uint8Array | null {
  if (bytes[0] !== MSG_PROVISIONAL) return bytes;
  try {
    const frame = decodeFrame(bytes);
    if (frame.type !== 'provisional') return bytes;
    const layer: unknown = JSON.parse(frame.json);
    if (!isObject(layer)) return null;
    if (!('appSessionId' in layer)) return bytes;
    return encodeFrame({ type: 'provisional', json: JSON.stringify({ ...layer, appSessionId: WITHHELD_SESSION }) });
  } catch {
    return null;
  }
}

/** Frames out of a byte flow where each is prefixed by its u32be length, assembled across the chunks it comes in. */
class LengthPrefixed {
  readonly #parts: Uint8Array[] = [];
  #size = 0;
  /** The frame being assembled's length, once its prefix is read. */
  #length: number | null = null;

  constructor(private readonly max: number) {}

  /** The frames `chunk` completes, in order; null once a length is 0 or past the most a frame may be. */
  push(chunk: Uint8Array): Uint8Array[] | null {
    this.#parts.push(chunk);
    this.#size += chunk.byteLength;
    const frames: Uint8Array[] = [];
    for (;;) {
      if (this.#length === null) {
        if (this.#size < 4) return frames;
        const prefix = this.#read(4);
        const length = new DataView(prefix.buffer, prefix.byteOffset, 4).getUint32(0);
        if (length === 0 || length > this.max) return null;
        this.#length = length;
      }
      if (this.#size < this.#length) return frames;
      frames.push(this.#read(this.#length));
      this.#length = null;
    }
  }

  clear(): void {
    this.#parts.length = 0;
    this.#size = 0;
    this.#length = null;
  }

  /** The next `n` bytes, taken off the parts (each byte copied once). */
  #read(n: number): Uint8Array {
    const out = new Uint8Array(n);
    let at = 0;
    while (at < n) {
      const head = this.#parts[0];
      const take = Math.min(head.byteLength, n - at);
      out.set(head.subarray(0, take), at);
      at += take;
      if (take === head.byteLength) this.#parts.shift();
      else this.#parts[0] = head.subarray(take);
    }
    this.#size -= n;
    return out;
  }
}
