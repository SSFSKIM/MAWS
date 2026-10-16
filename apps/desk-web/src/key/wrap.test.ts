// A wrapped copy of the org key (DX7's "Wrapped keys"): the 32-byte key under AES-256-GCM with a fresh 12-byte iv, its
// method bound in as additional data (`smns-desk-wrap-v1` LF org id LF method LF credential), unwrapped straight into a
// non-extractable HMAC key to unlock, or as bytes, once, to lock another copy or build an enrollment code.
import { createDecipheriv } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { base64urlDecode, keyCheck, verify } from 'desk-hub/protocol';
import { LOG_VECTORS, VECTOR_KEY } from '../../test/vectors';
import { holdKeyBytes } from './derive';
import { importWrappingKey, unwrapHeldKey, unwrapKeyBytes, wrapAad, wrapOrgKey, WrongSecret } from './wrap';

const WRAPPING = Uint8Array.from({ length: 32 }, (_, i) => 0xa0 + i);
const wrapping = () => importWrappingKey(Uint8Array.from(WRAPPING));
const vector = () => Uint8Array.from(VECTOR_KEY);
const PASSPHRASE = { method: 'passphrase', credential: null } as const;
const PASSKEY = { method: 'passkey', credential: 'Y3JlZGVudGlhbA' } as const;

describe('wrapAad', () => {
  it('is the wrap label, the org id, the method, and the credential (empty for a passphrase), one per line', () => {
    expect(new TextDecoder().decode(wrapAad('local', PASSPHRASE))).toBe('smns-desk-wrap-v1\nlocal\npassphrase\n');
    expect(new TextDecoder().decode(wrapAad('local', PASSKEY))).toBe('smns-desk-wrap-v1\nlocal\npasskey\nY3JlZGVudGlhbA');
  });
});

describe('importWrappingKey', () => {
  it('holds the derived bytes as a non-extractable AES-GCM key, and wipes them', async () => {
    const bytes = Uint8Array.from(WRAPPING);
    const key = await importWrappingKey(bytes);
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    expect(bytes.every((b) => b === 0)).toBe(true);
  });
});

describe('wrapOrgKey', () => {
  it('is AES-256-GCM of the key with a fresh iv and the method as additional data: 12 and 48 bytes', async () => {
    const a = await wrapOrgKey(vector(), await wrapping(), 'local', PASSKEY);
    const b = await wrapOrgKey(vector(), await wrapping(), 'local', PASSKEY);
    expect(base64urlDecode(a.iv)).toHaveLength(12);
    expect(base64urlDecode(a.wrapped)).toHaveLength(48);
    expect(a.iv).not.toBe(b.iv);
    // Opened by another implementation (Node's OpenSSL) under the same key, iv, and additional data.
    const sealed = base64urlDecode(a.wrapped);
    const decipher = createDecipheriv('aes-256-gcm', WRAPPING, base64urlDecode(a.iv));
    decipher.setAAD(wrapAad('local', PASSKEY));
    decipher.setAuthTag(sealed.slice(32));
    expect(Buffer.concat([decipher.update(sealed.slice(0, 32)), decipher.final()])).toEqual(Buffer.from(VECTOR_KEY));
  });

  it('leaves the bytes it locked as they were (the caller wipes them)', async () => {
    const raw = vector();
    await wrapOrgKey(raw, await wrapping(), 'local', PASSPHRASE);
    expect(raw).toEqual(VECTOR_KEY);
  });
});

describe('unwrapHeldKey', () => {
  it('opens a copy straight into a non-extractable HMAC key: the org key, never bytes the page can read', async () => {
    const copy = await wrapOrgKey(vector(), await wrapping(), 'local', PASSPHRASE);
    const key = await unwrapHeldKey({ ...PASSPHRASE, ...copy }, await wrapping(), 'local');
    expect(key.hmac.extractable).toBe(false);
    expect(await keyCheck(key)).toBe(await keyCheck(await holdKeyBytes(vector())));
    for (const v of LOG_VECTORS) expect(await verify(key, 'log', v.project, v.event), v.name).toBe(true);
  });

  it('refuses another wrapping key — a wrong passphrase, another passkey — as WrongSecret', async () => {
    const copy = await wrapOrgKey(vector(), await wrapping(), 'local', PASSPHRASE);
    const other = Uint8Array.from(WRAPPING);
    other[0] ^= 1;
    await expect(unwrapHeldKey({ ...PASSPHRASE, ...copy }, await importWrappingKey(other), 'local')).rejects.toBeInstanceOf(WrongSecret);
  });

  it('refuses a copy moved to another org, method, or credential: the additional data binds them', async () => {
    const copy = await wrapOrgKey(vector(), await wrapping(), 'local', PASSKEY);
    await expect(unwrapHeldKey({ ...PASSKEY, ...copy }, await wrapping(), 'other')).rejects.toBeInstanceOf(WrongSecret);
    await expect(unwrapHeldKey({ ...PASSKEY, credential: 'b3RoZXI', ...copy }, await wrapping(), 'local')).rejects.toBeInstanceOf(WrongSecret);
    await expect(unwrapHeldKey({ ...PASSPHRASE, ...copy }, await wrapping(), 'local')).rejects.toBeInstanceOf(WrongSecret);
  });
});

describe('unwrapKeyBytes', () => {
  it("opens a copy as the key's bytes, for the one use that needs them", async () => {
    const copy = await wrapOrgKey(vector(), await wrapping(), 'local', PASSPHRASE);
    expect(await unwrapKeyBytes({ ...PASSPHRASE, ...copy }, await wrapping(), 'local')).toEqual(VECTOR_KEY);
    await expect(unwrapKeyBytes({ ...PASSKEY, ...copy }, await wrapping(), 'local')).rejects.toBeInstanceOf(WrongSecret);
  });
});
