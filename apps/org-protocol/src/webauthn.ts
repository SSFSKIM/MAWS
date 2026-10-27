// A web-cards device's WebAuthn assertion over an action (RL §5.10): its challenge is the action's digest
// (action.ts), so the assertion signs exactly the action it rides. ES256 only: the passkey's `publicKey` is its P-256
// point, base64url of the 65-byte uncompressed form, as every key in the package (the enrolling app takes it from the
// last 65 bytes of the credential's SubjectPublicKeyInfo); the signature is DER, as authenticators send it.
//
// The checks, each refusing with its own code, in this order: the assertion's shape (`malformed`), the credential
// (`unknown-signer`), the signature over authenticatorData ‖ SHA-256(clientDataJSON) (`bad-signature`), the client
// data's type (`malformed`), challenge (`challenge`) and origin (`origin`), the relying party's hash (`rp-id`), the
// user-present and user-verified flags (`user-presence`, `user-verification`), and the counter (`counter`): it must rise
// when the stored or the received counter is non-zero, and zero to zero passes, since an authenticator that keeps no
// counter always sends zero (RL §5.10, "where the authenticator keeps one"); replay stays bounded by the action's nonce
// and `opId`.
import { actionDigest, isAction, type Action } from './action.ts';
import { base64urlDecode, base64urlEncode } from './base64url.ts';
import { importPublicKey, utf8, type B64 } from './keys.ts';
import { accept, refuse, type Verdict } from './verdict.ts';

/** The authenticator data's fixed head: the rpId hash (32), the flags (1), the counter (4, big-endian). */
const AUTH_DATA_MIN = 37;
export const FLAG_USER_PRESENT = 0x01;
export const FLAG_USER_VERIFIED = 0x04;

/**
 * An ECDSA signature's DER form (`SEQUENCE { INTEGER r, INTEGER s }`) as WebCrypto's P1363 `r‖s` for P-256, or null for
 * anything but the strict form: short lengths, positive minimal integers of at most 32 bytes, nothing after.
 */
export function derToP1363(der: Uint8Array): Uint8Array<ArrayBuffer> | null {
  if (der.length < 8 || der[0] !== 0x30 || der[1] !== der.length - 2 || der[1] > 0x7f) return null;
  const out = new Uint8Array(64);
  let at = 2;
  for (const half of [0, 1]) {
    if (der[at] !== 0x02) return null;
    const len = der[at + 1];
    const start = at + 2;
    if (len < 1 || len > 33 || start + len > der.length) return null;
    const value = der.subarray(start, start + len);
    if (value[0] & 0x80) return null; // negative
    if (len > 1 && value[0] === 0 && !(value[1] & 0x80)) return null; // not minimal
    const magnitude = value[0] === 0 ? value.subarray(1) : value;
    if (magnitude.length > 32 || magnitude.every((b) => b === 0)) return null;
    out.set(magnitude, half * 32 + 32 - magnitude.length);
    at = start + len;
  }
  return at === der.length ? out : null;
}

const sha256 = async (bytes: Uint8Array<ArrayBuffer>) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i]);

function decode(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    return base64urlDecode(text);
  } catch {
    return null;
  }
}

/** The client data as the browser serialized it: its `type`, `challenge` and `origin`, or null when it is not JSON. */
function clientData(bytes: Uint8Array<ArrayBuffer>): { type?: unknown; challenge?: unknown; origin?: unknown } | null {
  try {
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * `a.webauthn` checked against the device's passkey, the origin the verifier serves the phone's code from, and the
 * counter it last stored for the credential (0 for none). On success it answers the received counter, which the
 * verifier stores.
 */
export async function verifyWebAuthn(
  a: Action,
  passkey: { credentialId: B64; publicKey: B64; rpId: string },
  origin: string,
  lastCounter: number,
): Promise<Verdict & { counter?: number }> {
  if (!isAction(a) || a.webauthn === undefined) return refuse('malformed');
  const { credentialId, authenticatorData, clientDataJSON, signature } = a.webauthn;
  if (credentialId !== passkey.credentialId) return refuse('unknown-signer');
  const authData = decode(authenticatorData);
  const client = decode(clientDataJSON);
  const der = decode(signature);
  if (authData === null || client === null || der === null || authData.length < AUTH_DATA_MIN) return refuse('malformed');
  const sig = derToP1363(der);
  const key = await importPublicKey(passkey.publicKey);
  if (sig === null || key === null) return refuse('bad-signature');
  const signed = new Uint8Array(authData.length + 32);
  signed.set(authData);
  signed.set(await sha256(client), authData.length);
  if (!(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, signed))) return refuse('bad-signature');

  const data = clientData(client);
  if (data === null || data.type !== 'webauthn.get') return refuse('malformed');
  if (data.challenge !== base64urlEncode(await actionDigest(a))) return refuse('challenge');
  if (data.origin !== origin) return refuse('origin');
  if (!equal(authData.subarray(0, 32), await sha256(utf8(passkey.rpId)))) return refuse('rp-id');
  const flags = authData[32];
  if (!(flags & FLAG_USER_PRESENT)) return refuse('user-presence');
  if (!(flags & FLAG_USER_VERIFIED)) return refuse('user-verification');
  const counter = new DataView(authData.buffer, authData.byteOffset).getUint32(33);
  if ((counter !== 0 || lastCounter !== 0) && counter <= lastCounter) return refuse('counter');
  return { ...accept(), counter };
}
