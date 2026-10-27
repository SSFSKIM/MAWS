// RL2's sealed frames (Interfaces §A of docs/doperpowers/plans/2026-10-27-p5-o10-endpoint.md) and the HKDF they and
// the handshake's key schedule use:
//
//     frame  = header ‖ AES-256-GCM(key[epoch], nonce = iv[epoch] ‖ u64 BE seq, aad = header, plaintext)
//     header = u8 version (1) ‖ u8 keyEpoch ‖ u64 BE seq                                  (10 bytes)
//
// One sequence per direction for the channel's life, from 0, never reset: the receiver takes exactly the next one, under
// the current epoch or the next (mod 256), and anything else closes. A rekey keeps counting, so dropping an epoch's last
// frame is a gap like any other. The sender rekeys after 2^20 frames in an epoch or 24 hours, by a one-way ratchet
//
//     key' = HKDF-Expand(key, 'smns-rl2-v1 rekey', 32),  iv' = HKDF-Expand(key, 'smns-rl2-v1 rekey iv', 4)
//
// which needs no message, and the receiver needs no notice of it. HKDF (RFC 5869, SHA-256) is written over HMAC so its
// two halves are separate calls, as the key schedule names them.
import { utf8 } from './keys.ts';

export type DirectionKeys = { key: Uint8Array<ArrayBuffer>; iv: Uint8Array<ArrayBuffer> };
export type FrameRefusal = 'malformed' | 'too-large' | 'sequence' | 'epoch' | 'tag';

export const FRAME_VERSION = 1;
export const FRAME_HEADER_BYTES = 10;
export const GCM_TAG_BYTES = 16;
/** The most plaintext one frame carries (its kind byte included); a larger message travels as `part`s. */
export const FRAME_PLAINTEXT_MAX = 256 * 1024;
export const REKEY_FRAMES = 2 ** 20;
export const REKEY_MS = 24 * 60 * 60 * 1000;

const HMAC = { name: 'HMAC', hash: 'SHA-256' } as const;

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const imported = await crypto.subtle.importKey('raw', key, HMAC, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, data));
}

/** HKDF-Extract(salt, ikm) = HMAC-SHA-256(salt, ikm). */
export const hkdfExtract = (salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>) => hmac(salt, ikm);

/** HKDF-Expand(prk, info, length): T(1) ‖ T(2) ‖ …, T(i) = HMAC(prk, T(i-1) ‖ info ‖ i), truncated to `length` bytes. */
export async function hkdfExpand(prk: Uint8Array<ArrayBuffer>, info: string, length: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isInteger(length) || length < 1 || length > 255 * 32) throw new RangeError('HKDF-Expand: a length of 1 to 8160 bytes');
  const label = utf8(info);
  const out = new Uint8Array(length);
  let previous = new Uint8Array(0);
  for (let i = 1, at = 0; at < length; i++) {
    const block = new Uint8Array(previous.length + label.length + 1);
    block.set(previous);
    block.set(label, previous.length);
    block[block.length - 1] = i;
    previous = await hmac(prk, block);
    out.set(previous.subarray(0, Math.min(32, length - at)), at);
    at += 32;
  }
  return out;
}

/** The next epoch's key and iv, from this epoch's key alone. */
export async function rekeyDirection(keys: DirectionKeys): Promise<DirectionKeys> {
  return { key: await hkdfExpand(keys.key, 'smns-rl2-v1 rekey', 32), iv: await hkdfExpand(keys.key, 'smns-rl2-v1 rekey iv', 4) };
}

export function frameHeader(epoch: number, seq: number): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(FRAME_HEADER_BYTES);
  header[0] = FRAME_VERSION;
  header[1] = epoch & 0xff;
  new DataView(header.buffer).setBigUint64(2, BigInt(seq));
  return header;
}

function nonce(iv: Uint8Array, seq: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12);
  out.set(iv);
  new DataView(out.buffer).setBigUint64(4, BigInt(seq));
  return out;
}

const aesKey = (key: Uint8Array<ArrayBuffer>, usage: 'encrypt' | 'decrypt') => crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, [usage]);

async function seal(key: CryptoKey, iv: Uint8Array, epoch: number, seq: number, plaintext: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const header = frameHeader(epoch, seq);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce(iv, seq), additionalData: header, tagLength: 128 }, key, plaintext));
  const frame = new Uint8Array(FRAME_HEADER_BYTES + sealed.length);
  frame.set(header);
  frame.set(sealed, FRAME_HEADER_BYTES);
  return frame;
}

