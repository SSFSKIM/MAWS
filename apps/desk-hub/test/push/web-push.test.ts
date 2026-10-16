// Web Push on WebCrypto: RFC 8291's worked example (section 5 and appendix A) reproduced byte for byte, a payload a user
// agent decrypts, and a VAPID header whose ES256 signature verifies against the key it names.
import { describe, expect, it } from 'vitest';
import { encryptPayload, generateVapidKey, importSenderKeys, importVapidKey, pushRequest, vapidAuthorization } from '../../src/push/web-push';
import { decrypt, importUserAgentKey, userAgent, vapidClaims } from '../support/push';

const unb64 = (text: string) => new Uint8Array(Buffer.from(text.replace(/\s+/g, ''), 'base64url'));
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

// RFC 8291 section 5, with appendix A's inputs.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcx aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIg Dll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: `DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
         mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
         pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`,
};

describe('RFC 8291 payload encryption', () => {
  it("reproduces the RFC's worked example byte for byte", async () => {
    const sender = await importSenderKeys(unb64(RFC.asPrivate), unb64(RFC.asPublic));
    const keys = { p256dh: b64(unb64(RFC.uaPublic)), auth: RFC.auth };
    const body = await encryptPayload(keys, new TextEncoder().encode(RFC.plaintext), { salt: unb64(RFC.salt), sender });
    expect(b64(body)).toBe(b64(unb64(RFC.body)));
    // 86 bytes of header, 41 of text, the delimiter, the 16-byte tag. The RFC's request says `Content-Length: 145`, one
    // more than its own body: the 192 base64url characters it prints decode to 144 bytes.
    expect(body.length).toBe(144);
    // And the RFC's receiver, reading it independently, gets the plaintext back.
    const privateKey = await importUserAgentKey(unb64(RFC.uaPrivate), unb64(RFC.uaPublic));
    expect(new TextDecoder().decode(await decrypt({ keys, privateKey }, body))).toBe(RFC.plaintext);
  });

  it('encrypts under a fresh salt and sender key each time, and only the subscription decrypts it', async () => {
    const ua = await userAgent('https://push.test/a');
    const payload = new TextEncoder().encode('{"kind":"question"}');
    const one = await encryptPayload(ua.keys, payload);
    const two = await encryptPayload(ua.keys, payload);
    expect(b64(one)).not.toBe(b64(two));
    expect(new TextDecoder().decode(await decrypt(ua, one))).toBe('{"kind":"question"}');
    const other = await userAgent('https://push.test/b');
    await expect(decrypt({ keys: ua.keys, privateKey: other.privateKey }, one)).rejects.toThrow();
  });

  it('refuses a payload that does not fit one record, and an auth secret that is not 16 bytes', async () => {
    const ua = await userAgent('https://push.test/a');
    await expect(encryptPayload(ua.keys, new Uint8Array(4080))).rejects.toThrow(RangeError);
    await expect(encryptPayload({ ...ua.keys, auth: b64(new Uint8Array(15)) }, new Uint8Array(1))).rejects.toThrow(TypeError);
  });
});

describe('VAPID (RFC 8292)', () => {
  it("signs a JWT for the push service's origin, twelve hours on, verifiable with the public key it names", async () => {
    const vapid = await importVapidKey(await generateVapidKey());
    const now = Date.parse('2026-10-15T08:00:00.000Z');
    const header = await vapidAuthorization(vapid, 'https://push.test/send/abc?x=1', 'mailto:owner@example.com', now);
    const { claims, key } = await vapidClaims(header);
    expect(key).toBe(vapid.publicKey);
    expect(unb64(key)).toHaveLength(65);
    expect(claims).toEqual({ aud: 'https://push.test', exp: now / 1000 + 12 * 3600, sub: 'mailto:owner@example.com' });
  });

  it('refuses a secret that is not a P-256 private JWK', async () => {
    await expect(importVapidKey('not json')).rejects.toThrow(TypeError);
    await expect(importVapidKey(JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'a', y: 'b' }))).rejects.toThrow(TypeError);
  });

  it('builds a push request a push service accepts: aes128gcm, TTL, urgency, and the VAPID header', async () => {
    const vapid = await importVapidKey(await generateVapidKey());
    const ua = await userAgent('https://push.test/send/1');
    const request = await pushRequest(vapid, 'mailto:owner@example.com', ua, { kind: 'permission', project: 'p' });
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://push.test/send/1');
    expect(request.headers.get('Content-Encoding')).toBe('aes128gcm');
    expect(request.headers.get('TTL')).toBe('3600');
    expect(request.headers.get('Urgency')).toBe('high');
    await vapidClaims(request.headers.get('Authorization')!);
    const body = new Uint8Array(await request.arrayBuffer());
    expect(JSON.parse(new TextDecoder().decode(await decrypt(ua, body)))).toEqual({ kind: 'permission', project: 'p' });
  });
});
