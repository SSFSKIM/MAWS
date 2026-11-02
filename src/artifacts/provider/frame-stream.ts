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

/** Frames out of a byte flow where each is prefixed by its u32be length, assembled across the chunks it comes in. */
export class LengthPrefixed {
  readonly #parts: Uint8Array[] = [];
  #size = 0;
  /** The frame being assembled's length, once its prefix is read. */
  #length: number | null = null;

  constructor(private readonly max: number = DOCUMENT_FRAME_MAX) {}

  /** The frames `chunk` completes, in order, each an exact-size copy; null once a length is 0 or past the most a frame may be. */
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
