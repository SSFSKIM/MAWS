// DX7 — identity: the registry's records, machine names, and the enrollment code. Written to outlive phase 1: the
// org phase adds roles and per-member keys to these records rather than replacing them.
import { base64urlDecode, base64urlEncode } from './base64url';
import type { JsonObject } from './json';

/** A member id: 128 random bits as lowercase hex. Not a uuid, which sminos would read as a session (`writer_session`). */
export type MemberId = string;
export const isMemberId = (id: string) => /^[0-9a-f]{32}$/.test(id);

export type Role = 'admin' | 'member';

/** `key_check` is the org key's check (HMAC-SHA256 of the key over `smns-desk-key-check-v1`), set by the first wrapped
 * key and fixed from then: one org holds one key. Null until the first. */
export type OrgRecord = { id: string; name: string; created: string; key_check: string | null };

/**
 * The org key wrapped for one unlock method (§6): the browser draws the key at random once and wraps it under a key it
 * derives per method (a passkey's PRF output, or a passphrase), with AES-256-GCM, a fresh `iv`, and as additional data
 * the UTF-8 of `smns-desk-wrap-v1` LF org id LF `method` LF `credential` (empty for a passphrase). The hub stores it and
 * never sees the key; it reads nothing of `kdf`, `wrapped`, or `check` but their shapes and `check`'s equality.
 */
export type WrappedKeyRecord = {
  /** The hub's: 128 random bits as 32 lowercase hex. */
  id: string;
  method: 'passkey' | 'passphrase';
  /** The owner's name for it, 1 to 100 characters. */
  label: string;
  /** A passkey's WebAuthn credential id, base64url; null for a passphrase. */
  credential: string | null;
  /** How the browser derives the wrapping key: the browser's (DC5's), stored verbatim, at most 1 KiB as JSON. */
  kdf: JsonObject;
  /** 12 bytes, base64url. */
  iv: string;
  /** The 32-byte org key under AES-256-GCM with its tag: 48 bytes, base64url. */
  wrapped: string;
  /** HMAC-SHA256(org key, "smns-desk-key-check-v1"): 32 bytes, base64url. */
  check: string;
  created_by: MemberId;
  created: string;
};

/**
 * `GET /api/org/keys` (a member) answers `WrappedKeys`. `POST /api/org/keys` (an admin holding the key) takes a
 * `WrappedKeyRequest` and answers `201 {key}`; `DELETE /api/org/keys/<id>` (an admin holding the key) takes
 * `{auth}` and answers `{removed: <id>}`. Changing the wrapped keys takes the key, not only an Access session: `auth`
 * is HMAC-SHA256(org key, UTF-8 `smns-desk-key-auth-v1`), 32 bytes, base64url (`keyAuth`). The first wrapped key sets
 * the org's `key_check` and keeps SHA-256 of its `auth` (`key_auth`, never returned); every later change must carry the
 * `auth` whose digest that is, or is refused `not-key-holder` before anything else about the records is told.
 */
export const ORG_KEYS_PATH = '/api/org/keys';
export const KEY_CHECK_DOMAIN = 'smns-desk-key-check-v1';
export const KEY_AUTH_DOMAIN = 'smns-desk-key-auth-v1';
export type WrappedKeys = { key_check: string | null; keys: WrappedKeyRecord[] };
export type WrappedKeyRequest = Pick<WrappedKeyRecord, 'method' | 'label' | 'kdf' | 'iv' | 'wrapped' | 'check'> & { credential?: string | null; auth: string };
export type WrappedKeyRemoval = { auth: string };
export type WrappedKeyAdded = { key: WrappedKeyRecord };
export type WrappedKeyRemoved = { removed: string };
export type WrappedKeyError = 'bad-shape' | 'not-admin' | 'not-key-holder' | 'different-key' | 'credential-taken' | 'unknown-key' | 'last-key';

/** A person, admitted by Access; `email` is the Access identity, `id` is what logs carry (`hub/<id>`, `member`). */
export type MemberRecord = { id: MemberId; email: string; role: Role; created: string };

