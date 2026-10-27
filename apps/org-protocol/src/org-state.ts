// RL5's signed org state: genesis, successors on the head, endorsed devices, and root transitions by the recovery key.
// Each verification takes everything it judges by — the verifier's own head, the transitions it holds, the recovery
// key it pinned — and keeps nothing, so the hub's courtesy check and a machine's real one are the same code.
//
// The rules, beyond Interfaces §A's text:
//   - The root set is `root.keys`: kids of the `stepUpPub` of admin members' devices in the same state. A state whose
//     root set is empty, or names a key no admin device holds, is malformed: a demoted or removed admin's key leaves
//     the root set with them, and no state can be written that nobody can follow.
//   - `org` and `root.recoveryPub` never change after genesis (the recovery key is pinned at enrollment), and `issued`
//     never runs backwards: a writer stamps max(now, head.issued).
//   - A device is new to its member unless the head lists the same entry for that member, byte for byte (canonically);
//     a changed key is a new device. New devices of a member who had devices carry an endorsement by the `stepUpPub`
//     of one of that member's devices in the head. The successor that a root transition authorizes may add the
//     transition's new root devices without one: the recovery key vouches for them, and the old devices may be lost.
//   - `retired` holds keys that left honestly, each with its point and holder, and none still held. A successor keeps
//     each entry unchanged or drops it (the key is then revoked), and adds a key only in the step it stops being
//     current, under the holder the head held it by; so a revoked key never re-enters `retired` and a `notAfter` never moves.
//     Genesis retires nothing.
//   - A root transition is issued against the head (`fromVersion` = head's version). While one is held for the head,
//     the successor must be signed by one of its new root keys, not the old root set, and take its keys as `root.keys`.
import { canonicalize } from './canonical.ts';
import { base64urlEncode } from './base64url.ts';
import { importPublicKey, keyId, signBody, signingInput, utf8, verifyInput, type B64, type Sig } from './keys.ts';
import { machineNameKey, type MemberId } from './names.ts';
import { isRootTransition, isSigned, isSignedOrgState } from './shapes.ts';
import { SIGNING_DOMAINS, type Device, type DeviceEndorsement, type OrgState, type RootTransition, type Signed, type SignedOrgState } from './types.ts';
import { accept, refuse, type Verdict } from './verdict.ts';

/** `prev` of the state after this one: base64url SHA-256 of its canonical form. */
export async function stateHash(state: OrgState): Promise<B64> {
  return base64urlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(canonicalize(state)))));
}

/** Signs a state with each of `keys` (root keys, or a transition's new ones). */
export async function signOrgState(state: OrgState, keys: Array<{ privateKey: CryptoKey; pub: B64 }>): Promise<SignedOrgState> {
  return { state, sigs: await Promise.all(keys.map((k) => signBody(SIGNING_DOMAINS.orgState, state, k.privateKey, k.pub))) };
}

/** The endorsement an existing device of `member` signs for its new `device` (whose own `endorsement` is left out). */
export async function endorseDevice(org: string, member: MemberId, device: Device, key: CryptoKey, pub: B64): Promise<Sig> {
  return signBody(SIGNING_DOMAINS.deviceEndorse, endorsementOf(org, member, device), key, pub);
}

/** Signs a root transition with the recovery key. */
export async function signTransition(transition: RootTransition, key: CryptoKey, pub: B64): Promise<Signed<RootTransition>> {
  return { body: transition, sig: await signBody(SIGNING_DOMAINS.transition, transition, key, pub) };
}

function endorsementOf(org: string, member: MemberId, device: Device): DeviceEndorsement {
  const bare: Record<string, unknown> = { ...device };
  delete bare.endorsement;
  return { org, member, device: bare as Omit<Device, 'endorsement'> };
}

/** The root set of a state: kid → the admin device's `stepUpPub` it names. */
async function rootKeys(state: OrgState): Promise<Map<string, B64>> {
  const named = new Set(state.root.keys);
  const out = new Map<string, B64>();
  for (const member of state.members) {
    if (member.role !== 'admin') continue;
    for (const device of member.devices) {
      if (device.stepUpPub === undefined) continue;
      const kid = await keyId(device.stepUpPub);
      if (named.has(kid)) out.set(kid, device.stepUpPub);
    }
  }
  return out;
}

