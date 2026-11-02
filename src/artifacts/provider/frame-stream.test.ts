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
});
