// Web Push from the Worker on WebCrypto alone (the npm `web-push` package needs Node's crypto, which a Worker lacks):
// the payload encrypted as RFC 8291 has it (aes128gcm, RFC 8188, one record), and the request signed with VAPID (RFC
// 8292, ES256). The hub's VAPID key is a P-256 private key kept as a Worker secret in JWK form (`VAPID_KEY`); its public
// half is the `applicationServerKey` a browser subscribes with.
import { base64urlDecode, base64urlEncode } from '../protocol/base64url';

/** What a browser's `PushSubscription.toJSON()` gives: the push service's URL and the user agent's keys. */
export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } };

export type VapidKey = {
  /** The uncompressed P-256 point (65 bytes), base64url: the browser's `applicationServerKey`. */
  publicKey: string;
  signing: CryptoKey;
};

const encoder = new TextEncoder();
const RECORD_SIZE = 4096;
const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;

const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', Uint8Array.from(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, Uint8Array.from(data)));
}

/** HKDF (RFC 5869) with SHA-256, for one block of output, as RFC 8291 uses it. */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, Uint8Array.of(1)))).slice(0, length);
}

/** A P-256 point's JWK coordinates, from its uncompressed form. */
function coordinates(point: Uint8Array): { x: string; y: string } {
  if (point.length !== 65 || point[0] !== 4) throw new TypeError('a P-256 public key is 65 bytes, uncompressed');
  return { x: base64urlEncode(point.slice(1, 33)), y: base64urlEncode(point.slice(33)) };
}

/** The sender's ephemeral ECDH key pair; a test passes RFC 8291's own. */
export type SenderKeys = { privateKey: CryptoKey; publicKey: Uint8Array };

export async function senderKeys(): Promise<SenderKeys> {
  const pair = (await crypto.subtle.generateKey(P256, true, ['deriveBits'])) as CryptoKeyPair;
  return { privateKey: pair.privateKey, publicKey: new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer) };
}

/** Imports a sender key pair from its raw private scalar and its uncompressed public point (RFC 8291's example). */
export async function importSenderKeys(privateKey: Uint8Array, publicKey: Uint8Array): Promise<SenderKeys> {
  const jwk = { kty: 'EC', crv: 'P-256', ...coordinates(publicKey), d: base64urlEncode(privateKey), ext: true };
  return { privateKey: await crypto.subtle.importKey('jwk', jwk, P256, false, ['deriveBits']), publicKey };
}

/**
 * RFC 8291: the message body a push service carries to the user agent — the aes128gcm header (salt, record size 4096,
 * the sender's public key) and one record holding the payload and its delimiter. `salt` and `sender` are drawn fresh
 * unless a test gives them.
 */
export async function encryptPayload(
  target: PushTarget['keys'],
  payload: Uint8Array,
  options: { salt?: Uint8Array; sender?: SenderKeys } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = base64urlDecode(target.p256dh);
  const authSecret = base64urlDecode(target.auth);
  if (authSecret.length !== 16) throw new TypeError('the auth secret is 16 bytes');
  if (payload.length + 1 + 16 > RECORD_SIZE) throw new RangeError('a push payload fits one 4096-byte record');
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const sender = options.sender ?? (await senderKeys());

  const uaKey = await crypto.subtle.importKey('raw', Uint8Array.from(uaPublic), P256, false, []);
  // WebCrypto's ECDH parameter is `public`, as workerd and Node take it; @cloudflare/workers-types spells it `$public`.
  const ecdh = { name: 'ECDH', public: uaKey } as never;
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdh, sender.privateKey, 256));
  const keyInfo = concat(encoder.encode('WebPush: info\0'), uaPublic, sender.publicKey);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

  const aes = await crypto.subtle.importKey('raw', Uint8Array.from(cek), 'AES-GCM', false, ['encrypt']);
  const record = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: Uint8Array.from(nonce) }, aes, concat(payload, Uint8Array.of(2))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = sender.publicKey.length;
  return concat(header, sender.publicKey, record);
}

/** The hub's VAPID key from its secret: a P-256 private key as JWK JSON (`kty` EC, `crv` P-256, with `x`, `y`, `d`). */
export async function importVapidKey(secret: string): Promise<VapidKey> {
  let jwk: JsonWebKey;
  try {
    jwk = JSON.parse(secret) as JsonWebKey;
  } catch {
    throw new TypeError('VAPID_KEY is a P-256 private key as JWK JSON');
  }
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y || !jwk.d) throw new TypeError('VAPID_KEY is a P-256 private key as JWK JSON');
  const signing = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return { publicKey: base64urlEncode(concat(Uint8Array.of(4), base64urlDecode(jwk.x), base64urlDecode(jwk.y))), signing };
}

/** A fresh VAPID key, as the secret holds it (the local command and the suites; the deployed one is made once, at M5). */
export async function generateVapidKey(): Promise<string> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const { kty, crv, x, y, d } = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  return JSON.stringify({ kty, crv, x, y, d });
}

const b64json = (value: unknown) => base64urlEncode(encoder.encode(JSON.stringify(value)));

/**
 * RFC 8292's `Authorization` header: `vapid t=<JWT>, k=<public key>`, the JWT signed ES256 with `aud` the push service's
 * origin, `exp` twelve hours on (a push service refuses more than 24), and `sub` a contact for the push service.
 */
export async function vapidAuthorization(vapid: VapidKey, endpoint: string, subject: string, now = Date.now()): Promise<string> {
  const unsigned = `${b64json({ typ: 'JWT', alg: 'ES256' })}.${b64json({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })}`;
  // WebCrypto's ECDSA signature is r || s, 64 bytes: the JWS form ES256 takes.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapid.signing, encoder.encode(unsigned)));
  return `vapid t=${unsigned}.${base64urlEncode(signature)}, k=${vapid.publicKey}`;
}

/** One push to one subscription (RFC 8030), its payload JSON encrypted for that subscription's keys. */
export async function pushRequest(
  vapid: VapidKey,
  subject: string,
  target: PushTarget,
  payload: unknown,
  options: { ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high' } = {},
): Promise<Request> {
  const body = await encryptPayload(target.keys, encoder.encode(JSON.stringify(payload)));
  return new Request(target.endpoint, {
    method: 'POST',
    headers: {
      TTL: String(options.ttl ?? 3600),
      Urgency: options.urgency ?? 'high',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      Authorization: await vapidAuthorization(vapid, target.endpoint, subject),
    },
    body,
  });
}