/**
 * `pending` from the redemption until the machine's first authenticated connection confirms it; `active` after. The
 * name is reserved, and the Access service token named by `token_name` minted, while pending.
 */
export type MachineState = 'pending' | 'active';

export type MachineRecord = {
  name: string;
  /** The Access service token's client id (an assertion's `common_name`); null until the mint returns. */
  client_id: string | null;
  token_name: string;
  state: MachineState;
  /** The enrollment that created it; a token enrolls one machine, ever. */
  enrollment: string;
  created: string;
  confirmed: string | null;
};

/** `open` until redeemed; `pending` while its machine is; `confirmed` for good; `expired` when it lapsed unconfirmed. */
export type EnrollmentState = 'open' | 'pending' | 'confirmed' | 'expired';

export type EnrollmentRecord = {
  id: string;
  created_by: MemberId;
  created: string;
  expires: string;
  state: EnrollmentState;
  machine: string | null;
};

/** A project a `.smns` names (`hub`), or an enrolled machine's own (`machine`): the project of that machine's sessions
 * that no `.smns` claims, whose id is `machineProjectId` of the org and the machine's name. */
export type ProjectKind = 'hub' | 'machine';

export type ProjectRecord = {
  /** The `.smns` id, or a machine project's `machineProjectId`. */
  id: string;
  /** From `.smns`, as the machine that registered the project read it; a machine project's is its machine's name. */
  name: string;
  registered_by: string;
  created: string;
  /** The one machine that writes the log's git archive (§3); null until the owner designates one. */
  archive_machine: string | null;
  kind: ProjectKind;
  /** A machine project whose machine was revoked: off the grid, its log kept, active again when the name is enrolled
   * anew. A hub project is never retired. */
  retired: boolean;
};

/** One member device's Web Push subscription; `endpoint` is its key. */
export type PushSubscriptionRecord = {
  member: MemberId;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  created: string;
};

// Web Push's endpoints (DX7), the signed-in member's own. `GET /api/push/key` answers the hub's VAPID public key, the
// `applicationServerKey` a browser subscribes with; `PUT /api/push/subscriptions` keeps a subscription (what
// `PushSubscription.toJSON()` gives: an https endpoint, `p256dh` the 65-byte uncompressed P-256 point and `auth` 16
// bytes, each canonical base64url); `DELETE` with `{endpoint}` forgets one; `GET` lists the member's.
export const PUSH_KEY_PATH = '/api/push/key';
export const PUSH_SUBSCRIPTIONS_PATH = '/api/push/subscriptions';
/** The uncompressed P-256 point (65 bytes), base64url. */
export type PushKey = { key: string };
export type PushSubscriptionRequest = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushSubscriptionKept = { subscription: PushSubscriptionRecord };
export type PushSubscriptionDeleted = { deleted: boolean };
export type PushSubscriptions = { subscriptions: PushSubscriptionRecord[] };

// Machine names. A machine writes `<name>/<session>` feeds into files named after them on every machine, so a name is a
// file-name-safe word, unique in the org without regard to case (macOS's disk ignores case), and never a prefix the hub
// gives another meaning: `hub/` (web writes) and `legacy/` (pre-.smns chats).
export const RESERVED_MACHINE_NAMES = ['hub', 'legacy'] as const;
const MACHINE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

export const machineNameKey = (name: string) => name.toLowerCase();

export function isMachineName(name: string): boolean {
  return MACHINE_NAME.test(name) && !(RESERVED_MACHINE_NAMES as readonly string[]).includes(machineNameKey(name));
}

/**
 * A machine project's id: the UUID v5, in the URL namespace, of `smns-machine:<org>:<the machine's name lower-cased>`
 * (lower-cased as the hub compares names), so the hub and sminos (`machine_project`) compute it from the org and the
 * name alone, and a machine opens its project before the hub has listed it. Pinned by vectors/machine-project.json,
 * which Python's uuid module writes (generate-machine-project.py).
 */