/** What needs the whole state: unique ids and names, owners that are members, a root set of admin step-up keys. */
async function stateInvariants(state: OrgState): Promise<boolean> {
  const memberIds = state.members.map((m) => m.id);
  const emails = state.members.map((m) => m.email.toLowerCase());
  const deviceIds = state.members.flatMap((m) => m.devices.map((d) => d.id));
  const members = new Set(memberIds);
  const ownersKnown = (owners: MemberId[] | 'org') => owners === 'org' || owners.every((id) => members.has(id));
  const distinct = (items: string[]) => new Set(items).size === items.length;
  if (!distinct(memberIds) || !distinct(emails) || !distinct(deviceIds)) return false;
  if (!distinct(state.machines.map((m) => machineNameKey(m.name))) || !distinct(state.machines.map((m) => m.ref))) return false;
  if (!distinct(state.delegations.map((d) => d.id)) || !distinct(state.projects.map((p) => p.id))) return false;
  if (!state.machines.every((m) => ownersKnown(m.owners)) || !state.delegations.every((d) => ownersKnown(d.owners))) return false;
  if (state.root.keys.length === 0 || !distinct(state.root.keys)) return false;
  if (!(await retiredApart(state))) return false;
  const root = await rootKeys(state);
  // Real points, not only encodings: a root set or a recovery key off the curve could never sign again.
  return root.size === state.root.keys.length && (await allOnCurve([...root.values(), state.root.recoveryPub]));
}

/** Retired keys: each named by its own kid, once, and none of them still a key the state holds. */
async function retiredApart(state: OrgState): Promise<boolean> {
  const held = new Set<B64>([
    state.root.recoveryPub,
    ...state.members.flatMap((m) => m.devices.flatMap((d) => [d.channelPub, ...(d.stepUpPub === undefined ? [] : [d.stepUpPub])])),
    ...state.machines.map((m) => m.pub),
    ...state.delegations.map((d) => d.pub),
  ]);
  const kids = new Set<string>();
  for (const r of state.retired) {
    if (kids.has(r.keyId) || held.has(r.pub) || (await keyId(r.pub)) !== r.keyId) return false;
    kids.add(r.keyId);
  }
  return true;
}

/**
 * `retired` across a successor (RL DL 22): an entry is the head's own, unchanged, or a key that stops being current in
 * this very step — held by the head under exactly that holder, and (by `retiredApart`) held nowhere in the successor:
 * a device that leaves its member, a machine entry whose `pub` changes. So every step is checked against its
 * predecessor alone, and a key dropped earlier (revoked) can never be retired later. An entry may leave (the key is then
 * revoked: a retirement can turn out to have been a compromise); a `notAfter` never moves.
 */
function retiredKept(head: OrgState, next: OrgState): boolean {
  const kept = new Set(head.retired.map((r) => canonicalize(r)));
  return next.retired.every((r) => {
    if (kept.has(canonicalize(r))) return true;
    const h = r.holder;
    if ('machine' in h) return head.machines.some((m) => m.ref === h.machine && m.pub === r.pub);
    const device = head.members.find((m) => m.id === h.member)?.devices.find((d) => d.id === h.device);
    return device !== undefined && device.class === h.class && (h.key === 'channel' ? device.channelPub : device.stepUpPub) === r.pub;
  });
}

/** Every key is a P-256 point WebCrypto takes. */
async function allOnCurve(pubs: B64[]): Promise<boolean> {
  for (const pub of pubs) if ((await importPublicKey(pub)) === null) return false;
  return true;
}

/**
 * `machineNames`, the append-only record of the names given to machine refs: one ref per name (compared without
 * case), holding every pair of the head (none at genesis) and every entry's own pair, and nothing else. A name some
 * version gave another ref, given again, or a pair dropped, is `name-retired`.
 */
