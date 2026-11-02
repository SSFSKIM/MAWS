// Document frames as one byte flow (frame-stream.ts; P5 O7 M5b): the frame limit is the host's own payload cap, and the
// assembler gives back each frame whole however the flow was cut.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DOC_FRAME_CAP } from '@shared/host/socket-protocol';
import { DOCUMENT_FRAME_MAX, LengthPrefixed, lengthPrefixed } from './frame-stream';

const prefix = (length: number) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, length);
  return bytes;
};

describe('the document frame flow', () => {
  it('admits a frame up to the host’s own payload cap (64 MiB), past its 8 MiB high-water mark, and refuses a length past it or of 0', () => {
    expect(DOCUMENT_FRAME_MAX).toBe(DOC_FRAME_CAP);
    const frame = randomBytes(20 * 1024 * 1024);
    const frames = new LengthPrefixed().push(lengthPrefixed(frame));
    expect(frames).toHaveLength(1);
    expect(Buffer.from(frames![0]).equals(frame)).toBe(true);
    expect(new LengthPrefixed().push(prefix(DOC_FRAME_CAP))).toEqual([]);
    expect(new LengthPrefixed().push(prefix(DOC_FRAME_CAP + 1))).toBeNull();
    expect(new LengthPrefixed().push(prefix(0))).toBeNull();
  });

  it('assembles a frame sent a byte at a time into one buffer: what it holds stays within the frame, and completing it is quick', () => {
    const frame = randomBytes(256 * 1024);
    const flow = lengthPrefixed(frame);
    const assembler = new LengthPrefixed();
    const started = Date.now();
    const out: Uint8Array[] = [];
    let most = 0;
    for (let i = 0; i < flow.byteLength; i++) {
      out.push(...assembler.push(flow.subarray(i, i + 1))!);
      most = Math.max(most, assembler.held);
    }
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(out).toHaveLength(1);
    expect(Buffer.from(out[0]).equals(frame)).toBe(true);
    expect(out[0].byteLength).toBe(frame.byteLength);
    expect(most).toBeLessThanOrEqual(frame.byteLength);
    expect(assembler.held).toBe(0);
  });

  it('gives back frames that start and end anywhere in the chunks, a prefix split across them included', () => {
    const frames = [randomBytes(10), randomBytes(70_000), randomBytes(1), randomBytes(3)];
    const flow = Buffer.concat(frames.map((frame) => lengthPrefixed(frame)));
    for (const cut of [1, 2, 3, 5, 4096, 65_537]) {
      const assembler = new LengthPrefixed();
      const out: Uint8Array[] = [];
      for (let at = 0; at < flow.byteLength; at += cut) out.push(...assembler.push(flow.subarray(at, at + cut))!);
      expect([cut, out.map((frame) => Buffer.from(frame).toString('hex'))]).toEqual([cut, frames.map((frame) => frame.toString('hex'))]);
    }
  });
});
