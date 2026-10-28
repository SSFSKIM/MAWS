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
//   - One holder per key: a state holds no key under two holders (two devices, a device's channel and step-up, a machine
//     and a delegation, the recovery key and any other), and a key the successor holds only under another holder has
//     left its own.
//   - Where a key goes (RL DL 24). A device's or machine's key the head holds and the successor doesn't enters `retired`
//     or `revoked` in that step, under the holder the head held it by; a delegation's key enters `revoked` only. A
//     `retired` entry stays as it is or moves to `revoked`; `revoked` is append-only. A key the state never held enters
//     either only as a certificate's, under its ref (an admin's retirement or revocation). A revoked key is never current
//     (`revoked`), nor retired, so a `notAfter` never moves and a revoked key never returns. Each rule needs the state
//     and its predecessor alone. Genesis retires and revokes nothing.
//   - Delegations: `id`, `pub` and `prefix` never change; `expires` changes only while both values are later than the
//     successor's `issued`. Dropping one is revoking its key (held by its id and prefix), and moves every `retired`
//     entry of its certificates (a ref `<id>_…`) into `revoked`. Its id and prefix stay reserved (RL DL 26).
//   - Name namespaces (RL DL 25, 26), by the lower-cased key names compare by: no `machineNames` name starts with a
//     delegation's prefix, live or revoked, and no such prefix equals another's or starts with it; no two delegations,
//     live or revoked, share an id, and no entry's ref (nor any in `machineNames`) starts with a known id and `_`.
//   - The DX1 org key's retirement (`legacyRetired`, O14 M5a): a state that adds it names its own version, and a
//     successor keeps it as it stands or drops it (the retirement undone); it never moves.
//   - A root transition is issued against the head (`fromVersion` = head's version). While one is held for the head,
//     the successor must be signed by one of its new root keys, not the old root set, and take its keys as `root.keys`.
import { canonicalize } from './canonical.ts';
import { base64urlEncode } from './base64url.ts';
import { importPublicKey, keyId, signBody, signingInput, utf8, verifyInput, type B64, type Sig } from './keys.ts';
import { machineNameKey, type MemberId } from './names.ts';
import { isRootTransition, isSigned, isSignedOrgState } from './shapes.ts';
import { SIGNING_DOMAINS, type Device, type DeviceEndorsement, type OrgState, type RevokedKey, type RootTransition, type Signed, type SignedOrgState } from './types.ts';
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
  // One holder per key: no key is two devices', a device's two, a machine's and a delegation's, or the recovery key too.
  if (!distinct([...heldKeys(state).map((k) => k.pub), state.root.recoveryPub])) return false;
  // Name namespaces: a certificate's name, under its delegation's prefix, never meets an enrolled name or another
  // delegation's. A revoked delegation's prefix and id stay reserved (RL DL 26), so nothing reopens its history: no
  // later delegation takes them, and no entry takes the `<id>_` ref shape of a delegation the state knows.
  const gone = state.revoked.flatMap((r) => ('delegation' in r.holder ? [r.holder] : []));
  const prefixes = [...state.delegations.map((d) => d.prefix), ...gone.map((d) => d.prefix)].map(machineNameKey);
  if (prefixes.some((p, i) => prefixes.some((q, j) => i !== j && q.startsWith(p)))) return false;
  if ([...state.machineNames, ...state.machines].some((n) => prefixes.some((p) => machineNameKey(n.name).startsWith(p)))) return false;
  const ids = [...state.delegations.map((d) => d.id), ...gone.map((d) => d.delegation)];
  if (!distinct(ids) || [...state.machineNames, ...state.machines].some((m) => ids.some((id) => m.ref.startsWith(`${id}_`)))) return false;
  // A revoked delegation's certificates are revoked with it, history included: none keeps a `retired` entry.
  const goneIds = gone.map((d) => d.delegation);
  if (state.retired.some((r) => 'machine' in r.holder && goneIds.some((id) => (r.holder as { machine: string }).machine.startsWith(`${id}_`)))) return false;
  if (!(await retiredApart(state))) return false;
  const revoked = state.revoked.map((r) => r.keyId);
  if (!distinct(revoked) || state.retired.some((r) => revoked.includes(r.keyId))) return false;
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

type Holder = RevokedKey['holder'];
const same = (a: unknown, b: unknown) => canonicalize(a) === canonicalize(b);

