// The `browser.screencast` stream's carriage (P5 O17 M9a; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md,
// Interfaces §K): each frame a u32be metadata length, the metadata as UTF-8 JSON (at most 4 KiB), then the JPEG (at most
// 1 MiB), at continuous byte offsets across the stream's chunks; a receiver holds one incomplete frame. The controls the
// device sends on it, and the words it closes with.
import { describe, expect, it } from 'vitest';
import { STREAM_CHUNK_BYTES } from '../src/messages.ts';
import {
  encodeScreencastFrame,
  readScreencastControl,
  SCREENCAST_BACKLOG_BYTES,
  SCREENCAST_CLOSES,
  SCREENCAST_FRAME_MAX,
  SCREENCAST_JPEG_MAX,
  SCREENCAST_META_MAX,
  ScreencastError,
  ScreencastFrameReader,
  type ScreencastFrame,
} from '../src/screencast.ts';

const frame = (seq: number, jpegBytes = 1000, fields: Partial<ScreencastFrame> = {}): ScreencastFrame => ({
  epoch: 'ep-1',
  tabId: 'tab-1',
  seq,
  capturedAt: 1234.5,
  width: 1280,
  height: 800,
  viewport: { width: 1280, height: 800 },
  jpeg: Uint8Array.from({ length: jpegBytes }, (_, i) => (i * 7 + seq) & 0xff),
  ...fields,
});

/** `bytes` cut into chunks of at most `size`, each with its offset, as `streamData` carries them. */
function chunks(bytes: Uint8Array, size: number, from = 0): Array<[number, Uint8Array]> {
  const out: Array<[number, Uint8Array]> = [];
  for (let at = 0; at < bytes.byteLength; at += size) out.push([from + at, bytes.subarray(at, Math.min(at + size, bytes.byteLength))]);
  return out;
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
};

/** A frame's envelope written by hand: `meta` as given (any JSON), then `jpeg`. */
function envelope(meta: unknown, jpeg: Uint8Array, length?: number): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(meta));
  const head = new Uint8Array(4);
  new DataView(head.buffer).setUint32(0, length ?? text.byteLength);
  return concat(head, text, jpeg);
}

const errorOf = (run: () => unknown): string | null => {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof ScreencastError ? error.reason : `not a ScreencastError: ${String(error)}`;
  }
};

describe('the bounds', () => {
  it('are §K’s: 4 KiB of metadata, 1 MiB of JPEG, a backlog of one frame plus 4 KiB', () => {
    expect([SCREENCAST_META_MAX, SCREENCAST_JPEG_MAX]).toEqual([4096, 1_048_576]);
    expect(SCREENCAST_FRAME_MAX).toBe(4 + 4096 + 1_048_576);
    expect(SCREENCAST_BACKLOG_BYTES).toBe(SCREENCAST_FRAME_MAX + 4096);
  });

  it('closes with hyphenated words only, as RL2’s are', () => {
    expect([...SCREENCAST_CLOSES]).toEqual(['tab-closed', 'engine-changed', 'frame-too-large', 'view-gone', 'producer-failed', 'control-revoked', 'input-overflow', 'removed', 'carrier', 'closed']);
    for (const word of SCREENCAST_CLOSES) expect(word).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });
});

describe('a frame’s envelope', () => {
  it('reads back what it wrote, its metadata naming the JPEG’s length', () => {
    const bytes = encodeScreencastFrame(frame(3));
    const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0);
    const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + length)));
    expect(meta).toEqual({ epoch: 'ep-1', tabId: 'tab-1', seq: 3, capturedAt: 1234.5, width: 1280, height: 800, viewport: { width: 1280, height: 800 }, jpegBytes: 1000 });
    expect(bytes.byteLength).toBe(4 + length + 1000);
    expect(new ScreencastFrameReader().push(0, bytes)).toEqual([frame(3)]);
  });

  it('refuses to write metadata past 4 KiB or a JPEG past 1 MiB, or none', () => {
    expect(errorOf(() => encodeScreencastFrame(frame(1, 10, { tabId: 'x'.repeat(SCREENCAST_META_MAX) })))).toBe('meta-too-large');
    expect(errorOf(() => encodeScreencastFrame(frame(1, SCREENCAST_JPEG_MAX + 1)))).toBe('frame-too-large');
    expect(errorOf(() => encodeScreencastFrame(frame(1, 0)))).toBe('malformed');
    expect(encodeScreencastFrame(frame(1, SCREENCAST_JPEG_MAX)).byteLength).toBeLessThanOrEqual(SCREENCAST_FRAME_MAX);
  });
});

