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
  endpoint: 'smns-endpoint-v1',
  log: 'smns-hub-log-v2',
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
export type MachineEntry = { name: string; pub: B64; owners: Owners };
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
  delegations: Delegation[];
  projects: ProjectEntry[];
};
export type SignedOrgState = { state: OrgState; sigs: Sig[] };

/** A record signed once: `sig` is over `body` under the record kind's domain. */
export type Signed<T> = { body: T; sig: Sig };

export type RootTransition = { org: string; fromVersion: number; newRootKeys: B64[]; issued: string };
export type Right = 'spawn' | 'machine-admin' | 'shell';
export type Grant = { org: string; machine: string; member: MemberId; rights: Right[]; version: number; issued: string };
export type MachineCert = { org: string; machine: string; pub: B64; delegation: string; use: number; issued: string };
export type Listing = {
  org: string;
  machine: string;
  session: string;
  revision: number;
  issued: string;
  fields: { owners: MemberId[]; project: string | null; lane: 'A' | 'B'; state: string; title: string };
};
/** RL §4.1's direct carriers. */
export type EndpointRecord = { org: string; machine: string; addresses: string[]; issued: string };

/** A log event carrying RL8's signature. Every other field passes through, as DX1's events do. */
export type LogEventV2 = { writer: string; sig: Sig; [field: string]: unknown };
/** Where a log event lives: the org and the project its v2 signature binds. */
export type EventContext = { org: string; project: string };
