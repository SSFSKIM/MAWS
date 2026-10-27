// The enrollment MAC (RL §5.3, RL DL 19): the enrolling machine proves to the member's device that the hub passed its
// name, key and ref through unchanged, with the pairing secret `k` that travelled by hand and never through the hub:
//
//     HMAC-SHA-256(k, enrollmentMacInput(name, machinePub, ref, tokenId))
//
// The input is the domain and each field as UTF-8, each preceded by its byte length as a 4-byte big-endian integer,
// so no two field lists encode alike (name `ab` + ref `cd…` and name `a` + ref `bcd…` differ).
import { base64urlDecode, base64urlEncode, isBase64urlOf } from './base64url.ts';
import { isPublicKey, utf8, type B64 } from './keys.ts';
import { isMachineName, isMachineRef } from './names.ts';

export const ENROLLMENT_MAC_DOMAIN = 'smns-enroll-mac-v1';
export type EnrollmentFields = { name: string; machinePub: B64; ref: string; tokenId: string };

/** The length-prefixed bytes the MAC covers. Throws a TypeError for a field outside its grammar. */
export function enrollmentMacInput(fields: EnrollmentFields): Uint8Array<ArrayBuffer> {
  const { name, machinePub, ref, tokenId } = fields;
  if (!isMachineName(name) || !isPublicKey(machinePub) || !isMachineRef(ref) || typeof tokenId !== 'string' || tokenId === '') {
    throw new TypeError('an enrollment names an admitted machine name, its public point, its ref and a token id');
  }
  const parts = [ENROLLMENT_MAC_DOMAIN, name, machinePub, ref, tokenId].map(utf8);
  const out = new Uint8Array(parts.reduce((n, part) => n + 4 + part.length, 0));
  let at = 0;
  for (const part of parts) {
    new DataView(out.buffer).setUint32(at, part.length);
    out.set(part, at + 4);
    at += 4 + part.length;
  }
  return out;
}

async function hmacKey(k: Uint8Array): Promise<CryptoKey> {
  if (k.length < 16) throw new TypeError('the pairing secret is at least 128 bits');
  return crypto.subtle.importKey('raw', Uint8Array.from(k), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** The machine's MAC over its enrollment, base64url (32 bytes). */
export async function enrollmentMac(k: Uint8Array, fields: EnrollmentFields): Promise<B64> {
  return base64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(k), enrollmentMacInput(fields))));
}

/** True when `mac` is the canonical base64url of the MAC over `fields` under `k`; false for any field out of grammar. */
export async function verifyEnrollmentMac(k: Uint8Array, fields: EnrollmentFields, mac: unknown): Promise<boolean> {
  if (!isBase64urlOf(mac, 32)) return false;
  let input: Uint8Array<ArrayBuffer>;
  try {
    input = enrollmentMacInput(fields);
  } catch {
    return false;
  }
  return crypto.subtle.verify('HMAC', await hmacKey(k), base64urlDecode(mac as string), input);
}
