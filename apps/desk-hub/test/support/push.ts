// A user agent's side of Web Push for the suites: a subscription's keys, and decryption of what a push service would
// hand it (RFC 8291), written apart from src/push so the hub's encryption is checked against an independent reading.
const subtle = crypto.subtle;
const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
/** Bytes in a buffer of their own, as WebCrypto takes them. */
const own = (bytes: Uint8Array | Buffer): Uint8Array<ArrayBuffer> => Uint8Array.from(bytes);
const unb64 = (text: string) => own(Buffer.from(text, 'base64url'));

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const k = await subtle.importKey('raw', own(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', k, own(data)));
}
const expand = async (salt: Uint8Array, ikm: Uint8Array, info: string | Uint8Array, length: number) =>
  (await hmac(await hmac(salt, ikm), Buffer.concat([typeof info === 'string' ? Buffer.from(info, 'latin1') : info, Buffer.of(1)]))).slice(0, length);

export type UserAgent = { endpoint: string; keys: { p256dh: string; auth: string }; privateKey: CryptoKey };

/** A browser's push subscription at `endpoint`: a fresh P-256 key pair and a 16-byte auth secret. */
export async function userAgent(endpoint: string): Promise<UserAgent> {
  const pair = (await subtle.generateKey(P256, true, ['deriveBits'])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  return { endpoint, keys: { p256dh: b64(publicKey), auth: b64(crypto.getRandomValues(new Uint8Array(16))) }, privateKey: pair.privateKey };
}

/** Imports a user agent's private key from its raw scalar and uncompressed public point (RFC 8291's example). */
export async function importUserAgentKey(privateKey: Uint8Array, publicKey: Uint8Array): Promise<CryptoKey> {
  const jwk = { kty: 'EC', crv: 'P-256', x: b64(publicKey.slice(1, 33)), y: b64(publicKey.slice(33)), d: b64(privateKey) };
  return subtle.importKey('jwk', jwk, P256, false, ['deriveBits']);
}

/** The payload of an aes128gcm push body, as the user agent decrypts it; throws when it does not decrypt. */
export async function decrypt(ua: Pick<UserAgent, 'keys' | 'privateKey'>, body: Uint8Array): Promise<Uint8Array> {
  const salt = own(body.slice(0, 16));
  const idlen = body[20];
  const senderPublic = own(body.slice(21, 21 + idlen));
  const uaPublic = unb64(ua.keys.p256dh);
  const sender = await subtle.importKey('raw', senderPublic, P256, false, []);
  const ecdh = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: sender }, ua.privateKey, 256));
  const ikm = await expand(unb64(ua.keys.auth), ecdh, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, senderPublic]), 32);
  const cek = await expand(salt, ikm, 'Content-Encoding: aes128gcm\0', 16);
  const nonce = await expand(salt, ikm, 'Content-Encoding: nonce\0', 12);
  const key = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, own(body.slice(21 + idlen))));
  const end = plain.lastIndexOf(2);
  if (end < 0) throw new Error('no record delimiter');
  return plain.slice(0, end);
}

/** The claims of a VAPID `Authorization` header, after checking its ES256 signature against the key it names. */
export async function vapidClaims(authorization: string): Promise<{ claims: { aud: string; exp: number; sub: string }; key: string }> {
  const match = /^vapid t=([^,]+), k=(.+)$/.exec(authorization);
  if (!match) throw new Error(`not a VAPID header: ${authorization}`);
  const [header, claims, signature] = match[1].split('.');
  const key = await subtle.importKey('raw', unb64(match[2]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64(signature), own(Buffer.from(`${header}.${claims}`)));
  if (!ok) throw new Error('the VAPID signature does not verify');
  if (JSON.parse(Buffer.from(header, 'base64url').toString()).alg !== 'ES256') throw new Error('not ES256');
  return { claims: JSON.parse(Buffer.from(claims, 'base64url').toString()), key: match[2] };
}