/** The keys a state holds as current, each with its holder: devices' channel and step-up keys, machines', delegations'. */
function heldKeys(state: OrgState): Array<{ pub: B64; holder: Holder }> {
  return [
    ...state.members.flatMap((m) =>
      m.devices.flatMap((d) => [
        { pub: d.channelPub, holder: { member: m.id, device: d.id, class: d.class, key: 'channel' as const } },
        ...(d.stepUpPub === undefined ? [] : [{ pub: d.stepUpPub, holder: { member: m.id, device: d.id, class: d.class, key: 'step-up' as const } }]),
      ]),
    ),
    ...state.machines.map((m) => ({ pub: m.pub, holder: { machine: m.ref } })),
    ...state.delegations.map((d) => ({ pub: d.pub, holder: { delegation: d.id, prefix: d.prefix } })),
  ];
}

/** Whether the successor holds as current a key that the head or the successor lists in `revoked`. */
async function revivesRevoked(head: OrgState, next: OrgState): Promise<boolean> {
  const revoked = new Set([...head.revoked, ...next.revoked].map((r) => r.keyId));
  for (const { pub } of heldKeys(next)) if (revoked.has(await keyId(pub))) return true;
  return false;
}

/**
 * Where each key went across a successor (see the header): `revoked` kept, `retired` kept or moved to `revoked`, every
 * key the head held and the successor doesn't in `retired` or `revoked`, each new entry under its true holder, and the
 * delegations' fixed fields kept. With `retiredApart` and `revivesRevoked`, a `notAfter` never moves and a revoked key
 * never returns, each checked against the predecessor alone.
 */
