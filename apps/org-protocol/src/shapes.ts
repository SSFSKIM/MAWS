// Shape checks for the signed things, by their exact fields: an unknown field is refused, so a signed document has one
// meaning to every verifier, and a verifier never passes over a field a newer writer meant to bind. Values are checked
// for type and encoding here; what needs the whole state (unique ids, owners that are members, the root set) is
// org-state.ts's `stateInvariants`.
import { isBase64urlOf } from './base64url.ts';
import { canonicalize } from './canonical.ts';
import { isPublicKey, isSig } from './keys.ts';
import { isIsoMillis, isMachineName, isMachineRef, isMemberId, type MemberId } from './names.ts';
import type {
  Delegation,
  Device,
  EndpointRecord,
  Grant,
  Listing,
  MachineCert,
  MachineEntry,
  MachineName,
  RetiredKey,
  RevokedKey,
  CertRetirement,
  Certificates,
  LegacyRetired,
  Member,
  OrgState,
  Passkey,
  ProjectEntry,
  RootTransition,
  Signed,
  SignedOrgState,
} from './types.ts';

type Fields = Record<string, unknown>;

/** A plain JSON object whose keys are all of `required` and any of `optional`, and nothing else. */
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) && keys.every((key) => required.includes(key) || optional.includes(key));
}

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';
const isCount = (value: unknown, min: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
const isB64 = (value: unknown): value is string => typeof value === 'string' && value !== '' && isBase64urlOf(value, (value.length * 6) >> 3);
const isOneOf = <T extends string>(value: unknown, options: readonly T[]): value is T => typeof value === 'string' && (options as readonly string[]).includes(value);
const unique = (items: readonly string[]) => new Set(items).size === items.length;
const isList = <T>(value: unknown, item: (v: unknown) => v is T): value is T[] => Array.isArray(value) && value.every((v) => item(v));
const isMemberIdText = (value: unknown): value is string => typeof value === 'string' && isMemberId(value);

/** True when RFC 8785 can write `value`: no lone surrogate in any string or key, no non-finite number. */
function canonicalizable(value: unknown): boolean {
  try {
    canonicalize(value);
    return true;
  } catch {
    return false;
  }
}

/** Member ids, at least one and none twice, or `'org'`. */
export const isOwners = (value: unknown): value is MemberId[] | 'org' =>
  value === 'org' || (isList(value, isMemberIdText) && value.length > 0 && unique(value));

function isPasskey(value: unknown): value is Passkey {
  return fields(value, ['credentialId', 'publicKey', 'rpId']) && isB64(value.credentialId) && isB64(value.publicKey) && isText(value.rpId);
}

export function isDevice(value: unknown): value is Device {
  if (!fields(value, ['id', 'class', 'keyStorage', 'channelPub'], ['stepUpPub', 'passkey', 'endorsement'])) return false;
  return (
    isText(value.id) &&
    isOneOf(value.class, ['native-mac', 'web-cards'] as const) &&
    isOneOf(value.keyStorage, ['enclave', 'software', 'webcrypto'] as const) &&
    isPublicKey(value.channelPub) &&
    (value.stepUpPub === undefined || isPublicKey(value.stepUpPub)) &&
    (value.passkey === undefined || isPasskey(value.passkey)) &&
    (value.endorsement === undefined || isSig(value.endorsement)) &&
    // A web-cards device runs hub-served code (RL §5.10): it holds no step-up key, so it can never be a root key or
    // endorse a device.
    !(value.class === 'web-cards' && value.stepUpPub !== undefined)
  );
}

function isMember(value: unknown): value is Member {
  return (
    fields(value, ['id', 'email', 'role', 'devices']) &&
    isMemberIdText(value.id) &&
    isText(value.email) &&
    isOneOf(value.role, ['admin', 'member'] as const) &&
    isList(value.devices, isDevice)
  );
}

const isName = (value: unknown): value is string => typeof value === 'string' && isMachineName(value);

function isMachineEntry(value: unknown): value is MachineEntry {
  return fields(value, ['name', 'ref', 'pub', 'owners']) && isName(value.name) && isMachineRef(value.ref) && isPublicKey(value.pub) && isOwners(value.owners);
}

/** A delegation's id: 32 lowercase hex digits, the provisioning key's id (no `_`, which ends it in a certificate's ref). */
const isDelegationId = (id: unknown) => typeof id === 'string' && /^[0-9a-f]{32}$/.test(id);

function isNameRecord(value: unknown): value is MachineName {
  return fields(value, ['name', 'ref']) && isName(value.name) && isMachineRef(value.ref);
}

function isDelegation(value: unknown): value is Delegation {
  return (
    fields(value, ['id', 'pub', 'prefix', 'expires', 'maxUses', 'offlineRevokeS', 'owners']) &&
    isDelegationId(value.id) &&
    isPublicKey(value.pub) &&
    typeof value.prefix === 'string' &&
    isMachineName(value.prefix) &&
    isIsoMillis(value.expires) &&
    isCount(value.maxUses, 1) &&
    isCount(value.offlineRevokeS, 0) &&
    isOwners(value.owners)
  );
}

function isProjectEntry(value: unknown): value is ProjectEntry {
  return fields(value, ['id', 'name']) && isText(value.id) && isText(value.name);
}

function isKeyHolder(h: unknown): boolean {
  return (
    (fields(h, ['machine']) && isMachineRef(h.machine)) ||
    (fields(h, ['member', 'device', 'class', 'key']) &&
      isMemberIdText(h.member) &&
      isText(h.device) &&
      isOneOf(h.class, ['native-mac', 'web-cards'] as const) &&
      isOneOf(h.key, ['channel', 'step-up'] as const))
  );
}

function isRetiredKey(value: unknown): value is RetiredKey {
  if (!fields(value, ['keyId', 'pub', 'notAfter', 'holder'])) return false;
  return isKeyHolder(value.holder) && isBase64urlOf(value.keyId, 16) && isPublicKey(value.pub) && isIsoMillis(value.notAfter);
}

function isRevokedKey(value: unknown): value is RevokedKey {
  if (!fields(value, ['keyId', 'holder'])) return false;
  const h = value.holder;
  return (isKeyHolder(h) || (fields(h, ['delegation', 'prefix']) && isDelegationId(h.delegation) && typeof h.prefix === 'string' && isMachineName(h.prefix))) && isBase64urlOf(value.keyId, 16);
}

function isLegacyRetired(value: unknown): value is LegacyRetired {
  return fields(value, ['version', 'at']) && isCount(value.version, 1) && isIsoMillis(value.at);
}

export function isOrgState(value: unknown): value is OrgState {
  if (!fields(value, ['org', 'version', 'prev', 'issued', 'root', 'members', 'machines', 'machineNames', 'retired', 'revoked', 'delegations', 'projects'], ['legacyRetired'])) return false;
  const root = value.root;
  return (
    isText(value.org) &&
    isCount(value.version, 1) &&
    (value.prev === null || isBase64urlOf(value.prev, 32)) &&
    isIsoMillis(value.issued) &&
    fields(root, ['keys', 'recoveryPub']) &&
    isList(root.keys, (k): k is string => isBase64urlOf(k, 16)) &&
    isPublicKey(root.recoveryPub) &&
    isList(value.members, isMember) &&
    isList(value.machines, isMachineEntry) &&
    isList(value.machineNames, isNameRecord) &&
    isList(value.retired, isRetiredKey) &&
    isList(value.revoked, isRevokedKey) &&
    isList(value.delegations, isDelegation) &&
    isList(value.projects, isProjectEntry) &&
    (!('legacyRetired' in value) || isLegacyRetired(value.legacyRetired))
  );
}

export function isSignedOrgState(value: unknown): value is SignedOrgState {
  return fields(value, ['state', 'sigs']) && isOrgState(value.state) && isList(value.sigs, isSig) && value.sigs.length > 0 && canonicalizable(value.state);
}

export function isSigned<T>(value: unknown, body: (v: unknown) => v is T): value is Signed<T> {
  return fields(value, ['body', 'sig']) && body(value.body) && isSig(value.sig) && canonicalizable(value.body);
}

export function isRootTransition(value: unknown): value is RootTransition {
  return (
    fields(value, ['org', 'fromVersion', 'newRootKeys', 'issued']) &&
    isText(value.org) &&
    isCount(value.fromVersion, 1) &&
    isList(value.newRootKeys, isPublicKey) &&
    value.newRootKeys.length > 0 &&
    unique(value.newRootKeys) &&
    isIsoMillis(value.issued)
  );
}

export function isGrant(value: unknown): value is Grant {
  return (
    fields(value, ['org', 'machine', 'machineKey', 'member', 'rights', 'version', 'issued']) &&
    isText(value.org) &&
    isMachineRef(value.machine) &&
    isBase64urlOf(value.machineKey, 16) &&
    isMemberIdText(value.member) &&
    isList(value.rights, (r): r is Grant['rights'][number] => isOneOf(r, ['spawn', 'machine-admin', 'shell'] as const)) &&
    unique(value.rights) &&
    isCount(value.version, 1) &&
    isIsoMillis(value.issued)
  );
}

export function isMachineCert(value: unknown): value is MachineCert {
  return (
    fields(value, ['org', 'machine', 'name', 'pub', 'delegation', 'use', 'issued']) &&
    isText(value.org) &&
    isMachineRef(value.machine) &&
    isName(value.name) &&
    isPublicKey(value.pub) &&
    isDelegationId(value.delegation) &&
    isCount(value.use, 1) &&
    isIsoMillis(value.issued)
  );
}

export function isListing(value: unknown): value is Listing {
  if (!fields(value, ['org', 'machine', 'session', 'revision', 'issued', 'fields'])) return false;
  const f = value.fields;
  return (
    isText(value.org) &&
    isMachineRef(value.machine) &&
    isText(value.session) &&
    isCount(value.revision, 1) &&
    isIsoMillis(value.issued) &&
    fields(f, ['owners', 'project', 'lane', 'state', 'title']) &&
    // Owners are member ids: `@machine` never leaves the machine and `'org'` is never an owner (RL §5.8).
    isList(f.owners, isMemberIdText) &&
    unique(f.owners) &&
    (f.project === null || isText(f.project)) &&
    isOneOf(f.lane, ['A', 'B'] as const) &&
    typeof f.state === 'string' &&
    typeof f.title === 'string'
  );
}

export function isEndpointRecord(value: unknown): value is EndpointRecord {
  return (
    fields(value, ['org', 'machine', 'addresses', 'issued']) &&
    isText(value.org) &&
    isMachineRef(value.machine) &&
    isList(value.addresses, isText) &&
    isIsoMillis(value.issued)
  );
}

export function isCertRetirement(value: unknown): value is CertRetirement {
  return fields(value, ['org', 'keyId', 'notAfter']) && isText(value.org) && isBase64urlOf(value.keyId, 16) && isIsoMillis(value.notAfter);
}

/** The bundle's two lists are lists; their items are judged one by one where they are used. */
export function isCertificates(value: unknown): value is Certificates {
  return fields(value, ['certs', 'retirements']) && Array.isArray(value.certs) && Array.isArray(value.retirements);
}
