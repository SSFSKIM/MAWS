// The `document` read open's plane (P5 O7 M5b, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5 "The
// `document` stream"; Interfaces §N): one endpoint document channel of the machine's engine host (`EndpointServices.
// documents`, in the endpoint's range of channel numbers), opened as the human (every port write is the human's; a
// member's attribution is O8 M6's), its open admitted on the `artifact` rule at `view`, or `manage` for an `edit` open
// (streams.ts).
//
// The open. The artifact is read first (`artifacts.get`, as main's `openDocument` does): a parked host wakes for it, so the
// channel can open, and an artifact gone or of no document kind opens nothing. An `edit` open reads the store's status
// beside it (`artifacts.status`): a read-only store answers it `read-only`. The decision is then asked whether it
// stands in the step the channel opens and `streamOpened {id, credit}` is sent (`decide`); a host that can take no channel
// now is `unavailable`.
//
// The frames. Each direction carries the document frames (src/artifacts/provider/frames.ts), each prefixed by its u32be
// length, as one byte flow cut into `streamData` chunks under the other side's credit. The host's come from `onFrame`'s
// `{owner: 'engine-host', channel, bytes}` and are held past the device's credit (the host can't be paused): a frame that
// finds more than DOCUMENT_BACKLOG_BYTES queued behind the one being sent closes the stream `behind`, and the device
// reopens and resyncs. A provisional frame's
// session is withheld (nothing a stream sends names a session the member may not view; the CRDT bytes keep the opaque ids
// their provenance carries, M5a's known limit). The device's go to the host through `documents.frame` as each completes
// across chunks; a length of 0 or past the host's own frame cap (frame-stream.ts' DOCUMENT_FRAME_MAX), or bytes that are
// no frame, close the stream `malformed`. Its bytes are refunded as they are taken (one frame at most is assembled), and
// wait, unrefunded, while a re-check holds the stream.
//
// `view`. The decision's mode (the open's input as authorized) is the one predicate: a `view` open forwards only step 1
// and awareness from the device, so its editor syncs and shows presence but never writes, and drops update, step 2 and
// anything else (counted, logged); past VIEW_DROPPED_MAX dropped the stream closes `read-only`.
//
// The ends. The channel's end (`documents.onClosed`) closes the stream with its word (`host`, `reset`, `upstream`) after
// the frames before it; the stream's end closes the channel (the device's close, its channel's loss, a re-check's
// `removed`, which drops what the stream holds). Before each forward either way the decision is asked whether it still
// stands; one that moved holds the stream and is authorized again (stream-base.ts' `stands`).
import { decodeFrame, encodeFrame, MSG_PROVISIONAL } from '@artifacts/provider/frames';
import { LengthPrefixed, lengthPrefixed } from '@artifacts/provider/frame-stream';
import { isDocKind, type ArtifactKind } from '@shared/artifacts/entity';
import { DOC_HIGH_WATER } from '@shared/host/doc-channels';
import { WITHHELD_SESSION, type StreamDataMessage, type StreamDocumentOpen } from 'org-protocol';
import { dispatchAs, type EndpointServices } from './services';
import type { RemoteChannel } from './channels';
import { Stream, type ReadAccess, type ReadOpening, type ReadPlane } from './stream-base';

/** The endpoint's document channels: numbers from 2^31 (EndpointServices.documents; main's are below). */
const CHANNEL_BASE = 2 ** 31;
const CHANNEL_SPAN = 2 ** 31;
/**
 * The host's frames queued for the device behind the one being sent, at most (their prefixes counted), as the host's socket
 * admits a frame while what is queued before it is within its high-water mark (doc-channels.ts): a host frame that finds
 * more closes the stream `behind`. The frame being sent is not counted, so one frame of any size up to DOCUMENT_FRAME_MAX
 * (frame-stream.ts) goes, and the frames after it are measured against what waits behind it, never against it.
 */
export const DOCUMENT_BACKLOG_BYTES = DOC_HIGH_WATER;
/**
 * The document bytes one link (a device's channel) retains, at most: every document stream's frames queued for the device
 * (their 4-byte prefixes counted) and the frame it is assembling from the device (its storage). Checked as the host checks
 * its socket's queue (doc-channels.ts), before a stream's next frame is admitted and never against the frame in flight:
 * a host frame, or a device chunk, that finds the rest of the link holding more closes its stream `behind`, its bytes
 * given back. "The rest" leaves out the stream's own frame being sent and its own frame being assembled, so a single
 * frame of up to DOCUMENT_FRAME_MAX always goes on a stream that holds nothing else, however busy the link: a link holds
 * at most this, plus the frame each admission lets through past it.
 */
