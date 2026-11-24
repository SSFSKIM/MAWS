// The server's proof, as the tab checks it (§L's opening; T28, T21). The proof key is HMAC-SHA-256 under the
// credential's 32 decoded bytes of PROOF_KEY_LABEL, which mawsd made at the exchange and the page makes again at each
// load; the server proves itself with HMAC-SHA-256 under that key of PROOF_MAC_LABEL, the browser's id and the tab's
// nonce, each on a line. With @noble/hashes and crypto.getRandomValues: crypto.subtle exists only in a secure context,
// and the page works wherever it loads. The labels are mawsd's (src/mawsd/sheet-page/pairing.ts).
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';

export const PROOF_KEY_LABEL = 'maws.sheet.proof.v1';
export const PROOF_MAC_LABEL = 'maws.sheet.live.v1';

const text = new TextEncoder();
const URL_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function base64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i]!, bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += URL_SAFE[(n >> 18) & 63]! + URL_SAFE[(n >> 12) & 63]!;
    if (b !== undefined) out += URL_SAFE[(n >> 6) & 63]!;
    if (c !== undefined) out += URL_SAFE[n & 63]!;
  }
  return out;
}

export function fromBase64url(value: string): Uint8Array {
  const bytes: number[] = [];
  let bits = 0;
  let held = 0;
  for (const char of value) {
    const index = URL_SAFE.indexOf(char);
    if (index < 0) throw new Error('not base64url');
    held = (held << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((held >> bits) & 255);
    }
  }
  return Uint8Array.from(bytes);
}

export const proofKeyOf = (credential: string): Uint8Array => hmac(sha256, fromBase64url(credential), text.encode(PROOF_KEY_LABEL));

export const macOf = (key: Uint8Array, id: string, nonce: string): string => base64url(hmac(sha256, key, text.encode(`${PROOF_MAC_LABEL}\n${id}\n${nonce}`)));

export const freshNonce = (): string => base64url(crypto.getRandomValues(new Uint8Array(32)));

// Every character compared, whatever the first difference
export function macsEqual(a: string, b: string): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  let differ = 0;
  for (let i = 0; i < a.length; i++) differ |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return differ === 0;
}
