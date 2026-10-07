// Chrome's macOS Safe Storage scheme, lifted from E0b's spikes/browser-probe/import/crypto.mjs: the key derivation, the
// v10 AES-128-CBC values, the store-version-gated SHA-256(host_key) prefix, and Chrome time.
import { createCipheriv, createHash, pbkdf2Sync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { chromeTimeToUnixMs, chromeTimeToUnixSeconds, COOKIE_HOST_HASH_FROM_VERSION, DecryptError, decrypt, decryptCookieValue, deriveKey, hostHash } from './crypto';

// The scheme restated independently: PBKDF2-HMAC-SHA1(password, saltysalt, 1003, 16), AES-128-CBC with sixteen spaces.
const keyOf = (password: string) => pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
function v10(key: Buffer, plaintext: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
  return Buffer.concat([Buffer.from('v10'), cipher.update(plaintext), cipher.final()]);
}
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest();

describe('the Safe Storage key and values', () => {
  it('derives the key with PBKDF2-HMAC-SHA1 over saltysalt, 1003 rounds, 16 bytes, from a string or a Buffer', () => {
    expect(deriveKey('peanuts')).toEqual(keyOf('peanuts'));
    expect(deriveKey(Buffer.from('peanuts'))).toEqual(keyOf('peanuts'));
    expect(deriveKey('peanuts')).toHaveLength(16);
  });

  it('decrypts a v10 value and refuses anything without the prefix as a corrupt value, not a key failure', () => {
    const key = keyOf('peanuts');
    expect(decrypt(key, v10(key, Buffer.from('plain text'))).toString()).toBe('plain text');
    const refused = (() => {
      try {
        decrypt(key, Buffer.from('v11whatever'));
      } catch (error) {
        return error;
      }
    })();
    expect(refused).toBeInstanceOf(DecryptError);
    expect((refused as DecryptError).kind).toBe('prefix');
  });

  it('reports a wrong key as a key failure whose message carries none of the blob', () => {
    const blob = v10(keyOf('peanuts'), Buffer.from('a value that must not leak'));
    let failures = 0;
    for (const password of ['other-1', 'other-2', 'other-3', 'other-4', 'other-5']) {
      try {
        // CBC padding survives a wrong key about one time in 256, so a decrypt may "succeed" into noise: the host-hash
        // gate below is what catches that case.
        decryptCookieValue(keyOf(password), 'example.test', blob, { requireHostHash: true });
      } catch (error) {
        expect(error).toBeInstanceOf(DecryptError);
        expect((error as DecryptError).kind).toBe('key');
        expect((error as Error).message).not.toContain('leak');
        failures++;
      }
    }
    expect(failures).toBe(5);
  });
});

describe('decryptCookieValue (store-version-gated host hash)', () => {
  const key = keyOf('peanuts');

  it('strips a matching SHA-256(host_key) prefix', () => {
    const blob = v10(key, Buffer.concat([sha('.example.test'), Buffer.from('cookie-value')]));
    expect(decryptCookieValue(key, '.example.test', blob, { requireHostHash: true })).toEqual({ value: 'cookie-value', hashed: true });
  });

  it('takes a bare value from a store before version 24 and refuses it from version 24 on', () => {
    expect(COOKIE_HOST_HASH_FROM_VERSION).toBe(24);
    const bare = v10(key, Buffer.from('bare-value'));
    expect(decryptCookieValue(key, 'example.test', bare, { requireHostHash: false })).toEqual({ value: 'bare-value', hashed: false });
    expect(() => decryptCookieValue(key, 'example.test', bare, { requireHostHash: true })).toThrow(DecryptError);
  });

  it('refuses a prefix hashed for another host', () => {
    const blob = v10(key, Buffer.concat([sha('other.test'), Buffer.from('cookie-value')]));
    expect(() => decryptCookieValue(key, 'example.test', blob, { requireHostHash: true })).toThrow(DecryptError);
  });

  it('hashes the host key as UTF-8', () => {
    expect(hostHash('example.test')).toEqual(sha('example.test'));
  });
});

describe('Chrome time (microseconds since 1601)', () => {
  const unixMs = Date.UTC(2026, 9, 6, 12, 0, 0, 123);
  const chrome = BigInt(unixMs) * 1000n + 11644473600n * 1000000n;

  it('converts to Unix milliseconds and seconds, from a BigInt or a Number', () => {
    expect(chromeTimeToUnixMs(chrome)).toBe(unixMs);
    expect(chromeTimeToUnixSeconds(chrome)).toBe(Math.floor(unixMs / 1000));
    expect(chromeTimeToUnixMs(Number(11644473600n * 1000000n))).toBe(0);
  });

  it('reads 0 (Chrome’s "never") as 0', () => {
    expect(chromeTimeToUnixMs(0n)).toBe(0);
    expect(chromeTimeToUnixSeconds(0)).toBe(0);
  });
});
