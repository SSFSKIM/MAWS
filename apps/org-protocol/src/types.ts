// RL5's and RL8's shapes, as Interfaces §A of docs/doperpowers/plans/2026-10-27-p5-o11-hub-v2.md writes them. Each is
// signed under its own domain (SIGNING_DOMAINS), so a signature for one never verifies as another.
import type { B64, Sig } from './keys.ts';
import type { MemberId } from './names.ts';

export const SIGNING_DOMAINS = {
  orgState: 'smns-org-state-v1',
  transition: 'smns-org-transition-v1',
  grant: 'smns-org-grant-v1',
  machineCert: 'smns-machine-cert-v1',
  deviceEndorse: 'smns-device-endorse-v1',
  listing: 'smns-listing-v1',
  certRetire: 'smns-cert-retire-v1',
  endpoint: 'smns-endpoint-v1',
  log: 'smns-hub-log-v2',
  /** RL2's handshake: its signatures and MACs (channel.ts). */
  rl2: 'smns-rl2-v1',
  /** RL4's canonical action: its step-up signature, its WebAuthn challenge (action.ts). */
  action: 'smns-action-v1',
  /** A machine's re-attestation of its phase-1 history (history.ts, O14 M4). */
  historyAttest: 'smns-history-attest-v1',
} as const;

export type DeviceClass = 'native-mac' | 'web-cards';
export type KeyStorage = 'enclave' | 'software' | 'webcrypto';
export type Passkey = { credentialId: B64; publicKey: B64; rpId: string };

export type Device = {
  id: string;
  class: DeviceClass;
  keyStorage: KeyStorage;
  channelPub: B64;
  stepUpPub?: B64;
  passkey?: Passkey;
  /** Over `DeviceEndorsement`, by an earlier device of the same member; absent on a member's first device. */
  endorsement?: Sig;
};
export type DeviceEndorsement = { org: string; member: MemberId; device: Omit<Device, 'endorsement'> };

export type Role = 'admin' | 'member';
export type Member = { id: MemberId; email: string; role: Role; devices: Device[] };
export type Owners = MemberId[] | 'org';
/** `ref` is the machine's identity (RL §2.3): set at enrollment, never changed, unique in the org. */
export type MachineEntry = { name: string; ref: string; pub: B64; owners: Owners };
/** A name some version of the state has given a machine ref; a name is never given to another ref after. */
export type MachineName = { name: string; ref: string };
/** Whose key it was: an enrolled machine's or a delegation certificate's ref, or one key of a member's device. */
export type KeyHolder = { machine: string } | { member: MemberId; device: string; class: DeviceClass; key: 'channel' | 'step-up' };
/**
 * A key that left honestly (RL §5.2): what it signed with its own timestamp at or before `notAfter` verifies for good.
 * The entry keeps the point and its holder, so a verifier holding only the head can still verify the key's past events.
 * A device or machine key leaving the state, and a certificate's key an admin retires, enter here or `revoked`.
 */
export type RetiredKey = { keyId: string; pub: B64; notAfter: string; holder: KeyHolder };
/**
 * A revoked key (RL §5.2, RL DL 24): nothing it signed verifies, ever, and it is never current, retired or a live
 * certificate's again. A delegation's key is held by the delegation's id and prefix, both reserved for the life of the
 * org (RL DL 26); revoking it revokes every certificate under it.
 */
export type RevokedKey = { keyId: string; holder: KeyHolder | { delegation: string; prefix: string } };
export type Delegation = { id: string; pub: B64; prefix: string; expires: string; maxUses: number; offlineRevokeS: number; owners: Owners };
export type ProjectEntry = { id: string; name: string };

