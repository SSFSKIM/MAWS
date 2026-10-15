// Base64url without padding (RFC 4648 §5), written out so the module needs no atob, btoa, or Buffer.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const INDEX = new Map([...ALPHABET].map((char, i) => [char, i]));

export function base64urlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let j = 0; j < chars; j++) out += ALPHABET[(n >> (18 - 6 * j)) & 63];
  }
  return out;
}

/**
 * Decodes the canonical spelling only (DX1: base64url has one spelling per value). Throws a TypeError on any character
 * outside the alphabet, on padding, on a length no encoding produces, and on a last character whose unused low bits
 * are not zero — the spellings a lenient decoder would read as the same bytes. Nothing is normalized: a caller that
 * stored a variant would forward bytes no verifier accepts.
 */
export function base64urlDecode(text: string): Uint8Array<ArrayBuffer> {
  if (text.length % 4 === 1) throw new TypeError('base64url: impossible length');
  const out = new Uint8Array(Math.floor((text.length * 6) / 8));
  let bits = 0;
  let value = 0;
  let o = 0;
  for (const char of text) {
    const v = INDEX.get(char);
    if (v === undefined) throw new TypeError('base64url: not in the alphabet');
    value = ((value << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (value >> bits) & 0xff;
    }
  }
  if ((value & ((1 << bits) - 1)) !== 0) throw new TypeError('base64url: unused bits set (not the canonical spelling)');
  return out;
}

/** True when `text` is the canonical base64url spelling of exactly `bytes` bytes (a nonce: 16; a code's value: 32). */
export function isBase64urlOf(text: unknown, bytes: number): boolean {
  if (typeof text !== 'string') return false;
  try {
    return base64urlDecode(text).length === bytes;
  } catch {
    return false;
  }
}
