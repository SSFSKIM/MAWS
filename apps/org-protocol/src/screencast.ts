// The `browser.screencast` stream's carriage (P5 O17 M9a, behind `rl2.browser-screencast`; RL2_PROTOCOL 1.8;
// docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §K): what crosses on a read open of that kind, each
// side's one definition of it. The endpoint writes frames, the device reads them and sends the controls.
//
// A frame is a u32be metadata length, the metadata as UTF-8 JSON (the frame without its JPEG, plus `jpegBytes`; at most
// SCREENCAST_META_MAX), then the JPEG (at most SCREENCAST_JPEG_MAX). Frames follow one another at continuous byte offsets
// across the stream's `streamData` chunks, so a frame may be split across many chunks and a chunk may end one frame and
// begin the next; a receiver holds at most one incomplete frame. The receiver refunds byte credit as chunks arrive (one
// opening credit is smaller than a maximum frame); frame credit is the viewer's `ack`, which alone lets the next frame go.
// The endpoint holds at most SCREENCAST_BACKLOG_BYTES past the device's credit for one stream, in place of a pty's
// backlog.
//
// The controls (`streamControl`, device to endpoint): `{ack: {seq}}`, the frame `seq` drawn or deliberately dropped, and
// `{input: {seq, event}}`, one input of a controlling stream, its `event` the app's `BrowserInput` (read at the endpoint's
// side of the feed, against the viewport of the frame it last sent). Every word a stream closes with is hyphenated, as
// RL2's are.

/** The most metadata one frame carries, in UTF-8 bytes. */
export const SCREENCAST_META_MAX = 4 * 1024;
/** The most JPEG one frame carries. */
export const SCREENCAST_JPEG_MAX = 1024 * 1024;
/** The largest frame's envelope. */
export const SCREENCAST_FRAME_MAX = 4 + SCREENCAST_META_MAX + SCREENCAST_JPEG_MAX;
/** What an endpoint holds for one stream past the device's credit: one frame plus 4 KiB; past it the stream closes `behind`. */
export const SCREENCAST_BACKLOG_BYTES = SCREENCAST_FRAME_MAX + 4 * 1024;

/**
 * Why a `browser.screencast` stream closes: its tab closed, its epoch's tab engine changed, a frame past the bound, the
 * tab's view gone, the producer failed, its control revoked (view kept), its input queue overflowed, its view revoked
 * (`removed`), its channel lost (`carrier`), or closed by its own side.
 */
export const SCREENCAST_CLOSES = ['tab-closed', 'engine-changed', 'frame-too-large', 'view-gone', 'producer-failed', 'control-revoked', 'input-overflow', 'removed', 'carrier', 'closed'] as const;
export type ScreencastClose = (typeof SCREENCAST_CLOSES)[number];

/** One frame: `epoch` is `mawsd`'s for the session's route, `capturedAt` the source's monotonic ms, `viewport` the tab's input coordinates. */
export type ScreencastFrameMeta = { epoch: string; tabId: string; seq: number; capturedAt: number; width: number; height: number; viewport: { width: number; height: number } };
export type ScreencastFrame = ScreencastFrameMeta & { jpeg: Uint8Array };

/** A device's control on a `browser.screencast` stream. */
export type ScreencastControl = { ack: { seq: number } } | { input: { seq: number; event: unknown } };

/** Why an envelope could not be written or read: its metadata past the bound, its JPEG past it, a chunk off its offset, or out of shape. */
export class ScreencastError extends Error {
  readonly reason: 'meta-too-large' | 'frame-too-large' | 'gap' | 'malformed';
  constructor(reason: ScreencastError['reason'], message: string) {
    super(message);
    this.name = 'ScreencastError';
    this.reason = reason;
  }
}

type Fields = Record<string, unknown>;
const isObject = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown) => typeof v === 'string' && v !== '' && v.length <= 256;
const isSeq = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
const MAX_PIXELS = 16_384;
const isSize = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_PIXELS;
const isViewport = (v: unknown) => isObject(v) && isSize(v.width) && isSize(v.height);
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** A frame's envelope; throws ScreencastError when its metadata or its JPEG is past its bound, or its JPEG empty. */
export function encodeScreencastFrame(frame: ScreencastFrame): Uint8Array {
  const { jpeg, epoch, tabId, seq, capturedAt, width, height, viewport } = frame;
  if (jpeg.byteLength === 0) throw new ScreencastError('malformed', 'a frame with no JPEG');
  if (jpeg.byteLength > SCREENCAST_JPEG_MAX) throw new ScreencastError('frame-too-large', `a JPEG of ${jpeg.byteLength} bytes, past ${SCREENCAST_JPEG_MAX}`);
  const meta = encoder.encode(JSON.stringify({ epoch, tabId, seq, capturedAt, width, height, viewport, jpegBytes: jpeg.byteLength }));
  if (meta.byteLength > SCREENCAST_META_MAX) throw new ScreencastError('meta-too-large', `metadata of ${meta.byteLength} bytes, past ${SCREENCAST_META_MAX}`);
  const out = new Uint8Array(4 + meta.byteLength + jpeg.byteLength);
  new DataView(out.buffer).setUint32(0, meta.byteLength);
  out.set(meta, 4);
  out.set(jpeg, 4 + meta.byteLength);
  return out;
}

