// DX7 — identity: the registry's records, machine names, and the enrollment code. Written to outlive phase 1: the
// org phase adds roles and per-member keys to these records rather than replacing them.
import { isMachineName, isMemberId, machineNameKey, RESERVED_MACHINE_NAMES, type MemberId } from 'org-protocol';
import { isPublicKey } from 'org-protocol';
import type { Certificates, Delegation, DeviceClass, EndpointRecord, KeyStorage, Listing, Passkey, RootTransition, Signed, SignedOrgState } from 'org-protocol';
import { base64urlDecode, base64urlEncode, isBase64urlOf } from './base64url';
import type { JsonObject } from './json';

// Member ids and machine names live in the protocol package (apps/org-protocol), whose org state names both; they are
// re-exported here under their names.
export { isMachineName, isMemberId, machineNameKey, RESERVED_MACHINE_NAMES, type MemberId };

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
/**
 * `POST /api/org/keys/purge` (an admin; O14 M5a): once the org state's head carries `legacyRetired`, every wrapped copy
 * and the org's key check and auth are deleted, answering `{purged}` (the head's version it acted under, and when), the
 * same record again after; `409 not-retired` before. From then `GET /api/org/keys` and `DELETE /api/org/keys/<id>` answer
 * `410 retired`, `POST /api/org/keys` `409 retired`, and a successor that drops `legacyRetired` is refused `409 key-purged`.
 */
export const ORG_KEYS_PURGE_PATH = '/api/org/keys/purge';
export type OrgKeysPurged = { purged: { version: number; at: string } };
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
  /** The member's device (an org-state device id) it is bound to; while bound, pushed only while the head lists it. */
  device?: string;
};

// Web Push's endpoints (DX7), the signed-in member's own. `GET /api/push/key` answers the hub's VAPID public key, the
// `applicationServerKey` a browser subscribes with; `PUT /api/push/subscriptions` keeps a subscription (what
// `PushSubscription.toJSON()` gives: an https endpoint, `p256dh` the 65-byte uncompressed P-256 point and `auth` 16
// bytes, each canonical base64url); `DELETE` with `{endpoint}` forgets one; `GET` lists the member's. A subscription may
// name `device`, one of the member's devices in the org state (O11 M4; `409 unknown-device` otherwise): it is then pushed
// only while the head lists that device for the member.
export const PUSH_KEY_PATH = '/api/push/key';
export const PUSH_SUBSCRIPTIONS_PATH = '/api/push/subscriptions';
/** The uncompressed P-256 point (65 bytes), base64url. */
export type PushKey = { key: string };
export type PushSubscriptionRequest = { endpoint: string; keys: { p256dh: string; auth: string }; device?: string };
export type PushSubscriptionKept = { subscription: PushSubscriptionRecord };
export type PushSubscriptionDeleted = { deleted: boolean };
export type PushSubscriptions = { subscriptions: PushSubscriptionRecord[] };

// The signed org state (RL5; O11 M3). The Registry keeps its chain and serves it to members and machines alike, each on
// a route of its own: `GET` answers the head (null before a genesis), the root transitions held and the delegation
// certificates (M4), and with `?since=<version>` the chain after that version, oldest first, in pages of about 1 MiB
// (`more` says another page follows from the last version sent). `POST` takes a genesis (from the configured admin
// only, keeping the bootstrap member's id) or a successor on the head; a refusal is `409 <the package's verdict code>`,
// or `409 genesis-member`, and keeps nothing. A writer refused `not-head` signs again on the new head.
export const ORG_STATE_PATH = '/api/org/state';
export const MACHINE_ORG_STATE_PATH = '/machine/org/state';
/** `POST` a recovery-signed root transition against the head (`409 <verdict code>` on refusal). */
export const ORG_TRANSITIONS_PATH = '/api/org/transitions';
export type OrgStateView = {
  head: SignedOrgState | null;
  transitions: Signed<RootTransition>[];
  certificates: Certificates;
  chain?: SignedOrgState[];
  more?: boolean;
};
export type OrgStateAccepted = { version: number };
export type TransitionAccepted = { fromVersion: number };

