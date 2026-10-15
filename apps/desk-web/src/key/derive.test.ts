// The org key's derivations (§6; the DC5 plan's M2): from the passkey's PRF output through HKDF with the org id, or
// from a passphrase through Argon2id with the org id in the salt. The expected values were computed with OpenSSL's
// `kdf` (an implementation independent of the app's), and pin the parameters: any change to them changes every org's
// key, which every enrolled machine holds.
import { hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verify } from 'desk-hub/protocol';
import { LOG_VECTORS, VECTOR_KEY } from '../../test/vectors';
import { holdKeyBytes, isSameKey, keyFingerprint, orgKeyFromPassphrase, orgKeyFromPrf, passphraseInput, passphraseProblem, PASSPHRASE_KDF } from './derive';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

describe('orgKeyFromPrf', () => {
  it('is HKDF-SHA-256 over the PRF output, salted with the org id, under the desk label', async () => {
    // openssl kdf -keylen 32 -kdfopt digest:SHA256 -kdfopt hexkey:0001…1f -kdfopt salt:local -kdfopt info:smns-desk-org-key-v1 HKDF
    expect(hex(await orgKeyFromPrf(VECTOR_KEY, 'local'))).toBe('c5f48178baae30f3b697b9283e5d06ffab4562b5691f1284f477a9ae88fec997');
    expect(hex(await orgKeyFromPrf(VECTOR_KEY, 'local'))).toBe(hex(new Uint8Array(hkdfSync('sha256', VECTOR_KEY, 'local', 'smns-desk-org-key-v1', 32))));
  });

  it('gives each org its own key from one passkey', async () => {
    expect(hex(await orgKeyFromPrf(VECTOR_KEY, 'other'))).not.toBe(hex(await orgKeyFromPrf(VECTOR_KEY, 'local')));
  });

  it('refuses a PRF output that is not 32 bytes', async () => {
    await expect(orgKeyFromPrf(VECTOR_KEY.slice(0, 16), 'local')).rejects.toThrow(/32 bytes/);
  });
});

describe('orgKeyFromPassphrase', () => {
  it('is Argon2id (t 3, m 64 MiB, p 4) over the passphrase, salted with the desk label and the org id', async () => {
    expect(PASSPHRASE_KDF).toEqual({ algorithm: 'argon2id', version: 0x13, t: 3, m: 65536, p: 4, dkLen: 32, salt: 'smns-desk-org-key-v1\n<org id>' });
    // openssl kdf -keylen 32 -kdfopt pass:'correct horse battery staple' -kdfopt hexsalt:<"smns-desk-org-key-v1\nlocal">
    //   -kdfopt iter:3 -kdfopt memcost:65536 -kdfopt lanes:4 -kdfopt threads:1 ARGON2ID
    const progress: number[] = [];
    const key = await orgKeyFromPassphrase('correct horse battery staple', 'local', (p) => progress.push(p));
    expect(hex(key)).toBe('ccafc5e340908adc55e7aaf5c96927c095795110c8702298c8dda033c8a4a746');
    expect(progress.length).toBeGreaterThan(0);
  }, 30_000);

  it('refuses a passphrase too short to stand against the hub, which holds codes to guess against', async () => {
    expect(passphraseProblem('short one')).toMatch(/at least 12 characters/);
    expect(passphraseProblem('correct horse battery staple')).toBeNull();
    await expect(orgKeyFromPassphrase('short one', 'local')).rejects.toThrow(/at least 12 characters/);
  });

  it('reads a passphrase as its NFC form, so one typed on another keyboard derives the same key', () => {
    // 'é' composed (U+00E9) and decomposed (e + U+0301) are the same text, and the same input to the derivation.
    expect(hex(passphraseInput('café au lait'))).toBe(hex(passphraseInput('café au lait')));
    expect(passphraseProblem('café café c')).toMatch(/at least 12/); // 13 code units, 11 characters
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
  it('tells whether bytes derived again are the key the browser holds', async () => {
    const held = await holdKeyBytes(Uint8Array.from(VECTOR_KEY));
    expect(await isSameKey(held, VECTOR_KEY)).toBe(true);
    const other = Uint8Array.from(VECTOR_KEY);
    other[0] ^= 1;
    expect(await isSameKey(held, other)).toBe(false);
  });
});

describe('keyFingerprint', () => {
  it('is a short check the owner can compare across browsers, the same for the same key', async () => {
    const a = await keyFingerprint(await holdKeyBytes(Uint8Array.from(VECTOR_KEY)));
    expect(a).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
    expect(await keyFingerprint(await holdKeyBytes(Uint8Array.from(VECTOR_KEY)))).toBe(a);
    const other = Uint8Array.from(VECTOR_KEY);
    other[31] ^= 1;
    expect(await keyFingerprint(await holdKeyBytes(other))).not.toBe(a);
  });
});
