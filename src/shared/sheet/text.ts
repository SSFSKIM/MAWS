// Strings as the question sheet counts them (the published set's README, "Cuts" and "A reader never fails on a
// record's strings"): every length and every cut is in code points, as Python's `len` and slices count them, never in
// UTF-16 units; and a lone UTF-16 surrogate, which `JSON.parse` keeps, is what a reader drops in a line and replaces
// in a record.

/** The number of code points of a string; a lone surrogate counts as one, as it does in Python. */
export function codePoints(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i += 1;
    }
    n += 1;
  }
  return n;
}

/** The first `max` code points of a string, with no mark: the set's every cut of data. */
export function cut(text: string, max: number): string {
  if (text.length <= max) return text; // at most as many code points as units
  let out = '';
  let n = 0;
  for (const point of text) {
    if (n === max) break;
    out += point;
    n += 1;
  }
  return out;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const LONE_SURROGATES = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Whether a string holds a UTF-16 surrogate without its pair (an escape like `\ud83d` alone). */
export const hasLoneSurrogate = (text: string): boolean => LONE_SURROGATE.test(text);

/** A string with each lone surrogate written as U+FFFD, as `sminos sheet show` prints one. */
export const wellFormed = (text: string): string => (hasLoneSurrogate(text) ? text.replace(LONE_SURROGATES, '�') : text);
