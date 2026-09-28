// An in-memory `FileReader` for the chain follower: a buffer that grows in steps under the test's control, recording
// every range read so the tailer's contiguity invariant (C4 execution document, "Chain follower and backfill") can be
// asserted. `replace` gives the buffer a new inode, the shape of the engine's temp-and-rename rewrite.
import type { FileReader } from '../../src/engine-host/fs/chain-follower';

export interface ReadRange {
  offset: number;
  length: number;
}

export class MemoryFileReader implements FileReader {
  readonly path: string;
  readonly ranges: ReadRange[] = [];
  private bytes: Buffer;
  private ino: number;
  private present: boolean;

  constructor(initial: Buffer | string = Buffer.alloc(0), opts: { exists?: boolean; path?: string; ino?: number } = {}) {
    this.bytes = Buffer.from(initial);
    this.present = opts.exists ?? true;
    this.path = opts.path ?? '/memory/transcript.jsonl';
    this.ino = opts.ino ?? 1;
  }

  get size(): number {
    return this.bytes.length;
  }

  async stat(): Promise<{ ino: number; size: number } | null> {
    return this.present ? { ino: this.ino, size: this.bytes.length } : null;
  }

  async read(offset: number, length: number): Promise<Buffer> {
    this.ranges.push({ offset, length });
    return Buffer.from(this.bytes.subarray(offset, offset + length));
  }

  append(bytes: Buffer | string): void {
    this.bytes = Buffer.concat([this.bytes, Buffer.from(bytes)]);
    this.present = true;
  }

  // The engine's GC shape: a new file under the same name, so the inode changes.
  replace(bytes: Buffer | string): void {
    this.bytes = Buffer.from(bytes);
    this.ino += 1;
    this.present = true;
  }

  remove(): void {
    this.present = false;
  }

  // Ranges as read, checked for the tailer's invariant: contiguous, ascending, disjoint, union exactly [0, size).
  assertContiguous(expectedSize: number): void {
    let next = 0;
    for (const range of this.ranges) {
      if (range.offset !== next) throw new Error(`read at ${range.offset} but the cursor was ${next} (ranges ${JSON.stringify(this.ranges)})`);
      if (range.length <= 0) throw new Error(`empty read at ${range.offset}`);
      next += range.length;
    }
    if (next !== expectedSize) throw new Error(`ranges cover [0, ${next}) but the file is ${expectedSize} bytes`);
  }
}
