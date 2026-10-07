// Chrome's macOS "Safe Storage" scheme, lifted from E0b's spikes/browser-probe/import/crypto.mjs (decryption half): the
// Keychain holds a random password under "Chrome Safe Storage"; the AES key is PBKDF2-HMAC-SHA1(password, "saltysalt",
// 1003 iterations, 16 bytes); a value is "v10" + AES-128-CBC(iv = 16 spaces, PKCS#7). A cookie store at version 24 or
// later (Chrome 130+) encrypts SHA-256(host_key) + value, so the plaintext's first 32 bytes are a domain check.
// Errors carry a kind and fixed words, never a byte of the blob (E4b Design §16).
import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto';

const SALT = 'saltysalt';
const ITERATIONS = 1003;
const KEY_LENGTH = 16;
const PREFIX = Buffer.from('v10');
const IV = Buffer.alloc(16, 0x20);
export const COOKIE_HOST_HASH_FROM_VERSION = 24;

// `prefix`: not a v10 value (a corrupt row); `key`: the decrypt failed or the host hash did not match (a wrong key, or
// a value that merely survived CBC padding under one).
export class DecryptError extends Error {
  constructor(readonly kind: 'prefix' | 'key') {
    super(kind === 'prefix' ? 'not a v10 value' : 'the value did not decrypt with this key');
    this.name = 'DecryptError';
  }
}

// A Buffer password is never copied into a string, so the caller can zero it after the derivation (Design §5).
export function deriveKey(safeStoragePassword: string | Buffer): Buffer {
  return pbkdf2Sync(safeStoragePassword, SALT, ITERATIONS, KEY_LENGTH, 'sha1');
}

export function decrypt(key: Buffer, blob: Uint8Array): Buffer {
  const bytes = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  if (bytes.length < PREFIX.length || !bytes.subarray(0, PREFIX.length).equals(PREFIX)) throw new DecryptError('prefix');
  try {
    const decipher = createDecipheriv('aes-128-cbc', key, IV);
    return Buffer.concat([decipher.update(bytes.subarray(PREFIX.length)), decipher.final()]);
  } catch {
    throw new DecryptError('key'); // OpenSSL's BAD_DECRYPT, or a body that is not whole blocks
  }
}

export function hostHash(hostKey: string): Buffer {
  return createHash('sha256').update(hostKey, 'utf8').digest();
}

// `hashed`: the 32-byte SHA-256(host_key) prefix was present and matched. A store at version 24 or later always carries
// it, so callers pass `requireHostHash` for one and a mismatch is a failed decrypt; only an older store yields a bare value.
export function decryptCookieValue(key: Buffer, hostKey: string, blob: Uint8Array, { requireHostHash }: { requireHostHash: boolean }): { value: string; hashed: boolean } {
  const plain = decrypt(key, blob);
  if (plain.length >= 32 && plain.subarray(0, 32).equals(hostHash(hostKey))) return { value: plain.subarray(32).toString('utf8'), hashed: true };
  if (requireHostHash) throw new DecryptError('key');
  return { value: plain.toString('utf8'), hashed: false };
}

// Chrome time: microseconds since 1601-01-01 UTC; 0 is Chrome's "never" and stays 0.
const EPOCH_DELTA_US = 11644473600n * 1000000n;
export function chromeTimeToUnixMs(time: bigint | number): number {
  const us = BigInt(time);
  return us === 0n ? 0 : Number((us - EPOCH_DELTA_US) / 1000n);
}
export function chromeTimeToUnixSeconds(time: bigint | number): number {
  return Math.floor(chromeTimeToUnixMs(time) / 1000);
}