export type OrgState = {
  org: string;
  version: number;
  /** base64url SHA-256(canonicalize(previous OrgState)); null at genesis. */
  prev: B64 | null;
  /** ISO 8601 UTC with milliseconds: the security clock (RL §5.2). */
  issued: string;
  /** `keys` are the kids of admin devices' `stepUpPub`; `recoveryPub` is the offline recovery key, fixed at genesis. */
  root: { keys: string[]; recoveryPub: B64 };
  members: Member[];
  machines: MachineEntry[];
  /**
   * Every (name, ref) pair any version has held, append-only: a name, compared without case, is never given to another
   * ref in the org, so a log writer's `<name>/…` means one machine over the whole chain.
   */
  machineNames: MachineName[];
  retired: RetiredKey[];
  /** Append-only. */
  revoked: RevokedKey[];
  delegations: Delegation[];
  projects: ProjectEntry[];
  /**
   * The DX1 org key's retirement (O14 M5a): set by the state that retires it (`version` is that state's own) and kept
   * unchanged after; a successor may drop it (the retirement undone). Every endpoint that adopts a head carrying it
   * stops dual-coding; the hub purges its wrapped copies only on its word.
   */
  legacyRetired?: LegacyRetired;
};
export type LegacyRetired = { version: number; at: string };
export type SignedOrgState = { state: OrgState; sigs: Sig[] };

/** A record signed once: `sig` is over `body` under the record kind's domain. */
export type Signed<T> = { body: T; sig: Sig };

export type RootTransition = { org: string; fromVersion: number; newRootKeys: B64[]; issued: string };
export type Right = 'spawn' | 'machine-admin' | 'shell';
/** `machineKey` is the id of the machine key it was granted for: a machine re-enrolled with a new key refuses it. */
export type Grant = { org: string; machine: string; machineKey: string; member: MemberId; rights: Right[]; version: number; issued: string };
/** `machine` is the certified machine's ref; `name`, its name, sits under the delegation's prefix. */
export type MachineCert = { org: string; machine: string; name: string; pub: B64; delegation: string; use: number; issued: string };
/**
 * A delegation certificate's retirement, signed by the certificate's own delegation key (an admin retires or revokes a
 * certificate in the state: `retired`, `revoked`).
 */
export type CertRetirement = { org: string; keyId: string; notAfter: string };
/** What the hub serves beside the state for delegated machines: their certificates and their delegations' retirements. */
export type Certificates = { certs: Signed<MachineCert>[]; retirements: Signed<CertRetirement>[] };

// Every field named `machine` below, and in Grant and MachineCert above, carries the machine's ref, never its name.
export type Listing = {
  org: string;
  machine: string;
  session: string;
  revision: number;
  issued: string;
  fields: { owners: MemberId[]; project: string | null; lane: 'A' | 'B'; state: string; title: string };
};
/**
 * The `state` of a withdrawn listing (RL6; the remote layer's Decision Log 27): a session that becomes `private` or
 * leaves gets one last revision in this state, with `owners`, `project` and `title` empty. The Registry keeps it, so its
 * revision still refuses a replay of an earlier one, and leaves it out of every snapshot it serves; the incremental
 * `listing` push carries it, so an app that cached the session drops it. Listing the session again is a higher revision.
 */
export const LISTING_GONE = 'gone';
/** Whether a listing withdraws its session (`LISTING_GONE`). */
export const isListingGone = (listing: Listing): boolean => listing.fields.state === LISTING_GONE;
/** RL §4.1's direct carriers. */
export type EndpointRecord = { org: string; machine: string; addresses: string[]; issued: string };

/**
 * A key allowed to sign as a writer: `notAfter` null for a current key; else the latest timestamp its events may carry
 * (a retired key's `notAfter`, or a certificate's delegation `expires`).
 */
export type Signer = { pub: B64; notAfter: string | null };

/** A log event carrying RL8's signature. Every other field passes through, as DX1's events do. */
export type LogEventV2 = { writer: string; sig: Sig; [field: string]: unknown };
/** Where a log event lives: the org and the project its v2 signature binds. */
export type EventContext = { org: string; project: string };

/**
 * A machine's checkpoint over one writer's phase-1 (DX1) events in a project (history.ts, O14 M4): `digest` folds the
 * writer's events from seq 1 to `upTo`; `names` is the signer's claim, its current name first and then the former names
 * it held on DX2. Signed by the machine key under `smns-history-attest-v1`.
 */
export type HistoryAttestation = { org: string; project: string; writer: string; names: string[]; upTo: number; digest: B64; created: string };
