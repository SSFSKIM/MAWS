// Chrome's macOS "Safe Storage" scheme (components/os_crypt/sync/os_crypt_mac.mm): the Keychain holds a random
// password under service "Chrome Safe Storage", account "Chrome"; the AES key is PBKDF2-HMAC-SHA1(password,
// "saltysalt", 1003 iterations, 16 bytes); values are "v10" + AES-128-CBC(iv = 16 spaces, PKCS#7).
// Cookies (database version >= 24, Chrome 130+) encrypt SHA-256(host_key) + value, so the first 32 bytes of the
// plaintext are a domain check; Login Data encrypts the bare password.
import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';

export const SALT = 'saltysalt';
export const ITERATIONS = 1003;
export const KEY_LENGTH = 16;
export const PREFIX = Buffer.from('v10');
const IV = Buffer.alloc(16, 0x20);

export function deriveKey(safeStoragePassword) {
  return pbkdf2Sync(safeStoragePassword, SALT, ITERATIONS, KEY_LENGTH, 'sha1');
}

export function randomSafeStoragePassword() {
  // Chrome stores a base64 string of 16 random bytes; the derivation treats it as the UTF-8 password.
  return randomBytes(16).toString('base64');
}

export function encrypt(key, plaintext) {
  const c = createCipheriv('aes-128-cbc', key, IV);
  return Buffer.concat([PREFIX, c.update(plaintext), c.final()]);
}

export function decrypt(key, blob) {
  if (blob.length < 3 || !blob.subarray(0, 3).equals(PREFIX)) throw new Error(`unexpected prefix ${JSON.stringify(blob.subarray(0, 3).toString('latin1'))}`);
  const d = createDecipheriv('aes-128-cbc', key, IV);
  return Buffer.concat([d.update(blob.subarray(3)), d.final()]);
}

export function hostHash(hostKey) {
  return createHash('sha256').update(hostKey, 'utf8').digest();
}

export function encryptCookieValue(key, hostKey, value) {
  return encrypt(key, Buffer.concat([hostHash(hostKey), Buffer.from(value, 'utf8')]));
}

// Returns { value, hashed }: hashed is true when the 32-byte SHA-256(host_key) prefix was present and matched.
// Stores at version 24 or later always carry the prefix, so callers pass requireHostHash for them and a mismatch is a
// failed decrypt (wrong key, or a value that merely survived CBC padding); only older stores may yield a bare value.
export function decryptCookieValue(key, hostKey, blob, { requireHostHash = false } = {}) {
  const plain = decrypt(key, blob);
  if (plain.length >= 32 && plain.subarray(0, 32).equals(hostHash(hostKey))) return { value: plain.subarray(32).toString('utf8'), hashed: true };
  if (requireHostHash) throw new Error('cookie plaintext lacks the SHA-256(host_key) prefix the store version requires');
  return { value: plain.toString('utf8'), hashed: false };
}
export const COOKIE_HOST_HASH_FROM_VERSION = 24;

export function encryptPassword(key, password) {
  return encrypt(key, Buffer.from(password, 'utf8'));
}

export function decryptPassword(key, blob) {
  return decrypt(key, blob).toString('utf8');
}

// Chrome time: microseconds since 1601-01-01 UTC.
const EPOCH_DELTA_US = 11644473600n * 1000000n;
export function chromeTimeToUnixSeconds(t) {
  const us = BigInt(t);
  if (us === 0n) return 0;
  return Number((us - EPOCH_DELTA_US) / 1000000n);
}
export function unixSecondsToChromeTime(s) {
  return BigInt(Math.round(s)) * 1000000n + EPOCH_DELTA_US;
}