async function keysAccounted(head: OrgState, next: OrgState): Promise<boolean> {
  const revokedNext = new Set(next.revoked.map((r) => canonicalize(r)));
  if (!head.revoked.every((r) => revokedNext.has(canonicalize(r)))) return false;
  const revokedAs = new Map(next.revoked.map((r) => [r.keyId, r.holder]));
  const intoRevoked = (kid: string, holder: Holder) => {
    const h = revokedAs.get(kid);
    return h !== undefined && same(h, holder);
  };
  const retiredNext = new Set(next.retired.map((r) => canonicalize(r)));
  for (const r of head.retired) if (!retiredNext.has(canonicalize(r)) && !intoRevoked(r.keyId, r.holder)) return false;

  const held = heldKeys(head);
  // A key counts as kept only under the same holder: one that reappears under another has left its own.
  const stillHeld = new Set(heldKeys(next).map((k) => canonicalize(k)));
  const heldByKid = new Map<string, Holder>();
  for (const { pub, holder } of held) {
    const kid = await keyId(pub);
    heldByKid.set(kid, holder);
    if (stillHeld.has(canonicalize({ pub, holder }))) continue;
    const retiredNow = !('delegation' in holder) && next.retired.some((r) => r.pub === pub && same(r.holder, holder));
    if (!retiredNow && !intoRevoked(kid, holder)) return false;
  }
  // A new entry names the holder the head held the key by, or, for a key the state never held, a certificate's ref.
  const heldByPub = new Map(held.map((k) => [k.pub, k.holder]));
  const retiredHead = new Set(head.retired.map((r) => canonicalize(r)));
  for (const r of next.retired) {
    if (retiredHead.has(canonicalize(r))) continue;
    const holder = heldByPub.get(r.pub);
    if (holder === undefined ? !('machine' in r.holder) : 'delegation' in holder || !same(holder, r.holder)) return false;
  }
  const retiredHolders = new Map(head.retired.map((r) => [r.keyId, r.holder]));
  const revokedHead = new Set(head.revoked.map((r) => canonicalize(r)));
  for (const r of next.revoked) {
    if (revokedHead.has(canonicalize(r))) continue;
    const holder = heldByKid.get(r.keyId) ?? retiredHolders.get(r.keyId);
    if (holder === undefined ? !('machine' in r.holder) : !same(holder, r.holder)) return false;
  }

  for (const d of head.delegations) {
    const kept = next.delegations.find((e) => e.id === d.id);
    if (kept === undefined) continue; // its key's way out is checked above
    if (kept.pub !== d.pub || kept.prefix !== d.prefix) return false;
    if (kept.expires !== d.expires && !(d.expires > next.issued && kept.expires > next.issued)) return false;
  }
  return true;
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

/** `legacyRetired` across a step (see the header): added at the state's own version, then kept unchanged or dropped. */
function legacyRetiredKept(head: OrgState | null, state: OrgState): boolean {
  const mark = state.legacyRetired;
  if (mark === undefined) return true;
  if (head?.legacyRetired !== undefined) return same(head.legacyRetired, mark);
  return mark.version === state.version;
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
  if (s.state.retired.length > 0 || s.state.revoked.length > 0 || !legacyRetiredKept(null, s.state)) return refuse('malformed');
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

/**
 * A recovery behind the head (O10 M1): a root transition the pinned recovery key signed from a version at or below the
 * verifier's `head`, issued later than every transition the verifier has accepted (`accepted`, held by their bodies)
 * and none of them. The recovery key is the root of every machine's pins, so a transition it signs from an earlier
 * version says the states after that version are forged; the stolen admin key that forged them cannot sign one, and an
 * older genuine transition replayed is refused by the `issued` rule (`rollback`). On accepting one the verifier drops
 * every state after `fromVersion` and takes the first state under the new root as its head (`verifySuccessor` against
 * the state at `fromVersion`, which that state's `prev` authenticates), whose `revoked` is authoritative. The rule
 * holds only if `accepted` holds every transition of the chain the verifier took, its first sync's included.
 */
export async function verifyRewind(head: SignedOrgState, t: Signed<RootTransition>, pinnedRecovery: B64, accepted: RootTransition[]): Promise<Verdict> {
  if (!isSigned(t, isRootTransition) || !(await allOnCurve(t.body.newRootKeys)) || !Array.isArray(accepted)) return refuse('malformed');
  if (t.body.org !== head.state.org) return refuse('bad-link');
  if (t.body.fromVersion > head.state.version) return refuse('not-head');
  if (t.sig.kid !== (await keyId(pinnedRecovery))) return refuse('unknown-signer');
  if (!(await verifyInput(signingInput(SIGNING_DOMAINS.transition, t.body), t.sig, pinnedRecovery))) return refuse('bad-signature');
  if (!issuedAfterAll(t.body, accepted)) return refuse('rollback');
  return accept();
}

/**
 * The replay barrier over root transitions: `t` is issued later than every transition in `accepted` and is none of them.
 * A recovery behind the head must pass it (`verifyRewind`), and so must a transition taken forward once a rewind has
 * brought an older transition's `fromVersion` back to the head (`advanceHead` given `accepted`).
 */
export function issuedAfterAll(t: RootTransition, accepted: RootTransition[]): boolean {
  return !accepted.some((a) => canonicalize(a) === canonicalize(t) || a.issued >= t.issued);
}

/**
 * A successor of `head`: it links to the head, is root-signed (by the head's root set, or by the new root keys of a
 * transition in `transitions` held for the head), and every device new to a member who had devices is endorsed by one
 * of that member's devices in the head. `transitions` may hold every transition the verifier keeps; those for other
 * versions, and any that fail to verify, are passed over. A successor holding a revoked key as current is `revoked`.
 * Across a root transition `head` is the state at `fromVersion`, and the successor keeps its `revoked` like any other:
 * the revocations a verifier drops on accepting it are only those of the superseded states, which `head` never held.
 */
export async function verifySuccessor(head: SignedOrgState, next: SignedOrgState, transitions: Signed<RootTransition>[]): Promise<Verdict> {
  if (!isSignedOrgState(next) || !Array.isArray(transitions)) return refuse('malformed');
  const before = head.state;
  const after = next.state;
  if (after.org !== before.org) return refuse('bad-link');
  if (after.version < before.version) return refuse('rollback');
  if (after.version !== before.version + 1 || after.prev !== (await stateHash(before))) return refuse('not-head');
  // A revival reads `revoked` before the whole-state rules it also breaks (a delegation kept beside its own revocation).
  if (await revivesRevoked(before, after)) return refuse('revoked');
  if (!(await stateInvariants(after))) return refuse('malformed');
  if (after.issued < before.issued || after.root.recoveryPub !== before.root.recoveryPub) return refuse('malformed');
  if (!legacyRetiredKept(before, after)) return refuse('malformed');

  const names = machineNamesKept(before, after);
  if (!names.ok) return names;
  if (after.machines.some((m) => before.machines.some((h) => h.pub === m.pub && h.ref !== m.ref))) return refuse('malformed');
  if (!(await keysAccounted(before, after))) return refuse('malformed');

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