/** A frame's metadata read from its JSON, or a ScreencastError: the fields of a frame, and a JPEG within the bound. */
function readMeta(bytes: Uint8Array): ScreencastFrameMeta & { jpegBytes: number } {
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(Uint8Array.from(bytes)));
  } catch {
    throw new ScreencastError('malformed', 'frame metadata that is no UTF-8 JSON');
  }
  if (!isObject(value)) throw new ScreencastError('malformed', 'frame metadata that is no object');
  const { epoch, tabId, seq, capturedAt, width, height, viewport, jpegBytes } = value;
  const shaped = isText(epoch) && isText(tabId) && isSeq(seq) && typeof capturedAt === 'number' && Number.isFinite(capturedAt) && capturedAt >= 0 && isSize(width) && isSize(height) && isViewport(viewport) && isSeq(jpegBytes);
  if (!shaped) throw new ScreencastError('malformed', 'frame metadata out of shape');
  if (jpegBytes > SCREENCAST_JPEG_MAX) throw new ScreencastError('frame-too-large', `a JPEG of ${jpegBytes} bytes, past ${SCREENCAST_JPEG_MAX}`);
  const port = viewport as { width: number; height: number };
  return { epoch, tabId, seq, capturedAt, width, height, viewport: { width: port.width, height: port.height }, jpegBytes } as ScreencastFrameMeta & { jpegBytes: number };
}

/**
 * The frames of one stream read from its chunks in order (`push`, each at its `streamData` offset): the complete frames a
 * chunk finishes, holding the one it begins. A chunk off the next offset, or an envelope out of shape or past a bound,
 * throws a ScreencastError, after which the reader takes nothing more; the stream is then closed by its receiver.
 */
export class ScreencastFrameReader {
  /** The bytes taken so far: the next chunk's offset. */
  #offset = 0;
  /** The incomplete frame: its header, then its metadata, then its JPEG. */
  #head = new Uint8Array(4);
  #headAt = 0;
  #meta: Uint8Array | null = null;
  #metaAt = 0;
  #frame: (ScreencastFrameMeta & { jpegBytes: number }) | null = null;
  #jpeg: Uint8Array | null = null;
  #jpegAt = 0;
  #failed = false;

  /** The bytes of the incomplete frame held. */
  get pending(): number {
    return this.#headAt + this.#metaAt + this.#jpegAt;
  }

  push(offset: number, chunk: Uint8Array): ScreencastFrame[] {
    if (this.#failed) throw new ScreencastError('malformed', 'a reader that already refused its stream');
    try {
      if (offset !== this.#offset) throw new ScreencastError('gap', `a chunk at ${offset}, where ${this.#offset} was next`);
      this.#offset += chunk.byteLength;
      const frames: ScreencastFrame[] = [];
      let at = 0;
      while (at < chunk.byteLength) {
        if (this.#meta === null) {
          const n = Math.min(4 - this.#headAt, chunk.byteLength - at);
          this.#head.set(chunk.subarray(at, at + n), this.#headAt);
          this.#headAt += n;
          at += n;
          if (this.#headAt < 4) break;
          const length = new DataView(this.#head.buffer).getUint32(0);
          if (length === 0) throw new ScreencastError('malformed', 'a frame with no metadata');
          if (length > SCREENCAST_META_MAX) throw new ScreencastError('meta-too-large', `metadata of ${length} bytes, past ${SCREENCAST_META_MAX}`);
          this.#meta = new Uint8Array(length);
          continue;
        }
        if (this.#frame === null) {
          const n = Math.min(this.#meta.byteLength - this.#metaAt, chunk.byteLength - at);
          this.#meta.set(chunk.subarray(at, at + n), this.#metaAt);
          this.#metaAt += n;
          at += n;
          if (this.#metaAt < this.#meta.byteLength) break;
          this.#frame = readMeta(this.#meta);
          this.#jpeg = new Uint8Array(this.#frame.jpegBytes);
          continue;
        }
        const jpeg = this.#jpeg!;
        const n = Math.min(jpeg.byteLength - this.#jpegAt, chunk.byteLength - at);
        jpeg.set(chunk.subarray(at, at + n), this.#jpegAt);
        this.#jpegAt += n;
        at += n;
        if (this.#jpegAt < jpeg.byteLength) break;
        const { epoch, tabId, seq, capturedAt, width, height, viewport } = this.#frame;
        frames.push({ epoch, tabId, seq, capturedAt, width, height, viewport, jpeg });
        this.#headAt = 0;
        this.#meta = null;
        this.#metaAt = 0;
        this.#frame = null;
        this.#jpeg = null;
        this.#jpegAt = 0;
      }
      return frames;
    } catch (error) {
      this.#failed = true;
      throw error;
    }
  }
}

/** A device's control read: exactly an acknowledgement or an input, each by a positive safe-integer sequence; else null. */
export function readScreencastControl(control: unknown): ScreencastControl | null {
  if (!isObject(control)) return null;
  const keys = Object.keys(control);
  if (keys.length !== 1) return null;
  const { ack, input } = control;
  if (keys[0] === 'ack') return isObject(ack) && isSeq(ack.seq) ? { ack: { seq: ack.seq } } : null;
  if (keys[0] === 'input') return isObject(input) && isSeq(input.seq) && 'event' in input ? { input: { seq: input.seq, event: input.event } } : null;
  return null;
}
