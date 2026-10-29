// A device's pairing (RL §5.3; O13 §A): the approving device shows a one-time code carrying the org's root pins and a
// pairing secret `k`, which travels by hand (a paste, never through the hub); the new device posts its keys to the
// hub's pending list with a MAC under `k`; the approving device checks the MAC before it signs the device into a
// successor. The hub never checks the MAC, so it cannot pass a key, class, storage kind or passkey of its own choosing.
//
//     HMAC-SHA-256(k, pairingMacInput({org, member, device}))
//
// The input is the domain, the org, the member and the device entry's canonical form (RFC 8785), each as UTF-8 preceded
// by its byte length as a 4-byte big-endian integer, as the enrollment MAC's is (enrollment.ts), under a domain of its
// own so a device's MAC never verifies as a machine's.
//
// `k` reaches the device by the Mac's clipboard, which every process under the uid and the clipboard history can read
// (RL DL28), so `k` alone admits nothing: both screens show the entry's fingerprint, a hash of the same input without
// `k`, and the owner compares them before approving. It covers the whole entry, so an entry that kept the phone's
// channel key and swapped its passkey or step-up key, its MAC recomputed under a leaked `k`, shows another fingerprint.
import { base64urlDecode, base64urlEncode, isBase64urlOf } from './base64url.ts';
import { canonicalize } from './canonical.ts';
import { isPublicKey, utf8, type B64 } from './keys.ts';
import { isMemberId, type MemberId } from './names.ts';
import { isDevice } from './shapes.ts';
import type { Device, DeviceClass, KeyStorage, Passkey } from './types.ts';

export const PAIRING_CODE_PREFIX = 'smns-pair-v1.';
export const PAIRING_MAC_DOMAIN = 'smns-pair-mac-v1';
/** The pairing secret's length: 128 bits. */
export const PAIRING_SECRET_BYTES = 16;

/** What a pairing code carries: where and whose the device will be, the org's root pins (RL §5.2), and `k`. */
export type PairingCode = { hub: string; org: string; member: MemberId; roots: B64[]; recoveryPub: B64; k: B64 };
/** What the MAC binds: the org, the member, and the device entry as the successor will list it, before its endorsement. */
export type PairingFields = { org: string; member: MemberId; device: Omit<Device, 'endorsement'> };
/**
 * A pending device entry as the approving side judges it: the device's fields, flat, and its MAC. The hub's pending list
 * (its `PendingDevice`, which adds the member and the entry's times) is one; nothing here trusts the hub's grammar.
 */
export type PendingEntry = { deviceId: string; class: DeviceClass; keyStorage: KeyStorage; channelPub: string; stepUpPub?: string; passkey?: Passkey; mac: string };

const CODE_FIELDS = ['hub', 'org', 'member', 'roots', 'recoveryPub', 'k'];
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];

/** An origin, as a code names its hub: https, or http on a loopback host (the suites' local hub), and nothing after it. */
export function isHubOrigin(hub: unknown): boolean {
  if (typeof hub !== 'string') return false;
  let url: URL;
  try {
    url = new URL(hub);
  } catch {
    return false;
  }
  return url.origin === hub && (url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.includes(url.hostname)));
}

/** Exactly the code's fields, each in its grammar. */
function isPairingCode(value: unknown): value is PairingCode {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Object.keys(value);
  if (keys.length !== CODE_FIELDS.length || !CODE_FIELDS.every((field) => keys.includes(field))) return false;
  const { hub, org, member, roots, recoveryPub, k } = value as Record<string, unknown>;
  return (
    isHubOrigin(hub) &&
    typeof org === 'string' &&
    org !== '' &&
    typeof member === 'string' &&
    isMemberId(member) &&
    Array.isArray(roots) &&
    roots.length > 0 &&
    roots.every((root) => isBase64urlOf(root, 16)) &&
    new Set(roots).size === roots.length &&
    isPublicKey(recoveryPub) &&
    isBase64urlOf(k, PAIRING_SECRET_BYTES)
  );
}

/** The code as text: the prefix, then base64url of its canonical JSON. Throws a TypeError for a field out of grammar. */
export function encodePairingCode(code: PairingCode): string {
  if (!isPairingCode(code)) throw new TypeError('a pairing code names an https hub, an org, a member id, its root key ids, the recovery key and a 128-bit secret');
  return PAIRING_CODE_PREFIX + base64urlEncode(utf8(canonicalize(code)));
}

/** The code `text` spells, or null for anything else: another prefix, a field out of grammar, or another spelling. */
export function decodePairingCode(text: string): PairingCode | null {
  if (typeof text !== 'string' || !text.startsWith(PAIRING_CODE_PREFIX)) return null;
  try {
    const bytes = base64urlDecode(text.slice(PAIRING_CODE_PREFIX.length));
    // Well-formed UTF-8 only: a decoder replaces a bad sequence, so the text must encode back to the very bytes. (No
    // `fatal` option: the Workers' types declare the decoder's options otherwise than the DOM's.)
    const json = new TextDecoder().decode(bytes);
    if (base64urlEncode(utf8(json)) !== base64urlEncode(bytes)) return null;
    const code: unknown = JSON.parse(json);
    // One spelling per code: a writer's whitespace or key order is not the code.
    return isPairingCode(code) && canonicalize(code) === json ? code : null;
  } catch {
    return null;
  }
}