describe('the reader', () => {
  it('assembles a maximum frame split across many chunks, and the frames after it, at continuous offsets', () => {
    const big = encodeScreencastFrame(frame(1, SCREENCAST_JPEG_MAX));
    const small = encodeScreencastFrame(frame(2, 10));
    const reader = new ScreencastFrameReader();
    const out: ScreencastFrame[] = [];
    for (const [offset, chunk] of chunks(concat(big, small), STREAM_CHUNK_BYTES)) out.push(...reader.push(offset, chunk));
    expect(out.map((f) => [f.seq, f.jpeg.byteLength])).toEqual([
      [1, SCREENCAST_JPEG_MAX],
      [2, 10],
    ]);
    expect(out[0]).toEqual(frame(1, SCREENCAST_JPEG_MAX));
    expect(reader.pending).toBe(0);
  });

  it('takes chunks a byte at a time, and two frames in one chunk', () => {
    const both = concat(encodeScreencastFrame(frame(1, 5)), encodeScreencastFrame(frame(2, 6)));
    const reader = new ScreencastFrameReader();
    const out = chunks(both, 1).flatMap(([offset, chunk]) => reader.push(offset, chunk));
    expect(out).toEqual([frame(1, 5), frame(2, 6)]);
    expect(new ScreencastFrameReader().push(0, both)).toEqual([frame(1, 5), frame(2, 6)]);
  });

  it('holds one incomplete frame, saying how much of it it holds', () => {
    const bytes = encodeScreencastFrame(frame(1, 100));
    const reader = new ScreencastFrameReader();
    expect(reader.push(0, bytes.subarray(0, 50))).toEqual([]);
    expect(reader.pending).toBe(50);
    expect(reader.push(50, bytes.subarray(50))).toEqual([frame(1, 100)]);
    expect(reader.pending).toBe(0);
  });

  it('refuses a chunk not at the next offset (`gap`)', () => {
    const bytes = encodeScreencastFrame(frame(1, 100));
    const reader = new ScreencastFrameReader();
    reader.push(0, bytes.subarray(0, 10));
    expect(errorOf(() => reader.push(11, bytes.subarray(11)))).toBe('gap');
    expect(errorOf(() => new ScreencastFrameReader().push(3, bytes))).toBe('gap');
  });

  it('refuses a metadata length past 4 KiB or of zero, before reading it', () => {
    expect(errorOf(() => new ScreencastFrameReader().push(0, envelope({}, new Uint8Array(0), SCREENCAST_META_MAX + 1).subarray(0, 4)))).toBe('meta-too-large');
    expect(errorOf(() => new ScreencastFrameReader().push(0, envelope({}, new Uint8Array(0), 0).subarray(0, 4)))).toBe('malformed');
  });

  it('refuses metadata that is no JSON, no frame’s, or names a JPEG past 1 MiB or none', () => {
    const good = { epoch: 'e', tabId: 't', seq: 1, capturedAt: 0, width: 10, height: 10, viewport: { width: 10, height: 10 }, jpegBytes: 3 };
    const jpeg = new Uint8Array(3);
    const raw = (text: string) => {
      const bytes = new TextEncoder().encode(text);
      const head = new Uint8Array(4);
      new DataView(head.buffer).setUint32(0, bytes.byteLength);
      return concat(head, bytes, jpeg);
    };
    expect(new ScreencastFrameReader().push(0, envelope(good, jpeg))).toHaveLength(1);
    expect(errorOf(() => new ScreencastFrameReader().push(0, raw('{not json')))).toBe('malformed');
    expect(errorOf(() => new ScreencastFrameReader().push(0, raw('[1,2]')))).toBe('malformed');
    for (const bad of [
      { ...good, epoch: '' },
      { ...good, tabId: 7 },
      { ...good, seq: 0 },
      { ...good, seq: 1.5 },
      { ...good, capturedAt: -1 },
      { ...good, width: 0 },
      { ...good, height: 1.5 },
      { ...good, viewport: { width: 10 } },
      { ...good, jpegBytes: 0 },
    ])
      expect([bad, errorOf(() => new ScreencastFrameReader().push(0, envelope(bad, jpeg)))]).toEqual([bad, 'malformed']);
    expect(errorOf(() => new ScreencastFrameReader().push(0, envelope({ ...good, jpegBytes: SCREENCAST_JPEG_MAX + 1 }, jpeg)))).toBe('frame-too-large');
  });

  it('refuses metadata that is no UTF-8', () => {
    const head = new Uint8Array([0, 0, 0, 2]);
    expect(errorOf(() => new ScreencastFrameReader().push(0, concat(head, new Uint8Array([0xc3, 0x28]))))).toBe('malformed');
  });
});

describe('the controls', () => {
  it('reads an acknowledgement and an input, each by its sequence', () => {
    expect(readScreencastControl({ ack: { seq: 4 } })).toEqual({ ack: { seq: 4 } });
    expect(readScreencastControl({ input: { seq: 9, event: { kind: 'blur' } } })).toEqual({ input: { seq: 9, event: { kind: 'blur' } } });
  });

  it('refuses anything else: both at once, another key, a sequence that is no positive safe integer, an input with no event', () => {
    for (const bad of [{}, { ack: { seq: 1 }, input: { seq: 2, event: {} } }, { resize: { cols: 1, rows: 1 } }, { ack: { seq: 0 } }, { ack: { seq: 1.5 } }, { ack: {} }, { ack: 3 }, { input: { seq: 1 } }, { input: { seq: -1, event: {} } }, { ack: { seq: Number.MAX_SAFE_INTEGER + 1 } }])
      expect([bad, readScreencastControl(bad)]).toEqual([bad, null]);
  });
});