function machineNamesKept(head: OrgState | null, state: OrgState): Verdict {
  const record = new Map<string, string>();
  for (const pair of state.machineNames) {
    const key = machineNameKey(pair.name);
    const held = record.get(key);
    if (held !== undefined) return refuse(held === pair.ref ? 'malformed' : 'name-retired');
    record.set(key, pair.ref);
  }
  const kept = head?.machineNames ?? [];
  if (kept.some((pair) => record.get(machineNameKey(pair.name)) !== pair.ref)) return refuse('name-retired');
  for (const entry of state.machines) {
    const ref = record.get(machineNameKey(entry.name));
    if (ref === undefined) return refuse('malformed');
    if (ref !== entry.ref) return refuse('name-retired');
  }
  const owed = new Set([...kept, ...state.machines].map((pair) => machineNameKey(pair.name)));
  return [...record.keys()].every((key) => owed.has(key)) ? accept() : refuse('malformed');
}

/** A well-formed signed state: its shape, then what needs the whole state. */
async function wellFormed(s: unknown): Promise<boolean> {
  return isSignedOrgState(s) && (await stateInvariants(s.state));
}

/**
 * At least one of `sigs` verifies over `state` under a key of `allowed` (kid → public point). `not-root-signed` when no
 * signature names an allowed key, `bad-signature` when one does and fails.
 */
async function rootSigned(state: OrgState, sigs: Sig[], allowed: Map<string, B64>): Promise<Verdict> {
  const input = signingInput(SIGNING_DOMAINS.orgState, state);
  let named = false;
  for (const sig of sigs) {
    const pub = allowed.get(sig.kid);
    if (pub === undefined) continue;
    named = true;
    if (await verifyInput(input, sig, pub)) return accept();
  }
  return refuse(named ? 'bad-signature' : 'not-root-signed');
}

/** Genesis: version 1, no `prev`, signed by a key in its own root set. */
export async function verifyGenesis(s: SignedOrgState): Promise<Verdict> {
  if (!(await wellFormed(s))) return refuse('malformed');
  if (s.state.version !== 1) return refuse('malformed');
  if (s.state.prev !== null) return refuse('bad-link');
  if (s.state.retired.length > 0) return refuse('malformed');
  const names = machineNamesKept(null, s.state);
  if (!names.ok) return names;
  return rootSigned(s.state, s.sigs, await rootKeys(s.state));
}

/**
 * A root transition the recovery key signed against `head`. `pinnedRecovery` is the recovery key the verifier pinned
 * at enrollment (the hub passes its head's `root.recoveryPub`, which never changes after genesis).
 */
export async function verifyTransition(head: SignedOrgState, t: Signed<RootTransition>, pinnedRecovery: B64): Promise<Verdict> {
  if (!isSigned(t, isRootTransition) || !(await allOnCurve(t.body.newRootKeys))) return refuse('malformed');
  if (t.body.org !== head.state.org) return refuse('bad-link');
  if (t.body.fromVersion < head.state.version) return refuse('rollback');
  if (t.body.fromVersion !== head.state.version) return refuse('not-head');
  if (t.sig.kid !== (await keyId(pinnedRecovery))) return refuse('unknown-signer');
  if (!(await verifyInput(signingInput(SIGNING_DOMAINS.transition, t.body), t.sig, pinnedRecovery))) return refuse('bad-signature');
  return accept();
}

/** The keys a state holds as current: devices' channel and step-up keys, and machine entries' keys. */
const currentKeys = (state: OrgState): B64[] => [
  ...state.members.flatMap((m) => m.devices.flatMap((d) => [d.channelPub, ...(d.stepUpPub === undefined ? [] : [d.stepUpPub])])),
  ...state.machines.map((m) => m.pub),
];

/**
 * The key ids a step revokes (RL DL 23), sorted: device and machine keys current or retired in `prev` and neither
 * current nor retired in `next`. A verifier keeps their union over the chain and passes it to `verifySuccessor`, so a
 * revoked key never becomes current again; a step alone cannot see a key revoked several steps back.
 */
export async function revokedBy(prev: OrgState, next: OrgState): Promise<string[]> {
  const kept = new Set<B64>([...currentKeys(next), ...next.retired.map((r) => r.pub)]);
  const gone = new Set<B64>([...currentKeys(prev), ...prev.retired.map((r) => r.pub)].filter((pub) => !kept.has(pub)));
  return (await Promise.all([...gone].map((pub) => keyId(pub)))).sort();
}

/** What a verifier carries beside the chain: the key ids revoked at any step so far (`revokedBy`'s union). */
export type SuccessorOptions = { revokedKeyIds?: Iterable<string> };