export function machineProjectId(org: string, machine: string): string {
  const name = new TextEncoder().encode(`smns-machine:${org}:${machineNameKey(machine)}`);
  const input = new Uint8Array(URL_NAMESPACE.length + name.length);
  input.set(URL_NAMESPACE);
  input.set(name, URL_NAMESPACE.length);
  const bytes = sha1(input).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122's variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** RFC 4122's URL namespace, 6ba7b811-9dad-11d1-80b4-00c04fd430c8, as bytes. */
const URL_NAMESPACE = Uint8Array.from('6ba7b8119dad11d180b400c04fd430c8'.match(/../g)!, (h) => parseInt(h, 16));

/** SHA-1 (FIPS 180-4), synchronous: WebCrypto's digest is asynchronous, and the Registry computes a machine project's
 * id inside the synchronous steps that confirm an enrollment and register a project. Used for that id alone. */
function sha1(message: Uint8Array): Uint8Array {
  const blocks = Math.ceil((message.length + 9) / 64);
  const padded = new Uint8Array(blocks * 64);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = message.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bits / 2 ** 32));
  view.setUint32(padded.length - 4, bits >>> 0);
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Uint32Array(80);
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));
  for (let block = 0; block < blocks; block++) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(block * 64 + t * 4);
    for (let t = 16; t < 80; t++) w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    let [a, b, c, d, e] = h;
    for (let t = 0; t < 80; t++) {
      const [f, k] = t < 20 ? [(b & c) | (~b & d), 0x5a827999] : t < 40 ? [b ^ c ^ d, 0x6ed9eba1] : t < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc] : [b ^ c ^ d, 0xca62c1d6];
      const next = (rotl(a, 5) + f + e + k + w[t]) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30) >>> 0;
      b = a;
      a = next;
    }
    for (const [i, v] of [a, b, c, d, e].entries()) h[i] = (h[i] + v) >>> 0;
  }
  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  h.forEach((word, i) => outView.setUint32(i * 4, word));
  return out;
}

/** The Access service token's name, so an orphan of an interrupted enrollment is found by name. */
export const serviceTokenName = (org: string, machine: string) => `desk-${org}-${machine}`;

// The enrollment code: built in the browser (the hub never sees the org key), carried by the owner's hand, and pasted
// on the machine at the hidden prompt of `sminos hub enroll` (never an argument, since it carries the org key). Text
// form: `smns-enroll-v1.` + base64url of the UTF-8 JSON object.

// Enrollment's endpoints (DX7). Every error is `{error, message?}`.

/** `POST /api/enrollments` (an admin): asks for a one-time token, live `ttl_s` seconds (1 to 3600; 900 by default). */
export type EnrollmentRequest = { ttl_s?: number };
export const ENROLLMENT_TTL_S = 900;
export const MAX_ENROLLMENT_TTL_S = 3600;
/** The token, 256 random bits as base64url, is shown this once; the hub keeps only its hash. */
export type EnrollmentIssued = { enrollment: EnrollmentRecord; token: string };

/** The one path Access does not guard (its Bypass policy); the one-time token guards it. Under the Worker's `/machine/*`
 * routes, so the Worker answers it before the web app's assets. */
export const REDEEM_PATH = '/machine/enroll';
/** `POST /machine/enroll`. Redeeming again with the same token and name while pending rotates the credential. */
export type RedeemRequest = { token: string; machine: string };
/** The machine's Access service token; the secret is shown this once. */
export type Redeemed = { org: string; machine: string; client_id: string; client_secret: string };
export type RedeemError =
  | 'bad-shape'
  | 'bad-name' // not an admitted machine name
  | 'unknown-token'
  | 'expired'
  | 'confirmed' // the token's machine already connected: the token is spent
  | 'token-used' // the token is bound to another machine name
  | 'name-taken' // another machine holds the name; nothing is bound, so the same token may be redeemed under another name
  | 'busy' // a redemption of this token is in flight: retry
  | 'mint-failed' // Cloudflare's API failed: retry the same redemption
  | 'key-revoked' // the provisioning key was revoked: it enrolls nothing more
  | 'key-expired' // the provisioning key's time is up
  | 'key-exhausted' // the provisioning key has made all the enrollments its `max_uses` allows
  | 'prefix-mismatch'; // the name does not start with the provisioning key's prefix

