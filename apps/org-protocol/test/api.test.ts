// What the vectors cannot say: the signing helpers' refusals and the key handling's edges.
import { describe, expect, it } from 'vitest';
import { base64urlDecode, base64urlEncode } from '../src/base64url.ts';
import { eventSigningInput, signEvent, verifyEvent } from '../src/events.ts';
import { generateSigningKey, importPublicKey, importSigningKey, isPublicKey, isSig, keyId } from '../src/keys.ts';
import type { OrgState } from '../src/types.ts';
import { ORG, PROJECT, VECTORS } from '../vectors/index.ts';

const ctx = { org: ORG, project: PROJECT };
const event = { writer: 'mini/67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b', seq: 1, ts: '2026-10-27T00:00:00.000Z', kind: 'say', text: 'hi' };

describe('signEvent', () => {
  it('signs before DX1 seals: an event that already has a mac is refused', async () => {
    const key = await generateSigningKey();
    await expect(signEvent(ctx, { ...event, mac: { nonce: 'AQEBAQEBAQEBAQEBAQEBAQ', value: 'x' } }, key.privateKey, key.pub)).rejects.toThrow(TypeError);
  });

  it('signs once: an event that already carries a sig is refused', async () => {
    const key = await generateSigningKey();
    const signed = await signEvent(ctx, event, key.privateKey, key.pub);
    await expect(signEvent(ctx, signed, key.privateKey, key.pub)).rejects.toThrow(TypeError);
  });

  it("names its key by kid and makes a 64-byte P1363 value", async () => {
    const key = await generateSigningKey();
    const { sig } = await signEvent(ctx, event, key.privateKey, key.pub);
    expect(sig.kid).toBe(await keyId(key.pub));
    expect(base64urlDecode(sig.value)).toHaveLength(64);
    expect(isSig(sig)).toBe(true);
  });
});

describe('an event context', () => {
  it('holds no newline, so the org and the project cannot run into each other', async () => {
    expect(() => eventSigningInput({ org: 'a\nb', project: 'c' }, event)).toThrow(TypeError);
    expect(() => eventSigningInput({ org: ORG, project: '' }, event)).toThrow(TypeError);
    const state = (VECTORS.fixtures.v2 as { state: OrgState }).state;
    const signed = VECTORS.fixtures["a machine's event signed by its key"] as Parameters<typeof verifyEvent>[2];
    expect(await verifyEvent({ org: ORG, project: `${PROJECT}\n` }, state, signed, [], new Date('2026-10-28T00:00:00.000Z'))).toEqual({ ok: false, code: 'malformed' });
  });
});

describe('verifyEvent', () => {
  it('refuses an event RFC 8785 cannot write as malformed, without throwing', async () => {
    const state = (VECTORS.fixtures.v2 as { state: OrgState }).state;
    const signed = VECTORS.fixtures["a machine's event signed by its key"] as Parameters<typeof verifyEvent>[2];
    expect(await verifyEvent(ctx, state, { ...signed, size: Number.NaN }, [], new Date('2026-10-28T00:00:00.000Z'))).toEqual({ ok: false, code: 'malformed' });
  });
});

describe('keys', () => {
  it('are made non-extractable unless asked', async () => {
    expect((await generateSigningKey()).privateKey.extractable).toBe(false);
    expect((await generateSigningKey(true)).privateKey.extractable).toBe(true);
  });

  it('are uncompressed points on the curve', async () => {
    const { pub } = await generateSigningKey();
    const point = base64urlDecode(pub);
    expect(point[0]).toBe(4);
    expect(await importPublicKey(pub)).not.toBeNull();
    const compressed = new Uint8Array(33);
    compressed.set(point.subarray(0, 33));
    compressed[0] = 2 + (point[64] & 1);
    expect(isPublicKey(base64urlEncode(compressed))).toBe(false);
    const offCurve = Uint8Array.from(point);
    offCurve[64] ^= 1;
    expect(isPublicKey(base64urlEncode(offCurve))).toBe(true);
    expect(await importPublicKey(base64urlEncode(offCurve))).toBeNull();
  });

  it('import from a private P-256 JWK only', async () => {
    await expect(importSigningKey({ kty: 'EC', crv: 'P-256', x: 'x', y: 'y' })).rejects.toThrow(TypeError);
    await expect(importSigningKey({ kty: 'RSA', d: 'd' })).rejects.toThrow(TypeError);
  });

  it('carry exactly {kid, value} in a signature', () => {
    const sig = { kid: base64urlEncode(new Uint8Array(16)), value: base64urlEncode(new Uint8Array(64)) };
    expect(isSig(sig)).toBe(true);
    expect(isSig({ ...sig, alg: 'ES256' })).toBe(false);
    expect(isSig({ ...sig, value: base64urlEncode(new Uint8Array(72)) })).toBe(false);
  });
});
