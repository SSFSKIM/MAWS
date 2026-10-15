// The wrapping keys' derivations (§6; the DC5 plan's M2 and M2b): from the passkey's PRF output through HKDF with the
// org id, or from a passphrase through Argon2id with the org id in the salt. Each derives the key one wrapped copy of the
// org key is locked under, never the org key itself. The expected values were computed with OpenSSL's `kdf` (an
// implementation independent of the app's), and pin the derivations: a change to them opens no existing copy.
import { hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { keyCheck, verify } from 'desk-hub/protocol';
import { LOG_VECTORS, VECTOR_KEY } from '../../test/vectors';
import {
  checkFingerprint,
  holdKeyBytes,
  isSameKey,
  keyFingerprint,
  PASSPHRASE_COST,
  passkeyKdf,
  passphraseCost,
  passphraseInput,
  passphraseKdf,
  passphraseProblem,
  readPasskeyKdf,
  wrappingKeyFromPassphrase,
  wrappingKeyFromPrf,
} from './derive';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

describe('wrappingKeyFromPrf', () => {
  it('is HKDF-SHA-256 over the PRF output, salted with the org id, under the wrap label', async () => {
    // openssl kdf -keylen 32 -kdfopt digest:SHA256 -kdfopt hexkey:0001…1f -kdfopt salt:local -kdfopt info:smns-desk-wrap-v1 HKDF
    expect(hex(await wrappingKeyFromPrf(VECTOR_KEY, 'local'))).toBe('79f1ce8684c4170fdb1058a2b855200d1980b1924e544ab9db117f03cbac268e');
    expect(hex(await wrappingKeyFromPrf(VECTOR_KEY, 'local'))).toBe(hex(new Uint8Array(hkdfSync('sha256', VECTOR_KEY, 'local', 'smns-desk-wrap-v1', 32))));
  });

  it('gives each org its own wrapping key from one passkey', async () => {
    expect(hex(await wrappingKeyFromPrf(VECTOR_KEY, 'other'))).not.toBe(hex(await wrappingKeyFromPrf(VECTOR_KEY, 'local')));
  });

  it('refuses a PRF output that is not 32 bytes', async () => {
    await expect(wrappingKeyFromPrf(VECTOR_KEY.slice(0, 16), 'local')).rejects.toThrow(/32 bytes/);
  });
});

describe('wrappingKeyFromPassphrase', () => {
  it('is Argon2id (t 3, m 64 MiB, p 4) over the passphrase, salted with the wrap label and the org id', async () => {
    expect(PASSPHRASE_COST).toEqual({ t: 3, m: 65536, p: 4 });
    // openssl kdf -keylen 32 -kdfopt pass:'correct horse battery staple' -kdfopt hexsalt:<"smns-desk-wrap-v1\nlocal">
    //   -kdfopt iter:3 -kdfopt memcost:65536 -kdfopt lanes:4 -kdfopt threads:1 ARGON2ID
    const progress: number[] = [];
    const key = await wrappingKeyFromPassphrase('correct horse battery staple', 'local', PASSPHRASE_COST, (p) => progress.push(p));
    expect(hex(key)).toBe('fb16566d618213374c6a31d56015a4f55339b7d9af8005d3bf4445ebe37ebdce');
    expect(progress.length).toBeGreaterThan(0);
  }, 30_000);

  it('refuses a passphrase too short to stand against the hub, which holds wrapped copies to guess against', async () => {
    expect(passphraseProblem('short one')).toMatch(/at least 12 characters/);
    expect(passphraseProblem('correct horse battery staple')).toBeNull();
    await expect(wrappingKeyFromPassphrase('short one', 'local', PASSPHRASE_COST)).rejects.toThrow(/at least 12 characters/);
  });

  it('reads a passphrase as its NFC form, so one typed on another keyboard derives the same key', () => {
    // 'é' composed (U+00E9) and decomposed (e + U+0301) are the same text, and the same input to the derivation.
    expect(hex(passphraseInput('caf\u00e9 au lait'))).toBe(hex(passphraseInput('cafe\u0301 au lait')));
    expect(passphraseProblem('cafe\u0301 cafe\u0301 c')).toMatch(/at least 12/); // 13 code units, 11 characters
  });
});

describe('the kdf a wrapped copy carries', () => {
  it('names each derivation and its inputs, so a browser reads back how to open the copy', () => {
    expect(passkeyKdf('local')).toEqual({ name: 'webauthn-prf+hkdf-sha256', prf: 'smns-desk-wrap-v1', salt: 'local', info: 'smns-desk-wrap-v1' });
    expect(passphraseKdf('local', PASSPHRASE_COST)).toEqual({ name: 'argon2id', version: 19, t: 3, m: 65536, p: 4, salt: 'smns-desk-wrap-v1\nlocal', normalize: 'NFC' });
  });

  it("reads a passphrase's cost back, so it can rise without a new contract, within what a phone can run", () => {
    expect(passphraseCost(passphraseKdf('local', PASSPHRASE_COST), 'local')).toEqual(PASSPHRASE_COST);
    expect(passphraseCost(passphraseKdf('local', { t: 4, m: 131072, p: 4 }), 'local')).toEqual({ t: 4, m: 131072, p: 4 });
    expect(passphraseCost(passphraseKdf('local', { t: 3, m: 1048576, p: 4 }), 'local')).toBeNull(); // 1 GiB
    expect(passphraseCost({ ...passphraseKdf('local', PASSPHRASE_COST), name: 'scrypt' }, 'local')).toBeNull();
    expect(passphraseCost(passphraseKdf('other', PASSPHRASE_COST), 'local')).toBeNull(); // another org's salt
    expect(passphraseCost({ ...passphraseKdf('local', PASSPHRASE_COST), t: 2.5 }, 'local')).toBeNull();
  });

  it("reads a passkey's derivation back only as this version writes it", () => {
    expect(readPasskeyKdf(passkeyKdf('local'), 'local')).toBe(true);
    expect(readPasskeyKdf({ ...passkeyKdf('local'), info: 'smns-desk-org-key-v1' }, 'local')).toBe(false);
    expect(readPasskeyKdf(passkeyKdf('other'), 'local')).toBe(false);
  });
});

describe('holdKeyBytes', () => {
  it('holds the bytes as a non-extractable key that verifies the vectors, and wipes them', async () => {
    const raw = Uint8Array.from(VECTOR_KEY);
    const key = await holdKeyBytes(raw);
    expect(key.hmac.extractable).toBe(false);
    expect(raw.every((b) => b === 0)).toBe(true);
    for (const v of LOG_VECTORS) expect(await verify(key, 'log', v.project, v.event), v.name).toBe(true);
  });
});

describe('isSameKey', () => {
  it('tells whether bytes opened again are the key the browser holds', async () => {
    const held = await holdKeyBytes(Uint8Array.from(VECTOR_KEY));
    expect(await isSameKey(held, VECTOR_KEY)).toBe(true);
    const other = Uint8Array.from(VECTOR_KEY);
    other[0] ^= 1;
    expect(await isSameKey(held, other)).toBe(false);
  });
});

describe('keyFingerprint', () => {
  it("is the first 6 bytes of the key's check, for the owner to compare across browsers and with the org's", async () => {
    const key = await holdKeyBytes(Uint8Array.from(VECTOR_KEY));
    const a = await keyFingerprint(key);
    expect(a).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
    expect(checkFingerprint(await keyCheck(key))).toBe(a);
    expect(await keyFingerprint(await holdKeyBytes(Uint8Array.from(VECTOR_KEY)))).toBe(a);
    const other = Uint8Array.from(VECTOR_KEY);
    other[31] ^= 1;
    expect(await keyFingerprint(await holdKeyBytes(other))).not.toBe(a);
  });
});