// The device pairing exchange (RL §5.3): a new device, signed in as its member, posts its public keys with a MAC under
// the pairing code its approving device shows; the member's devices list the entries, and the approving one checks the
// MAC (the hub never does) before endorsing the device into a successor, whose acceptance drops the entry. Entries are
// the poster's member's, at most MAX_PENDING_DEVICES, and expire PENDING_DEVICE_TTL_S after they are posted; posting a
// device id again replaces its entry.
export const PENDING_DEVICES_PATH = '/api/devices/pending';
export const PENDING_DEVICE_TTL_S = 600;
export const MAX_PENDING_DEVICES = 8;
/** `mac`: HMAC-SHA-256, 32 bytes base64url. */
export type PendingDeviceRequest = {
  deviceId: string;
  class: DeviceClass;
  keyStorage: KeyStorage;
  channelPub: string;
  stepUpPub?: string;
  passkey?: Passkey;
  mac: string;
};
export type PendingDevice = PendingDeviceRequest & { member: MemberId; created: string; expires: string };
export type PendingDevices = { pending: PendingDevice[] };

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
export type EnrollmentRequest = {
  ttl_s?: number;
  /** An active machine's name: the token re-enrolls it in place (its credential replaced; O11 M4), under that name only. */
  machine?: string;
};
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
export type Redeemed = {
  org: string;
  machine: string;
  client_id: string;
  client_secret: string;
  /** The enrollment's id: a v2 machine's `tokenId` in its MAC (`MACHINE_KEY_PATH`). Every hub of O11 M4 on sends it. */
  enrollment?: string;
  /** Through a provisioning key, which of its uses this is: the `use` the machine's certificate carries. */
  use?: number;
};
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
  | 'prefix-mismatch' // the name does not start with the provisioning key's prefix
  | 'not-active'; // a re-enrollment's machine is no longer an active one

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
  /** Once re-issued as a delegation (`delegationFor`): the head's delegation of this id, its key and owners. */
  delegation?: { pub: string; owners: Delegation['owners'] };
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
  checkHub(kind, hub);
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

// ---- Hub v2 (O11 M4): machine enrollment with its own key, delegations, listings, endpoint records, owner-only push --

/**
 * The v2 enrollment code (RL §5.3): built by the enrolling member's app, carried by hand, read at the machine's hidden
 * prompt. It carries the org's trust anchors instead of a secret org key: `roots`, the root key ids the machine pins
 * (the org state's `root.keys`), and `recoveryPub`, the offline recovery key. `k`, the one-time pairing secret (16 to 64
 * bytes, base64url), is added by the app and never reaches the hub: the machine MACs its enrollment with it
 * (org-protocol's `enrollmentMac`) and the member's device checks the MAC. `machine` names the machine when the app
 * chose it, as a re-enrollment's code does (an active machine re-enrolls in place only under a token that names it,
 * `EnrollmentRequest.machine`). Text form: `smns-enroll-v2.` + base64url of the UTF-8 JSON object.
 */
export type EnrollmentCodeV2 = { hub: string; token: string; roots: string[]; recoveryPub: string; k: string; machine?: string };

const CODE_V2_PREFIX = 'smns-enroll-v2.';
const CODE_V2_FIELDS = ['hub', 'token', 'roots', 'recoveryPub', 'k', 'machine'];

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

/**
 * `POST /machine/key` (the machine, once redeemed): its public key, its ref (RL §2.3, minted at its first run) and the
 * MAC over `{name, machinePub: pub, ref, tokenId}` under the code's `k`, where `name` is the machine's enrolled name and
 * `tokenId` its enrollment's id (`Redeemed.enrollment`). One key per enrollment: posting the same again answers as
 * before, another is refused `409 key-posted`. `GET /api/enrollments/<id>/key` (the member who made the enrollment)
 * answers it, `404 no-key` until it is posted; the hub never checks the MAC, the member's device does, before it signs
 * the machine into the org state. The hub shows the machine `listed` once the head lists that ref with that key
 * (`MachineView.key`), apart from its hub confirmation (`state`), as RL §5.3 keeps them.
 */
export const MACHINE_KEY_PATH = '/machine/key';
export const ENROLLMENT_KEY_PATH = /^\/api\/enrollments\/([0-9a-f]{32})\/key$/;
export type MachineKeyRequest = { pub: string; ref: string; mac: string };
export type EnrollmentKey = { enrollment: string; machine: string; pub: string; ref: string; mac: string; posted: string };
/** `GET /api/machines` answers each machine with its v2 key once it posted one, and whether the head lists it. */
/**
 * A machine as `GET /api/machines` lists it: its record, its DX2 presence as the directory's `org` frame carries it
 * (`online`, `seen`: optional, a hub before O14 M5a sends neither; an RL1 machine's presence reaches the relay alone, P5
 * DL 37), and a v2 machine's posted key with whether the head lists it.
 */
