// DX7 — identity: the registry's records, machine names, and the enrollment code. Written to outlive phase 1: the
// org phase adds roles and per-member keys to these records rather than replacing them.
import { base64urlDecode, base64urlEncode } from './base64url';

/** A member id: 128 random bits as lowercase hex. Not a uuid, which sminos would read as a session (`writer_session`). */
export type MemberId = string;
export const isMemberId = (id: string) => /^[0-9a-f]{32}$/.test(id);

export type Role = 'admin' | 'member';

export type OrgRecord = { id: string; name: string; created: string };

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

export type ProjectRecord = {
  /** The `.smns` id. */
  id: string;
  /** From `.smns`, as the machine that registered the project read it. */
  name: string;
  registered_by: string;
  created: string;
  /** The one machine that writes the log's git archive (§3); null until the owner designates one. */
  archive_machine: string | null;
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
  | 'mint-failed'; // Cloudflare's API failed: retry the same redemption

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
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function checkCode(code: EnrollmentCode): EnrollmentCode {
  const fields = ['hub', 'org', 'token', 'machine', 'key'] as const;
  for (const field of fields) if (typeof code[field] !== 'string' || code[field] === '') throw new TypeError(`enrollment code: no ${field}`);
  let url: URL;
  try {
    url = new URL(code.hub);
  } catch {
    throw new TypeError('enrollment code: the hub is not a URL');
  }
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname)))) throw new TypeError('enrollment code: the hub is not https');
  if (!isMachineName(code.machine)) throw new TypeError('enrollment code: the machine name is not admitted');
  let key: Uint8Array;
  try {
    key = base64urlDecode(code.key);
  } catch {
    throw new TypeError('enrollment code: the key is not base64url');
  }
  if (key.length !== 32) throw new TypeError('enrollment code: the key is not 256 bits');
  return { hub: code.hub, org: code.org, token: code.token, machine: code.machine, key: code.key };
}

export function encodeEnrollmentCode(code: EnrollmentCode): string {
  return CODE_PREFIX + base64urlEncode(new TextEncoder().encode(JSON.stringify(checkCode(code))));
}

export function decodeEnrollmentCode(text: string): EnrollmentCode {
  if (!text.startsWith(CODE_PREFIX)) throw new TypeError('enrollment code: not smns-enroll-v1');
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(base64urlDecode(text.slice(CODE_PREFIX.length))));
  } catch {
    throw new TypeError('enrollment code: damaged');
  }
  if (typeof parsed !== 'object' || parsed === null) throw new TypeError('enrollment code: damaged');
  return checkCode(parsed as EnrollmentCode);
}