/**
 * A successor of `head`: it links to the head, is root-signed (by the head's root set, or by the new root keys of a
 * transition in `transitions` held for the head), and every device new to a member who had devices is endorsed by one
 * of that member's devices in the head. `transitions` may hold every transition the verifier keeps; those for other
 * versions, and any that fail to verify, are passed over. `options.revokedKeyIds`, the caller's record of revoked keys,
 * refuses a successor that makes one current again (`revoked`).
 */
export async function verifySuccessor(head: SignedOrgState, next: SignedOrgState, transitions: Signed<RootTransition>[], options: SuccessorOptions = {}): Promise<Verdict> {
  if (!(await wellFormed(next)) || !Array.isArray(transitions)) return refuse('malformed');
  const before = head.state;
  const after = next.state;
  if (after.org !== before.org) return refuse('bad-link');
  if (after.version < before.version) return refuse('rollback');
  if (after.version !== before.version + 1 || after.prev !== (await stateHash(before))) return refuse('not-head');
  if (after.issued < before.issued || after.root.recoveryPub !== before.root.recoveryPub) return refuse('malformed');

  const names = machineNamesKept(before, after);
  if (!names.ok) return names;
  if (after.machines.some((m) => before.machines.some((h) => h.pub === m.pub && h.ref !== m.ref))) return refuse('malformed');
  if (!retiredKept(before, after)) return refuse('malformed');
  if (options.revokedKeyIds !== undefined) {
    const revoked = new Set(options.revokedKeyIds);
    for (const pub of currentKeys(after)) if (revoked.has(await keyId(pub))) return refuse('revoked');
  }

  const held: RootTransition[] = [];
  for (const t of transitions) {
    if (isSigned(t, isRootTransition) && t.body.fromVersion === before.version && (await verifyTransition(head, t, before.root.recoveryPub)).ok) held.push(t.body);
  }
  if (held.length === 0) {
    const verdict = await rootSigned(after, next.sigs, await rootKeys(before));
    return verdict.ok ? endorsed(before, after, new Set()) : verdict;
  }
  // Any one held transition may authorize the successor, whatever their order; the old root set no longer can. The
  // refusal is the furthest any transition got: unsigned, then a failed signature, then a root set not taken, then
  // the endorsements.
  let failure: Verdict = refuse('not-root-signed');
  for (const t of held) {
    const allowed = new Map<string, B64>();
    for (const pub of t.newRootKeys) allowed.set(await keyId(pub), pub);
    const signed = await rootSigned(after, next.sigs, allowed);
    if (!signed.ok) {
      if (!failure.ok && failure.code === 'not-root-signed') failure = signed;
      continue;
    }
    const takesRootSet = after.root.keys.length === allowed.size && after.root.keys.every((kid) => allowed.has(kid));
    if (!takesRootSet) {
      if (!failure.ok && (failure.code === 'not-root-signed' || failure.code === 'bad-signature')) failure = refuse('malformed');
      continue;
    }
    const verdict = await endorsed(before, after, new Set(t.newRootKeys));
    if (verdict.ok) return verdict;
    failure = verdict;
  }
  return failure;
}

/** Every device new to a member who had devices in `before` carries a valid endorsement (see the header). */
async function endorsed(before: OrgState, after: OrgState, exempt: Set<B64>): Promise<Verdict> {
  for (const member of after.members) {
    const was = before.members.find((m) => m.id === member.id);
    if (was === undefined || was.devices.length === 0) continue;
    const endorsers = new Map<string, B64>();
    for (const d of was.devices) if (d.stepUpPub !== undefined) endorsers.set(await keyId(d.stepUpPub), d.stepUpPub);
    for (const device of member.devices) {
      if (was.devices.some((d) => d.id === device.id && canonicalize(d) === canonicalize(device))) continue;
      if (device.stepUpPub !== undefined && exempt.has(device.stepUpPub)) continue;
      if (device.endorsement === undefined) return refuse('endorsement-missing');
      const pub = endorsers.get(device.endorsement.kid);
      if (pub === undefined) return refuse('unknown-signer');
      const input = signingInput(SIGNING_DOMAINS.deviceEndorse, endorsementOf(after.org, member.id, device));
      if (!(await verifyInput(input, device.endorsement, pub))) return refuse('bad-signature');
    }
  }
  return accept();
}