export type MachineView = MachineRecord & { online?: boolean; seen?: string | null; key?: { ref: string; pub: string; listed: boolean } };

/**
 * A provisioning key re-issued as an RL5 delegation: the admin's app adds `delegationFor(key, pub, owners)` to a
 * successor, its key pair the delegation's, and the hub then lists the key with the delegation's `pub` and `owners` from
 * the head (`ProvisioningKeyRecord.delegation`). A key's "no cap" (`max_uses` null) is `NO_USE_CAP`, and "never"
 * (`offline_revoke_s` null) is `NEVER_OFFLINE`, 0, which no real offline time can be (MIN_OFFLINE_REVOKE_S).
 */
export const NO_USE_CAP = Number.MAX_SAFE_INTEGER;
export const NEVER_OFFLINE = 0;
export function delegationFor(
  key: Pick<ProvisioningKeyRecord, 'id' | 'prefix' | 'expires' | 'max_uses' | 'offline_revoke_s'>,
  pub: string,
  owners: Delegation['owners'],
): Delegation {
  return { id: key.id, pub, prefix: key.prefix, expires: key.expires, maxUses: key.max_uses ?? NO_USE_CAP, offlineRevokeS: key.offline_revoke_s ?? NEVER_OFFLINE, owners };
}

/**
 * `POST /machine/cert` (a machine enrolled through a provisioning key): its delegation-signed `MachineCert`. The hub
 * stores one only on a clean `verifyMachineCert` against the head, for the posting machine's own name and its key's
 * delegation, at the use its redemption was counted as (`Redeemed.use`), and never one that would contest another
 * live certificate's ref or name: that refusal is `409 contested`, naming the conflicts and the remedies (a fresh name,
 * or the old certificate retired by its delegation's key or revoked in the org state). A certificate the hub holds is
 * answered as before; another for the same key is refused `409 conflict`. Certificates are served beside the state.
 */
export const MACHINE_CERT_PATH = '/machine/cert';
/**
 * A certificate's retirement by its own delegation's key (`CertRetirement`, RL DL 24), from a member (`devcloud vm
 * delete` on the owner's Mac) or a machine; stored on a clean `verifyCertRetirement` and served beside the certificates.
 */
export const CERT_RETIREMENTS_PATH = '/api/org/cert-retirements';
export const MACHINE_CERT_RETIREMENTS_PATH = '/machine/cert-retirements';
/** A contested refusal's conflicts: each live certificate (or the state's entry) the posted one would contest. */
export type CertConflict = { ref: string; name: string; keyId: string | null; holder: 'certificate' | 'state' };

/**
 * Listings (RL6's projection) and endpoint records (RL §4.1's direct carriers), machine-signed and stored per machine
 * ref: a listing per `(machine, session)` at its highest `revision` (`409 stale-listing` for one not above it), an
 * endpoint record at its newest `issued` (`409 stale-endpoint` for an older one); a byte-identical resend is taken as
 * before. A record whose machine has no key in the head or a live certificate is refused `403 not-listed`, one signed
 * by another key `403 unknown-signer` (or `revoked`), one whose signature fails `403 bad-signature`, a contested ref's
 * `409 contested`. RL1 carries them up (M6: `Registry.storeListing`, `Registry.storeEndpoint`). A withdrawn listing
 * (`LISTING_GONE`, RL6) is stored like any other, so its revision still refuses an earlier one. `GET
 * /api/listings[?project=<id>]` (a member) answers the stored listings but the withdrawn, a project's alone when named,
 * with their machines' endpoint records; `GET /api/machines/<ref or name>/endpoint` one machine's record (`404 no-endpoint`).
 */
export const LISTINGS_PATH = '/api/listings';
export const MACHINE_ENDPOINT_PATH = /^\/api\/machines\/([^/]+)\/endpoint$/;
export type Listings = { listings: Signed<Listing>[]; endpoints: Signed<EndpointRecord>[] };
export type MachineEndpoint = { record: Signed<EndpointRecord> };

/**
 * A v2 push (RL §7.4): sent only to the devices of the session's listed owners, and carrying only what says a session is
 * waiting or wrote. `machine` is the machine's ref. Kept apart from DX7's `PushNotice`, whose kinds desk-web's service
 * worker draws by name, so a hub on this version changes nothing a phone reads; a worker that cannot read it draws its
 * plain prompt to open the desk.
 */
export type OwnerNotice = { project: string; machine: string; session: string; kind: 'waiting' | 'wrote' };