// Provisioning keys (the provisioning-keys spec, an extension of DX7): a reusable, revocable credential an admin makes,
// good for many enrollments under one name prefix until it expires, is revoked, or is used up. Its secret is redeemed at
// `REDEEM_PATH` as `token`, as a one-time token is; the hub keeps only its hash, and the browser builds the code
// (`encodeProvisioningCode`) around it with the org key, which the hub never sees.

/** A provisioning key as the hub lists it; its secret is in no answer but its creation's. */
export type ProvisioningKeyRecord = {
  /** The hub's: 128 random bits as 32 lowercase hex. */
  id: string;
  /** The owner's name for it, 1 to 100 characters. */
  label: string;
  /** Every machine enrolled through it is named `<prefix>…`, compared without case; an admitted machine name. */
  prefix: string;
  created_by: MemberId;
  created: string;
  /** It enrolls nothing from then. */
  expires: string;
  /** At most this many enrollments, ever; null for no cap. */
  max_uses: number | null;
  /** Enrollments ever made through it, those since expired or revoked included. */
  uses: number;
  /** A machine enrolled through it is revoked once offline this long; null for never. */
  offline_revoke_s: number | null;
  /** When it was revoked; null while it enrolls. */
  revoked: string | null;
  /** The machines enrolled through it now, pending or active. */
  machines: Array<{ name: string; state: MachineState }>;
};
/** `POST /api/provisioning-keys` (an admin). */
export type ProvisioningKeyRequest = { label: string; prefix: string; ttl_s?: number; max_uses?: number | null; offline_revoke_s?: number | null };
/** `token`: the key's secret, 256 random bits as base64url, shown this once. */
export type ProvisioningKeyIssued = { key: ProvisioningKeyRecord; token: string };
/** `GET /api/provisioning-keys` (a member): every key, revoked ones included, by creation. */
export type ProvisioningKeys = { keys: ProvisioningKeyRecord[] };
/** `DELETE /api/provisioning-keys/<id>` (an admin): new enrollments stop; the machines it enrolled stay. */
export type ProvisioningKeyRevoked = { revoked: string };
export type ProvisioningKeyError = 'bad-shape' | 'not-admin' | 'unknown-key';
export const PROVISIONING_KEYS_PATH = '/api/provisioning-keys';
export const PROVISIONING_KEY_TTL_S = 7_776_000; // 90 days
export const MIN_PROVISIONING_KEY_TTL_S = 3600;
export const MAX_PROVISIONING_KEY_TTL_S = 31_536_000; // a year
export const MAX_PROVISIONING_KEY_USES = 10_000;
export const MIN_OFFLINE_REVOKE_S = 3600;
export const MAX_OFFLINE_REVOKE_S = 2_592_000; // 30 days

/** `GET /machine/enrollment`: the machine's own record; `DELETE`: its own revocation. A machine's, with its own
 * service token; a member is answered `404 not-found`. */
export const MACHINE_ENROLLMENT_PATH = '/machine/enrollment';
export type MachineSelf = { org: string; machine: string; state: MachineState; confirmed: string | null };
export type Left = { revoked: string };

/** `PUT /api/projects/<id>/archive` (an admin): the machine that writes the project's git archive, or null. */
export type ArchiveRequest = { machine: string | null };

export type HubError = { error: string; message?: string };

export type EnrollmentCode = {
  /** The hub's origin, https (http only on a loopback host, for the local runtime). */
  hub: string;
  org: string;
  /** The one-time token the machine redeems at the hub. */
  token: string;
  machine: string;
  /** The org key, base64url (256 bits). */
  key: string;
};

const CODE_PREFIX = 'smns-enroll-v1.';
const PROVISION_PREFIX = 'smns-provision-v1.';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The checks both kinds of code share, worded by the kind (`enrollment code`, `provisioning code`): every field a
 * non-empty string, the hub https (http on a loopback host), the name field (`machine` or `prefix`) an admitted machine
 * name, and the key 256 bits of canonical base64url. */