/** The length-prefixed bytes the MAC and the fingerprint cover. Throws a TypeError for a field out of grammar. */
export function pairingMacInput(fields: PairingFields): Uint8Array<ArrayBuffer> {
  const { org, member, device } = fields;
  if (typeof org !== 'string' || org === '' || typeof member !== 'string' || !isMemberId(member) || !isDevice(device) || 'endorsement' in device) {
    throw new TypeError('a pairing names an org, a member id and a device entry as the org state lists one, before its endorsement');
  }
  const parts = [PAIRING_MAC_DOMAIN, org, member, canonicalize(device)].map(utf8);
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
  if (k.length < PAIRING_SECRET_BYTES) throw new TypeError('the pairing secret is at least 128 bits');
  return crypto.subtle.importKey('raw', Uint8Array.from(k), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** The device's MAC over its entry, base64url (32 bytes). */
export async function pairingMac(k: Uint8Array, fields: PairingFields): Promise<B64> {
  return base64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(k), pairingMacInput(fields))));
}

/** True when `mac` is the canonical base64url of the MAC over `fields` under `k`; false for any field out of grammar. */
export async function verifyPairingMac(k: Uint8Array, fields: PairingFields, mac: unknown): Promise<boolean> {
  if (!isBase64urlOf(mac, 32)) return false;
  let input: Uint8Array<ArrayBuffer>;
  try {
    input = pairingMacInput(fields);
  } catch {
    return false;
  }
  return crypto.subtle.verify('HMAC', await hmacKey(k), base64urlDecode(mac as string), input);
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/**
 * What the owner compares on the Mac and the phone before approving: the first 10 characters of the base32 (RFC 4648,
 * lower case) of SHA-256 over `pairingMacInput` for the entry, its endorsement left out, as `xxxxx-xxxxx`. Throws a
 * TypeError for an entry out of grammar.
 */
export async function pairingFingerprint(org: string, member: MemberId, entry: Device): Promise<string> {
  const device: Record<string, unknown> = { ...entry };
  delete device.endorsement;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', pairingMacInput({ org, member, device: device as Omit<Device, 'endorsement'> })));
  let text = '';
  let bits = 0;
  let value = 0;
  for (let i = 0; text.length < 10; i++) {
    value = ((value << 8) | digest[i]) & 0xffff;
    bits += 8;
    while (bits >= 5 && text.length < 10) {
      bits -= 5;
      text += BASE32[(value >> bits) & 31];
    }
  }
  return `${text.slice(0, 5)}-${text.slice(5)}`;
}

/** A device entry as the pending list carries it, rebuilt as the state would list it (no endorsement yet). */
export function entryDevice(entry: PendingEntry): Omit<Device, 'endorsement'> {
  const device: Record<string, unknown> = { id: entry.deviceId, class: entry.class, keyStorage: entry.keyStorage, channelPub: entry.channelPub };
  if (entry.stepUpPub !== undefined) device.stepUpPub = entry.stepUpPub;
  if (entry.passkey !== undefined) device.passkey = entry.passkey;
  return device as Omit<Device, 'endorsement'>;
}

/**
 * Whether a pending entry answers this pairing: the device a state could list, of the class asked for, its MAC under
 * `k` over the org, the member and the whole entry, and not a device the head already lists. Otherwise why not.
 */
export async function judgeEntry(
  entry: PendingEntry,
  pairing: { org: string; member: string; k: Uint8Array; class: Device['class']; listed: Set<string> },
): Promise<{ ok: true; device: Omit<Device, 'endorsement'> } | { ok: false; why: string }> {
  const device = entryDevice(entry);
  if (device.class === 'web-cards' && device.stepUpPub !== undefined) return { ok: false, why: 'a web-cards entry with a step-up key, which the class never holds (RL 5.10)' };
  if (!isDevice(device)) return { ok: false, why: 'not a device entry the org state could list' };
  if (!isPairedDeviceId(device.id)) return { ok: false, why: 'its id is outside the device id grammar (base64url)' };
  if (device.passkey !== undefined && !isRpId(device.passkey.rpId)) return { ok: false, why: "its passkey's rpId is not a host name" };
  if (device.class !== pairing.class) return { ok: false, why: `of class ${device.class}, not ${pairing.class}` };
  if (device.class === 'web-cards' && device.passkey === undefined) return { ok: false, why: 'a web-cards entry with no passkey' };
  if (!(await verifyPairingMac(pairing.k, { org: pairing.org, member: pairing.member, device }, entry.mac))) return { ok: false, why: "its MAC is not under this code's secret" };
  if (pairing.listed.has(device.id)) return { ok: false, why: 'its id is a device the head already lists' };
  return { ok: true, device };
}

/** A device id as a pairing takes it: base64url's alphabet, as the phone's 16 random bytes and this command's ids are. */
export const isPairedDeviceId = (id: string) => /^[A-Za-z0-9_-]{1,128}$/.test(id);
/** A relying party id as a pairing takes it: a lower-case host name (dot-separated labels) or a dotted IPv4 address. */
export const isRpId = (rpId: string) => rpId.length <= 253 && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(rpId);
