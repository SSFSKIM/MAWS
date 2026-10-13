import { describe, expect, it } from 'vitest';
import { decodeFrame, encodeFrame, isContent, isHostOnly, MSG_ACK, MSG_AWARENESS, MSG_RESTORED, MSG_SYNC, type Frame } from './frames';

const bytes = (...values: number[]) => new Uint8Array(values);
const FRAMES: Frame[] = [
  { type: 'step1', sv: bytes(1, 2, 3) },
  { type: 'step2', update: bytes(0, 0) },
  { type: 'update', update: new Uint8Array(300).fill(7) }, // a two-byte length prefix
  { type: 'awareness', update: bytes(1, 9, 9) },
  { type: 'ack', frames: 12, revision: 2 ** 40 }, // a revision past 32 bits
  { type: 'restored', revision: 4096, versionId: 17 },
  { type: 'step1', sv: new Uint8Array(0) },
];

// A small deterministic generator (mulberry32), so a failing fuzz case reproduces.
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('document frames', () => {
  it('round-trips every frame type, the y-protocols numbering on the wire', () => {
    for (const frame of FRAMES) expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
    expect(encodeFrame({ type: 'step1', sv: bytes() })[0]).toBe(MSG_SYNC);
    expect(encodeFrame({ type: 'awareness', update: bytes() })[0]).toBe(MSG_AWARENESS);
    expect(encodeFrame({ type: 'ack', frames: 0, revision: 0 })[0]).toBe(MSG_ACK);
    expect(encodeFrame({ type: 'restored', revision: 0, versionId: 0 })[0]).toBe(MSG_RESTORED);
  });

  it('refuses trailing bytes after any frame', () => {
    for (const frame of FRAMES) {
      const encoded = encodeFrame(frame);
      const longer = new Uint8Array(encoded.length + 1);
      longer.set(encoded);
      expect(() => decodeFrame(longer), frame.type).toThrow(/trailing|short/);
    }
  });

  it('refuses every truncation of a frame', () => {
    for (const frame of FRAMES) {
      const encoded = encodeFrame(frame);
      for (let cut = 0; cut < encoded.length; cut++) expect(() => decodeFrame(encoded.subarray(0, cut)), `${frame.type} cut at ${cut}`).toThrow();
    }
  });

  it('refuses unknown frame types and unknown sync messages', () => {
    for (const type of [2, 3, 99, 102, 127]) expect(() => decodeFrame(bytes(type, 0)), `type ${type}`).toThrow(/unknown frame type/);
    expect(() => decodeFrame(bytes(MSG_SYNC, 3, 0))).toThrow(/unknown sync message/);
  });

  it('refuses anything that is not bytes', () => {
    for (const data of [undefined, null, 'frame', 0, [0, 0, 0], new ArrayBuffer(3), { type: 'step1' }]) expect(() => decodeFrame(data)).toThrow(/not bytes/);
  });

  it('under fuzzing, either throws an Error or yields a frame that re-encodes stably and refuses an extra byte', () => {
    const next = random(0x5eed);
    let decoded = 0;
    const seeds = FRAMES.map(encodeFrame);
    for (let i = 0; i < 5000; i++) {
      let input: Uint8Array;
      if (i % 2 === 0) {
        input = new Uint8Array(Math.floor(next() * 12));
        for (let j = 0; j < input.length; j++) input[j] = Math.floor(next() * 256);
      } else {
        input = seeds[i % seeds.length].slice();
        const flips = 1 + Math.floor(next() * 3);
        for (let j = 0; j < flips && input.length > 0; j++) input[Math.floor(next() * input.length)] = Math.floor(next() * 256);
      }
      let frame: Frame;
      try {
        frame = decodeFrame(input);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        continue;
      }
      decoded += 1;
      expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
      const longer = new Uint8Array(input.length + 1);
      longer.set(input);
      expect(() => decodeFrame(longer)).toThrow();
    }
    expect(decoded).toBeGreaterThan(0); // the fuzz reached the accepting path, not only refusals
  });

  it('counts step 2 and update as content (what an ack counts), nothing else', () => {
    expect(FRAMES.filter(isContent).map((frame) => frame.type)).toEqual(['step2', 'update']);
  });

  it('marks ack and restored as the host’s alone (a replica that sends one is refused)', () => {
    expect(FRAMES.filter(isHostOnly).map((frame) => frame.type)).toEqual(['ack', 'restored']);
  });
});
