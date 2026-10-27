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
//   - A root transition is issued against the head (`fromVersion` = head's version). While one is held for the head,
//     the successor must be signed by one of its new root keys, not the old root set, and take its keys as `root.keys`.
import { canonicalize } from './canonical.ts';
import { base64urlEncode } from './base64url.ts';
import { keyId, signBody, signingInput, utf8, verifyInput, type B64, type Sig } from './keys.ts';
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
  if (!distinct(state.machines.map((m) => machineNameKey(m.name)))) return false;
  if (!distinct(state.delegations.map((d) => d.id)) || !distinct(state.projects.map((p) => p.id))) return false;
  if (!state.machines.every((m) => ownersKnown(m.owners)) || !state.delegations.every((d) => ownersKnown(d.owners))) return false;
  if (state.root.keys.length === 0 || !distinct(state.root.keys)) return false;
  return (await rootKeys(state)).size === state.root.keys.length;
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
  return rootSigned(s.state, s.sigs, await rootKeys(s.state));
}

/**
 * A root transition the recovery key signed against `head`. `pinnedRecovery` is the recovery key the verifier pinned
 * at enrollment (the hub passes its head's `root.recoveryPub`, which never changes after genesis).
 */
export async function verifyTransition(head: SignedOrgState, t: Signed<RootTransition>, pinnedRecovery: B64): Promise<Verdict> {
  if (!isSigned(t, isRootTransition)) return refuse('malformed');
  if (t.body.org !== head.state.org) return refuse('bad-link');
  if (t.body.fromVersion < head.state.version) return refuse('rollback');
  if (t.body.fromVersion !== head.state.version) return refuse('not-head');
  if (t.sig.kid !== (await keyId(pinnedRecovery))) return refuse('unknown-signer');
  if (!(await verifyInput(signingInput(SIGNING_DOMAINS.transition, t.body), t.sig, pinnedRecovery))) return refuse('bad-signature');
  return accept();
}

/**
 * A successor of `head`: it links to the head, is root-signed (by the head's root set, or by the new root keys of a
 * transition in `transitions` held for the head), and every device new to a member who had devices is endorsed by one
 * of that member's devices in the head. `transitions` may hold every transition the verifier keeps; those for other
 * versions, and any that fail to verify, are passed over.
 */
export async function verifySuccessor(head: SignedOrgState, next: SignedOrgState, transitions: Signed<RootTransition>[]): Promise<Verdict> {
  if (!(await wellFormed(next))) return refuse('malformed');
  const before = head.state;
  const after = next.state;
  if (after.org !== before.org) return refuse('bad-link');
  if (after.version < before.version) return refuse('rollback');
  if (after.version !== before.version + 1 || after.prev !== (await stateHash(before))) return refuse('not-head');
  if (after.issued < before.issued || after.root.recoveryPub !== before.root.recoveryPub) return refuse('malformed');

  const held: RootTransition[] = [];
  for (const t of transitions) {
    if (isSigned(t, isRootTransition) && t.body.fromVersion === before.version && (await verifyTransition(head, t, before.root.recoveryPub)).ok) held.push(t.body);
  }
  if (held.length === 0) {
    const verdict = await rootSigned(after, next.sigs, await rootKeys(before));
    return verdict.ok ? endorsed(before, after, new Set()) : verdict;
  }
  // Any one held transition may authorize the successor; the old root set no longer can.
  let failure = refuse('not-root-signed');
  for (const t of held) {
    const allowed = new Map<string, B64>();
    for (const pub of t.newRootKeys) allowed.set(await keyId(pub), pub);
    const signed = await rootSigned(after, next.sigs, allowed);
    if (!signed.ok) {
      if (signed.code === 'bad-signature') failure = signed;
      continue;
    }
    const takesRootSet = after.root.keys.length === allowed.size && after.root.keys.every((kid) => allowed.has(kid));
    return takesRootSet ? endorsed(before, after, new Set(t.newRootKeys)) : refuse('malformed');
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