export const DOCUMENT_LINK_BUDGET = 64 * 1024 * 1024;
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
  /** Each link's document streams, whose retained bytes share DOCUMENT_LINK_BUDGET. */
  const links = new Map<RemoteChannel, Set<DocumentStream>>();
  let next = 0;
  /** A number of the range no stream holds. */
  const allocate = (): number => {
    for (;;) {
      const channel = CHANNEL_BASE + (next++ % CHANNEL_SPAN);
      if (!streams.has(channel)) return channel;
    }
  };

  const open: ReadPlane = async (opening) => {
    const { artifactId, doc, mode } = opening.input as StreamDocumentOpen;
    const dispatch = dispatchAs(ctx.dispatch, opening.channel.client);
    const [found, readOnly] = await Promise.all([dispatch('engine-host', 'artifacts.get', { artifactId }), mode === 'edit' ? storeReadOnly(dispatch, opening.log) : false]);
    if (opening.cancelled()) return;
    if (!found.ok) {
      opening.log(`endpoint: a document's artifact could not be read: ${found.error.code}`);
      return opening.refuse('unavailable');
    }
    const artifact = isObject(found.value) && isObject(found.value.artifact) ? found.value.artifact : null;
    if (artifact === null) return opening.refuse('grade');
    if (!isDocKind(artifact.kind as ArtifactKind)) return opening.refuse('malformed');
    // A store a newer build wrote is opened read-only, and its host refuses the first changing frame: an `edit` open is
    // answered as the machine's read-only policy answers one, and the device opens `view`, its editor read-only.
    if (readOnly) return opening.refuse('read-only');
    const decided = await opening.decide((access) => {
      if (opening.cancelled()) return 'gone' as const;
      const channel = allocate();
      let link = links.get(opening.channel);
      if (link === undefined) links.set(opening.channel, (link = new Set()));
      const peers = link;
      const stream = new DocumentStream(opening, access, channel, ctx.documents, peers, () => {
        streams.delete(channel);
        peers.delete(stream);
        if (peers.size === 0 && links.get(opening.channel) === peers) links.delete(opening.channel);
      });
      streams.set(channel, stream);
      peers.add(stream);
      if (!ctx.documents.open({ t: 'documents.open', channel, artifactId, actor: { kind: 'human' }, ...(doc === undefined ? {} : { doc }) })) {
        streams.delete(channel);
        peers.delete(stream);
        if (peers.size === 0 && links.get(opening.channel) === peers) links.delete(opening.channel);
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
  readonly #frames = new LengthPrefixed();
  /** A `view` open's device frames dropped: how many, and their bytes. */
  #dropped = { frames: 0, bytes: 0 };
  /** The channel is open on the host's side. */
  #upstream = true;
  /** Where each host frame queued for the device ends, in `#out`'s count; `#head` indexes the one being sent. */
  readonly #ends: number[] = [];
  #head = 0;
  readonly #log: (line: string) => void;

  constructor(
    opening: ReadOpening,
    access: ReadAccess,
    readonly docChannel: number,
    private readonly documents: DocumentChannels,
    /** The document streams of its link (itself among them), which share DOCUMENT_LINK_BUDGET. */
    private readonly peers: ReadonlySet<DocumentStream>,
    private readonly released: () => void,
  ) {
    super(opening.id, opening.channel, opening.act, opening.binding, opening.credit, opening.window, opening.over);
    this.read = access;
    this.#log = opening.log;
  }

  /** A frame of the host's, length-prefixed, queued for the device's credit. */
  hostFrame(bytes: Uint8Array): void {
    if (this.ended || !this.#upstream) return;
    const frame = withheld(bytes);
    if (frame === null) return this.#log(`endpoint: a document's provisional frame was not read, and not sent (${bytes.byteLength} bytes)`);
    if (this.#queuedBehindHead() > DOCUMENT_BACKLOG_BYTES || this.#restOfLink() > DOCUMENT_LINK_BUDGET) return this.end('behind');
    const out = lengthPrefixed(frame);
    this.push(this.#out, out);
    this.#out += out.byteLength;
    this.#ends.push(this.#out);
  }

  /** What this stream retains: its frames queued for the device and the frame it is assembling. */
  get retained(): number {
    return this.backlog + this.#frames.held;
  }

  /** What its link retains but for this stream's own frames in flight (the one being sent, the one being assembled). */
  #restOfLink(): number {
    let rest = 0;
    for (const peer of this.peers) rest += peer.retained;
    const sending = this.backlog - this.#queuedBehindHead();
    return rest - sending - this.#frames.held;
  }

  /** The bytes queued behind the frame being sent (none when it is the only one, or nothing is queued). */
  #queuedBehindHead(): number {
    const sent = this.#out - this.backlog;
    while (this.#head < this.#ends.length && this.#ends[this.#head] <= sent) this.#head++;
    if (this.#head === this.#ends.length) {
      this.#ends.length = 0;
      this.#head = 0;
      return 0;
    }
    if (this.#head >= 1024) {
      this.#ends.splice(0, this.#head);
      this.#head = 0;
    }
    return this.#out - this.#ends[this.#head];
  }

  /** The channel ended on the host's side: the stream closes with its word once what it holds is sent. */
  hostClosed(reason: ChannelEnd): void {
    if (this.ended) return;
    this.#upstream = false;
    this.closeAfter(reason);
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
    if (this.#inbox.length === 0 || this.ended || this.held || !this.stands()) return;
    while (this.#inbox.length > 0 && !this.ended) {
      const chunk = this.#inbox.shift()!;
      if (this.#restOfLink() > DOCUMENT_LINK_BUDGET) return this.end('behind');
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
 * Whether the machine's artifact store is read-only (`artifacts.status`, as the local editor reads it): one a newer build
 * wrote. A status that can't be read is taken as writable, logged: the host still refuses a write it can't keep.
 */
async function storeReadOnly(dispatch: EndpointServices['dispatch'], log: (line: string) => void): Promise<boolean> {
  try {
    const answer = await dispatch('engine-host', 'artifacts.status', undefined);
    if (answer.ok) return isObject(answer.value) && answer.value.status === 'readOnly';
    log(`endpoint: the artifact store's status could not be read: ${answer.error.code}`);
  } catch (error) {
    log(`endpoint: the artifact store's status could not be read: ${(error as Error).message}`);
  }
  return false;
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
