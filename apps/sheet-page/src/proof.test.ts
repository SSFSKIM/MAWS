// T28 in the page: the tab makes the MAC the server proves itself with, from the credential alone, with @noble/hashes
// (T21: no crypto.subtle, which a browser gives only to a secure context). Held to the server's own pairing, so the
// page's and mawsd's halves of §L's opening cannot drift apart.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPairing } from '../../../src/mawsd/sheet-page/pairing';
import { SHEET_PAGE_TIMING } from '../../../src/mawsd/sheet-page/timing';
import { freshNonce, macOf, macsEqual, proofKeyOf } from './proof';

let scratch: string | null = null;
afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

function paired() {
  scratch = mkdtempSync(join(tmpdir(), 'sheet-page-proof-'));
  const pairing = createPairing({ file: join(scratch, 'sheet-page.json'), now: Date.now, random: randomBytes, log: () => {}, timing: SHEET_PAGE_TIMING });
  const { code } = pairing.mint();
  const answer = pairing.exchange(code, 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0');
  if (!answer.ok) throw new Error(`the exchange failed: ${answer.why}`);
  return { pairing, id: answer.id, credential: answer.credential };
}

const ORIGIN = 'http://sheet.localhost:47590';

describe('the proof, as the page makes it', () => {
  it('is the MAC mawsd’s pairing makes for that origin, browser and nonce', () => {
    const { pairing, id, credential } = paired();
    const key = proofKeyOf(credential);
    for (let i = 0; i < 3; i++) {
      const nonce = freshNonce();
      expect(macOf(key, ORIGIN, id, nonce)).toBe(pairing.prove(id, nonce, ORIGIN));
    }
  });

  it('differs for another nonce, another credential and another origin', () => {
    const { pairing, id, credential } = paired();
    const nonce = freshNonce();
    const mac = macOf(proofKeyOf(credential), ORIGIN, id, nonce);
    expect(macOf(proofKeyOf(credential), ORIGIN, id, freshNonce())).not.toBe(mac);
    expect(macOf(proofKeyOf(randomBytes(32).toString('base64url')), ORIGIN, id, nonce)).not.toBe(mac);
    expect(pairing.prove(id, nonce, 'http://sheet.localhost:47591')).not.toBe(mac); // a daemon serving another port
  });

  it('takes a nonce of 32 random bytes in base64url, fresh each time', () => {
    const nonces = new Set(Array.from({ length: 64 }, freshNonce));
    expect(nonces.size).toBe(64);
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('compares two MACs by their whole length and every character', () => {
    expect(macsEqual('abc', 'abc')).toBe(true);
    expect(macsEqual('abc', 'abd')).toBe(false);
    expect(macsEqual('abc', 'abcd')).toBe(false);
    expect(macsEqual('', '')).toBe(false); // no MAC is empty
  });
});
