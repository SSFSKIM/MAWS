// The last `capacity` bytes of one pty's output, addressed by stream offset (C9 Residue *PTY stream and flow
// control*): what a renderer that reconnects is replayed. A fixed `Uint8Array` with a write cursor; `start` is the
// stream offset of the oldest byte it still holds, `end` the offset one past the newest.
export class RingBuffer {
  private readonly buffer: Uint8Array;
  private written = 0;

  constructor(readonly capacity: number) {
    this.buffer = new Uint8Array(capacity);
  }

  get end(): number {
    return this.written;
  }

  get start(): number {
    return Math.max(0, this.written - this.capacity);
  }

  append(chunk: Uint8Array): void {
    const tail = chunk.byteLength > this.capacity ? chunk.subarray(chunk.byteLength - this.capacity) : chunk;
    const skipped = chunk.byteLength - tail.byteLength;
    const at = (this.written + skipped) % this.capacity;
    const first = Math.min(tail.byteLength, this.capacity - at);
    this.buffer.set(tail.subarray(0, first), at);
    this.buffer.set(tail.subarray(first), 0);
    this.written += chunk.byteLength;
  }

  // A copy of the bytes for [max(offset, start), end), in stream order.
  since(offset: number): Uint8Array<ArrayBuffer> {
    const from = Math.max(offset, this.start);
    if (from >= this.written) return new Uint8Array(0);
    const out = new Uint8Array(this.written - from);
    const at = from % this.capacity;
    const first = Math.min(out.byteLength, this.capacity - at);
    out.set(this.buffer.subarray(at, at + first), 0);
    out.set(this.buffer.subarray(0, out.byteLength - first), first);
    return out;
  }
}
