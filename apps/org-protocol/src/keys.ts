// P-256 keys and signatures (Interfaces §A's encodings). A public key is the base64url of its uncompressed point (65
// bytes); a key id is the base64url of the first 16 bytes of SHA-256 over that point; a signature is ECDSA P-256 with
// SHA-256, in WebCrypto's IEEE P1363 form `r‖s` (64 bytes), base64url. The signing input is UTF-8
// `"<domain>\n" + canonicalize(body)`; the log event's own input is in events.ts.
import { base64urlDecode, base64urlEncode, isBase64urlOf } from './base64url.ts';
import { canonicalize } from './canonical.ts';

/** Base64url, canonical spelling, no padding. */
export type B64 = string;
/** A signature that names its signer: `kid` is `keyId` of the signing key's public point. */
export type Sig = { kid: string; value: B64 };
/** A private signing key with its public point, as a holder keeps them together. */
export type SigningKey = { privateKey: CryptoKey; pub: B64 };

export const POINT_BYTES = 65;
export const KID_BYTES = 16;
export const SIGNATURE_BYTES = 64;

const CURVE = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ECDSA_SHA256 = { name: 'ECDSA', hash: 'SHA-256' } as const;
const encoder = new TextEncoder();

/** UTF-8, in a buffer of its own (some runtimes type `encode`'s result as possibly shared, which WebCrypto refuses). */
export const utf8 = (text: string): Uint8Array<ArrayBuffer> => new Uint8Array(encoder.encode(text));

/** True for the canonical base64url of 65 bytes in the uncompressed form (0x04 first). On-curve is `importPublicKey`'s. */
export function isPublicKey(pub: unknown): pub is B64 {
  return isBase64urlOf(pub, POINT_BYTES) && base64urlDecode(pub as string)[0] === 0x04;
}

/** True for exactly `{kid, value}`, each canonical base64url of 16 and 64 bytes. */
export function isSig(sig: unknown): sig is Sig {
  if (typeof sig !== 'object' || sig === null || Array.isArray(sig)) return false;
  const keys = Object.keys(sig);
  const { kid, value } = sig as Record<string, unknown>;
  return keys.length === 2 && isBase64urlOf(kid, KID_BYTES) && isBase64urlOf(value, SIGNATURE_BYTES);
}

/** The key id of a public point: base64url of the first 16 bytes of its SHA-256. */
export async function keyId(pub: B64): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', base64urlDecode(pub)));
  return base64urlEncode(digest.slice(0, KID_BYTES));
}

/** A fresh P-256 signing key. Non-extractable unless asked: only a test or a key file's writer needs the private half. */
export async function generateSigningKey(extractable = false): Promise<SigningKey> {
  // The Workers' types widen both results to every algorithm's; an ECDSA pair and a raw export are what they are here.
  const pair = (await crypto.subtle.generateKey(CURVE, extractable, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer;
  return { privateKey: pair.privateKey, pub: base64urlEncode(new Uint8Array(raw)) };
}

/** The verifying key of a public point, or null when it is not one (bad encoding, or a point off the curve). */
export async function importPublicKey(pub: B64): Promise<CryptoKey | null> {
  if (!isPublicKey(pub)) return null;
  try {
    return await crypto.subtle.importKey('raw', base64urlDecode(pub), CURVE, true, ['verify']);
  } catch {
    return null;
  }
}

/** UTF-8 `"<domain>\n" + canonicalize(body)`. */
export function signingInput(domain: string, body: unknown): Uint8Array<ArrayBuffer> {
  return utf8(`${domain}\n${canonicalize(body)}`);
}

/** Signs `input` with `key`, whose public point is `pub` (the signature's `kid` is derived from it). */
export async function signInput(input: Uint8Array<ArrayBuffer>, key: CryptoKey, pub: B64): Promise<Sig> {
  const value = new Uint8Array(await crypto.subtle.sign(ECDSA_SHA256, key, input));
  return { kid: await keyId(pub), value: base64urlEncode(value) };
}

/** True when `sig` verifies over `input` under `pub`. The caller has matched `sig.kid` to `pub`. */
export async function verifyInput(input: Uint8Array<ArrayBuffer>, sig: Sig, pub: B64): Promise<boolean> {
  const key = await importPublicKey(pub);
  if (key === null || !isBase64urlOf(sig.value, SIGNATURE_BYTES)) return false;
  try {
    return await crypto.subtle.verify(ECDSA_SHA256, key, base64urlDecode(sig.value), input);
  } catch {
    return false;
  }
}

/** Signs `body` under `domain`. */
export const signBody = (domain: string, body: unknown, key: CryptoKey, pub: B64): Promise<Sig> => signInput(signingInput(domain, body), key, pub);

/** Finds the key `sig.kid` names among `allowed` (public points), or null when it names none of them. */
export async function keyNamed(kid: string, allowed: Iterable<B64>): Promise<B64 | null> {
  for (const pub of allowed) if ((await keyId(pub)) === kid) return pub;
  return null;
}

/** A signing key from its private JWK (a P-256 `EC` key with `d`), with its public point taken from `x` and `y`. */
export async function importSigningKey(jwk: JsonWebKey, extractable = false): Promise<SigningKey> {
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string' || typeof jwk.d !== 'string') {
    throw new TypeError('a signing key is a private P-256 JWK');
  }
  const privateKey = await crypto.subtle.importKey('jwk', jwk, CURVE, extractable, ['sign']);
  const point = new Uint8Array(POINT_BYTES);
  point[0] = 0x04;
  point.set(base64urlDecode(jwk.x), 1);
  point.set(base64urlDecode(jwk.y), 33);
  return { privateKey, pub: base64urlEncode(point) };
}
