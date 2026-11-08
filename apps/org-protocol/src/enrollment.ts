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

/**
 * The v2 enrollment code (RL §5.3): built by the enrolling member's app, carried by hand, read at the machine's hidden
 * prompt. It carries the org's trust anchors instead of a secret org key: `roots`, the root key ids the machine pins
 * (the org state's `root.keys`), and `recoveryPub`, the offline recovery key. `k`, the one-time pairing secret (16 to 64
 * bytes, base64url), is added by the app and never reaches the hub: the machine MACs its enrollment with it
 * (`enrollmentMac`) and the member's device checks the MAC. `machine` names the machine when the app chose it, as a
 * re-enrollment's code does (an active machine re-enrolls in place only under a token that names it, the hub's
 * `EnrollmentRequest.machine`). Text form: `smns-enroll-v2.` + base64url of the UTF-8 JSON object. Moved from the
 * hub's identity file (P5 O8 M4b), which re-exports it.
 */
export type EnrollmentCodeV2 = { hub: string; token: string; roots: string[]; recoveryPub: string; k: string; machine?: string };

const CODE_V2_PREFIX = 'smns-enroll-v2.';
const CODE_V2_FIELDS = ['hub', 'token', 'roots', 'recoveryPub', 'k', 'machine'];
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

// `checkHub` and `body` are private copies of the hub identity file's helpers, which its v1 codecs still use, and they stay
// private on purpose: the package's public hub check is `isHubOrigin` (pairing.ts), and exporting these would set a second
// one beside it, with other rules.

/** The hub is a URL, https (http only on a loopback host, for the local runtime). */
function checkHub(kind: string, hub: string): void {
  let url: URL;
  try {
    url = new URL(hub);
  } catch {
    throw new TypeError(`${kind}: the hub is not a URL`);
  }
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname)))) throw new TypeError(`${kind}: the hub is not https`);
}

/** The JSON object after a code's prefix, or a refusal worded by the kind. */
function body(kind: string, text: string, prefix: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(base64urlDecode(text.slice(prefix.length))));
  } catch {
    throw new TypeError(`${kind}: damaged`);
  }
  if (typeof parsed !== 'object' || parsed === null) throw new TypeError(`${kind}: damaged`);
  return parsed as Record<string, unknown>;
}

function checkCodeV2(code: Record<string, unknown>): EnrollmentCodeV2 {
  const kind = 'enrollment code';
  for (const field of Object.keys(code)) if (!CODE_V2_FIELDS.includes(field)) throw new TypeError(`${kind}: unknown field ${field}`);
  const { hub, token, roots, recoveryPub, k, machine } = code;
  for (const [field, value] of [['hub', hub], ['token', token]] as const) if (typeof value !== 'string' || value === '') throw new TypeError(`${kind}: no ${field}`);
  checkHub(kind, hub as string);
  if (!Array.isArray(roots) || roots.length === 0 || !roots.every((r) => isBase64urlOf(r, 16))) throw new TypeError(`${kind}: the roots are not key ids`);
  if (!isPublicKey(recoveryPub)) throw new TypeError(`${kind}: the recovery key is not a public key`);
  if (typeof k !== 'string' || !isBase64urlOf(k, (k.length * 6) >> 3) || base64urlDecode(k).length < 16 || base64urlDecode(k).length > 64) {
    throw new TypeError(`${kind}: the pairing secret is not 128 to 512 bits`);
  }
  if (machine !== undefined && (typeof machine !== 'string' || !isMachineName(machine))) throw new TypeError(`${kind}: the machine name is not admitted`);
  return { hub: hub as string, token: token as string, roots: [...(roots as string[])], recoveryPub, k, ...(machine === undefined ? {} : { machine }) };
}

export function encodeEnrollmentCodeV2(code: EnrollmentCodeV2): string {
  return CODE_V2_PREFIX + base64urlEncode(new TextEncoder().encode(JSON.stringify(checkCodeV2(code))));
}

export function decodeEnrollmentCodeV2(text: string): EnrollmentCodeV2 {
  if (!text.startsWith(CODE_V2_PREFIX)) throw new TypeError('enrollment code: not smns-enroll-v2');
  return checkCodeV2(body('enrollment code', text, CODE_V2_PREFIX));
}
