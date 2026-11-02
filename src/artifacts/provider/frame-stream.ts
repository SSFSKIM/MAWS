// Document frames as one byte flow (P5 O7 M5b, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5's "The
// `document` stream"; Interfaces §N): over an RL2 `document` stream each frame (./frames.ts) goes prefixed by its u32be
// length, and the chunks the stream cuts it into are assembled back into whole frames on the other side. Both ends speak
// it: the endpoint's plane (src/endpoint/stream-document.ts) and main's bridge to a window's port
// (src/main/artifacts/remote-open.ts).
import { DOC_FRAME_CAP } from '@shared/host/socket-protocol';

/**
 * The largest document frame either end admits: the engine host's own payload cap (socket-protocol.ts' DOC_FRAME_CAP,
 * 64 MiB). Its 8 MiB high-water mark (doc-channels.ts) bounds what is queued before a frame is written, not a frame: a
 * single larger frame (a big document's first step 2) goes through locally, so it must remotely too.
 */
export const DOCUMENT_FRAME_MAX = DOC_FRAME_CAP;

/** `frame` prefixed by its u32be length, as the stream carries it. */
export function lengthPrefixed(frame: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + frame.byteLength);
  new DataView(out.buffer).setUint32(0, frame.byteLength);
  out.set(frame, 4);
  return out;
}

/** The storage a frame's assembly starts with, at most; it grows by doubling up to the frame's length. */
const FIRST_STORAGE = 64 * 1024;

/**
 * Frames out of a byte flow where each is prefixed by its u32be length, assembled across the chunks it comes in. Each frame
 * is copied into one buffer as its bytes come, grown by doubling up to the length its prefix declared, so however finely
 * the flow is cut (a peer may send a byte a chunk) it holds one buffer and a 4-byte prefix, never a list of pieces.
 */
export class LengthPrefixed {
  readonly #prefix = new Uint8Array(4);
  #prefixRead = 0;
  /** The frame being assembled: its declared length, its storage and how much of it is filled. */
  #frame: { length: number; bytes: Uint8Array; filled: number } | null = null;

  constructor(private readonly max: number = DOCUMENT_FRAME_MAX) {}

  /** The bytes held for the frame being assembled (its storage, and a prefix read in part). */
  get held(): number {
    return this.#prefixRead + (this.#frame?.bytes.byteLength ?? 0);
  }

  /** The frames `chunk` completes, in order, each an exact-size buffer; null once a length is 0 or past the most a frame may be. */
  push(chunk: Uint8Array): Uint8Array[] | null {
    const frames: Uint8Array[] = [];
    let at = 0;
    while (at < chunk.byteLength) {
      const frame = this.#frame;
      if (frame === null) {
        const take = Math.min(4 - this.#prefixRead, chunk.byteLength - at);
        this.#prefix.set(chunk.subarray(at, at + take), this.#prefixRead);
        this.#prefixRead += take;
        at += take;
        if (this.#prefixRead < 4) break;
        this.#prefixRead = 0;
        const length = new DataView(this.#prefix.buffer).getUint32(0);
        if (length === 0 || length > this.max) return null;
        this.#frame = { length, bytes: new Uint8Array(Math.min(length, FIRST_STORAGE)), filled: 0 };
        continue;
      }
      const take = Math.min(frame.length - frame.filled, chunk.byteLength - at);
      if (frame.filled + take > frame.bytes.byteLength) {
        const grown = new Uint8Array(Math.min(frame.length, Math.max(frame.filled + take, frame.bytes.byteLength * 2)));
        grown.set(frame.bytes.subarray(0, frame.filled));
        frame.bytes = grown;
      }
      frame.bytes.set(chunk.subarray(at, at + take), frame.filled);
      frame.filled += take;
      at += take;
      if (frame.filled === frame.length) {
        frames.push(frame.bytes); // grown no further than the length: exactly the frame
        this.#frame = null;
      }
    }
    return frames;
  }

  clear(): void {
    this.#prefixRead = 0;
    this.#frame = null;
  }
}
