// Every frame, in either direction, is at most 1 MiB of UTF-8 (§2). A larger frame travels as numbered parts, each a
// slice of the frame's JSON text; the receiver joins a set when its last part arrives, in whatever order they came.
import { newNonce } from './codes';

export const FRAME_LIMIT = 1024 * 1024;

export type Part = { t: 'part'; id: string; index: number; count: number; data: string };

/** The JSON text of a frame, or of its parts when it is over `limit` bytes; each string is one frame on the wire. */
export function toWire(frame: object, limit: number = FRAME_LIMIT): string[] {
  const text = JSON.stringify(frame);
  if (utf8Length(text) <= limit) return [text];
  const id = newNonce();
  // The part frame around a slice, with the widest index and count it could carry.
  const overhead = utf8Length(JSON.stringify({ t: 'part', id, index: 999_999_999, count: 999_999_999, data: '' }));
  const budget = limit - overhead;
  if (budget < 12) throw new TypeError('toWire: the limit leaves no room for a part');
  const slices = split(text, budget);
  return slices.map((data, index) => JSON.stringify({ t: 'part', id, index, count: slices.length, data } satisfies Part));
}

/** Slices whose escaped form (inside a JSON string) fits `budget` bytes, never splitting a surrogate pair. */
function split(text: string, budget: number): string[] {
  const slices: string[] = [];
  let start = 0;
  let used = 0;
  for (let i = 0; i < text.length; ) {
    const c = text.charCodeAt(i);
    let width = 1;
    let cost: number;
    if (c === 0x22 || c === 0x5c) cost = 2;
    else if (c < 0x20) cost = 6;
    else if (c < 0x80) cost = 1;
    else if (c < 0x800) cost = 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      cost = 4;
      width = 2;
    } else if (c >= 0xd800 && c <= 0xdfff) cost = 6;
    else cost = 3;
    if (used + cost > budget) {
      slices.push(text.slice(start, i));
      start = i;
      used = 0;
    }
    used += cost;
    i += width;
  }
  slices.push(text.slice(start));
  return slices;
}

/** The bytes `text` takes as UTF-8, counted without encoding it. */
export function utf8Length(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** How many bytes of unfinished sets one assembler (one stream's, one socket's) holds at most, all its sets together. */
export const PARTS_HELD_LIMIT = 16 * 1024 * 1024;
/** How long a set waits for its other parts before it is dropped. */
export const PARTS_MAX_AGE_MS = 60_000;
/** How many sets one assembler holds open at once: a set costs its id and its slots whatever its data, so the byte
 * budget alone would not bound sets of empty parts. */
export const PARTS_MAX_SETS = 64;
/** The longest part id, in characters (the hub's own are 22: a 128-bit nonce in base64url). */
export const PART_ID_LIMIT = 128;

/** A part refused because its set, or the assembler's unfinished sets, would pass a bound; its set is dropped. */
export class PartsBudgetError extends RangeError {}

type PartSet = { count: number; slices: Array<string | undefined>; have: number; bytes: number; started: number };

/**
 * Joins part sets; `add` returns the whole frame once its set is complete, and undefined before. What it holds of
 * unfinished sets is bounded: in bytes, all sets together (a part past the budget is refused, `PartsBudgetError`, and
 * its set dropped); in number (a part that would open a set past PARTS_MAX_SETS is refused, and an id longer than
 * PART_ID_LIMIT is malformed); and in time (a set older than `maxAgeMs` is dropped, and a late part of it starts a set
 * of its own). One set may be bounded too, when its sender's frames are (a browser's, DX3): `maxSetParts` refuses a
 * part whose `count` is larger, before anything of its set is held, and `maxSetBytes` a part past which its set would
 * join to more bytes, dropping the set.
 */
export class PartAssembler {
  private readonly sets = new Map<string, PartSet>();
  private held = 0;
  private readonly maxBytes: number;
  private readonly maxAgeMs: number;
  private readonly maxSetParts: number;
  private readonly maxSetBytes: number;
  private readonly now: () => number;

  constructor(options: { maxBytes?: number; maxAgeMs?: number; maxSetParts?: number; maxSetBytes?: number; now?: () => number } = {}) {
    this.maxBytes = options.maxBytes ?? PARTS_HELD_LIMIT;
    this.maxAgeMs = options.maxAgeMs ?? PARTS_MAX_AGE_MS;
    this.maxSetParts = options.maxSetParts ?? Infinity;
    this.maxSetBytes = options.maxSetBytes ?? Infinity;
    this.now = options.now ?? Date.now;
  }

  add(part: Part): unknown {
    const { id, index, count, data } = part;
    if (typeof id !== 'string' || id.length > PART_ID_LIMIT || typeof data !== 'string' || !Number.isInteger(count) || count < 1 || !Number.isInteger(index) || index < 0 || index >= count) {
      throw new TypeError('part: malformed');
    }
    if (count > this.maxSetParts) throw new PartsBudgetError(`part: a set is at most ${this.maxSetParts} parts`);
    const now = this.now();
    for (const [other, set] of this.sets) if (now - set.started > this.maxAgeMs) this.drop(other, set);
    let set = this.sets.get(id);
    if (!set) {
      if (this.sets.size >= PARTS_MAX_SETS) throw new PartsBudgetError(`part: at most ${PARTS_MAX_SETS} sets are open at once`);
      set = { count, slices: new Array(count), have: 0, bytes: 0, started: now };
      this.sets.set(id, set);
    }
    if (set.count !== count) throw new TypeError('part: count differs within its set');
    const bytes = utf8Length(data);
    const previous = set.slices[index];
    const growth = bytes - (previous === undefined ? 0 : utf8Length(previous));
    if (set.bytes + growth > this.maxSetBytes) {
      this.drop(id, set);
      throw new PartsBudgetError(`part: a frame sent as parts joins to at most ${this.maxSetBytes} bytes`);
    }
    if (this.held + growth > this.maxBytes) {
      this.drop(id, set);
      throw new PartsBudgetError(`part: unfinished sets would hold more than ${this.maxBytes} bytes`);
    }
    if (previous === undefined) set.have++;
    set.slices[index] = data;
    set.bytes += growth;
    this.held += growth;
    if (set.have < count) return undefined;
    this.drop(id, set);
    return JSON.parse(set.slices.join(''));
  }

  private drop(id: string, set: PartSet): void {
    this.sets.delete(id);
    this.held -= set.bytes;
  }
}