function checkFields<F extends string>(kind: string, code: Record<F, unknown>, fields: readonly F[], name: F, nameIs: string): Record<F, string> {
  for (const field of fields) if (typeof code[field] !== 'string' || code[field] === '') throw new TypeError(`${kind}: no ${field}`);
  const checked = Object.fromEntries(fields.map((field) => [field, code[field] as string])) as Record<F, string>;
  const { hub, key } = checked as Record<string, string>;
  let url: URL;
  try {
    url = new URL(hub);
  } catch {
    throw new TypeError(`${kind}: the hub is not a URL`);
  }
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname)))) throw new TypeError(`${kind}: the hub is not https`);
  if (!isMachineName(checked[name])) throw new TypeError(`${kind}: ${nameIs} is not admitted`);
  let bytes: Uint8Array;
  try {
    bytes = base64urlDecode(key);
  } catch {
    throw new TypeError(`${kind}: the key is not base64url`);
  }
  if (bytes.length !== 32) throw new TypeError(`${kind}: the key is not 256 bits`);
  return checked;
}

const ENROLLMENT_FIELDS = ['hub', 'org', 'token', 'machine', 'key'] as const;
const checkCode = (code: EnrollmentCode): EnrollmentCode => checkFields('enrollment code', code, ENROLLMENT_FIELDS, 'machine', 'the machine name');

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

export function encodeEnrollmentCode(code: EnrollmentCode): string {
  return CODE_PREFIX + base64urlEncode(new TextEncoder().encode(JSON.stringify(checkCode(code))));
}

export function decodeEnrollmentCode(text: string): EnrollmentCode {
  if (!text.startsWith(CODE_PREFIX)) throw new TypeError('enrollment code: not smns-enroll-v1');
  return checkCode(body('enrollment code', text, CODE_PREFIX) as EnrollmentCode);
}

/**
 * A provisioning key's code (§1 of the provisioning-keys spec): built in the browser around the key's secret and the
 * org key, kept in a secret store, and piped into `sminos hub enroll --name <prefix>…` by every machine it enrolls. A
 * prefix of its own, so a sminos that knows only one-time codes refuses it at its decoder, before anything is sent.
 */
export type ProvisioningCode = {
  /** The hub's origin, https (http only on a loopback host, for the local runtime). */
  hub: string;
  org: string;
  /** The provisioning key's secret, which the machine redeems at the hub as `token`. */
  token: string;
  /** Every machine enrolled through the key is named `<prefix>…`, compared without case. An admitted machine name. */
  prefix: string;
  /** The org key, base64url (256 bits). */
  key: string;
};

const PROVISIONING_FIELDS = ['hub', 'org', 'token', 'prefix', 'key'] as const;
const checkProvisioningCode = (code: ProvisioningCode): ProvisioningCode => checkFields('provisioning code', code, PROVISIONING_FIELDS, 'prefix', 'the prefix');

export function encodeProvisioningCode(code: ProvisioningCode): string {
  return PROVISION_PREFIX + base64urlEncode(new TextEncoder().encode(JSON.stringify(checkProvisioningCode(code))));
}

export function decodeProvisioningCode(text: string): ProvisioningCode {
  if (!text.startsWith(PROVISION_PREFIX)) throw new TypeError('provisioning code: not smns-provision-v1');
  return checkProvisioningCode(body('provisioning code', text, PROVISION_PREFIX) as ProvisioningCode);
}

/** Either kind of code, tagged; what `sminos hub enroll` reads (its `decode_code` ports this, pinned by vectors). */
export type DecodedCode = ({ kind: 'enroll' } & EnrollmentCode) | ({ kind: 'provision' } & ProvisioningCode);

/** Reads either prefix; a refusal is worded by the kind its prefix named, and an unknown prefix as neither kind. */
export function decodeCode(text: string): DecodedCode {
  if (text.startsWith(CODE_PREFIX)) return { kind: 'enroll', ...decodeEnrollmentCode(text) };
  if (text.startsWith(PROVISION_PREFIX)) return { kind: 'provision', ...decodeProvisioningCode(text) };
  throw new TypeError('enrollment code: not smns-enroll-v1 or smns-provision-v1');
}
