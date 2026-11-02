// Document frames as one byte flow (frame-stream.ts; P5 O7 M5b): the frame limit is the host's own payload cap, and the
// assembler gives back each frame whole however the flow was cut.
import { describe, expect, it } from 'vitest';
import { DOC_FRAME_CAP } from '@shared/host/socket-protocol';
import { DOCUMENT_FRAME_MAX, LengthPrefixed, lengthPrefixed } from './frame-stream';

/** `n` bytes of a pattern no two neighbouring frames share (the module is portable: no Node). */
let seed = 1;
const bytesOf = (n: number): Uint8Array => {
  const out = new Uint8Array(n);
  seed = (seed * 48271) % 2147483647;
  for (let i = 0; i < n; i++) out[i] = (i * 31 + seed) & 0xff;
  return out;
};
const same = (a: Uint8Array, b: Uint8Array): boolean => a.byteLength === b.byteLength && a.every((byte, i) => byte === b[i]);
const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
};

const prefix = (length: number) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, length);
  return bytes;
};

describe('the document frame flow', () => {
  it('admits a frame up to the host’s own payload cap (64 MiB), past its 8 MiB high-water mark, and refuses a length past it or of 0', () => {
    expect(DOCUMENT_FRAME_MAX).toBe(DOC_FRAME_CAP);
    const frame = bytesOf(20 * 1024 * 1024);
    const frames = new LengthPrefixed().push(lengthPrefixed(frame));
    expect(frames).toHaveLength(1);
    expect(same(frames![0], frame)).toBe(true);
    expect(new LengthPrefixed().push(prefix(DOC_FRAME_CAP))).toEqual([]);
    expect(new LengthPrefixed().push(prefix(DOC_FRAME_CAP + 1))).toBeNull();
    expect(new LengthPrefixed().push(prefix(0))).toBeNull();
  });

  it('assembles a frame sent a byte at a time into one buffer: what it holds stays within the frame, and completing it is quick', () => {
    const frame = bytesOf(256 * 1024);
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
    expect(same(out[0], frame)).toBe(true);
    expect(out[0].byteLength).toBe(frame.byteLength);
    expect(most).toBeLessThanOrEqual(frame.byteLength);
    expect(assembler.held).toBe(0);
  });

  it('gives back frames that start and end anywhere in the chunks, a prefix split across them included', () => {
    const frames = [bytesOf(10), bytesOf(70_000), bytesOf(1), bytesOf(3)];
    const flow = concat(frames.map((frame) => lengthPrefixed(frame)));
    for (const cut of [1, 2, 3, 5, 4096, 65_537]) {
      const assembler = new LengthPrefixed();
      const out: Uint8Array[] = [];
      for (let at = 0; at < flow.byteLength; at += cut) out.push(...assembler.push(flow.subarray(at, at + cut))!);
      expect([cut, out.length, out.every((frame, i) => same(frame, frames[i]))]).toEqual([cut, frames.length, true]);
    }
  });
});
