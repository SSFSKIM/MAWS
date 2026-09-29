import { describe, expect, it } from 'vitest';
import { RingBuffer } from './ring';

const bytes = (...values: number[]) => new Uint8Array(values);
const range = (from: number, to: number) => Uint8Array.from({ length: to - from }, (_, i) => (from + i) % 256);

describe('pty host ring buffer and attach offsets', () => {
  it('starts empty at offset 0', () => {
    const ring = new RingBuffer(8);
    expect([ring.start, ring.end]).toEqual([0, 0]);
    expect(ring.since(0)).toEqual(bytes());
  });

  it('keeps every byte until it is full, addressed by stream offset', () => {
    const ring = new RingBuffer(8);
    ring.append(bytes(1, 2, 3));
    ring.append(bytes(4, 5));
    expect([ring.start, ring.end]).toEqual([0, 5]);
    expect(ring.since(0)).toEqual(bytes(1, 2, 3, 4, 5));
    expect(ring.since(3)).toEqual(bytes(4, 5));
    expect(ring.since(5)).toEqual(bytes());
    expect(ring.since(9)).toEqual(bytes());
  });

  it('drops the oldest bytes across the wrap and answers from its start for an offset it no longer holds', () => {
    const ring = new RingBuffer(8);
    ring.append(range(0, 6));
    ring.append(range(6, 11)); // wraps: holds 3..10
    expect([ring.start, ring.end]).toEqual([3, 11]);
    expect(ring.since(0)).toEqual(range(3, 11));
    expect(ring.since(7)).toEqual(range(7, 11));
  });

  it('keeps only the tail of a chunk larger than itself', () => {
    const ring = new RingBuffer(8);
    ring.append(range(0, 3));
    ring.append(range(3, 23));
    expect([ring.start, ring.end]).toEqual([15, 23]);
    expect(ring.since(0)).toEqual(range(15, 23));
  });

  it('matches the tail of the stream after many uneven appends', () => {
    const ring = new RingBuffer(64);
    let offset = 0;
    for (const size of [1, 7, 63, 64, 65, 3, 128, 5, 30]) {
      ring.append(range(offset, offset + size));
      offset += size;
      expect(ring.end).toBe(offset);
      expect(ring.since(0)).toEqual(range(Math.max(0, offset - 64), offset));
    }
  });

  it('returns a copy the caller may keep while the ring moves on', () => {
    const ring = new RingBuffer(4);
    ring.append(bytes(1, 2, 3));
    const copy = ring.since(0);
    ring.append(bytes(9, 9, 9, 9));
    expect(copy).toEqual(bytes(1, 2, 3));
  });
});
