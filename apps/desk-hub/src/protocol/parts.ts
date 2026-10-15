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

function utf8Length(text: string): number {
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

/** Joins part sets; `add` returns the whole frame once its set is complete, and undefined before. */
export class PartAssembler {
  private readonly sets = new Map<string, { count: number; slices: Array<string | undefined>; have: number }>();

  add(part: Part): unknown {
    const { id, index, count, data } = part;
    if (typeof id !== 'string' || typeof data !== 'string' || !Number.isInteger(count) || count < 1 || !Number.isInteger(index) || index < 0 || index >= count) {
      throw new TypeError('part: malformed');
    }
    let set = this.sets.get(id);
    if (!set) {
      set = { count, slices: new Array(count), have: 0 };
      this.sets.set(id, set);
    }
    if (set.count !== count) throw new TypeError('part: count differs within its set');
    if (set.slices[index] === undefined) set.have++;
    set.slices[index] = data;
    if (set.have < count) return undefined;
    this.sets.delete(id);
    return JSON.parse(set.slices.join(''));
  }
}