/** One frame under `keys` at `epoch` and `seq`: the vectors' and the suites' way to make any frame. */
export async function sealFrame(keys: DirectionKeys, epoch: number, seq: number, plaintext: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return seal(await aesKey(keys.key, 'encrypt'), keys.iv, epoch, seq, plaintext);
}

/** Where a direction stands: its epoch, the next sequence, and (for a sender) the frames sent in this epoch. */
export type SealerStart = { epoch?: number; seq?: number; epochFrames?: number; now?: () => number };

/** A sending direction: seals in call order, rekeying after `REKEY_FRAMES` in an epoch or `REKEY_MS`. */
export class FrameSealer {
  private keys: DirectionKeys;
  private key: Promise<CryptoKey>;
  private epoch: number;
  private seq: number;
  private epochFrames: number;
  private epochStart: number;
  private readonly now: () => number;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(keys: DirectionKeys, start: SealerStart = {}) {
    this.keys = keys;
    this.key = aesKey(keys.key, 'encrypt');
    this.epoch = start.epoch ?? 0;
    this.seq = start.seq ?? 0;
    this.epochFrames = start.epochFrames ?? 0;
    this.now = start.now ?? Date.now;
    this.epochStart = this.now();
  }

  seal(plaintext: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
    const run = this.tail.then(async () => {
      if (this.epochFrames >= REKEY_FRAMES || this.now() - this.epochStart >= REKEY_MS) {
        this.keys = await rekeyDirection(this.keys);
        this.key = aesKey(this.keys.key, 'encrypt');
        this.epoch = (this.epoch + 1) & 0xff;
        this.epochFrames = 0;
        this.epochStart = this.now();
      }
      const seq = this.seq++;
      this.epochFrames++;
      return seal(await this.key, this.keys.iv, this.epoch, seq, plaintext);
    });
    this.tail = run.catch(() => {});
    return run;
  }
}

/** A receiving direction: opens in arrival order exactly the next sequence, under the current epoch or the next. */
export class FrameOpener {
  private keys: DirectionKeys;
  private key: Promise<CryptoKey>;
  private epoch: number;
  private seq: number;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(keys: DirectionKeys, start: { epoch?: number; seq?: number } = {}) {
    this.keys = keys;
    this.key = aesKey(keys.key, 'decrypt');
    this.epoch = start.epoch ?? 0;
    this.seq = start.seq ?? 0;
  }

  open(frame: Uint8Array): Promise<{ ok: true; plaintext: Uint8Array<ArrayBuffer> } | { ok: false; reason: FrameRefusal }> {
    const run = this.tail.then(() => this.openNext(frame));
    this.tail = run.catch(() => {});
    return run;
  }

  private async openNext(frame: Uint8Array): Promise<{ ok: true; plaintext: Uint8Array<ArrayBuffer> } | { ok: false; reason: FrameRefusal }> {
    if (frame.length < FRAME_HEADER_BYTES + GCM_TAG_BYTES || frame[0] !== FRAME_VERSION) return { ok: false, reason: 'malformed' };
    if (frame.length - FRAME_HEADER_BYTES - GCM_TAG_BYTES > FRAME_PLAINTEXT_MAX) return { ok: false, reason: 'too-large' };
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    if (view.getBigUint64(2) !== BigInt(this.seq)) return { ok: false, reason: 'sequence' };
    const epoch = frame[1];
    let keys = this.keys;
    let key = this.key;
    if (epoch === ((this.epoch + 1) & 0xff)) {
      keys = await rekeyDirection(this.keys);
      key = aesKey(keys.key, 'decrypt');
    } else if (epoch !== this.epoch) return { ok: false, reason: 'epoch' };
    const header = Uint8Array.from(frame.subarray(0, FRAME_HEADER_BYTES));
    let plaintext: Uint8Array<ArrayBuffer>;
    try {
      plaintext = new Uint8Array(
        await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce(keys.iv, this.seq), additionalData: header, tagLength: 128 }, await key, Uint8Array.from(frame.subarray(FRAME_HEADER_BYTES))),
      );
    } catch {
      return { ok: false, reason: 'tag' };
    }
    this.keys = keys;
    this.key = key;
    this.epoch = epoch;
    this.seq++;
    return { ok: true, plaintext };
  }
}
