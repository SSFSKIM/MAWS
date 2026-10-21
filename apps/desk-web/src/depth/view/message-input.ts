// A message tool's input while it streams (doperpowers' to-human message tool spec, the desk's side of its cross-repo
// contract): the call's arguments arrive as JSON a piece at a time (DX4's `input` chunks), and the message is the
// object's `text` string as far as it has come. The tool's input is `{text}` alone, so the reader takes the object's
// first key; anything else (another key first, a value that is no string) draws nothing, and the message appears whole
// when its call's row lands. A copy a resync cut to its last characters (the producer's bounded catch-up, the snapshot
// block's `truncated`) starts inside the string, never at the object's opening brace and a key, so it reads as none:
// where the text starts is lost with the cut.

/** The `text` of a message tool's input streamed so far, or null while there is none to draw (also when only whitespace). */
export function streamingMessageText(json: string): string | null {
  let i = space(json, 0);
  if (json[i] !== '{') return null;
  i = space(json, i + 1);
  if (json[i] !== '"') return null;
  const key = jsonString(json, i + 1);
  if (!key.closed || key.value !== 'text') return null;
  i = space(json, key.end);
  if (json[i] !== ':') return null;
  i = space(json, i + 1);
  if (json[i] !== '"') return null;
  const { value } = jsonString(json, i + 1);
  return value.trim() === '' ? null : value;
}

/** The index of the first character at or after `i` that is not JSON whitespace. */
function space(json: string, i: number): number {
  while (i < json.length && (json[i] === ' ' || json[i] === '\n' || json[i] === '\r' || json[i] === '\t')) i++;
  return i;
}

const ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/**
 * A JSON string's value from just after its opening quote, as far as the input goes: `closed` once its closing quote is
 * in (`end` just past it). An escape the input cuts short is left out, and so is a high surrogate whose low half has not
 * come, so a cut never draws a character that is not in the message.
 */
function jsonString(json: string, start: number): { value: string; closed: boolean; end: number } {
  let value = '';
  let i = start;
  while (i < json.length) {
    const quote = json.indexOf('"', i);
    const escape = json.indexOf('\\', i);
    const stop = quote < 0 ? escape : escape < 0 ? quote : Math.min(quote, escape);
    if (stop < 0) {
      value += json.slice(i);
      i = json.length;
      break;
    }
    value += json.slice(i, stop);
    if (stop === quote) return { value, closed: true, end: quote + 1 };
    const code = json[stop + 1];
    if (code === undefined) break;
    if (code === 'u') {
      const hex = json.slice(stop + 2, stop + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break; // cut short (or not JSON): nothing more is read
      value += String.fromCharCode(parseInt(hex, 16));
      i = stop + 6;
    } else if (code in ESCAPES) {
      value += ESCAPES[code];
      i = stop + 2;
    } else break;
  }
  const last = value.charCodeAt(value.length - 1);
  return { value: last >= 0xd800 && last <= 0xdbff ? value.slice(0, -1) : value, closed: false, end: i };
}
